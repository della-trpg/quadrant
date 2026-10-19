// 이미지로 내보내기 창
import { h, icon, sanitizeFileName, toast } from './util.js';
import { renderExport, canvasToBlob, THEMES } from './render.js';
import { VIEWS, VIEW_LABEL, ensureFontsFor, docTexts } from './layout.js';
import { CONFIG } from '../config.js';

export function openExportModal({ doc, chars, view, title, author, prefs, onPrefsChange }) {
  const opt = {
    view,
    theme: prefs?.theme || 'dark',
    showAuthor: prefs?.showAuthor !== false,
    showGrid: !!prefs?.showGrid,
  };
  let busy = false;
  let fontsReady = false;
  const ensureFonts = async () => {
    if (fontsReady) return;
    await ensureFontsFor(docTexts(doc, chars, [title, author ? `by ${author}` : '', CONFIG.SITE_LABEL]));
    fontsReady = true;
  };

  const previewHost = h('div', { class: 'export-preview' }, h('div', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), '미리보기 준비 중…'));
  const seg = (label, items, key) => {
    const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const paint = () => {
      for (const b of wrap.children) {
        const on = b.dataset.v === opt[key];
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    };
    for (const [v, text] of items) {
      wrap.append(h('button', { type: 'button', dataset: { v }, onclick: () => { opt[key] = v; paint(); changed(); } }, text));
    }
    paint();
    return h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), wrap);
  };
  const check = (label, key) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: opt[key], onchange: (e) => { opt[key] = e.target.checked; changed(); } }), label);

  const renderPreview = () => {
    const c = renderExport({ doc, chars, view: opt.view, theme: opt.theme, showGrid: opt.showGrid,
      showAuthor: opt.showAuthor, title, author, siteLabel: CONFIG.SITE_LABEL, pixelRatio: 0.6 });
    c.classList.add('export-canvas');
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', '내보낼 이미지 미리보기');
    previewHost.replaceChildren(c);
  };
  const changed = () => {
    if (fontsReady) renderPreview();
    onPrefsChange?.({ theme: opt.theme, showAuthor: opt.showAuthor, showGrid: opt.showGrid });
  };

  const makeFile = async () => {
    await ensureFonts();
    const c = renderExport({ doc, chars, view: opt.view, theme: opt.theme, showGrid: opt.showGrid,
      showAuthor: opt.showAuthor, title, author, siteLabel: CONFIG.SITE_LABEL, pixelRatio: 1.5 });
    const blob = await canvasToBlob(c);
    const name = `${sanitizeFileName(title)}.png`;
    return { blob, name };
  };

  const download = async () => {
    if (busy) return;
    busy = true;
    try {
      const { blob, name } = await makeFile();
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('이미지를 저장했어요.');
    } catch (e) {
      toast(e.message || '이미지를 만들지 못했어요.', 'error');
    } finally { busy = false; }
  };

  const share = async () => {
    if (busy) return;
    busy = true;
    try {
      const { blob, name } = await makeFile();
      const file = new File([blob], name, { type: 'image/png' });
      await navigator.share({ files: [file], title: title || '캐릭터 사분면' });
    } catch (e) {
      if (e?.name !== 'AbortError') toast('공유하지 못했어요. 내려받기를 써 주세요.', 'error');
    } finally { busy = false; }
  };

  const canShare = (() => {
    try { return !!navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] }); }
    catch { return false; }
  })();

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal modal-export', role: 'dialog', 'aria-modal': 'true', 'aria-label': '이미지로 내보내기' },
      h('div', { class: 'modal-head' },
        h('h2', { class: 'modal-title' }, '이미지로 내보내기'),
        h('button', { class: 'btn-icon', type: 'button', 'aria-label': '닫기', onclick: close }, icon('close'))),
      h('div', { class: 'export-body' },
        previewHost,
        h('div', { class: 'export-options' },
          seg('보기', VIEWS.map((v) => [v, VIEW_LABEL[v]]), 'view'),
          seg('테마', Object.entries(THEMES).map(([k, t]) => [k, t.label]), 'theme'),
          h('div', { class: 'field' },
            h('span', { class: 'field-label' }, '넣을 것'),
            check(author ? `만든 사람 (by ${author})` : '만든 사람', 'showAuthor'),
            check('그리드', 'showGrid')),
          h('p', { class: 'muted small' }, `오른쪽 아래에 ${CONFIG.SITE_LABEL}이 작게 들어가요.`),
          h('div', { class: 'export-actions' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: download }, icon('download'), '내려받기 (PNG)'),
            canShare ? h('button', { class: 'btn', type: 'button', onclick: share }, icon('share'), '공유하기') : null)))));

  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.btn-primary').focus();
  ensureFonts().then(renderPreview, renderPreview);
}
