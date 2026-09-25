import { bridgeGeometry } from "./geometry.js";
import { westBank } from "./map.js";

// Derived from physical materials; no second ledger or saved construction queue.
export function bridgeProject(w, bridge = w.objects.find((o) => o.type === "bridge")) {
  if (!bridge) return null;
  const g = bridgeGeometry(bridge);
  const staged = w.objects.reduce((sum, o) => sum + (
    ["log", "bone"].includes(o.type) && o.stock > 0 &&
    westBank(w, o) === westBank(w, g.a) && Math.hypot(o.x-g.a.x,o.y-g.a.y) < 8
      ? o.stock : 0), 0);
  const carried = w.creatures.reduce((sum,c) => sum + (
    c.carry > 0 && ["wood", "bones"].includes(c.cargoKind) &&
    Math.hypot(c.x-g.a.x,c.y-g.a.y) < 32 ? c.carry : 0), 0);
  const delivered = g.delivered.wood + g.delivered.bones;
  const remaining = Math.max(0, g.required - delivered);
  return { id:bridge.id, required:g.required, delivered, remaining,
    wood:g.delivered.wood, bones:g.delivered.bones, staged, carried,
    complete:g.complete, needed:Math.max(0, remaining-staged-carried) };
}
