-- Additive schema: legacy tables are retained until migration is verified.
CREATE TABLE IF NOT EXISTS sw_sync_groups (
    id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    enabled TINYINT UNSIGNED NOT NULL DEFAULT 1
) ENGINE=InnoDB;

-- Participant labels remain encrypted and are scoped to the authenticated group.
CREATE TABLE IF NOT EXISTS sw_sync_members (
    group_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    iv CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ciphertext VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, device_id),
    INDEX retention (group_id, updated_at),
    FOREIGN KEY (group_id) REFERENCES sw_sync_groups(id)
) ENGINE=InnoDB;

-- No registration is possible until the private CLI enables it.
CREATE TABLE IF NOT EXISTS sw_sync_registration_settings (
    singleton TINYINT UNSIGNED PRIMARY KEY,
    enabled TINYINT UNSIGNED NOT NULL DEFAULT 0,
    rate_secret CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sw_sync_registration_limits (
    bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    window_start DATETIME NOT NULL,
    registrations INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_key, window_start)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sw_sync_group_operations (
    group_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    iv CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ciphertext VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, revision),
    UNIQUE KEY operation_identity (group_id, operation_id),
    INDEX retention (group_id, received_at),
    FOREIGN KEY (group_id) REFERENCES sw_sync_groups(id)
) ENGINE=InnoDB;
