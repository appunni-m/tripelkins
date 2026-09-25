import { unproject } from "./game/geometry.js";
import { coordinate } from "./game/map.js";

export const MIN_ZOOM = 0.55;
export const MAX_ZOOM = 2.4;

export function cameraViewport(width, height, zoom) {
  // Keep the original pixel size at 1×, but never round away a zoom gesture.
  // Apply the wide-screen bound to the base scale so every zoom still works.
  const base = Math.max(1, Math.round(height / (width < 600 ? 360 : 430)),
    width / (2048 * MIN_ZOOM));
  const pixelScale = 1 / (base * zoom);
  return { width, height, pixelScale, viewWidth: width * pixelScale,
    viewHeight: height * pixelScale };
}

export function cameraPoint(ui, viewport, x, y) {
  const p = unproject((x - viewport.width / 2) * viewport.pixelScale,
    -(y - viewport.height / 2) * viewport.pixelScale);
  return { x: ui.x + p.x, y: ui.y + p.y };
}

export function panCamera(ui, viewport, dx, dy) {
  const delta = unproject(dx * viewport.pixelScale, -dy * viewport.pixelScale);
  ui.x = coordinate(ui.x + delta.x);
  ui.y = coordinate(ui.y + delta.y);
}

export function zoomCamera(ui, width, height, factor, x = width / 2, y = height / 2) {
  const before = cameraPoint(ui, cameraViewport(width, height, ui.zoom), x, y);
  ui.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, ui.zoom * factor));
  const after = cameraPoint(ui, cameraViewport(width, height, ui.zoom), x, y);
  ui.x = coordinate(ui.x + before.x - after.x);
  ui.y = coordinate(ui.y + before.y - after.y);
}

// Own one gesture until every pointer is released. Pinching, cancellation and
// secondary-button panning must never finish by applying a care/destruction tool.
export function bindWorldInput(canvas, actions, outside = globalThis.window) {
  const pointers = new Map(), listeners = [];
  let gesture = null;
  const listen = (target, type, handler, options) => {
    if (!target) return;
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  const position = (e) => ({ x: e.clientX, y: e.clientY });
  const pair = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  const cancel = () => {
    const ids = [...pointers.keys()];
    pointers.clear();
    gesture = null;
    actions.drag(null);
    for (const id of ids)
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  listen(canvas, "pointerdown", (e) => {
    if (e.button > 2) return;
    e.preventDefault();
    pointers.set(e.pointerId, position(e));
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      gesture = { start: position(e), entity: actions.hit(actions.point(e)),
        moved: e.button !== 0, forcePan: e.button !== 0 };
    } else {
      gesture.moved = gesture.forcePan = true;
      gesture.entity = null;
      actions.drag(null);
    }
  });
  listen(canvas, "pointermove", (e) => {
    const p = actions.point(e);
    actions.hover(p);
    if (!gesture || !pointers.has(e.pointerId)) return;
    const previous = pointers.get(e.pointerId);
    const before = pointers.size > 1 ? pair() : null;
    pointers.set(e.pointerId, position(e));
    if (before) {
      const after = pair();
      actions.pan(before.x - after.x, before.y - after.y);
      if (before.distance > 0 && after.distance > 0)
        actions.zoom(after.distance / before.distance, after);
      actions.hover(actions.point(e));
      return;
    }
    const wasMoved = gesture.moved;
    if (Math.hypot(e.clientX - gesture.start.x, e.clientY - gesture.start.y) > 6)
      gesture.moved = true;
    if (!gesture.moved) return;
    if (!gesture.forcePan && actions.canDrag(gesture.entity)) {
      actions.drag(gesture.entity, p);
    } else {
      const from = wasMoved ? previous : gesture.start;
      actions.pan(from.x - e.clientX, from.y - e.clientY);
      actions.hover(actions.point(e));
    }
  });
  listen(canvas, "pointerup", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size) {
      gesture = { start: pointers.values().next().value, entity: null,
        moved: true, forcePan: true };
      return;
    }
    const done = gesture;
    gesture = null;
    const p = actions.point(e);
    if (!done.moved) actions.tap(p, actions.hit(p));
    else if (!done.forcePan && actions.canDrag(done.entity))
      actions.drop(done.entity, actions.hit(p), p);
    actions.drag(null);
  });
  listen(canvas, "pointercancel", cancel);
  listen(canvas, "lostpointercapture", (e) => {
    if (pointers.has(e.pointerId)) cancel();
  });
  listen(outside, "blur", cancel);
  listen(canvas, "contextmenu", (e) => e.preventDefault());
  listen(canvas, "wheel", (e) => {
    e.preventDefault();
    const units = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    actions.zoom(Math.exp(-e.deltaY * units * 0.001), position(e));
    actions.hover(actions.point(e));
  }, { passive: false });
  return () => { cancel(); for (const remove of listeners) remove(); };
}
