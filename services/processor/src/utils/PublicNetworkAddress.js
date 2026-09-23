import { BlockList, isIP } from 'node:net';

const nonPublicAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) {
  nonPublicAddresses.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 96], ['100::', 64], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) {
  nonPublicAddresses.addSubnet(address, prefix, 'ipv6');
}

export function normalizeNetworkHostname(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    : '';
}

export function isPrivateOrLocalIpAddress(value) {
  const address = normalizeNetworkHostname(value);
  const family = isIP(address);
  // DNS results must always be IP literals. Unknown formats fail closed.
  if (!family) return true;
  // BlockList also applies IPv4 subnets to IPv4-mapped IPv6 addresses.
  return nonPublicAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export function isPrivateOrLocalHostname(value) {
  const hostname = normalizeNetworkHostname(value);
  if (!hostname) return true;
  if (isIP(hostname)) return isPrivateOrLocalIpAddress(hostname);
  return hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname === 'local' || hostname.endsWith('.local');
}
