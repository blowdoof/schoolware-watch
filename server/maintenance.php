<?php
declare(strict_types=1);

/** No raw IP storage; rotate keyed rate identities at the caller's window. */
function ratePeer(string $peer): string {
    $bytes = inet_pton($peer);
    if ($bytes === false) throw new RuntimeException('Missing peer');
    if (strlen($bytes) === 16) {
        // Treat IPv4-mapped addresses as IPv4, other IPv6 addresses as /64.
        if (substr($bytes, 0, 12) === str_repeat("\0", 10) . "\xff\xff") return 'v4:' . bin2hex(substr($bytes, 12));
        return 'v6:' . bin2hex(substr($bytes, 0, 8));
    }
    return 'v4:' . bin2hex($bytes);
}

/** CLI maintenance also reaches idle groups. Requests retain scoped cleanup. */
function purgeExpiredData(PDO $pdo, array $config): array {
    $days = $config['retention_days'] ?? 90;
    if (!in_array($days, [30, 90, 180, 365], true)) throw new RuntimeException('Invalid retention');
    $counts = ['operations' => 0, 'members' => 0, 'groups' => 0];
    $groups = $pdo->query('SELECT id FROM sw_sync_groups ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
    foreach ($groups as $id) {
        $pdo->beginTransaction();
        try {
            // Registration takes this lock before any group lock; use the same order.
            $pdo->query('SELECT singleton FROM sw_sync_registration_settings WHERE singleton = 1 FOR UPDATE')->fetchColumn();
            $lock = $pdo->prepare('SELECT id, enabled, token_hash, last_active_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY) AS expired FROM sw_sync_groups WHERE id = ? FOR UPDATE');
            $lock->execute([$days, $id]);
            $group = $lock->fetch(PDO::FETCH_ASSOC);
            if ($group !== false) {
                foreach (['operations' => ['sw_sync_group_operations', 'received_at'], 'members' => ['sw_sync_members', 'updated_at']] as $kind => [$table, $timestamp]) {
                    $delete = $pdo->prepare("DELETE FROM $table WHERE group_id = ? AND $timestamp < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)");
                    $delete->execute([$id, $days]);
                    $counts[$kind] += $delete->rowCount();
                }
                if ((int)$group['expired'] === 1) {
                    if ((int)$group['enabled'] === 0) {
                        $revoke = $pdo->prepare('INSERT IGNORE INTO sw_sync_revoked_tokens (token_hash) VALUES (?)');
                        $revoke->execute([$group['token_hash']]);
                    }
                    $delete = $pdo->prepare('DELETE FROM sw_sync_groups WHERE id = ? AND NOT EXISTS (SELECT 1 FROM sw_sync_group_operations WHERE group_id = ?) AND NOT EXISTS (SELECT 1 FROM sw_sync_members WHERE group_id = ?)');
                    $delete->execute([$id, $id, $id]);
                    $counts['groups'] += $delete->rowCount();
                }
            }
            $pdo->commit();
        } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
    }
    $pdo->exec('DELETE FROM sw_sync_request_limits WHERE window_start < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 MINUTE)');
    $pdo->exec('DELETE FROM sw_sync_registration_limits WHERE window_start < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)');
    return $counts;
}
