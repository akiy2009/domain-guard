import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SETTINGS, MAX_WHITELIST, SENSITIVITY_VALUES, isWhitelisted,
  loadSettings, normalizeDomainInput, normalizeIgnoreRules, normalizeSettings,
  normalizeWhitelist, publicSettings, saveSettings,
} from '../lib/settings.js';
import { DEFAULT_APPEARANCE } from '../lib/theme.js';
import { TOGGLEABLE_RULE_IDS } from '../lib/rules.js';

test('既定設定', () => {
  const settings = normalizeSettings();
  assert.equal(settings.enabled, true);
  assert.equal(settings.sensitivity, 'normal');
  assert.deepEqual(settings.whitelist, []);
  assert.deepEqual(settings.ignoreRules, []);
  assert.equal(settings.blockDangerous, true);
  assert.equal(settings.apiKey, '');
  assert.equal(settings.theme, DEFAULT_APPEARANCE.theme);
  assert.deepEqual(settings.colors, DEFAULT_APPEARANCE.colors);
  assert.equal(DEFAULT_SETTINGS.whitelist.length, 0);
});

test('不正な型・値を既定値へ正規化する', () => {
  const settings = normalizeSettings({
    enabled: 'yes',
    sensitivity: 'extreme',
    whitelist: 'example.com',
    ignoreRules: ['typosquat', 'unknown-rule', 42],
    enableSafeBrowsing: 1,
    apiKey: '  secret  ',
    theme: 'purple',
    accentColor: 'red',
    colors: { danger: '#ABCDEF', low: 'x' },
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.sensitivity, 'normal');
  assert.deepEqual(settings.whitelist, []);
  assert.deepEqual(settings.ignoreRules, ['typosquat']);
  assert.equal(settings.enableSafeBrowsing, false);
  assert.equal(settings.apiKey, 'secret');
  assert.equal(settings.theme, 'system');
  assert.equal(settings.accentColor, DEFAULT_APPEARANCE.accentColor);
  assert.equal(settings.colors.danger, '#abcdef');
  assert.equal(settings.colors.low, DEFAULT_APPEARANCE.colors.low);
});

test('感度の値は定義済みのものだけを受け付ける', () => {
  for (const value of SENSITIVITY_VALUES) {
    assert.equal(normalizeSettings({ sensitivity: value }).sensitivity, value);
  }
});

test('ホワイトリスト入力を正規化する', () => {
  assert.deepEqual(normalizeDomainInput('Example.COM'), { ok: true, domain: 'example.com' });
  assert.deepEqual(normalizeDomainInput('https://Example.CO.JP/path?q=1'), {
    ok: true, domain: 'example.co.jp',
  });
  assert.deepEqual(normalizeDomainInput('*.example.com'), { ok: true, domain: 'example.com' });
  assert.deepEqual(normalizeDomainInput('.example.com'), { ok: true, domain: 'example.com' });
  assert.deepEqual(normalizeDomainInput('https://example.com:8080/path'), {
    ok: true, domain: 'example.com',
  });
  assert.equal(normalizeDomainInput('bücher.example').domain, 'xn--bcher-kva.example');
});

test('ホワイトリストに登録できない入力', () => {
  for (const value of ['', '   ', 'com', 'co.jp', 'github.io', '192.168.0.1', 'example', 'foo..bar', 'exa mple.com']) {
    const result = normalizeDomainInput(value);
    assert.equal(result.ok, false, `${JSON.stringify(value)} should be rejected`);
    assert.equal(typeof result.error, 'string');
  }
});

test('ホワイトリストの重複・上限・無効値を処理する', () => {
  assert.deepEqual(
    normalizeWhitelist(['Example.com', 'https://example.com/x', 'foo.example', 'com']),
    ['example.com', 'foo.example'],
  );
  const many = Array.from({ length: MAX_WHITELIST + 10 }, (_, i) => `site${i}.example`);
  assert.equal(normalizeWhitelist(many).length, MAX_WHITELIST);
});

test('無視ルールは既知の ID のみ許可する', () => {
  const valid = [...TOGGLEABLE_RULE_IDS].slice(0, 3);
  assert.deepEqual(normalizeIgnoreRules([...valid, 'nope', 'nope', 1]), [...new Set(valid)]);
  assert.deepEqual(normalizeIgnoreRules(null), []);
});

test('公開設定に API キーを含めない', () => {
  const settings = publicSettings({ apiKey: 'secret-key', whitelist: ['example.com'] });
  assert.equal('apiKey' in settings, false);
  assert.equal(settings.hasApiKey, true);
  assert.deepEqual(settings.whitelist, ['example.com']);
  assert.equal(publicSettings({ apiKey: '' }).hasApiKey, false);
});

test('ホワイトリストはサブドメインにも適用される', () => {
  assert.equal(isWhitelisted('example.com', ['example.com']), true);
  assert.equal(isWhitelisted('a.b.example.com', ['example.com']), true);
  assert.equal(isWhitelisted('WWW.Example.COM', ['example.com']), true);
  assert.equal(isWhitelisted('notexample.com', ['example.com']), false);
  assert.equal(isWhitelisted('example.com.evil.com', ['example.com']), false);
  assert.equal(isWhitelisted('example.com', []), false);
  assert.equal(isWhitelisted('', ['example.com']), false);
});

test('storage の読み書き（メモリ実装）', async () => {
  const store = {};
  const area = {
    async get() { return { ...store }; },
    async set(values) { Object.assign(store, values); },
  };
  const loaded = await loadSettings(area);
  assert.equal(loaded.sensitivity, 'normal');
  const saved = await saveSettings({ sensitivity: 'strict', apiKey: ' key ' }, area);
  assert.equal(saved.sensitivity, 'strict');
  assert.equal(saved.apiKey, 'key');
  assert.equal((await loadSettings(area)).sensitivity, 'strict');
});

test('storage がない環境でも既定値を返す', async () => {
  const settings = await loadSettings(null);
  assert.equal(settings.enabled, true);
});
