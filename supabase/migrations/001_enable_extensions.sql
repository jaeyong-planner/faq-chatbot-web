-- 001_enable_extensions.sql
-- pgvector 및 UUID 확장 활성화

-- pgvector 확장 활성화 (벡터 임베딩 검색을 위해 필요)
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- UUID 확장 활성화 (UUID 생성을 위해 필요)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
