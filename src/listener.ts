import { BlockList, isIP } from 'node:net';

const loopback = new BlockList();
loopback.addSubnet('127.0.0.0', 8, 'ipv4');
loopback.addAddress('::1', 'ipv6');

/** Inspect the actual bound address, so localhost and IPv4-mapped IPv6 work too. */
export function warnIfNonLoopbackBind(
  address: string,
  warn: (message: string) => void = console.warn,
): void {
  if (loopback.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')) return;
  warn(`[network] Runtime is listening on non-loopback address ${address}; `
    + 'remote access is enabled. Protect it with CATS_RUNTIME_API_KEY and a trusted network.');
}
