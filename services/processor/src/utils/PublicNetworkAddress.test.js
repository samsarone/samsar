import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrivateOrLocalHostname, isPrivateOrLocalIpAddress } from './PublicNetworkAddress.js';

test('blocks non-public IP ranges including mapped IPv6 and the full loopback/link-local ranges', () => {
  for (const address of [
    '127.0.0.2', '127.255.255.254', '0.1.2.3', '10.1.2.3', '172.31.0.1',
    '192.168.1.1', '169.254.169.254', '100.100.100.200', '198.18.0.1', '239.1.2.3',
    '255.255.255.255', '::', '::1', '::ffff:127.0.0.2', '::ffff:7f00:1',
    '::ffff:10.1.2.3', '::ffff:a9fe:a9fe', '[::ffff:192.168.1.1]',
    'fe80::1', 'febf::1', 'fc00::1', 'fdff::1', 'fec0::1', 'ff02::1', '', 'invalid',
  ]) assert.equal(isPrivateOrLocalIpAddress(address), true, address);
});

test('preserves public IPv4, IPv6, and domain media sources', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateOrLocalIpAddress(address), false, address);
    assert.equal(isPrivateOrLocalHostname(address), false, address);
  }
  assert.equal(isPrivateOrLocalHostname('cdn.example.com'), false);
});

test('rejects local hostname aliases with brackets, case and trailing dots', () => {
  for (const host of ['localhost', 'LOCALHOST.', 'app.localhost', 'service.local.', '[::1]', '127.0.0.2']) {
    assert.equal(isPrivateOrLocalHostname(host), true, host);
  }
});
