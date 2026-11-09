import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const manifest = readJson('manifest.json');
const pkg = readJson('package.json');

function walk(directory, out = []) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) walk(relative, out);
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

function exists(path) {
  try {
    return statSync(join(root, path)).isFile();
  } catch {
    return false;
  }
}

test('manifest の基本情報', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.default_locale, 'ja');
  assert.ok(Number(manifest.minimum_chrome_version) >= 110);
  assert.match(manifest.homepage_url, /^https:\/\/github\.com\//);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.options_ui.open_in_tab, true);
  assert.ok(manifest.content_security_policy.extension_pages.includes("script-src 'self'"));
});

test('package.json は依存パッケージを持たない', () => {
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.match(pkg.scripts.test, /node --test/);
  assert.ok(pkg.scripts.check);
  assert.ok(pkg.scripts.build);
});

test('manifest が参照するファイルが存在する', () => {
  const paths = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const path of new Set(paths)) {
    assert.ok(exists(path), `missing: ${path}`);
  }
});

test('ロケールメッセージが揃っている', () => {
  for (const locale of ['ja', 'en']) {
    const messages = readJson(`_locales/${locale}/messages.json`);
    for (const key of ['extName', 'extDescription']) {
      assert.equal(typeof messages[key].message, 'string', `${locale}/${key}`);
      assert.ok(messages[key].message.length > 0, `${locale}/${key}`);
    }
  }
  assert.ok(manifest.name.startsWith('__MSG_'));
  assert.ok(manifest.description.startsWith('__MSG_'));
});

test('HTML が参照するローカルファイルが存在する', () => {
  for (const file of ['popup/popup.html', 'options/options.html', 'warning/warning.html']) {
    const html = readFileSync(join(root, file), 'utf8');
    const base = dirname(file);
    const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const ref of refs) {
      if (/^(?:https?:|#|data:|mailto:)/i.test(ref)) continue;
      assert.ok(exists(join(base, ref)), `${file} -> ${ref}`);
    }
  }
});

test('HTML にインラインスクリプト・外部スクリプト・インラインイベントがない', () => {
  for (const file of ['popup/popup.html', 'options/options.html', 'warning/warning.html']) {
    const html = readFileSync(join(root, file), 'utf8');
    assert.equal(/<script(?![^>]*\bsrc=)/i.test(html), false, `${file}: inline script`);
    assert.equal(/<script[^>]+src\s*=\s*["']https?:/i.test(html), false, `${file}: remote script`);
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, `${file}: inline event handler`);
    assert.equal(/javascript:/i.test(html), false, `${file}: javascript: URL`);
  }
});

test('JavaScript の相対 import が解決できる', () => {
  const files = [
    'background.js',
    ...walk('lib'),
    ...walk('popup'),
    ...walk('options'),
    ...walk('warning'),
    ...walk('tools'),
    ...walk('test'),
  ].filter((file) => ['.js', '.mjs'].includes(extname(file)));

  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    const imports = [
      ...source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g),
      ...source.matchAll(/\bimport\s+["'](\.[^"']+)["']/g),
    ].map((match) => match[1]);

    for (const specifier of imports) {
      const target = resolve(root, dirname(file), specifier);
      assert.ok(exists(target.slice(root.length + 1)), `${file} -> ${specifier}`);
    }
  }
});

test('画面の JavaScript が参照する ID が HTML に存在する', () => {
  const pages = [
    ['popup/popup.html', 'popup/popup.js'],
    ['options/options.html', 'options/options.js'],
    ['warning/warning.html', 'warning/warning.js'],
  ];
  for (const [htmlFile, jsFile] of pages) {
    const html = readFileSync(join(root, htmlFile), 'utf8');
    const js = readFileSync(join(root, jsFile), 'utf8');
    const ids = new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
    const used = [
      ...js.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g),
      ...js.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1]);
    for (const id of new Set(used)) {
      assert.ok(ids.has(id), `${jsFile}: #${id} が ${htmlFile} にありません`);
    }
  }
});

test('危険な DOM API を使っていない', () => {
  const files = ['background.js', ...walk('lib'), ...walk('popup'), ...walk('options'), ...walk('warning')]
    .filter((file) => ['.js', '.mjs'].includes(extname(file)));
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    for (const pattern of [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /\beval\s*\(/, /new\s+Function\s*\(/, /document\.write\s*\(/]) {
      assert.equal(pattern.test(source), false, `${file}: ${pattern}`);
    }
  }
});

test('ビルド・構文チェック・PSL 更新ツールが揃っている', () => {
  for (const file of ['tools/build.mjs', 'tools/check-syntax.mjs', 'tools/update-psl.mjs', 'LICENSE', 'PRIVACY.md']) {
    assert.ok(exists(file), file);
  }
});
