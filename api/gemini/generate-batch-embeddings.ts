/**
 * Generate Batch Embeddings Endpoint
 * POST /api/gemini/generate-batch-embeddings
 * Body: { texts: string[] }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateBatchEmbeddings } from './_lib/geminiClient';
import { extractToken, validateToken, parseRequestBody, validateRequiredFields } from './_lib/validateRequest';

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
    // JWT 토큰 검증
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const validation = await validateToken(token);
    if (!validation.valid) {
      return res.status(401).json({ error: validation.error || 'Invalid token' });
    }

    // 요청 body 파싱
    const body = await parseRequestBody<{ texts: string[] }>(req);

    // 필수 필드 검증
    const fieldsValidation = validateRequiredFields(body, ['texts']);
    if (!fieldsValidation.valid) {
      return res.status(400).json({
        error: 'Missing required fields',
        missingFields: fieldsValidation.missingFields,
      });
    }

    // 배열 검증
    if (!Array.isArray(body.texts)) {
      return res.status(400).json({ error: 'texts must be an array' });
    }

    if (body.texts.length === 0) {
      return res.status(400).json({ error: 'texts array cannot be empty' });
    }

    // 타임아웃 설정 (30초)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 30000);
    });

    // 배치 임베딩 생성
    const embeddings = await Promise.race([generateBatchEmbeddings(body.texts), timeoutPromise]);

    return res.status(200).json({ embeddings });
  } catch (error: any) {
    console.error('Generate batch embeddings error:', error);

    if (error.message === 'Request timeout') {
      return res.status(504).json({ error: 'Request timeout' });
    }

    return res.status(500).json({ error: error.message || 'Failed to generate batch embeddings' });
  }
}
