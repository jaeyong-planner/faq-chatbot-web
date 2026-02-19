/**
 * Gemini Connection Test Endpoint
 * GET /api/gemini/test-connection
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGeminiClient, getGeminiModel } from './_lib/geminiClient';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = getGeminiClient();
    const geminiModel = getGeminiModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

    // 간단한 테스트 요청
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: '테스트' }] }],
        generationConfig: {
          maxOutputTokens: 10,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(500).json({
        success: false,
        message: `API error: ${response.status} - ${errorText}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Gemini API 연결 성공 (모델: ${getGeminiModel()})`,
    });
  } catch (error: any) {
    console.error('Gemini connection test failed:', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Connection test failed',
    });
  }
}
