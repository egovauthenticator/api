import { getCache } from "../config/cache.js"
import {
  getAllAPIKey,
  getAPIKey,
  getById,
  addAPIKey,
  addUsage,
  markAsExpired,
} from "../services/api-key-management.service.js";

const getCacheKey = (base, userId) => `${base}${userId ? userId : "anonymous"}`;
// Cache (TTL = 60s)
const cache = getCache("apiKey", { stdTTL: 60, checkperiod: 120 });
const isTruthy = (v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["true", "1", "yes", "y"].includes(v.toLowerCase());
  if (typeof v === "number") return v === 1;
  return false;
};

// Cache keys
const KEY_ALL = "apiKey:all";
const KEY_SINGLE_PREFIX = "apiKey:single:";

// Helper: identify if a cached object matches an id (supports common field names)
const objectMatchesId = (obj, id) => {
  if (!obj || !id) return false;
  return [ "id", "apiKeyId", "keyId", "api_key_id" ].some(k => String(obj?.[k] ?? "") === String(id));
};


// 🟩 Get single API key (per-user cache; supports refresh)
export async function get(req, res) {
  const userId = req.headers["userid"]; // optional; per-user scope
  const refresh = isTruthy(req.query.refresh);
  const name = req.query?.name;
  const cacheKey = getCacheKey(KEY_SINGLE_PREFIX, userId);

  if(!name) {
    return res
      .status(400)
      .json({ success: false, message: "Missing name query" });
  }

  try {
    let fromCache = cache.get(cacheKey);
    let data;

    if (refresh || !fromCache) {
      data = await getAPIKey(name);
      cache.set(cacheKey, data);
      return res.json({
        success: true,
        cached: false,
        refreshed: !!refresh,
        userId,
        data,
      });
    }

    // serve cached
    data = fromCache;
    return res.json({
      success: true,
      cached: true,
      refreshed: false,
      userId,
      data,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

// 🟦 Get all API keys (global cache; no userId)
export async function getAll(req, res) {
  try {
    let all = cache.get(KEY_ALL);
    if (!all) {
      all = await getAllAPIKey();
      cache.set(KEY_ALL, all);
      return res.json({ success: true, cached: false, data: all });
    }
    return res.json({ success: true, cached: true, data: all });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

// 🟨 Create API key (no userId required). Invalidate global list.
export async function create(req, res) {
  const { email, name, apiKey } = req.body;
  try {
    const created = await addAPIKey(email, name, apiKey);

    // Invalidate global list cache
    cache.del(KEY_ALL);

    return res.json({ success: true, data: created });
  } catch (error) {
    const msg = String(error?.message || "");
    if (msg.toLowerCase().includes("duplicate") && msg.toLowerCase().includes("violates")) {
      return res.status(400).json({ success: false, message: "API Key already exists" });
    }
    return res.status(400).json({ success: false, message: error.message });
  }
}

export async function usage(req, res) {
  const id = req.params.id;

  try {
    let existing = await getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "API Key not found" });
    }

    const updated = await addUsage(id);

    // Invalidate global list
    cache.del(KEY_ALL);

    // Invalidate all per-user single caches that reference this ID
    const keys = cache.keys().filter(k => k.startsWith(KEY_SINGLE_PREFIX));
    const keysToDelete = [];
    for (const k of keys) {
      const val = cache.get(k);
      if (objectMatchesId(val, id)) {
        keysToDelete.push(k);
      }
    }
    if (keysToDelete.length) cache.del(keysToDelete);

    return res.json({ success: true, data: updated });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
}

// 🟥 Mark API key as expired
// - persist change
// - invalidate global list cache
// - invalidate every user's single cache that contains this ID
export async function expired(req, res) {
  const id = req.params.id;

  try {
    let existing = await getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "API Key not found" });
    }

    const updated = await markAsExpired(id);

    // Invalidate global list
    cache.del(KEY_ALL);

    // Invalidate all per-user single caches that reference this ID
    const keys = cache.keys().filter(k => k.startsWith(KEY_SINGLE_PREFIX));
    const keysToDelete = [];
    for (const k of keys) {
      const val = cache.get(k);
      if (objectMatchesId(val, id)) {
        keysToDelete.push(k);
      }
    }
    if (keysToDelete.length) cache.del(keysToDelete);

    return res.json({ success: true, data: updated });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
}
