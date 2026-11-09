/**
 * RFC 3492 punycode デコーダー（表示用）。
 * 不正な入力で無限ループしないよう、オーバーフローを検査します。
 */
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_INT = 0x7fffffff;

function adapt(delta, numPoints, firstTime) {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

function digitValue(code) {
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26;
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;
  return BASE; // 不正な文字
}

export function punycodeDecode(input) {
  const output = [];
  const basic = input.lastIndexOf('-');
  if (basic > 0) {
    for (let j = 0; j < basic; j += 1) {
      const c = input.charCodeAt(j);
      if (c >= 0x80) throw new Error('punycode: invalid basic code point');
      output.push(input.charAt(j));
    }
  }
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  let index = basic > 0 ? basic + 1 : 0;
  while (index < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new Error('punycode: truncated');
      const digit = digitValue(input.charCodeAt(index));
      index += 1;
      if (digit >= BASE) throw new Error('punycode: invalid digit');
      i += digit * w;
      if (i > MAX_INT) throw new Error('punycode: overflow');
      const t = Math.max(TMIN, Math.min(TMAX, k - bias));
      if (digit < t) break;
      w *= BASE - t;
      if (w > MAX_INT) throw new Error('punycode: overflow');
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi === 0);
    n += Math.floor(i / out);
    i %= out;
    if (n > 0x10ffff) throw new Error('punycode: invalid code point');
    output.splice(i, 0, String.fromCodePoint(n));
    i += 1;
  }
  return output.join('');
}

export function decodeHostname(hostname) {
  if (!hostname || !String(hostname).toLowerCase().includes('xn--')) return hostname;
  return String(hostname)
    .split('.')
    .map((label) => {
      if (!/^xn--/i.test(label)) return label;
      try {
        return punycodeDecode(label.slice(4));
      } catch {
        return label;
      }
    })
    .join('.');
}

export function hasPunycode(hostname) {
  return /(^|\.)xn--/i.test(hostname || '');
}
