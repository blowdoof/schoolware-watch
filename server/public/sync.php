<?php
declare(strict_types=1);

// PHP 8.2 / PDO MySQL. No Schoolware transport or plaintext agenda data.
ini_set('display_errors', '0');
// The environment variable is configured by the host, never by a request.
$privateDirectory = getenv('SCHOOLWARE_SYNC_PRIVATE_DIR') ?: dirname(__DIR__) . '/private';
require $privateDirectory . '/maintenance.php';
require $privateDirectory . '/sync-policy.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function reply(int $status, array $body): never {
    http_response_code($status);
    echo json_encode($body, JSON_THROW_ON_ERROR);
    exit;
}
function exactKeys(array $value, array $keys): bool {
    $actual = array_keys($value);
    sort($actual);
    sort($keys);
    return $actual === $keys;
}
function validOperation(mixed $value): bool {
    return is_array($value) && exactKeys($value, ['id', 'iv', 'ciphertext']) &&
        is_string($value['id']) && preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D', $value['id']) === 1 &&
        is_string($value['iv']) && preg_match('/^[a-f0-9]{24}$/D', $value['iv']) === 1 &&
        is_string($value['ciphertext']) && strlen($value['ciphertext']) % 2 === 0 &&
        preg_match('/^[a-f0-9]{32,2048}$/D', $value['ciphertext']) === 1;
}

/** Commit request counters separately so failed operations still consume quota. */
function enforceRequestLimits(PDO $pdo, array $config, string $tokenHash): void {
    $globalLimit = $config['requests_per_minute'] ?? 6000;
    $tokenLimit = $config['requests_per_token_minute'] ?? 120;
    $unknownLimit = $config['requests_per_unknown_peer_minute'] ?? 120;
    foreach ([$globalLimit, $tokenLimit, $unknownLimit] as $limit) {
        if (!is_int($limit) || $limit < 1 || $limit > 100000) throw new RuntimeException('Invalid request limit');
    }
    $window = gmdate('Y-m-d H:i:00');
    $pdo->beginTransaction();
    $buckets = [];
    $known = $pdo->prepare('SELECT id FROM sw_sync_groups WHERE token_hash = ? AND enabled = 1');
    $known->execute([$tokenHash]);
    if ($known->fetchColumn() !== false) {
        $buckets[hash('sha256', 'requests:global')] = $globalLimit;
        $buckets[hash('sha256', 'requests:' . $tokenHash)] = $tokenLimit;
    } else {
        $seed = $pdo->prepare('INSERT IGNORE INTO sw_sync_registration_settings (singleton, enabled, rate_secret) VALUES (1, 0, ?)');
        $seed->execute([bin2hex(random_bytes(32))]);
        $secret = $pdo->query('SELECT rate_secret FROM sw_sync_registration_settings WHERE singleton = 1')->fetchColumn();
        if (!is_string($secret)) throw new RuntimeException('Missing rate secret');
        $peer = ratePeer($_SERVER['REMOTE_ADDR'] ?? '');
        $buckets[hash_hmac('sha256', 'unknown:' . $window . ':' . $peer, $secret)] = $unknownLimit;
    }
    $create = $pdo->prepare('INSERT INTO sw_sync_request_limits (bucket_key, window_start, requests) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE requests = requests');
    $read = $pdo->prepare('SELECT requests FROM sw_sync_request_limits WHERE bucket_key = ? AND window_start = ? FOR UPDATE');
    $increment = $pdo->prepare('UPDATE sw_sync_request_limits SET requests = requests + 1 WHERE bucket_key = ? AND window_start = ?');
    foreach ($buckets as $bucket => $limit) {
        $create->execute([$bucket, $window]);
        $read->execute([$bucket, $window]);
        if ((int)$read->fetchColumn() >= $limit) {
            $pdo->commit();
            header('Retry-After: ' . (60 - (int)gmdate('s')));
            reply(429, ['ok' => false]);
        }
        $increment->execute([$bucket, $window]);
    }
    $pdo->exec('DELETE FROM sw_sync_request_limits WHERE window_start < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 MINUTE)');
    $pdo->commit();
}

function registerGroup(PDO $pdo, array $config, string $tokenHash): never {
    // Serialize registration quotas and inserts; the caller owns the transaction.
    $settings = $pdo->query('SELECT enabled, rate_secret FROM sw_sync_registration_settings WHERE singleton = 1 FOR UPDATE')->fetch(PDO::FETCH_ASSOC);
    $revoked = $pdo->prepare('SELECT token_hash FROM sw_sync_revoked_tokens WHERE token_hash = ?');
    $revoked->execute([$tokenHash]);
    if ($revoked->fetchColumn() !== false) { $pdo->rollBack(); reply(401, ['ok' => false]); }
    $existing = $pdo->prepare('SELECT enabled FROM sw_sync_groups WHERE token_hash = ? FOR UPDATE');
    $existing->execute([$tokenHash]);
    $enabled = $existing->fetchColumn();
    if ($enabled !== false) {
        // A lost registration response can be retried without consuming quota.
        $pdo->commit();
        reply((int)$enabled === 1 ? 200 : 401, ['ok' => (int)$enabled === 1]);
    }
    if ($settings === false || (int)$settings['enabled'] !== 1) {
        $pdo->rollBack(); reply(403, ['ok' => false]);
    }
    $maxGroups = $config['max_groups'] ?? 1000;
    $globalLimit = $config['registrations_per_hour'] ?? 50;
    $peerLimit = $config['registrations_per_ip_hour'] ?? 5;
    foreach ([$maxGroups, $globalLimit, $peerLimit] as $limit) {
        if (!is_int($limit) || $limit < 1 || $limit > 100000) throw new RuntimeException('Invalid registration limit');
    }
    if ((int)$pdo->query('SELECT COUNT(*) FROM sw_sync_groups')->fetchColumn() >= $maxGroups) {
        $pdo->rollBack(); reply(429, ['ok' => false]);
    }
    $peer = ratePeer($_SERVER['REMOTE_ADDR'] ?? '');
    $window = gmdate('Y-m-d H:00:00');
    // Do not trust proxy headers or store raw IPs; rotate the keyed digest hourly.
    $buckets = [hash('sha256', 'global') => $globalLimit,
        hash_hmac('sha256', $window . ':' . $peer, $settings['rate_secret']) => $peerLimit];
    $cleanup = $pdo->prepare('DELETE FROM sw_sync_registration_limits WHERE window_start < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)');
    $cleanup->execute();
    $read = $pdo->prepare('SELECT registrations FROM sw_sync_registration_limits WHERE bucket_key = ? AND window_start = ?');
    foreach ($buckets as $bucket => $limit) {
        $read->execute([$bucket, $window]);
        if ((int)$read->fetchColumn() >= $limit) { $pdo->rollBack(); reply(429, ['ok' => false]); }
    }
    $insert = $pdo->prepare('INSERT INTO sw_sync_groups (id, token_hash) VALUES (?, ?)');
    $insert->execute([bin2hex(random_bytes(16)), $tokenHash]);
    $increment = $pdo->prepare('INSERT INTO sw_sync_registration_limits (bucket_key, window_start, registrations) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE registrations = registrations + 1');
    foreach ($buckets as $bucket => $limit) $increment->execute([$bucket, $window]);
    $pdo->commit();
    reply(200, ['ok' => true]);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') reply(405, ['ok' => false]);
// In cPanel Apache terminates TLS. Do not trust a client-supplied proxy header.
if (empty($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === 'off') reply(400, ['ok' => false]);
if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') reply(415, ['ok' => false]);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 150000) reply(413, ['ok' => false]);

$pdo = null;
try {
    // Keep the configuration outside every public document root.
    $config = require $privateDirectory . '/schoolware-sync-config.php';
    if (!is_array($config)) {
        reply(503, ['ok' => false]);
    }
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer ([a-f0-9]{64})$/D', $authorization, $matches) !== 1) reply(401, ['ok' => false]);
    $raw = file_get_contents('php://input', false, null, 0, 150001);
    if ($raw === false || strlen($raw) > 150000) reply(413, ['ok' => false]);
    $body = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($body) || !in_array($body['action'] ?? null, ['compatibility', 'register', 'exchange', 'delete', 'members', 'member.leave'], true)) reply(400, ['ok' => false]);
    if ($body['action'] === 'delete' || $body['action'] === 'register' || $body['action'] === 'compatibility') {
        if (!exactKeys($body, ['action'])) reply(400, ['ok' => false]);
    } elseif ($body['action'] === 'members') {
        if (!exactKeys($body, ['action', 'device']) || !validOperation($body['device'])) reply(400, ['ok' => false]);
    } elseif ($body['action'] === 'member.leave') {
        if (!exactKeys($body, ['action', 'id']) || !is_string($body['id']) ||
            preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D', $body['id']) !== 1) reply(400, ['ok' => false]);
    } else {
        if (!exactKeys($body, ['action', 'cursor', 'operations']) || !is_int($body['cursor']) ||
            $body['cursor'] < 0 || $body['cursor'] > 9007199254740991 || !is_array($body['operations']) ||
            !array_is_list($body['operations']) || count($body['operations']) > 50) reply(400, ['ok' => false]);
        $ids = [];
        foreach ($body['operations'] as $operation) {
            if (!validOperation($operation) || isset($ids[$operation['id']])) reply(400, ['ok' => false]);
            $ids[$operation['id']] = true;
        }
    }
    $pdo = new PDO($config['dsn'], $config['user'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
    enforceRequestLimits($pdo, $config, hash('sha256', $matches[1]));
    $policy = syncPolicy($config);
    if ($body['action'] === 'compatibility') reply(200, ['ok' => true, 'policy' => $policy]);
    // Erasure and leaving remain available to old clients. No content upload can
    // occur before this check, including a policy change after client preflight.
    if (!in_array($body['action'], ['delete', 'member.leave'], true) && !syncClientCompatible($policy, $_SERVER))
        reply(426, ['ok' => false, 'error' => 'update-required', 'policy' => $policy]);
    $pdo->beginTransaction();
    if ($body['action'] === 'register') registerGroup($pdo, $config, hash('sha256', $matches[1]));
    // Serialize revision allocation and pull visibility. AUTO_INCREMENT alone
    // can expose a later committed revision before an earlier one commits.
    $lookup = $pdo->prepare('SELECT id, revision FROM sw_sync_groups WHERE token_hash = ? AND enabled = 1 FOR UPDATE');
    $lookup->execute([hash('sha256', $matches[1])]);
    $group = $lookup->fetch(PDO::FETCH_ASSOC);
    if ($group === false) { $pdo->rollBack(); reply(401, ['ok' => false]); }
    $groupId = $group['id'];
    $revision = (int)$group['revision'];
    $touch = $pdo->prepare('UPDATE sw_sync_groups SET last_active_at = UTC_TIMESTAMP() WHERE id = ?');
    $touch->execute([$groupId]);
    if ($body['action'] === 'members') {
        $days = $config['retention_days'] ?? 90;
        if (!in_array($days, [30, 90, 180, 365], true)) throw new RuntimeException('Invalid retention');
        $cleanup = $pdo->prepare('DELETE FROM sw_sync_members WHERE group_id = ? AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)');
        $cleanup->execute([$groupId, $days]);
        $exists = $pdo->prepare('SELECT device_id FROM sw_sync_members WHERE group_id = ? AND device_id = ?');
        $exists->execute([$groupId, $body['device']['id']]);
        if ($exists->fetchColumn() === false) {
            $count = $pdo->prepare('SELECT COUNT(*) FROM sw_sync_members WHERE group_id = ?');
            $count->execute([$groupId]);
            if ((int)$count->fetchColumn() >= 50) { $pdo->rollBack(); reply(429, ['ok' => false]); }
        }
        $upsert = $pdo->prepare('INSERT INTO sw_sync_members (group_id, device_id, iv, ciphertext, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE iv = VALUES(iv), ciphertext = VALUES(ciphertext), updated_at = UTC_TIMESTAMP()');
        $upsert->execute([$groupId, $body['device']['id'], $body['device']['iv'], $body['device']['ciphertext']]);
        $select = $pdo->prepare("SELECT device_id AS id, iv, ciphertext, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s.000Z') AS lastSeenAt FROM sw_sync_members WHERE group_id = ? ORDER BY device_id LIMIT 50");
        $select->execute([$groupId]);
        $members = $select->fetchAll(PDO::FETCH_ASSOC);
        $pdo->commit(); reply(200, ['ok' => true, 'members' => $members]);
    }
    if ($body['action'] === 'member.leave') {
        $leave = $pdo->prepare('DELETE FROM sw_sync_members WHERE group_id = ? AND device_id = ?');
        $leave->execute([$groupId, $body['id']]);
        $pdo->commit(); reply(200, ['ok' => true]);
    }
    if ($body['action'] === 'delete') {
        $delete = $pdo->prepare('DELETE FROM sw_sync_group_operations WHERE group_id = ?');
        $delete->execute([$groupId]);
        $members = $pdo->prepare('DELETE FROM sw_sync_members WHERE group_id = ?');
        $members->execute([$groupId]);
        // Keep the revision counter: other clients must not skip future writes.
        $pdo->commit();
        reply(200, ['ok' => true]);
    }
    if ($body['cursor'] > $revision) {
        $pdo->rollBack(); reply(409, ['ok' => false]);
    }
    $days = $config['retention_days'] ?? 90;
    if (!in_array($days, [30, 90, 180, 365], true)) throw new RuntimeException('Invalid retention');
    $cleanup = $pdo->prepare('DELETE FROM sw_sync_group_operations WHERE group_id = ? AND received_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)');
    $cleanup->execute([$groupId, $days]);
    $count = $pdo->prepare('SELECT COUNT(*) FROM sw_sync_group_operations WHERE group_id = ?');
    $count->execute([$groupId]);
    $storedCount = (int)$count->fetchColumn();
    $exists = $pdo->prepare('SELECT revision FROM sw_sync_group_operations WHERE group_id = ? AND operation_id = ?');
    $insert = $pdo->prepare('INSERT INTO sw_sync_group_operations (group_id, revision, operation_id, iv, ciphertext, received_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())');
    $acknowledged = [];
    foreach ($body['operations'] as $operation) {
        $exists->execute([$groupId, $operation['id']]);
        if ($exists->fetchColumn() === false) {
            // Duplicate IDs do not consume capacity. Mixed batches roll back
            // atomically under the existing group lock.
            if (++$storedCount > 20000) { $pdo->rollBack(); reply(503, ['ok' => false]); }
            if ($revision >= 9007199254740991) throw new RuntimeException('Revision exhausted');
            $insert->execute([$groupId, ++$revision, $operation['id'], $operation['iv'], $operation['ciphertext']]);
        }
        $acknowledged[] = $operation['id'];
    }
    $update = $pdo->prepare('UPDATE sw_sync_groups SET revision = ? WHERE id = ?');
    $update->execute([$revision, $groupId]);
    $select = $pdo->prepare('SELECT revision, operation_id AS id, iv, ciphertext FROM sw_sync_group_operations WHERE group_id = ? AND revision > ? ORDER BY revision LIMIT 200');
    $select->execute([$groupId, $body['cursor']]);
    $operations = $select->fetchAll(PDO::FETCH_ASSOC);
    foreach ($operations as &$operation) $operation['revision'] = (int)$operation['revision'];
    unset($operation);
    $cursor = count($operations) ? $operations[count($operations) - 1]['revision'] : $revision;
    $pdo->commit();
    reply(200, ['ok' => true, 'acknowledged' => $acknowledged, 'cursor' => $cursor, 'head' => $revision, 'operations' => $operations]);
} catch (JsonException) {
    if ($pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    reply(400, ['ok' => false]);
} catch (Throwable) {
    if ($pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    // Do not expose database credentials, payloads or exception details.
    reply(503, ['ok' => false]);
}
