// Versioned, coordinate-seeded chunks. Exploring never appends tiles to a save.
export const CHUNK_SIZE = 16;
export const WORLD_EDGE = 1_000_000_000; // Numerical safety, not a designed map edge.
export const MAX_CHANGED_CHUNKS = 2048;
const CHUNK_CACHE = 128;
const cacheByWorld = new WeakMap();
export const coordinate = (value, fallback = 0) =>
  value != null && Number.isFinite(Number(value))
    ? Math.max(-WORLD_EDGE, Math.min(WORLD_EDGE, Number(value)))
    : fallback;
export function createMap(seed = 18492) {
  return { version: 1, seed: seed >>> 0, revision: 0, cleared: {} };
}
export function normalizeMap(raw, required = false) {
  const map = createMap();
  if (!raw && required)
    throw new Error("This saved world is missing its terrain data.");
  if (!raw) return map;
  if (raw.version !== 1)
    throw new Error("This world's terrain needs a newer game version.");
  if (
    !Number.isInteger(raw.seed) ||
    raw.seed < 0 ||
    raw.seed > 4294967295 ||
    !raw.cleared ||
    typeof raw.cleared !== "object" ||
    Array.isArray(raw.cleared)
  )
    throw new Error("This saved world's terrain data is incomplete.");
  map.seed = raw.seed;
  const entries = Object.entries(raw.cleared);
  if (entries.length > MAX_CHANGED_CHUNKS)
    throw new Error("This saved map contains too many changed regions.");
  for (const [key, mask] of entries) {
    if (
      !/^-?\d{1,8}:-?\d{1,8}$/.test(key) ||
      key
        .split(":")
        .some((v) => Math.abs(Number(v)) > WORLD_EDGE / CHUNK_SIZE) ||
      !Number.isInteger(mask) ||
      mask < 0 ||
      mask > 65535
    )
      throw new Error("This saved map has damaged terrain changes.");
    if (mask) map.cleared[key] = mask;
  }
  map.revision = Math.max(0, Math.min(1e12, Number(raw.revision) || 0));
  return map;
}
export function hash(seed, x, y, salt = 0) {
  let n =
    seed ^
    Math.imul(x, 374761393) ^
    Math.imul(y, 668265263) ^
    Math.imul(salt, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise(seed, x, y, scale) {
  const gx = Math.floor(x / scale),
    gy = Math.floor(y / scale);
  const smooth = (t) => t * t * (3 - 2 * t);
  const fx = smooth(x / scale - gx),
    fy = smooth(y / scale - gy);
  const a = hash(seed, gx, gy),
    b = hash(seed, gx + 1, gy);
  const c = hash(seed, gx, gy + 1),
    d = hash(seed, gx + 1, gy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
export const inClearing = (x, y) => x >= 0 && x < 64 && y >= 0 && y < 48;
export function riverLeft(w, y) {
  const away = Math.max(0, -y, y - 48);
  if (!away) return 40;
  return (
    40 + (noise(w.map.seed + 73, 0, y, 96) - 0.5) * 28 * Math.min(1, away / 48)
  );
}
export function isWater(w, x, y) {
  if (x < 26 || x >= 59) return false;
  const left = riverLeft(w, y);
  return x >= left && x < left + 5;
}
export const westBank = (w, p) => p.x < riverLeft(w, p.y);
export function isGround(w, x, y) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) < WORLD_EDGE - 2 &&
    Math.abs(y) < WORLD_EDGE - 2 &&
    !isWater(w, x, y)
  );
}
export function biome(w, x, y) {
  if (inClearing(x, y)) return "clearing";
  const moisture =
    noise(w.map.seed, x, y, 48) * 0.7 + noise(w.map.seed + 1, x, y, 16) * 0.3;
  return moisture > 0.6 ? "woodland" : moisture < 0.35 ? "highland" : "meadow";
}
export function chunkObjects(w, cx, cy) {
  let cache = cacheByWorld.get(w);
  if (!cache) cacheByWorld.set(w, (cache = new Map()));
  const key = `${cx}:${cy}`;
  let items = cache.get(key);
  if (items) {
    cache.delete(key);
    cache.set(key, items);
    return items;
  }
  items = [];
  for (let slot = 0; slot < 16; slot++) {
    const cellX = cx * 4 + (slot % 4),
      cellY = cy * 4 + Math.floor(slot / 4);
    const x = cellX * 4 + 1 + hash(w.map.seed, cellX, cellY, 1) * 2;
    const y = cellY * 4 + 1 + hash(w.map.seed, cellX, cellY, 2) * 2;
    if (
      inClearing(x, y) ||
      !isGround(w, x, y) ||
      Math.abs(x - riverLeft(w, y) - 2.5) < 5
    )
      continue;
    const area = biome(w, x, y),
      roll = hash(w.map.seed, cellX, cellY, 3);
    const type =
      roll < (area === "woodland" ? 0.65 : 0.18)
        ? "tree"
        : roll < (area === "highland" ? 0.55 : 0.24)
          ? "rock"
          : roll < (area === "highland" ? 0.62 : 0.27)
            ? "node"
            : roll > 0.88
              ? "flowers"
              : null;
    if (type)
      items.push({
        id: `g:${key}:${slot}`,
        chunk: key,
        slot,
        type,
        x,
        y,
        stock: type === "node" ? 100000 : 0,
        level:
          type === "node" && hash(w.map.seed, cellX, cellY, 4) > 0.8 ? 2 : 1,
        variant: Math.floor(hash(w.map.seed, cellX, cellY, 5) * 3),
        progress: 0,
      });
  }
  cache.set(key, items);
  if (cache.size > CHUNK_CACHE) cache.delete(cache.keys().next().value);
  return items;
}
const present = (w, o) => !((w.map.cleared[o.chunk] || 0) & (1 << o.slot));
export function naturalObjects(w, minX, minY, maxX, maxY) {
  const items = [];
  for (
    let cy = Math.floor(minY / CHUNK_SIZE);
    cy <= Math.floor(maxY / CHUNK_SIZE);
    cy++
  )
    for (
      let cx = Math.floor(minX / CHUNK_SIZE);
      cx <= Math.floor(maxX / CHUNK_SIZE);
      cx++
    )
      for (const o of chunkObjects(w, cx, cy)) if (present(w, o)) items.push(o);
  return items;
}
export function naturalObject(w, id) {
  const match = /^g:(-?\d{1,8}):(-?\d{1,8}):(\d{1,2})$/.exec(id || "");
  if (!match) return null;
  return (
    chunkObjects(w, Number(match[1]), Number(match[2])).find(
      (o) => o.id === id && present(w, o),
    ) || null
  );
}
export function nearbyObjects(w, x, y, radius = 5) {
  return [
    ...w.objects,
    ...naturalObjects(w, x - radius, y - radius, x + radius, y + radius),
  ].filter((o) => Math.abs(o.x - x) <= radius && Math.abs(o.y - y) <= radius);
}
export function clearNatural(w, object) {
  if (!object?.id.startsWith("g:")) return true;
  const old = w.map.cleared[object.chunk] || 0;
  if (!old && Object.keys(w.map.cleared).length >= MAX_CHANGED_CHUNKS)
    return false;
  w.map.cleared[object.chunk] = old | (1 << object.slot);
  w.map.revision++;
  return true;
}
export function naturalBlocked(w, x, y) {
  if (inClearing(x, y)) return false;
  const cx = Math.floor(x / CHUNK_SIZE),
    cy = Math.floor(y / CHUNK_SIZE);
  return chunkObjects(w, cx, cy).some(
    (o) =>
      o.type !== "flowers" &&
      Math.floor(o.x) === x &&
      Math.floor(o.y) === y &&
      present(w, o),
  );
}
export function terrainChunk(w, cx, cy, clearingCanvas) {
  const canvas = document.createElement("canvas");
  canvas.width = CHUNK_SIZE * 16;
  canvas.height = CHUNK_SIZE * 12;
  const ctx = canvas.getContext("2d");
  if (cx >= 0 && cx < 4 && cy >= 0 && cy < 3) {
    ctx.drawImage(
      clearingCanvas,
      cx * canvas.width,
      cy * canvas.height,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas;
  }
  const palettes = {
    woodland: ["#7fa878", "#89ad7b", "#91b986", "#9bc48c"],
    meadow: ["#91b986", "#9bc48c", "#b0cd99", "#89ad7b"],
    highland: ["#abae99", "#bfbaa3", "#99a18c", "#a4af96"],
  };
  for (let ty = 0; ty < CHUNK_SIZE; ty++)
    for (let tx = 0; tx < CHUNK_SIZE; tx++) {
      const x = cx * CHUNK_SIZE + tx,
        y = cy * CHUNK_SIZE + ty;
      const colors = palettes[biome(w, x, y)] || palettes.meadow;
      ctx.fillStyle = colors[0];
      ctx.fillRect(tx * 16, ty * 12, 16, 12);
      for (let n = 0; n < 5; n++) {
        ctx.fillStyle = colors[1 + (n % 3)];
        ctx.fillRect(
          tx * 16 + Math.floor(hash(w.map.seed, x, y, n + 10) * 8) * 2,
          ty * 12 + Math.floor(hash(w.map.seed, x, y, n + 20) * 6) * 2,
          2 + (n % 2) * 2,
          2,
        );
      }
    }
  // Sample the same continuous river used by placement and pathfinding.
  for (let py = 0; py < canvas.height; py += 2) {
    const left =
      (riverLeft(w, cy * CHUNK_SIZE + py / 12) - cx * CHUNK_SIZE) * 16;
    ctx.fillStyle = "#d4c4a1";
    ctx.fillRect(Math.floor(left - 16), py, 112, 2);
    ctx.fillStyle = "#75b8cb";
    ctx.fillRect(Math.floor(left), py, 80, 2);
    ctx.fillStyle = "#b5dedc";
    for (let offset = 6; offset < 75; offset += 18)
      if (py % 6 === 0) ctx.fillRect(Math.floor(left + offset), py, 5, 1);
  }
  return canvas;
}
