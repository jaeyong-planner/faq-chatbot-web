/**
 * Gemini Client (Server-side)
 * REST API를 직접 호출하는 클라이언트 (기존 geminiServiceAccount.cjs 로직 이식)
 */

const GEMINI_MODEL = "gemini-2.0-flash";
const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSION = 768;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

let apiKey: string | null = null;

/**
 * API Key 초기화 (싱글톤)
 */
export function getGeminiClient(): string {
  if (apiKey) {
    return apiKey;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  apiKey = key;
  return apiKey;
}

/**
 * 단일 텍스트 임베딩 생성
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const key = getGeminiClient();
  const url = `${BASE_URL}/models/${EMBEDDING_MODEL}:embedContent?key=${key}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: text.trim() }] },
      outputDimensionality: EMBEDDING_DIMENSION,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.embedding?.values || [];
}

/**
 * 배치 임베딩 생성
 */
export async function generateBatchEmbeddings(
  texts: string[],
): Promise<number[][]> {
  const results: number[][] = [];

  for (const text of texts) {
    try {
      const embedding = await generateEmbedding(text);
      results.push(embedding);

      // Rate limiting: 100ms 간격
      if (texts.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error("Batch embedding error:", error);
      results.push([]);
    }
  }

  return results;
}

/**
 * Gemini 모델 이름 가져오기
 */
export function getGeminiModel(): string {
  return GEMINI_MODEL;
}

/**
 * 임베딩 모델 이름 가져오기
 */
export function getEmbeddingModel(): string {
  return EMBEDDING_MODEL;
}

/**
 * 임베딩 차원 가져오기
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIMENSION;
}
