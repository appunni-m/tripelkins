use crate::geometry::{BODY_RADIUS, Geometry, bridge, bridge_point, hits};
use crate::value::Point;
use std::collections::{HashMap, VecDeque};
const CELL: f64 = 0.75;
const WIDTH: usize = 112;
const JOB_RADIUS: f64 = 64.;
type Key = (i32, i32, i32, i32);
struct Field {
    ox: f64,
    oy: f64,
    costs: Vec<i16>,
}
#[derive(Default)]
pub struct Navigation {
    stamp: String,
    fields: HashMap<Key, Field>,
    order: VecDeque<Key>,
    tiles: HashMap<(i32, i32), Vec<u8>>,
    tile_order: VecDeque<(i32, i32)>,
}
impl Navigation {
    pub fn reset(&mut self, stamp: String) {
        if self.stamp != stamp {
            *self = Self {
                stamp,
                ..Self::default()
            };
        }
    }
    pub fn bytes(&self) -> usize {
        if self.fields.is_empty() {
            0
        } else {
            self.fields
                .values()
                .map(|f| f.costs.len() * 2)
                .sum::<usize>()
                + self.tiles.len() * 1024
                + WIDTH * WIDTH * 3
        }
    }
    pub fn field_count(&self) -> usize {
        self.fields.len()
    }
    pub(crate) fn import_tiles(&mut self, entries: &serde_json::Value) -> Result<(), String> {
        for pair in entries
            .as_array()
            .ok_or("Occupancy tiles must be an array")?
        {
            let key = pair[0].as_str().ok_or("Invalid occupancy tile key")?;
            let (x, y) = key.split_once(':').ok_or("Invalid occupancy tile key")?;
            let key = (
                x.parse::<i32>().map_err(|_| "Invalid occupancy tile key")?,
                y.parse::<i32>().map_err(|_| "Invalid occupancy tile key")?,
            );
            let bytes = pair[1].as_array().ok_or("Invalid occupancy tile")?;
            if bytes.len() != 1024 {
                return Err("Invalid occupancy tile length".into());
            }
            let bytes = bytes
                .iter()
                .map(|v| crate::memory::bounded(v, 0., 255.) as u8)
                .collect();
            if !self.tiles.contains_key(&key) {
                self.tile_order.push_back(key);
            }
            self.tiles.insert(key, bytes);
        }
        Ok(())
    }
    pub(crate) fn export_tiles(&self) -> serde_json::Value {
        serde_json::json!(
            self.tile_order
                .iter()
                .filter_map(|key| self
                    .tiles
                    .get(key)
                    .map(|bytes| serde_json::json!([format!("{}:{}", key.0, key.1), bytes])))
                .collect::<Vec<_>>()
        )
    }
    pub(crate) fn copy_occupancy(
        &mut self,
        g: &Geometry,
        width: usize,
        left: i32,
        top: i32,
    ) -> Vec<u8> {
        let mut grid = vec![0_u8; width * width];
        for y in 0..width {
            let gy = top + y as i32;
            let tile_y = gy.div_euclid(32);
            let local_y = gy - tile_y * 32;
            let mut x = 0;
            while x < width {
                let gx = left + x as i32;
                let tile_x = gx.div_euclid(32);
                let local_x = gx - tile_x * 32;
                let tk = (tile_x, tile_y);
                if let std::collections::hash_map::Entry::Vacant(e) = self.tiles.entry(tk) {
                    let p = Point {
                        x: f64::from(tile_x) * 32. * CELL,
                        y: f64::from(tile_y) * 32. * CELL,
                    };
                    let objects = g.obstacles(p.offset(12., 12.), 16.);
                    let mut tile = vec![0; 1024];
                    for iy in 0..32 {
                        for ix in 0..32 {
                            let q = p.offset(ix as f64 * CELL, iy as f64 * CELL);
                            tile[iy * 32 + ix] = u8::from(
                                !g.walkable(q, BODY_RADIUS)
                                    || objects.iter().any(|o| hits(q, BODY_RADIUS + 0.03, o)),
                            );
                        }
                    }
                    e.insert(tile);
                    self.tile_order.push_back(tk);
                    if self.tiles.len() > 128
                        && let Some(k) = self.tile_order.pop_front()
                    {
                        self.tiles.remove(&k);
                    }
                }
                let length = (width - x).min(32 - local_x as usize);
                let start = (local_y * 32 + local_x) as usize;
                if let Some(tile) = self.tiles.get(&tk) {
                    grid[y * width + x..y * width + x + length]
                        .copy_from_slice(&tile[start..start + length]);
                }
                x += length;
            }
        }
        grid
    }
    fn field(&mut self, g: &Geometry, target: Point, from: Point) -> &Field {
        let tx = (target.x / CELL + 0.5).floor() as i32;
        let ty = (target.y / CELL + 0.5).floor() as i32;
        let sx = if (from.x - target.x).abs() > 35. {
            (from.x - target.x).signum() as i32 * 32
        } else {
            0
        };
        let sy = if (from.y - target.y).abs() > 35. {
            (from.y - target.y).signum() as i32 * 32
        } else {
            0
        };
        let key = (tx, ty, sx, sy);
        if !self.fields.contains_key(&key) {
            let left = tx + sx - WIDTH as i32 / 2;
            let top = ty + sy - WIDTH as i32 / 2;
            let ox = f64::from(left) * CELL;
            let oy = f64::from(top) * CELL;
            let grid = self.copy_occupancy(g, WIDTH, left, top);
            let mut costs = vec![-1_i16; WIDTH * WIDTH];
            let mut start = None;
            let mut best = f64::INFINITY;
            let objects = g.obstacles(target, CELL * 3.);
            for y in WIDTH as i32 / 2 - sy - 2..=WIDTH as i32 / 2 - sy + 2 {
                for x in WIDTH as i32 / 2 - sx - 2..=WIDTH as i32 / 2 - sx + 2 {
                    let i = y as usize * WIDTH + x as usize;
                    let p = Point {
                        x: ox + f64::from(x) * CELL,
                        y: oy + f64::from(y) * CELL,
                    };
                    let d = p.distance(target);
                    if grid[i] == 0 && d < best && g.line_clear(p, target, &objects) {
                        best = d;
                        start = Some(i);
                    }
                }
            }
            if let Some(start) = start {
                let mut queue = VecDeque::with_capacity(WIDTH * 4);
                queue.push_back(start);
                costs[start] = 0;
                while let Some(at) = queue.pop_front() {
                    let x = at % WIDTH;
                    let y = at / WIDTH;
                    let neighbors = [
                        if x > 0 { Some(at - 1) } else { None },
                        if x < WIDTH - 1 { Some(at + 1) } else { None },
                        if y > 0 { Some(at - WIDTH) } else { None },
                        if y < WIDTH - 1 {
                            Some(at + WIDTH)
                        } else {
                            None
                        },
                    ];
                    for n in neighbors.into_iter().flatten() {
                        if costs[n] < 0 && grid[n] == 0 {
                            costs[n] = costs[at] + 1;
                            queue.push_back(n);
                        }
                    }
                }
            }
            self.fields.insert(key, Field { ox, oy, costs });
            self.order.push_back(key);
            if self.fields.len() > 192
                && let Some(k) = self.order.pop_front()
            {
                self.fields.remove(&k);
            }
        }
        // Insertion above establishes the key; cache entries cannot be removed
        // concurrently because this engine has one worker owner.
        &self.fields[&key]
    }
    pub fn waypoint_value(
        &mut self,
        g: &Geometry,
        c: Point,
        destination: Point,
    ) -> serde_json::Value {
        let Some(p) = self.waypoint(g, c, destination) else {
            return serde_json::Value::Null;
        };
        let mut value = p.json();
        if let Some((target, cost)) = portal(g, c, destination)
            && c.distance(target) <= JOB_RADIUS
            && p == target
        {
            let direct = g.obstacles(
                Point {
                    x: (c.x + target.x) / 2.,
                    y: (c.y + target.y) / 2.,
                },
                c.distance(target) / 2. + 4.,
            );
            if g.line_clear(c, target, &direct) {
                value["cost"] = serde_json::json!(cost);
            }
        }
        value
    }
    pub fn waypoint(&mut self, g: &Geometry, c: Point, destination: Point) -> Option<Point> {
        if destination.x.abs() > crate::terrain::WORLD_EDGE - 4. {
            return None;
        }
        let mut target = portal(g, c, destination)
            .map(|p| p.0)
            .unwrap_or(destination);
        let len = c.distance(target);
        if len > JOB_RADIUS {
            target = c.offset((target.x - c.x) * 32. / len, (target.y - c.y) * 32. / len);
            if !g.clear(target, BODY_RADIUS, None) {
                return None;
            }
        }
        let direct = g.obstacles(
            Point {
                x: (c.x + target.x) / 2.,
                y: (c.y + target.y) / 2.,
            },
            c.distance(target) / 2. + 4.,
        );
        if g.line_clear(c, target, &direct) {
            return Some(target);
        }
        let f = self.field(g, target, c);
        if c.distance(target) < 5. && g.line_clear(c, target, &direct) {
            return Some(target);
        }
        let cx = ((c.x - f.ox) / CELL + 0.5).floor() as i32;
        let cy = ((c.y - f.oy) / CELL + 0.5).floor() as i32;
        if cx < 1 || cy < 1 || cx >= WIDTH as i32 - 1 || cy >= WIDTH as i32 - 1 {
            return None;
        }
        let mut best = None;
        let mut score = f64::INFINITY;
        let connector = g.obstacles(c, CELL * 3.5 + BODY_RADIUS);
        for ring in 1_i32..=3 {
            for dy in -ring..=ring {
                for dx in -ring..=ring {
                    if ring > 1 && dx.abs().max(dy.abs()) != ring {
                        continue;
                    }
                    let x = cx + dx;
                    let y = cy + dy;
                    if x < 0 || y < 0 || x >= WIDTH as i32 || y >= WIDTH as i32 {
                        continue;
                    }
                    let cost = f.costs[y as usize * WIDTH + x as usize];
                    if cost < 0 {
                        continue;
                    }
                    let p = Point {
                        x: f.ox + f64::from(x) * CELL,
                        y: f.oy + f64::from(y) * CELL,
                    };
                    if !g.line_clear(c, p, &connector) || p.distance(c) < 0.12 {
                        continue;
                    }
                    let value = f64::from(cost) + p.distance(c) * 0.15;
                    if value < score {
                        score = value;
                        best = Some(p);
                    }
                }
            }
            if best.is_some() {
                break;
            }
        }
        best
    }
    pub fn cost(&mut self, g: &Geometry, c: Point, p: Point) -> f64 {
        let len = c.distance(p);
        if len > JOB_RADIUS {
            return f64::INFINITY;
        }
        let direct = g.obstacles(
            Point {
                x: (c.x + p.x) / 2.,
                y: (c.y + p.y) / 2.,
            },
            len / 2. + 4.,
        );
        if g.line_clear(c, p, &direct) {
            return len;
        }
        if self.waypoint(g, c, p).is_none() && len > 0.25 {
            return f64::INFINITY;
        }
        let f = self.field(g, p, c);
        let x = ((c.x - f.ox) / CELL + 0.5).floor() as i32;
        let y = ((c.y - f.oy) / CELL + 0.5).floor() as i32;
        let n = if x >= 0 && y >= 0 && x < WIDTH as i32 && y < WIDTH as i32 {
            f.costs[y as usize * WIDTH + x as usize]
        } else {
            -1
        };
        (if n >= 0 { f64::from(n) * CELL } else { len }).max(portal(g, c, p).map_or(0., |p| p.1))
    }
}
fn portal(g: &Geometry, c: Point, target: Point) -> Option<(Point, f64)> {
    let mut best = None;
    for o in g
        .objects
        .iter()
        .filter(|o| o.kind == "bridge" && bridge(o).complete)
    {
        let b = bridge(o);
        let (t, d, _, dx, dy) = bridge_point(b, c);
        let (tt, td, _, _, _) = bridge_point(b, target);
        if (0.0..=1.0).contains(&tt) && td <= b.width / 2. - BODY_RADIUS {
            return None;
        }
        let cside = t < 0.5;
        let tside = tt < 0.5;
        if cside == tside && !(t > 0.04 && t < 0.96 && d < b.width / 2.) {
            continue;
        }
        let sign = if tside { -1. } else { 1. };
        let lane = if b.width >= 2. {
            0.55_f64.min(b.width / 2. - BODY_RADIUS - 0.1)
        } else {
            0.
        };
        let start = if tside { b.b } else { b.a };
        let end = if tside { b.a } else { b.b };
        let mut bank = start.offset(-dy * lane * sign, dx * lane * sign);
        let mut exit = end.offset(-dy * lane * sign, dx * lane * sign);
        if !g.clear(bank, BODY_RADIUS, None) || !g.clear(exit, BODY_RADIUS, None) {
            let offset = [
                -lane * sign,
                0.,
                b.width / 2. - BODY_RADIUS - 0.04,
                -b.width / 2. + BODY_RADIUS + 0.04,
            ]
            .into_iter()
            .find(|v| {
                g.clear(start.offset(-dy * v, dx * v), BODY_RADIUS, None)
                    && g.clear(end.offset(-dy * v, dx * v), BODY_RADIUS, None)
            });
            let Some(offset) = offset else { continue };
            bank = start.offset(-dy * offset, dx * offset);
            exit = end.offset(-dy * offset, dx * offset);
        }
        let crossing = t > 0.04 && t < 0.96 && d < b.width / 2.;
        let point = if crossing || c.distance(bank) < 0.55 {
            exit
        } else {
            bank
        };
        let cost = (if crossing {
            c.distance(exit)
        } else {
            c.distance(bank) + exit.distance(bank)
        }) + target.distance(exit);
        if best.is_none_or(|(_, old)| cost < old) {
            best = Some((point, cost));
        }
    }
    best
}
