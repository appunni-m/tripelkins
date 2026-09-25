import { BUILDINGS, TOOLS, unlocked } from "./game/catalog.js";

// Population and resources can change on every tick. Only actual unlocks or
// selection affect the toolbar. Millions of births don't rebuild its DOM.
export function toolSignature(w) {
  return [w.ui.tool, w.ui.tab, w.stage, w.ui.held?.type, w.ui.held?.stock,
    ...Object.values({ ...BUILDINGS, ...TOOLS }).map((spec) =>
      `${!!unlocked(w, spec)}:${!spec.stage || spec.stage <= w.stage}:${!spec.flag || !!w.progress[spec.flag]}:${!spec.energy || w.progress.energy >= spec.energy}`),
  ].join("|");
}
export function htmlIfChanged(element, html) {
  if (element.__renderedHTML === html) return false;
  element.innerHTML = html;
  element.__renderedHTML = html;
  return true;
}
