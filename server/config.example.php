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
    // Self-registration is enabled separately by the private CLI.
    'max_groups' => 1000,
    'registrations_per_hour' => 50,
    'registrations_per_ip_hour' => 5,
];
