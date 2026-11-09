#!/usr/bin/env node
/**
 * クロスプラットフォームなテストランナー。
 *
 * `node --test "test/*.test.mjs"` の glob 展開は Node.js 22 以降でしか
 * サポートされないため、Node.js 20 でも動くようファイル一覧を明示して
 * 子プロセスへ渡します。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testDir = join(root, 'test');

if (!existsSync(testDir)) {
  console.error('test/ ディレクトリが見つかりません。');
  process.exit(1);
}

const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(testDir, name));

if (files.length === 0) {
  console.error('テストファイルが見つかりません。');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: root,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
