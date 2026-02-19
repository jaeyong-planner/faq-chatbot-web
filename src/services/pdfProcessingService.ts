/**
 * PDF Processing Service (Web Version)
 * Supabase Storage + WebGeminiService (Vercel Functions) 기반
 * Electron IPC → Web API 전환
 */

import { createLogger } from "./logger";
import type {
  PDFDocument,
  PDFChunk,
  FAQ,
  GeminiAPIConfig,
  DocumentUploadProgress,
  DocumentImage,
  DocumentGraph,
} from "../types";
import {
  getSupabaseDatabaseService,
  getSupabaseStorageService,
} from "./supabase";
import { WebGeminiService } from "./WebGeminiService";
import * as pdfjsLib from "pdfjs-dist";
import { defaultConfig } from "./config";

const log = createLogger("pdfProcessing");

export class PDFProcessingService {
  private static instance: PDFProcessingService;
  private geminiActive: boolean = false;
  private faqCount: number = defaultConfig.generation.defaultFaqCount;

  static getInstance(): PDFProcessingService {
    if (!PDFProcessingService.instance) {
      PDFProcessingService.instance = new PDFProcessingService();
    }
    return PDFProcessingService.instance;
  }

  /**
   * Gemini 설정 (호환성 유지)
   * Web 버전에서는 isActive 플래그만 사용 (API 키는 서버 전용)
   */
  async setGeminiConfig(config: GeminiAPIConfig | { isActive: boolean }) {
    this.geminiActive = config.isActive;
  }

  getGeminiConfig(): GeminiAPIConfig {
    return {
      apiKey: "",
      isActive: this.geminiActive,
      model: defaultConfig.aiModel.geminiDefaultModel,
      baseUrl: defaultConfig.aiModel.geminiBaseUrl,
    };
  }

  setFaqCount(count: number) {
    if (
      count >= defaultConfig.generation.minFaqCount &&
      count <= defaultConfig.generation.maxFaqCount
    ) {
      this.faqCount = count;
    }
  }

  getFaqCount(): number {
    return this.faqCount;
  }

  /**
   * localStorage에서 Gemini 설정 로드
   */
  private loadGeminiConfigFromSettings(): void {
    try {
      const savedConfig = localStorage.getItem("system-gemini-config");
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        this.geminiActive = parsed.isActive === true;
      }
    } catch (error) {
      log.error("Failed to load Gemini config from settings:", error);
    }
  }

  /**
   * PDF 처리 파이프라인
   * 1. Supabase Storage 업로드
   * 2. PDF.js 텍스트 추출 (클라이언트)
   * 3. Gemini 문서 분석 (서버, Vercel Function)
   * 4. Supabase DB 저장
   */
  async processGeneralPDF(
    file: File,
    onProgress: (progress: DocumentUploadProgress) => void,
  ): Promise<PDFDocument> {
    const documentId = Date.now();

    try {
      this.loadGeminiConfigFromSettings();
      const geminiService = WebGeminiService.getInstance();
      const dbService = getSupabaseDatabaseService();
      const storageService = getSupabaseStorageService();

      // Stage 1: Upload to Supabase Storage
      onProgress({
        documentId,
        fileName: file.name,
        progress: 10,
        stage: "uploading",
      });

      let filePath: string | undefined;
      let filePublicUrl: string | undefined;
      try {
        const uploadResult = await storageService.upload(file);
        filePath = uploadResult.path;
        filePublicUrl = uploadResult.publicUrl;
        log.debug(`✅ 파일 업로드 완료: ${filePath}`);
      } catch (error) {
        log.warn("파일 업로드 실패, 계속 진행:", error);
      }

      // Stage 2: Processing - PDF.js 텍스트 추출
      onProgress({
        documentId,
        fileName: file.name,
        progress: 30,
        stage: "processing",
      });

      const { text: extractedText, numPages } =
        await this.extractTextAndPageCount(file);
      const originalOcrText = extractedText;

      // Stage 3: AI-powered 문서 분석 (Vercel Function)
      onProgress({
        documentId,
        fileName: file.name,
        progress: 40,
        stage: "extracting",
      });

      let chunks: PDFChunk[];
      let generatedFaqs: FAQ[];
      let usedAI = "none";

      if (this.geminiActive) {
        try {
          // analyzeDocument: 텍스트 향상 + 스마트 청킹 + FAQ 생성 통합
          const analysisResult = await geminiService.analyzeDocument(
            extractedText,
            file.name,
          );
          usedAI = "gemini";

          // Stage 4: Chunking (서버에서 이미 완료)
          onProgress({
            documentId,
            fileName: file.name,
            progress: 65,
            stage: "chunking",
          });

          // 분석 결과를 PDFChunk 타입으로 변환
          chunks = analysisResult.chunks.map((chunk, index) => ({
            id: index + 1,
            documentId,
            content: chunk.content,
            pageNumber: 1,
            chunkIndex: index,
            metadata: {
              title: chunk.title,
              summary: chunk.summary,
              importance: (["high", "medium", "low"].includes(chunk.importance)
                ? chunk.importance
                : "medium") as "high" | "medium" | "low",
              keywords: chunk.keywords,
              chunkType: "content" as const,
            },
          }));

          // Stage 5: FAQ 생성 (서버에서 이미 완료)
          onProgress({
            documentId,
            fileName: file.name,
            progress: 85,
            stage: "generating_faqs",
          });

          // 분석 결과를 FAQ 타입으로 변환
          generatedFaqs = analysisResult.suggestedFAQs.map((faq, index) => ({
            id: Date.now() + index,
            question: faq.question,
            answer: faq.answer,
            category: faq.category || "일반",
            isActive: true,
            imageUrl: "",
            linkUrl: "",
            attachmentUrl: filePublicUrl || "",
            attachmentName: file.name,
            documentId,
          }));

          log.debug(
            `✓ Gemini 문서 분석 성공: ${file.name} (${chunks.length}개 청크, ${generatedFaqs.length}개 FAQ)`,
          );
        } catch (error: any) {
          log.warn(
            `⚠ Gemini 문서 분석 실패 (${error.message}), 기본 처리 사용:`,
            error,
          );
          chunks = this.createChunks(extractedText, documentId);
          generatedFaqs = [];
          usedAI = "basic";

          onProgress({
            documentId,
            fileName: file.name,
            progress: 65,
            stage: "chunking",
          });

          onProgress({
            documentId,
            fileName: file.name,
            progress: 85,
            stage: "generating_faqs",
          });
        }
      } else {
        chunks = this.createChunks(extractedText, documentId);
        generatedFaqs = [];
        usedAI = "basic";
        log.debug(`ℹ 기본 처리 사용: ${file.name}`);

        onProgress({
          documentId,
          fileName: file.name,
          progress: 65,
          stage: "chunking",
        });

        onProgress({
          documentId,
          fileName: file.name,
          progress: 85,
          stage: "generating_faqs",
        });
      }

      const metadata = {
        pages: numPages,
        textContent: extractedText,
        images: [] as DocumentImage[],
        graphs: [] as DocumentGraph[],
        tables: [],
      };

      log.debug(`\n📊 PDF 처리 완료 요약: ${file.name}`);
      log.debug(`   - AI 분석: ${usedAI === "gemini" ? "Gemini" : "기본"}`);
      log.debug(`   - 청크: ${chunks.length}개`);
      log.debug(`   - FAQ: ${generatedFaqs.length}개`);

      // Stage 6: Save to Supabase DB
      onProgress({
        documentId,
        fileName: file.name,
        progress: 95,
        stage: "completed",
      });

      const documentData = {
        name: file.name,
        size: this.formatFileSize(file.size),
        uploadDate: new Date().toISOString().split("T")[0],
        status: "completed" as const,
        uploadMode: "general" as const,
        filePath,
        ocrText: originalOcrText,
        metadata,
      };

      try {
        const savedDocument = await dbService.createDocumentWithChunksAndFAQs(
          documentData,
          chunks.map((chunk) => ({
            content: chunk.content,
            pageNumber: chunk.pageNumber,
            chunkIndex: chunk.chunkIndex,
            embeddings: chunk.embeddings,
            metadata: chunk.metadata,
          })),
          generatedFaqs.map((faq) => ({
            question: faq.question,
            answer: faq.answer,
            category: faq.category,
            isActive: faq.isActive,
            imageUrl: faq.imageUrl,
            linkUrl: faq.linkUrl,
            attachmentUrl: faq.attachmentUrl,
            attachmentName: faq.attachmentName,
          })),
        );

        // Stage 7: Completed
        onProgress({
          documentId,
          fileName: file.name,
          progress: 100,
          stage: "completed",
        });

        return savedDocument;
      } catch (dbError) {
        log.error("Database save failed:", dbError);
        onProgress({
          documentId,
          fileName: file.name,
          progress: 100,
          stage: "completed",
        });

        return {
          id: documentId,
          name: file.name,
          size: this.formatFileSize(file.size),
          uploadDate: new Date().toISOString().split("T")[0],
          status: "completed",
          uploadMode: "general",
          filePath,
          ocrText: originalOcrText,
          metadata,
          chunks,
          generatedFaqs,
        };
      }
    } catch (error) {
      onProgress({
        documentId,
        fileName: file.name,
        progress: 0,
        stage: "error",
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
      throw error;
    }
  }

  /**
   * 이미지 처리 파이프라인
   */
  async processGeneralImage(
    file: File,
    onProgress: (progress: DocumentUploadProgress) => void,
  ): Promise<PDFDocument> {
    const documentId = Date.now();

    try {
      this.loadGeminiConfigFromSettings();
      const dbService = getSupabaseDatabaseService();
      const storageService = getSupabaseStorageService();

      // Stage 1: Upload
      onProgress({
        documentId,
        fileName: file.name,
        progress: 10,
        stage: "uploading",
      });

      // Supabase Storage에 업로드
      let imageUrl = "";
      let filePath: string | undefined;
      try {
        const uploadResult = await storageService.upload(file);
        imageUrl = uploadResult.publicUrl;
        filePath = uploadResult.path;
        log.debug(`✓ 이미지 파일 업로드 완료: ${imageUrl}`);
      } catch (error) {
        log.warn("이미지 업로드 실패, blob URL 사용:", error);
        imageUrl = URL.createObjectURL(file);
      }

      // Stage 2: Processing
      onProgress({
        documentId,
        fileName: file.name,
        progress: 30,
        stage: "processing",
      });

      await this.delay(300);

      // Stage 3: AI Image Analysis (미래 확장 가능)
      onProgress({
        documentId,
        fileName: file.name,
        progress: 50,
        stage: "extracting",
      });

      const description = `Image: ${file.name}`;

      const metadata = {
        pages: 1,
        textContent: description,
        images: [
          { url: imageUrl, fileName: file.name, description: file.name },
        ] as DocumentImage[],
        graphs: [] as DocumentGraph[],
        tables: [],
        imageData: {
          width: 0,
          height: 0,
          format: file.type,
        },
      };

      // Stage 4: Create single chunk for image
      onProgress({
        documentId,
        fileName: file.name,
        progress: 70,
        stage: "chunking",
      });

      const chunks: PDFChunk[] = [
        {
          id: Date.now(),
          documentId,
          content: description,
          pageNumber: 1,
          chunkIndex: 0,
          embeddings: [],
          metadata: { type: "image", imageUrl },
        },
      ];

      // Stage 5: Generate FAQs
      onProgress({
        documentId,
        fileName: file.name,
        progress: 85,
        stage: "generating_faqs",
      });

      const generatedFaqs: FAQ[] = this.generateImageFAQs(
        description,
        file.name,
        imageUrl,
      );

      // Stage 6: Save to database
      onProgress({
        documentId,
        fileName: file.name,
        progress: 95,
        stage: "completed",
      });

      const documentData = {
        name: file.name,
        size: this.formatFileSize(file.size),
        uploadDate: new Date().toISOString().split("T")[0],
        status: "completed" as const,
        uploadMode: "general" as const,
        filePath,
        metadata,
      };

      try {
        const savedDocument = await dbService.createDocumentWithChunksAndFAQs(
          documentData,
          chunks.map((chunk) => ({
            content: chunk.content,
            pageNumber: chunk.pageNumber,
            chunkIndex: chunk.chunkIndex,
            embeddings: chunk.embeddings,
            metadata: chunk.metadata,
          })),
          generatedFaqs.map((faq) => ({
            question: faq.question,
            answer: faq.answer,
            category: faq.category,
            isActive: faq.isActive,
            imageUrl: faq.imageUrl,
            linkUrl: faq.linkUrl,
            attachmentUrl: faq.attachmentUrl,
            attachmentName: faq.attachmentName,
          })),
        );

        onProgress({
          documentId,
          fileName: file.name,
          progress: 100,
          stage: "completed",
        });

        return savedDocument;
      } catch (dbError) {
        log.error("Database save failed:", dbError);
        onProgress({
          documentId,
          fileName: file.name,
          progress: 100,
          stage: "completed",
        });

        return {
          id: documentId,
          name: file.name,
          size: this.formatFileSize(file.size),
          uploadDate: new Date().toISOString().split("T")[0],
          status: "completed",
          uploadMode: "general",
          metadata,
          chunks,
          generatedFaqs,
        };
      }
    } catch (error) {
      onProgress({
        documentId,
        fileName: file.name,
        progress: 0,
        stage: "error",
        error:
          error instanceof Error
            ? error.message
            : "이미지 처리에 실패했습니다.",
      });
      throw error;
    }
  }

  /**
   * 이미지 기본 FAQ 생성
   */
  private generateImageFAQs(
    description: string,
    fileName: string,
    imageUrl: string,
  ): FAQ[] {
    if (!description || description.trim().length === 0) {
      return [];
    }
    return [
      {
        id: Date.now(),
        question: `${fileName} 이미지에 대해 설명해주세요.`,
        answer: description,
        category: "일반",
        isActive: true,
        imageUrl: imageUrl,
        linkUrl: "",
        attachmentUrl: "",
        attachmentName: "",
      },
    ];
  }

  /**
   * PDF에서 텍스트와 페이지 수를 함께 추출 (pdfjs-dist)
   */
  private async extractTextAndPageCount(
    file: File,
  ): Promise<{ text: string; numPages: number }> {
    try {
      if (typeof window !== "undefined") {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      }

      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
      const pdfDocument = await loadingTask.promise;

      let fullText = "";

      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();

        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(" ");

        fullText += pageText + "\n\n";
      }

      if (!fullText.trim()) {
        throw new Error(
          "PDF에서 텍스트를 추출할 수 없습니다. 이미지 기반 PDF일 수 있습니다.",
        );
      }

      log.debug(
        `PDF 텍스트 추출 성공: ${file.name} (${pdfDocument.numPages} 페이지, ${fullText.length} 글자)`,
      );
      return { text: fullText.trim(), numPages: pdfDocument.numPages };
    } catch (error) {
      log.error("PDF 텍스트 추출 실패:", error);
      throw new Error(
        `PDF 텍스트 추출 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      );
    }
  }

  /**
   * 페이지 단위 청킹 (기본 Fallback)
   */
  private createChunks(text: string, documentId: number): PDFChunk[] {
    const chunks: PDFChunk[] = [];

    // 페이지별로 텍스트 분리
    const pagePattern = /=== 페이지 (\d+) ===/g;
    const pages: { pageNumber: number; content: string }[] = [];

    let lastIndex = 0;
    let match;
    let currentPageNum = 1;

    while ((match = pagePattern.exec(text)) !== null) {
      if (lastIndex > 0) {
        const content = text.substring(lastIndex, match.index).trim();
        if (content) {
          pages.push({ pageNumber: currentPageNum, content });
        }
      }

      currentPageNum = parseInt(match[1], 10);
      lastIndex = match.index + match[0].length;
    }

    // 마지막 페이지 내용 추가
    if (lastIndex < text.length) {
      const lastContent = text.substring(lastIndex).trim();
      if (lastContent) {
        pages.push({ pageNumber: currentPageNum, content: lastContent });
      }
    }

    // 페이지가 파싱되지 않으면 전체 텍스트를 하나의 페이지로
    if (pages.length === 0 && text.trim()) {
      pages.push({ pageNumber: 1, content: text.trim() });
    }

    log.debug(`✓ 페이지 파싱 완료: ${pages.length}개 페이지`);

    // 페이지별로 청킹
    pages.forEach((page) => {
      const pageContent = page.content.trim();
      if (!pageContent) return;

      const MAX_CHUNK_SIZE = defaultConfig.chunking.maxChunkSize;

      // 페이지가 작은 경우: 전체 페이지를 하나의 청크로
      if (pageContent.length <= MAX_CHUNK_SIZE) {
        chunks.push({
          id: chunks.length + 1,
          documentId,
          content: pageContent,
          pageNumber: page.pageNumber,
          chunkIndex: chunks.length,
          metadata: {
            pageLabel: `${page.pageNumber}페이지`,
            chunkType: "page",
            importance: "medium",
          },
        });
        return;
      }

      // 페이지가 큰 경우: 단락 또는 문장 단위로 분할
      const paragraphs = pageContent
        .split(/\n\s*\n/)
        .filter((p) => p.trim().length > 0);

      if (paragraphs.length > 1) {
        let currentChunk = "";

        paragraphs.forEach((para) => {
          if (currentChunk.length + para.length <= MAX_CHUNK_SIZE) {
            currentChunk += (currentChunk ? "\n\n" : "") + para;
          } else {
            if (currentChunk) {
              chunks.push({
                id: chunks.length + 1,
                documentId,
                content: currentChunk.trim(),
                pageNumber: page.pageNumber,
                chunkIndex: chunks.length,
                metadata: {
                  pageLabel: `${page.pageNumber}페이지`,
                  chunkType: "paragraph",
                  importance: "medium",
                },
              });
            }
            currentChunk = para;
          }
        });

        if (currentChunk) {
          chunks.push({
            id: chunks.length + 1,
            documentId,
            content: currentChunk.trim(),
            pageNumber: page.pageNumber,
            chunkIndex: chunks.length,
            metadata: {
              pageLabel: `${page.pageNumber}페이지`,
              chunkType: "paragraph",
              importance: "medium",
            },
          });
        }
      } else {
        // 단락이 없는 경우: 문장 단위로 분할
        const sentences = pageContent
          .split(/[.!?]+/)
          .filter((s) => s.trim().length > 20);
        let currentChunk = "";

        sentences.forEach((sentence) => {
          if (currentChunk.length + sentence.length <= MAX_CHUNK_SIZE) {
            currentChunk += (currentChunk ? ". " : "") + sentence.trim();
          } else {
            if (currentChunk) {
              chunks.push({
                id: chunks.length + 1,
                documentId,
                content: currentChunk.trim() + ".",
                pageNumber: page.pageNumber,
                chunkIndex: chunks.length,
                metadata: {
                  pageLabel: `${page.pageNumber}페이지`,
                  chunkType: "section",
                  importance: "medium",
                },
              });
            }
            currentChunk = sentence.trim();
          }
        });

        if (currentChunk) {
          chunks.push({
            id: chunks.length + 1,
            documentId,
            content: currentChunk.trim() + ".",
            pageNumber: page.pageNumber,
            chunkIndex: chunks.length,
            metadata: {
              pageLabel: `${page.pageNumber}페이지`,
              chunkType: "section",
              importance: "medium",
            },
          });
        }
      }
    });

    log.debug(
      `✅ 페이지 단위 청킹 완료: ${chunks.length}개 청크 (${pages.length}개 페이지)`,
    );
    return chunks;
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const pdfProcessingService = PDFProcessingService.getInstance();
