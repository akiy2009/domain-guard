#!/usr/bin/env node
/**
 * 依存パッケージなしの構文チェック。
 *
 * Node は `.js` を CommonJS として `--check` するため、ESM の構文エラー
 * （トップレベル await の誤用など）を見逃すことがあります。
 * そこで各ファイルを一時ディレクトリへ `.mjs` としてコピーしてから
 * `node --check` を実行します。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipDirs = new Set(['.git', 'dist', 'node_modules']);
const checkDirs = ['lib', 'popup', 'options', 'warning', 'tools', 'test', '_locales'];
const checkFiles = ['background.js', 'manifest.json', 'package.json'];

function walk(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      walk(join(directory, entry.name), out);
    } else if (entry.isFile()) {
      out.push(join(directory, entry.name));
    }
  }
  return out;
}

const files = [];
for (const file of checkFiles) {
  const full = join(root, file);
  try {
    if (statSync(full).isFile()) files.push(full);
  } catch {
    // 存在しないファイルは下で報告する
    console.error(`MISSING  ${file}`);
    process.exitCode = 1;
  }
}
for (const directory of checkDirs) {
  const full = join(root, directory);
  try {
    if (statSync(full).isDirectory()) files.push(...walk(full));
  } catch {
    // ディレクトリがなければ無視
  }
}

const jsFiles = files.filter((file) => ['.js', '.mjs', '.cjs'].includes(extname(file)));
const jsonFiles = files.filter((file) => extname(file) === '.json');

let failed = 0;
const temp = mkdtempSync(join(tmpdir(), 'domain-guard-check-'));

try {
  for (const file of jsonFiles) {
    try {
      JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      failed += 1;
      console.error(`FAIL    ${relative(root, file)}  ${error.message}`);
    }
  }

  for (const file of jsFiles) {
    const target = join(temp, `${relative(root, file).replace(/[\\/]/g, '__')}.mjs`);
    cpSync(file, target);
    const result = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
    if (result.status !== 0) {
      failed += 1;
      const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(0, 6).join('\n');
      console.error(`FAIL    ${relative(root, file)}\n${detail}`);
    }
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} 件の構文エラーがあります。`);
  process.exit(1);
}

console.log(`構文チェック OK（JavaScript ${jsFiles.length} 件 / JSON ${jsonFiles.length} 件）`);
