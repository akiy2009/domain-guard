const params = new URLSearchParams(location.search);
const target = params.get('url') || '';
const hostParam = params.get('host') || '';
const scoreParam = Number(params.get('score') || 0);

const urlEl = document.getElementById('target-url');
const hostEl = document.getElementById('host');
const scoreEl = document.getElementById('score');

urlEl.textContent = target || '（URLを取得できませんでした）';
hostEl.textContent = hostParam || (() => {
  try { return new URL(target).hostname; } catch { return ''; }
})();
if (scoreParam > 0) {
  scoreEl.textContent = `危険度 ${scoreParam}/100`;
} else {
  scoreEl.hidden = true;
}

const reasonsEl = document.getElementById('reasons');
const reasonsWrap = document.getElementById('reasons-wrap');

function addReason(title, severity = 'danger') {
  const li = document.createElement('li');
  li.className = severity;
  li.textContent = title;
  reasonsEl.appendChild(li);
}

async function loadFindings() {
  if (!target) return;
  try {
    const key = 'warn:' + target;
    const stored = await chrome.storage.session.get(key);
    const info = stored[key];
    if (info && Array.isArray(info.findings) && info.findings.length) {
      for (const f of info.findings) addReason(f.title, f.severity);
      try { await chrome.storage.session.remove(key); } catch { /* noop */ }
      return;
    }
  } catch { /* noop */ }
  addReason('偽サイトの特徴が複数検出されました');
}

function goBack() {
  if (target) {
    chrome.runtime.sendMessage({ type: 'BYPASS_BLOCK', url: target });
  }
  if (history.length > 1) {
    history.back();
  } else {
    location.replace('about:blank');
  }
}

function proceed() {
  if (!target) {
    location.replace('about:blank');
    return;
  }
  chrome.runtime.sendMessage({ type: 'BYPASS_BLOCK', url: target }, () => {
    location.replace(target);
  });
}

document.getElementById('btn-back').addEventListener('click', goBack);
document.getElementById('btn-proceed').addEventListener('click', proceed);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') goBack();
  if (e.key === 'Enter' && document.activeElement === document.body) goBack();
});

loadFindings().then(() => {
  reasonsWrap.hidden = reasonsEl.children.length === 0;
  document.getElementById('btn-back').focus();
});
