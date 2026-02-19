/**
 * Embedding Service (Web Version)
 * WebGeminiService를 통해 서버사이드 Gemini API로 임베딩 생성
 * Gemini 실패 시 해시 기반 Fallback, LRU 캐시 적용
 */

import { createLogger } from './logger';
import type { GeminiAPIConfig } from '../types';
import { defaultConfig } from './config';
import { WebGeminiService } from './WebGeminiService';

interface CacheEntry {
  embedding: number[];
  timestamp: number;
}

const log = createLogger('embedding');

class LRUCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number, ttl: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: string): number[] | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // LRU: 접근한 항목을 맨 뒤로 이동
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.embedding;
  }

  set(key: string, embedding: number[]): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      embedding,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * 임베딩 서비스
 * WebGeminiService (Vercel Functions)를 통해 서버사이드에서 임베딩 생성
 * API 키는 서버에만 보관 (클라이언트 노출 없음)
 */
export class EmbeddingService {
  private static instance: EmbeddingService;
  private geminiActive: boolean = true;
  private embeddingDimension: number = defaultConfig.embedding.targetEmbeddingDimension;
  private embeddingCache: LRUCache;
  /** 마지막 generateEmbedding 호출이 해시 기반이었는지 여부 */
  public lastEmbeddingWasHash: boolean = false;

  private constructor() {
    this.embeddingCache = new LRUCache(
      defaultConfig.embedding.embeddingCacheSize,
      defaultConfig.embedding.embeddingCacheTTL
    );
  }

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Gemini 설정 (호환성 유지)
   * Web 버전에서는 isActive 플래그만 사용 (API 키는 서버 전용)
   */
  setGeminiConfig(config: GeminiAPIConfig | { isActive: boolean }) {
    this.geminiActive = config.isActive;
  }

  /**
   * 텍스트의 해시값 생성 (캐시 키로 사용)
   */
  private hashText(text: string): string {
    const trimmed = text.trim();
    let hash = 0;
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * 단일 텍스트 임베딩 생성
   * WebGeminiService → 해시 기반 Fallback
   * LRU 캐시 적용
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('텍스트가 비어있습니다.');
    }

    // 캐시 확인
    const cacheKey = this.hashText(text);
    const cached = this.embeddingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Gemini 시도 (서버사이드 Vercel Function 호출)
    if (this.geminiActive) {
      try {
        const gemini = WebGeminiService.getInstance();
        const embedding = await gemini.generateEmbedding(text.trim());

        if (Array.isArray(embedding) && embedding.length > 0) {
          if (this.embeddingDimension !== embedding.length) {
            log.warn(`임베딩 차원 불일치: 설정=${this.embeddingDimension}, 응답=${embedding.length}`);
          }
          this.embeddingCache.set(cacheKey, embedding);
          this.lastEmbeddingWasHash = false;
          return embedding;
        }
        throw new Error('임베딩 응답이 비어있습니다.');
      } catch (error: any) {
        log.warn('Gemini 임베딩 생성 실패, 해시 기반 임베딩으로 전환:', error.message);
      }
    }

    // Fallback: 해시 기반 임베딩
    const embedding = this.generateHashEmbedding(text);
    this.embeddingCache.set(cacheKey, embedding);
    this.lastEmbeddingWasHash = true;
    return embedding;
  }

  /**
   * 배치 임베딩 생성 (여러 텍스트를 한 번에 처리)
   * WebGeminiService → 해시 기반 Fallback
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Gemini 시도 (서버사이드 배치 엔드포인트)
    if (this.geminiActive) {
      try {
        const gemini = WebGeminiService.getInstance();
        const trimmedTexts = texts.map(t => t.trim());
        const embeddings = await gemini.generateBatchEmbeddings(trimmedTexts);

        // 캐시에 저장
        embeddings.forEach((emb, i) => {
          const cacheKey = this.hashText(texts[i]);
          this.embeddingCache.set(cacheKey, emb);
        });

        this.lastEmbeddingWasHash = false;
        return embeddings;
      } catch (error: any) {
        log.warn('Gemini 배치 임베딩 생성 실패, 해시 기반 임베딩으로 전환:', error.message);
      }
    }

    // Fallback: 해시 기반 임베딩
    this.lastEmbeddingWasHash = true;
    return texts.map(text => this.generateHashEmbedding(text));
  }

  /**
   * 해시 기반 임베딩 (Fallback, 개발/테스트용)
   */
  generateHashEmbedding(text: string): number[] {
    const hash = this.simpleHash(text);
    const embedding: number[] = [];

    for (let i = 0; i < this.embeddingDimension; i++) {
      const seed = hash + i;
      const value = Math.sin(seed) * 0.5 + 0.5;
      embedding.push(value);
    }

    return this.normalizeVector(embedding);
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) {
      return vector;
    }
    return vector.map(val => val / magnitude);
  }

  getEmbeddingDimension(): number {
    return this.embeddingDimension;
  }

  getCurrentModel(): 'gemini' | 'hash' {
    return this.geminiActive ? 'gemini' : 'hash';
  }

  getCacheStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.embeddingCache.size(),
      maxSize: defaultConfig.embedding.embeddingCacheSize,
      ttl: defaultConfig.embedding.embeddingCacheTTL,
    };
  }

  clearCache(): void {
    this.embeddingCache.clear();
  }
}

export const embeddingService = EmbeddingService.getInstance();
