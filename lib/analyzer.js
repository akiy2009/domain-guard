/**
 * Domain Guard の解析エンジン。
 *
 * 判定は「加点方式」です。各ルールのスコアを合計し、感度係数を掛けて
 * 0〜100 の危険度に変換します。ブランドの同形異義語・数字置換など、
 * 確度の高い検知には下限スコア（70）を設けています。
 */
import { decodeHostname, hasPunycode } from './punycode.js';
import {
  getRegisteredDomain, getBaseDomain, levenshtein, foldLeet,
  foldConfusables, hasConfusableScriptMix, hasBidiOrControlChars, isIPv4, isIPv6,
  isIPAddress, isPrivateHost, normalizeHostname, isPublicSuffix,
} from './utils.js';
import {
  BRANDS, BRAND_TOKENS, GENERIC_BRAND_TOKENS, FREE_HOSTING, URL_SHORTENERS,
  RISKY_TLDS, SENSITIVE_KEYWORDS,
} from './brands.js';
import { isWhitelisted } from './settings.js';
import { RULE_REFERENCE } from './rules.js';

export { RULE_REFERENCE };

export const LEVELS = {
  safe: { label: '安全', color: '#1a7f37', icon: 'safe' },
  low: { label: 'ほぼ安全', color: '#9a6700', icon: 'low' },
  medium: { label: '要注意', color: '#bc4c00', icon: 'medium' },
  high: { label: '危険の可能性大', color: '#cf222e', icon: 'high' },
  danger: { label: '危険', color: '#a40e26', icon: 'danger' },
};

export const SENSITIVITY = {
  loose: { factor: 0.6, label: '緩い（誤検知を減らす）' },
  normal: { factor: 1, label: '標準' },
  strict: { factor: 1.4, label: '厳しい（疑わしいサイトを広く警告）' },
};

/** 誤検知の影響が大きいブランド。タイポスクワットの確度を高めに評価します。 */
const HIGH_VALUE_BASES = new Set([
  'google', 'gmail', 'youtube', 'apple', 'icloud', 'microsoft', 'outlook',
  'amazon', 'paypal', 'facebook', 'instagram', 'whatsapp', 'netflix', 'spotify',
  'github', 'dropbox', 'adobe', 'linkedin', 'discord', 'telegram', 'docusign',
  'dhl', 'fedex', 'ups', 'yahoo', 'rakuten', 'rakutenbank', 'rakutencard',
  'paypay', 'line', 'mercari', 'mufg', 'ufj', 'smbc', 'resona', 'mizuhobank',
  'jcb', 'sbisec', 'binance', 'coinbase', 'metamask', 'kraken', 'bitflyer',
  'coincheck', 'bitbank', 'roblox', 'steam', 'playstation', 'nintendo',
  'pokemon', 'epicgames', 'minecraft', 'samsung', 'sony', 'japanpost', 'yucho',
  'docomo', 'softbank', 'kddi', 'uqmobile', 'ymobile', 'mynaportal', 'mynumber',
  'nta', 'nenkin', 'npa',
]);

const BRAND_LOOKUP = (() => {
  const list = [];
  const seen = new Set();
  for (const brand of BRANDS) {
    if (seen.has(brand.d)) continue;
    seen.add(brand.d);
    const base = getBaseDomain(brand.d);
    list.push({
      ...brand,
      base,
      labels: brand.d.split('.'),
      cmpDomain: normalizeForCompare(brand.d),
      cmpBase: normalizeForCompare(base),
    });
  }
  return list;
})();

const BRAND_BASE_SET = new Set(BRAND_LOOKUP.map((brand) => brand.cmpBase));

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

function normalizeForCompare(value) {
  return foldConfusables(foldLeet(String(value).toLowerCase()));
}

function tokenize(value) {
  return String(value)
    .toLowerCase()
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasNonAscii(value) {
  return /[^\x00-\x7f]/.test(String(value));
}

function isRepeatedCharTypo(a, b) {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length !== shorter.length + 1) return false;
  for (let i = 0; i < longer.length; i += 1) {
    if (longer.slice(0, i) + longer.slice(i + 1) === shorter) {
      const prev = longer[i - 1];
      const next = longer[i + 1];
      return longer[i] === prev || longer[i] === next;
    }
  }
  return false;
}

function isAdjacentTransposition(a, b) {
  if (a.length !== b.length || a === b) return false;
  let first = -1;
  let mismatches = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      if (first < 0) first = i;
      mismatches += 1;
    }
  }
  if (mismatches !== 2 || first < 0) return false;
  return a[first] === b[first + 1] && a[first + 1] === b[first];
}

function keywordTokens(text) {
  const tokens = new Set(tokenize(text));
  return SENSITIVE_KEYWORDS.filter((keyword) => tokens.has(keyword.w));
}

function findEmbeddedBrand(labels, registeredBaseCmp) {
  for (const brand of BRAND_LOOKUP) {
    if (brand.labels.length > labels.length) continue;
    for (let i = 0; i <= labels.length - brand.labels.length; i += 1) {
      const slice = labels.slice(i, i + brand.labels.length);
      if (slice.length !== brand.labels.length) continue;
      const joined = slice.join('.');
      const end = i + brand.labels.length;
      if (end === labels.length) continue;
      // amazon.com.au のようなブランド自身の ccTLD を除外する。
      if (registeredBaseCmp === brand.cmpBase) continue;
      if (joined === brand.d || normalizeForCompare(joined) === brand.cmpDomain) {
        return { brand, at: i, lookalike: joined !== brand.d };
      }
    }
  }
  return null;
}

function riskTier(tld) {
  if (RISKY_TLDS.high.has(tld)) return 'high';
  if (RISKY_TLDS.medium.has(tld)) return 'medium';
  if (RISKY_TLDS.low.has(tld)) return 'low';
  return null;
}

function emptyResult(rawUrl, level, score, item) {
  return {
    url: rawUrl,
    hostname: '',
    decodedHost: '',
    registeredDomain: '',
    displayRegisteredDomain: '',
    baseDomain: '',
    displayHost: '',
    punycode: false,
    level,
    score,
    findings: [item],
    checkedAt: Date.now(),
    factor: 1,
  };
}

/**
 * URL を解析して危険度を返します。
 * @param {string} rawUrl
 * @param {{whitelist?: string[], sensitivity?: string, ignoreRules?: string[]}} options
 */
export function analyzeUrl(rawUrl, options = {}) {
  const whitelist = Array.isArray(options.whitelist) ? options.whitelist : [];
  const sensitivity = Object.prototype.hasOwnProperty.call(SENSITIVITY, options.sensitivity)
    ? options.sensitivity
    : 'normal';
  const factor = SENSITIVITY[sensitivity].factor;
  const ignoreRules = new Set(Array.isArray(options.ignoreRules) ? options.ignoreRules : []);

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return emptyResult(rawUrl, 'danger', 100, finding(
      'invalid-url', 'danger', 100,
      'URLとして解析できない',
      'URLの形式が正しくありません。リンクをクリックする前に内容を確認してください。',
    ));
  }

  const scheme = url.protocol.toLowerCase();
  if (['javascript:', 'data:', 'vbscript:'].includes(scheme)) {
    return emptyResult(rawUrl, 'danger', 100, finding(
      'dangerous-scheme', 'danger', 100,
      `危険なプロトコル: ${scheme}`,
      'このURLスキームは実行可能なコードやデータを直接渡すものです。通常のWebサイトでは使用されません。',
    ));
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    return emptyResult(rawUrl, 'medium', 20, finding(
      'no-host', 'medium', 20,
      'ホスト名がない',
      'ドメイン名を持たないURLです。',
    ));
  }

  const decodedHost = decodeHostname(hostname);
  const registered = getRegisteredDomain(hostname);
  const registeredDecoded = decodeHostname(registered);
  const registeredBaseAscii = getBaseDomain(registered);
  const baseDecoded = decodeHostname(registeredBaseAscii);
  const tld = registered.split('.').pop() || '';
  const isIp = isIPAddress(hostname);
  const isIpv4 = isIPv4(hostname);
  const isIpv6 = isIPv6(hostname);
  const labels = decodedHost.split('.');
  const asciiLabels = hostname.split('.');

  const displayRegisteredDomain = registeredDecoded !== registered ? registeredDecoded : registered;
  const displayHost = decodedHost !== hostname ? decodedHost : hostname;

  if (isWhitelisted(hostname, whitelist) || isWhitelisted(registered, whitelist)) {
    return {
      url: url.href,
      hostname,
      decodedHost,
      registeredDomain: registered,
      displayRegisteredDomain,
      baseDomain: baseDecoded,
      displayHost,
      punycode: hasPunycode(hostname),
      level: 'safe',
      score: 0,
      whitelisted: true,
      findings: [finding('whitelisted', 'info', 0, 'ホワイトリスト登録済み', 'あなたが登録した信頼できるドメインです。')],
      checkedAt: Date.now(),
      factor,
    };
  }

  const findings = [];
  const push = (item) => {
    if (!item || ignoreRules.has(item.id)) return;
    if (findings.some((existing) => existing.id === item.id)) return;
    findings.push(item);
  };

  // --- 偽装・難読化 ---------------------------------------------------------
  const username = decodeURIComponentSafe(url.username || '');
  const password = decodeURIComponentSafe(url.password || '');
  if (username || password) {
    push(finding(
      'userinfo-trick', 'danger', 45,
      'URLに「@」を使った偽装の可能性',
      `アドレス表示欄では「${username || 'xxxx'}@${hostname}」の部分が隠れ、実際には「${hostname}」へ接続しようとしています。`,
    ));
  }

  if (hasBidiOrControlChars(rawUrl) || hasBidiOrControlChars(decodedHost)) {
    push(finding(
      'bidi-control', 'danger', 35,
      '制御文字・双方向文字がURLに含まれている',
      '見えない制御文字を使って、アドレスバーの表示を偽装しようとしている可能性があります。',
    ));
  }

  const puny = hasPunycode(hostname);
  const confusableMix = hasConfusableScriptMix(decodedHost);
  if (puny) {
    push(finding(
      'punycode', confusableMix ? 'high' : 'low', confusableMix ? 25 : 12,
      confusableMix ? '多言語文字（同形異義語攻撃）の可能性' : 'punycode（国際化ドメイン名）が使われている',
      confusableMix
        ? `「${decodedHost}」には複数の文字体系が混在しています。見た目を本物に似せた偽ドメインの典型例です。`
        : `表示上は「${decodedHost}」のように見えますが、実体は「${hostname}」です。文字が本物と異なっている可能性があります。`,
    ));
  }
  if (confusableMix) {
    push(finding(
      'mixed-script', 'danger', 35,
      '異なる文字種が混在しているドメイン',
      'ラテン文字とキリル文字・ギリシャ文字などを混ぜて、本物そっくりに見せる攻撃です。アドレスバーの表記をよく確認してください。',
    ));
  }

  // --- ブランドなりすまし ---------------------------------------------------
  const regCmp = normalizeForCompare(registeredDecoded);
  const baseCmp = normalizeForCompare(baseDecoded);
  const registeredBaseIsBrand = BRAND_BASE_SET.has(baseCmp);
  const onBrandDomain = BRAND_LOOKUP.some(
    (brand) => hostname === brand.d || hostname.endsWith('.' + brand.d),
  );
  // `github.io` のような公開サフィックス自体は、特定ブランドのなりすましではない。
  const atPublicSuffix = !isIp && isPublicSuffix(hostname);

  if (!onBrandDomain && !atPublicSuffix) {
    let brandFlagged = false;

    for (const brand of BRAND_LOOKUP) {
      if (brandFlagged) break;

      if (regCmp === brand.cmpDomain && registeredDecoded !== brand.d) {
        push(finding(
          hasNonAscii(registeredDecoded) ? 'homograph-brand' : 'leetspeak-brand',
          'danger',
          hasNonAscii(registeredDecoded) ? 55 : 50,
          hasNonAscii(registeredDecoded)
            ? `「${brand.n}」を装った同形異義語ドメイン`
            : `「${brand.n}」を装った数字置換ドメイン`,
          hasNonAscii(registeredDecoded)
            ? `「${decodedHost}」は本物の「${brand.d}」と見た目がほぼ同じですが、文字の一部が異なります。`
            : `「${decodedHost}」は「0→O」「1→l」などの置き換えで本物「${brand.d}」を模したものです。`,
          { brand: brand.n, target: brand.d },
        ));
        brandFlagged = true;
        break;
      }

      if (baseCmp === brand.cmpBase && baseDecoded !== brand.base && !onBrandDomain) {
        push(finding(
          hasNonAscii(baseDecoded) ? 'homograph-brand' : 'leetspeak-brand',
          'danger',
          hasNonAscii(baseDecoded) ? 50 : 45,
          hasNonAscii(baseDecoded)
            ? `「${brand.n}」を装った同形異義語ドメイン`
            : `「${brand.n}」を装った数字置換ドメイン`,
          hasNonAscii(baseDecoded)
            ? `「${displayRegisteredDomain}」は本物の「${brand.d}」と見た目がほぼ同じですが、文字の一部が異なります。`
            : `「${displayRegisteredDomain}」は数字や記号の置き換えで本物「${brand.d}」を模したものです。`,
          { brand: brand.n, target: brand.d },
        ));
        brandFlagged = true;
        break;
      }

      // タイポスクワット: 1文字違いのみを対象にし、誤検知を抑える。
      if (baseCmp.length >= 5 && brand.cmpBase.length >= 5 && baseCmp[0] === brand.cmpBase[0]) {
        const distance = levenshtein(baseCmp, brand.cmpBase, 1);
        if (distance === 1) {
          const strongTypo = isRepeatedCharTypo(baseCmp, brand.cmpBase)
            || isAdjacentTransposition(baseCmp, brand.cmpBase)
            || (HIGH_VALUE_BASES.has(brand.base) && brand.base.length >= 6);
          const severity = strongTypo && HIGH_VALUE_BASES.has(brand.base) ? 'danger'
            : strongTypo ? 'high' : 'medium';
          const score = severity === 'danger' ? 45 : severity === 'high' ? 30 : 18;
          push(finding(
            'typosquat', severity, score,
            strongTypo
              ? `「${brand.n}」のタイポスクワティング（なりすましドメイン）`
              : `「${brand.n}」に似たドメイン名`,
            `「${displayRegisteredDomain}」は本物の「${brand.d}」と1文字だけ異なります。打ち間違いか、巧妙に似せた偽ドメインである可能性があります。`,
            { brand: brand.n, target: brand.d, distance },
          ));
          brandFlagged = true;
          break;
        }
      }
    }

    if (!brandFlagged) {
      const embedded = findEmbeddedBrand(labels, baseCmp);
      if (embedded) {
        push(finding(
          'embedded-brand-domain', 'danger', 55,
          `「${embedded.brand.n}」の正規ドメインを埋め込んだ偽装URL`,
          `「${displayHost}」の中に本物の「${embedded.brand.d}」が埋め込まれていますが、最終的な接続先は「${displayRegisteredDomain}」です。`,
          { brand: embedded.brand.n, target: embedded.brand.d },
        ));
      }
    }

    if (!brandFlagged && !registeredBaseIsBrand && baseDecoded) {
      const baseTokens = tokenize(baseDecoded);
      let match = null;
      for (const token of baseTokens) {
        const candidates = BRAND_TOKENS.get(token);
        if (!candidates || !candidates.length) continue;
        const brand = candidates.find(
          (candidate) => hostname !== candidate.d && !hostname.endsWith('.' + candidate.d),
        );
        if (brand) {
          match = { token, brand };
          break;
        }
      }
      if (match) {
        const generic = GENERIC_BRAND_TOKENS.has(match.token);
        const keywords = keywordTokens(baseDecoded + '.' + tld);
        const risky = riskTier(tld);
        const hyphens = (registeredBaseAscii.match(/-/g) || []).length;
        const context = Boolean(risky) || keywords.length > 0 || hyphens >= 2;
        let severity = 'medium';
        let score = 12;
        let title = `「${match.brand.n}」の名前を含むドメイン`;
        let description = `「${displayRegisteredDomain}」は「${match.brand.n}」の正規ドメイン（${match.brand.d}）ではありませんが、名前を借りて本物に見せかけている可能性があります。`;
        if (!generic && (match.token.length >= 6 || context)) {
          severity = 'danger';
          score = 35;
          title = `無関係なドメインに「${match.brand.n}」の名前が使われている`;
          description = `「${displayRegisteredDomain}」は「${match.brand.n}」の正規ドメイン（${match.brand.d}）ではありません。情報入力を求める画面には注意してください。`;
        } else if (context) {
          severity = 'high';
          score = 25;
        }
        push(finding('brand-token-embedding', severity, score, title, description, {
          brand: match.brand.n,
          target: match.brand.d,
        }));
      }
    }
  }

  // --- ドメイン構造 ---------------------------------------------------------
  if (isIpv4) {
    push(finding(
      'ip-host', 'high', 30,
      'IPアドレスがドメイン名の代わりに使われている',
      `通常のドメイン名ではなく「${hostname}」というIPアドレス直接指定です。フィッシング詐欺で多用される手口です。`,
    ));
  } else if (isIpv6) {
    push(finding(
      'ipv6-host', 'medium', 18,
      'IPv6アドレスがドメイン名の代わりに使われている',
      '通常のドメイン名ではなくIPv6アドレスが直接指定されています。',
    ));
  }

  if (!isIp) {
    if (url.port && !['80', '443'].includes(url.port)) {
      push(finding(
        'unusual-port', 'low', 8,
        `通常と異なるポート番号（:${url.port}）`,
        '通常使用されないポート番号が指定されています。',
      ));
    }

    if (hostname.length > 60) {
      push(finding(
        'long-host', 'low', 8,
        'ドメイン名が異常に長い',
        '非常に長いドメイン名は、本物らしく見せかけるために使われることがあります。',
      ));
    }

    const hyphens = (registeredBaseAscii.match(/-/g) || []).length;
    if (hyphens >= 4) {
      push(finding(
        'many-hyphens', 'medium', 12,
        'ハイフンが非常に多い',
        `登録ドメインの主要部分にハイフンが${hyphens}個含まれています。ブランド名を埋め込む偽ドメインの典型パターンです。`,
      ));
    } else if (hyphens >= 2) {
      push(finding(
        'some-hyphens', 'low', 6,
        'ハイフンが多い',
        `登録ドメインの主要部分にハイフンが${hyphens}個含まれています。`,
      ));
    }

    const alnum = registeredBaseAscii.replace(/[^a-z0-9]/gi, '');
    const digitRatio = alnum ? (alnum.match(/\d/g) || []).length / alnum.length : 0;
    if (digitRatio > 0.35 && alnum.length >= 6) {
      push(finding(
        'many-digits', 'medium', 10,
        '数字が非常に多い',
        'ブランド名の一部を数字（0や1など）に置き換えた偽装によく見られる特徴です。',
      ));
    }

    const subDepth = Math.max(0, asciiLabels.length - registered.split('.').length);
    if (subDepth >= 4) {
      push(finding(
        'deep-subdomains', 'medium', 10,
        'サブドメインの階層が非常に深い',
        `「${displayHost}」はサブドメインが${subDepth}階層あります。本物に見せかけるための偽装である可能性があります。`,
      ));
    } else if (subDepth >= 3) {
      push(finding(
        'deep-subdomains', 'low', 7,
        'サブドメインの階層が深い',
        `「${displayHost}」はサブドメインが${subDepth}階層あります。接続先の登録ドメインを確認してください。`,
      ));
    }

    if (hostname.includes('..')) {
      push(finding(
        'empty-label', 'medium', 20,
        '不正なドメイン表記',
        '空のラベルを含むなど、ドメイン名の解釈が一意にできない表記です。',
      ));
    }
  }

  // --- TLD のリスク ---------------------------------------------------------
  const tier = isIp ? null : riskTier(tld);
  if (tier === 'high') {
    push(finding(
      'risky-tld-high', 'high', 22,
      `フィッシングに非常に利用されるトップレベルドメイン（.${tld}）`,
      `「.${tld}」は安価または無料で登録でき、不正利用が多発しているTLDです。安易に情報を入力しないでください。`,
    ));
  } else if (tier === 'medium') {
    push(finding(
      'risky-tld-medium', 'medium', 14,
      `不正利用が見られるトップレベルドメイン（.${tld}）`,
      `「.${tld}」はフィッシング詐欺での利用が報告されています。サイトの運営者を確認してください。`,
    ));
  } else if (tier === 'low') {
    push(finding(
      'risky-tld-low', 'low', 6,
      `注意が必要なトップレベルドメイン（.${tld}）`,
      `「.${tld}」は誰でも容易に登録できるTLDです。内容を確認せず情報を入力しないでください。`,
    ));
  }

  // --- 誘導キーワード -------------------------------------------------------
  if (!isIp) {
    const keywords = keywordTokens(registeredBaseAscii);
    if (keywords.length && !onBrandDomain) {
      const rawScore = keywords.reduce((sum, keyword) => sum + keyword.s, 0);
      const capped = Math.min(rawScore, 25);
      push(finding(
        'sensitive-keywords', rawScore >= 20 ? 'high' : 'medium', capped,
        'ログイン・確認などを誘導する語句が含まれている',
        `登録ドメインに「${keywords.slice(0, 8).map((keyword) => keyword.w).join('」「')}」などの、情報を入力させようとする語句が含まれています。`,
      ));
    }

    const shortener = URL_SHORTENERS.find(
      (service) => registered === service || registered.endsWith('.' + service),
    );
    if (shortener) {
      push(finding(
        'url-shortener', 'medium', 15,
        '短縮URLサービスが使われている',
        `「${shortener}」はURL短縮サービスです。リンクの先が何であるか確認できないため、特に注意してください。`,
      ));
    }

    const freeHost = FREE_HOSTING.find(
      (service) => hostname !== service
        && (registered === service || registered.endsWith('.' + service)),
    );
    if (freeHost) {
      const pathKeywords = keywordTokens(decodeURIComponentSafe(url.pathname + url.search));
      const sensitivePath = pathKeywords.length > 0;
      push(finding(
        'free-hosting',
        sensitivePath ? 'high' : 'medium',
        sensitivePath ? 25 : 10,
        sensitivePath ? '無料ホスティング＋ログイン関連のページ' : '無料ホスティングサービスが使われている',
        `「${freeHost}」は誰でも無料でページを作れるサービスです。${
          sensitivePath
            ? 'パスワードやカード情報の入力を求められたら、入力前に本当にそのサイトが必要か考えましょう。'
            : '不正なページが一時的に作られやすい環境です。'
        }`,
      ));
    }
  }

  // --- 通信 ---------------------------------------------------------------
  if (scheme === 'http:') {
    const hostKeywords = keywordTokens(registeredBaseAscii);
    const pathKeywords = keywordTokens(decodeURIComponentSafe(url.pathname + url.search));
    const sensitive = hostKeywords.length > 0 || pathKeywords.length > 0;
    if (sensitive) {
      push(finding(
        'http-sensitive', 'high', 25,
        '通信が暗号化されていない（HTTP）＋ログイン関連の語句',
        'パスワード等を入力する可能性のあるページで、通信が暗号化されていません。盗み見される恐れがあります。',
      ));
    } else {
      push(finding(
        'http', 'info', 0,
        '通信が暗号化されていない（HTTP）',
        'HTTPSではなくHTTPです。公共のWi-Fi等では通信内容を盗み見られる可能性があります。',
      ));
    }
  }

  if (/%(00|0d|0a|09)/i.test(rawUrl)) {
    push(finding(
      'encoded-chars', 'medium', 15,
      'URLに不審なエンコード文字が含まれている',
      'NULL文字や改行コードがURLエンコードされています。解析を逃れるための手口である可能性があります。',
    ));
  }

  // --- スコアリング ---------------------------------------------------------
  const raw = findings.reduce((sum, item) => sum + item.score, 0);
  let score = Math.min(100, Math.round(raw * factor));
  const hasCritical = findings.some((item) => item.severity === 'danger' && item.score >= 40);
  if (hasCritical) score = Math.max(score, 70);

  const level = levelOf(score);

  const severityRank = { danger: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => (severityRank[a.severity] - severityRank[b.severity]) || (b.score - a.score));

  return {
    url: url.href,
    hostname,
    decodedHost,
    registeredDomain: registered,
    displayRegisteredDomain,
    baseDomain: baseDecoded,
    displayHost,
    punycode: puny,
    level,
    score,
    findings,
    checkedAt: Date.now(),
    factor,
    subdomainDepth: Math.max(0, asciiLabels.length - registered.split('.').length),
    tld,
    isIp,
    isPrivate: isPrivateHost(hostname),
  };
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function analyzeTabUrl(url, settings = {}) {
  if (!url || !/^https?:/i.test(url)) return null;
  return analyzeUrl(url, {
    whitelist: settings.whitelist || [],
    sensitivity: settings.sensitivity || 'normal',
    ignoreRules: settings.ignoreRules || [],
  });
}

const SAFE_BROWSING_URL = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
const THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'POTENTIALLY_HARMFUL_APPLICATION',
];

/**
 * Google Safe Browsing Lookup API v4。
 * APIキーが未設定、またはローカル/プライベートなホストの場合は何もしません。
 */
export async function checkSafeBrowsing(rawUrl, apiKey, options = {}) {
  if (!apiKey) return null;
  try {
    const host = normalizeHostname(new URL(rawUrl).hostname);
    if (isPrivateHost(host)) return null;
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  try {
    const body = {
      client: {
        clientId: 'domain-guard',
        clientVersion: options.clientVersion || '1.0.0',
      },
      threatInfo: {
        threatTypes: THREAT_TYPES,
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url: rawUrl }],
      },
    };
    const res = await fetch(`${SAFE_BROWSING_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Safe Browsing API エラー: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`);
    }
    const data = await res.json();
    if (!data.matches || !data.matches.length) return null;
    return data.matches.map((match) => ({
      threatType: match.threatType,
      platformType: match.platformType,
    }));
  } finally {
    clearTimeout(timeout);
  }
}

const THREAT_NAMES = {
  MALWARE: 'マルウェア',
  SOCIAL_ENGINEERING: 'フィッシング詐欺',
  UNWANTED_SOFTWARE: '望ましくないソフトウェア',
  POTENTIALLY_HARMFUL_APPLICATION: '有害な可能性があるアプリ',
};

export function mergeSafeBrowsing(result, matches) {
  if (!result || !matches || !matches.length) return result;
  const label = [...new Set(matches.map((match) => THREAT_NAMES[match.threatType] || match.threatType))].join('・');
  const merged = {
    ...result,
    findings: [
      finding(
        'safe-browsing', 'danger', 100,
        `Google Safe Browsing が「${label}」と判定`,
        'Googleのセーフブラウジングデータベースで、このURLは危険なサイトとして登録されています。絶対に個人情報やパスワードを入力しないでください。',
      ),
      ...result.findings.filter((item) => item.id !== 'safe-browsing'),
    ],
  };
  merged.score = 100;
  merged.level = 'danger';
  merged.safeBrowsing = matches;
  merged.checkedAt = Date.now();
  return merged;
}
