-- Run once on an existing installation after importing schema.sql.
-- Existing groups start their idle retention window at upgrade time.
ALTER TABLE sw_sync_groups ADD COLUMN last_active_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
