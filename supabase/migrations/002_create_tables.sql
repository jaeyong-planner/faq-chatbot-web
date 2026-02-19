-- 002_create_tables.sql
-- 모든 테이블 생성 (SQLite 스키마를 PostgreSQL로 변환)

-- pdf_documents: PDF 문서 및 이미지 파일 메타데이터
CREATE TABLE pdf_documents (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  size TEXT NOT NULL,
  upload_date TEXT NOT NULL,
  status TEXT CHECK(status IN ('processing', 'completed', 'error')) NOT NULL DEFAULT 'processing',
  upload_mode TEXT CHECK(upload_mode IN ('general', 'deepseek_ocr')) NOT NULL DEFAULT 'general',
  file_type TEXT DEFAULT 'pdf', -- 'pdf' or 'image'
  file_path TEXT,
  thumbnail_path TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  name_embedding vector(768), -- 문서명 벡터 임베딩
  ocr_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- pdf_chunks: PDF 청크 데이터 (벡터 검색용)
CREATE TABLE pdf_chunks (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES pdf_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  embeddings vector(768), -- 청크 벡터 임베딩
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- faqs: FAQ 데이터 (질문/답변 + 메타데이터)
CREATE TABLE faqs (
  id BIGSERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  image_url TEXT,
  link_url TEXT,
  attachment_url TEXT,
  attachment_name TEXT DEFAULT '',
  is_featured BOOLEAN DEFAULT false,
  featured_at TIMESTAMPTZ,
  source_chunk_ids JSONB, -- FAQ 생성에 사용된 청크 ID 배열
  page_references JSONB, -- 페이지 참조 정보
  document_link TEXT,
  semantic_keywords JSONB, -- 의미론적 키워드 배열
  related_topics JSONB, -- 관련 주제 배열
  confidence REAL DEFAULT 0.8,
  generation_source TEXT CHECK(generation_source IN ('semantic_analysis', 'manual', 'template')) DEFAULT 'manual',
  document_id BIGINT REFERENCES pdf_documents(id) ON DELETE SET NULL,
  question_embedding vector(768), -- 질문 벡터 임베딩
  answer_embedding vector(768), -- 답변 벡터 임베딩
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- chat_sessions: 채팅 세션 메타데이터
CREATE TABLE chat_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  user_name TEXT,
  user_email TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  status TEXT CHECK(status IN ('completed', 'ongoing', 'abandoned')) NOT NULL DEFAULT 'ongoing',
  satisfaction INTEGER,
  category TEXT,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  tags JSONB DEFAULT '[]'::JSONB,
  message_count INTEGER NOT NULL DEFAULT 0,
  duration TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- chat_messages: 채팅 메시지 로그
CREATE TABLE chat_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  sender TEXT CHECK(sender IN ('user', 'bot')) NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT,
  response_time INTEGER,
  confidence REAL,
  source_faq INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- settings: 애플리케이션 설정 (인증 정보 등)
CREATE TABLE settings (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);
