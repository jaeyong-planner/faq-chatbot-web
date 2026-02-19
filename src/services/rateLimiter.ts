/**
 * Rate Limiter Service
 * Token bucket algorithm for API rate limiting
 */

import { createLogger } from "./logger";
type Provider = "gemini" | "openai";

interface TokenBucket {
  tokens: number;
  maxTokens: number;
  refillRate: number;
  lastRefill: number;
}

const log = createLogger("rateLimiter");
class RateLimiter {
  private buckets: Map<Provider, TokenBucket> = new Map();

  constructor() {
    this.buckets.set("gemini", {
      tokens: 10,
      maxTokens: 10,
      refillRate: 10,
      lastRefill: Date.now(),
    });

    this.buckets.set("openai", {
      tokens: 20,
      maxTokens: 20,
      refillRate: 20,
      lastRefill: Date.now(),
    });
  }

  private refillTokens(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsedMinutes = (now - bucket.lastRefill) / 60000;

    if (elapsedMinutes > 0) {
      const tokensToAdd = Math.floor(elapsedMinutes * bucket.refillRate);
      bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }

  checkRateLimit(provider: Provider): boolean {
    const bucket = this.buckets.get(provider);

    if (!bucket) {
      log.error(`Unknown provider: ${provider}`);
      return false;
    }

    this.refillTokens(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  getRemainingTokens(provider: Provider): number {
    const bucket = this.buckets.get(provider);
    if (!bucket) return 0;
    this.refillTokens(bucket);
    return Math.floor(bucket.tokens);
  }

  getTimeUntilRefill(provider: Provider): number {
    const bucket = this.buckets.get(provider);
    if (!bucket) return 0;

    const now = Date.now();
    const elapsedMs = now - bucket.lastRefill;
    const msPerToken = 60000 / bucket.refillRate;
    const nextRefillMs = msPerToken - (elapsedMs % msPerToken);

    return Math.ceil(nextRefillMs / 1000);
  }

  reset(provider: Provider): void {
    const bucket = this.buckets.get(provider);
    if (bucket) {
      bucket.tokens = bucket.maxTokens;
      bucket.lastRefill = Date.now();
    }
  }
}

const rateLimiterInstance = new RateLimiter();

export function checkRateLimit(provider: Provider): boolean {
  return rateLimiterInstance.checkRateLimit(provider);
}

export function getRemainingTokens(provider: Provider): number {
  return rateLimiterInstance.getRemainingTokens(provider);
}

export function getTimeUntilRefill(provider: Provider): number {
  return rateLimiterInstance.getTimeUntilRefill(provider);
}

export function resetRateLimit(provider: Provider): void {
  rateLimiterInstance.reset(provider);
}

export default rateLimiterInstance;
