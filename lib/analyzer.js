import { decodeHostname, hasPunycode } from './punycode.js';
import {
  getRegisteredDomain, getBaseDomain, levenshtein, foldLeet, foldConfusables,
  hasMixedScripts, scriptsIn, isIPAddress, isIPv4, isIPv6, TWO_LEVEL_TLDS,
} from './utils.js';
import { BRANDS, FREE_HOSTING, URL_SHORTENERS, RISKY_TIERS, SENSITIVE_KEYWORDS } from './brands.js';

export const LEVELS = {
  safe: { label: '安全', color: '#1e8e3e', icon: 'safe' },
  low: { label: 'ほぼ安全', color: '#f9ab00', icon: 'low' },
  medium: { label: '要注意', color: '#e8710a', icon: 'medium' },
  high: { label: '危険の可能性大', color: '#d93025', icon: 'high' },
  danger: { label: '危険', color: '#a50e0e', icon: 'danger' },
};

export const SENSITIVITY = {
  loose: { factor: 0.6, label: '緩い（誤検知を減らす）' },
  normal: { factor: 1, label: '標準' },
  strict: { factor: 1.4, label: '厳しい（疑わしいサイトを広く警告）' },
};

const BRAND_TOKEN_INDEX = (() => {
  const map = new Map();
  for (const b of BRANDS) {
    const tokens = new Set(b.t || []);
    tokens.add(getBaseDomain(b.d));
    tokens.add(getBaseDomain(b.d).replace(/-/g, ''));
    for (const t of tokens) {
      if (!t || t.length < 3) continue;
      const key = t.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(b);
    }
  }
  return map;
})();

function finding(id, severity, score, title, description, extra = {}) {
  return { id, severity, score, title, description, ...extra };
}

function levelOf(score) {
  if (score >= 70) return 'danger';
  if (score >= 45) return 'high';
  if (score >= 25) return 'medium';
  if (score >= 1) return 'low';
  return 'safe';
}

function isWhitelisted(hostname, whitelist) {
  if (!hostname || !whitelist || !whitelist.length) return false;
  const host = hostname.toLowerCase().replace(/\.$/, '');
  for (const raw of whitelist) {
    const w = String(raw || '').toLowerCase().trim().replace(/^\*\./, '').replace(/\.$/, '');
    if (!w) continue;
    if (host === w || host.endsWith('.' + w)) return true;
  }
  return false;
}

function normalizeHostForCompare(host) {
  return foldConfusables(foldLeet(host.toLowerCase().replace(/\.$/, '')));
}

function splitLabelTokens(hostname) {
  return hostname.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function tldOf(registered) {
  const labels = registered.split('.');
  if (labels.length <= 1) return '';
  const lastTwo = labels.slice(-2).join('.');
  if (TWO_LEVEL_TLDS.has(lastTwo)) return lastTwo.split('.')[1];
  return labels[labels.length - 1];
}

function findEmbeddedBrandDomain(labels) {
  const hits = [];
  for (const b of BRANDS) {
    const bLabels = b.d.split('.');
    if (bLabels.length > labels.length) continue;
    for (let i = 0; i <= labels.length - bLabels.length; i++) {
      const slice = labels.slice(i, i + bLabels.length);
      if (slice.join('.') === b.d) {
        if (i + bLabels.length === labels.length) continue;
        hits.push({ brand: b, at: i });
      }
    }
  }
  return hits;
}

export function analyzeUrl(rawUrl, options = {}) {
  const whitelist = options.whitelist || [];
  const sensitivity = options.sensitivity || 'normal';
  const factor = (SENSITIVITY[sensitivity] || SENSITIVITY.normal).factor;
  const ignoreList = options.ignoreRules || [];

  const findings = [];
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      url: rawUrl, hostname: '', level: 'danger', score: 100,
      findings: [finding('invalid-url', 'danger', 100, 'URLとして解析できない', 'URLの形式が正しくありません。リンクをクリックする前に内容を確認してください。')],
      checkedAt: Date.now(),
    };
  }

  const scheme = url.protocol.toLowerCase();
  if (['javascript:', 'data:', 'vbscript:'].includes(scheme)) {
    return {
      url: rawUrl, hostname: '', level: 'danger', score: 100,
      findings: [finding('dangerous-scheme', 'danger', 100, `危険なプロトコル: ${scheme}`, 'このURLスキームは実行可能なコードやデータを直接渡すものです。通常のWebサイトでは使用されません。')],
      checkedAt: Date.now(),
    };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const decodedHost = decodeHostname(hostname);
  const registered = getRegisteredDomain(hostname);
  const registeredDecoded = decodeHostname(registered);
  const baseDecoded = getBaseDomain(registeredDecoded);
  const labels = hostname.split('.');
  const href = url.href;

  if (!hostname) {
    return {
      url: rawUrl, hostname: '', level: 'medium', score: 20,
      findings: [finding('no-host', 'medium', 20, 'ホスト名がない', 'ドメイン名を持たないURLです。')], checkedAt: Date.now(),
    };
  }

  if (isWhitelisted(hostname, whitelist) || isWhitelisted(registered, whitelist)) {
    return {
      url: rawUrl, hostname, decodedHost, registeredDomain: registered, displayHost: decodedHost !== hostname ? decodedHost : hostname,
      level: 'safe', score: 0, whitelisted: true,
      findings: [finding('whitelisted', 'info', 0, 'ホワイトリスト登録済み', 'あなたが登録した信頼できるドメインです。')],
      checkedAt: Date.now(),
    };
  }

  const push = (f) => {
    if (ignoreList.includes(f.id)) return;
    findings.push(f);
  };

  if (url.username || url.password || href.includes('@')) {
    const atCount = (href.match(/@/g) || []).length;
    if (url.username || atCount > 0) {
      push(finding('userinfo-trick', 'danger', 40,
        'URLに「@」を使った偽装の可能性',
        `アドレス表示欄では「${url.username || 'xxxx'}@${hostname}」の部分が隠れ、実際には別のサイト「${hostname}」へ接続しようとしています。`));
    }
  }

  if (scheme === 'http:') {
    const kwHit = SENSITIVE_KEYWORDS.some((k) => hostname.includes(k.w));
    if (kwHit) {
      push(finding('http-sensitive', 'high', 25,
        '通信が暗号化されていない（HTTP）＋ログイン関連の語句',
        'パスワード等を入力する可能性のあるページで、通信が暗号化されていません。盗み見される恐れがあります。'));
    } else {
      push(finding('http', 'info', 5,
        '通信が暗号化されていない（HTTP）',
        'HTTPSではなくHTTPです。公共のWi-Fi等では通信内容を盗み見られる可能性があります。'));
    }
  }

  if (isIPv4(hostname)) {
    push(finding('ip-host', 'high', 28,
      'IPアドレスがドメイン名の代わりに使われている',
      `通常のドメイン名ではなく「${hostname}」というIPアドレス直接指定です。フィッシング詐欺で多用される手口です。`));
  } else if (isIPv6(hostname)) {
    push(finding('ipv6-host', 'medium', 18,
      'IPv6アドレスがドメイン名の代わりに使われている',
      '通常のドメイン名ではなくIPv6アドレスが直接指定されています。'));
  }

  if (!isIPAddress(hostname)) {
    if (url.port && !['80', '443'].includes(url.port)) {
      push(finding('unusual-port', 'low', 8,
        `不審なポート番号（:${url.port}）`,
        '通常使用されないポート番号が指定されています。'));
    }
  }

  if (hostname.length > 60) {
    push(finding('long-host', 'low', 8, 'ドメイン名が異常に長い', '非常に長いドメイン名は、本物らしく見せかけるために使われることがあります。'));
  }

  const hyphens = (hostname.match(/-/g) || []).length;
  if (hyphens >= 5) {
    push(finding('many-hyphens', 'medium', 12, 'ハイフンが非常に多い', `ドメイン名にハイフンが${hyphens}個も含まれています。ブランド名を埋め込む偽ドメインの典型パターンです。`));
  } else if (hyphens >= 3) {
    push(finding('some-hyphens', 'low', 7, 'ハイフンが多い', `ドメイン名にハイフンが${hyphens}個含まれています。`));
  }

  const alnum = hostname.replace(/[^a-z0-9]/gi, '');
  const digitRatio = alnum ? (alnum.match(/\d/g) || []).length / alnum.length : 0;
  if (digitRatio > 0.35 && alnum.length >= 6) {
    push(finding('many-digits', 'medium', 10, '数字が非常に多い', 'ブランド名の一部を数字（0や1など）に置き換えた偽装によく見られる特徴です。'));
  }

  const subDepth = labels.length - registered.split('.').length;
  if (subDepth >= 3) {
    push(finding('deep-subdomains', 'low', 7,
      'サブドメインの階層が深い',
      `「${hostname}」のように階層が深く、本物に見せかけるための伪装である可能性があります。`));
  }

  const puny = hasPunycode(hostname);
  let mixedHost = false;
  if (puny) {
    mixedHost = hasMixedScripts(decodedHost);
    const scripts = scriptsIn(decodedHost);
    push(finding('punycode', mixedHost ? 'high' : 'medium', mixedHost ? 30 : 20,
      mixedHost ? '多言語文字（同形異義語攻撃）の可能性' : 'punycode（国際化ドメイン名）が使われている',
      mixedHost
        ? `「${decodedHost}」には ${scripts.join('・')} の文字が混在しています。見た目が本物と非常に似せた偽ドメイン（同形異義語攻撃）の典型例です。`
        : `表示上は「${decodedHost}」のように見えますが、実体は「${hostname}」です。文字が本物と異なっている可能性があります。`));
    if (mixedHost) {
      push(finding('mixed-script', 'danger', 35,
        '異なる文字種が混在しているドメイン',
        'ローマ字とキリル文字やギリシャ文字などを混ぜて、本物そっくりに見せる攻撃です。アドレスバーの表記をよく確認してください。'));
    }
  }

  const regCmp = normalizeHostForCompare(registeredDecoded);
  const baseCmp = normalizeHostForCompare(baseDecoded);

  for (const b of BRANDS) {
    const bReg = b.d;
    const bBase = getBaseDomain(bReg);
    if (hostname === bReg || hostname.endsWith('.' + bReg)) {
      continue;
    }
    if (regCmp === normalizeHostForCompare(bReg) && registeredDecoded !== bReg) {
      push(finding('homograph-brand', 'danger', 50,
        `「${b.n}」を装った同形異義語ドメイン`,
        `「${decodedHost}」は本物の「${bReg}」と文字が一箇所でも異なります。巧妙に偽装されたフィッシングサイトの可能性が高いです。`,
        { brand: b.n, target: bReg }));
      continue;
    }
    const leetReg = foldLeet(registeredDecoded.toLowerCase());
    const leetBrand = foldLeet(bReg);
    if (leetReg === leetBrand && registeredDecoded !== bReg) {
      push(finding('leetspeak-brand', 'danger', 45,
        `「${b.n}」を装った数字置換ドメイン`,
        `「${decodedHost}」は「0→O」「1→l」などの置き換えで本物「${bReg}」を模したものです。`,
        { brand: b.n, target: bReg }));
      continue;
    }
    const bNorm = normalizeHostForCompare(bReg);
    const bBaseNorm = normalizeHostForCompare(bBase);
    if (Math.abs(baseCmp.length - bBaseNorm.length) <= 2 && baseCmp !== bBaseNorm) {
      const d = levenshtein(baseCmp, bBaseNorm, 2);
      if (d >= 1 && d <= 2 && Math.min(baseCmp.length, bBaseNorm.length) >= 5) {
        push(finding('typosquat', d === 1 ? 'danger' : 'high', d === 1 ? 45 : 30,
          `「${b.n}」のタイポスクワティング（なりすましドメイン）`,
          `「${decodedHost}」は本物の「${bReg}」と似すぎています（${d}文字違い）。打間違いや巧妙に似せた偽ドメインである可能性があります。`,
          { brand: b.n, target: bReg, distance: d }));
        break;
      }
    }
  }

  const embedded = findEmbeddedBrandDomain(labels);
  if (embedded.length) {
    const e = embedded[0];
    push(finding('embedded-brand-domain', 'danger', 50,
      `「${e.brand.n}」の正規ドメインを埋め込んだ偽装URL`,
      `「${hostname}」の中に本物の「${e.brand.d}」が埋め込まれていますが、最終的に接続先は「${registeredDecoded}」です。よくある偽ドメインの手口です。`,
      { brand: e.brand.n, target: e.brand.d }));
  } else {
    const onRealBrandDomain = BRANDS.some((b) => hostname === b.d || hostname.endsWith('.' + b.d));
    const tokens = onRealBrandDomain ? [] : splitLabelTokens(decodedHost);
    const tokenHits = new Map();
    for (const t of tokens) {
      if (t.length < 4) continue;
      const candidates = BRAND_TOKEN_INDEX.get(t);
      if (!candidates) continue;
      for (const b of candidates) {
        if (hostname === b.d || hostname.endsWith('.' + b.d)) continue;
        if (normalizeHostForCompare(registeredDecoded) === normalizeHostForCompare(b.d)) continue;
        tokenHits.set(b.d, b);
      }
    }
    if (tokenHits.size) {
      const b = [...tokenHits.values()][0];
      push(finding('brand-token-embedding', 'danger', 35,
        `無関係なドメインに「${b.n}」の名前が使われている`,
        `「${decodedHost}」は「${b.n}」の正規ドメイン（${b.d}）ではありませんが、名前を借りて本物に見せかけています。`,
        { brand: b.n, target: b.d }));
    }
  }

  const tld = tldOf(registered);
  if (tld) {
    if (RISKY_TIERS.high.includes(tld)) {
      push(finding('risky-tld-high', 'high', 22,
        `フィッシングに非常に利用されるトップレベルドメイン（.${tld}）`,
        `「.${tld}」は安価または無料で登録でき、不正利用が多発しているTLDです。安易に情報を入力しないでください。`));
    } else if (RISKY_TIERS.medium.includes(tld)) {
      push(finding('risky-tld-medium', 'medium', 14,
        `不正利用が見られるトップレベルドメイン（.${tld}）`,
        `「.${tld}」はフィッシング詐欺での利用が報告されています。サイトの運営者を確認してください。`));
    } else if (RISKY_TIERS.low.includes(tld)) {
      push(finding('risky-tld-low', 'low', 6,
        `注意が必要なトップレベルドメイン（.${tld}）`,
        `「.${tld}」は誰でも容易に登録できるTLDです。内容を確認せず情報入力しないでください。`));
    }
  }

  const legitBrandTokens = new Set();
  for (const b of BRANDS) {
    if (hostname === b.d || hostname.endsWith('.' + b.d)) {
      legitBrandTokens.add(getBaseDomain(b.d));
      for (const t of b.t || []) legitBrandTokens.add(t);
    }
  }
  const seenKeywords = new Set();
  let kwScore = 0;
  for (const k of SENSITIVE_KEYWORDS) {
    if (hostname.includes(k.w) && !seenKeywords.has(k.w) && !legitBrandTokens.has(k.w)) {
      seenKeywords.add(k.w);
      kwScore += k.s;
    }
  }
  if (kwScore > 0) {
    const capped = Math.min(kwScore, 25);
    push(finding('sensitive-keywords', kwScore >= 20 ? 'high' : 'medium', capped,
      'ログイン・確認などを誘導する語句が含まれている',
      `ドメイン名に「${[...seenKeywords].slice(0, 8).join('」「')}」などの、情報を入力させようとする語句が含まれています。`));
  }

  const reg = registeredDecoded;
  const shortener = URL_SHORTENERS.find((s) => reg === s || reg.endsWith('.' + s));
  if (shortener) {
    push(finding('url-shortener', 'medium', 15,
      '短縮URLサービスが使われている',
      `「${shortener}」はURL短縮サービスです。リンクの先が何であるか確認できないため、特に注意してください。`));
  }

  const freeHost = FREE_HOSTING.find((s) => reg === s || reg.endsWith('.' + s));
  if (freeHost) {
    const pathKw = /login|signin|verify|password|account|update|confirm|wallet|invoice/i.test(url.pathname + url.search);
    push(finding('free-hosting', pathKw ? 'high' : 'medium', pathKw ? 25 : 10,
      pathKw ? '無料ホスティング＋ログイン関連のページ' : '無料ホスティングサービスが使われている',
      `「${freeHost}」は誰でも無料でページを作れるサービスです。${pathKw ? 'パスワードやカード情報の入力を求められたら、入力前に本当にそのサイトが必要か考えましょう。' : '不正なページが一時的に作られやすい環境です。'}`));
  }

  if (/%00|%0d|%0a|%09/i.test(href)) {
    push(finding('encoded-chars', 'medium', 15,
      'URLに不審なエンコード文字が含まれている',
      'NULL文字や改行コードがURLエンコードされています。解析を逃れるための手口である可能性があります。'));
  }

  if (hostname.split('.').filter((l) => l.length === 0).length > 0) {
    push(finding('empty-label', 'high', 20, '不正なドメイン表記', 'ドメイン名の解釈が一意にできない不正な表記です。'));
  }

  let raw = findings.reduce((s, f) => s + f.score, 0);
  let score = Math.min(100, Math.round(raw * factor));
  if (findings.some((f) => f.severity === 'danger' && f.score >= 40)) {
    score = Math.max(score, Math.min(100, Math.round(70 * factor)));
  }
  const level = levelOf(score);

  findings.sort((a, b) => {
    const rank = { danger: 0, high: 1, medium: 2, low: 3, info: 4 };
    return (rank[a.severity] - rank[b.severity]) || (b.score - a.score);
  });

  return {
    url: href,
    hostname,
    decodedHost,
    registeredDomain: registered,
    displayHost: decodedHost !== hostname ? decodedHost : hostname,
    punycode: puny,
    level,
    score,
    findings,
    checkedAt: Date.now(),
    factor,
  };
}

export function analyzeTabUrl(url, settings = {}) {
  if (!url || !/^https?:/i.test(url)) return null;
  return analyzeUrl(url, {
    whitelist: settings.whitelist || [],
    sensitivity: settings.sensitivity || 'normal',
    ignoreRules: settings.ignoreRules || [],
  });
}

const GSb_URL = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

export async function checkSafeBrowsing(rawUrl, apiKey) {
  if (!apiKey) return null;
  const body = {
    client: { clientId: 'domain-guard', clientVersion: '1.0.0' },
    threatInfo: {
      threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url: rawUrl }],
    },
  };
  const res = await fetch(`${GSb_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Safe Browsing API エラー: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.matches || !data.matches.length) return null;
  return data.matches.map((m) => ({
    threatType: m.threatType,
    platformType: m.platformType,
  }));
}

export function mergeSafeBrowsing(result, matches) {
  if (!result || !matches || !matches.length) return result;
  const names = {
    MALWARE: 'マルウェア',
    SOCIAL_ENGINEERING: 'フィッシング詐欺',
    UNWANTED_SOFTWARE: '望ましくないソフトウェア',
    POTENTIALLY_HARMFUL_APPLICATION: '有害な可能性があるアプリ',
  };
  const label = matches.map((m) => names[m.threatType] || m.threatType).join('・');
  const merged = { ...result, findings: [...result.findings] };
  merged.findings.unshift(finding('safe-browsing', 'danger', 100,
    `Google Safe Browsing が「${label}」と判定`,
    'Googleのセーフブラウジングデータベースで、このURLは危険なサイトとして登録されています。絶対に個人情報やパスワードを入力しないでください。'));
  merged.score = 100;
  merged.level = 'danger';
  merged.safeBrowsing = matches;
  merged.checkedAt = Date.now();
  return merged;
}

export const RULE_REFERENCE = [
  { id: 'userinfo-trick', title: 'URL内「@」偽装', desc: 'paypal.com@evil.com のような表記で、実際の接続先を隠す手口。' },
  { id: 'punycode', title: 'punycode / 国際化ドメイン', desc: 'xn-- で始まるエンコード済みドメイン。見た目と実体が異なる場合がある。' },
  { id: 'mixed-script', title: '混在文字種（同形異義語攻撃）', desc: 'キリル文字の「о」等を混ぜて gооgle.com のように本物そっくりに見せる。' },
  { id: 'typosquat', title: 'タイポスクワティング', desc: 'gooogle.com や g00gle.com など、本物と一〜二文字違うドメイン。' },
  { id: 'embedded-brand-domain', title: '正規ドメインの埋め込み', desc: 'paypal.com.evil.com のように本物のドメインをサブドメインに紛れ込ませる。' },
  { id: 'brand-token-embedding', title: 'ブランド名の無断使用', desc: 'secure-paypal-login.xyz のようにブランド名だけ借りた無関係なドメイン。' },
  { id: 'ip-host', title: 'IPアドレス直指定', desc: 'ドメイン名の代わりに http://192.168.x.x/ のようなIPアドレスでアクセスさせる。' },
  { id: 'risky-tld-high', title: '高リスクTLD', desc: '.tk .zip .mov .top など、不正利用が特に多いトップレベルドメイン。' },
  { id: 'sensitive-keywords', title: '誘導キーワード', desc: 'login / verify / update / 確認 などを含むドメイン名。' },
  { id: 'free-hosting', title: '無料ホスティング', desc: 'herokuapp.com や vercel.app 等、誰でも作れる無料サービス上のサイト。' },
  { id: 'url-shortener', title: '短縮URL', desc: 'bit.ly 等、行き先が確認しにくい短縮サービス。' },
  { id: 'http-sensitive', title: 'HTTP＋ログイン語句', desc: '暗号化されていない通信でパスワード入力を伴う可能性がある。' },
  { id: 'safe-browsing', title: 'Google Safe Browsing', desc: 'Googleのフィッシング・マルウェアデータベースに登録されているURL。' },
];
