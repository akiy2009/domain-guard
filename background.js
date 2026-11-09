/**
 * Domain Guard - Service Worker (Manifest V3)
 *
 * 役割:
 *  - タブの URL を解析してバッジ・通知を更新する
 *  - 「危険」と判定したメイン フレームの遷移を警告ページへ差し替える
 *  - ポップアップ / 設定画面からのメッセージを処理する
 */
import { analyzeTabUrl, checkSafeBrowsing, mergeSafeBrowsing, LEVELS } from './lib/analyzer.js';
import { levelColors, readableText } from './lib/theme.js';
import {
  applySettingsChanges, loadSettings, normalizeDomainInput, normalizeSettings,
  publicSettings, saveSettings,
} from './lib/settings.js';
import { getRegisteredDomain } from './lib/utils.js';

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 300;
const BYPASS_KEY = 'bypasses';
const BYPASS_TTL = 2 * 60 * 1000;
const WARNING_PREFIX = 'warn:';
const WARNING_TTL = 10 * 60 * 1000;

let settings = normalizeSettings();
let settingsReady = loadSettings()
  .then((loaded) => {
    settings = loaded;
    return loaded;
  })
  .catch(() => {
    settings = normalizeSettings();
    return settings;
  });

const cache = new Map();
const notifiedTabs = new Map();
const pendingNavigations = new Map();
const notificationTargets = new Map();

/* ------------------------------------------------------------------ */
/* 設定                                                                */
/* ------------------------------------------------------------------ */

async function getSettings() {
  await settingsReady;
  return settings;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  settings = applySettingsChanges(settings, changes);
  cache.clear();
  refreshAllBadges();
});

/* ------------------------------------------------------------------ */
/* キャッシュ                                                          */
/* ------------------------------------------------------------------ */

function cacheGet(url) {
  const entry = cache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(url);
    return null;
  }
  // Map の挿入順を LRU 的に更新する
  cache.delete(url);
  cache.set(url, entry);
  return entry.result;
}

function cacheSet(url, result) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(url, { result, ts: Date.now() });
}

/* ------------------------------------------------------------------ */
/* 解析                                                                */
/* ------------------------------------------------------------------ */

async function analyzeUrlFull(url, { force = false } = {}) {
  const current = await getSettings();
  if (!current.enabled) return null;
  if (!/^https?:/i.test(url)) return null;
  if (!force) {
    const cached = cacheGet(url);
    if (cached) return cached;
  }

  let result = analyzeTabUrl(url, current);
  if (!result) return null;

  if (current.enableSafeBrowsing && current.apiKey) {
    try {
      const matches = await checkSafeBrowsing(url, current.apiKey, {
        clientVersion: chrome.runtime.getManifest().version,
      });
      result = mergeSafeBrowsing(result, matches) || result;
    } catch (error) {
      result = {
        ...result,
        safeBrowsingError: String(error && error.message ? error.message : error),
      };
    }
  }

  cacheSet(url, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* バッジ                                                              */
/* ------------------------------------------------------------------ */

const BADGE_TEXT = {
  low: '!',
  medium: '!!',
  high: '!!!',
  danger: '危',
};

function badgeFor(result) {
  if (!settings.enabled) return null;
  if (!result) return null;
  if (result.whitelisted) return null;
  if (result.level === 'safe') return { text: 'OK', color: levelColors(settings).safe };
  return {
    text: BADGE_TEXT[result.level] || '!',
    color: levelColors(settings)[result.level] || LEVELS[result.level]?.color || '#666666',
  };
}

async function setBadge(tabId, result) {
  if (tabId == null || tabId < 0) return;
  const badge = badgeFor(result);
  const text = badge ? badge.text : '';
  const color = badge ? badge.color : '#666666';
  const tasks = [
    chrome.action.setBadgeText({ tabId, text }),
    chrome.action.setBadgeBackgroundColor({ tabId, color }),
  ];
  if (chrome.action.setBadgeTextColor) {
    tasks.push(chrome.action.setBadgeTextColor({ tabId, color: readableText(color) }));
  }
  await Promise.allSettled(tasks);
}

async function updateTabBadge(tabId, url, { force = false } = {}) {
  if (tabId == null || tabId < 0) return null;
  try {
    const result = await analyzeUrlFull(url, { force });
    await setBadge(tabId, result);
    return result;
  } catch {
    await setBadge(tabId, null);
    return null;
  }
}

async function refreshAllBadges() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(
      tabs
        .filter((tab) => tab.id != null && tab.url && /^https?:/i.test(tab.url))
        .map((tab) => updateTabBadge(tab.id, tab.url)),
    );
  } catch {
    // タブが取得できない環境では何もしない
  }
}

/* ------------------------------------------------------------------ */
/* タブイベント                                                        */
/* ------------------------------------------------------------------ */

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
    setBadge(tabId, null).catch(() => {});
    return;
  }
  if (changeInfo.status === 'loading' || changeInfo.status === 'complete' || changeInfo.url) {
    updateTabBadge(tabId, tab.url)
      .then((result) => maybeNotify(tabId, tab.url, result))
      .catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && /^https?:/i.test(tab.url)) {
      const result = await updateTabBadge(tabId, tab.url);
      await maybeNotify(tabId, tab.url, result);
    } else {
      await setBadge(tabId, null);
    }
  } catch {
    // タブがすでに閉じられている
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  notifiedTabs.delete(tabId);
  pendingNavigations.delete(tabId);
});

/* ------------------------------------------------------------------ */
/* 通知                                                                */
/* ------------------------------------------------------------------ */

async function maybeNotify(tabId, url, result) {
  if (!result || !settings.notifyDangerous) return;
  if (result.level !== 'danger') return;

  const host = result.hostname || url;
  const last = notifiedTabs.get(tabId);
  if (last && last.host === host && Date.now() - last.ts < 30 * 60 * 1000) return;
  notifiedTabs.set(tabId, { host, ts: Date.now() });

  const level = LEVELS[result.level] || LEVELS.danger;
  const notificationId = `dg-${tabId}-${Date.now()}`;
  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `Domain Guard: ${level.label}`,
      message: `${host} は疑わしいドメインです。個人情報の入力にはご注意ください。`,
      priority: 2,
    });
    notificationTargets.set(notificationId, { tabId, url });
  } catch {
    // 通知が許可されていない場合は何もしない
  }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const target = notificationTargets.get(notificationId);
  notificationTargets.delete(notificationId);
  if (!target) return;
  try {
    await chrome.tabs.update(target.tabId, { active: true });
    const tab = await chrome.tabs.get(target.tabId);
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    // タブが閉じられている
  }
  chrome.notifications.clear(notificationId).catch(() => {});
});

chrome.notifications.onClosed.addListener((notificationId) => {
  notificationTargets.delete(notificationId);
});

/* ------------------------------------------------------------------ */
/* セッションストレージ（警告ページ・バイパス）                        */
/* ------------------------------------------------------------------ */

const memorySession = new Map();

async function sessionGet(key) {
  try {
    if (chrome.storage.session) {
      const stored = await chrome.storage.session.get(key);
      return stored[key];
    }
  } catch {
    // フォールバック
  }
  return memorySession.get(key);
}

async function sessionSet(values) {
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set(values);
      return;
    }
  } catch {
    // フォールバック
  }
  for (const [key, value] of Object.entries(values)) memorySession.set(key, value);
}

async function sessionRemove(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.remove(list);
      return;
    }
  } catch {
    // フォールバック
  }
  for (const key of list) memorySession.delete(key);
}

async function sessionEntries(prefix) {
  try {
    if (chrome.storage.session) {
      const all = await chrome.storage.session.get(null);
      return Object.entries(all).filter(([key]) => key.startsWith(prefix));
    }
  } catch {
    // フォールバック
  }
  return [...memorySession.entries()].filter(([key]) => key.startsWith(prefix));
}

function bypassKeyFor(url) {
  try {
    const host = new URL(url).hostname;
    return getRegisteredDomain(host);
  } catch {
    return '';
  }
}

async function addBypass(url, ttlMs = BYPASS_TTL) {
  const key = bypassKeyFor(url);
  if (!key) return;
  const map = (await sessionGet(BYPASS_KEY)) || {};
  const now = Date.now();
  for (const [entryKey, expires] of Object.entries(map)) {
    if (!expires || expires < now) delete map[entryKey];
  }
  map[key] = now + ttlMs;
  await sessionSet({ [BYPASS_KEY]: map });
}

async function isBypassed(url) {
  const key = bypassKeyFor(url);
  if (!key) return false;
  const map = (await sessionGet(BYPASS_KEY)) || {};
  const expires = map[key];
  if (!expires) return false;
  if (Date.now() > expires) {
    delete map[key];
    await sessionSet({ [BYPASS_KEY]: map });
    return false;
  }
  return true;
}

async function storeWarning(url, result) {
  const payload = {
    url,
    host: result.hostname,
    displayHost: result.displayHost,
    registeredDomain: result.displayRegisteredDomain,
    score: result.score,
    findings: result.findings
      .filter((item) => item.severity !== 'info')
      .slice(0, 8)
      .map((item) => ({ title: item.title, severity: item.severity })),
    ts: Date.now(),
  };
  await sessionSet({ [WARNING_PREFIX + url]: payload });

  // 古い警告データを掃除する
  const entries = await sessionEntries(WARNING_PREFIX);
  const stale = entries
    .filter(([, value]) => !value || !value.ts || Date.now() - value.ts > WARNING_TTL)
    .map(([key]) => key);
  if (stale.length) await sessionRemove(stale);
}

/* ------------------------------------------------------------------ */
/* ブロック                                                            */
/* ------------------------------------------------------------------ */

async function handleBeforeNavigate(details) {
  if (details.frameId !== 0 || details.tabId < 0) return;
  if (!/^https?:/i.test(details.url)) return;
  if (details.url.startsWith(chrome.runtime.getURL('warning/'))) return;

  const current = await getSettings();
  if (!current.enabled || !current.blockDangerous) return;
  if (await isBypassed(details.url)) return;

  pendingNavigations.set(details.tabId, { url: details.url, ts: Date.now() });
  try {
    const result = await analyzeUrlFull(details.url);
    if (!result || result.level !== 'danger') return;

    // 解析中に別の URL へ移動していたら、その遷移は妨げない。
    const pending = pendingNavigations.get(details.tabId);
    if (!pending || pending.url !== details.url) return;

    await storeWarning(details.url, result);

    // 「前のページに戻る」で元のページへ戻れるよう、遷移前のURLを控える。
    let backUrl = '';
    try {
      const tab = await chrome.tabs.get(details.tabId);
      if (tab && /^https?:/i.test(tab.url || '') && tab.url !== details.url) backUrl = tab.url;
    } catch {
      // タブ情報を取得できなくても警告は表示する
    }

    const warnUrl = chrome.runtime.getURL('warning/warning.html')
      + `?url=${encodeURIComponent(details.url)}`
      + `&score=${encodeURIComponent(String(result.score))}`
      + `&host=${encodeURIComponent(result.displayHost || result.hostname || '')}`
      + (backUrl ? `&back=${encodeURIComponent(backUrl)}` : '');
    await chrome.tabs.update(details.tabId, { url: warnUrl });
  } catch {
    // タブが閉じられた等
  } finally {
    const pending = pendingNavigations.get(details.tabId);
    if (pending && pending.url === details.url) pendingNavigations.delete(details.tabId);
  }
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  void handleBeforeNavigate(details);
});

// bfcache から復元された場合にもバッジを更新する。
if (chrome.webNavigation.onHistoryStateUpdated) {
  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    if (!/^https?:/i.test(details.url)) return;
    updateTabBadge(details.tabId, details.url).catch(() => {});
  });
}

/* ------------------------------------------------------------------ */
/* メッセージ                                                          */
/* ------------------------------------------------------------------ */

const respondError = (sendResponse, error) => {
  sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return undefined;
  if (sender && sender.id && sender.id !== chrome.runtime.id) return undefined;

  if (message.type === 'ANALYZE') {
    (async () => {
      const url = message.url || (sender.tab && sender.tab.url) || '';
      const current = await getSettings();
      const result = await analyzeUrlFull(url, { force: Boolean(message.force) });
      return { ok: true, result, settings: publicSettings(current) };
    })().then(sendResponse).catch((error) => respondError(sendResponse, error));
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    getSettings()
      .then((current) => sendResponse({ ok: true, settings: publicSettings(current) }))
      .catch((error) => respondError(sendResponse, error));
    return true;
  }

  if (message.type === 'SET_SETTING' || message.type === 'SET_SETTINGS') {
    (async () => {
      const patch = message.patch && typeof message.patch === 'object' ? message.patch : {};
      const next = await saveSettings(patch);
      settings = next;
      cache.clear();
      return { ok: true, settings: publicSettings(next) };
    })().then(sendResponse).catch((error) => respondError(sendResponse, error));
    return true;
  }

  if (message.type === 'ADD_WHITELIST') {
    (async () => {
      const parsed = normalizeDomainInput(message.domain);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const current = await getSettings();
      const whitelist = current.whitelist.includes(parsed.domain)
        ? current.whitelist
        : [...current.whitelist, parsed.domain];
      settings = await saveSettings({ whitelist });
      cache.clear();
      return { ok: true, whitelist: settings.whitelist };
    })().then(sendResponse).catch((error) => respondError(sendResponse, error));
    return true;
  }

  if (message.type === 'REMOVE_WHITELIST') {
    (async () => {
      const current = await getSettings();
      const domain = String(message.domain || '').toLowerCase();
      const whitelist = current.whitelist.filter((entry) => entry !== domain);
      settings = await saveSettings({ whitelist });
      cache.clear();
      return { ok: true, whitelist: settings.whitelist };
    })().then(sendResponse).catch((error) => respondError(sendResponse, error));
    return true;
  }

  if (message.type === 'BYPASS_BLOCK') {
    (async () => {
      if (message.url) await addBypass(message.url, BYPASS_TTL);
      return { ok: true };
    })().then(sendResponse).catch((error) => respondError(sendResponse, error));
    return true;
  }

  if (message.type === 'GET_TAB_URL') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => sendResponse({
        ok: true,
        url: tab ? tab.url : null,
        title: tab ? tab.title : null,
        tabId: tab ? tab.id : null,
      }))
      .catch((error) => respondError(sendResponse, error));
    return true;
  }

  return undefined;
});

/* ------------------------------------------------------------------ */
/* ライフサイクル                                                      */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener((details) => {
  (async () => {
    const current = await loadSettings();
    settings = current;
    await chrome.storage.sync.set(normalizeSettings(current));
    if (details.reason === 'install' || details.reason === 'update') {
      await refreshAllBadges();
    }
  })().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  refreshAllBadges().catch(() => {});
});

// Service Worker 起動時にも既存タブのバッジを復元する。
settingsReady.then(() => {
  refreshAllBadges().catch(() => {});
}).catch(() => {});
