import { BODY_RADIUS, hitsFootprint, nearbyObstacles, walkableSurface } from "./geometry.js";

export const NAV_CELL = 0.75;
const TILE = 32, MAX_TILES = 128;
// Occupancy is independent of the destination. Overlapping route fields reuse
// these exact grid cells until navigation topology changes. At most 128 KiB.
export function copyOccupancy(w, tiles, grid, width, left, top) {
  for (let y = 0; y < width; y++) {
    const gy = top + y, ty = Math.floor(gy / TILE), localY = gy - ty * TILE;
    for (let x = 0; x < width;) {
      const gx = left + x, tx = Math.floor(gx / TILE), localX = gx - tx * TILE;
      const key = `${tx}:${ty}`;
      let tile = tiles.get(key);
      if (!tile) {
        tile = new Uint8Array(TILE * TILE);
        const ox = tx * TILE * NAV_CELL, oy = ty * TILE * NAV_CELL;
        const obstacles = nearbyObstacles(w, ox + TILE*NAV_CELL/2, oy + TILE*NAV_CELL/2, TILE*NAV_CELL/2 + 4);
        for (let iy = 0; iy < TILE; iy++) for (let ix = 0; ix < TILE; ix++) {
          const px = ox + ix*NAV_CELL, py = oy + iy*NAV_CELL;
          tile[iy*TILE+ix] = !walkableSurface(w,px,py) ||
            obstacles.some(o=>hitsFootprint(px,py,BODY_RADIUS+0.03,o));
        }
        tiles.set(key,tile);
        if (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value);
      }
      const length = Math.min(width-x,TILE-localX), start = localY*TILE+localX;
      grid.set(tile.subarray(start,start+length),y*width+x);
      x += length;
    }
  }
}
