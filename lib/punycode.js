const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta, numPoints, firstTime) {
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - TMIN) * TMAX) >> 1) {
    delta = Math.floor(delta / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

function digitValue(code) {
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26;
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;
  throw new Error('punycode: invalid digit');
}

export function punycodeDecode(input) {
  const output = [];
  const basic = input.lastIndexOf('-');
  if (basic > 0) {
    for (let j = 0; j < basic; j++) {
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
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE) throw new Error('punycode: invalid digit');
      i += digit * w;
      const t = Math.max(TMIN, Math.min(TMAX, k - bias));
      if (digit < t) break;
      w *= BASE - t;
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi === 0);
    n += Math.floor(i / out);
    i %= out;
    output.splice(i, 0, String.fromCodePoint(n));
    i++;
  }
  return output.join('');
}

export function decodeHostname(hostname) {
  if (!hostname || !hostname.toLowerCase().includes('xn--')) return hostname;
  return hostname
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
