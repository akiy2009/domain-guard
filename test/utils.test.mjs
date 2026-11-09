import assert from 'node:assert/strict';
import test from 'node:test';

import {
  foldConfusables, foldLeet, hasBidiOrControlChars, hasConfusableScriptMix,
  hasMixedScripts, isIPAddress, isIPv4, isIPv6, isPrivateHost, isRiskyChar,
  levenshtein, scriptsIn, safeDecodeURIComponent,
} from '../lib/utils.js';
import { decodeHostname, hasPunycode, punycodeDecode } from '../lib/punycode.js';

test('レーベンシュタイン距離', () => {
  assert.equal(levenshtein('google', 'google'), 0);
  assert.equal(levenshtein('google', 'gooogle'), 1);
  assert.equal(levenshtein('paypal', 'paypa1'), 1);
  assert.equal(levenshtein('google', 'gooogle', 0), 1);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
});

test('リート表記の正規化', () => {
  assert.equal(foldLeet('g00gle'), 'google');
  assert.equal(foldLeet('paypa1'), 'paypal');
  assert.equal(foldLeet('$ecret'), 'secret');
});

test('同形異義語の正規化', () => {
  assert.equal(foldConfusables('gоogle'), 'google'); // キリル文字の о
  assert.equal(foldConfusables('ｇｏｏｇｌｅ'), 'google'); // 全角
  assert.equal(foldConfusables('bücher'), 'bucher');
});

test('文字種の判定', () => {
  assert.deepEqual(scriptsIn('example.com'), ['Latin']);
  assert.deepEqual(scriptsIn('日本語'), ['Japanese']);
  assert.deepEqual(scriptsIn('日本語.jp'), ['Japanese', 'Latin']);
  assert.equal(hasMixedScripts('日本語.com'), true);
  assert.equal(hasConfusableScriptMix('gоogle'), true);
  assert.equal(hasConfusableScriptMix('日本語.jp'), false);
  assert.equal(hasConfusableScriptMix('example.com'), false);
});

test('制御文字・双方向文字の検出', () => {
  assert.equal(hasBidiOrControlChars('example.com'), false);
  assert.equal(hasBidiOrControlChars('exam\u202eple.com'), true);
  assert.equal(hasBidiOrControlChars('exa\u200bmple.com'), true);
});

test('危険な文字の判定', () => {
  assert.equal(isRiskyChar('@'), true);
  assert.equal(isRiskyChar('a'), false);
});

test('IP アドレスの判定', () => {
  assert.equal(isIPv4('192.168.0.1'), true);
  assert.equal(isIPv4('999.1.1.1'), false);
  assert.equal(isIPv6('::1'), true);
  assert.equal(isIPv6('2001:db8::1'), true);
  assert.equal(isIPAddress('example.com'), false);
});

test('ローカル・プライベートホストの判定', () => {
  for (const host of [
    'localhost', 'app.localhost', 'printer.local', '127.0.0.1', '10.1.2.3',
    '172.16.0.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1',
  ]) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ['example.com', '8.8.8.8', '172.32.0.1', '2001:db8::1']) {
    assert.equal(isPrivateHost(host), false, host);
  }
});

test('URI デコードの安全なフォールバック', () => {
  assert.equal(safeDecodeURIComponent('%E3%81%82'), 'あ');
  assert.equal(safeDecodeURIComponent('%E3'), '%E3');
});

test('punycode のデコード', () => {
  assert.equal(punycodeDecode('bcher-kva'), 'bücher');
  assert.equal(decodeHostname('xn--bcher-kva.example'), 'bücher.example');
  assert.equal(decodeHostname('xn--gogle-jye.com'), 'gоogle.com');
  assert.equal(decodeHostname('example.com'), 'example.com');
  assert.equal(hasPunycode('xn--bcher-kva.example'), true);
  assert.equal(hasPunycode('example.com'), false);
});

test('壊れた punycode でも例外を外へ出さない', () => {
  assert.equal(decodeHostname('xn--99999999999.com'), 'xn--99999999999.com');
  assert.throws(() => punycodeDecode('9999999999999999999999'), /overflow/);
  assert.throws(() => punycodeDecode('-'), /invalid/);
});
