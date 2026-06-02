-- Migration: rename pulse_log to pulse_log_legacy
-- ECBRAIN V1 — conditional rename approved in Phase 0.
-- Architecture ref: §9.1. Correction v3.2: dependency check passed (Phase 1).
--
-- Dependency check results (2026-05-07):
--   Views referencing pulse_log:    none
--   Functions referencing pulse_log: none
--   FK constraints pointing at it:   none
--   Policies on pulse_log:           none
--   Non-internal triggers on it:     none
--
-- pulse_log is empty (0 rows), life_engine-shaped (not pulse_entries-shaped),
-- and unreferenced at runtime. Renaming avoids name confusion with the new
-- pulse_entries table while preserving the old table for audit.

ALTER TABLE pulse_log RENAME TO pulse_log_legacy
;
