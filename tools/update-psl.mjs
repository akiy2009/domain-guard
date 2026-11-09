#!/usr/bin/env node
/**
 * Public Suffix List から lib/psl-data.js を生成します。
 *
 * 使い方:
 *   node tools/update-psl.mjs            # 最新の PSL を取得して更新
 *   node tools/update-psl.mjs --check    # 生成結果が最新かを確認（CI 用）
 *
 * PSL のライセンス: MPL 2.0
 * https://publicsuffix.org/
 */
import { readFile, writeFile } from 'node:fs/promises';
import { domainToASCII } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'lib', 'psl-data.js');
const SOURCE_URL = 'https://publicsuffix.org/list/public_suffix_list.dat';

const toAsciiRule = (rule) => {
  const prefix = rule.startsWith('!') ? '!' : rule.startsWith('*.') ? '*.' : '';
  const body = rule.slice(prefix.length);
  let ascii;
  try {
    ascii = domainToASCII(body);
  } catch {
    ascii = '';
  }
  if (!ascii) ascii = body.toLowerCase();
  return prefix + ascii;
};

const parseList = (text) => {
  const start = text.indexOf('// ===BEGIN ICANN DOMAINS===');
  const privateStart = text.indexOf('// ===BEGIN PRIVATE DOMAINS===');
  if (start < 0 || privateStart < 0) {
    throw new Error('PSL の形式が想定と異なります（ICANN / PRIVATE セクションが見つかりません）');
  }
  const version = (text.match(/^\/\/ VERSION:\s*(\S+)/m) || [])[1] || '';
  const commit = (text.match(/^\/\/ COMMIT:\s*(\S+)/m) || [])[1] || '';
  const section = text.slice(start, text.length);
  const rules = [];
  const exceptions = [];
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const rule = toAsciiRule(line);
    if (rule.startsWith('!')) exceptions.push(rule.slice(1));
    else rules.push(rule);
  }
  return {
    rules: [...new Set(rules)].sort(),
    exceptions: [...new Set(exceptions)].sort(),
    version,
    commit,
  };
};

const buildModule = ({ rules, exceptions, version, commit }) => {
  // PSL 側の VERSION を使うことで、再取得しても日付だけで差分が出ないようにする。
  const updated = (version.match(/^\d{4}-\d{2}-\d{2}/) || [])[0]
    || new Date().toISOString().slice(0, 10);
  return `// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: ${SOURCE_URL}
// Generated: ${updated}
// Rules: ${rules.length} (+ ${exceptions.length} exceptions)
// License: MPL 2.0 (https://publicsuffix.org/list/)
//
// このファイルは tools/update-psl.mjs で再生成できます。
export const PSL_UPDATED = '${updated}';
export const PSL_COMMIT = '${commit}';
export const PSL_RULES = \`${rules.join('\n')}
\`;
export const PSL_EXCEPTIONS = \`${exceptions.join('\n')}
\`;
`;
};

const main = async () => {
  const res = await fetch(SOURCE_URL, {
    headers: { 'user-agent': 'domain-guard-psl-updater' },
  });
  if (!res.ok) throw new Error(`PSL の取得に失敗しました: HTTP ${res.status}`);
  const text = await res.text();
  const module = buildModule(parseList(text));

  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = await readFile(OUT, 'utf8');
    } catch {
      // 未生成なら差分ありとして扱う
    }
    if (current !== module) {
      console.error('lib/psl-data.js が最新ではありません。`npm run psl` を実行してください。');
      process.exitCode = 1;
      return;
    }
    console.log('lib/psl-data.js は最新です。');
    return;
  }

  await writeFile(OUT, module, 'utf8');
  console.log(`wrote ${path.relative(ROOT, OUT)} (${module.length.toLocaleString()} bytes)`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
