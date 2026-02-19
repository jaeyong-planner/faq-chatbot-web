/**
 * Generate Single Embedding Endpoint
 * POST /api/gemini/generate-embedding
 * Body: { text: string }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateEmbedding } from './_lib/geminiClient.js';
import { extractToken, validateToken, parseRequestBody, validateRequiredFields } from './_lib/validateRequest.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // JWT 토큰 검증 (선택적: 공개 챗봇에서도 임베딩 생성 가능)
    const token = extractToken(req);
    if (token) {
      const validation = await validateToken(token);
      if (!validation.valid) {
        return res.status(401).json({ error: validation.error || 'Invalid token' });
      }
    }

    // 요청 body 파싱
    const body = await parseRequestBody<{ text: string }>(req);

    // 필수 필드 검증
    const fieldsValidation = validateRequiredFields(body, ['text']);
    if (!fieldsValidation.valid) {
      return res.status(400).json({
        error: 'Missing required fields',
        missingFields: fieldsValidation.missingFields,
      });
    }

    // 타임아웃 설정 (15초)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 15000);
    });

    // 임베딩 생성
    const embedding = await Promise.race([generateEmbedding(body.text), timeoutPromise]);

    return res.status(200).json({ embedding });
  } catch (error: any) {
    console.error('Generate embedding error:', error);

    if (error.message === 'Request timeout') {
      return res.status(504).json({ error: 'Request timeout' });
    }

    return res.status(500).json({ error: error.message || 'Failed to generate embedding' });
  }
}
