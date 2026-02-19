/**
 * Web Gemini Service
 * Vercel Serverless Functions를 호출하는 클라이언트 서비스
 * ElectronGeminiService와 동일한 인터페이스 제공 (싱글톤)
 */

import { supabase } from "./supabase/client";
import type { GeminiAPIConfig } from "../types";

interface DocumentAnalysisResult {
  summary: string;
  keyTopics: string[];
  suggestedFAQs: Array<{
    question: string;
    answer: string;
    category: string;
  }>;
  chunks: Array<{
    title: string;
    content: string;
    summary: string;
    importance: string;
    keywords: string[];
  }>;
}

interface GenerateResponseResult {
  text: string;
  sources: Array<{
    documentName: string;
    pageNumber: number;
    relevance: number;
  }>;
}

export interface ContextItem {
  content: string;
  source: string;
  similarity: number;
}

interface ConversationMessage {
  role: string;
  content: string;
}

export class WebGeminiService {
  private static instance: WebGeminiService;
  private baseUrl: string = "/api/gemini";
  private config: GeminiAPIConfig = {
    apiKey: "",
    isActive: false,
    model: "",
    baseUrl: "",
  };

  private constructor() {
    // 싱글톤 패턴
  }

  /**
   * UI 상태 관리용 config (실제 API 키는 서버 환경변수)
   */
  setConfig(config: GeminiAPIConfig): void {
    this.config = { ...config };
  }

  getConfig(): GeminiAPIConfig {
    return { ...this.config };
  }

  static getInstance(): WebGeminiService {
    if (!WebGeminiService.instance) {
      WebGeminiService.instance = new WebGeminiService();
    }
    return WebGeminiService.instance;
  }

  /**
   * Supabase 세션에서 JWT 토큰 가져오기
   */
  private async getAuthToken(): Promise<string> {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      throw new Error(`Failed to get session: ${error.message}`);
    }

    if (!session) {
      throw new Error("No active session. Please login first.");
    }

    return session.access_token;
  }

  /**
   * API 요청 헬퍼
   */
  private async makeRequest<T>(
    endpoint: string,
    method: "GET" | "POST",
    body?: any,
    timeout: number = 30000,
  ): Promise<T> {
    try {
      const token = await this.getAuthToken();
      const url = `${this.baseUrl}${endpoint}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const options: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      };

      if (method === "POST" && body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // JSON 파싱 실패 시 기본 메시지 사용
        }

        // HTTP 상태별 에러 처리
        if (response.status === 401) {
          throw new Error("Authentication failed. Please login again.");
        } else if (response.status === 403) {
          throw new Error("Permission denied. Invalid credentials.");
        } else if (response.status === 429) {
          throw new Error("API rate limit exceeded. Please try again later.");
        } else if (response.status === 504) {
          throw new Error("Request timeout. Please try again.");
        } else if (response.status >= 500) {
          throw new Error("Server error. Please try again later.");
        }

        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error: any) {
      // AbortController 타임아웃 처리
      if (error.name === "AbortError") {
        throw new Error(`Request timeout (${timeout / 1000}s)`);
      }

      // 네트워크 오류
      if (
        error.message?.includes("fetch") ||
        error.message?.includes("network")
      ) {
        throw new Error(
          "Network error. Please check your internet connection.",
        );
      }

      // 기타 에러는 그대로 전달
      throw error;
    }
  }

  /**
   * Gemini 연결 테스트
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.makeRequest<{
        success: boolean;
        message: string;
      }>("/test-connection", "GET", undefined, 10000);
      return result;
    } catch (error: any) {
      return {
        success: false,
        message: error.message || "Connection test failed",
      };
    }
  }

  /**
   * 단일 텍스트 임베딩 생성
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const result = await this.makeRequest<{ embedding: number[] }>(
      "/generate-embedding",
      "POST",
      { text },
      15000,
    );

    return result.embedding;
  }

  /**
   * 배치 임베딩 생성
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    const result = await this.makeRequest<{ embeddings: number[][] }>(
      "/generate-batch-embeddings",
      "POST",
      { texts },
      30000,
    );

    return result.embeddings;
  }

  /**
   * 문서 분석 및 FAQ 자동 생성
   */
  async analyzeDocument(
    documentText: string,
    documentName?: string,
  ): Promise<DocumentAnalysisResult> {
    const result = await this.makeRequest<DocumentAnalysisResult>(
      "/analyze-document",
      "POST",
      { documentText, documentName },
      45000,
    );

    return result;
  }

  /**
   * RAG 기반 대화 생성
   */
  async generateResponse(
    question: string,
    context: ContextItem[],
    conversationHistory?: ConversationMessage[],
  ): Promise<GenerateResponseResult> {
    const result = await this.makeRequest<GenerateResponseResult>(
      "/generate-response",
      "POST",
      { question, context, conversationHistory },
      30000,
    );

    return result;
  }
}

// 싱글톤 인스턴스 내보내기
export const webGeminiService = WebGeminiService.getInstance();
