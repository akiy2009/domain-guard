import { LEVELS } from '../lib/analyzer.js';
import { applyAppearance, DEFAULT_APPEARANCE } from '../lib/theme.js';

const $ = (id) => document.getElementById(id);
const SEVERITY_LABELS = { danger: '危険', high: '高', medium: '中', low: '低', info: '情報' };

let current = null;
let currentSettings = null;
let loading = false;

applyAppearance(DEFAULT_APPEARANCE);
chrome.storage.sync.get(null)
  .then((stored) => applyAppearance(stored))
  .catch(() => {});

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString('ja-JP', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return '';
  }
}

function setNotice(messages, { error = false } = {}) {
  const notice = $('notice');
  const text = messages.filter(Boolean).join(' ');
  notice.hidden = !text;
  notice.classList.toggle('error', Boolean(text) && error);
  notice.textContent = text;
}

function setScore(score, level, visible) {
  $('verdict-score').hidden = !visible;
  $('meter-fill').style.width = visible ? `${Math.min(100, Math.max(0, score))}%` : '0%';
  $('meter-fill').style.background = `var(--${level})`;
  $('score-num').textContent = String(score);
  $('score-num').style.color = `var(--${level})`;
}

function renderFindings(findings) {
  const list = $('findings');
  list.replaceChildren();
  $('findings-count').textContent = String(findings.length);
  $('findings-wrap').hidden = findings.length === 0;

  for (const item of findings) {
    const li = document.createElement('li');
    li.className = `finding ${item.severity}`;

    const head = document.createElement('div');
    head.className = 'finding-head';

    const tag = document.createElement('span');
    tag.className = `sev-tag sev-${item.severity}`;
    tag.textContent = SEVERITY_LABELS[item.severity] || item.severity;

    const title = document.createElement('span');
    title.className = 'finding-title';
    title.textContent = item.title;

    const points = document.createElement('span');
    points.className = 'finding-points';
    points.textContent = item.score > 0 ? `+${item.score}` : '';

    head.append(tag, title, points);

    const desc = document.createElement('div');
    desc.className = 'finding-desc';
    desc.textContent = item.description;

    li.append(head, desc);
    list.appendChild(li);
  }
}

function renderHostInfo(result) {
  const visible = Boolean(result && result.hostname);
  $('host-info').hidden = !visible;
  if (!visible) return;

  $('host-display').textContent = result.displayHost || result.hostname;
  $('host-registered').textContent = result.displayRegisteredDomain || result.registeredDomain || '-';
  const showActual = Boolean(result.punycode) || result.displayHost !== result.hostname;
  $('host-puny-row').hidden = !showActual;
  if (showActual) $('host-actual').textContent = result.hostname;
}

function renderWhitelistButton(result, settings) {
  const button = $('btn-whitelist');
  const host = result && result.hostname;
  const registered = result && result.registeredDomain;
  if (!host || !registered) {
    button.hidden = true;
    return;
  }

  const whitelist = Array.isArray(settings.whitelist) ? settings.whitelist : [];
  const match = whitelist.find((entry) => (
    host === entry || host.endsWith('.' + entry) || registered === entry
  ));

  button.hidden = false;
  button.disabled = false;
  if (match) {
    button.dataset.action = 'remove';
    button.dataset.domain = match;
    button.textContent = `信頼済みから削除（${match}）`;
    button.classList.add('btn-remove');
  } else {
    button.dataset.action = 'add';
    button.dataset.domain = registered;
    button.textContent = `✓ 「${registered}」を信頼済みに追加`;
    button.classList.remove('btn-remove');
  }
}

function render(result, settings) {
  const card = $('card-verdict');
  const level = result && LEVELS[result.level] ? result.level : 'safe';
  const meta = LEVELS[level];

  card.className = `verdict ${level}`;
  $('verdict-icon').textContent = level === 'safe' ? '✓'
    : level === 'low' ? '!'
    : level === 'medium' ? '!'
    : level === 'high' ? '!!'
    : '×';
  $('verdict-label').textContent = meta.label;
  $('verdict-label').style.color = `var(--${level})`;
  $('verdict-host').textContent = result
    ? (result.displayHost || result.hostname || '')
    : '';

  const score = result ? result.score : 0;
  setScore(score, level, Boolean(result));
  if (result) {
    $('checked-at').hidden = false;
    $('checked-at').textContent = `最終確認 ${formatTime(result.checkedAt)}`;
  } else {
    $('checked-at').hidden = true;
  }

  renderHostInfo(result);
  const findings = result && Array.isArray(result.findings) ? result.findings : [];
  renderFindings(findings);

  const empty = $('empty-state');
  empty.hidden = !result || findings.length > 0;
  if (!empty.hidden) {
    empty.querySelector('p').textContent = 'このページでは問題は見つかりませんでした。';
  }

  const notices = [];
  let noticeError = false;
  if (!settings) {
    notices.push('設定を読み込めませんでした。');
    noticeError = true;
  } else if (!settings.enabled) {
    notices.push('Domain Guard は現在「無効」です。設定画面から有効にしてください。');
  }
  if (result && result.safeBrowsingError) {
    notices.push(`Safe Browsing の検査に失敗しました: ${result.safeBrowsingError}`);
    noticeError = true;
  }
  if (settings && settings.enableSafeBrowsing && !settings.hasApiKey) {
    notices.push('Safe Browsing 連携は有効ですが APIキーが未設定です。');
  }
  if (result && result.whitelisted) {
    notices.push('このドメインは信頼済みに登録されています。');
  }
  if (result && Array.isArray(result.safeBrowsing) && result.safeBrowsing.length) {
    notices.push('Google Safe Browsing の危険データベースに一致しました。');
  }
  setNotice(notices, { error: noticeError });

  renderWhitelistButton(result, settings || {});

  const reportWrap = $('report-wrap');
  const showReport = Boolean(result && (level === 'high' || level === 'danger') && result.url);
  reportWrap.hidden = !showReport;
  if (showReport) {
    $('report-link').href = `https://safebrowsing.google.com/safebrowsing/report_phish/?url=${encodeURIComponent(result.url)}`;
  }
}

function renderUnsupported(url) {
  current = null;
  $('card-verdict').className = 'verdict';
  $('verdict-icon').textContent = '–';
  $('verdict-label').textContent = '解析対象外';
  $('verdict-label').style.color = 'var(--muted)';
  $('verdict-host').textContent = url || '（URLを取得できません）';
  setScore(0, 'safe', false);
  $('checked-at').hidden = true;
  $('host-info').hidden = true;
  $('findings-wrap').hidden = true;
  $('empty-state').hidden = true;
  $('btn-whitelist').hidden = true;
  $('report-wrap').hidden = true;
  setNotice(['http または https のページでご利用ください。']);
}

function renderError(error) {
  current = null;
  $('card-verdict').className = 'verdict';
  $('verdict-icon').textContent = '!';
  $('verdict-label').textContent = '解析できませんでした';
  $('verdict-label').style.color = 'var(--danger)';
  $('verdict-host').textContent = '';
  setScore(0, 'safe', false);
  $('checked-at').hidden = true;
  $('host-info').hidden = true;
  $('findings-wrap').hidden = true;
  $('empty-state').hidden = true;
  $('btn-whitelist').hidden = true;
  $('report-wrap').hidden = true;
  setNotice([String(error && error.message ? error.message : error)], { error: true });
}

async function loadFromTab(force = false) {
  if (loading) return;
  loading = true;
  const recheck = $('btn-recheck');
  recheck.disabled = true;
  recheck.textContent = '解析中…';
  $('verdict-label').textContent = '解析中…';
  $('verdict-icon').textContent = '…';
  $('card-verdict').className = 'verdict';

  try {
    const tabResponse = await chrome.runtime.sendMessage({ type: 'GET_TAB_URL' });
    const url = tabResponse && tabResponse.ok ? tabResponse.url : null;
    if (!url || !/^https?:/i.test(url)) {
      renderUnsupported(url);
      return;
    }

    const response = await chrome.runtime.sendMessage({ type: 'ANALYZE', url, force });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : '解析結果を取得できませんでした');
    }

    current = response.result;
    currentSettings = response.settings || null;
    if (currentSettings) applyAppearance(currentSettings);

    if (!current) {
      renderUnsupported(url);
      if (currentSettings && !currentSettings.enabled) {
        setNotice(['Domain Guard は現在「無効」です。設定画面から有効にしてください。']);
      }
      return;
    }

    render(current, currentSettings);
  } catch (error) {
    renderError(error);
  } finally {
    loading = false;
    recheck.disabled = false;
    recheck.textContent = '再解析';
  }
}

$('btn-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

$('btn-recheck').addEventListener('click', () => loadFromTab(true));

$('btn-whitelist').addEventListener('click', async () => {
  const button = $('btn-whitelist');
  const domain = button.dataset.domain;
  const action = button.dataset.action;
  if (!domain || !action) return;

  if (action === 'add' && current && (current.level === 'high' || current.level === 'danger')) {
    const confirmed = window.confirm(
      `「${domain}」を信頼済みに追加しますか？\n\n`
      + '信頼済みにすると、このドメインとそのサブドメインでは警告が表示されなくなります。'
      + '本当に安全だと確認できた場合だけ追加してください。',
    );
    if (!confirmed) return;
  }

  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: action === 'remove' ? 'REMOVE_WHITELIST' : 'ADD_WHITELIST',
      domain,
    });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : '設定を保存できませんでした');
    }
    await loadFromTab(true);
  } catch (error) {
    setNotice([String(error && error.message ? error.message : error)], { error: true });
    button.disabled = false;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.close();
});

loadFromTab();
