// src/services/gemini.service.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs/promises";
import path from "path";
import { extractionSchema } from "../config/schema.js";

const PREFERRED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash", // fallback only if available to your key/region
];

export function geminiClient(apiKey) {
  if (!apiKey) throw new Error("GOOGLE_API_KEY is missing.");
  return new GoogleGenerativeAI(apiKey);
}

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
  return {
    inlineData: {
      data: data.toString("base64"),
      mimeType: mimeOf(filePath),
    },
  };
}

export function bufferToInlinePart(buffer, filename = "image.jpg") {
  return {
    inlineData: {
      data: Buffer.from(buffer).toString("base64"),
      mimeType: mimeOf(filename),
    },
  };
}

/* ---------- JSON helpers (unchanged) ---------- */
function extractFirstJSONObject(s) {
  if (!s) return null;
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
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
  try {
    const whole = JSON.stringify(resp);
    const j = extractFirstJSONObject(whole);
    if (j) return j;
  } catch {}
  return null;
}
function readFinishReason(resp) {
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

/* ---------- Generic Gemini caller with optional schema ---------- */
async function callWithSchema({
  genAI, modelId, imagePart, systemMsg, responseSchema, maxOutputTokens,
}) {
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: 0.2,
      topK: 32,
      topP: 0.95,
      maxOutputTokens,
      responseMimeType: "application/json",
      ...(responseSchema ? { responseSchema } : {}),
    },
  });

  const parts = [{ text: systemMsg }, imagePart];
  const resp = await model.generateContent({ contents: [{ role: "user", parts }] });
  assertNotBlocked(resp);
  const parsed = parseResponseJSON(resp.response ?? resp);
  if (!parsed) {
    const finish = readFinishReason(resp);
    throw new Error(`Model did not return valid JSON (finishReason=${finish}).`);
  }
  return parsed;
}

/* =====================================================================
   PASS 1: QR-first detector/reader (Gemini-only)
   - We ask Gemini to ONLY return QR content (if any), parsed as JSON when it
     looks like JSON, or "" if unreadable / not present.
   - Minimal schema to avoid hallucinations.
   ===================================================================== */

const QR_DETECT_SCHEMA = {
  type: "object",
  properties: {
    // "qr" should contain the parsed QR JSON object if the QR content is JSON.
    // If QR exists but isn't JSON, return an empty object and put raw text in "raw".
    qr: { type: "object", additionalProperties: true },
    // "raw" contains the raw decoded QR text (if not JSON, or if JSON parse fails).
    raw: { type: "string" },
    // "found" makes it explicit if a QR was detected and decoded.
    found: { type: "boolean" }
  },
  required: ["found", "qr", "raw"]
};

const QR_DETECT_PROMPT = [
  "You are a QR code detector and reader.",
  "Inspect the provided image and do the following:",
  "1) If a QR code is visible and decodable, decode its content.",
  "2) If the decoded QR content looks like JSON (starts with '{' and ends with '}'), parse it and place it in the 'qr' field, and set 'raw' to the original text.",
  "3) If the decoded QR content is not JSON, set 'qr' to an empty object {} and set 'raw' to the decoded string.",
  "4) If there is no visible or readable QR, set 'found' to false and return qr: {} and raw: \"\".",
  "Return strictly valid JSON only."
].join(" ");

/* PSA QR validator + mapper (when QR is JSON with PSA shape) */
function isValidPSAQRJson(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (!obj.d || !obj.i || typeof obj.sb !== "object") return false;
  if (String(obj.i).toUpperCase() !== "PSA") return false;
  const sb = obj.sb || {};
  const needed = ["DOB", "PCN", "POB", "fn", "ln", "mn", "s"];
  for (const k of needed) if (typeof sb[k] === "undefined") return false;
  return true;
}
function normalizePOB(pob) {
  if (!pob) return "";
  return pob.replace(/,\s*/g, ", ").replace(/\s{2,}/g, " ").trim();
}
function mapPSAQRToExtraction(obj) {
  const sb = obj.sb || {};
  const firstName  = String(sb.fn || "").trim().toUpperCase();
  const middleName = String(sb.mn || "").trim().toUpperCase();
  const lastName   = String(sb.ln || "").trim().toUpperCase();
  const placeOfBirth = normalizePOB(String(sb.POB || ""));
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ").trim();

  return {
    type: "PSA",
    id: String(sb.PCN || "").replace(/[^0-9]/g, ""),
    name: fullName,
    firstName,
    middleName,
    lastName,
    sex: String(sb.s || "").trim(),
    dateOfBirth: String(sb.DOB || "").trim(),
    placeOfBirth,
    address: placeOfBirth, // PSA QR doesn't include a separate address; reuse POB
    precintNo: "",
    votersIdNumber: "",
    others: "",
  };
}

/* =====================================================================
   PASS 2: OCR/field extractor (your original logic, with a stronger prompt
           that explicitly says: read QR first if present; otherwise OCR)
   ===================================================================== */

const HARDCODED_PROMPT = [
  "You are a precise information extractor for Philippine identification and civil registry documents.",
  "If a QR code is visible, read it FIRST and use its structured content as the source of truth.",
  "If the QR is PSA-style (with keys d, i='PSA', sb{DOB, PCN, POB, fn, ln, mn, s,...}), map it to the requested output fields.",
  "If no usable QR is visible, use OCR on the image.",
  "",
  "Populate the following JSON keys exactly:",
  "type, id, name, firstName, middleName, lastName, sex, dateOfBirth, placeOfBirth, address, precintNo, votersIdNumber, others.",
  "Rules:",
  "1. For dateOfBirth, always format the value as YYYY-MM-DD (ISO).",
  "2. For placeOfBirth, match and normalize locations within the Philippines (cities, municipalities, or provinces).",
  "   Use knowledge of Philippine geography to correct spacing and commas.",
  "3. If a field is not visible or uncertain, return an empty string for that field.",
  "4. Do not include commentary or extra keys—return strictly valid JSON.",
  "5. votersIdNumber can also be id sometimes if the uploaded image is a voter's certification."
].join(" ");

const RETRY_PROMPT = `
Return only this JSON:
{"type":"","id":"","name":"","firstName":"","middleName":"","lastName":"","sex":"","dateOfBirth":"","placeOfBirth":"","address":"","precintNo":"","votersIdNumber":"","others":""}
Keep all values short and on one line.
Format dateOfBirth strictly as YYYY-MM-DD.
For placeOfBirth, ensure it's a valid location in the Philippines (city, municipality, or province), with proper comma spacing.
`;

/* =====================================================================
   Public: extractWithGemini
   - Pass 1: Ask Gemini to detect+decode QR and return JSON (if any).
   - If PSA QR is detected, map and return immediately.
   - Else Pass 2: Run the original extractor prompt using your schema.
   ===================================================================== */
export async function extractWithGemini({ apiKey, imagePath, imageBuffer, filename }) {
  const genAI = geminiClient(apiKey);

  const imagePart = imageBuffer
    ? bufferToInlinePart(imageBuffer, filename)
    : await fileToInlinePart(imagePath);

  /* ---- Pass 1: QR-first (Gemini only) ---- */
  const tryQRDetect = async (modelId) => {
    return await callWithSchema({
      genAI,
      modelId,
      imagePart,
      systemMsg: QR_DETECT_PROMPT,
      responseSchema: QR_DETECT_SCHEMA,
      maxOutputTokens: 512,
    });
  };

  for (const modelId of PREFERRED_MODELS) {
    try {
      const qrRes = await tryQRDetect(modelId);
      if (qrRes?.found) {
        // Prefer parsed JSON if it looks PSA-like
        const candidate = qrRes?.qr && Object.keys(qrRes.qr || {}).length ? qrRes.qr : null;
        if (candidate && isValidPSAQRJson(candidate)) {
          return mapPSAQRToExtraction(candidate); // short-circuit success
        }
        // If raw QR is JSON but not PSA, we still ignore and fall through to OCR extractor
        // (or you could add other QR formats here later)
      }
      // If not found, fall through to OCR extraction
      break;
    } catch (e) {
      const msg = String(e?.message || e);
      // Try next model on transport/model errors
      if (/not found|404|unsupported/i.test(msg)) continue;
      // Non-model error → break to fallback
      break;
    }
  }

  /* ---- Pass 2: OCR/field extraction (original flow) ---- */
  const tryExtract = async (modelId) => {
    try {
      // Attempt 1: with schema (preferred)
      return await callWithSchema({
        genAI,
        modelId,
        imagePart,
        systemMsg: HARDCODED_PROMPT,
        responseSchema: extractionSchema,
        maxOutputTokens: 2048,
      });
    } catch (e1) {
      const msg1 = String(e1?.message || e1);
      if (/not found|404|unsupported/i.test(msg1)) throw e1;
      // Attempt 2: without schema (but still JSON-only)
      return await callWithSchema({
        genAI,
        modelId,
        imagePart,
        systemMsg: HARDCODED_PROMPT + RETRY_PROMPT,
        responseSchema: null,
        maxOutputTokens: 4096,
      });
    }
  };

  for (const modelId of PREFERRED_MODELS) {
    try {
      return await tryExtract(modelId);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/not found|404|unsupported/i.test(msg)) continue;
      throw e;
    }
  }

  throw new Error("No supported Gemini Flash model available for this API key/region.");
}
