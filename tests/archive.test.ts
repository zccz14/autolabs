import { describe, expect, it } from 'vitest';
import { buildTar, buildTarGz } from '../src/archive';

const encoder = new TextEncoder();

function readString(block: Uint8Array, offset: number, length: number): string {
  return new TextDecoder().decode(block.subarray(offset, offset + length)).replace(/\u0000+$/, '');
}

describe('tar writer', () => {
  it('writes ustar headers with a valid checksum', () => {
    const archive = buildTar([{ path: 'canonical.txt', bytes: encoder.encode('hello') }], 1_700_000_000);
    const header = archive.subarray(0, 512);
    expect(readString(header, 0, 100)).toBe('canonical.txt');
    expect(readString(header, 257, 6)).toBe('ustar');
    expect(Number.parseInt(readString(header, 124, 12), 8)).toBe(5);
    const declared = Number.parseInt(readString(header, 148, 8).trim(), 8);
    let checksum = 0;
    for (let i = 0; i < 512; i += 1) checksum += i >= 148 && i < 156 ? 0x20 : header[i]!;
    expect(declared).toBe(checksum);
    expect(archive.byteLength % 512).toBe(0);
  });

  it('pads payloads and terminates with two zero blocks', () => {
    const archive = buildTar([{ path: 'a.txt', bytes: encoder.encode('x') }], 0);
    expect(archive.byteLength).toBe(512 + 512 + 1024);
    expect(archive.subarray(1536, 2048).every((byte) => byte === 0)).toBe(true);
  });

  it('gzip produces a gzip container', async () => {
    const gz = await buildTarGz([{ path: 'a.txt', bytes: encoder.encode('x') }], 0);
    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
  });
});
