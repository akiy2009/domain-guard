import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRANDS, BRAND_TOKENS, FREE_HOSTING, GENERIC_BRAND_TOKENS, RISKY_TLDS,
  SENSITIVE_KEYWORDS, URL_SHORTENERS,
} from '../lib/brands.js';

test('ブランド辞書の形式', () => {
  const seen = new Set();
  for (const brand of BRANDS) {
    assert.match(brand.d, /^[a-z0-9.-]+$/, brand.d);
    assert.ok(brand.d.includes('.'), brand.d);
    assert.ok(brand.d.length <= 253);
    assert.equal(seen.has(brand.d), false, `duplicate: ${brand.d}`);
    seen.add(brand.d);
    assert.equal(typeof brand.n, 'string');
    assert.ok(brand.n.length > 0);
    assert.ok(!brand.d.startsWith('.') && !brand.d.endsWith('.'));
  }
});

test('主要ブランドが登録されている', () => {
  const domains = new Set(BRANDS.map((brand) => brand.d));
  for (const domain of [
    'google.com', 'apple.com', 'microsoft.com', 'amazon.co.jp', 'paypal.com',
    'rakuten.co.jp', 'rakuten-bank.co.jp', 'paypay.ne.jp', 'line.me',
    'mizuhobank.co.jp', 'jp-bank.japanpost.jp', 'myna.go.jp', 'npa.go.jp',
    'mercari.com', 'yahoo.co.jp', 'github.com', 'x.com',
  ]) {
    assert.ok(domains.has(domain), domain);
  }
});

test('ブランドトークンは小文字で重複なく索引される', () => {
  for (const [token, brands] of BRAND_TOKENS) {
    assert.equal(token, token.toLowerCase());
    assert.ok(token.length >= 4);
    assert.ok(brands.length > 0);
  }
  assert.ok(BRAND_TOKENS.has('google'));
  assert.ok(BRAND_TOKENS.has('paypal'));
  assert.ok(BRAND_TOKENS.has('rakuten'));
});

test('一般語トークンは小文字', () => {
  for (const token of GENERIC_BRAND_TOKENS) {
    assert.equal(token, token.toLowerCase());
    assert.ok(token.length > 0);
  }
});

test('リスク TLD の形式と重複', () => {
  const all = [];
  for (const tier of ['high', 'medium', 'low']) {
    assert.ok(RISKY_TLDS[tier] instanceof Set);
    assert.ok(RISKY_TLDS[tier].size > 0);
    for (const tld of RISKY_TLDS[tier]) {
      assert.match(tld, /^[a-z0-9-]+$/, tld);
      assert.equal(tld.startsWith('.'), false);
      all.push(tld);
    }
  }
  assert.equal(new Set(all).size, all.length, 'TLD が複数ティアに重複しています');
});

test('無料ホスティング・短縮 URL の形式', () => {
  for (const service of FREE_HOSTING) {
    assert.match(service, /^[a-z0-9.-]+$/);
    assert.ok(service.includes('.'));
  }
  for (const service of URL_SHORTENERS) {
    assert.match(service, /^[a-z0-9.-]+$/);
    assert.ok(service.includes('.'));
  }
  assert.deepEqual(FREE_HOSTING.filter((item) => URL_SHORTENERS.includes(item)), []);
});

test('誘導キーワードの形式とスコア', () => {
  const seen = new Set();
  for (const keyword of SENSITIVE_KEYWORDS) {
    assert.match(keyword.w, /^[a-z0-9]+$/, keyword.w);
    assert.equal(seen.has(keyword.w), false, `duplicate: ${keyword.w}`);
    seen.add(keyword.w);
    assert.ok(Number.isFinite(keyword.s) && keyword.s > 0 && keyword.s <= 25);
  }
  assert.ok(seen.has('login'));
  assert.ok(seen.has('bank'));
});
