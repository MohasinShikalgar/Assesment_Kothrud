const Redis = require('ioredis');
const { createLogger } = require('./logger');

const logger = createLogger('redis');

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

let redisClient = null;
let isRedisConnected = false;
let redisError = null;

// In-memory fallback cache for when Redis server is offline
const memoryCache = new Map();

try {
  redisClient = new Redis({
    host: redisHost,
    port: redisPort,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => {
      if (times > 3) {
        return null; // Stop retrying immediately to avoid blocking
      }
      return 1000;
    },
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });

  redisClient.on('connect', () => {
    isRedisConnected = true;
    redisError = null;
    logger.info(`[Redis] Connected successfully to ${redisHost}:${redisPort}`);
  });

  redisClient.on('error', (err) => {
    isRedisConnected = false;
    redisError = err.message;
  });

  // Attempt initial quick connect
  redisClient.connect().catch((err) => {
    isRedisConnected = false;
    redisError = err.message;
    logger.warn(`[Redis] Server not reachable on ${redisHost}:${redisPort}. Using in-memory fallback cache.`);
  });
} catch (err) {
  isRedisConnected = false;
  redisError = err.message;
}

/**
 * Cache Set (Redis with in-memory fallback)
 */
async function setCache(key, value, ttlSeconds = 300) {
  const serialized = JSON.stringify(value);
  if (isRedisConnected && redisClient) {
    try {
      await redisClient.set(key, serialized, 'EX', ttlSeconds);
      return true;
    } catch (e) {
      // Fall through to memory
    }
  }
  memoryCache.set(key, {
    value: serialized,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  return true;
}

/**
 * Cache Get (Redis with in-memory fallback)
 */
async function getCache(key) {
  if (isRedisConnected && redisClient) {
    try {
      const data = await redisClient.get(key);
      if (data) return JSON.parse(data);
    } catch (e) {
      // Fall through to memory
    }
  }

  const cached = memoryCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return JSON.parse(cached.value);
}

/**
 * Cache Delete
 */
async function delCache(key) {
  if (isRedisConnected && redisClient) {
    try {
      await redisClient.del(key);
    } catch (e) {}
  }
  memoryCache.delete(key);
  return true;
}

/**
 * Health check for Redis
 */
async function checkRedisHealth() {
  if (!isRedisConnected || !redisClient) {
    return {
      status: 'DOWN',
      mode: 'IN_MEMORY_FALLBACK',
      host: redisHost,
      port: redisPort,
      error: redisError || 'Connection refused or not running',
      cachedKeys: memoryCache.size,
    };
  }
  try {
    const start = Date.now();
    await redisClient.ping();
    const latencyMs = Date.now() - start;
    return {
      status: 'UP',
      mode: 'REDIS_CLUSTER_STANDALONE',
      host: redisHost,
      port: redisPort,
      latencyMs,
    };
  } catch (err) {
    return {
      status: 'DOWN',
      mode: 'IN_MEMORY_FALLBACK',
      host: redisHost,
      port: redisPort,
      error: err.message,
      cachedKeys: memoryCache.size,
    };
  }
}

module.exports = {
  redisClient,
  setCache,
  getCache,
  delCache,
  checkRedisHealth,
  isRedisConnected: () => isRedisConnected,
};
