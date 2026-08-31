-- Fix: permanent job deletion fails with
--   "invalid input value for enum activity_action: \"extraction_deleted\""
--   "invalid input value for enum activity_action: \"extraction_result_deleted\""
-- A trigger (or audit RPC) logs an activity row on job/result deletion using
-- these action labels, but they were never added to the activity_action enum.
-- Add them so DELETE on extraction_jobs / extraction_results no longer raises
-- a 22P02 and the whole delete transaction commits.
ALTER TYPE public.activity_action
  ADD VALUE IF NOT EXISTS 'extraction_deleted';

ALTER TYPE public.activity_action
  ADD VALUE IF NOT EXISTS 'extraction_result_deleted';
