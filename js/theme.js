// 사이트 화면 테마 (어둡게/밝게/흑백). 이미지 내보내기 테마(THEMES)와 같은 색을 써요.
import { THEMES } from './render.js';
import { lsSet } from './util.js';

export const THEME_KEY = 'quadrant:theme';
export const THEME_IDS = Object.keys(THEMES);

export function getTheme() {
  const t = document.documentElement.getAttribute('data-site-theme');
  return THEMES[t] ? t : 'dark';
}

export function setTheme(t) {
  if (!THEMES[t]) t = 'dark';
  document.documentElement.setAttribute('data-site-theme', t);
  const m = document.querySelector('meta[name="color-scheme"]');
  if (m) m.setAttribute('content', t === 'dark' ? 'dark' : 'light');
  lsSet(THEME_KEY, t);
  window.dispatchEvent(new CustomEvent('quadrant-theme', { detail: t }));
}
