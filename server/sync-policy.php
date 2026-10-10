<?php
declare(strict_types=1);

function syncVersion(mixed $value): bool {
    if (!is_string($value) || preg_match('/^(?:0|[1-9][0-9]{0,4})(?:\.(?:0|[1-9][0-9]{0,4})){1,3}$/D', $value) !== 1) return false;
    foreach (explode('.', $value) as $part) if ((int)$part > 65535) return false;
    return true;
}
function syncCompareVersions(string $left, string $right): int {
    $a = array_pad(array_map('intval', explode('.', $left)), 4, 0);
    $b = array_pad(array_map('intval', explode('.', $right)), 4, 0);
    for ($i = 0; $i < 4; $i++) if ($a[$i] !== $b[$i]) return $a[$i] <=> $b[$i];
    return 0;
}
function syncPolicy(array $config): array {
    $policy = ['minimumProtocol' => $config['sync_minimum_protocol'] ?? 3,
        'maximumProtocol' => $config['sync_maximum_protocol'] ?? 3,
        'minimumVersion' => $config['sync_minimum_version'] ?? '0.4.0',
        'latestVersion' => $config['sync_latest_published_version'] ?? null];
    if (!is_int($policy['minimumProtocol']) || !is_int($policy['maximumProtocol']) || $policy['minimumProtocol'] < 1 ||
        $policy['maximumProtocol'] < $policy['minimumProtocol'] || $policy['maximumProtocol'] > 1000 || !syncVersion($policy['minimumVersion']) ||
        ($policy['latestVersion'] !== null && (!syncVersion($policy['latestVersion']) || syncCompareVersions($policy['latestVersion'], $policy['minimumVersion']) < 0)))
        throw new RuntimeException('Invalid synchronization policy');
    return $policy;
}
function syncClientCompatible(array $policy, array $server): bool {
    $version = $server['HTTP_X_SCHOOLWARE_VERSION'] ?? null;
    $protocol = $server['HTTP_X_SCHOOLWARE_PROTOCOL'] ?? null;
    return syncVersion($version) && is_string($protocol) && preg_match('/^[1-9][0-9]{0,3}$/D', $protocol) === 1 &&
        (int)$protocol >= $policy['minimumProtocol'] && (int)$protocol <= $policy['maximumProtocol'] &&
        syncCompareVersions($version, $policy['minimumVersion']) >= 0;
}
