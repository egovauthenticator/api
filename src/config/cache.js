// src/config/cache.js
import NodeCache from 'node-cache';

const defaultConfig = {
  stdTTL: 3600,
  checkperiod: 120,
};

// Internal registry: name -> NodeCache instance
const registry = new Map();

/**
 * Get (or create) a named cache instance.
 *
 * - name: logical name of the cache (e.g., "users", "reports")
 * - config: optional overrides for this cache (only used on first creation)
 */
export function getCache(name = 'default', config = {}) {
  if (registry.has(name)) {
    return registry.get(name);
  }

  const instance = new NodeCache({
    ...defaultConfig,
    ...config,
  });

  registry.set(name, instance);
  return instance;
}

/** Flush all entries of a specific cache (by name) */
export function flushCache(name) {
  const cache = registry.get(name);
  if (cache) {
    cache.flushAll();
  }
}

/** Flush all entries in all caches */
export function flushAllCaches() {
  for (const cache of registry.values()) {
    cache.flushAll();
  }
}

/** Optional: list all cache names (for debugging/admin UI) */
export function listCaches() {
  return Array.from(registry.keys());
}
