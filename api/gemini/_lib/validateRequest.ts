/**
 * Request Validation Utilities
 * Supabase Auth JWT 토큰 검증 및 요청 파싱
 */

import type { VercelRequest } from '@vercel/node';
import { getSupabaseAdmin } from './supabaseAdmin.js';

/**
 * Authorization 헤더에서 JWT 토큰 추출
 */
export function extractToken(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return null;
  }

  // "Bearer <token>" 형식
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * JWT 토큰 검증
 */
export async function validateToken(token: string): Promise<{ valid: boolean; userId?: string; error?: string }> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await (supabase.auth as any).getUser(token);

    if (error) {
      return { valid: false, error: error.message };
    }

    if (!data.user) {
      return { valid: false, error: 'User not found' };
    }

    return { valid: true, userId: data.user.id };
  } catch (error: any) {
    return { valid: false, error: error.message || 'Token validation failed' };
  }
}

/**
 * 요청 body JSON 파싱
 */
export async function parseRequestBody<T = any>(req: VercelRequest): Promise<T> {
  if (req.method !== 'POST') {
    throw new Error('Only POST method is supported');
  }

  if (!req.body) {
    throw new Error('Request body is required');
  }

  return req.body as T;
}

/**
 * 필수 필드 검증
 */
export function validateRequiredFields<T extends Record<string, any>>(
  data: T,
  requiredFields: (keyof T)[]
): { valid: boolean; missingFields?: string[] } {
  const missingFields = requiredFields.filter((field) => {
    const value = data[field];
    return value === undefined || value === null || value === '';
  });

  if (missingFields.length > 0) {
    return { valid: false, missingFields: missingFields.map(String) };
  }

  return { valid: true };
}
