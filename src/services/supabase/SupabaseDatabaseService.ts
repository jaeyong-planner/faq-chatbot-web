import {
  PDFDocument,
  PDFChunk,
  FAQ,
  ChatSession,
  ChatSessionCreateInput,
  ChatSessionUpdateInput,
  ChatLogMessage,
  ChatLogMessageCreateInput,
  DashboardMetrics,
  ChatAnalytics,
} from "../../types";
import { supabase } from "./client";

// snake_case ↔ camelCase 변환 유틸리티
function toCamelCase<T = any>(obj: any): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toCamelCase) as any;
  if (typeof obj !== "object") return obj;

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
      letter.toUpperCase(),
    );
    result[camelKey] = toCamelCase(value);
  }
  return result;
}

function toSnakeCase(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toSnakeCase);
  if (typeof obj !== "object") return obj;

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(
      /[A-Z]/g,
      (letter) => `_${letter.toLowerCase()}`,
    );
    result[snakeKey] = toSnakeCase(value);
  }
  return result;
}

export class SupabaseDatabaseService {
  private async getCurrentUserId(): Promise<string | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.id || null;
  }

  private async safeQuery<T>(
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      console.error(`[SupabaseDB] ${operation} 실패:`, error);
      throw error;
    }
  }

  // Document operations
  async createDocument(
    document: Omit<PDFDocument, "id">,
  ): Promise<PDFDocument> {
    return this.safeQuery("createDocument", async () => {
      const userId = await this.getCurrentUserId();

      const dbRow = {
        name: document.name,
        size: document.size,
        upload_date: document.uploadDate,
        status: document.status,
        upload_mode: document.uploadMode,
        file_path: document.filePath || null,
        ocr_text: document.ocrText || null,
        metadata: document.metadata || {},
        name_embedding: document.nameEmbedding || null,
        user_id: userId,
      };

      const { data, error } = await supabase
        .from("pdf_documents")
        .insert(dbRow)
        .select()
        .single();

      if (error) throw error;
      return toCamelCase<PDFDocument>(data);
    });
  }

  async getDocument(id: number): Promise<PDFDocument | null> {
    return this.safeQuery("getDocument", async () => {
      const { data, error } = await supabase
        .from("pdf_documents")
        .select(
          `
          *,
          pdf_chunks(*),
          faqs(*)
        `,
        )
        .eq("id", id)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null; // Not found
        throw error;
      }

      const doc = toCamelCase<any>(data);

      // chunks와 faqs를 PDFDocument 타입에 맞게 변환
      return {
        ...doc,
        chunks:
          doc.pdfChunks && doc.pdfChunks.length > 0 ? doc.pdfChunks : undefined,
        generatedFaqs: doc.faqs && doc.faqs.length > 0 ? doc.faqs : undefined,
        pdfChunks: undefined,
        faqs: undefined,
      };
    });
  }

  async getAllDocuments(): Promise<PDFDocument[]> {
    return this.safeQuery("getAllDocuments", async () => {
      const { data, error } = await supabase
        .from("pdf_documents")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data.map((row) => toCamelCase<PDFDocument>(row));
    });
  }

  async updateDocument(
    id: number,
    updates: Partial<PDFDocument>,
  ): Promise<PDFDocument | null> {
    return this.safeQuery("updateDocument", async () => {
      const dbUpdates: any = {};

      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.size !== undefined) dbUpdates.size = updates.size;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.uploadMode !== undefined)
        dbUpdates.upload_mode = updates.uploadMode;
      if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata;
      if (updates.nameEmbedding !== undefined)
        dbUpdates.name_embedding = updates.nameEmbedding;
      if (updates.filePath !== undefined)
        dbUpdates.file_path = updates.filePath;
      if (updates.ocrText !== undefined) dbUpdates.ocr_text = updates.ocrText;

      if (Object.keys(dbUpdates).length === 0) {
        return this.getDocument(id);
      }

      dbUpdates.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from("pdf_documents")
        .update(dbUpdates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return toCamelCase<PDFDocument>(data);
    });
  }

  async deleteDocument(id: number): Promise<boolean> {
    return this.safeQuery("deleteDocument", async () => {
      const { error } = await supabase
        .from("pdf_documents")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return true;
    });
  }

  // Chunk operations
  async createChunk(chunk: Omit<PDFChunk, "id">): Promise<PDFChunk> {
    return this.safeQuery("createChunk", async () => {
      const dbRow = {
        document_id: chunk.documentId,
        content: chunk.content,
        page_number: chunk.pageNumber,
        chunk_index: chunk.chunkIndex,
        embeddings: chunk.embeddings || null,
        metadata: chunk.metadata || {},
      };

      const { data, error } = await supabase
        .from("pdf_chunks")
        .insert(dbRow)
        .select()
        .single();

      if (error) throw error;
      return toCamelCase<PDFChunk>(data);
    });
  }

  async getChunk(id: number): Promise<PDFChunk | null> {
    return this.safeQuery("getChunk", async () => {
      const { data, error } = await supabase
        .from("pdf_chunks")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }

      return toCamelCase<PDFChunk>(data);
    });
  }

  async getChunksByDocumentId(documentId: number): Promise<PDFChunk[]> {
    return this.safeQuery("getChunksByDocumentId", async () => {
      const { data, error } = await supabase
        .from("pdf_chunks")
        .select("*")
        .eq("document_id", documentId)
        .order("chunk_index", { ascending: true });

      if (error) throw error;
      return data.map((row) => toCamelCase<PDFChunk>(row));
    });
  }

  async updateChunk(
    id: number,
    updates: Partial<PDFChunk>,
  ): Promise<PDFChunk | null> {
    return this.safeQuery("updateChunk", async () => {
      const dbUpdates: any = {};

      if (updates.content !== undefined) dbUpdates.content = updates.content;
      if (updates.pageNumber !== undefined)
        dbUpdates.page_number = updates.pageNumber;
      if (updates.chunkIndex !== undefined)
        dbUpdates.chunk_index = updates.chunkIndex;
      if (updates.embeddings !== undefined)
        dbUpdates.embeddings = updates.embeddings;
      if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata;

      if (Object.keys(dbUpdates).length === 0) {
        return this.getChunk(id);
      }

      const { data, error } = await supabase
        .from("pdf_chunks")
        .update(dbUpdates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return toCamelCase<PDFChunk>(data);
    });
  }

  async deleteChunksByDocumentId(documentId: number): Promise<number> {
    return this.safeQuery("deleteChunksByDocumentId", async () => {
      const { data, error } = await supabase
        .from("pdf_chunks")
        .delete()
        .eq("document_id", documentId)
        .select("id");

      if (error) throw error;
      return data?.length || 0;
    });
  }

  // FAQ operations
  async createFAQ(faq: Omit<FAQ, "id">, documentId?: number): Promise<FAQ> {
    return this.safeQuery("createFAQ", async () => {
      const userId = await this.getCurrentUserId();

      const dbRow = {
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
        is_active: faq.isActive,
        image_url: faq.imageUrl || null,
        link_url: faq.linkUrl || null,
        attachment_url: faq.attachmentUrl || null,
        attachment_name: faq.attachmentName || null,
        document_id: documentId || faq.documentId || null,
        question_embedding: faq.questionEmbedding || null,
        answer_embedding: faq.answerEmbedding || null,
        source_chunk_ids: faq.sourceChunkIds || null,
        page_references: faq.pageReferences || null,
        document_link: faq.documentLink || null,
        semantic_keywords: faq.semanticKeywords || null,
        related_topics: faq.relatedTopics || null,
        confidence: faq.confidence !== undefined ? faq.confidence : null,
        generation_source: faq.generationSource || null,
        user_id: userId,
      };

      const { data, error } = await supabase
        .from("faqs")
        .insert(dbRow)
        .select()
        .single();

      if (error) throw error;
      return toCamelCase<FAQ>(data);
    });
  }

  async getFAQ(id: number): Promise<FAQ | null> {
    return this.safeQuery("getFAQ", async () => {
      const { data, error } = await supabase
        .from("faqs")
        .select(
          `
          *,
          pdf_documents(id, name, size, upload_date, status, upload_mode, file_path)
        `,
        )
        .eq("id", id)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }

      const faq = toCamelCase<any>(data);

      // sourceDocument 처리
      if (faq.pdfDocuments) {
        faq.sourceDocument = faq.pdfDocuments;
        delete faq.pdfDocuments;
      }

      return faq as FAQ;
    });
  }

  async getAllFAQs(): Promise<FAQ[]> {
    return this.safeQuery("getAllFAQs", async () => {
      const { data, error } = await supabase
        .from("faqs")
        .select(
          `
          *,
          pdf_documents(id, name, size, upload_date, status, upload_mode, file_path)
        `,
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      return data.map((row) => {
        const faq = toCamelCase<any>(row);
        if (faq.pdfDocuments) {
          faq.sourceDocument = faq.pdfDocuments;
          delete faq.pdfDocuments;
        }
        return faq as FAQ;
      });
    });
  }

  async getFAQsByDocumentId(documentId: number): Promise<FAQ[]> {
    return this.safeQuery("getFAQsByDocumentId", async () => {
      const { data, error } = await supabase
        .from("faqs")
        .select("*")
        .eq("document_id", documentId);

      if (error) throw error;
      return data.map((row) => toCamelCase<FAQ>(row));
    });
  }

  async updateFAQ(id: number, updates: Partial<FAQ>): Promise<FAQ | null> {
    return this.safeQuery("updateFAQ", async () => {
      const dbUpdates: any = {};

      if (updates.question !== undefined) dbUpdates.question = updates.question;
      if (updates.answer !== undefined) dbUpdates.answer = updates.answer;
      if (updates.category !== undefined) dbUpdates.category = updates.category;
      if (updates.isActive !== undefined)
        dbUpdates.is_active = updates.isActive;
      if (updates.imageUrl !== undefined)
        dbUpdates.image_url = updates.imageUrl;
      if (updates.linkUrl !== undefined) dbUpdates.link_url = updates.linkUrl;
      if (updates.attachmentUrl !== undefined)
        dbUpdates.attachment_url = updates.attachmentUrl;
      if (updates.attachmentName !== undefined)
        dbUpdates.attachment_name = updates.attachmentName;
      if (updates.documentId !== undefined)
        dbUpdates.document_id = updates.documentId;
      if (updates.questionEmbedding !== undefined)
        dbUpdates.question_embedding = updates.questionEmbedding;
      if (updates.answerEmbedding !== undefined)
        dbUpdates.answer_embedding = updates.answerEmbedding;
      if (updates.isFeatured !== undefined)
        dbUpdates.is_featured = updates.isFeatured;
      if (updates.featuredAt !== undefined)
        dbUpdates.featured_at = updates.featuredAt;
      if (updates.sourceChunkIds !== undefined)
        dbUpdates.source_chunk_ids = updates.sourceChunkIds;
      if (updates.pageReferences !== undefined)
        dbUpdates.page_references = updates.pageReferences;
      if (updates.documentLink !== undefined)
        dbUpdates.document_link = updates.documentLink;
      if (updates.semanticKeywords !== undefined)
        dbUpdates.semantic_keywords = updates.semanticKeywords;
      if (updates.relatedTopics !== undefined)
        dbUpdates.related_topics = updates.relatedTopics;
      if (updates.confidence !== undefined)
        dbUpdates.confidence = updates.confidence;
      if (updates.generationSource !== undefined)
        dbUpdates.generation_source = updates.generationSource;

      if (Object.keys(dbUpdates).length === 0) {
        return this.getFAQ(id);
      }

      dbUpdates.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from("faqs")
        .update(dbUpdates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return toCamelCase<FAQ>(data);
    });
  }

  async deleteFAQ(id: number): Promise<boolean> {
    return this.safeQuery("deleteFAQ", async () => {
      const { error } = await supabase.from("faqs").delete().eq("id", id);

      if (error) throw error;
      return true;
    });
  }

  async deleteFAQsByDocumentId(documentId: number): Promise<number> {
    return this.safeQuery("deleteFAQsByDocumentId", async () => {
      const { data, error } = await supabase
        .from("faqs")
        .delete()
        .eq("document_id", documentId)
        .select("id");

      if (error) throw error;
      return data?.length || 0;
    });
  }

  async setFAQFeatured(id: number, isFeatured: boolean): Promise<FAQ | null> {
    return this.safeQuery("setFAQFeatured", async () => {
      if (isFeatured) {
        // 현재 featured FAQ 개수 확인
        const { count, error: countError } = await supabase
          .from("faqs")
          .select("id", { count: "exact", head: true })
          .eq("is_featured", true);

        if (countError) throw countError;

        // 4개 이상이면 가장 오래된 것을 해제
        if (count && count >= 4) {
          const { data: oldest, error: oldestError } = await supabase
            .from("faqs")
            .select("id")
            .eq("is_featured", true)
            .order("featured_at", { ascending: true })
            .limit(1)
            .single();

          if (oldestError) throw oldestError;

          if (oldest) {
            console.log(
              `⚠️ Featured FAQ가 4개를 초과하여 가장 오래된 FAQ (ID: ${oldest.id})를 자동으로 해제합니다.`,
            );
            await supabase
              .from("faqs")
              .update({
                is_featured: false,
                featured_at: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", oldest.id);
          }
        }

        // 새로운 FAQ를 featured로 설정
        const { data, error } = await supabase
          .from("faqs")
          .update({
            is_featured: true,
            featured_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select()
          .single();

        if (error) throw error;
        return toCamelCase<FAQ>(data);
      } else {
        // Featured 해제
        const { data, error } = await supabase
          .from("faqs")
          .update({
            is_featured: false,
            featured_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select()
          .single();

        if (error) throw error;
        return toCamelCase<FAQ>(data);
      }
    });
  }

  async getFeaturedFAQs(): Promise<FAQ[]> {
    return this.safeQuery("getFeaturedFAQs", async () => {
      const { data, error } = await supabase
        .from("faqs")
        .select("*")
        .eq("is_featured", true)
        .eq("is_active", true)
        .order("featured_at", { ascending: false });

      if (error) throw error;
      return data.map((row) => toCamelCase<FAQ>(row));
    });
  }

  // Chat session operations
  async createChatSession(
    session: ChatSessionCreateInput,
  ): Promise<ChatSession> {
    return this.safeQuery("createChatSession", async () => {
      const userId = await this.getCurrentUserId();

      const dbRow = {
        session_id: session.sessionId,
        user_name: session.user || null,
        user_email: session.userEmail || null,
        start_time: session.startTime,
        status: session.status || "ongoing",
        satisfaction: session.satisfaction ?? null,
        category: session.category || null,
        is_resolved: session.isResolved || false,
        tags: session.tags || [],
        message_count: session.messageCount ?? 0,
        duration: session.duration || null,
        user_id: userId,
      };

      const { data, error } = await supabase
        .from("chat_sessions")
        .insert(dbRow)
        .select()
        .single();

      if (error) throw error;
      return toCamelCase<ChatSession>(data);
    });
  }

  async getChatSession(sessionId: string): Promise<ChatSession | null> {
    return this.safeQuery("getChatSession", async () => {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("*")
        .eq("session_id", sessionId)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }

      return toCamelCase<ChatSession>(data);
    });
  }

  async getAllChatSessions(): Promise<ChatSession[]> {
    return this.safeQuery("getAllChatSessions", async () => {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("*")
        .order("start_time", { ascending: false });

      if (error) throw error;
      return data.map((row) => toCamelCase<ChatSession>(row));
    });
  }

  async updateChatSession(
    sessionId: string,
    updates: ChatSessionUpdateInput,
  ): Promise<ChatSession | null> {
    return this.safeQuery("updateChatSession", async () => {
      const dbUpdates: any = {};

      if (updates.endTime !== undefined) dbUpdates.end_time = updates.endTime;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.satisfaction !== undefined)
        dbUpdates.satisfaction = updates.satisfaction;
      if (updates.category !== undefined) dbUpdates.category = updates.category;
      if (updates.isResolved !== undefined)
        dbUpdates.is_resolved = updates.isResolved;
      if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
      if (updates.messageCount !== undefined)
        dbUpdates.message_count = updates.messageCount;
      if (updates.duration !== undefined) dbUpdates.duration = updates.duration;
      if (updates.user !== undefined) dbUpdates.user_name = updates.user;
      if (updates.userEmail !== undefined)
        dbUpdates.user_email = updates.userEmail;

      if (Object.keys(dbUpdates).length === 0) {
        return this.getChatSession(sessionId);
      }

      dbUpdates.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from("chat_sessions")
        .update(dbUpdates)
        .eq("session_id", sessionId)
        .select()
        .single();

      if (error) throw error;
      return toCamelCase<ChatSession>(data);
    });
  }

  async deleteChatSession(sessionId: string): Promise<boolean> {
    return this.safeQuery("deleteChatSession", async () => {
      const { error } = await supabase
        .from("chat_sessions")
        .delete()
        .eq("session_id", sessionId);

      if (error) throw error;
      return true;
    });
  }

  // Chat message operations
  async createChatMessage(
    message: ChatLogMessageCreateInput,
  ): Promise<ChatLogMessage> {
    return this.safeQuery("createChatMessage", async () => {
      const dbRow = {
        session_id: message.sessionId,
        timestamp: message.timestamp,
        sender: message.sender,
        message: message.message,
        message_type: message.messageType || null,
        response_time: message.responseTime ?? null,
        confidence: message.confidence ?? null,
        source_faq: message.sourceFaq ?? null,
      };

      const { data, error } = await supabase
        .from("chat_messages")
        .insert(dbRow)
        .select()
        .single();

      if (error) throw error;

      // 세션의 메시지 카운트 증가 (RPC 대신 select + update)
      const { data: sessionData } = await supabase
        .from("chat_sessions")
        .select("message_count")
        .eq("session_id", message.sessionId)
        .single();

      const currentCount = sessionData?.message_count ?? 0;
      await supabase
        .from("chat_sessions")
        .update({
          message_count: currentCount + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", message.sessionId);

      return toCamelCase<ChatLogMessage>(data);
    });
  }

  async getChatMessagesBySessionId(
    sessionId: string,
  ): Promise<ChatLogMessage[]> {
    return this.safeQuery("getChatMessagesBySessionId", async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", sessionId)
        .order("timestamp", { ascending: true });

      if (error) throw error;
      return data.map((row) => toCamelCase<ChatLogMessage>(row));
    });
  }

  async deleteChatMessagesBySessionId(sessionId: string): Promise<number> {
    return this.safeQuery("deleteChatMessagesBySessionId", async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .delete()
        .eq("session_id", sessionId)
        .select("id");

      if (error) throw error;
      return data?.length || 0;
    });
  }

  // Analytics
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    return this.safeQuery("getDashboardMetrics", async () => {
      const { data, error } = await supabase.rpc("get_dashboard_metrics");
      if (error) throw error;
      return toCamelCase<DashboardMetrics>(data);
    });
  }

  async getChatAnalytics(
    period: "today" | "week" | "month" = "month",
  ): Promise<ChatAnalytics> {
    return this.safeQuery("getChatAnalytics", async () => {
      const { data, error } = await supabase.rpc("get_chat_analytics", {
        period,
      });
      if (error) throw error;
      return toCamelCase<ChatAnalytics>(data);
    });
  }

  // Batch operations
  async createDocumentWithChunks(
    document: Omit<PDFDocument, "id">,
    chunks: Omit<PDFChunk, "id" | "documentId">[],
  ): Promise<PDFDocument> {
    return this.safeQuery("createDocumentWithChunks", async () => {
      const createdDoc = await this.createDocument(document);

      if (chunks.length > 0) {
        const chunkRows = chunks.map((chunk) => ({
          document_id: createdDoc.id,
          content: chunk.content,
          page_number: chunk.pageNumber,
          chunk_index: chunk.chunkIndex,
          embeddings: chunk.embeddings || null,
          metadata: chunk.metadata || {},
        }));

        const { error } = await supabase.from("pdf_chunks").insert(chunkRows);

        if (error) throw error;
      }

      return this.getDocument(createdDoc.id) as Promise<PDFDocument>;
    });
  }

  async createDocumentWithChunksAndFAQs(
    document: Omit<PDFDocument, "id">,
    chunks: Omit<PDFChunk, "id" | "documentId">[],
    faqs: Omit<FAQ, "id">[],
  ): Promise<PDFDocument> {
    return this.safeQuery("createDocumentWithChunksAndFAQs", async () => {
      const createdDoc = await this.createDocumentWithChunks(document, chunks);

      if (faqs.length > 0) {
        const userId = await this.getCurrentUserId();

        const faqRows = faqs.map((faq) => ({
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          is_active: faq.isActive,
          image_url: faq.imageUrl || null,
          link_url: faq.linkUrl || null,
          attachment_url: faq.attachmentUrl || null,
          attachment_name: faq.attachmentName || null,
          document_id: createdDoc.id,
          question_embedding: faq.questionEmbedding || null,
          answer_embedding: faq.answerEmbedding || null,
          source_chunk_ids: faq.sourceChunkIds || null,
          page_references: faq.pageReferences || null,
          document_link: faq.documentLink || null,
          semantic_keywords: faq.semanticKeywords || null,
          related_topics: faq.relatedTopics || null,
          confidence: faq.confidence !== undefined ? faq.confidence : null,
          generation_source: faq.generationSource || null,
          user_id: userId,
        }));

        const { error } = await supabase.from("faqs").insert(faqRows);

        if (error) throw error;
      }

      return this.getDocument(createdDoc.id) as Promise<PDFDocument>;
    });
  }

  // Stats
  async getStats(): Promise<{
    totalDocuments: number;
    totalChunks: number;
    totalFAQs: number;
    completedDocuments: number;
  }> {
    return this.safeQuery("getStats", async () => {
      const [docsResult, chunksResult, faqsResult, completedResult] =
        await Promise.all([
          supabase
            .from("pdf_documents")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("pdf_chunks")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("faqs")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true),
          supabase
            .from("pdf_documents")
            .select("id", { count: "exact", head: true })
            .eq("status", "completed"),
        ]);

      return {
        totalDocuments: docsResult.count || 0,
        totalChunks: chunksResult.count || 0,
        totalFAQs: faqsResult.count || 0,
        completedDocuments: completedResult.count || 0,
      };
    });
  }

  // Settings
  async getSetting(key: string): Promise<string | null> {
    return this.safeQuery("getSetting", async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", key)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }

      return data?.value || null;
    });
  }

  async setSetting(key: string, value: string): Promise<void> {
    return this.safeQuery("setSetting", async () => {
      const userId = await this.getCurrentUserId();

      const { error } = await supabase.from("settings").upsert({
        key,
        value,
        user_id: userId,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;
    });
  }

  async deleteSetting(key: string): Promise<void> {
    return this.safeQuery("deleteSetting", async () => {
      const { error } = await supabase.from("settings").delete().eq("key", key);

      if (error) throw error;
    });
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    return this.safeQuery("healthCheck", async () => {
      const { error } = await supabase
        .from("pdf_documents")
        .select("id")
        .limit(1);
      return !error;
    });
  }
}

// Singleton instance
let supabaseDatabaseInstance: SupabaseDatabaseService | null = null;

export const getSupabaseDatabaseService = (): SupabaseDatabaseService => {
  if (!supabaseDatabaseInstance) {
    supabaseDatabaseInstance = new SupabaseDatabaseService();
  }
  return supabaseDatabaseInstance;
};
