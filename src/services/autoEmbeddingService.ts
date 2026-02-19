/**
 * Auto Embedding Service
 * FAQ 저장 시 백그라운드에서 자동으로 임베딩을 생성하고 DB에 저장
 */

import { embeddingService } from "./embeddingService";
import { getSupabaseDatabaseService } from "./supabase";
import { createLogger } from "./logger";
import type { FAQ } from "../types";

const log = createLogger("autoEmbed");

class AutoEmbeddingService {
  async generateAndSaveFAQEmbeddings(faq: FAQ): Promise<void> {
    const dbService = getSupabaseDatabaseService();

    try {
      const texts: string[] = [];
      if (faq.question) texts.push(faq.question);
      if (faq.answer) texts.push(faq.answer);

      if (texts.length === 0) return;

      const embeddings = await embeddingService.generateBatchEmbeddings(texts);

      const questionEmbedding = embeddings[0] || null;
      const answerEmbedding = texts.length > 1 ? embeddings[1] || null : null;

      await dbService.updateFAQ(faq.id, {
        questionEmbedding: questionEmbedding ?? undefined,
        answerEmbedding: answerEmbedding ?? undefined,
      });

      log.info(`FAQ #${faq.id} 임베딩 생성 완료`);
    } catch (error: unknown) {
      log.error(`FAQ #${faq.id} 임베딩 생성 실패:`, error);
      throw error;
    }
  }
}

export const autoEmbeddingService = new AutoEmbeddingService();
