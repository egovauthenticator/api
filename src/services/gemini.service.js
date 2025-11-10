// src/services/gemini.service.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs/promises";
import path from "path";
import { extractionSchema } from "../config/schema.js";
// If Node < 18: import fetch from "node-fetch";

const PREFERRED_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

export function geminiClient(apiKey) {
  if (!apiKey) throw new Error("GOOGLE_API_KEY is missing.");
  return new GoogleGenerativeAI(apiKey);
}

/* ---------------- I/O helpers ---------------- */
function mimeOf(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}
export async function fileToInlinePart(filePath) {
  const data = await fs.readFile(filePath);
  return { inlineData: { data: data.toString("base64"), mimeType: mimeOf(filePath) } };
}
export function bufferToInlinePart(buffer, filename = "image.jpg") {
  return { inlineData: { data: Buffer.from(buffer).toString("base64"), mimeType: mimeOf(filename) } };
}
async function urlToInlinePart(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || mimeOf(url) || "image/png";
  return { inlineData: { data: buf.toString("base64"), mimeType: ct } };
}

/* ---------------- parsing helpers ---------------- */
function extractFirstJSONObject(s) {
  if (!s) return null;
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
function parseResponseJSON(resp) {
  const t = resp?.text?.();
  if (t && t.trim()) {
    try { return JSON.parse(t); } catch { const j = extractFirstJSONObject(t); if (j) return j; }
  }
  const parts = resp?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    if (typeof p.text === "string" && p.text.trim()) {
      try { return JSON.parse(p.text); } catch { const j = extractFirstJSONObject(p.text); if (j) return j; }
    }
  }
  try { const whole = JSON.stringify(resp); const j = extractFirstJSONObject(whole); if (j) return j; } catch {}
  return null;
}
function finishReason(resp) {
  return resp?.response?.candidates?.[0]?.finishReason
      || resp?.candidates?.[0]?.finishReason
      || "UNKNOWN";
}
function assertNotBlocked(resp) {
  const pf = resp?.promptFeedback;
  if (pf?.blockReason) {
    const ratings = pf?.safetyRatings?.map(r => `${r.category}:${r.probability}`).join(", ");
    throw new Error(`Output blocked by safety (${pf.blockReason}). Ratings: ${ratings || "n/a"}`);
  }
}

/* ---------------- generic caller (base pass) ---------------- */
async function callModel({ genAI, modelId, parts, withSchema, maxOutputTokens }) {
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: withSchema ? 0.1 : 0.0,
      topK: 32,
      topP: 0.95,
      maxOutputTokens,
      ...(withSchema
        ? { responseMimeType: "application/json", responseSchema: extractionSchema }
        : { responseMimeType: "application/json" }),
    },
  });
  const resp = await model.generateContent({ contents: [{ role: "user", parts }] });
  assertNotBlocked(resp);
  const parsed = parseResponseJSON(resp.response ?? resp);
  if (!parsed) {
    const fr = finishReason(resp);
    throw new Error(`Model did not return JSON (finishReason=${fr}).`);
  }
  return parsed;
}

/* ---------------- prompts (base) ---------------- */
const HARDCODED_PROMPT = [
  "You are a precise information extractor for Philippine identification and civil registry documents.",
  "Populate these JSON keys exactly:",
  "type, id, name, firstName, middleName, lastName, sex, dateOfBirth, placeOfBirth, address, precintNo, votersIdNumber, others.",
  "Rules:",
  "- NAME: Use only the row '1. NAME' (First / Middle / Last) for the CHILD. Do not use parent rows (MAIDEN NAME / MOTHER / FATHER / INFORMANT).",
  "- Compose: name = '<First> <Middle> <Last>' with single spaces (omit blanks).",
  "- dateOfBirth must be YYYY-MM-DD.",
  "- placeOfBirth: normalize PH locations (e.g., 'Espana, MLA' → 'España, Manila').",
  "- If a field is not visible or uncertain, return an empty string.",
  "- Output strictly valid JSON."
].join(" ");

const RETRY_MINI = `Return only a single valid JSON object matching the schema. If uncertain, use "" for that field.`;

/* ---------------- SEX prompts (5 independent framings) ---------------- */
const SEX_PROMPT_A = [
  "Determine only the SEX for PSA 'Certificate of Live Birth' (row '2. SEX').",
  "Decide strictly from the mark placed on the blank beside '1 Male' or '2 Female' (X/x/✓/•/-/dot/slash).",
  "Return JSON only: {\"sex\":\"\"} where sex ∈ {\"Male\",\"Female\",\"\"}."
].join(" ");

const SEX_PROMPT_B = [
  "You must output JSON only with a 'sex' field.",
  "Look only at row '2. SEX' and decide from the marked blank near '1 Male' or '2 Female'.",
  "Return: {\"sex\":\"Male\"} or {\"sex\":\"Female\"} or {\"sex\":\"\"} if not visible."
].join(" ");

const SEX_PROMPT_C = [
  "From the image of row '2. SEX', tell which label is marked: '1 Male' or '2 Female'.",
  "Return JSON only: {\"label\":\"1 Male\"} or {\"label\":\"2 Female\"} or {\"label\":\"\"}."
].join(" ");

const SEX_PROMPT_D = [
  "Decide the SEX from row '2. SEX'. Output JSON only using this schema."
].join(" ");

const SEX_PROMPT_E = [
  "Consider the horizontal layout of row '2. SEX': a left blank and a right blank.",
  "If the left blank (near '1 Male') is marked, return {\"sex\":\"Male\"}.",
  "If the right blank (near '2 Female') is marked, return {\"sex\":\"Female\"}.",
  "If unseen, return {\"sex\":\"\"}."
].join(" ");

/* Schema for D (enum forces a choice unless truly unclear) */
const SEX_ENUM_SCHEMA = {
  type: "object",
  properties: { sex: { type: "string", enum: ["Male", "Female", ""] } },
  required: ["sex"]
};

/* Build parts for a given sex prompt + refs */
function buildSexParts({ prompt, userPart, femaleRefs = [], maleRefs = [], withRefs = true }) {
  const parts = [{ text: prompt }];
  if (withRefs) {
    if (femaleRefs.length) parts.push({ text: "Reference: FEMALE marks" }, ...femaleRefs);
    if (maleRefs.length)   parts.push({ text: "Reference: MALE marks" },   ...maleRefs);
  }
  parts.push({ text: "Decide from this image:" }, userPart);
  return parts;
}

/* Low-level caller for SEX with optional schema and robust parsing */
async function callSexOnce({ genAI, modelId, parts, maxOutputTokens = 512, schema = null }) {
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: 0.0,
      topK: 32,
      topP: 0.9,
      maxOutputTokens,
      responseMimeType: "application/json",
      ...(schema ? { responseSchema: schema } : {})
    },
  });
  const resp = await model.generateContent({ contents: [{ role: "user", parts }] });
  assertNotBlocked(resp);

  const fr = finishReason(resp);
  const raw =
    resp?.response?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") ||
    resp?.text?.() || "";
  const parsed =
    extractFirstJSONObject(raw) ||
    extractFirstJSONObject(JSON.stringify(resp.response ?? resp)) ||
    null;

  return { parsed, fr };
}

/* Try multiple framings; stop on first definitive Male/Female */
async function runSexEnsemble({ genAI, userPart, maleRefs, femaleRefs }) {
  for (const modelId of PREFERRED_MODELS) {
    // Order: A (refs), B (no refs), C (label), D (enum), E (geometry)
    const stages = [
      { prompt: SEX_PROMPT_A, schema: null, withRefs: true,  tokens: 512 },
      { prompt: SEX_PROMPT_B, schema: null, withRefs: false, tokens: 512 },
      { prompt: SEX_PROMPT_C, schema: null, withRefs: false, tokens: 256, post: (p) => {
          const label = String(p?.label || "").trim();
          if (label === "1 Male") return { sex: "Male" };
          if (label === "2 Female") return { sex: "Female" };
          return null;
        }
      },
      { prompt: SEX_PROMPT_D, schema: SEX_ENUM_SCHEMA, withRefs: false, tokens: 128 },
      { prompt: SEX_PROMPT_E, schema: SEX_ENUM_SCHEMA, withRefs: false, tokens: 256 },
    ];

    for (const st of stages) {
      const parts = buildSexParts({
        prompt: st.prompt,
        userPart,
        femaleRefs,
        maleRefs,
        withRefs: !!st.withRefs
      });

      try {
        const { parsed, fr } = await callSexOnce({
          genAI, modelId, parts, maxOutputTokens: st.tokens, schema: st.schema
        });

        // If stage provided a translator
        const normalized = st.post ? st.post(parsed) : parsed;

        if (normalized && typeof normalized === "object") {
          const s = String(normalized.sex || "").trim();
          if (s === "Male" || s === "Female") return s;
        }

        // If no JSON and was MAX_TOKENS, continue to next stage with bigger/different framing
        if (!parsed && fr === "MAX_TOKENS") continue;
      } catch (e) {
        const msg = String(e?.message || e);
        if (/not found|404|unsupported/i.test(msg)) continue; // try next model
        // For other errors, continue to next stage inside same model
      }
    }
  }
  return ""; // unknown
}

/* ---------------- main API ---------------- */
export async function extractWithGemini({
  apiKey,
  imagePath,
  imageBuffer,
  filename,

  // optional sex hints
  maleSampleUrls = ["http://localhost:3000/sample_of_male/1.png", "http://localhost:3000/sample_of_male/2.png", "http://localhost:3000/sample_of_male/3.png",],
  femaleSampleUrls = ["http://localhost:3000/sample_of_female/1.png", "http://localhost:3000/sample_of_female/2.png",],
  sexCropUrl = "",
  sexCropBuffer = null,
}) {
  const genAI = geminiClient(apiKey);

  // PASS 1 (everything): keep this minimal to protect NAME accuracy
  const userImagePart = imageBuffer
    ? bufferToInlinePart(imageBuffer, filename)
    : await fileToInlinePart(imagePath);

  const baseParts = [{ text: HARDCODED_PROMPT }, userImagePart];

  async function tryModelAll(modelId) {
    try {
      return await callModel({
        genAI, modelId, parts: baseParts, withSchema: true, maxOutputTokens: 2048
      });
    } catch (e1) {
      const msg1 = String(e1?.message || e1);
      if (/not found|404|unsupported/i.test(msg1)) throw e1;
      return await callModel({
        genAI, modelId, parts: [{ text: HARDCODED_PROMPT + " " + RETRY_MINI }, userImagePart],
        withSchema: false, maxOutputTokens: 4096
      });
    }
  }

  let result = null;
  for (const modelId of PREFERRED_MODELS) {
    try { result = await tryModelAll(modelId); break; }
    catch (e) {
      const msg = String(e?.message || e);
      if (/not found|404|unsupported/i.test(msg)) continue;
      throw e;
    }
  }
  if (!result) throw new Error("No supported Gemini Flash model available for this API key/region.");

  // If base pass already has a definitive sex, keep it and skip the ensemble
  if (result.sex === "Male" || result.sex === "Female") return result;

  // Build the sex image part (prefer cropped row)
  let sexImagePart = userImagePart;
  if (sexCropUrl) {
    try { sexImagePart = await urlToInlinePart(sexCropUrl); } catch {}
  } else if (sexCropBuffer) {
    try { sexImagePart = bufferToInlinePart(sexCropBuffer, "sex-crop.png"); } catch {}
  }

  // Optional references (cap at 2 each; more can hurt)
  async function toRefs(urls = [], n = 2) {
    const out = [];
    for (const u of urls.slice(0, n)) {
      try { out.push(await urlToInlinePart(u)); } catch {}
    }
    return out;
  }
  const femaleRefs = await toRefs(femaleSampleUrls, 100);
  const maleRefs   = await toRefs(maleSampleUrls, 100);

  // PASS 2: multi-framing ensemble for sex
  const sex = await runSexEnsemble({ genAI, userPart: sexImagePart, maleRefs, femaleRefs });
  if (sex === "Male" || sex === "Female") result.sex = sex; // only set on success

  return result;
}
