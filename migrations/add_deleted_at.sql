-- 휴지통 기능을 위한 deleted_at 컬럼 추가
-- Supabase SQL Editor에서 실행하세요

-- photos 테이블에 deleted_at 추가
ALTER TABLE photos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- folders 테이블에 deleted_at 추가
ALTER TABLE folders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 인덱스 추가 (휴지통 조회 성능 최적화)
CREATE INDEX IF NOT EXISTS idx_photos_deleted_at ON photos(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_folders_deleted_at ON folders(deleted_at) WHERE deleted_at IS NOT NULL;

-- 30일 지난 휴지통 항목 자동 삭제용 인덱스
CREATE INDEX IF NOT EXISTS idx_photos_deleted_at_cleanup ON photos(deleted_at) WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days';
