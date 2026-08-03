-- Add progress JSON column to extraction_jobs for real-time progress tracking
ALTER TABLE extraction_jobs
  ADD COLUMN IF NOT EXISTS progress JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN extraction_jobs.progress IS 'Real-time extraction progress: {discovered, processed, duplicates_skipped, estimate, phase, phase_cycle, last_update}';
