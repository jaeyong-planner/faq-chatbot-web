/**
 * Vector Search Service (Web Version)
 * Supabase pgvector RPC 함수 기반 벡터 검색
 * 클라이언트 코사인 유사도 → 서버사이드 pgvector HNSW 인덱스
 */

import { createLogger } from "./logger";
import type {
  FAQ,
  PDFDocument,
  PDFChunk,
  DocumentImage,
  DocumentGraph,
} from "../types";
import { embeddingService } from "./embeddingService";
import { supabase } from "./supabase/client";
import { getSupabaseDatabaseService } from "./supabase";

const log = createLogger("vectorSearch");

export interface VectorSearchResult {
  item: FAQ | PDFDocument | PDFChunk | DocumentImage | DocumentGraph;
  type: "faq" | "document" | "chunk" | "image" | "graph";
  similarity: number;
  score: number;
  sourceDocument?: PDFDocument;
}

/** FAQ 유사도 임계값 상수 */
export const FAQ_MIN_SIMILARITY = 0.45;
export const FAQ_HIGH_CONFIDENCE = 0.65;
export const FAQ_MEDIUM_CONFIDENCE = 0.45;

/**
 * 벡터 검색 서비스
 * Supabase pgvector RPC 함수를 사용하여 서버사이드 벡터 검색 수행
 */
export class VectorSearchService {
  private static instance: VectorSearchService;

  static getInstance(): VectorSearchService {
    if (!VectorSearchService.instance) {
      VectorSearchService.instance = new VectorSearchService();
    }
    return VectorSearchService.instance;
  }

  /**
   * 벡터 검색 (하이브리드: FAQ + 문서명 + 청크 + 이미지 + 그래프)
   * 원본 인터페이스 호환 (embeddingService 내부 사용)
   */
  async search(
    query: string,
    options: {
      limit?: number;
      minSimilarity?: number;
      includeFAQs?: boolean;
      includeDocuments?: boolean;
      includeChunks?: boolean;
      includeImages?: boolean;
      includeGraphs?: boolean;
    } = {},
  ): Promise<VectorSearchResult[]> {
    const {
      limit = 10,
      minSimilarity = FAQ_MIN_SIMILARITY,
      includeFAQs = true,
      includeDocuments = true,
      includeChunks = true,
      includeImages = true,
      includeGraphs = true,
    } = options;

    try {
      // 1. 질문 임베딩 생성
      let isHashEmbedding = false;
      const queryEmbedding = await Promise.race([
        embeddingService.generateEmbedding(query),
        new Promise<number[]>((_, reject) =>
          setTimeout(() => reject(new Error("임베딩 생성 타임아웃")), 10000),
        ),
      ]).catch(() => {
        log.warn("임베딩 생성 실패, 해시 기반 임베딩 사용");
        isHashEmbedding = true;
        return embeddingService.generateHashEmbedding(query);
      });

      if (embeddingService.lastEmbeddingWasHash) {
        isHashEmbedding = true;
      }

      // 해시 임베딩은 의미적 유사도를 반영하지 않으므로 키워드 매칭으로 전환
      if (isHashEmbedding) {
        log.warn("⚠️ 해시 기반 임베딩 사용 중 - 키워드 매칭으로 전환");
        return this.keywordOnlySearch(query, limit);
      }

      // 2. Supabase RPC 병렬 검색
      const searchPromises: Promise<VectorSearchResult[]>[] = [];
      const timeout = 5000;

      if (includeFAQs) {
        searchPromises.push(
          Promise.race([
            this.searchFAQs(queryEmbedding, query, minSimilarity, limit),
            new Promise<VectorSearchResult[]>((resolve) =>
              setTimeout(() => resolve([]), timeout),
            ),
          ]),
        );
      }

      if (includeDocuments) {
        searchPromises.push(
          Promise.race([
            this.searchDocuments(queryEmbedding, minSimilarity),
            new Promise<VectorSearchResult[]>((resolve) =>
              setTimeout(() => resolve([]), timeout),
            ),
          ]),
        );
      }

      if (includeChunks) {
        searchPromises.push(
          Promise.race([
            this.searchChunks(queryEmbedding, query, minSimilarity, limit),
            new Promise<VectorSearchResult[]>((resolve) =>
              setTimeout(() => resolve([]), timeout),
            ),
          ]),
        );
      }

      if (includeImages || includeGraphs) {
        searchPromises.push(
          Promise.race([
            this.searchMediaContent(
              queryEmbedding,
              includeImages,
              includeGraphs,
            ),
            new Promise<VectorSearchResult[]>((resolve) =>
              setTimeout(() => resolve([]), timeout),
            ),
          ]),
        );
      }

      const searchResults = await Promise.all(searchPromises);
      const results: VectorSearchResult[] = searchResults.flat();

      // 3. 유사도 기준 정렬 및 필터링
      return results
        .filter((result) => result.similarity >= minSimilarity)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (error) {
      log.error("벡터 검색 실패:", error);
      return [];
    }
  }

  /**
   * FAQ 검색 (pgvector RPC → 실패 시 클라이언트 사이드 코사인 유사도 Fallback)
   */
  private async searchFAQs(
    queryEmbedding: number[],
    queryText: string,
    threshold: number,
    maxResults: number,
  ): Promise<VectorSearchResult[]> {
    try {
      const queryLower = queryText.toLowerCase();
      const embeddingStr = `[${queryEmbedding.join(",")}]`;

      // 1차: RPC 함수 시도
      const [questionRes, answerRes] = await Promise.all([
        supabase.rpc("search_faqs_by_question", {
          query_embedding: embeddingStr,
          similarity_threshold: threshold,
          match_count: maxResults,
        }),
        supabase.rpc("search_faqs_by_answer", {
          query_embedding: embeddingStr,
          similarity_threshold: threshold,
          match_count: maxResults,
        }),
      ]);

      // RPC 함수가 존재하지 않으면 클라이언트 사이드 Fallback
      if (questionRes.error || answerRes.error) {
        log.warn("RPC 함수 호출 실패, 클라이언트 사이드 벡터 검색으로 전환");
        return this.searchFAQsClientSide(
          queryEmbedding,
          queryText,
          threshold,
          maxResults,
        );
      }

      const results: VectorSearchResult[] = [];
      const seenIds = new Set<number>();

      // 질문 매칭 결과 (가중치 높음)
      if (questionRes.data) {
        for (const row of questionRes.data) {
          let score = row.similarity * 1.2;

          if (row.semantic_keywords && Array.isArray(row.semantic_keywords)) {
            const keywordMatch = row.semantic_keywords.some((kw: string) =>
              queryLower.includes(kw.toLowerCase()),
            );
            if (keywordMatch) score *= 1.15;
          }
          if (row.generation_source === "semantic_analysis") score *= 1.1;
          if (row.confidence && row.confidence > 0) {
            score *= 0.8 + row.confidence * 0.2;
          }

          seenIds.add(row.id);
          results.push({
            item: this.mapFaqRow(row),
            type: "faq",
            similarity: row.similarity,
            score,
          });
        }
      }

      // 답변 매칭 결과 (가중치 낮음, 중복 제거)
      if (answerRes.data) {
        for (const row of answerRes.data) {
          if (seenIds.has(row.id)) {
            const existing = results.find(
              (r) => r.type === "faq" && (r.item as FAQ).id === row.id,
            );
            const answerScore = row.similarity * 0.8;
            if (existing && answerScore > existing.score) {
              existing.score = answerScore;
              existing.similarity = Math.max(
                existing.similarity,
                row.similarity,
              );
            }
            continue;
          }

          let score = row.similarity * 0.8;
          if (row.generation_source === "semantic_analysis") score *= 1.05;

          results.push({
            item: this.mapFaqRow(row),
            type: "faq",
            similarity: row.similarity,
            score,
          });
        }
      }

      return results;
    } catch (error) {
      log.error("FAQ RPC 검색 실패, 클라이언트 사이드 전환:", error);
      return this.searchFAQsClientSide(
        queryEmbedding,
        queryText,
        threshold,
        maxResults,
      );
    }
  }

  /**
   * FAQ 클라이언트 사이드 벡터 검색 (RPC 함수 미존재 시 Fallback)
   * 모든 FAQ를 가져와서 코사인 유사도를 직접 계산
   */
  private async searchFAQsClientSide(
    queryEmbedding: number[],
    queryText: string,
    threshold: number,
    maxResults: number,
  ): Promise<VectorSearchResult[]> {
    try {
      const dbService = getSupabaseDatabaseService();
      const allFAQs = await dbService.getAllFAQs();
      const activeFAQs = allFAQs.filter((faq) => faq.isActive);
      const queryLower = queryText.toLowerCase();
      const results: VectorSearchResult[] = [];

      for (const faq of activeFAQs) {
        let bestSimilarity = 0;
        let isQuestionMatch = false;

        // 질문 임베딩 유사도 계산
        if (faq.questionEmbedding && faq.questionEmbedding.length > 0) {
          const qSim = this.cosineSimilarity(
            queryEmbedding,
            faq.questionEmbedding,
          );
          if (qSim > bestSimilarity) {
            bestSimilarity = qSim;
            isQuestionMatch = true;
          }
        }

        // 답변 임베딩 유사도 계산
        if (faq.answerEmbedding && faq.answerEmbedding.length > 0) {
          const aSim = this.cosineSimilarity(
            queryEmbedding,
            faq.answerEmbedding,
          );
          if (aSim > bestSimilarity) {
            bestSimilarity = aSim;
            isQuestionMatch = false;
          }
        }

        if (bestSimilarity >= threshold) {
          let score = bestSimilarity * (isQuestionMatch ? 1.2 : 0.8);

          if (faq.semanticKeywords && Array.isArray(faq.semanticKeywords)) {
            const keywordMatch = faq.semanticKeywords.some((kw: string) =>
              queryLower.includes(kw.toLowerCase()),
            );
            if (keywordMatch) score *= 1.15;
          }

          if (faq.generationSource === "semantic_analysis") score *= 1.1;
          if (faq.confidence && faq.confidence > 0) {
            score *= 0.8 + faq.confidence * 0.2;
          }

          results.push({
            item: faq,
            type: "faq",
            similarity: bestSimilarity,
            score,
          });
        }
      }

      return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
    } catch (error) {
      log.error("클라이언트 사이드 FAQ 검색 실패:", error);
      return [];
    }
  }

  /**
   * 문서명 검색 (pgvector RPC → 실패 시 빈 배열)
   */
  private async searchDocuments(
    queryEmbedding: number[],
    threshold: number,
  ): Promise<VectorSearchResult[]> {
    try {
      const embeddingStr = `[${queryEmbedding.join(",")}]`;

      const { data, error } = await supabase.rpc("search_documents_by_name", {
        query_embedding: embeddingStr,
        similarity_threshold: threshold,
        match_count: 5,
      });

      if (error) {
        log.warn("문서 검색 RPC 오류 (함수 미존재 가능):", error.message);
        return [];
      }

      return (data || []).map((row: any) => ({
        item: {
          id: row.id,
          name: row.name,
          size: row.size,
          uploadDate: row.upload_date,
          status: row.status,
          uploadMode: row.upload_mode,
          filePath: row.file_path,
        } as PDFDocument,
        type: "document" as const,
        similarity: row.similarity,
        score: row.similarity * 1.0,
      }));
    } catch (error) {
      log.error("문서 검색 실패:", error);
      return [];
    }
  }

  /**
   * 청크 검색 (pgvector RPC → 실패 시 빈 배열)
   */
  private async searchChunks(
    queryEmbedding: number[],
    queryText: string,
    threshold: number,
    maxResults: number,
  ): Promise<VectorSearchResult[]> {
    try {
      const embeddingStr = `[${queryEmbedding.join(",")}]`;
      const queryLower = queryText.toLowerCase();

      const { data, error } = await supabase.rpc("search_chunks", {
        query_embedding: embeddingStr,
        similarity_threshold: threshold,
        match_count: maxResults,
      });

      if (error) {
        log.warn("청크 검색 RPC 오류 (함수 미존재 가능):", error.message);
        return [];
      }

      return (data || []).map((row: any) => {
        let score = row.similarity * 0.9;
        const metadata = row.metadata || {};

        if (metadata.importance === "high") score *= 1.2;
        else if (metadata.importance === "medium") score *= 1.05;

        if (metadata.chunkType === "page") score *= 1.15;
        else if (metadata.chunkType === "heading") score *= 1.1;

        if (metadata.keywords && Array.isArray(metadata.keywords)) {
          const keywordMatch = metadata.keywords.some((kw: string) =>
            queryLower.includes(kw.toLowerCase()),
          );
          if (keywordMatch) score *= 1.2;
        }

        return {
          item: {
            id: row.id,
            documentId: row.document_id,
            content: row.content,
            pageNumber: row.page_number,
            chunkIndex: row.chunk_index,
            metadata: row.metadata,
          } as PDFChunk,
          type: "chunk" as const,
          similarity: row.similarity,
          score,
        };
      });
    } catch (error) {
      log.error("청크 검색 실패:", error);
      return [];
    }
  }

  /**
   * 이미지/그래프 검색 (클라이언트 사이드, metadata JSONB 기반)
   */
  private async searchMediaContent(
    queryEmbedding: number[],
    includeImages: boolean,
    includeGraphs: boolean,
  ): Promise<VectorSearchResult[]> {
    try {
      const dbService = getSupabaseDatabaseService();
      const allDocuments = await dbService.getAllDocuments();
      const results: VectorSearchResult[] = [];

      for (const doc of allDocuments) {
        if (includeImages && doc.metadata?.images) {
          for (const image of doc.metadata.images) {
            if (image.embeddings && image.embeddings.length > 0) {
              const similarity = this.cosineSimilarity(
                queryEmbedding,
                image.embeddings,
              );
              if (similarity >= FAQ_MIN_SIMILARITY) {
                results.push({
                  item: image,
                  type: "image",
                  similarity,
                  score: similarity * 1.0,
                  sourceDocument: doc,
                });
              }
            }
          }
        }

        if (includeGraphs && doc.metadata?.graphs) {
          for (const graph of doc.metadata.graphs) {
            if (graph.embeddings && graph.embeddings.length > 0) {
              const similarity = this.cosineSimilarity(
                queryEmbedding,
                graph.embeddings,
              );
              if (similarity >= FAQ_MIN_SIMILARITY) {
                results.push({
                  item: graph,
                  type: "graph",
                  similarity,
                  score: similarity * 1.1,
                  sourceDocument: doc,
                });
              }
            }
          }
        }
      }

      return results;
    } catch (error) {
      log.error("미디어 검색 실패:", error);
      return [];
    }
  }

  /**
   * 키워드 완전 매칭 검색 (해시 임베딩 사용 시 Fallback)
   */
  private async keywordOnlySearch(
    queryText: string,
    limit: number,
  ): Promise<VectorSearchResult[]> {
    try {
      const dbService = getSupabaseDatabaseService();
      const allFAQs = await dbService.getAllFAQs();
      const activeFAQs = allFAQs.filter((faq) => faq.isActive);
      const queryLower = queryText.toLowerCase().trim();
      const results: VectorSearchResult[] = [];

      const queryWords = queryLower
        .split(/[\s,?!.]+/)
        .filter((w) => w.length >= 2);

      for (const faq of activeFAQs) {
        const questionLower = faq.question.toLowerCase();
        const answerLower = faq.answer.toLowerCase();
        let similarity = 0;

        // 직접 포함 매칭
        if (
          queryLower.length >= 3 &&
          (questionLower.includes(queryLower) ||
            queryLower.includes(questionLower))
        ) {
          const matchRatio =
            Math.min(queryLower.length, questionLower.length) /
            Math.max(queryLower.length, questionLower.length);
          similarity = Math.min(matchRatio * 1.2, 1.0);
        }

        // 단어 단위 매칭
        if (similarity === 0 && queryWords.length > 0) {
          const matchedWords = queryWords.filter(
            (w) => questionLower.includes(w) || answerLower.includes(w),
          );
          if (matchedWords.length > 0) {
            const wordRatio = matchedWords.length / queryWords.length;
            const charRatio =
              matchedWords.join("").length /
              queryLower.replace(/[\s,?!.]+/g, "").length;
            similarity = Math.min(
              (wordRatio * 0.6 + charRatio * 0.4) * 0.9,
              0.85,
            );
          }
        }

        // 의미 키워드 매칭
        if (
          similarity === 0 &&
          faq.semanticKeywords &&
          faq.semanticKeywords.length > 0
        ) {
          const keywordMatch = faq.semanticKeywords.some(
            (kw) => queryLower.includes(kw.toLowerCase()) && kw.length >= 2,
          );
          if (keywordMatch) similarity = 0.6;
        }

        // 카테고리 매칭
        if (
          similarity === 0 &&
          faq.category &&
          queryLower.includes(faq.category.toLowerCase()) &&
          faq.category.length >= 2
        ) {
          similarity = 0.5;
        }

        if (similarity >= FAQ_MIN_SIMILARITY) {
          results.push({
            item: faq,
            type: "faq",
            similarity,
            score: similarity,
          });
        }
      }

      return results.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch (error) {
      log.error("키워드 검색 실패:", error);
      return [];
    }
  }

  /**
   * 가장 유사한 FAQ 찾기
   */
  async findBestFAQ(query: string): Promise<FAQ | null> {
    const results = await this.search(query, {
      limit: 1,
      includeDocuments: false,
      includeChunks: false,
      includeImages: false,
      includeGraphs: false,
      minSimilarity: FAQ_MIN_SIMILARITY,
    });

    if (results.length > 0 && results[0].type === "faq") {
      return results[0].item as FAQ;
    }

    return null;
  }

  /** RPC 결과를 FAQ 타입으로 변환 */
  private mapFaqRow(row: any): FAQ {
    return {
      id: row.id,
      question: row.question,
      answer: row.answer,
      category: row.category,
      isActive: row.is_active,
      isFeatured: row.is_featured,
      semanticKeywords: row.semantic_keywords,
      confidence: row.confidence,
      generationSource: row.generation_source,
      documentId: row.document_id,
      imageUrl: "",
      linkUrl: "",
      attachmentUrl: "",
      attachmentName: "",
    };
  }

  /** 코사인 유사도 (이미지/그래프 검색용 클라이언트 Fallback) */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      magnitude1 += vec1[i] * vec1[i];
      magnitude2 += vec2[i] * vec2[i];
    }

    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    if (magnitude1 === 0 || magnitude2 === 0) return 0;

    return dotProduct / (magnitude1 * magnitude2);
  }
}

export const vectorSearchService = VectorSearchService.getInstance();
