// src/gemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs/promises";
import path from "path";
import { extractionSchema } from "../config/schema.js";

const PREFERRED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash" // last-resort if still available to your key
];

export function geminiClient(apiKey) {
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is missing.");
  return new GoogleGenerativeAI(apiKey);
}

function mimeOf(filename) {
  const ext = path.extname(filename).toLowerCase();
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

/**
 * Single call with configurable token cap and optional schema.
 */
async function callModel({ genAI, modelId, imagePart, systemMsg, withSchema, maxOutputTokens }) {
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: 0.2,
      topK: 32,
      topP: 0.95,
      maxOutputTokens,
      ...(withSchema
        ? { responseMimeType: "application/json", responseSchema: extractionSchema }
        : { responseMimeType: "application/json" })
    },
  });

  const parts = [
    { text: systemMsg },
    imagePart
  ];

  const resp = await model.generateContent({ contents: [{ role: "user", parts }] });
  assertNotBlocked(resp);
  const parsed = parseResponseJSON(resp.response ?? resp);
  if (!parsed) {
    const finish = readFinishReason(resp);
    throw new Error(`Model did not return valid JSON (finishReason=${finish}).`);
  }
  return parsed;
}

/** Hard-coded instruction prompt */
const HARDCODED_PROMPT = [
  "You are a precise information extractor for Philippine identification and civil registry documents.",
  "Populate the following JSON keys exactly:",
  "type, id, name, firstName, middleName, lastName, sex, dateOfBirth, placeOfBirth, address, precintNo, votersIdNumber, others.",
  "Rules:",
  "1. For dateOfBirth, always format the value as YYYY-MM-DD (ISO format).",
  "2. For placeOfBirth, match and normalize locations within the Philippines (cities, municipalities, or provinces).",
  "   Use your knowledge of Philippine geography to infer the correct spelling or province if abbreviated.",
  "3. If a field is not visible or uncertain, return an empty string for that field.",
  "4. Do not output commentary, markdown, or extra text—return strictly valid JSON only.",
  "5. votersIdNumber can also be id sometimes if the uploaed image is a voter's certification."
].join(" ");

const RETRY_PROMPT = `
Return only this JSON:
{"type":"","id":"","name":"","firstName":"","middleName":"","lastName":"","sex":"","dateOfBirth":"","placeOfBirth":"","address":"","precintNo": "", "votersIdNumber": "","others":"", }
Keep all values short and on one line.
Format dateOfBirth strictly as YYYY-MM-DD.
For placeOfBirth, ensure it's a valid location in the Philippines (city, municipality, or province).
`;

/**
 * Main extraction with schema first, then fallback.
 */
export async function extractWithGemini({ apiKey, imagePath }) {
  const genAI = geminiClient(apiKey);
  const imagePart = await fileToInlinePart(imagePath);

  const tryModel = async (modelId) => {
    try {
      // Attempt 1: schema + 2048 tokens
      return await callModel({
        genAI, modelId, imagePart, systemMsg: HARDCODED_PROMPT, withSchema: true, maxOutputTokens: 2048
      });
    } catch (e1) {
      const msg1 = String(e1?.message || e1);
      if (/not found|404|unsupported/i.test(msg1)) throw e1;
      // Attempt 2: no schema + 4096 tokens with simpler hardcoded instructions
      return await callModel({
        genAI, modelId, imagePart, systemMsg: HARDCODED_PROMPT + RETRY_PROMPT, withSchema: false, maxOutputTokens: 4096
      });
    }
  };

  for (const modelId of PREFERRED_MODELS) {
    try {
      return await tryModel(modelId);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/not found|404|unsupported/i.test(msg)) continue;
      throw e;
    }
  }

  throw new Error("No supported Gemini Flash model available for this API key/region.");
}
