/**
 * 중앙 집중식 설정 관리
 * 서비스 전반에서 사용되는 설정 값들을 한 곳에서 관리
 */

export interface EmbeddingConfig {
  geminiEmbeddingModel: string;
  targetEmbeddingDimension: number;
  embeddingCacheSize: number;
  embeddingCacheTTL: number;
}

export interface AIModelConfig {
  geminiDefaultModel: string;
  geminiBaseUrl: string;
}

export interface TimeoutConfig {
  apiConnectionTest: number;
  embeddingGeneration: number;
  embeddingGenerationGemini: number;
  embeddingBatchGeneration: number;
  textExtraction: number;
  faqGeneration: number;
  documentAnalysis: number;
  semanticChunking: number;
  rateLimitDelay: number;
  batchProcessingDelay: number;
}

export interface SearchConfig {
  questionMatchBoost: number;
  answerMatchBoost: number;
  documentNameBoost: number;
  maxChunksPerSearch: number;
  minSimilarityThreshold: number;
}

export interface ChunkingConfig {
  defaultChunkSize: number;
  maxChunkSize: number;
  minChunkSize: number;
  semanticChunkOverlap: number;
}

export interface GenerationConfig {
  temperature: number;
  maxTokens: number;
  defaultFaqCount: number;
  minFaqCount: number;
  maxFaqCount: number;
}

export interface AppConfig {
  embedding: EmbeddingConfig;
  aiModel: AIModelConfig;
  timeout: TimeoutConfig;
  search: SearchConfig;
  chunking: ChunkingConfig;
  generation: GenerationConfig;
}

export const defaultConfig: AppConfig = {
  embedding: {
    geminiEmbeddingModel: 'text-embedding-004',
    targetEmbeddingDimension: 768,
    embeddingCacheSize: 500,
    embeddingCacheTTL: 30 * 60 * 1000,
  },
  aiModel: {
    geminiDefaultModel: 'gemini-2.0-flash',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  timeout: {
    apiConnectionTest: 5000,
    embeddingGeneration: 10000,
    embeddingGenerationGemini: 15000,
    embeddingBatchGeneration: 30000,
    textExtraction: 15000,
    faqGeneration: 25000,
    documentAnalysis: 15000,
    semanticChunking: 20000,
    rateLimitDelay: 100,
    batchProcessingDelay: 100,
  },
  search: {
    questionMatchBoost: 2.0,
    answerMatchBoost: 1.5,
    documentNameBoost: 1.2,
    maxChunksPerSearch: 10,
    minSimilarityThreshold: 0.7,
  },
  chunking: {
    defaultChunkSize: 300,
    maxChunkSize: 1500,
    minChunkSize: 100,
    semanticChunkOverlap: 50,
  },
  generation: {
    temperature: 0.7,
    maxTokens: 4000,
    defaultFaqCount: 5,
    minFaqCount: 1,
    maxFaqCount: 20,
  },
};

export const getConfig = (): AppConfig => {
  return defaultConfig;
};

export default defaultConfig;
