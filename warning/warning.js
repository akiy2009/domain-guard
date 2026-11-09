import { applyAppearance, DEFAULT_APPEARANCE } from '../lib/theme.js';
import { SEVERITY_LABELS } from '../lib/rules.js';

const $ = (id) => document.getElementById(id);

let appearanceSettings = null;

function applyStoredAppearance() {
  applyAppearance(appearanceSettings || DEFAULT_APPEARANCE);
}

async function initAppearance() {
  try {
    appearanceSettings = await chrome.storage.sync.get(null);
  } catch {
    appearanceSettings = null;
  }
  applyStoredAppearance();

  try {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const mode = appearanceSettings && appearanceSettings.theme;
      if (!mode || mode === 'system') applyStoredAppearance();
    };
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
  } catch {
    // 端末設定を監視できない環境では現在のテーマのまま
  }
}

initAppearance();

/* ------------------------------------------------------------------ */
/* URL と警告データ                                                     */
/* ------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);
const target = params.get('url') || '';
const backParam = params.get('back') || '';
const hostParam = params.get('host') || '';
const scoreParam = Math.max(0, Math.min(100, Number(params.get('score')) || 0));

const isHttpUrl = (value) => /^https?:\/\//i.test(value);

function hostnameOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

const urlEl = $('target-url');
const hostEl = $('host');
const scoreEl = $('score');
const extraEl = $('target-extra');
const copyBtn = $('btn-copy');
const copyStatus = $('copy-status');
const reportLink = $('report-link');
const reasonsEl = $('reasons');
const reasonsWrap = $('reasons-wrap');
const backBtn = $('btn-back');
const proceedBtn = $('btn-proceed');

const displayHost = hostParam || hostnameOf(target);

urlEl.textContent = target || '（URLを取得できませんでした）';
hostEl.textContent = displayHost || '不明なホスト';
if (scoreParam > 0) {
  scoreEl.textContent = `危険度 ${scoreParam}/100`;
} else {
  scoreEl.hidden = true;
}

if (isHttpUrl(target)) {
  reportLink.href = 'https://safebrowsing.google.com/safebrowsing/report_phish/'
    + `?url=${encodeURIComponent(target)}&hl=ja`;
} else {
  reportLink.hidden = true;
}

/* ------------------------------------------------------------------ */
/* 警告理由の表示                                                       */
/* ------------------------------------------------------------------ */

function addReason(title, severity = 'danger') {
  const li = document.createElement('li');
  li.className = Object.prototype.hasOwnProperty.call(SEVERITY_LABELS, severity)
    ? severity
    : 'danger';

  const badge = document.createElement('span');
  badge.className = 'reason-badge';
  badge.textContent = SEVERITY_LABELS[li.className] || SEVERITY_LABELS.danger;

  const text = document.createElement('span');
  text.className = 'reason-text';
  text.textContent = title;

  li.append(badge, text);
  reasonsEl.appendChild(li);
}

function renderExtraInfo(info) {
  const lines = [];
  if (info) {
    if (info.displayHost && info.host && info.displayHost !== info.host) {
      lines.push(`実際の接続先: ${info.displayHost}（${info.host}）`);
    }
    if (info.registeredDomain && info.registeredDomain !== info.host) {
      lines.push(`登録ドメイン: ${info.registeredDomain}`);
    }
    if (info.punycode) {
      lines.push('このURLには punycode（国際化ドメイン名）が含まれています。表示と実際の接続先が異なる場合があります。');
    }
  }
  if (lines.length === 0) {
    extraEl.hidden = true;
    return;
  }
  extraEl.replaceChildren(...lines.map((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    return p;
  }));
  extraEl.hidden = false;
}

async function loadWarningData() {
  if (!target) return;
  try {
    const key = 'warn:' + target;
    const stored = await chrome.storage.session.get(key);
    const info = stored[key];
    if (!info) return;

    renderExtraInfo(info);
    if (Array.isArray(info.findings) && info.findings.length) {
      for (const finding of info.findings) {
        if (!finding || typeof finding.title !== 'string' || !finding.title) continue;
        addReason(finding.title, finding.severity);
      }
    }
  } catch {
    // storage.session が使えない場合は下の既定メッセージのみ表示する
  }
}

/* ------------------------------------------------------------------ */
/* 操作                                                                */
/* ------------------------------------------------------------------ */

function goBack() {
  if (backParam && isHttpUrl(backParam) && backParam !== target) {
    location.replace(backParam);
    return;
  }
  location.replace('about:blank');
}

let confirmPanel = null;

function closeConfirm() {
  if (!confirmPanel) return;
  confirmPanel.remove();
  confirmPanel = null;
  proceedBtn.focus();
}

function confirmProceed() {
  if (!isHttpUrl(target)) {
    goBack();
    return;
  }
  if (confirmPanel) return;

  const panel = document.createElement('div');
  panel.className = 'confirm';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-labelledby', 'confirm-title');
  panel.setAttribute('aria-describedby', 'confirm-desc');

  const title = document.createElement('h2');
  title.id = 'confirm-title';
  title.textContent = '本当にこのサイトを開きますか？';

  const desc = document.createElement('p');
  desc.id = 'confirm-desc';
  desc.textContent = '偽サイトによる被害（ID・パスワード・カード情報の盗難など）を受けるおそれがあります。'
    + '開いた場合、しばらくの間この警告は表示されません。';

  const buttons = document.createElement('div');
  buttons.className = 'confirm-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = 'キャンセル';
  cancel.addEventListener('click', closeConfirm);

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn danger';
  open.textContent = '危険を承知で開く';
  open.addEventListener('click', () => {
    open.disabled = true;
    cancel.disabled = true;
    open.textContent = '開いています…';
    chrome.runtime.sendMessage({ type: 'BYPASS_BLOCK', url: target })
      .catch(() => {})
      .finally(() => location.replace(target));
  });

  buttons.append(cancel, open);
  panel.append(title, desc, buttons);
  proceedBtn.closest('.actions').after(panel);
  confirmPanel = panel;
  cancel.focus();

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeConfirm();
    }
  });
}

async function copyTarget() {
  if (!target) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(target);
    ok = true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = target;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      ok = document.execCommand('copy');
      area.remove();
    } catch {
      ok = false;
    }
  }
  copyStatus.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
  copyStatus.classList.toggle('error', !ok);
  setTimeout(() => {
    copyStatus.textContent = '';
    copyStatus.classList.remove('error');
  }, 2500);
}

backBtn.addEventListener('click', goBack);
proceedBtn.addEventListener('click', confirmProceed);
copyBtn.addEventListener('click', () => { void copyTarget(); });

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !confirmPanel) {
    event.preventDefault();
    goBack();
  }
});

loadWarningData().then(() => {
  if (reasonsEl.children.length === 0) {
    const summary = scoreParam > 0
      ? `URLの特徴から危険と判定されました（危険度 ${scoreParam}/100）。`
      : '偽サイトによく見られる特徴が検出されました。';
    addReason(summary, 'danger');
  }
  reasonsWrap.hidden = false;
  backBtn.focus();
});
