// src/controllers/verification.controller.js
import { env } from "../config/env.js";
import {
  getVerificationById,
  getVerificationByUser,
  createVerification,
  verifyPSARecords,
  verifyVoters,
  deleteVerification,
} from "../services/verification.service.js";
import { ERROR_VERIFICATION_NOT_FOUND } from "../constants/verification.constant.js";
import { ERROR_USER_NOT_FOUND } from "../constants/user.constant.js";
import { extractWithGemini } from "../services/gemini.service.js";
import { getUserById } from "../services/user.service.js";
import { getAPIKey } from "../services/api-key-management.service.js";
import crypto from "crypto";
import { getCache } from "../config/cache.js";

// ------------------------------
// Simple in-memory caches
// ------------------------------
/**
 * cookieCache: key is fixed ("verify.philsys.gov.ph"), value: { cookie: string, expiresAt: number }
 */
const cookieCache = new Map();
/**
 * verifyCache: key is a stable hash string from request body, value: { data: any, expiresAt: number }
 */
const verifyCache = new Map();

// 24h TTL; tune as needed. useClones:false to avoid deep-cloning big objects.
const cache = getCache("ocrCache", {
  stdTTL: 86400,
  checkperiod: 600,
  useClones: false,
});

// Deduplicate concurrent extractions for the same image hash
const inFlight = new Map(); // key: cacheKey, value: Promise<result>

function hashBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ------------------------------
// Helpers
// ------------------------------
function setWithTTL(cache, key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function getIfFresh(cache, key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function toStableKey(obj) {
  // Order keys deterministically to make a stable cache key
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function normalizePCN(pcn) {
  if (!pcn) return pcn;
  return String(pcn).replace(/[^0-9]/g, ""); // keep digits only
}

// Try to extract the __verify-token cookie from:
// 1) response.headers.get('set-cookie') string
// 2) JSON body like { cookies: ["__verify-token=...; Path=/; ...", ...] } or { cookie: "..." }
// 3) Any field that looks like a token
function parseVerifyCookie({ headers, bodyJson, bodyText }) {
  // 1) From headers
  const setCookie = headers?.get?.("set-cookie");
  if (setCookie) {
    const tokenMatch = setCookie.match(/__verify-token=[^;]+/i);
    if (tokenMatch) return tokenMatch[0];
  }

  // 2) From JSON body (common patterns)
  if (bodyJson) {
    // e.g. { cookie: "__verify-token=..." }
    if (
      typeof bodyJson.cookie === "string" &&
      bodyJson.cookie.includes("__verify-token=")
    ) {
      const tokenMatch = bodyJson.cookie.match(/__verify-token=[^;]+/i);
      if (tokenMatch) return tokenMatch[0];
    }

    // e.g. { cookies: ["__verify-token=...; Path=/; ...", ...] }
    if (Array.isArray(bodyJson.cookies)) {
      for (const c of bodyJson.cookies) {
        if (typeof c === "string" && c.includes("__verify-token=")) {
          const tokenMatch = c.match(/__verify-token=[^;]+/i);
          if (tokenMatch) return tokenMatch[0];
        }
      }
    }

    // e.g. { headers: { "set-cookie": "..." } }
    const h = bodyJson.headers || bodyJson.header || {};
    const sc = h["set-cookie"] || h["Set-Cookie"] || h["SET-COOKIE"];
    if (typeof sc === "string" && sc.includes("__verify-token=")) {
      const tokenMatch = sc.match(/__verify-token=[^;]+/i);
      if (tokenMatch) return tokenMatch[0];
    }
  }

  // 3) From raw text (fallback)
  if (typeof bodyText === "string" && bodyText.includes("__verify-token=")) {
    const tokenMatch = bodyText.match(/__verify-token=[^;]+/i);
    if (tokenMatch) return tokenMatch[0];
  }

  return null;
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = env.verifier?.fetchTimeoutMS
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function getVerifyCookieCached() {
  const CACHE_KEY = "verify.philsys.gov.ph";
  const cached = getIfFresh(cookieCache, CACHE_KEY);
  if (cached) return cached; // already a string like "__verify-token=..."

  // Fetch fresh cookie from cookie-grabber
  const res = await fetchWithTimeout(env.verifier?.cookieGrabberUrl, {
    method: "GET",
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    // non-JSON body, that's fine; we'll try regex from text / headers
  }

  if (!res.ok) {
    const msg = json?.message || `Cookie grabber failed with ${res.status}`;
    throw new Error(msg);
  }

  const cookie = parseVerifyCookie({
    headers: res.headers,
    bodyJson: json,
    bodyText: text,
  });
  if (!cookie) {
    throw new Error(
      "Could not extract __verify-token from cookie grabber response"
    );
  }

  setWithTTL(cookieCache, CACHE_KEY, cookie, env.verifier?.cookieTTLMS);
  return cookie;
}

function buildPSARequestBody({ d, dob, pcn, pob, fn, ln, mn, s, sf }) {
  // The remote API expects:
  // {
  //   "d": "YYYY-MM-DD",
  //   "i": "PSA",
  //   "sb": { BF: "", DOB: "YYYY-MM-DD", PCN: "digits", POB: "...",
  //           fn: "...", ln: "...", mn: "...", s: "Male|Female", sf: "" }
  // }
  return {
    d, // Date issued (YYYY-MM-DD)
    i: "PSA",
    sb: {
      BF: "", // keep empty unless you have BF like "[6,2]" etc.
      DOB: dob,
      PCN: normalizePCN(pcn),
      POB: pob,
      fn,
      ln,
      mn,
      s,
      sf: sf || "",
    },
  };
}

// ------------------------------
// Controllers
// ------------------------------
export async function getVerification(req, res) {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ message: "Missing file id" });

    const verification = await getVerificationById(id);
    if (!verification) {
      return res
        .status(401)
        .json({ success: false, message: ERROR_VERIFICATION_NOT_FOUND });
    }

    return res.json({ success: true, data: verification });
  } catch (err) {
    console.error(err);
    // Keep response JSON small—clients are typically <video> tags
    return res.status(500).json({ message: "Proxy error" });
  }
}

export async function getVerificationList(req, res) {
  try {
    const userId = req.params.userId;
    const { q, type, pageSize, pageIndex } = req.query;
    if (!userId) return res.status(400).json({ message: "Missing file id" });

    const user = await getUserById(userId);
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: ERROR_USER_NOT_FOUND });
    }

    const results = await getVerificationByUser(
      q ?? "",
      type
        ? Array.isArray(type)
          ? type
          : type.split(",")
        : ["PSA", "PHILSYS", "VOTERS"],
      userId,
      pageSize,
      pageIndex
    );
    return res.json({ success: true, data: results });
  } catch (err) {
    console.error(err);
    // Keep response JSON small—clients are typically <video> tags
    return res.status(500).json({ message: "Proxy error" });
  }
}

export async function verifyPSA(req, res) {
  let user;
  try {
    // Accept both exact keys or fallbacks from client
    const {
      userId,
      d, // date issued (YYYY-MM-DD)
      dob, // DOB (YYYY-MM-DD)
      pcn, // 16-digit PCN (may include dashes/spaces)
      pob, // Place of birth (e.g., "Siaton,Negros Oriental")
      fn,
      ln,
      mn, // names
      s, // sex
      sf, // suffix
    } = req.body || {};

    user = await getUserById(userId);
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: ERROR_USER_NOT_FOUND });
    }

    // Basic validation
    if (!d || !dob || !pcn || !pob || !fn || !ln || !mn || !s) {
      throw new Error(
        "Missing required fields: d, dob, pcn, pob, fn, ln, mn, s"
      );
    }

    // Cache key for verifier result
    const verifyKey = toStableKey({
      d,
      dob,
      pcn: normalizePCN(pcn),
      pob,
      fn,
      ln,
      mn,
      s,
      sf: sf || "",
    });
    const cached = getIfFresh(verifyCache, verifyKey);
    if (cached) {
      const verification = await createVerification(
        "PHILSYS",
        userId,
        {
          id: pcn,
          sex: s,
          name: `${fn} ${mn ? mn + " " : ""}${ln}`,
          address: pob,
          lastName: ln,
          firstName: fn,
          precintNo: null,
          middleName: mn,
          dateOfBirth: dob,
          placeOfBirth: pob,
        },
        "AUTHENTIC"
      );
      return res.json({ success: true, cached: true, data: verification });
    }

    // 1) Get (or reuse cached) verify cookie
    const verifyCookie = await getVerifyCookieCached(); // e.g. "__verify-token=Im...."

    // 2) Build request body for remote verify API
    const payload = buildPSARequestBody({
      d,
      dob,
      pcn,
      pob,
      fn,
      ln,
      mn,
      s,
      sf,
    });

    // 3) Call remote verify API
    const resp = await fetchWithTimeout(env.verifier?.psaVerifyURL, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        Origin: "https://verify.philsys.gov.ph",
        Referer: "https://verify.philsys.gov.ph/",
        "Content-Type": "application/json",
        // Use only the token cookie; if you have more cookies you can append them: `${verifyCookie}; other=...`
        Cookie: verifyCookie,
      },
      body: JSON.stringify(payload),
    });

    // Some responses may be non-JSON on error; try both
    const respText = await resp.text();
    let respJson = null;
    try {
      respJson = JSON.parse(respText);
    } catch (_) {
      // leave as text
    }

    if (!resp.ok) {
      const message =
        (respJson && (respJson.message || respJson.error)) ||
        `Verifier failed with ${resp.status}`;

      const verification = await createVerification(
        "PHILSYS",
        userId,
        {
          id: pcn,
          sex: s,
          name: `${fn} ${mn ? mn + " " : ""}${ln}`,
          address: pob,
          lastName: ln,
          firstName: fn,
          precintNo: null,
          middleName: mn,
          dateOfBirth: dob,
          placeOfBirth: pob,
        },
        "FAKE"
      );
      return res
        .status(200)
        .json({ success: false, message, data: verification });
    }

    const data = respJson ?? { raw: respText };

    // Cache successful verification result
    setWithTTL(verifyCache, verifyKey, data, env.verifier?.verifyTTLMS);

    const verification = await createVerification(
      "PHILSYS",
      userId,
      {
        id: pcn,
        sex: s,
        name: `${fn} ${mn ? mn + " " : ""}${ln}`,
        address: pob,
        lastName: ln,
        firstName: fn,
        precintNo: null,
        middleName: mn,
        dateOfBirth: dob,
        placeOfBirth: pob,
      },
      "AUTHENTIC"
    );
    return res.json({ success: true, cached: false, data: verification });
  } catch (err) {
    console.error(err);
    if (user) await createVerification("PSA", userId, {}, "ERROR");
    return res
      .status(500)
      .json({ success: false, message: "Verification error" });
  }
}

export async function verifyOCR(req, res) {
  const { userId } = req.body;
  const file = req.file; // from multer.memoryStorage()
  const buffer = file?.buffer;
  const filename = file?.originalname || "upload.jpg";

  if (!buffer) {
    return res.status(400).json({
      success: false,
      message: "image field is required (png/jpg/webp/gif)",
    });
  }

  let type, data, status, user;

  try {
    user = await getUserById(userId);
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: ERROR_USER_NOT_FOUND });
    }

    const apiKey = await getAPIKey("google-gen-ai");

    // ====== CACHED GEMINI EXTRACTION (dedupe + cache) ======
    const imgHash = hashBuffer(buffer);
    const cacheKey = `ocr:gemini:${imgHash}`;

    let result = cache.get(cacheKey);
    if (!result) {
      // Check if there is an ongoing extraction for this same image
      let p = inFlight.get(cacheKey);
      if (!p) {
        p = (async () => {
          const out = await extractWithGemini({
            apiKey: apiKey?.apiKey,
            imageBuffer: buffer,
            filename,
          });
          // Cache only on success; you may also cache "null" to avoid repeated failures.
          cache.set(cacheKey, out);
          return out;
        })().finally(() => {
          // Always clear inFlight entry after settle
          inFlight.delete(cacheKey);
        });
        inFlight.set(cacheKey, p);
      }
      result = await p;
    }
    // ====== END CACHED GEMINI EXTRACTION ======

    const docType = result?.type?.toLowerCase?.() || "";

    if (docType.includes("certificate") && docType.includes("birth")) {
      type = "PSA";
      data = { ...result, type };
      const records = await verifyPSARecords(
        result?.firstName,
        result?.lastName,
        result?.sex,
        result?.dateOfBirth
      );
      status = records && records?.id ? "AUTHENTIC" : "FAKE";
    } else if (docType.includes("certification") && docType.includes("vote")) {
      type = "VOTERS";
      // normalize precinct number (remove spaces)
      result.precintNo = result.precintNo?.trim().split(" ").join("");
      data = { ...result, type };
      const voters = await verifyVoters(
        result?.precintNo,
        result?.firstName,
        result?.lastName
      );
      status = voters && voters?.id ? "AUTHENTIC" : "FAKE";
    } else {
      type = "UNKNOWN";
      throw new Error("Unrecognized document type");
    }

    delete data.type;
    const verification = await createVerification(type, userId, data, status);

    if (status === "AUTHENTIC") {
      return res.json({ success: true, data: verification });
    } else {
      return res.status(400).json({
        success: false,
        data: verification,
        message: "This is not authentic",
      });
    }
  } catch (err) {
    console.error(err);
    if (type && user) await createVerification(type, userId, {}, "ERROR");
    return res.status(500).json({
      success: false,
      message: err?.message || String(err),
    });
  }
}

export async function remove(req, res) {
  const { id } = req.params;
  let verification;
  try {
    // ensure the doc request exists
    verification = await getVerificationById(id);
    if (!verification) {
      return res
        .status(400)
        .json({ success: false, message: ERROR_VERIFICATION_NOT_FOUND });
    }

    await deleteVerification(id);
  } catch (error) {
    return res
      .status(400)
      .json({
        success: false,
        message: error.message || "Failed to delete Verification",
      });
  }
  return res.json({
    success: true,
    data: verification,
    message: "Verification deleted successfully!",
  });
}
