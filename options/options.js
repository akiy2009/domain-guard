import { analyzeUrl, LEVELS } from '../lib/analyzer.js';
import { RULE_REFERENCE, SEVERITY_LABELS } from '../lib/rules.js';
import {
  DEFAULT_SETTINGS, loadSettings, normalizeDomainInput, normalizeSettings,
  publicSettings, saveSettings,
} from '../lib/settings.js';
import {
  applyAppearance, DEFAULT_APPEARANCE, DEFAULT_COLORS, LEVEL_KEYS,
} from '../lib/theme.js';

const $ = (id) => document.getElementById(id);
const SEVERITY_ORDER = { danger: 0, high: 1, medium: 2, low: 3, info: 4 };

let settings = normalizeSettings();
let toastTimer = null;
let apiKeyTimer = null;
let colorTimer = null;

function toast(message = '✓ 自動保存しました', { error = false } = {}) {
  const element = $('save-toast');
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle('error', error);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.hidden = true;
  }, error ? 4000 : 1800);
}

function debounce(callback, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), wait);
  };
}

async function save(patch, { silent = false } = {}) {
  settings = await saveSettings(patch);
  applyAppearance(settings);
  if (!silent) toast();
  return settings;
}

/* ------------------------------------------------------------------ */
/* 表示                                                                */
/* ------------------------------------------------------------------ */

function setColorPair(key, value) {
  const input = $(`c-${key}`);
  const label = $(`cl-${key}`);
  if (!input || !label) return;
  input.value = value;
  label.textContent = value;
}

function renderWhitelist(list) {
  const ul = $('wl-list');
  ul.replaceChildren();
  $('wl-empty').hidden = list.length > 0;

  for (const domain of list) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = domain;
    span.className = 'mono';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-danger-link';
    button.textContent = '削除';
    button.setAttribute('aria-label', `${domain} をホワイトリストから削除`);
    button.addEventListener('click', async () => {
      const next = settings.whitelist.filter((entry) => entry !== domain);
      try {
        await save({ whitelist: next });
        renderWhitelist(settings.whitelist);
      } catch (error) {
        toast(`保存に失敗しました: ${error.message}`, { error: true });
      }
    });

    li.append(span, button);
    ul.appendChild(li);
  }
}

function renderRules() {
  const ul = $('rule-list');
  ul.replaceChildren();
  const ignored = new Set(settings.ignoreRules);

  for (const rule of RULE_REFERENCE) {
    const li = document.createElement('li');
    li.className = 'rule-item';

    const label = document.createElement('label');
    label.className = 'rule-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !ignored.has(rule.id);
    checkbox.disabled = !rule.toggleable;
    checkbox.dataset.ruleId = rule.id;

    const text = document.createElement('span');
    text.className = 'rule-text';

    const head = document.createElement('span');
    head.className = 'rule-head';

    const title = document.createElement('span');
    title.className = 'rule-title';
    title.textContent = rule.title;

    const sev = document.createElement('span');
    sev.className = `sev-tag sev-${rule.severity}`;
    sev.textContent = SEVERITY_LABELS[rule.severity] || rule.severity;

    const desc = document.createElement('span');
    desc.className = 'rule-desc';
    desc.textContent = rule.desc;

    head.append(title, sev);
    if (!rule.toggleable) {
      const fixed = document.createElement('span');
      fixed.className = 'rule-fixed';
      fixed.textContent = '常に有効';
      head.append(fixed);
    }
    text.append(head, desc);

    checkbox.addEventListener('change', async () => {
      try {
        const nextIgnored = new Set(settings.ignoreRules);
        if (checkbox.checked) nextIgnored.delete(rule.id);
        else nextIgnored.add(rule.id);
        await save({ ignoreRules: [...nextIgnored] });
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        toast(`保存に失敗しました: ${error.message}`, { error: true });
      }
    });

    label.append(checkbox, text);
    li.appendChild(label);
    ul.appendChild(li);
  }
}

function applyAll() {
  applyAppearance(settings);

  $('enabled').checked = settings.enabled;
  $('sensitivity').value = settings.sensitivity;
  $('blockDangerous').checked = settings.blockDangerous;
  $('notifyDangerous').checked = settings.notifyDangerous;
  $('enableSafeBrowsing').checked = settings.enableSafeBrowsing;
  $('apiKey').value = settings.apiKey || '';

  $('theme').value = settings.theme;
  $('accentColor').value = settings.accentColor;
  $('accentColorLabel').textContent = settings.accentColor;
  $('headerColor').value = settings.headerColor;
  $('headerColorLabel').textContent = settings.headerColor;
  for (const key of LEVEL_KEYS) {
    setColorPair(key, settings.colors && settings.colors[key] ? settings.colors[key] : DEFAULT_COLORS[key]);
  }

  renderWhitelist(settings.whitelist);
  renderRules();
}

/* ------------------------------------------------------------------ */
/* 初期化                                                              */
/* ------------------------------------------------------------------ */

async function init() {
  const manifest = chrome.runtime.getManifest();
  $('version').textContent = `v${manifest.version}`;
  document.querySelectorAll('.footer-version').forEach((element) => {
    element.textContent = `v${manifest.version}`;
  });

  settings = await loadSettings();
  applyAll();
  bindEvents();
}

function bindEvents() {
  $('enabled').addEventListener('change', (event) => {
    save({ enabled: event.target.checked }).catch((error) => {
      event.target.checked = !event.target.checked;
      toast(`保存に失敗しました: ${error.message}`, { error: true });
    });
  });

  $('sensitivity').addEventListener('change', (event) => {
    save({ sensitivity: event.target.value }).catch((error) => {
      toast(`保存に失敗しました: ${error.message}`, { error: true });
    });
  });

  $('blockDangerous').addEventListener('change', (event) => {
    save({ blockDangerous: event.target.checked }).catch((error) => {
      event.target.checked = !event.target.checked;
      toast(`保存に失敗しました: ${error.message}`, { error: true });
    });
  });

  $('notifyDangerous').addEventListener('change', (event) => {
    save({ notifyDangerous: event.target.checked }).catch((error) => {
      event.target.checked = !event.target.checked;
      toast(`保存に失敗しました: ${error.message}`, { error: true });
    });
  });

  $('enableSafeBrowsing').addEventListener('change', (event) => {
    save({ enableSafeBrowsing: event.target.checked }).then(() => {
      if (event.target.checked && !settings.apiKey) {
        toast('APIキーを入力してください', { error: true });
      }
    }).catch((error) => {
      event.target.checked = !event.target.checked;
      toast(`保存に失敗しました: ${error.message}`, { error: true });
    });
  });

  $('theme').addEventListener('change', (event) => {
    settings = { ...settings, theme: event.target.value };
    applyAppearance(settings);
    save({ theme: event.target.value }).catch((error) => {
      toast(`保存に失敗しました: ${error.message}`, { error: true });
    });
  });

  $('accentColor').addEventListener('input', (event) => {
    $('accentColorLabel').textContent = event.target.value;
    settings = { ...settings, accentColor: event.target.value };
    applyAppearance(settings);
    scheduleColorSave();
  });

  $('headerColor').addEventListener('input', (event) => {
    $('headerColorLabel').textContent = event.target.value;
    settings = { ...settings, headerColor: event.target.value };
    applyAppearance(settings);
    scheduleColorSave();
  });

  for (const key of LEVEL_KEYS) {
    const input = $(`c-${key}`);
    input.addEventListener('input', (event) => {
      $(`cl-${key}`).textContent = event.target.value;
      settings = {
        ...settings,
        colors: { ...settings.colors, [key]: event.target.value },
      };
      applyAppearance(settings);
      scheduleColorSave();
    });
  }

  $('btn-reset-colors').addEventListener('click', async () => {
    try {
      await save({
        theme: 'system',
        accentColor: DEFAULT_APPEARANCE.accentColor,
        headerColor: DEFAULT_APPEARANCE.headerColor,
        colors: { ...DEFAULT_COLORS },
      });
      applyAll();
      toast('配色を初期値に戻しました');
    } catch (error) {
      toast(`保存に失敗しました: ${error.message}`, { error: true });
    }
  });

  $('apiKey').addEventListener('input', (event) => {
    clearTimeout(apiKeyTimer);
    const value = event.target.value.trim();
    apiKeyTimer = setTimeout(() => {
      save({ apiKey: value }, { silent: true }).catch((error) => {
        toast(`保存に失敗しました: ${error.message}`, { error: true });
      });
    }, 600);
  });

  $('btn-test-api').addEventListener('click', testApiKey);

  $('btn-wl-add').addEventListener('click', addWhitelist);
  $('wl-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addWhitelist();
    }
  });

  $('btn-rule-reset').addEventListener('click', async () => {
    try {
      await save({ ignoreRules: [] });
      renderRules();
      toast('すべてのルールを有効にしました');
    } catch (error) {
      toast(`保存に失敗しました: ${error.message}`, { error: true });
    }
  });

  $('btn-test-url').addEventListener('click', testUrl);
  $('test-url').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      testUrl();
    }
  });

  $('btn-export').addEventListener('click', exportSettings);
  $('import-file').addEventListener('change', importSettings);
  $('btn-reset-all').addEventListener('click', resetAll);
}

function scheduleColorSave() {
  clearTimeout(colorTimer);
  colorTimer = setTimeout(() => {
    save({
      theme: settings.theme,
      accentColor: settings.accentColor,
      headerColor: settings.headerColor,
      colors: { ...settings.colors },
    }, { silent: true }).catch((error) => {
      toast(`保存に失敗しました: ${error.message}`, { error: true });
    });
  }, 350);
}

/* ------------------------------------------------------------------ */
/* ホワイトリスト                                                      */
/* ------------------------------------------------------------------ */

function showWhitelistError(message) {
  const element = $('wl-error');
  element.textContent = message;
  element.hidden = !message;
}

async function addWhitelist() {
  const input = $('wl-input');
  const parsed = normalizeDomainInput(input.value);
  if (!parsed.ok) {
    showWhitelistError(parsed.error);
    input.focus();
    return;
  }
  showWhitelistError('');

  if (settings.whitelist.includes(parsed.domain)) {
    showWhitelistError('すでに登録されています');
    return;
  }

  try {
    await save({ whitelist: [...settings.whitelist, parsed.domain] });
    renderWhitelist(settings.whitelist);
    input.value = '';
  } catch (error) {
    showWhitelistError(`保存に失敗しました: ${error.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Safe Browsing                                                       */
/* ------------------------------------------------------------------ */

async function testApiKey() {
  const result = $('api-test-result');
  const key = $('apiKey').value.trim();
  result.className = 'test-result';

  if (!key) {
    result.textContent = 'APIキーを入力してください';
    result.classList.add('err');
    return;
  }

  result.textContent = 'テスト中…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          client: { clientId: 'domain-guard', clientVersion: chrome.runtime.getManifest().version },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url: 'https://test.google.com/safebrowsing/test/phishing.html' }],
          },
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      result.textContent = `✗ エラー: HTTP ${response.status}${text ? ` — ${text.slice(0, 120)}` : ''}`;
      result.classList.add('err');
      return;
    }

    await save({ apiKey: key, enableSafeBrowsing: true });
    $('enableSafeBrowsing').checked = true;
    result.textContent = '✓ APIキーは有効です。Safe Browsing 連携を有効にしました。';
    result.classList.add('ok');
  } catch (error) {
    result.textContent = error.name === 'AbortError'
      ? '✗ タイムアウトしました'
      : `✗ 通信エラー: ${error.message}`;
    result.classList.add('err');
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ */
/* URL チェッカー                                                      */
/* ------------------------------------------------------------------ */

function renderTestResult(result) {
  const container = $('test-result');
  container.replaceChildren();
  container.hidden = false;
  container.className = `test-result-box ${result.level}`;

  const head = document.createElement('div');
  head.className = 'test-head';

  const judge = document.createElement('span');
  judge.className = 'test-judge';
  judge.textContent = LEVELS[result.level] ? LEVELS[result.level].label : result.level;

  const score = document.createElement('span');
  score.className = 'test-score';
  score.textContent = `危険度 ${result.score}/100`;

  head.append(judge, score);
  container.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'test-meta';
  meta.textContent = result.hostname
    ? `登録ドメイン: ${result.displayRegisteredDomain || result.registeredDomain} / 表示: ${result.displayHost || result.hostname}`
    : 'ドメインを取得できませんでした';
  container.appendChild(meta);

  if (result.whitelisted) {
    const note = document.createElement('p');
    note.className = 'test-note';
    note.textContent = 'このドメインはホワイトリストに登録されています。';
    container.appendChild(note);
  }

  const findings = [...(result.findings || [])].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || (b.score - a.score),
  );

  if (!findings.length) {
    const note = document.createElement('p');
    note.className = 'test-note';
    note.textContent = '検出された問題はありません。';
    container.appendChild(note);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'test-findings';
  for (const item of findings) {
    const li = document.createElement('li');
    const tag = document.createElement('span');
    tag.className = `sev-tag sev-${item.severity}`;
    tag.textContent = SEVERITY_LABELS[item.severity] || item.severity;
    const text = document.createElement('span');
    text.textContent = `${item.title}${item.score > 0 ? ` (+${item.score})` : ''}`;
    li.append(tag, text);
    list.appendChild(li);
  }
  container.appendChild(list);
}

function testUrl() {
  const input = $('test-url');
  const container = $('test-result');
  const raw = input.value.trim();
  if (!raw) {
    container.hidden = false;
    container.className = 'test-result-box danger';
    container.textContent = 'URLを入力してください。';
    return;
  }

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).href;
  } catch {
    container.hidden = false;
    container.className = 'test-result-box danger';
    container.textContent = 'URLの形式が正しくありません。';
    return;
  }

  const result = analyzeUrl(url, {
    whitelist: settings.whitelist,
    sensitivity: settings.sensitivity,
    ignoreRules: settings.ignoreRules,
  });
  renderTestResult(result);
}

/* ------------------------------------------------------------------ */
/* データ管理                                                          */
/* ------------------------------------------------------------------ */

function setDataMessage(message, { error = false } = {}) {
  const element = $('data-message');
  element.textContent = message;
  element.className = `test-result ${error ? 'err' : 'ok'}`;
}

function exportSettings() {
  try {
    const payload = {
      format: 'domain-guard-settings',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: publicSettings(settings),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `domain-guard-settings-${date}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDataMessage('設定をエクスポートしました（APIキーは含まれません）。');
  } catch (error) {
    setDataMessage(`エクスポートに失敗しました: ${error.message}`, { error: true });
  }
}

async function importSettings(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  event.target.value = '';

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const raw = parsed && parsed.settings ? parsed.settings : parsed;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('設定ファイルの形式が正しくありません');
    }
    if (!window.confirm('現在の設定をインポートした内容で上書きしますか？')) return;

    const next = normalizeSettings(raw);
    settings = await saveSettings(next);
    applyAll();
    setDataMessage('設定をインポートしました。');
    toast('✓ 設定をインポートしました');
  } catch (error) {
    setDataMessage(`インポートに失敗しました: ${error.message}`, { error: true });
  }
}

async function resetAll() {
  if (!window.confirm('すべての設定を初期値に戻します。ホワイトリストも削除されます。よろしいですか？')) {
    return;
  }
  try {
    settings = await saveSettings(DEFAULT_SETTINGS);
    applyAll();
    $('test-result').hidden = true;
    setDataMessage('すべての設定を初期化しました。');
    toast('✓ 設定を初期化しました');
  } catch (error) {
    setDataMessage(`初期化に失敗しました: ${error.message}`, { error: true });
  }
}

init().catch((error) => {
  toast(`設定を読み込めませんでした: ${error.message}`, { error: true });
});
