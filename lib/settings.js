/**
 * 設定の既定値・正規化・保存。
 * すべての画面（background / popup / options / warning）で共有します。
 */
import { DEFAULT_APPEARANCE, normalizeAppearance } from './theme.js';
import { TOGGLEABLE_RULE_IDS } from './rules.js';
import { isIpHost, isPublicSuffix, normalizeHostname } from './psl.js';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  sensitivity: 'normal',
  whitelist: [],
  ignoreRules: [],
  enableSafeBrowsing: false,
  apiKey: '',
  blockDangerous: true,
  notifyDangerous: true,
  ...DEFAULT_APPEARANCE,
});

export const SENSITIVITY_VALUES = ['loose', 'normal', 'strict'];
export const MAX_WHITELIST = 500;

const asBoolean = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

export function normalizeWhitelist(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const result = normalizeDomainInput(entry);
    if (!result.ok || seen.has(result.domain)) continue;
    seen.add(result.domain);
    out.push(result.domain);
    if (out.length >= MAX_WHITELIST) break;
  }
  return out;
}

export function normalizeIgnoreRules(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === 'string' && TOGGLEABLE_RULE_IDS.has(id)))];
}

export function normalizeSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: asBoolean(source.enabled, DEFAULT_SETTINGS.enabled),
    sensitivity: SENSITIVITY_VALUES.includes(source.sensitivity)
      ? source.sensitivity
      : DEFAULT_SETTINGS.sensitivity,
    whitelist: normalizeWhitelist(source.whitelist),
    ignoreRules: normalizeIgnoreRules(source.ignoreRules),
    enableSafeBrowsing: asBoolean(source.enableSafeBrowsing, DEFAULT_SETTINGS.enableSafeBrowsing),
    apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : '',
    blockDangerous: asBoolean(source.blockDangerous, DEFAULT_SETTINGS.blockDangerous),
    notifyDangerous: asBoolean(source.notifyDangerous, DEFAULT_SETTINGS.notifyDangerous),
    ...normalizeAppearance(source),
  };
}

/** APIキーを除いた、画面に渡してよい設定。 */
export function publicSettings(raw = {}) {
  const settings = normalizeSettings(raw);
  const { apiKey, ...rest } = settings;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

/**
 * ユーザー入力からホワイトリスト用のドメインを正規化します。
 * URL・IDN・ワイルドカード表記を受け付けます。
 */
export function normalizeDomainInput(input) {
  let value = String(input ?? '').trim();
  if (!value) return { ok: false, error: 'ドメインを入力してください' };
  value = value.replace(/^\*\./, '').replace(/^\.+/, '');
  if (!value) return { ok: false, error: 'ドメインを入力してください' };

  let hostname;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    hostname = normalizeHostname(url.hostname);
  } catch {
    return { ok: false, error: 'ドメインの形式が正しくありません' };
  }

  if (!hostname || hostname.includes('..') || hostname.startsWith('.') || hostname.endsWith('.')) {
    return { ok: false, error: 'ドメインの形式が正しくありません' };
  }
  if (isIpHost(hostname)) {
    return { ok: false, error: 'IPアドレスはホワイトリストに登録できません' };
  }
  const labels = hostname.split('.');
  if (labels.length < 2) {
    return { ok: false, error: 'トップレベルドメインだけは登録できません' };
  }
  if (labels.some((label) => !label || label.length > 63)) {
    return { ok: false, error: 'ドメインの形式が正しくありません' };
  }
  if (!/^[a-z0-9.-]+$/.test(hostname)) {
    return { ok: false, error: '使用できない文字が含まれています' };
  }
  if (isPublicSuffix(hostname)) {
    return { ok: false, error: '「com」「co.jp」などの公開サフィックス全体は登録できません' };
  }
  return { ok: true, domain: hostname };
}

export function storageArea() {
  return globalThis.chrome && globalThis.chrome.storage ? globalThis.chrome.storage.sync : null;
}

export async function loadSettings(area = storageArea()) {
  if (!area) return normalizeSettings();
  const stored = await area.get(null);
  return normalizeSettings(stored);
}

export async function saveSettings(patch, area = storageArea()) {
  if (!area) return normalizeSettings();
  const current = await loadSettings(area);
  const next = normalizeSettings({ ...current, ...patch });
  await area.set(next);
  return next;
}

/** 変更差分を storage.onChanged から設定オブジェクトへ適用します。 */
export function applySettingsChanges(settings, changes) {
  const patch = {};
  for (const [key, change] of Object.entries(changes)) {
    if (change && Object.prototype.hasOwnProperty.call(change, 'newValue')) {
      patch[key] = change.newValue;
    }
  }
  return normalizeSettings({ ...settings, ...patch });
}

export function isWhitelisted(hostname, whitelist) {
  if (!hostname || !Array.isArray(whitelist) || whitelist.length === 0) return false;
  const host = normalizeHostname(hostname);
  for (const raw of whitelist) {
    const entry = normalizeHostname(String(raw ?? '').replace(/^\*\./, ''));
    if (!entry) continue;
    if (host === entry || host.endsWith('.' + entry)) return true;
  }
  return false;
}
