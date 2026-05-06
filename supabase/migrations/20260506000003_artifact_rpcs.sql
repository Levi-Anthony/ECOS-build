SET search_path = public, extensions;

-- match_artifact_chunks: vector similarity search over artifact sections.
-- Defaults to current approved complete versions only (safe retrieval for agents).
-- Set include_drafts=true for draft review mode.
--
-- Depends on: 20260506000001 (canonical_artifacts, artifact_versions, artifact_chunks)

CREATE OR REPLACE FUNCTION match_artifact_chunks(
  query_embedding   vector(1536),
  match_threshold   float    DEFAULT 0.38,
  match_count       int      DEFAULT 10,
  filter_authority  text     DEFAULT NULL,
  filter_doc_type   text     DEFAULT NULL,
  filter_scope      text     DEFAULT NULL,
  include_drafts    boolean  DEFAULT false
)
RETURNS TABLE (
  chunk_id        uuid,
  artifact_id     uuid,
  version_id      uuid,
  section_title   text,
  section_path    text,
  content         text,
  chunk_index     int,
  similarity      float,
  artifact_title  text,
  doc_type        text,
  authority_level text,
  review_status   text,
  scope           text,
  source_path     text
)
LANGUAGE sql STABLE AS $$
  SELECT
    ac.id                                    AS chunk_id,
    ac.artifact_id,
    ac.version_id,
    ac.section_title,
    ac.section_path,
    ac.content,
    ac.chunk_index,
    1 - (ac.embedding <=> query_embedding)   AS similarity,
    ca.title                                 AS artifact_title,
    ca.doc_type,
    ca.authority_level,
    av.review_status,
    ca.scope,
    ca.source_path
  FROM artifact_chunks   ac
  JOIN canonical_artifacts ca ON ca.id = ac.artifact_id
  JOIN artifact_versions   av ON av.id = ac.version_id
  WHERE
    1 - (ac.embedding <=> query_embedding) >= match_threshold
    -- Safe default: current approved complete chunks only.
    -- include_drafts=true bypasses this and searches all versions.
    AND (
      include_drafts
      OR (
        ca.current_version_id  = ac.version_id
        AND av.review_status   = 'approved'
        AND av.chunking_status = 'complete'
      )
    )
    AND (filter_authority IS NULL OR ca.authority_level = filter_authority)
    AND (filter_doc_type  IS NULL OR ca.doc_type        = filter_doc_type)
    AND (filter_scope     IS NULL OR ca.scope           = filter_scope)
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
