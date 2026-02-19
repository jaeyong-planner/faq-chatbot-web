/**
 * Analyze Document Endpoint
 * POST /api/gemini/analyze-document
 * Body: { documentText: string, documentName?: string }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGeminiClient, getGeminiModel } from './_lib/geminiClient';
import { extractToken, validateToken, parseRequestBody, validateRequiredFields } from './_lib/validateRequest';
import { FAQ_GENERATION_PERSONA } from './_lib/personaPrompt';

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
    const body = await parseRequestBody<{ documentText: string; documentName?: string }>(req);

    // 필수 필드 검증
    const fieldsValidation = validateRequiredFields(body, ['documentText']);
    if (!fieldsValidation.valid) {
      return res.status(400).json({
        error: 'Missing required fields',
        missingFields: fieldsValidation.missingFields,
      });
    }

    const documentName = body.documentName || '제목 없음';

    // Gemini API Key 가져오기
    const apiKey = getGeminiClient();
    const geminiModel = getGeminiModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

    // 프롬프트 구성 (기존 geminiServiceAccount.cjs의 analyzeDocument 로직 이식)
    const prompt = `# 엠브레인 전용 FAQ 생성 비서

당신은 엠브레인의 리서치 문서를 기반으로 FAQ를 생성하는 전문가입니다.

## FAQ 생성 원칙 (반드시 준수)

1. **문서 기반**: 문서에 명시된 내용만으로 FAQ 생성
2. **정확성**: 문서에 없는 정보는 절대 포함하지 않음
3. **검증 가능성**: 모든 답변은 문서 내 위치 추적 가능
4. **객관성**: 추측, 의견, 해석 금지

## 금지사항
- 문서에 없는 질문 생성
- 문서에 없는 답변 생성
- 일반 상식 기반 FAQ (문서 내용만)
- 과장되거나 주관적인 표현
- "~일 것입니다", "~로 예상됩니다" 등 추측성 표현

---

다음 문서를 분석하여 요약, 주요 주제, FAQ를 생성해주세요.

문서명: ${documentName}

문서 내용:
${body.documentText}

다음 JSON 형식으로 응답해주세요:
{
  "summary": "문서 내용을 기반으로 한 객관적 요약 (200자 이내)",
  "keyTopics": ["주요 주제1", "주요 주제2"],
  "suggestedFAQs": [
    {
      "question": "문서 기반 질문",
      "answer": "문서의 내용을 정확히 반영한 답변",
      "category": "카테고리"
    }
  ]
}

FAQ는 최소 5개 이상 생성하고, 반드시 문서에 명시된 정보만 사용하세요.`;

    // 타임아웃 설정 (45초)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 45000);
    });

    // Gemini API 호출
    const response = await Promise.race([
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        }),
      }),
      timeoutPromise,
    ]);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({ error: 'Empty response from Gemini' });
    }

    // JSON 파싱
    const analysisResult = JSON.parse(text) as DocumentAnalysisResult;

    // 스마트 청킹 (간단한 구현)
    const chunkSize = 500;
    const chunks: DocumentAnalysisResult['chunks'] = [];
    for (let i = 0; i < body.documentText.length; i += chunkSize) {
      const content = body.documentText.substring(i, i + chunkSize);
      chunks.push({
        title: `청크 ${chunks.length + 1}`,
        content,
        summary: content.substring(0, 100) + '...',
        importance: '보통',
        keywords: [],
      });
    }

    analysisResult.chunks = chunks;

    return res.status(200).json(analysisResult);
  } catch (error: any) {
    console.error('Analyze document error:', error);

    if (error.message === 'Request timeout') {
      return res.status(504).json({ error: 'Request timeout' });
    }

    if (error instanceof SyntaxError) {
      return res.status(500).json({ error: 'Failed to parse Gemini response' });
    }

    return res.status(500).json({ error: error.message || 'Failed to analyze document' });
  }
}
