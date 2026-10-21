import { analyzeTabUrl, checkSafeBrowsing, mergeSafeBrowsing, LEVELS } from './lib/analyzer.js';

const DEFAULT_SETTINGS = {
  enabled: true,
  sensitivity: 'normal',
  whitelist: [],
  enableSafeBrowsing: false,
  apiKey: '',
  blockDangerous: true,
  notifyDangerous: true,
  ignoreRules: [],
};

const cache = new Map();
const CACHE_TTL = 60 * 1000;
const CACHE_MAX = 200;
let settings = { ...DEFAULT_SETTINGS };
const notifiedTabs = new Map();

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    settings = { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const [k, v] of Object.entries(changes)) {
    settings[k] = v.newValue;
  }
  cache.clear();
});

function cacheGet(url) {
  const entry = cache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(url);
    return null;
  }
  return entry.result;
}

function cacheSet(url, result) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  cache.set(url, { result, ts: Date.now() });
}

async function analyzeUrlFull(url, { force = false } = {}) {
  if (!settings.enabled) return null;
  if (!/^https?:/i.test(url)) return null;
  if (!force) {
    const cached = cacheGet(url);
    if (cached) return cached;
  }
  let result = analyzeTabUrl(url, settings);
  if (!result) return null;
  if (settings.enableSafeBrowsing && settings.apiKey) {
    try {
      const matches = await checkSafeBrowsing(url, settings.apiKey);
      result = mergeSafeBrowsing(result, matches) || result;
    } catch (e) {
      result = {
        ...result,
        safeBrowsingError: String(e && e.message ? e.message : e),
      };
    }
  }
  cacheSet(url, result);
  return result;
}

function setBadge(tabId, result) {
  const apply = (text, color) => {
    try {
      chrome.action.setBadgeText({ tabId, text }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
      chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }).catch(() => {});
    } catch { /* noop */ }
  };
  if (!result || result.level === 'safe') {
    if (result && result.whitelisted) {
      apply('', LEVELS.safe.color);
      return;
    }
    if (settings.enabled && result) {
      apply('OK', LEVELS.safe.color);
    } else {
      apply('', '#666666');
    }
    return;
  }
  const mark = result.level === 'low' ? '!'
    : result.level === 'medium' ? '!!'
    : result.level === 'high' ? '!!!'
    : '危';
  apply(mark, LEVELS[result.level].color);
}

async function updateTabBadge(tabId, url, { force = false } = {}) {
  if (tabId == null) return null;
  try {
    const result = await analyzeUrlFull(url, { force });
    setBadge(tabId, result);
    return result;
  } catch {
    setBadge(tabId, null);
    return null;
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.url || !/^https?:/i.test(tab.url)) {
    setBadge(tabId, null);
    return;
  }
  if (changeInfo.status === 'loading' || changeInfo.status === 'complete' || changeInfo.url) {
    updateTabBadge(tabId, tab.url).then((result) => {
      maybeNotify(tabId, tab.url, result);
    });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && /^https?:/i.test(tab.url)) {
      const result = await updateTabBadge(tabId, tab.url);
      maybeNotify(tabId, tab.url, result);
    } else {
      setBadge(tabId, null);
    }
  } catch { /* noop */ }
});

function maybeNotify(tabId, url, result) {
  if (!result) return;
  if (!settings.notifyDangerous) return;
  if (result.level !== 'danger' && result.level !== 'high') return;
  const host = result.hostname || url;
  const last = notifiedTabs.get(tabId);
  if (last && last.host === host && Date.now() - last.ts < 10 * 60 * 1000) return;
  notifiedTabs.set(tabId, { host, ts: Date.now() });
  try {
    chrome.notifications.create(`dg-${tabId}-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `Domain Guard: ${LEVELS[result.level].label}`,
      message: `${host} は疑わしいドメインです。個人情報の入力にはご注意ください。`,
      priority: 2,
    });
  } catch { /* noop */ }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  notifiedTabs.delete(tabId);
});

const bypasses = new Map();

function addBypass(url, ttlMs = 15000) {
  try {
    const u = new URL(url);
    const key = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
    bypasses.set(key, Date.now() + ttlMs);
  } catch { /* noop */ }
}

function isBypassed(url) {
  try {
    const u = new URL(url);
    const key = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
    const exp = bypasses.get(key);
    if (!exp) return false;
    if (Date.now() > exp) {
      bypasses.delete(key);
      return false;
    }
    bypasses.delete(key);
    return true;
  } catch {
    return false;
  }
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!/^https?:/i.test(details.url)) return;
  if (!settings.enabled || !settings.blockDangerous) return;
  if (details.url.includes('/warning/warning.html')) return;
  if (isBypassed(details.url)) return;
  try {
    const result = await analyzeUrlFull(details.url);
    if (result && result.level === 'danger') {
      try {
        await chrome.storage.session.set({
          ['warn:' + details.url]: {
            url: details.url,
            host: result.hostname,
            score: result.score,
            findings: result.findings
              .filter((f) => f.severity !== 'info')
              .slice(0, 6)
              .map((f) => ({ title: f.title, severity: f.severity })),
            ts: Date.now(),
          },
        });
      } catch { /* noop */ }
      const warnUrl = chrome.runtime.getURL('warning/warning.html')
        + `?url=${encodeURIComponent(details.url)}`
        + `&score=${result.score}`
        + `&host=${encodeURIComponent(result.hostname || '')}`;
      chrome.tabs.update(details.tabId, { url: warnUrl }).catch(() => {});
    }
  } catch { /* noop */ }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'ANALYZE') {
    const url = msg.url || (sender.tab && sender.tab.url) || '';
    analyzeUrlFull(url, { force: !!msg.force })
      .then((result) => sendResponse({ ok: true, result, settings: publicSettings() }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }
  if (msg.type === 'GET_SETTINGS') {
    sendResponse({ ok: true, settings: publicSettings() });
    return false;
  }
  if (msg.type === 'SET_SETTING') {
    const patch = msg.patch || {};
    chrome.storage.sync.set(patch)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'ADD_WHITELIST') {
    const domain = String(msg.domain || '').toLowerCase().trim();
    if (!domain) {
      sendResponse({ ok: false, error: 'ドメインが空です' });
      return false;
    }
    const list = Array.isArray(settings.whitelist) ? [...settings.whitelist] : [];
    if (!list.includes(domain)) list.push(domain);
    chrome.storage.sync.set({ whitelist: list })
      .then(() => sendResponse({ ok: true, whitelist: list }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'REMOVE_WHITELIST') {
    const domain = String(msg.domain || '');
    const list = (settings.whitelist || []).filter((d) => d !== domain);
    chrome.storage.sync.set({ whitelist: list })
      .then(() => sendResponse({ ok: true, whitelist: list }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'BYPASS_BLOCK') {
    if (msg.url) addBypass(msg.url, 20000);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'GET_TAB_URL') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => sendResponse({ ok: true, url: tab ? tab.url : null }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

function publicSettings() {
  const { apiKey, ...rest } = settings;
  return {
    ...rest,
    hasApiKey: Boolean(apiKey),
  };
}

loadSettings().then(() => {
  chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.url && /^https?:/i.test(tab.url)) {
        updateTabBadge(tab.id, tab.url);
      }
    }
  }).catch(() => {});
});
