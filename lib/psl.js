/**
 * Public Suffix List を使ったドメイン境界の判定。
 *
 * `new URL().hostname` は IDN を punycode に変換するため、
 * 生成済みの psl-data.js も ASCII（punycode）で保持しています。
 */
import { PSL_RULES, PSL_EXCEPTIONS } from './psl-data.js';

const RULES = new Set(PSL_RULES.split('\n').filter(Boolean));
const EXCEPTIONS = new Set(PSL_EXCEPTIONS.split('\n').filter(Boolean));

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function normalizeHostname(hostname) {
  if (!hostname) return '';
  return String(hostname).trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function isIpHost(hostname) {
  const host = normalizeHostname(hostname);
  if (host.includes(':')) return true;
  const match = IPV4_RE.exec(host);
  if (!match) return false;
  return [1, 2, 3, 4].every((i) => Number(match[i]) <= 255);
}

/**
 * ホスト名の公開サフィックス（例: example.co.jp -> co.jp）を返します。
 * 該当がなければ最後のラベル（例: example.com -> com）を返します。
 */
export function getPublicSuffix(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return '';
  if (isIpHost(host)) return host;
  const labels = host.split('.').filter(Boolean);
  if (labels.length === 0) return '';

  // 例外規則（!www.ck など）が最優先。
  for (let i = 0; i < labels.length; i += 1) {
    const candidate = labels.slice(i).join('.');
    if (EXCEPTIONS.has(candidate)) {
      return labels.slice(i + 1).join('.') || candidate;
    }
  }

  // 最も長く一致する規則を採用する。
  for (let i = 0; i < labels.length; i += 1) {
    const candidate = labels.slice(i).join('.');
    if (RULES.has(candidate)) return candidate;
    if (i + 1 < labels.length && RULES.has('*.' + labels.slice(i + 1).join('.'))) {
      return candidate;
    }
  }

  return labels[labels.length - 1];
}

/** 登録可能ドメイン（eTLD+1）を返します。 */
export function getRegisteredDomain(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return '';
  if (isIpHost(host)) return host;
  const suffix = getPublicSuffix(host);
  if (!suffix) return host;
  if (host === suffix) return host;
  if (!host.endsWith('.' + suffix)) return suffix;
  const base = host.slice(0, -(suffix.length + 1)).split('.').pop();
  return base ? `${base}.${suffix}` : suffix;
}

/** 登録可能ドメインから公開サフィックスを除いたベース部分を返します。 */
export function getBaseDomain(registeredOrHostname) {
  const registered = getRegisteredDomain(registeredOrHostname);
  if (!registered) return '';
  const suffix = getPublicSuffix(registered);
  if (!suffix || registered === suffix) return registered;
  return registered.slice(0, -(suffix.length + 1));
}

/** 公開サフィックスそのもの（例: com, co.jp）かどうか。 */
export function isPublicSuffix(hostname) {
  const host = normalizeHostname(hostname);
  return Boolean(host) && host === getPublicSuffix(host);
}

export const PSL = {
  rules: RULES,
  exceptions: EXCEPTIONS,
};
