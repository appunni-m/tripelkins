// A shared viewBox keeps interface controls independent of font glyph metrics.
const paths = {
  inbox: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  menu: '<path d="M4 5h16M4 12h16M4 19h16"/>',
  play: '<path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  sound: '<path d="M10 5 5 9H2v6h3l5 4Zm4 4a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/>',
  muted: '<path d="M10 5 5 9H2v6h3l5 4Zm5 4 6 6m0-6-6 6"/>',
  journal: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M2 7h5M2 12h5M2 17h5M10 8h6M10 12h6M10 16h4"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.1M10 9h.1M14 9h.1M18 9h.1M6 12h.1M10 12h.1M14 12h.1M18 12h.1M7 16h10"/>',
  flag: '<path d="M5 21V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  home: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  care: '<path d="M12 20 3.8 12A5.3 5.3 0 0 1 12 5.4 5.3 5.3 0 0 1 20.2 12Z"/>',
  build: '<path d="m2 11 10-8 10 8M5 9v12h14V9M10 21v-7h4v7"/>',
  tools: '<path d="m4 20 9-9m-2-7 2-2 9 9-3 3-3-3-3 3-3-3 3-3Z"/>',
  previous: '<path d="m15 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="m4 15 11-11 5 5L9 20l-6 1Zm9-9 5 5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-35 12 12)"/>',
};
const markup = new Map();
export function uiIcon(name) {
  if (!paths[name]) throw new Error(`Unknown interface icon: ${name}`);
  if (!markup.has(name)) markup.set(name, `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`);
  return markup.get(name);
}
export function mountUiIcons(root) {
  for (const element of root.querySelectorAll("[data-ui-icon]")) {
    element.innerHTML = uiIcon(element.dataset.uiIcon);
  }
}
