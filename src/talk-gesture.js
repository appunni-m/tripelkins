// Quick tap toggles recording; a deliberate hold sends on release. Kept separate
// from permission/model loading so a tap cannot cancel a pending microphone grant.
export function createTalkGesture({ start, finish, active, now = () => performance.now() }) {
  let pressed = null;
  return {
    down() {
      pressed = { at: now(), stopping: active() };
      if (!pressed.stopping) start();
    },
    up() {
      const p = pressed;
      pressed = null;
      if (p && (p.stopping || now() - p.at >= 350)) finish();
    },
    cancel() { pressed = null; },
    get pressed() { return pressed !== null; },
  };
}
