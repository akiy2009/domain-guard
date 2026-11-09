/**
 * ドメイン判定で共通利用するユーティリティ。
 * 登録ドメインの判定は Public Suffix List（lib/psl.js）に委譲しています。
 */
export {
  getPublicSuffix,
  getRegisteredDomain,
  getBaseDomain,
  isPublicSuffix,
  isIpHost,
  normalizeHostname,
} from './psl.js';

import { getPublicSuffix, getRegisteredDomain, normalizeHostname } from './psl.js';

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isIPv4(host) {
  const value = normalizeHostname(host);
  const match = IPV4_RE.exec(value);
  if (!match) return false;
  for (let i = 1; i <= 4; i += 1) {
    const n = Number(match[i]);
    if (n > 255) return false;
  }
  return true;
}

export function isIPv6(host) {
  const value = normalizeHostname(host);
  if (!value.includes(':')) return false;
  return /^[0-9a-f:]+$/i.test(value) || /^[0-9a-f:.]+$/i.test(value);
}

export function isIPAddress(host) {
  return isIPv4(host) || isIPv6(host);
}

/** ローカルネットワーク・localhost など、外部に送信すべきでないホスト。 */
export function isPrivateHost(host) {
  const value = normalizeHostname(host);
  if (!value) return false;
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local')) {
    return true;
  }
  if (isIPv4(value)) {
    const [a, b] = value.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (isIPv6(value)) {
    return value === '::1'
      || value === '::'
      || /^f[cd][0-9a-f]{0,2}:/i.test(value)
      || /^fe[89ab][0-9a-f]?:/i.test(value);
  }
  return false;
}

/**
 * 編集距離。max を超えた時点で打ち切ります。
 */
export function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j += 1) prev[j] = j;
  for (let i = 1; i <= la; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[lb];
}

const LEET_MAP = {
  0: 'o',
  1: 'l',
  2: 'z',
  3: 'e',
  4: 'a',
  5: 's',
  6: 'g',
  7: 't',
  8: 'b',
  9: 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'l',
};

export function foldLeet(value) {
  return String(value).replace(/[0-9@$!|]/g, (c) => LEET_MAP[c] || c);
}

/**
 * 見た目が似ている文字（キリル文字・ギリシャ文字・全角英数など）を
 * ラテン文字に寄せます。NFKC で全角・互換文字を正規化してから変換します。
 */
const CONFUSABLES = {
  // キリル文字
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h',
  'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'ѕ': 's',
  'і': 'i', 'ї': 'i', 'ј': 'j', 'һ': 'h', 'ӏ': 'l', 'ԁ': 'd', 'ԛ': 'q',
  'ԝ': 'w', 'ѡ': 'w', 'ү': 'y', 'ґ': 'r', 'ҏ': 'p', 'ӧ': 'o', 'ӱ': 'y',
  'А': 'a', 'В': 'b', 'Е': 'e', 'Ё': 'e', 'К': 'k', 'М': 'm', 'Н': 'h',
  'О': 'o', 'Р': 'p', 'С': 'c', 'Т': 't', 'У': 'y', 'Х': 'x', 'Ѕ': 's',
  'І': 'i', 'Ј': 'j', 'Һ': 'h', 'Ӏ': 'l',
  // ギリシャ文字
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o',
  'ρ': 'p', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'u', 'χ': 'x', 'γ': 'y',
  'η': 'n', 'μ': 'm', 'ω': 'w', 'Α': 'a', 'Β': 'b', 'Ε': 'e', 'Ζ': 'z',
  'Η': 'h', 'Ι': 'i', 'Κ': 'k', 'Μ': 'm', 'Ν': 'n', 'Ο': 'o', 'Ρ': 'p',
  'Σ': 's', 'Τ': 't', 'Υ': 'y', 'Χ': 'x',
  // アルメニア文字・チェロキー文字の代表的なもの
  'օ': 'o', 'ս': 'u', 'ց': 'g', 'հ': 'h', 'ո': 'n', 'ք': 'p', 'ա': 'w',
  'Ꭺ': 'a', 'Ꭼ': 'e', 'Ꭱ': 'i', 'Ꭲ': 't', 'Ꮎ': 'o', 'Ꭾ': 'h',
  // ラテン文字の装飾・合字
  'ɑ': 'a', 'ɡ': 'g', 'ɩ': 'i', 'ɪ': 'i', 'ʟ': 'l', 'ᴏ': 'o', 'ᴜ': 'u',
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ł': 'l',
  'þ': 'p', 'ı': 'i',
  'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ā': 'a',
  'ă': 'a', 'ą': 'a', 'ç': 'c', 'ć': 'c', 'č': 'c', 'é': 'e', 'è': 'e',
  'ê': 'e', 'ë': 'e', 'ē': 'e', 'ė': 'e', 'ę': 'e', 'ě': 'e', 'í': 'i',
  'ì': 'i', 'î': 'i', 'ï': 'i', 'ī': 'i', 'į': 'i', 'ñ': 'n', 'ń': 'n',
  'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ō': 'o', 'ő': 'o',
  'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ū': 'u', 'ů': 'u', 'ű': 'u',
  'ý': 'y', 'ÿ': 'y', 'ś': 's', 'š': 's', 'ş': 's', 'ž': 'z', 'ź': 'z',
  'ż': 'z', 'ť': 't', 'ţ': 't', 'ř': 'r', 'ŕ': 'r',
  // 記号・結合文字
  'ʼ': '', '＇': '', '´': '', '`': '', '\u00ad': '', '\u200b': '',
  '\u200c': '', '\u200d': '', '\ufeff': '',
};

export function foldConfusables(value) {
  const input = String(value);
  const normalized = typeof input.normalize === 'function' ? input.normalize('NFKC') : input;
  let out = '';
  for (const ch of normalized) {
    out += Object.prototype.hasOwnProperty.call(CONFUSABLES, ch) ? CONFUSABLES[ch] : ch;
  }
  return out;
}

const SCRIPT_PATTERNS = [
  ['Japanese', /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/],
  ['Hangul', /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/],
  ['Cyrillic', /[\u0400-\u04ff\u0500-\u052f]/],
  ['Greek', /[\u0370-\u03ff\u1f00-\u1fff]/],
  ['Armenian', /[\u0530-\u058f]/],
  ['Hebrew', /[\u0590-\u05ff]/],
  ['Arabic', /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/],
  ['Cherokee', /[\u13a0-\u13ff\uab70-\uabbf]/],
  ['Latin', /[a-z\u00c0-\u024f\u1e00-\u1eff]/i],
];

export function scriptsIn(value) {
  const found = new Set();
  for (const ch of String(value)) {
    if (/[0-9\-._~]/.test(ch)) continue;
    for (const [name, re] of SCRIPT_PATTERNS) {
      if (re.test(ch)) {
        found.add(name);
        break;
      }
    }
  }
  return [...found];
}

export function hasMixedScripts(value) {
  return scriptsIn(value).length > 1;
}

/**
 * ブランドのなりすましに使われる文字種の混在かどうか。
 * 日本語（漢字・ひらがな・カタカナ）の混在は正常なので許可します。
 */
export function hasConfusableScriptMix(value) {
  const scripts = new Set(scriptsIn(value));
  if (scripts.size <= 1) return false;
  const confusable = ['Cyrillic', 'Greek', 'Armenian', 'Cherokee'];
  if (scripts.has('Latin') && confusable.some((s) => scripts.has(s))) return true;
  return scripts.has('Cyrillic') && scripts.has('Greek');
}

/**
 * 制御文字・双方向制御文字（URL の表示を偽装する手口）。
 */
export function hasBidiOrControlChars(value) {
  return /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/.test(String(value));
}

export function isRiskyChar(ch) {
  return /[\s\\@?#%&=+<>^|{}[\]"']/.test(ch);
}

export function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 表示用に登録ドメインを安全に取得します。 */
export function registeredDomainOf(hostname) {
  try {
    return getRegisteredDomain(hostname);
  } catch {
    return normalizeHostname(hostname);
  }
}

/** 公開サフィックスのラベル数（表示・深さ計算用）。 */
export function suffixLabelCount(hostname) {
  const suffix = getPublicSuffix(hostname);
  return suffix ? suffix.split('.').length : 0;
}
