export const TWO_LEVEL_TLDS = new Set([
  'co.jp', 'ne.jp', 'or.jp', 'go.jp', 'ac.jp', 'lg.jp', 'ed.jp', 'gr.jp', 'me.jp',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'sch.uk',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.tw', 'org.tw', 'gov.tw', 'edu.tw', 'net.tw',
  'com.hk', 'org.hk', 'gov.hk', 'edu.hk', 'net.hk',
  'com.sg', 'net.sg', 'org.sg', 'gov.sg', 'edu.sg',
  'co.in', 'firm.in', 'net.in', 'org.in', 'gen.in', 'ind.in', 'ac.in', 'edu.in', 'gov.in',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.mx', 'org.mx', 'gob.mx', 'edu.mx', 'net.mx',
  'co.id', 'or.id', 'ac.id', 'go.id', 'web.id', 'my.id',
  'co.th', 'ac.th', 'go.th', 'in.th', 'or.th', 'net.th',
  'com.my', 'org.my', 'gov.my', 'edu.my', 'net.my',
  'com.ph', 'gov.ph', 'edu.ph', 'org.ph', 'net.ph',
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn',
  'co.za', 'org.za', 'web.za', 'gov.za', 'ac.za',
  'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'edu.ar',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr', 'bel.tr',
  'com.sa', 'net.sa', 'org.sa', 'gov.sa', 'edu.sa',
  'com.eg', 'net.eg', 'org.eg', 'gov.eg', 'edu.eg',
  'co.il', 'org.il', 'net.il', 'gov.il', 'ac.il', 'muni.il',
  'com.cn.hk' ,
  'org.info',
]);

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isIPv4(host) {
  const m = IPV4_RE.exec(host || '');
  if (!m) return false;
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (n > 255 || (m[i].length > 1 && m[i][0] === '0')) return false;
  }
  return true;
}

export function isIPv6(host) {
  return typeof host === 'string' && host.includes(':') && /^[0-9a-f:.]+$/i.test(host);
}

export function isIPAddress(host) {
  return isIPv4(host) || isIPv6(host);
}

export function getRegisteredDomain(hostname) {
  if (!hostname) return '';
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (isIPAddress(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  if (TWO_LEVEL_TLDS.has(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

export function getBaseDomain(registered) {
  if (!registered) return '';
  const labels = registered.split('.');
  if (labels.length <= 2) return registered;
  const lastTwo = labels.slice(-2).join('.');
  if (TWO_LEVEL_TLDS.has(lastTwo)) {
    return labels[0];
  }
  return labels[labels.length - 2];
}

export function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
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
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't',
  '8': 'b', '9': 'g', '@': 'a', $: 's', '!': 'i', '|': 'l',
};

export function foldLeet(s) {
  return s.replace(/[01345789@$!|]/g, (c) => LEET_MAP[c] || c);
}

const CONFUSABLES = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
  'ѕ': 's', 'і': 'i', 'ј': 'j', 'һ': 'h', 'ӏ': 'l', 'ԁ': 'd', 'ԛ': 'q',
  'ԝ': 'w', 'в': 'b', 'м': 'm', 'н': 'h', 'т': 't', 'к': 'k', 'і': 'i',
  'ј': 'j', 'џ': 'd', 'ԛ': 'q', 'ґ': 'g', 'Ғ': 'f', 'Х': 'x', 'А': 'a',
  'В': 'b', 'Е': 'e', 'К': 'k', 'М': 'm', 'Н': 'h', 'О': 'o', 'Р': 'p',
  'С': 'c', 'Т': 't', 'У': 'y',
  'ο': 'o', 'α': 'a', 'ε': 'e', 'ι': 'i', 'ρ': 'p', 'ν': 'v', 'τ': 't',
  'κ': 'k', 'χ': 'x', 'γ': 'y', 'μ': 'm', 'σ': 's', 'ς': 's', 'η': 'n',
  'Ο': 'o', 'Α': 'a', 'Ε': 'e', 'Ρ': 'p', 'Σ': 's', 'Τ': 't', 'Χ': 'x',
  'β': 'b', 'ο': 'o', 'ɑ': 'a', 'ɡ': 'g',
  'Ａ': 'a', 'Ｂ': 'b', 'Ｃ': 'c', 'Ｄ': 'd', 'Ｅ': 'e', 'Ｆ': 'f', 'Ｇ': 'g',
  'Ｈ': 'h', 'Ｉ': 'i', 'Ｊ': 'j', 'Ｋ': 'k', 'Ｌ': 'l', 'Ｍ': 'm', 'Ｎ': 'n',
  'Ｏ': 'o', 'Ｐ': 'p', 'Ｑ': 'q', 'Ｒ': 'r', 'Ｓ': 's', 'Ｔ': 't', 'Ｕ': 'u',
  'Ｖ': 'v', 'Ｗ': 'w', 'Ｘ': 'x', 'Ｙ': 'y', 'Ｚ': 'z',
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  'ⅰ': 'i', 'ⅱ': 'ii', 'ⅲ': 'iii', 'ⅳ': 'iv', 'ⅴ': 'v',
  'Ⅰ': 'i', 'Ⅱ': 'ii', 'Ⅲ': 'iii', 'Ⅳ': 'iv', 'Ⅴ': 'v',
  'і': 'i', 'ӏ': 'l', 'ʼ': '', '＇': '', '´': '', '`': '',
  'е': 'e', 'ё': 'e', 'ü': 'u', 'ú': 'u', 'ù': 'u', 'û': 'u',
  'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a',
  'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
  'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o',
  'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'ñ': 'n', 'ç': 'c', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe',
  'ā': 'a', 'ē': 'e', 'ī': 'i', 'ō': 'o', 'ū': 'u',
};

export function foldConfusables(s) {
  let out = '';
  for (const ch of s) {
    out += Object.prototype.hasOwnProperty.call(CONFUSABLES, ch) ? CONFUSABLES[ch] : ch;
  }
  return out;
}

const SCRIPT_PATTERNS = [
  ['Han', /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/],
  ['Hiragana', /[\u3040-\u309f]/],
  ['Katakana', /[\u30a0-\u30ff\u31f0-\u31ff]/],
  ['Hangul', /[\uac00-\ud7af\u1100-\u11ff]/],
  ['Cyrillic', /[\u0400-\u04ff\u0500-\u052f]/],
  ['Greek', /[\u0370-\u03ff\u1f00-\u1fff]/],
  ['Arabic', /[\u0600-\u06ff\u0750-\u077f]/],
  ['Hebrew', /[\u0590-\u05ff]/],
  ['Latin', /[a-zA-Z\u00c0-\u024f]/],
];

export function scriptsIn(s) {
  const found = new Set();
  for (const ch of s) {
    if (/[0-9\-.]/.test(ch)) continue;
    for (const [name, re] of SCRIPT_PATTERNS) {
      if (re.test(ch)) {
        found.add(name);
        break;
      }
    }
  }
  return [...found];
}

export function hasMixedScripts(s) {
  return scriptsIn(s).length > 1;
}

export function isRiskyChar(ch) {
  return /[\s\\@?#%&=+<>^|{}[\]"']/.test(ch);
}

export function safeDecodeURIComponent(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
