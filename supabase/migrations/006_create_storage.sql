-- 006_create_storage.sql
-- Supabase Storage 버킷 생성 및 정책 설정

-- documents 버킷 생성 (PDF 및 이미지 파일 저장)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false, -- public: false (인증 필요)
  52428800, -- 50MB 제한
  ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS 정책: 인증된 사용자 업로드/읽기/삭제, anon 읽기 허용
CREATE POLICY "documents_upload_policy" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "documents_select_authenticated_policy" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "documents_select_anon_policy" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'anon'
  );

CREATE POLICY "documents_update_policy" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "documents_delete_policy" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
  );
