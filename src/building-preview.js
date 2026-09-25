import { nearbyObjects } from "./game/map.js";
import { canPlace } from "./game/geometry.js";

// Presentation only: mirror the mine's deposit snap before drawing its outline.
// The authoritative worker still validates and commits the actual placement.
export function buildingPreview(world, type, point, ignore = null) {
  const deposit = type === "mine"
    ? nearbyObjects(world, point.x, point.y, 3).find(
      o => o.type === "node" && Math.hypot(o.x - point.x, o.y - point.y) < 2,
    )
    : null;
  const snapped = deposit ? { x: deposit.x, y: deposit.y } : point;
  return {
    point: snapped,
    valid: (type !== "mine" || !!deposit) &&
      canPlace(world, type, snapped, deposit?.id ?? ignore),
  };
}
