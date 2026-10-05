"""Synthetic API integration test against an isolated local MySQL test server.

Usage: python integration.py --php PATH --mysql PATH --mysql-port 33307
The MySQL instance must be disposable, bound to localhost, with root/no password.
No production host, user data or real credential is used by this harness.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--php', required=True)
    parser.add_argument('--mysql', required=True)
    parser.add_argument('--mysql-port', type=int, default=33307)
    parser.add_argument('--legacy-compatibility', action='store_true')
    args = parser.parse_args()
    if args.mysql_port != 33307:
        raise ValueError('Use the dedicated isolated test port 33307')
    database = 'synthetic_sync_' + uuid.uuid4().hex
    root = Path(__file__).resolve().parents[1]
    mysql = [args.mysql, '--host=127.0.0.1', '--port=33307', '--user=root']
    schema = f'CREATE DATABASE {database}; USE {database};\n' + (root / 'schema.sql').read_text()
    subprocess.run(mysql, input=schema, text=True, check=True, capture_output=True)
    token = 'a' * 64
    processes = []
    try:
        with tempfile.TemporaryDirectory(prefix='schoolware-api-test-') as folder:
            folder = Path(folder)
            public = folder / 'public'
            public.mkdir()
            (folder / 'maintenance.php').write_text((root / 'maintenance.php').read_text(), encoding='utf-8')
            # Rewrite only the fixed production path in the disposable test copies.
            for source, destination in [(root / 'public/sync.php', public / 'sync.php'),
                                        (root / 'manage-groups.php', folder / 'manage-groups.php')]:
                destination.write_text(source.read_text().replace(
                    "'/home/example-account/maintenance.php'",
                    "'" + (folder / 'maintenance.php').as_posix() + "'").replace(
                    "'/home/example-account/schoolware-sync-config.php'",
                    "'" + (folder / 'schoolware-sync-config.php').as_posix() + "'"), encoding='utf-8')
            def configure(extra=''):
                (folder / 'schoolware-sync-config.php').write_text(
                    "<?php return ['dsn'=>'mysql:host=127.0.0.1;port=33307;dbname=" + database +
                    "','user'=>'root','password'=>'','token_hash'=>'" + hashlib.sha256(token.encode()).hexdigest() +
                    "','retention_days'=>90,'requests_per_token_minute'=>10000" + extra + "];", encoding='utf-8')
            configure()
            php = [args.php, '-d', 'extension_dir=' + str(Path(args.php).parent / 'ext'), '-d', 'extension=pdo_mysql']
            def sql(statement):
                return subprocess.run(mysql, input=f'USE {database};\n' + statement, text=True,
                    check=True, capture_output=True).stdout

            # Verify additive maintenance upgrade on a populated older schema.
            migrated_id = uuid.uuid4().hex
            sql("ALTER TABLE sw_sync_groups DROP COLUMN last_active_at; INSERT INTO sw_sync_groups (id, token_hash, revision) VALUES ('" + migrated_id + "', '" + '1' * 64 + "', 42);")
            sql((root / 'migrations/20261005-maintenance.sql').read_text())
            assert sql("SELECT revision FROM sw_sync_groups WHERE id = '" + migrated_id + "';").splitlines()[-1] == '42'
            sql("DELETE FROM sw_sync_groups WHERE id = '" + migrated_id + "';")

            # Synthetic legacy installation; preserve revision/cursor even without records.
            sql('CREATE TABLE sw_sync_meta (singleton INT PRIMARY KEY, revision BIGINT NOT NULL) ENGINE=InnoDB; '
                'INSERT INTO sw_sync_meta VALUES (1, 0); '
                'CREATE TABLE sw_sync_operations (revision BIGINT PRIMARY KEY, operation_id CHAR(36), '
                'iv CHAR(24), ciphertext VARCHAR(2048), received_at TIMESTAMP) ENGINE=InnoDB;')
            legacy = {'id': str(uuid.uuid4()), 'iv': '0' * 24, 'ciphertext': '4' * 320}
            sql("INSERT INTO sw_sync_operations VALUES (7, '" + legacy['id'] + "', '" + legacy['iv'] +
                "', '" + legacy['ciphertext'] + "', UTC_TIMESTAMP()); UPDATE sw_sync_meta SET revision = 9;")
            manager = php + [str(folder / 'manage-groups.php')]
            subprocess.run(manager + ['migrate-legacy'], check=True, capture_output=True)
            assert 'already exists' in subprocess.run(manager + ['migrate-legacy'], check=True, capture_output=True, text=True).stdout
            created = subprocess.run(manager + ['create'], check=True, capture_output=True, text=True).stdout.splitlines()
            other_id = created[0].split(': ')[1]
            other_token = created[1].split(': ')[1]
            # Test only: emulate Apache's HTTPS server variable locally. This
            # does not replace a live TLS smoke test on the actual cPanel host.
            router = folder / 'router.php'
            router.write_text("<?php $_SERVER['HTTPS']='on'; require __DIR__.'/public/sync.php';", encoding='utf-8')
            ports = []
            # Independent PHP processes exercise actual concurrent DB transactions.
            for _ in range(4):
                with socket.socket() as sock:
                    sock.bind(('127.0.0.1', 0))
                    ports.append(sock.getsockname()[1])
                processes.append(subprocess.Popen(php + ['-S', f'127.0.0.1:{ports[-1]}', str(router)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))

            def call(body, bearer=token, server=0, include_headers=False):
                request = urllib.request.Request(f'http://127.0.0.1:{ports[server]}/sync.php',
                    data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + bearer})
                try:
                    with urllib.request.urlopen(request, timeout=5) as result:
                        value = (result.status, json.load(result))
                        return (*value, result.headers.get('Retry-After')) if include_headers else value
                except urllib.error.HTTPError as error:
                    value = (error.code, json.load(error))
                    return (*value, error.headers.get('Retry-After')) if include_headers else value

            empty = {'action': 'exchange', 'cursor': 0, 'operations': []}
            for _ in range(30):
                try:
                    status, result = call(empty)
                    break
                except urllib.error.URLError:
                    time.sleep(0.1)
            assert status == 200, (status, result)
            assert result['head'] == 9 and result['operations'][0]['id'] == legacy['id']
            assert call({'action': 'delete'})[0] == 200
            assert call({**empty, 'cursor': 9})[1]['head'] == 9
            if args.legacy_compatibility:
                subprocess.run(['node', str(root / 'tests/legacy-compatibility.mjs'),
                                f'http://127.0.0.1:{ports[0]}/sync.php', token], check=True)
            # Reset only this synthetic fixture for the existing pagination assertions.
            sql('UPDATE sw_sync_groups SET revision = 0;')
            assert call(empty, 'b' * 64)[0] == 401
            assert call({**empty, 'password': 'synthetic'})[0] == 400
            assert call({**empty, 'cursor': -1})[0] == 400
            operation = {'id': str(uuid.uuid4()), 'iv': '1' * 24, 'ciphertext': '2' * 320}
            assert call({**empty, 'operations': [operation, {**operation, 'id': 'invalid'}]})[0] == 400
            assert call(empty)[1]['operations'] == []
            status, result = call({**empty, 'operations': [operation]})
            assert status == 200 and result['cursor'] == 1 and result['acknowledged'] == [operation['id']]
            assert result['operations'][0]['ciphertext'] == operation['ciphertext']
            retry = call({**empty, 'operations': [{**operation, 'ciphertext': '3' * 320}]})[1]
            assert retry['cursor'] == 1 and retry['operations'][0]['ciphertext'] == operation['ciphertext']
            assert call({**empty, 'cursor': 1})[1]['operations'] == []
            assert call({**empty, 'cursor': 2})[0] == 409
            # Exercise pagination, monotonic revisions and deletion.
            for _ in range(5):
                batch = [{**operation, 'id': str(uuid.uuid4())} for _ in range(50)]
                assert call({**empty, 'operations': batch})[0] == 200
            first_page = call(empty)[1]
            assert len(first_page['operations']) == 200 and first_page['cursor'] == 200
            second_page = call({**empty, 'cursor': 200})[1]
            assert len(second_page['operations']) == 51 and second_page['cursor'] == 251
            # The same operation ID has independent identity in another group.
            assert call(empty, other_token)[1]['operations'] == []
            other = call({**empty, 'operations': [{**operation, 'ciphertext': '5' * 320}]}, other_token)[1]
            assert other['head'] == 1 and other['operations'][0]['ciphertext'] == '5' * 320
            assert call(empty)[1]['head'] == 251
            assert call({**empty, 'group_id': other_id})[0] == 400
            assert call({'action': 'delete', 'group_id': other_id})[0] == 400
            # Names travel as ciphertext in a separate channel, so old clients
            # can keep consuming the original progress stream unchanged.
            member = {'id': str(uuid.uuid4()), 'iv': '6' * 24, 'ciphertext': '7' * 64}
            member_request = {'action': 'members', 'device': member}
            own_members = call(member_request)[1]['members']
            assert len(own_members) == 1 and own_members[0]['id'] == member['id']
            assert set(own_members[0]) == {'id', 'iv', 'ciphertext', 'lastSeenAt'}
            assert own_members[0]['lastSeenAt'].endswith('.000Z')
            peer = {**member, 'id': str(uuid.uuid4())}
            assert len(call({'action': 'members', 'device': peer})[1]['members']) == 2
            other_member = {**member, 'ciphertext': '8' * 64}
            assert len(call({'action': 'members', 'device': other_member}, other_token)[1]['members']) == 1
            updated = call({'action': 'members', 'device': {**member, 'ciphertext': '9' * 64}})[1]['members']
            assert next(row for row in updated if row['id'] == member['id'])['ciphertext'] == '9' * 64
            assert call(member_request, 'b' * 64)[0] == 401
            assert call({**member_request, 'group_id': other_id})[0] == 400
            assert call({'action': 'members', 'device': {**member, 'label': 'Synthetic private name'}})[0] == 400
            assert call({'action': 'member.leave', 'id': member['id']})[0] == 200
            assert call({'action': 'members', 'device': other_member}, other_token)[1]['members'][0]['ciphertext'] == '8' * 64
            assert call({'action': 'member.leave', 'id': 'invalid'})[0] == 400
            assert call(member_request)[0] == 200
            for _ in range(48):
                assert call({'action': 'members', 'device': {**member, 'id': str(uuid.uuid4())}})[0] == 200
            assert call({'action': 'members', 'device': {**member, 'id': str(uuid.uuid4())}})[0] == 429
            assert len(call(member_request)[1]['members']) == 50  # Existing member can still refresh.
            assert len(call({'action': 'members', 'device': other_member}, other_token)[1]['members']) == 1
            assert call(empty)[1]['head'] == 251  # No membership record enters progress revisions.
            # Expired ciphertext cleanup cannot affect another group's rows.
            sql("UPDATE sw_sync_group_operations SET received_at = '2000-01-01' WHERE group_id = '" + other_id + "';")
            assert call(empty)[0] == 200
            assert sql("SELECT COUNT(*) FROM sw_sync_group_operations WHERE group_id = '" + other_id + "';").splitlines()[-1] == '1'
            sql("UPDATE sw_sync_group_operations SET received_at = UTC_TIMESTAMP() WHERE group_id = '" + other_id + "';")
            assert call({'action': 'delete'})[0] == 200
            assert len(call(member_request)[1]['members']) == 1  # Remote deletion cleared all older members.
            assert call(empty)[1]['operations'] == []
            assert call(empty, other_token)[1]['operations'][0]['ciphertext'] == '5' * 320
            # Capacity is enforced per group; a full group cannot block another.
            rows = ["('" + other_id + "', " + str(revision) + ", '" + str(uuid.uuid4()) +
                    "', '" + '0' * 24 + "', '" + '0' * 32 + "', UTC_TIMESTAMP())"
                    for revision in range(2, 20001)]
            sql('INSERT INTO sw_sync_group_operations VALUES ' + ','.join(rows) + '; '
                "UPDATE sw_sync_groups SET revision = 20000 WHERE id = '" + other_id + "';")
            # A full group accepts duplicate-only retries, even with a lost ack.
            assert call({**empty, 'operations': [operation]}, other_token)[0] == 200
            new_operation = {**operation, 'id': str(uuid.uuid4())}
            assert call({**empty, 'operations': [operation, new_operation]}, other_token)[0] == 503
            assert sql("SELECT COUNT(*) FROM sw_sync_group_operations WHERE group_id = '" + other_id + "';").splitlines()[-1] == '20000'
            # One free slot: a mixed retry can fill it, but an oversized batch
            # must roll back both its insert and revision update.
            sql("DELETE FROM sw_sync_group_operations WHERE group_id = '" + other_id + "' AND revision = 20000;")
            assert call({**empty, 'operations': [new_operation, {**operation, 'id': str(uuid.uuid4())}]}, other_token)[0] == 503
            assert sql("SELECT COUNT(*) FROM sw_sync_group_operations WHERE group_id = '" + other_id + "';").splitlines()[-1] == '19999'
            assert sql("SELECT revision FROM sw_sync_groups WHERE id = '" + other_id + "';").splitlines()[-1] == '20000'
            assert call({**empty, 'operations': [operation, new_operation]}, other_token)[0] == 200
            assert call({**empty, 'operations': [new_operation]}, other_token)[0] == 200
            assert call({**empty, 'operations': [{**operation, 'id': str(uuid.uuid4())}]}, other_token)[0] == 503
            assert call(empty)[0] == 200
            assert sql("SELECT revision FROM sw_sync_groups WHERE id = '" + other_id + "';").splitlines()[-1] == '20001'
            # Cleanup removes only expired records belonging to the caller.
            sql("UPDATE sw_sync_group_operations SET received_at = '2000-01-01' WHERE group_id = '" + other_id + "';")
            assert call(empty, other_token)[1]['operations'] == []
            assert call(empty, other_token)[1]['head'] == 20001
            subprocess.run(manager + ['disable', other_id], check=True, capture_output=True)
            assert call(empty, other_token)[0] == 401
            assert call({'action': 'delete'}, other_token)[0] == 401
            assert call({'action': 'members', 'device': other_member}, other_token)[0] == 401
            after_delete = call({**empty, 'cursor': 251, 'operations': [{**operation, 'id': str(uuid.uuid4())}]})[1]
            assert after_delete['cursor'] == 252
            # Self-registration is off by default and never enrolls via exchange.
            registration = {'action': 'register'}
            new_token = 'c' * 64
            assert call(empty, new_token)[0] == 401
            assert call(registration, new_token)[0] == 403
            subprocess.run(manager + ['enable-registration'], check=True, capture_output=True)
            configure(", 'registrations_per_ip_hour'=>1, 'registrations_per_hour'=>2")
            before_count = int(sql('SELECT COUNT(*) FROM sw_sync_groups;').splitlines()[-1])
            assert call({**registration, 'key': 'synthetic'}, new_token)[0] == 400
            assert call(registration, 'invalid')[0] == 401
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda index: call(registration, new_token, index % 4), range(8)))
                assert all(result == (200, {'ok': True}) for result in results), results
            assert int(sql('SELECT COUNT(*) FROM sw_sync_groups;').splitlines()[-1]) == before_count + 1
            assert call(empty, new_token)[1]['head'] == 0
            assert call(empty, token)[1]['head'] == 252
            assert sql("SELECT token_hash FROM sw_sync_groups WHERE token_hash = '" + hashlib.sha256(new_token.encode()).hexdigest() + "';").splitlines()[-1] == hashlib.sha256(new_token.encode()).hexdigest()
            # Simultaneous retries retain one group and do not consume more quota.
            with ThreadPoolExecutor(max_workers=4) as pool:
                assert all(status == 200 for status, _ in pool.map(lambda index: call(registration, new_token, index % 4), range(8)))
            assert int(sql('SELECT COUNT(*) FROM sw_sync_groups;').splitlines()[-1]) == before_count + 1
            assert sql('SELECT MAX(registrations) FROM sw_sync_registration_limits;').splitlines()[-1] == '1'
            assert call(registration, 'd' * 64)[0] == 429
            assert int(sql('SELECT COUNT(*) FROM sw_sync_groups;').splitlines()[-1]) == before_count + 1
            assert call(registration, other_token)[0] == 401  # Cannot resurrect a disabled group.
            sql('DELETE FROM sw_sync_registration_limits;')
            configure(", 'registrations_per_ip_hour'=>3, 'registrations_per_hour'=>1")
            assert call(registration, 'd' * 64)[0] == 200
            assert call(registration, 'e' * 64)[0] == 429  # Global hourly cap.
            configure(", 'max_groups'=>1")
            assert call(registration, 'f' * 64)[0] == 429  # Total capacity.
            assert call(registration, new_token)[0] == 200
            subprocess.run(manager + ['disable-registration'], check=True, capture_output=True)
            assert call(registration, 'e' * 64)[0] == 403
            assert call(empty, new_token)[0] == 200
            assert call(registration, new_token)[0] == 200
            assert call({'action': 'delete'}, new_token)[0] == 200
            assert call(empty, token)[1]['head'] == 252
            # Keep minute-boundary rollover out of these short quota assertions.
            if time.gmtime().tm_sec >= 55:
                time.sleep(60 - time.gmtime().tm_sec)
            # Request quotas cover every action, failed operations and retries.
            sql('DELETE FROM sw_sync_request_limits;')
            configure(", 'requests_per_token_minute'=>3, 'requests_per_minute'=>100")
            assert call(empty)[0] == 200
            assert call({**empty, 'cursor': 999999})[0] == 409
            assert call({'action': 'member.leave', 'id': member['id']})[0] == 200
            throttled = call({'action': 'delete'}, include_headers=True)
            assert throttled[0] == 429 and 1 <= int(throttled[2]) <= 60
            assert call({'action': 'members', 'device': member})[0] == 429
            assert call(registration)[0] == 429
            assert call(empty, new_token)[0] == 200  # Token isolation.
            sql('DELETE FROM sw_sync_request_limits;')
            configure(", 'requests_per_token_minute'=>3, 'requests_per_minute'=>100")
            # Concurrent requests cannot overrun a per-token bucket.
            with ThreadPoolExecutor(max_workers=4) as pool:
                statuses = list(pool.map(lambda index: call(empty, token, index % 4)[0], range(8)))
            assert statuses.count(200) == 3 and statuses.count(429) == 5, statuses
            sql('DELETE FROM sw_sync_request_limits;')
            configure(", 'requests_per_token_minute'=>100, 'requests_per_minute'=>2")
            assert call(empty, 'b' * 64)[0] == 401
            assert call(empty, new_token)[0] == 200
            assert call(empty, token)[0] == 200
            assert call(empty, new_token)[0] == 429
            # Invalid tokens use one peer bucket and cannot exhaust the valid global bucket.
            assert sql('SELECT COUNT(*) FROM sw_sync_request_limits;').splitlines()[-1] == '4'
            sql("UPDATE sw_sync_request_limits SET window_start = '2000-01-01';")
            assert call(empty, token)[0] == 200
            assert sql("SELECT COUNT(*) FROM sw_sync_request_limits WHERE window_start = '2000-01-01';").splitlines()[-1] == '0'
            configure(", 'requests_per_minute'=>0")
            assert call(empty)[0] == 503  # Invalid host configuration fails closed.
            configure(", 'requests_per_unknown_peer_minute'=>2")
            sql('DELETE FROM sw_sync_request_limits;')
            assert call(empty, 'b' * 64)[0] == 401
            assert call(empty, 'e' * 64)[0] == 401
            assert call(empty, 'f' * 64)[0] == 429
            assert call(empty, token)[0] == 200
            assert sql('SELECT COUNT(*) FROM sw_sync_request_limits;').splitlines()[-1] == '3'
            # Maintenance purges idle ciphertext and participants without deleting active group metadata.
            sql("UPDATE sw_sync_group_operations SET received_at = '2000-01-01'; UPDATE sw_sync_members SET updated_at = '2000-01-01';")
            subprocess.run(manager + ['purge'], check=True, capture_output=True)
            assert sql('SELECT COUNT(*) FROM sw_sync_group_operations;').splitlines()[-1] == '0'
            assert sql('SELECT COUNT(*) FROM sw_sync_members;').splitlines()[-1] == '0'
            assert call(empty, token)[0] == 200
            assert sql("SELECT revision FROM sw_sync_groups WHERE token_hash = '" + hashlib.sha256(token.encode()).hexdigest() + "';").splitlines()[-1] == '252'
            sql("UPDATE sw_sync_groups SET last_active_at = '2000-01-01' WHERE id = '" + other_id + "';")
            subprocess.run(manager + ['purge'], check=True, capture_output=True)
            assert sql("SELECT COUNT(*) FROM sw_sync_groups WHERE id = '" + other_id + "';").splitlines()[-1] == '0'
            subprocess.run(manager + ['enable-registration'], check=True, capture_output=True)
            sql('DELETE FROM sw_sync_request_limits;')
            assert call(registration, other_token)[0] == 401  # Cleanup must not undo revocation.
            # IPv6 rotation inside a /64 has the same private rate identity.
            peer_script = "require '" + (folder / 'maintenance.php').as_posix() + "'; echo (ratePeer('2001:db8:1234:5678::1') === ratePeer('2001:db8:1234:5678::abcd') && ratePeer('2001:db8:1234:5678::1') !== ratePeer('2001:db8:1234:5679::1')) ? 'ok' : 'fail';"
            assert subprocess.run(php + ['-r', peer_script], check=True, capture_output=True, text=True).stdout == 'ok'
            print('PHP 8.2 / MySQL API integration passed: migration, isolation, revocation, authentication, validation, retry, pagination, scoped deletion, registration, quotas and encrypted participant isolation/deletion.')
    finally:
        for process in processes:
            process.terminate()
            process.wait(timeout=10)
        subprocess.run(mysql, input=f'DROP DATABASE {database};', text=True, check=True, capture_output=True)


if __name__ == '__main__':
    main()
