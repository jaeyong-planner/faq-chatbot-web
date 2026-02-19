import { supabase } from './client';

const STORAGE_BUCKET = 'documents';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * 파일명을 안전하게 sanitize합니다.
 * 특수문자를 제거하고 timestamp를 추가하여 고유성을 보장합니다.
 */
function sanitizeFileName(fileName: string): string {
  // 파일 확장자 추출
  const lastDot = fileName.lastIndexOf('.');
  const name = lastDot !== -1 ? fileName.substring(0, lastDot) : fileName;
  const ext = lastDot !== -1 ? fileName.substring(lastDot) : '';

  // 특수문자 제거 (영문, 숫자, 하이픈, 언더스코어만 허용)
  const safeName = name.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');

  // timestamp 추가
  const timestamp = Date.now();

  return `${safeName}_${timestamp}${ext}`;
}

export class SupabaseStorageService {
  /**
   * 파일을 Supabase Storage에 업로드합니다.
   * @param file - 업로드할 File 객체
   * @returns 업로드된 파일의 경로와 public URL
   */
  async upload(file: File): Promise<{ path: string; publicUrl: string }> {
    try {
      // 파일 크기 제한 확인
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`파일 크기가 ${MAX_FILE_SIZE / 1024 / 1024}MB를 초과합니다.`);
      }

      // 파일명 sanitize
      const sanitizedName = sanitizeFileName(file.name);
      const filePath = `uploads/${sanitizedName}`;

      console.log(`[SupabaseStorage] 파일 업로드 시작: ${file.name} -> ${filePath}`);

      // Supabase Storage에 업로드
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('[SupabaseStorage] 업로드 실패:', error);
        throw error;
      }

      // Public URL 생성
      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(data.path);

      console.log(`[SupabaseStorage] 업로드 성공: ${urlData.publicUrl}`);

      return {
        path: data.path,
        publicUrl: urlData.publicUrl
      };
    } catch (error) {
      console.error('[SupabaseStorage] upload 실패:', error);
      throw error;
    }
  }

  /**
   * 파일을 다운로드하기 위한 signed URL을 생성합니다.
   * @param path - 파일 경로
   * @param expiresIn - URL 유효 시간 (초, 기본값: 3600 = 1시간)
   * @returns signed URL
   */
  async download(path: string, expiresIn: number = 3600): Promise<string> {
    try {
      console.log(`[SupabaseStorage] signed URL 생성 중: ${path}`);

      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(path, expiresIn);

      if (error) {
        console.error('[SupabaseStorage] signed URL 생성 실패:', error);
        throw error;
      }

      if (!data?.signedUrl) {
        throw new Error('Signed URL 생성 실패');
      }

      console.log(`[SupabaseStorage] signed URL 생성 성공 (유효 시간: ${expiresIn}초)`);

      return data.signedUrl;
    } catch (error) {
      console.error('[SupabaseStorage] download 실패:', error);
      throw error;
    }
  }

  /**
   * 파일을 삭제합니다.
   * @param path - 삭제할 파일 경로
   * @returns 삭제 성공 여부
   */
  async delete(path: string): Promise<boolean> {
    try {
      console.log(`[SupabaseStorage] 파일 삭제 중: ${path}`);

      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([path]);

      if (error) {
        console.error('[SupabaseStorage] 삭제 실패:', error);
        throw error;
      }

      console.log(`[SupabaseStorage] 파일 삭제 성공: ${path}`);

      return true;
    } catch (error) {
      console.error('[SupabaseStorage] delete 실패:', error);
      throw error;
    }
  }

  /**
   * 파일의 public URL을 가져옵니다.
   * @param path - 파일 경로
   * @returns public URL
   */
  getPublicUrl(path: string): string {
    const { data } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(path);

    return data.publicUrl;
  }

  /**
   * 여러 파일을 한 번에 삭제합니다.
   * @param paths - 삭제할 파일 경로 배열
   * @returns 삭제 성공 여부
   */
  async deleteMultiple(paths: string[]): Promise<boolean> {
    try {
      console.log(`[SupabaseStorage] 다중 파일 삭제 중: ${paths.length}개`);

      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(paths);

      if (error) {
        console.error('[SupabaseStorage] 다중 삭제 실패:', error);
        throw error;
      }

      console.log(`[SupabaseStorage] 다중 파일 삭제 성공: ${paths.length}개`);

      return true;
    } catch (error) {
      console.error('[SupabaseStorage] deleteMultiple 실패:', error);
      throw error;
    }
  }

  /**
   * 파일 목록을 가져옵니다.
   * @param folder - 폴더 경로 (기본값: 'uploads')
   * @returns 파일 목록
   */
  async listFiles(folder: string = 'uploads'): Promise<any[]> {
    try {
      console.log(`[SupabaseStorage] 파일 목록 조회 중: ${folder}`);

      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .list(folder, {
          limit: 100,
          offset: 0,
          sortBy: { column: 'created_at', order: 'desc' }
        });

      if (error) {
        console.error('[SupabaseStorage] 파일 목록 조회 실패:', error);
        throw error;
      }

      console.log(`[SupabaseStorage] 파일 목록 조회 성공: ${data.length}개`);

      return data;
    } catch (error) {
      console.error('[SupabaseStorage] listFiles 실패:', error);
      throw error;
    }
  }
}

// Singleton instance
let supabaseStorageInstance: SupabaseStorageService | null = null;

export const getSupabaseStorageService = (): SupabaseStorageService => {
  if (!supabaseStorageInstance) {
    supabaseStorageInstance = new SupabaseStorageService();
  }
  return supabaseStorageInstance;
};
