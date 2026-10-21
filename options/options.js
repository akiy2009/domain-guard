import { RULE_REFERENCE } from '../lib/analyzer.js';
import { applyAppearance, DEFAULT_APPEARANCE, DEFAULT_COLORS, LEVEL_KEYS } from '../lib/theme.js';

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  enabled: true,
  sensitivity: 'normal',
  whitelist: [],
  enableSafeBrowsing: false,
  apiKey: '',
  blockDangerous: true,
  notifyDangerous: true,
  ...DEFAULT_APPEARANCE,
};

let toastTimer = null;

applyAppearance(DEFAULT_APPEARANCE);
chrome.storage.sync.get(null)
  .then((stored) => applyAppearance(stored))
  .catch(() => {});

function toast(msg = '✓ 自動保存しました') {
  const el = $('save-toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

async function save(patch) {
  await chrome.storage.sync.set(patch);
  applyAppearance(await chrome.storage.sync.get(null));
  toast();
}

function renderWhitelist(list) {
  const ul = $('wl-list');
  ul.innerHTML = '';
  $('wl-empty').hidden = list.length > 0;
  for (const domain of list) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = domain;
    const btn = document.createElement('button');
    btn.className = 'btn-danger-link';
    btn.textContent = '削除';
    btn.addEventListener('click', async () => {
      const next = list.filter((d) => d !== domain);
      await save({ whitelist: next });
      renderWhitelist(next);
    });
    li.append(span, btn);
    ul.appendChild(li);
  }
}

function renderRules() {
  const ul = $('rule-list');
  ul.innerHTML = '';
  for (const r of RULE_REFERENCE) {
    const li = document.createElement('li');
    const t = document.createElement('div');
    t.className = 'rule-title';
    t.textContent = r.title;
    const d = document.createElement('div');
    d.className = 'rule-desc';
    d.textContent = r.desc;
    li.append(t, d);
    ul.appendChild(li);
  }
}

function setColorPair(key, value) {
  const input = $(`c-${key}`);
  const label = $(`cl-${key}`);
  if (!input || !label) return;
  input.value = value;
  label.textContent = value;
}

async function init() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  const s = { ...DEFAULTS, ...stored };

  applyAppearance(s);

  $('enabled').checked = s.enabled;
  $('sensitivity').value = s.sensitivity;
  $('blockDangerous').checked = s.blockDangerous;
  $('notifyDangerous').checked = s.notifyDangerous;
  $('enableSafeBrowsing').checked = s.enableSafeBrowsing;
  $('apiKey').value = s.apiKey || '';

  $('theme').value = s.theme;
  $('accentColor').value = s.accentColor;
  $('accentColorLabel').textContent = s.accentColor;
  $('headerColor').value = s.headerColor;
  $('headerColorLabel').textContent = s.headerColor;
  for (const key of LEVEL_KEYS) {
    setColorPair(key, s.colors && s.colors[key] ? s.colors[key] : DEFAULT_COLORS[key]);
  }

  renderWhitelist(s.whitelist || []);
  renderRules();

  $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
  $('sensitivity').addEventListener('change', (e) => save({ sensitivity: e.target.value }));
  $('blockDangerous').addEventListener('change', (e) => save({ blockDangerous: e.target.checked }));
  $('notifyDangerous').addEventListener('change', (e) => save({ notifyDangerous: e.target.checked }));
  $('enableSafeBrowsing').addEventListener('change', (e) => save({ enableSafeBrowsing: e.target.checked }));
  $('theme').addEventListener('change', (e) => save({ theme: e.target.value }));
  $('accentColor').addEventListener('input', (e) => {
    $('accentColorLabel').textContent = e.target.value;
    save({ accentColor: e.target.value });
  });
  $('headerColor').addEventListener('input', (e) => {
    $('headerColorLabel').textContent = e.target.value;
    save({ headerColor: e.target.value });
  });
  for (const key of LEVEL_KEYS) {
    const input = $(`c-${key}`);
    input.addEventListener('input', (e) => {
      $(`cl-${key}`).textContent = e.target.value;
      const current = ( (await chrome.storage.sync.get(DEFAULTS)).colors ) || { ...DEFAULT_COLORS };
      current[key] = e.target.value;
      save({ colors: current });
    });
  }
  $('btn-reset-colors').addEventListener('click', async () => {
    await save({
      theme: 'system',
      accentColor: DEFAULT_APPEARANCE.accentColor,
      headerColor: DEFAULT_APPEARANCE.headerColor,
      colors: { ...DEFAULT_COLORS },
    });
    init();
    toast('配色を初期値に戻しました');
  });

  let keyTimer = null;
  $('apiKey').addEventListener('input', (e) => {
    clearTimeout(keyTimer);
    const v = e.target.value.trim();
    keyTimer = setTimeout(() => save({ apiKey: v }), 500);
  });

  $('btn-wl-add').addEventListener('click', async () => {
    const input = $('wl-input');
    const domain = input.value.toLowerCase().trim().replace(/^\*:?\/*\/?/, '').replace(/^https?:\/\//, '').split('/')[0].replace(/\.$/, '');
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      input.style.borderColor = 'var(--danger)';
      setTimeout(() => { input.style.borderColor = ''; }, 1500);
      return;
    }
    const current = (await chrome.storage.sync.get(DEFAULTS)).whitelist || [];
    if (!current.includes(domain)) {
      const next = [...current, domain];
      await save({ whitelist: next });
      renderWhitelist(next);
    }
    input.value = '';
  });

  $('btn-test-api').addEventListener('click', async () => {
    const result = $('api-test-result');
    const key = $('apiKey').value.trim();
    result.className = 'test-result';
    if (!key) {
      result.textContent = 'APIキーを入力してください';
      result.classList.add('err');
      return;
    }
    result.textContent = 'テスト中…';
    try {
      const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'domain-guard', clientVersion: '1.0.0' },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url: 'https://test.google.com/safebrowsing/test/phishing.html' }],
          },
        }),
      });
      if (res.ok) {
        result.textContent = '✓ APIキーは有効です';
        result.classList.add('ok');
        await save({ apiKey: key, enableSafeBrowsing: true });
        $('enableSafeBrowsing').checked = true;
      } else {
        const text = await res.text();
        result.textContent = `✗ エラー: HTTP ${res.status} — ${text.slice(0, 120)}`;
        result.classList.add('err');
      }
    } catch (e) {
      result.textContent = `✗ 通信エラー: ${e.message}`;
      result.classList.add('err');
    }
  });
}

init();
