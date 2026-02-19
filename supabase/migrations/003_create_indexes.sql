-- 003_create_indexes.sql
-- 성능 최적화를 위한 인덱스 생성

-- pdf_chunks 인덱스
CREATE INDEX idx_chunks_document_id ON pdf_chunks(document_id);

-- faqs 인덱스 (기본)
CREATE INDEX idx_faqs_category ON faqs(category);
CREATE INDEX idx_faqs_document_id ON faqs(document_id);
CREATE INDEX idx_faqs_is_active ON faqs(is_active);
CREATE INDEX idx_faqs_is_featured ON faqs(is_featured);

-- chat_sessions 인덱스
CREATE INDEX idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX idx_chat_sessions_start_time ON chat_sessions(start_time);

-- chat_messages 인덱스
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_timestamp ON chat_messages(timestamp);

-- settings 인덱스
CREATE INDEX idx_settings_key ON settings(key);

-- RLS 성능을 위한 user_id 인덱스
CREATE INDEX idx_pdf_documents_user_id ON pdf_documents(user_id);
CREATE INDEX idx_faqs_user_id ON faqs(user_id);
CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_settings_user_id ON settings(user_id);

-- pgvector HNSW 인덱스 (코사인 거리 기반 벡터 검색)
-- HNSW는 근사 최근접 이웃 탐색을 위한 고성능 인덱스
CREATE INDEX idx_faqs_question_embedding ON faqs USING hnsw (question_embedding vector_cosine_ops);
CREATE INDEX idx_faqs_answer_embedding ON faqs USING hnsw (answer_embedding vector_cosine_ops);
CREATE INDEX idx_chunks_embeddings ON pdf_chunks USING hnsw (embeddings vector_cosine_ops);
CREATE INDEX idx_documents_name_embedding ON pdf_documents USING hnsw (name_embedding vector_cosine_ops);
