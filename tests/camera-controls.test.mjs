import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, migrateWorld } from "../src/game/state.js";
import { project } from "../src/game/geometry.js";
import { WORLD_EDGE } from "../src/game/map.js";
import { bindWorldInput, cameraViewport, cameraPoint, panCamera, zoomCamera,
  MIN_ZOOM, MAX_ZOOM } from "../src/camera-controls.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≠ ${b}`);
const pointEqual = (a, b) => { close(a.x, b.x); close(a.y, b.y); };

function harness() {
  const world = createWorld();
  world.ui.paused = true;
  const canvas = new EventTarget(), outside = new EventTarget(), captured = new Set();
  canvas.clientHeight = 720;
  canvas.setPointerCapture = (id) => captured.add(id);
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => {
    captured.delete(id);
    fire("lostpointercapture", { pointerId: id });
  };
  function fire(type, data = {}, target = canvas) {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { clientX: 640, clientY: 360, pointerId: 1, button: 0, ...data });
    target.dispatchEvent(e);
    if (type === "pointerup" && captured.has(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    return e;
  }
  const record = { taps: [], drops: [], drag: null, hit: null };
  const ui = world.ui;
  const view = () => cameraViewport(1280, 720, ui.zoom);
  const dispose = bindWorldInput(canvas, {
    point: (e) => cameraPoint(ui, view(), e.clientX, e.clientY),
    hit: () => record.hit,
    pan: (x, y) => panCamera(ui, view(), x, y),
    zoom: (factor, p) => zoomCamera(ui, 1280, 720, factor, p.x, p.y),
    canDrag: (entity) => entity?.type === "rock",
    hover: () => {},
    tap: (...args) => record.taps.push(args),
    drop: (...args) => record.drops.push(args),
    drag: (entity) => { record.drag = entity; },
  }, outside);
  return { world, ui, view, record, fire, dispose, outside, captured };
}

test("every zoom step changes the camera continuously on small, tall and wide screens", () => {
  for (const [width, height] of [[1280,720], [390,844], [640,320], [3440,1440], [8192,1280]]) {
    let last = Infinity;
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += .01) {
      const v = cameraViewport(width,height,zoom);
      assert.ok(v.viewWidth < last);
      assert.ok(v.viewWidth <= 2048 + 1e-7);
      close(v.viewWidth / width, v.viewHeight / height);
      last = v.viewWidth;
    }
  }
});

test("zoom keeps the ground beneath the pointer fixed, including at zoom limits", () => {
  const ui = { x: 24, y: 24, zoom: 1 };
  const anchor = () => cameraPoint(ui, cameraViewport(1280,720,ui.zoom), 200, 500);
  const before = anchor();
  for (const factor of [1.2, .83, 10, 10, .001, .01, 1.2]) {
    zoomCamera(ui,1280,720,factor,200,500);
    pointEqual(anchor(), before);
    assert.ok(ui.zoom >= MIN_ZOOM && ui.zoom <= MAX_ZOOM);
  }
});

test("screen picking, panning and restored camera state agree at fractional zoom", () => {
  const w = createWorld();
  Object.assign(w.ui, { x: 100000, y: -300000, zoom: 1.213 });
  const v = cameraViewport(1280,720,w.ui.zoom);
  const point = cameraPoint(w.ui,v,380,190);
  const screen = project(point.x-w.ui.x, point.y-w.ui.y);
  close(screen.x/v.pixelScale+640,380);
  close(-screen.y/v.pixelScale+360,190);
  panCamera(w.ui,v,-147,85);
  pointEqual(cameraPoint(w.ui,v,527,105),point);
  const restored = migrateWorld(w);
  pointEqual(restored.ui,w.ui);
  assert.equal(restored.ui.zoom,w.ui.zoom);
  panCamera(w.ui,v,1e20,1e20);
  assert.ok(Math.abs(w.ui.x)<=WORLD_EDGE && Math.abs(w.ui.y)<=WORLD_EDGE);
});

test("paused opening camera pans and zooms before any creature is born", () => {
  const h = harness();
  assert.equal(h.world.population,0);
  const start = { ...h.ui };
  h.fire("pointerdown");
  h.fire("pointermove", { clientX: 840 });
  h.fire("pointerup", { clientX: 840 });
  assert.notEqual(h.ui.x,start.x);
  assert.equal(h.record.taps.length,0);
  const wheel = h.fire("wheel", { deltaY: -10, deltaMode: 0 });
  assert.ok(wheel.defaultPrevented);
  assert.ok(h.ui.zoom > start.zoom);
  assert.equal(h.world.ui.paused,true);
  h.dispose();
});

test("a tap still acts once, while dragging with the meteor never fires it", () => {
  const h = harness();
  h.ui.tool = "meteor";
  h.fire("pointerdown");
  h.fire("pointermove", { clientX: 643 });
  h.fire("pointerup", { clientX: 643 });
  assert.equal(h.record.taps.length,1);
  h.fire("pointerdown");
  h.fire("pointermove", { clientX: 650 });
  h.fire("pointerup", { clientX: 650 });
  assert.equal(h.record.taps.length,1);
  h.dispose();
});

test("two-finger pinch and pan survive either finger lifting and never become a tap", () => {
  for (const released of [1,2]) {
    const h = harness();
    h.fire("pointerdown", { pointerId: 1, clientX: 500 });
    h.fire("pointerdown", { pointerId: 2, clientX: 700 });
    h.fire("pointermove", { pointerId: 2, clientX: 740 });
    close(h.ui.zoom,1.2);
    // The first finger stays anchored while the second stretches the view.
    pointEqual(cameraPoint(h.ui,h.view(),500,360),
      cameraPoint({x:24,y:24},cameraViewport(1280,720,1),500,360));
    h.fire("pointerup", { pointerId: released, clientX: released===1 ? 500 : 740 });
    const before = h.ui.x;
    const remaining = released===1 ? 2 : 1;
    h.fire("pointermove", { pointerId: remaining, clientX: remaining===1 ? 550 : 790 });
    assert.notEqual(h.ui.x,before);
    h.fire("pointerup", { pointerId: remaining });
    assert.equal(h.record.taps.length,0);
    assert.equal(h.record.drops.length,0);
    h.dispose();
  }
});

test("an unmoved two-finger gesture and a third finger cannot apply a tool", () => {
  const h = harness();
  for(const id of [1,2,3]) h.fire("pointerdown", {pointerId:id});
  for(const id of [2,3,1]) h.fire("pointerup", {pointerId:id});
  assert.equal(h.record.taps.length,0);
  h.fire("pointerdown"); h.fire("pointerup");
  assert.equal(h.record.taps.length,1);
  h.dispose();
});

test("rock dragging is preserved; right-drag pans instead and pinch cancels the rock drag", () => {
  const h = harness();
  h.record.hit = {id:"rock",type:"rock"};
  h.fire("pointerdown"); h.fire("pointermove", {clientX:700});
  assert.equal(h.record.drag,h.record.hit);
  h.fire("pointerup", {clientX:700});
  assert.equal(h.record.drops.length,1);
  assert.equal(h.ui.x,24);
  h.fire("pointerdown", {button:2}); h.fire("pointermove", {clientX:700});
  h.fire("pointerup", {button:2,clientX:700});
  assert.notEqual(h.ui.x,24);
  assert.equal(h.record.drops.length,1);
  h.fire("pointerdown"); h.fire("pointermove", {clientX:700});
  h.fire("pointerdown", {pointerId:2,clientX:800});
  assert.equal(h.record.drag,null);
  h.fire("pointerup", {pointerId:2}); h.fire("pointerup");
  assert.equal(h.record.drops.length,1);
  h.dispose();
});

test("cancel, lost capture, blur and disposal clear the gesture without stale taps", () => {
  for (const reason of ["pointercancel","lostpointercapture","blur","dispose"]) {
    const h = harness();
    h.fire("pointerdown"); h.fire("pointermove", {clientX:740});
    if(reason==="dispose") h.dispose();
    else h.fire(reason, {}, reason==="blur" ? h.outside : undefined);
    assert.equal(h.captured.size,0);
    const before = {...h.ui};
    h.fire("pointermove", {clientX:840}); h.fire("pointerup");
    assert.deepEqual(h.ui,before);
    assert.equal(h.record.taps.length,0);
    if(reason!=="dispose") {
      h.fire("pointerdown"); h.fire("pointerup");
      assert.equal(h.record.taps.length,1);
      h.dispose();
    }
  }
});

test("wheel line and page units scale correctly", () => {
  for (const [deltaY,deltaMode,pixels] of [[-1,1,-16],[-1,2,-720]]) {
    const a = harness(), b = harness();
    a.fire("wheel", {deltaY,deltaMode});
    b.fire("wheel", {deltaY:pixels,deltaMode:0});
    close(a.ui.zoom,b.ui.zoom);
    a.dispose();b.dispose();
  }
});
