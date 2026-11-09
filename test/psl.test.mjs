import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPublicSuffix, getRegisteredDomain, getBaseDomain,
  isPublicSuffix, isIpHost, normalizeHostname,
} from '../lib/psl.js';
import { PSL_EXCEPTIONS, PSL_RULES } from '../lib/psl-data.js';

test('PSL データが読み込まれている', () => {
  assert.ok(PSL_RULES.split('\n').filter(Boolean).length > 8000);
  assert.ok(PSL_EXCEPTIONS.split('\n').filter(Boolean).length > 0);
});

test('公開サフィックスを正しく判定する', () => {
  assert.equal(getPublicSuffix('www.google.com'), 'com');
  assert.equal(getPublicSuffix('www.google.co.jp'), 'co.jp');
  assert.equal(getPublicSuffix('example.co.uk'), 'co.uk');
  assert.equal(getPublicSuffix('user.github.io'), 'github.io');
  assert.equal(getPublicSuffix('city.kawasaki.jp'), 'kawasaki.jp');
  assert.equal(getPublicSuffix('www.ck'), 'ck');
  assert.equal(getPublicSuffix('foo.www.ck'), 'ck');
  assert.equal(getPublicSuffix(''), '');
});

test('登録可能ドメイン（eTLD+1）を正しく判定する', () => {
  assert.equal(getRegisteredDomain('www.google.com'), 'google.com');
  assert.equal(getRegisteredDomain('a.b.example.co.jp'), 'example.co.jp');
  assert.equal(getRegisteredDomain('user.github.io'), 'user.github.io');
  assert.equal(getRegisteredDomain('github.io'), 'github.io');
  assert.equal(getRegisteredDomain('shop.example.co.uk'), 'example.co.uk');
  assert.equal(getRegisteredDomain('deep.a.b.example.com'), 'example.com');
});

test('ベースドメイン（登録ドメインの左端ラベル）を返す', () => {
  assert.equal(getBaseDomain('google.com'), 'google');
  assert.equal(getBaseDomain('example.co.jp'), 'example');
  assert.equal(getBaseDomain('user.github.io'), 'user');
});

test('公開サフィックス全体かどうかを判定する', () => {
  assert.equal(isPublicSuffix('com'), true);
  assert.equal(isPublicSuffix('co.jp'), true);
  assert.equal(isPublicSuffix('github.io'), true);
  assert.equal(isPublicSuffix('example.com'), false);
  assert.equal(isPublicSuffix('user.github.io'), false);
});

test('IP アドレスをホスト名として扱わない', () => {
  assert.equal(isIpHost('127.0.0.1'), true);
  assert.equal(isIpHost('192.168.1.1'), true);
  assert.equal(isIpHost('256.1.1.1'), false);
  assert.equal(isIpHost('::1'), true);
  assert.equal(isIpHost('example.com'), false);
});

test('ホスト名の正規化', () => {
  assert.equal(normalizeHostname('  EXAMPLE.COM. '), 'example.com');
  assert.equal(normalizeHostname('[::1]'), '::1');
  assert.equal(normalizeHostname(''), '');
  assert.equal(normalizeHostname(null), '');
});
