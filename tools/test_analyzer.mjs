import { analyzeUrl, mergeSafeBrowsing } from '../lib/analyzer.js';

const cases = [
  { url: 'https://www.google.com/', expectSafe: true, name: '正規Google' },
  { url: 'https://www.google.co.jp/search?q=test', expectSafe: true, name: '正規Google Japan' },
  { url: 'https://www.amazon.co.jp/', expectSafe: true, name: '正規Amazon.co.jp' },
  { url: 'https://shop.example.co.jp/items', expectSafe: true, name: '無関係だが正規構造のドメイン' },
  { url: 'https://www.g00gle.com/', minScore: 40, name: 'リート speak 伪装 (g00gle)' },
  { url: 'https://gooogle.com/', minScore: 40, name: 'タイポスクワティング (gooogle)' },
  { url: 'https://g\u043eogle.com/', minScore: 40, name: 'キリル文字混入 (gоogle)' },
  { url: 'https://paypal.com.evil-example.com/', minScore: 45, name: '正規ドメイン埋め込み' },
  { url: 'https://www.google.co.jp.fake-site.net/', minScore: 45, name: 'co.jp埋め込み' },
  { url: 'https://secure-paypal-login.top/', minScore: 30, name: 'ブランド名+誘導語+危険TLD' },
  { url: 'https://www.paypal.com.mysite.xyz/', minScore: 40, name: 'paypal.com偽装サブドメイン' },
  { url: 'https://google.com@evil-phish.com/', minScore: 35, name: '@偽装' },
  { url: 'http://192.168.10.5/login.php', minScore: 20, name: 'IPアドレス直指定' },
  { url: 'https://bit.ly/3xyz', minScore: 10, name: '短縮URL' },
  { url: 'https://accounts-verify-update.xyz/', minScore: 20, name: '誘導キーワード+危険TLD' },
  { url: 'https://login-microsoft365-support.top/', minScore: 25, name: 'ブランド語+危険TLD' },
  { url: 'https://free-gift-prize-winner.tk/', minScore: 20, name: '詐欺常連キーワード+.tk' },
  { url: 'https://www.amazon.co.jp.account-verify.ml/', minScore: 40, name: 'amazon.co.jp埋め込み+.ml' },
  { url: 'https://herokuapp.com'.replace('herokuapp.com', 'phishing-app.herokuapp.com/login'), minScore: 15, name: '無料ホスティング+login' },
  { url: 'https://xn--pypal-4ve.com/', minScore: 20, name: 'punycode' },
];

let failed = 0;

for (const c of cases) {
  const r = analyzeUrl(c.url);
  let ok;
  let detail;
  if (c.expectSafe) {
    ok = r.level === 'safe' || r.score < 15;
    detail = `level=${r.level} score=${r.score}`;
  } else {
    ok = r.score >= c.minScore;
    detail = `score=${r.score} (min ${c.minScore}) level=${r.level} findings=${r.findings.map((f) => f.id).join(',')}`;
  }
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  ${detail}`);
}

{
  const r = analyzeUrl('https://example.co.jp/page', { whitelist: ['example.co.jp'] });
  const ok = r.whitelisted && r.level === 'safe';
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ホワイトリスト override  findings=${r.findings.map((f) => f.id).join(',')}`);
}

{
  const r = mergeSafeBrowsing(analyzeUrl('https://google.com/test'), [{ threatType: 'SOCIAL_ENGINEERING' }]);
  const ok = r.level === 'danger' && r.score === 100 && r.findings[0].id === 'safe-browsing';
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  Safe Browsing マージ`);
}

{
  const r = analyzeUrl('javascript:alert(1)');
  const ok = r.level === 'danger';
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  javascript: プロトコル`);
}

{
  const r = analyzeUrl('not a url');
  const ok = r.level === 'danger';
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  不正URL`);
}

{
  const r = analyzeUrl('https://paypa1.com/', { sensitivity: 'strict' });
  const ok = r.score >= 40;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  paypa1.com strict=${r.score} findings=${r.findings.map((f) => f.id + ':' + f.score).join(',')}`);
}

{
  const r = analyzeUrl('https://g\u043eogle.com/');
  console.log(`INFO  gоogle.com decoded=${r.decodedHost} puny=${r.hostname} findings=${r.findings.map((f) => f.id).join(',')}`);
}

console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} TEST(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
