-- 004_create_rpc_functions.sql
-- RPC 함수 생성 (벡터 검색 및 통계 함수)

-- 1. FAQ 질문 벡터 검색
CREATE OR REPLACE FUNCTION search_faqs_by_question(
  query_embedding vector(768),
  similarity_threshold REAL DEFAULT 0.45,
  match_count INTEGER DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  question TEXT,
  answer TEXT,
  category TEXT,
  is_active BOOLEAN,
  is_featured BOOLEAN,
  semantic_keywords JSONB,
  confidence REAL,
  generation_source TEXT,
  document_id BIGINT,
  similarity REAL
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.question,
    f.answer,
    f.category,
    f.is_active,
    f.is_featured,
    f.semantic_keywords,
    f.confidence,
    f.generation_source,
    f.document_id,
    (1 - (f.question_embedding <=> query_embedding))::REAL AS similarity
  FROM faqs f
  WHERE f.question_embedding IS NOT NULL
    AND (1 - (f.question_embedding <=> query_embedding)) > similarity_threshold
  ORDER BY f.question_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 2. FAQ 답변 벡터 검색
CREATE OR REPLACE FUNCTION search_faqs_by_answer(
  query_embedding vector(768),
  similarity_threshold REAL DEFAULT 0.45,
  match_count INTEGER DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  question TEXT,
  answer TEXT,
  category TEXT,
  is_active BOOLEAN,
  is_featured BOOLEAN,
  semantic_keywords JSONB,
  confidence REAL,
  generation_source TEXT,
  document_id BIGINT,
  similarity REAL
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.question,
    f.answer,
    f.category,
    f.is_active,
    f.is_featured,
    f.semantic_keywords,
    f.confidence,
    f.generation_source,
    f.document_id,
    (1 - (f.answer_embedding <=> query_embedding))::REAL AS similarity
  FROM faqs f
  WHERE f.answer_embedding IS NOT NULL
    AND (1 - (f.answer_embedding <=> query_embedding)) > similarity_threshold
  ORDER BY f.answer_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 3. 청크 벡터 검색
CREATE OR REPLACE FUNCTION search_chunks(
  query_embedding vector(768),
  similarity_threshold REAL DEFAULT 0.45,
  match_count INTEGER DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  document_id BIGINT,
  content TEXT,
  page_number INTEGER,
  chunk_index INTEGER,
  metadata JSONB,
  similarity REAL
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.content,
    c.page_number,
    c.chunk_index,
    c.metadata,
    (1 - (c.embeddings <=> query_embedding))::REAL AS similarity
  FROM pdf_chunks c
  WHERE c.embeddings IS NOT NULL
    AND (1 - (c.embeddings <=> query_embedding)) > similarity_threshold
  ORDER BY c.embeddings <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 4. 문서명 벡터 검색
CREATE OR REPLACE FUNCTION search_documents_by_name(
  query_embedding vector(768),
  similarity_threshold REAL DEFAULT 0.3,
  match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id BIGINT,
  name TEXT,
  size TEXT,
  upload_date TEXT,
  status TEXT,
  upload_mode TEXT,
  file_path TEXT,
  similarity REAL
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.name,
    d.size,
    d.upload_date,
    d.status,
    d.upload_mode,
    d.file_path,
    (1 - (d.name_embedding <=> query_embedding))::REAL AS similarity
  FROM pdf_documents d
  WHERE d.name_embedding IS NOT NULL
    AND (1 - (d.name_embedding <=> query_embedding)) > similarity_threshold
  ORDER BY d.name_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 5. 대시보드 메트릭스 조회
CREATE OR REPLACE FUNCTION get_dashboard_metrics()
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'totalFaqs', (SELECT COUNT(*) FROM faqs WHERE is_active = true),
    'monthlyQuestions', (
      SELECT COUNT(*)
      FROM chat_messages
      WHERE sender = 'user'
        AND EXTRACT(YEAR FROM timestamp::TIMESTAMP) = EXTRACT(YEAR FROM NOW())
        AND EXTRACT(MONTH FROM timestamp::TIMESTAMP) = EXTRACT(MONTH FROM NOW())
    ),
    'responseRate', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE COUNT(*) FILTER (WHERE is_resolved = true)::FLOAT / COUNT(*)::FLOAT
      END
      FROM chat_sessions
    ),
    'avgResponseTimeMs', (
      SELECT AVG(response_time)
      FROM chat_messages
      WHERE response_time IS NOT NULL AND response_time > 0
    ),
    'lastActivity', (
      SELECT MAX(combined.timestamp)
      FROM (
        SELECT created_at::TEXT AS timestamp FROM faqs
        UNION ALL
        SELECT created_at::TEXT AS timestamp FROM pdf_documents
        UNION ALL
        SELECT timestamp FROM chat_messages
      ) combined
    ),
    'satisfactionAverage', (
      SELECT AVG(satisfaction)
      FROM chat_sessions
      WHERE satisfaction IS NOT NULL
    ),
    'satisfactionCount', (
      SELECT COUNT(*)
      FROM chat_sessions
      WHERE satisfaction IS NOT NULL
    ),
    'faqCategoryDistribution', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
      FROM (
        SELECT
          COALESCE(category, '미분류') AS category,
          COUNT(*) AS count
        FROM faqs
        GROUP BY category
        ORDER BY count DESC
        LIMIT 6
      ) t
    ),
    'recentActivities', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
      FROM (
        SELECT * FROM (
          SELECT
            'FAQ 추가' AS action,
            question AS item,
            created_at::TEXT AS timestamp
          FROM faqs
          UNION ALL
          SELECT
            '문서 업로드' AS action,
            name AS item,
            created_at::TEXT AS timestamp
          FROM pdf_documents
        ) activities
        WHERE timestamp IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 6
      ) t
    ),
    'recentConversations', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
      FROM (
        SELECT
          um.session_id AS "sessionId",
          um.message AS "userMessage",
          COALESCE(bm.message, '응답 없음') AS "botResponse",
          um.timestamp,
          cs.satisfaction,
          bm.confidence
        FROM chat_messages um
        LEFT JOIN LATERAL (
          SELECT message, confidence
          FROM chat_messages
          WHERE session_id = um.session_id
            AND sender = 'bot'
            AND id > um.id
          ORDER BY id ASC
          LIMIT 1
        ) bm ON true
        LEFT JOIN chat_sessions cs ON cs.session_id = um.session_id
        WHERE um.sender = 'user'
        ORDER BY um.timestamp DESC
        LIMIT 5
      ) t
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- 6. 채팅 분석 조회
CREATE OR REPLACE FUNCTION get_chat_analytics(period TEXT DEFAULT 'month')
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
  date_filter INTERVAL;
BEGIN
  -- 화이트리스트 기반 기간 필터 (SQL Injection 방지)
  date_filter := CASE period
    WHEN 'today' THEN INTERVAL '1 day'
    WHEN 'week' THEN INTERVAL '7 days'
    WHEN 'month' THEN INTERVAL '30 days'
    ELSE INTERVAL '30 days'
  END;

  SELECT json_build_object(
    'hourlyDistribution', (
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT
          lpad(hour_num::TEXT, 2, '0') AS hour,
          COALESCE(counts.count, 0) AS count
        FROM generate_series(0, 23) AS hour_num
        LEFT JOIN (
          SELECT
            EXTRACT(HOUR FROM timestamp::TIMESTAMP)::INTEGER AS hour,
            COUNT(*) AS count
          FROM chat_messages
          WHERE sender = 'user'
            AND timestamp IS NOT NULL
            AND timestamp::TIMESTAMP >= NOW() - date_filter
          GROUP BY EXTRACT(HOUR FROM timestamp::TIMESTAMP)
        ) counts ON counts.hour = hour_num
        ORDER BY hour_num
      ) t
    ),
    'topQuestions', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
      FROM (
        SELECT
          COALESCE(f.question, '미지정 FAQ') AS question,
          f.category,
          COUNT(*) AS count
        FROM chat_messages cm
        JOIN faqs f ON f.id = cm.source_faq
        WHERE cm.sender = 'bot'
          AND cm.source_faq IS NOT NULL
          AND cm.timestamp::TIMESTAMP >= NOW() - date_filter
        GROUP BY f.id, f.question, f.category
        ORDER BY count DESC
        LIMIT 5
      ) t
    ),
    'satisfactionAverage', (
      SELECT AVG(satisfaction)
      FROM chat_sessions
      WHERE satisfaction IS NOT NULL
        AND start_time::TIMESTAMP >= NOW() - date_filter
    ),
    'resolutionRate', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN NULL
        ELSE COUNT(*) FILTER (WHERE is_resolved = true)::FLOAT / COUNT(*)::FLOAT
      END
      FROM chat_sessions
      WHERE start_time::TIMESTAMP >= NOW() - date_filter
    ),
    'activeUsers', (
      SELECT COUNT(DISTINCT
        COALESCE(
          NULLIF(TRIM(user_email), ''),
          NULLIF(TRIM(user_name), ''),
          session_id
        )
      )
      FROM chat_sessions
      WHERE start_time::TIMESTAMP >= NOW() - date_filter
    )
  ) INTO result;

  RETURN result;
END;
$$;
