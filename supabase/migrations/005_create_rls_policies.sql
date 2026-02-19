-- 005_create_rls_policies.sql
-- Row Level Security (RLS) 정책 설정

-- 모든 테이블에 RLS 활성화
ALTER TABLE pdf_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- pdf_documents 정책: 인증된 사용자는 자신의 문서만 CRUD
CREATE POLICY "pdf_documents_select_policy" ON pdf_documents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "pdf_documents_insert_policy" ON pdf_documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pdf_documents_update_policy" ON pdf_documents
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "pdf_documents_delete_policy" ON pdf_documents
  FOR DELETE USING (auth.uid() = user_id);

-- pdf_chunks 정책: 인증된 사용자 전체 접근
CREATE POLICY "pdf_chunks_select_policy" ON pdf_chunks
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "pdf_chunks_insert_policy" ON pdf_chunks
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "pdf_chunks_update_policy" ON pdf_chunks
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "pdf_chunks_delete_policy" ON pdf_chunks
  FOR DELETE USING (auth.role() = 'authenticated');

-- faqs 정책: 인증된 사용자는 자신의 FAQ CRUD, anon은 is_active=true만 읽기
CREATE POLICY "faqs_select_authenticated_policy" ON faqs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "faqs_select_anon_policy" ON faqs
  FOR SELECT USING (auth.role() = 'anon' AND is_active = true);

CREATE POLICY "faqs_insert_policy" ON faqs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "faqs_update_policy" ON faqs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "faqs_delete_policy" ON faqs
  FOR DELETE USING (auth.uid() = user_id);

-- chat_sessions 정책: anon도 생성/읽기/수정 가능, 삭제는 인증된 사용자만
CREATE POLICY "chat_sessions_select_policy" ON chat_sessions
  FOR SELECT USING (true); -- 모든 사용자 읽기 가능

CREATE POLICY "chat_sessions_insert_policy" ON chat_sessions
  FOR INSERT WITH CHECK (true); -- anon도 세션 생성 가능

CREATE POLICY "chat_sessions_update_policy" ON chat_sessions
  FOR UPDATE USING (true); -- anon도 세션 수정 가능

CREATE POLICY "chat_sessions_delete_policy" ON chat_sessions
  FOR DELETE USING (auth.role() = 'authenticated' AND auth.uid() = user_id);

-- chat_messages 정책: anon도 생성/읽기/수정 가능, 삭제는 인증된 사용자만
CREATE POLICY "chat_messages_select_policy" ON chat_messages
  FOR SELECT USING (true); -- 모든 사용자 읽기 가능

CREATE POLICY "chat_messages_insert_policy" ON chat_messages
  FOR INSERT WITH CHECK (true); -- anon도 메시지 생성 가능

CREATE POLICY "chat_messages_update_policy" ON chat_messages
  FOR UPDATE USING (true);

CREATE POLICY "chat_messages_delete_policy" ON chat_messages
  FOR DELETE USING (auth.role() = 'authenticated');

-- settings 정책: 인증된 사용자는 자신의 설정만 CRUD
CREATE POLICY "settings_select_policy" ON settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "settings_insert_policy" ON settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "settings_update_policy" ON settings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "settings_delete_policy" ON settings
  FOR DELETE USING (auth.uid() = user_id);
