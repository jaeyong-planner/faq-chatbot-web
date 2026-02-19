/**
 * Admin: Batch Embedding Generation
 * POST /api/admin/generate-embeddings
 * 모든 FAQ에 대해 임베딩을 생성하고 DB에 저장
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../gemini/_lib/supabaseAdmin.js";
import { generateEmbedding } from "../gemini/_lib/geminiClient.js";
import { extractToken, validateToken } from "../gemini/_lib/validateRequest.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Admin 인증 검증
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: "Authorization token required" });
    }

    const validation = await validateToken(token);
    if (!validation.valid) {
      return res
        .status(401)
        .json({ error: validation.error || "Invalid token" });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 임베딩이 없는 FAQ 조회 (service role key로 RLS 우회)
    const { data: faqs, error: fetchError } = await supabaseAdmin
      .from("faqs")
      .select("id, question, answer")
      .or("question_embedding.is.null,answer_embedding.is.null")
      .eq("is_active", true)
      .order("id", { ascending: true });

    if (fetchError) {
      return res
        .status(500)
        .json({ error: `FAQ 조회 실패: ${fetchError.message}` });
    }

    if (!faqs || faqs.length === 0) {
      return res.status(200).json({
        message: "모든 FAQ에 임베딩이 이미 존재합니다.",
        processed: 0,
        total: 0,
      });
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ id: number; error: string }> = [];

    // 배치 처리 (하나씩 처리, rate limiting 적용)
    for (const faq of faqs) {
      try {
        const questionEmbedding = await generateEmbedding(faq.question);

        // 150ms 대기 (rate limiting)
        await new Promise((resolve) => setTimeout(resolve, 150));

        const answerEmbedding = await generateEmbedding(faq.answer);

        // 150ms 대기
        await new Promise((resolve) => setTimeout(resolve, 150));

        // 임베딩을 문자열로 변환 (pgvector 형식)
        const qEmbStr = `[${questionEmbedding.join(",")}]`;
        const aEmbStr = `[${answerEmbedding.join(",")}]`;

        const { error: updateError } = await supabaseAdmin
          .from("faqs")
          .update({
            question_embedding: qEmbStr,
            answer_embedding: aEmbStr,
          })
          .eq("id", faq.id);

        if (updateError) {
          errorCount++;
          errors.push({ id: faq.id, error: updateError.message });
        } else {
          successCount++;
        }
      } catch (embError: any) {
        errorCount++;
        errors.push({
          id: faq.id,
          error: embError.message || "Embedding generation failed",
        });
      }
    }

    return res.status(200).json({
      message: `임베딩 생성 완료: ${successCount}/${faqs.length}개 성공`,
      processed: successCount,
      failed: errorCount,
      total: faqs.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (error: any) {
    console.error("Generate embeddings error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to generate embeddings" });
  }
}
