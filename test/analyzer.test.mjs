import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeUrl, mergeSafeBrowsing, LEVELS, SENSITIVITY } from '../lib/analyzer.js';

const analyze = (url, settings = {}) => analyzeUrl(url, settings);

test('正規サイトを安全と判定する', () => {
  for (const url of [
    'https://www.google.com/',
    'https://www.google.co.jp/search?q=test',
    'https://www.amazon.co.jp/',
    'https://www.yahoo.co.jp/',
    'https://www.paypal.com/',
    'https://github.com/',
    'https://www.rakuten-bank.co.jp/',
    'https://www.mizuhobank.co.jp/',
    'https://myna.go.jp/',
    'https://freee.co.jp/',
    'https://shop.example.co.jp/items',
    'https://id.example.com/',
    'https://finance.com/',
    'https://google.com.au/',
    'https://amazon.co.uk/',
  ]) {
    const result = analyze(url);
    assert.equal(result.level, 'safe', `${url} => ${result.score} ${result.findings.map((f) => f.id)}`);
    assert.equal(result.score, 0, url);
  }
});

test('一般語を含むだけのドメインは危険扱いしない', () => {
  const apple = analyze('https://apple-pie.com/');
  assert.ok(apple.score < 25, `apple-pie.com score=${apple.score}`);
  assert.notEqual(apple.level, 'danger');

  const stack = analyze('https://stack.com/');
  assert.ok(stack.score < 25, `stack.com score=${stack.score}`);
  assert.notEqual(stack.level, 'danger');
});

test('公開サフィックス自体（github.io）をなりすまし扱いしない', () => {
  const apex = analyze('https://github.io/');
  assert.equal(apex.level, 'safe');
  assert.equal(apex.findings.length, 0);

  const page = analyze('https://user.github.io/');
  const finding = page.findings.find((item) => item.id === 'free-hosting');
  assert.ok(finding, '無料ホスティングの情報は表示する');
  assert.ok(page.score <= 15);
});

test('数字置換（リート表記）を検出する', () => {
  const result = analyze('https://g00gle.com/');
  assert.equal(result.level, 'danger');
  assert.ok(result.score >= 70);
  assert.ok(result.findings.some((f) => f.id === 'leetspeak-brand'));
});

test('1文字違いのタイポスクワットを検出する', () => {
  const result = analyze('https://gooogle.com/');
  assert.equal(result.level, 'danger');
  assert.ok(result.score >= 70);
  assert.ok(result.findings.some((f) => f.id === 'typosquat'));
});

test('キリル文字を使った同形異義語攻撃を検出する', () => {
  const result = analyze('https://g\u043eogle.com/');
  assert.equal(result.level, 'danger');
  assert.equal(result.score, 100);
  assert.ok(result.findings.some((f) => f.id === 'homograph-brand'));
  assert.ok(result.findings.some((f) => f.id === 'mixed-script'));
  assert.ok(result.findings.some((f) => f.id === 'punycode'));
});

test('punycode の偽 PayPal を検出する', () => {
  const result = analyze('https://xn--pypal-4ve.com/');
  assert.equal(result.level, 'danger');
  assert.equal(result.score, 100);
  assert.match(result.decodedHost, /pаypal/); // キリル文字の а
});

test('正規ドメインを埋め込んだサブドメインを検出する', () => {
  for (const url of [
    'https://paypal.com.evil-example.com/',
    'https://www.google.co.jp.fake-site.net/',
    'https://www.paypal.com.mysite.xyz/',
    'https://www.amazon.co.jp.account-verify.ml/',
    'https://google.com.evil.com/',
  ]) {
    const result = analyze(url);
    assert.equal(result.level, 'danger', `${url} => ${result.score}`);
    assert.ok(result.score >= 70, `${url} score=${result.score}`);
    assert.ok(
      result.findings.some((f) => f.id === 'embedded-brand-domain'),
      `${url} findings=${result.findings.map((f) => f.id)}`,
    );
  }
});

test('ブランド名＋誘導語＋危険 TLD を検出する', () => {
  const result = analyze('https://secure-paypal-login.top/');
  assert.equal(result.level, 'danger');
  assert.ok(result.score >= 70);
  assert.ok(result.findings.some((f) => f.id === 'brand-token-embedding'));
  assert.ok(result.findings.some((f) => f.id === 'sensitive-keywords'));
  assert.ok(result.findings.some((f) => f.id === 'risky-tld-medium'));
});

test('URL 内の @ を使った偽装を検出する', () => {
  const result = analyze('https://google.com@evil-phish.com/');
  assert.equal(result.hostname, 'evil-phish.com');
  assert.equal(result.level, 'danger');
  assert.ok(result.findings.some((f) => f.id === 'userinfo-trick'));
});

test('IP アドレス直指定と HTTP を検出する', () => {
  const result = analyze('http://192.168.10.5/login.php');
  assert.equal(result.level, 'high');
  assert.ok(result.findings.some((f) => f.id === 'ip-host'));
  assert.ok(result.findings.some((f) => f.id === 'http-sensitive'));
});

test('短縮 URL・無料ホスティング・危険 TLD', () => {
  const shortener = analyze('https://bit.ly/3xyz');
  assert.ok(shortener.findings.some((f) => f.id === 'url-shortener'));
  assert.equal(shortener.level, 'low');

  const hosting = analyze('https://phishing-app.herokuapp.com/login');
  assert.ok(hosting.findings.some((f) => f.id === 'free-hosting'));
  assert.ok(hosting.score >= 25);

  const risky = analyze('https://free-gift-prize-winner.tk/');
  assert.ok(risky.findings.some((f) => f.id === 'risky-tld-high'));
  assert.notEqual(risky.level, 'safe');
});

test('HTTP 単体は情報扱い、ログイン関連なら加点する', () => {
  const plain = analyze('http://example.com/');
  assert.equal(plain.score, 0);
  assert.equal(plain.level, 'safe');
  assert.equal(plain.findings.find((f) => f.id === 'http').severity, 'info');

  const login = analyze('http://example.com/login');
  assert.ok(login.score >= 25);
  assert.ok(login.findings.some((f) => f.id === 'http-sensitive'));
});

test('ホワイトリストはすべての検知より優先される', () => {
  const result = analyze('https://paypal.com.evil-example.com/', {
    whitelist: ['evil-example.com'],
  });
  assert.equal(result.whitelisted, true);
  assert.equal(result.level, 'safe');
  assert.equal(result.score, 0);
});

test('ルールの無効化が反映される', () => {
  const result = analyze('https://g00gle.com/', { ignoreRules: ['leetspeak-brand'] });
  assert.equal(result.score, 0);
  assert.equal(result.findings.some((f) => f.id === 'leetspeak-brand'), false);
});

test('感度係数がスコアに反映される', () => {
  const loose = analyze('https://stack.com/', { sensitivity: 'loose' });
  const normal = analyze('https://stack.com/', { sensitivity: 'normal' });
  const strict = analyze('https://stack.com/', { sensitivity: 'strict' });
  assert.equal(loose.factor, SENSITIVITY.loose.factor);
  assert.equal(normal.factor, 1);
  assert.equal(strict.factor, SENSITIVITY.strict.factor);
  assert.ok(loose.score <= normal.score);
  assert.ok(normal.score <= strict.score);
});

test('危険なプロトコル・不正 URL を拒否する', () => {
  const script = analyze('javascript:alert(1)');
  assert.equal(script.level, 'danger');
  assert.ok(script.findings.some((f) => f.id === 'dangerous-scheme'));

  const invalid = analyze('not a url');
  assert.equal(invalid.level, 'danger');
  assert.ok(invalid.findings.some((f) => f.id === 'invalid-url'));
});

test('Safe Browsing の結果を最優先でマージする', () => {
  const base = analyze('https://google.com/test');
  const merged = mergeSafeBrowsing(base, [{ threatType: 'SOCIAL_ENGINEERING' }]);
  assert.equal(merged.level, 'danger');
  assert.equal(merged.score, 100);
  assert.equal(merged.findings[0].id, 'safe-browsing');
  assert.match(merged.findings[0].title, /フィッシング詐欺/);
});

test('レベル定義と判定結果が一致する', () => {
  for (const level of Object.keys(LEVELS)) {
    assert.equal(typeof LEVELS[level].label, 'string');
  }
  const result = analyze('https://gooogle.com/');
  assert.equal(result.level, 'danger');
  assert.equal(LEVELS[result.level].label, '危険');
});

test('結果オブジェクトに表示用フィールドが揃っている', () => {
  const result = analyze('https://www.google.co.jp/');
  for (const key of [
    'url', 'hostname', 'decodedHost', 'registeredDomain', 'displayRegisteredDomain',
    'baseDomain', 'displayHost', 'level', 'score', 'findings', 'checkedAt',
  ]) {
    assert.ok(key in result, key);
  }
  assert.equal(result.registeredDomain, 'google.co.jp');
  assert.equal(result.baseDomain, 'google');
});
