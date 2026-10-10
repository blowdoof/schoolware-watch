<?php
declare(strict_types=1);

// Copy outside the public document root as schoolware-sync-config.php.
// Never commit the populated file or use a Schoolware password here.
return [
    'dsn' => 'mysql:host=localhost;dbname=example_sync;charset=utf8mb4',
    'user' => 'example_sync',
    'password' => 'REPLACE_WITH_DATABASE_PASSWORD',
    // Group token verifiers are stored in sw_sync_groups, not this file.
    // Keep the legacy token_hash temporarily only when migrating an old server.
    'retention_days' => 90,
    'sync_minimum_protocol' => 3,
    'sync_maximum_protocol' => 3,
    'sync_minimum_version' => '0.4.0',
    // Set only after this version is actually available in the Chrome Web Store.
    'sync_latest_published_version' => null,
    // Self-registration is enabled separately by the private CLI.
    'max_groups' => 1000,
    'registrations_per_hour' => 50,
    'registrations_per_ip_hour' => 5,
    // All valid API actions, including retries and failed operations.
    'requests_per_minute' => 6000,
    'requests_per_token_minute' => 120,
    'requests_per_unknown_peer_minute' => 120,
];
