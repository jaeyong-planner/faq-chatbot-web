/**
 * Admin: Setup RPC Functions
 * POST /api/admin/setup-rpc
 * pgvector RPC 함수를 Supabase에 생성
 * supabase-js는 DDL을 지원하지 않으므로, @supabase/supabase-js의 rpc를 통해
 * 이미 존재하는 함수를 확인하고, 없으면 안내 메시지를 반환합니다.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../gemini/_lib/supabaseAdmin.js";
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

    // RPC 함수 존재 여부 확인
    const functions = [
      "search_faqs_by_question",
      "search_faqs_by_answer",
      "search_chunks",
      "search_documents_by_name",
      "get_dashboard_metrics",
      "get_chat_analytics",
    ];

    const results: Record<string, boolean> = {};

    for (const fnName of functions) {
      try {
        // 빈 파라미터로 호출하면 오류가 나지만,
        // "could not find the function" 에러인지 다른 에러인지 구분 가능
        const { error } = await supabaseAdmin.rpc(fnName, {});
        if (error && error.message.includes("Could not find the function")) {
          results[fnName] = false;
        } else {
          // 함수가 존재 (파라미터 오류는 함수 자체는 존재)
          results[fnName] = true;
        }
      } catch {
        results[fnName] = false;
      }
    }

    const missingFunctions = Object.entries(results)
      .filter(([, exists]) => !exists)
      .map(([name]) => name);

    const existingFunctions = Object.entries(results)
      .filter(([, exists]) => exists)
      .map(([name]) => name);

    return res.status(200).json({
      existing: existingFunctions,
      missing: missingFunctions,
      allReady: missingFunctions.length === 0,
      message:
        missingFunctions.length === 0
          ? "모든 RPC 함수가 준비되어 있습니다."
          : `${missingFunctions.length}개 RPC 함수가 누락되었습니다. Supabase Dashboard > SQL Editor에서 마이그레이션 SQL을 실행해주세요.`,
      sql:
        missingFunctions.length > 0
          ? "https://supabase.com/dashboard/project/hrsqlpvfxhpgbfcebdid/sql/new"
          : undefined,
    });
  } catch (error: any) {
    console.error("Setup RPC check error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to check RPC functions" });
  }
}
