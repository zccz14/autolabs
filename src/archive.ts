import { assertPath } from './labs';

/**
 * 把一份快照打成 tar.gz。Phase 1 有 32 MiB 上限：快照只装实验源码与报告，
 * 行情之类的大文件走 dataset/单 blob 通道，不进快照。
 */
export const SNAPSHOT_TAR_LIMIT_BYTES = 32 * 1024 * 1024;

const BLOCK = 512;
const encoder = new TextEncoder();

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, '0') + '\u0000';
  target.set(encoder.encode(text).subarray(0, length), offset);
}

function writeString(target: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encoder.encode(value);
  target.set(bytes.subarray(0, length), offset);
}

function header(path: string, size: number, mtime: number): Uint8Array {
  const block = new Uint8Array(BLOCK);
  // 超过 100 字节的路径按 ustar 规范拆成 prefix(155) + name(100)。
  let name = path;
  let prefix = '';
  if (path.length > 100) {
    const cut = path.lastIndexOf('/', path.length - 1);
    if (cut > 0) {
      prefix = path.slice(0, cut);
      name = path.slice(cut + 1);
    }
    if (name.length > 100 || prefix.length > 155) throw new Error(`路径过长，无法打包：${path}`);
  }
  writeString(block, 0, 100, name);
  writeOctal(block, 100, 8, 0o644);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, mtime);
  block[156] = '0'.charCodeAt(0); // 普通文件
  writeString(block, 257, 6, 'ustar\u0000');
  writeString(block, 263, 2, '00');
  writeString(block, 345, 155, prefix);
  // 校验和：先把 chksum 字段当空格，求和后写入。
  for (let i = 148; i < 156; i += 1) block[i] = 0x20;
  let checksum = 0;
  for (const byte of block) checksum += byte;
  writeString(block, 148, 8, checksum.toString(8).padStart(6, '0') + '\u0000 ');
  return block;
}

function pad(length: number): number {
  return (BLOCK - (length % BLOCK)) % BLOCK;
}

export interface TarFile {
  path: string;
  bytes: Uint8Array;
}

/** 生成 tar（未压缩），调用方决定是否 gzip。 */
export function buildTar(files: TarFile[], mtimeSeconds: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    assertPath(file.path);
    const head = header(file.path, file.bytes.byteLength, mtimeSeconds);
    chunks.push(head, file.bytes);
    const padding = pad(file.bytes.byteLength);
    if (padding > 0) chunks.push(new Uint8Array(padding));
    total += BLOCK + file.bytes.byteLength + padding;
  }
  const trailer = new Uint8Array(BLOCK * 2);
  chunks.push(trailer);
  total += BLOCK * 2;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** gzip 压缩（Workers 只有 CompressionStream，没有 zstd）。 */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function buildTarGz(files: TarFile[], mtimeSeconds: number): Promise<Uint8Array> {
  return gzip(buildTar(files, mtimeSeconds));
}
