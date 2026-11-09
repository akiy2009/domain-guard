#!/usr/bin/env node
/**
 * Chrome ウェブストアへアップロードできる ZIP を作成します。
 * 依存パッケージは使わず、Node 標準の zlib だけで ZIP を組み立てます。
 *
 * 出力:
 *   dist/domain-guard-<version>/        … 展開済み（動作確認用）
 *   dist/domain-guard-<version>.zip     … アップロード用
 */
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const version = String(manifest.version || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`manifest.json の version が不正です: ${version}`);
  process.exit(1);
}

const runtimeEntries = [
  'manifest.json',
  'background.js',
  'lib',
  'popup',
  'options',
  'warning',
  'icons',
  '_locales',
];

for (const entry of runtimeEntries) {
  if (!existsSync(join(root, entry))) {
    console.error(`同梱ファイルが見つかりません: ${entry}`);
    process.exit(1);
  }
}

const dist = join(root, 'dist');
const stage = join(dist, `domain-guard-${version}`);
const zipPath = join(dist, `domain-guard-${version}.zip`);

rmSync(stage, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(stage, { recursive: true });

for (const entry of runtimeEntries) {
  cpSync(join(root, entry), join(stage, entry), { recursive: true });
}

function walk(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = walk(stage)
  .map((full) => ({
    full,
    name: relative(stage, full).split(sep).join('/'),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));

/* ------------------------------------------------------------------ */
/* ZIP                                                                 */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11)
    | ((date.getMinutes() & 0x3f) << 5)
    | Math.floor(date.getSeconds() / 2);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9)
    | (((date.getMonth() + 1) & 0x0f) << 5)
    | (date.getDate() & 0x1f);
  return { time, day };
}

const now = new Date();
const { time: dosTime, day: dosDate } = dosDateTime(now);

const localParts = [];
const centralParts = [];
let offset = 0;

for (const file of files) {
  const name = Buffer.from(file.name, 'utf8');
  const content = readFileSync(file.full);
  const compressed = deflateRawSync(content, { level: 9 });
  const crc = crc32(content);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);        // version needed
  local.writeUInt16LE(0x0800, 6);    // UTF-8
  local.writeUInt16LE(8, 8);         // deflate
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  localParts.push(local, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x031e, 4);  // made by: UNIX, 3.0
  central.writeUInt16LE(20, 6);      // version needed
  central.writeUInt16LE(0x0800, 8);  // UTF-8
  central.writeUInt16LE(8, 10);      // deflate
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);      // extra
  central.writeUInt16LE(0, 32);      // comment
  central.writeUInt16LE(0, 34);      // disk
  central.writeUInt16LE(0, 36);      // internal attrs
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs (regular file)
  central.writeUInt32LE(offset, 42);

  centralParts.push(central, name);
  offset += local.length + name.length + compressed.length;
}

const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

const zip = Buffer.concat([...localParts, centralDirectory, end]);
mkdirSync(dist, { recursive: true });
writeFileSync(zipPath, zip);

const totalBytes = files.reduce((sum, file) => sum + statSync(file.full).size, 0);
const digest = createHash('sha256').update(zip).digest('hex');

console.log(`作成しました: ${relative(root, zipPath)}`);
console.log(`  ファイル数: ${files.length}`);
console.log(`  展開時: ${(totalBytes / 1024).toFixed(1)} KiB / ZIP: ${(zip.length / 1024).toFixed(1)} KiB`);
console.log(`  SHA-256: ${digest}`);
