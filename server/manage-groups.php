<?php
declare(strict_types=1);

// Run privately in cPanel Terminal, never from a public document root.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$pdo = null;
try {
    $config = require '/home/example-account/schoolware-sync-config.php';
    $pdo = new PDO($config['dsn'], $config['user'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $command = $argv[1] ?? '';
    if ($command === 'enable-registration' && count($argv) === 2) {
        $enable = $pdo->prepare('INSERT INTO sw_sync_registration_settings (singleton, enabled, rate_secret) VALUES (1, 1, ?) ON DUPLICATE KEY UPDATE enabled = 1');
        $enable->execute([bin2hex(random_bytes(32))]);
        echo "Self-service group registration enabled. Existing groups are unchanged.\n";
    } elseif ($command === 'disable-registration' && count($argv) === 2) {
        $pdo->exec('UPDATE sw_sync_registration_settings SET enabled = 0 WHERE singleton = 1');
        echo "New group registration disabled. Existing groups can still synchronize.\n";
    } elseif ($command === 'create' && count($argv) === 2) {
        $id = bin2hex(random_bytes(16));
        $token = bin2hex(random_bytes(32));
        $insert = $pdo->prepare('INSERT INTO sw_sync_groups (id, token_hash) VALUES (?, ?)');
        $insert->execute([$id, hash('sha256', $token)]);
        echo "Group ID: $id\nAccess token (save privately, shown only once): $token\n";
    } elseif ($command === 'migrate-legacy' && count($argv) === 2) {
        $hash = $config['token_hash'] ?? '';
        if (!is_string($hash) || preg_match('/^[a-f0-9]{64}$/D', $hash) !== 1) {
            throw new RuntimeException('Legacy verifier missing');
        }
        $pdo->beginTransaction();
        $revision = $pdo->query('SELECT revision FROM sw_sync_meta WHERE singleton = 1 FOR UPDATE')->fetchColumn();
        if ($revision === false) throw new RuntimeException('Legacy metadata missing');
        $existing = $pdo->prepare('SELECT id FROM sw_sync_groups WHERE token_hash = ?');
        $existing->execute([$hash]);
        if ($existing->fetchColumn() !== false) {
            $pdo->rollBack();
            echo "Legacy group already exists; no data changed.\n";
            exit;
        }
        $id = bin2hex(random_bytes(16));
        $insert = $pdo->prepare('INSERT INTO sw_sync_groups (id, token_hash, revision) VALUES (?, ?, ?)');
        $insert->execute([$id, $hash, $revision]);
        $copy = $pdo->prepare('INSERT INTO sw_sync_group_operations (group_id, revision, operation_id, iv, ciphertext, received_at) SELECT ?, revision, operation_id, iv, ciphertext, received_at FROM sw_sync_operations');
        $copy->execute([$id]);
        $pdo->commit();
        echo "Legacy group migrated: $id\nExisting tokens, pairing codes and cursors remain valid.\n";
    } elseif ($command === 'disable' && count($argv) === 3 && preg_match('/^[a-f0-9]{32}$/D', $argv[2]) === 1) {
        $disable = $pdo->prepare('UPDATE sw_sync_groups SET enabled = 0 WHERE id = ?');
        $disable->execute([$argv[2]]);
        echo "Matching group disabled; all its devices lose access.\n";
    } else {
        fwrite(STDERR, "Usage: php manage-groups.php enable-registration | disable-registration | create | migrate-legacy | disable GROUP_ID\n");
        exit(1);
    }
} catch (Throwable) {
    if ($pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    // Never print connection details or credentials.
    fwrite(STDERR, "Group management failed. Check private configuration and imported schema.\n");
    exit(1);
}
