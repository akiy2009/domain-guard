import { LEVELS } from '../lib/analyzer.js';

const $ = (id) => document.getElementById(id);

const SEV_LABEL = { danger: '危険', high: '高', medium: '中', low: '低', info: '情報' };

let current = null;
let currentSettings = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderVerdict(result, settings) {
  const card = $('verdict-icon').parentElement;
  const level = result ? result.level : 'safe';
  const meta = LEVELS[level] || LEVELS.safe;
  card.className = `verdict ${level}`;
  $('verdict-icon').textContent = level === 'safe' ? '✓'
    : level === 'low' ? '!'
    : level === 'medium' ? '!'
    : level === 'high' ? '!!'
    : '!';
  $('verdict-label').textContent = meta.label;
  $('verdict-label').style.color = meta.color;
  $('verdict-host').textContent = result ? (result.displayHost || result.hostname || '') : '';

  const score = result ? result.score : 0;
  $('verdict-score').hidden = false;
  $('score-num').textContent = score;
  $('score-num').style.color = meta.color;
  $('meter-fill').style.width = `${Math.max(2, score)}%`;
  $('meter-fill').style.background = meta.color;

  if (result && result.hostname) {
    $('host-info').hidden = false;
    $('host-display').textContent = result.displayHost || result.hostname;
    $('host-registered').textContent = result.registeredDomain || '-';
    const puny = result.hostname !== (result.decodedHost || result.hostname);
    $('host-puny-row').hidden = !puny;
    if (puny) $('host-actual').textContent = result.hostname;
  } else {
    $('host-info').hidden = true;
  }

  const findings = result ? result.findings || [] : [];
  const list = $('findings');
  list.innerHTML = '';
  $('findings-wrap').hidden = findings.length === 0;
  $('findings-count').textContent = findings.length;
  for (const f of findings) {
    const li = document.createElement('li');
    li.className = `finding ${f.severity}`;
    li.innerHTML = `
      <div class="finding-head">
        <span class="sev-tag sev-${esc(f.severity)}">${esc(SEV_LABEL[f.severity] || f.severity)}</span>
        <span class="finding-title">${esc(f.title)}</span>
        <span class="finding-points">+${esc(f.score)}</span>
      </div>
      <div class="finding-desc">${esc(f.description)}</div>`;
    list.appendChild(li);
  }

  $('empty-state').hidden = findings.length > 0 || !result;

  const notice = $('notice');
  const msgs = [];
  notice.classList.remove('error');
  if (!settings || !settings.enabled) {
    msgs.push('Domain Guard は現在「無効」になっています。設定から有効化してください。');
  }
  if (result && result.safeBrowsingError) {
    msgs.push(`Safe Browsing 検査に失敗しました: ${result.safeBrowsingError}`);
  }
  if (settings && settings.enableSafeBrowsing && !settings.hasApiKey) {
    msgs.push('Safe Browsing 連携は有効ですが APIキーが未設定です（設定画面で登録できます）。');
  }
  if (result && result.whitelisted) {
    msgs.push('このドメインはあなたが信頼済みに登録しています。');
  }
  if (msgs.length) {
    notice.hidden = false;
    notice.textContent = msgs.join(' ');
  } else {
    notice.hidden = true;
  }

  const wlBtn = $('btn-whitelist');
  const host = result && result.hostname;
  const reg = result && result.registeredDomain;
  const inList = settings && Array.isArray(settings.whitelist)
    && (settings.whitelist.includes(host) || settings.whitelist.includes(reg));
  wlBtn.hidden = !host || !reg || !!result.whitelisted;
  wlBtn.textContent = inList ? `「${reg}」は登録済み` : `✓ 「${reg}」を信頼済みに追加`;
  wlBtn.disabled = !!inList;
}

async function loadFromTab(force = false) {
  $('verdict-label').textContent = '解析中…';
  try {
    const tabResp = await chrome.runtime.sendMessage({ type: 'GET_TAB_URL' });
    const url = tabResp && tabResp.url;
    if (!url || !/^https?:/i.test(url)) {
      renderVerdict(null, currentSettings);
      $('verdict-label').textContent = '解析対象外';
      $('verdict-host').textContent = url || '（URLなし）';
      $('empty-state').hidden = false;
      $('empty-state').querySelector('p').textContent =
        'このページは解析の対象外です。http または https のページでご利用ください。';
      return;
    }
    const resp = await chrome.runtime.sendMessage({ type: 'ANALYZE', url, force });
    if (!resp || !resp.ok) throw new Error(resp ? resp.error : 'no response');
    current = resp.result;
    currentSettings = resp.settings;
    $('empty-state').querySelector('p').textContent = 'このページでは問題は見つかりませんでした。';
    renderVerdict(current, currentSettings);
  } catch (e) {
    $('verdict-label').textContent = '解析できませんでした';
    $('notice').hidden = false;
    $('notice').classList.add('error');
    $('notice').textContent = String(e && e.message ? e.message : e);
  }
}

$('btn-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

$('btn-recheck').addEventListener('click', () => loadFromTab(true));

$('btn-whitelist').addEventListener('click', async () => {
  if (!current || !current.registeredDomain) return;
  const resp = await chrome.runtime.sendMessage({ type: 'ADD_WHITELIST', domain: current.registeredDomain });
  if (resp && resp.ok) {
    if (currentSettings) currentSettings.whitelist = resp.whitelist;
    renderVerdict({ ...current, whitelisted: true }, currentSettings);
  }
});

loadFromTab();
