export const DEFAULT_COLORS = {
  safe: '#1a7f37',
  low: '#9a6700',
  medium: '#bc4c00',
  high: '#cf222e',
  danger: '#a40e26',
};

export const LEVEL_KEYS = ['safe', 'low', 'medium', 'high', 'danger'];

export const DEFAULT_APPEARANCE = {
  theme: 'system',
  accentColor: '#0969da',
  headerColor: '#263238',
  colors: { ...DEFAULT_COLORS },
};

export const THEME_LABELS = {
  system: '端末の設定に合わせる',
  light: 'ライト',
  dark: 'ダーク',
};

export function isHex(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizeAppearance(settings = {}) {
  const colors = { ...DEFAULT_COLORS };
  const src = settings.colors && typeof settings.colors === 'object' ? settings.colors : {};
  for (const key of LEVEL_KEYS) {
    if (isHex(src[key])) colors[key] = src[key].toLowerCase();
  }
  return {
    theme: ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'system',
    accentColor: isHex(settings.accentColor) ? settings.accentColor.toLowerCase() : DEFAULT_APPEARANCE.accentColor,
    headerColor: isHex(settings.headerColor) ? settings.headerColor.toLowerCase() : DEFAULT_APPEARANCE.headerColor,
    colors,
  };
}

export function resolveTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function levelColors(settings) {
  return normalizeAppearance(settings).colors;
}

function relativeLuminance(hex) {
  const value = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function readableText(hex) {
  return relativeLuminance(hex) > 0.55 ? '#1f2328' : '#ffffff';
}

export function applyAppearance(settings, root = document.documentElement) {
  const appearance = normalizeAppearance(settings);
  const resolved = resolveTheme(appearance.theme);
  root.dataset.theme = resolved;
  root.style.setProperty('--accent', appearance.accentColor);
  root.style.setProperty('--on-accent', readableText(appearance.accentColor));
  root.style.setProperty('--header', appearance.headerColor);
  root.style.setProperty('--on-header', readableText(appearance.headerColor));
  for (const key of LEVEL_KEYS) {
    root.style.setProperty(`--${key}`, appearance.colors[key]);
  }
  return { ...appearance, resolved };
}
