use crate::terrain;
use crate::value::*;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
pub const BODY_RADIUS: f64 = 0.28;
pub fn footprint(kind: &str) -> Option<(f64, f64)> {
    Some(match kind {
        "sculpture" => (0.7, 0.7),
        "tree" => (0.48, 0.48),
        "rock" => (0.55, 0.5),
        "node" => (0.65, 0.65),
        "mountain" => (3., 3.),
        "monolith" => (0.55, 0.55),
        "bath" => (0.85, 0.65),
        "orchard" => (0.6, 0.6),
        "roundabout" => (1.15, 1.15),
        "mine" => (1.3, 1.),
        "dwelling" => (1.25, 1.05),
        "factory" => (1.6, 1.4),
        "theatre" => (1.8, 1.5),
        "cannon" => (1.4, 1.3),
        _ => return None,
    })
}
fn slots(kind: &str) -> usize {
    match kind {
        "sculpture" => 2,
        "orchard" => 3,
        "roundabout" | "factory" => 5,
        "mine" | "cannon" | "cricketball" | "bridge" => 4,
        "dwelling" => 6,
        "theatre" => 12,
        _ => 1,
    }
}
#[derive(Clone, Debug)]
pub struct Object {
    pub id: String,
    pub kind: String,
    pub p: Point,
    pub level: f64,
    pub data: std::rc::Rc<Value>,
}
impl Object {
    pub fn read(v: &Value) -> Self {
        Self {
            id: text(v, "id").into(),
            kind: text(v, "type").into(),
            p: Point::read(v),
            level: if num(v, "level") == 0. {
                1.
            } else {
                num(v, "level")
            },
            data: std::rc::Rc::new(v.clone()),
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Bridge {
    pub a: Point,
    pub b: Point,
    pub width: f64,
    pub complete: bool,
}
pub fn bridge(o: &Object) -> Bridge {
    let g = &o.data["bridge"];
    Bridge {
        a: Point {
            x: g["a"]["x"].as_f64().unwrap_or(o.p.x - 3.3),
            y: g["a"]["y"].as_f64().unwrap_or(o.p.y),
        },
        b: Point {
            x: g["b"]["x"].as_f64().unwrap_or(o.p.x + 3.3),
            y: g["b"]["y"].as_f64().unwrap_or(o.p.y),
        },
        width: g["width"].as_f64().unwrap_or(2.4),
        complete: g["complete"]
            .as_bool()
            .unwrap_or(num(&o.data, "stock") >= 24.),
    }
}
pub fn bridge_point(g: Bridge, p: Point) -> (f64, f64, f64, f64, f64) {
    let dx = g.b.x - g.a.x;
    let dy = g.b.y - g.a.y;
    let length = crate::value::js_hypot(dx, dy);
    (
        ((p.x - g.a.x) * dx + (p.y - g.a.y) * dy) / (length * length),
        ((p.x - g.a.x) * dy - (p.y - g.a.y) * dx).abs() / length,
        length,
        dx / length,
        dy / length,
    )
}
pub fn hits(p: Point, r: f64, o: &Object) -> bool {
    let Some((fx, fy)) = footprint(&o.kind) else {
        return false;
    };
    let dx = ((p.x - o.p.x).abs() - fx).max(0.);
    let dy = ((p.y - o.p.y).abs() - fy).max(0.);
    dx * dx + dy * dy < r * r
}
#[derive(Default)]
struct Chunks {
    map: HashMap<(i32, i32), Vec<Object>>,
    order: VecDeque<(i32, i32)>,
}
pub struct Geometry {
    pub seed: u32,
    pub objects: Vec<Object>,
    pub creatures: Vec<(String, Point)>,
    cleared: HashMap<String, u64>,
    cells: HashMap<(i32, i32), Vec<usize>>,
    obstacles: Vec<Object>,
    chunks: RefCell<Chunks>,
}
impl Geometry {
    pub fn new(w: &Value) -> Self {
        let objects: Vec<_> = list(w, "objects").iter().map(Object::read).collect();
        let projects: Vec<_> = (!w["community"]["project"].is_null())
            .then_some(&w["community"]["project"])
            .into_iter()
            .chain(list(&w["community"], "projects").iter())
            .map(|p| {
                let mut o = Object::read(p);
                o.id = format!(
                    "construction:{}",
                    p["id"]
                        .as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| p["id"].to_string())
                );
                o
            })
            .collect();
        let obstacles: Vec<_> = objects
            .iter()
            .chain(&projects)
            .filter(|o| footprint(&o.kind).is_some())
            .cloned()
            .collect();
        let mut cells: HashMap<_, Vec<_>> = HashMap::new();
        for (i, o) in obstacles.iter().enumerate() {
            if let Some((fx, fy)) = footprint(&o.kind) {
                for x in ((o.p.x - fx) / 8.).floor() as i32..=((o.p.x + fx) / 8.).floor() as i32 {
                    for y in ((o.p.y - fy) / 8.).floor() as i32..=((o.p.y + fy) / 8.).floor() as i32
                    {
                        cells.entry((x, y)).or_default().push(i);
                    }
                }
            }
        }
        Self {
            seed: num(&w["map"], "seed") as u32,
            objects,
            creatures: list(w, "creatures")
                .iter()
                .map(|c| (text(c, "id").into(), Point::read(c)))
                .collect(),
            cleared: w["map"]["cleared"]
                .as_object()
                .map(|m| {
                    m.iter()
                        .map(|(k, v)| (k.clone(), uint(v).unwrap_or(0)))
                        .collect()
                })
                .unwrap_or_default(),
            cells,
            obstacles,
            chunks: RefCell::new(Chunks::default()),
        }
    }
    pub fn natural(&self, min: Point, max: Point) -> Vec<Object> {
        let mut out = Vec::new();
        let mut cache = self.chunks.borrow_mut();
        for cy in (min.y / 16.).floor() as i32..=(max.y / 16.).floor() as i32 {
            for cx in (min.x / 16.).floor() as i32..=(max.x / 16.).floor() as i32 {
                let key = (cx, cy);
                if let std::collections::hash_map::Entry::Vacant(e) = cache.map.entry(key) {
                    e.insert(
                        terrain::chunk(self.seed, cx, cy)
                            .iter()
                            .map(Object::read)
                            .collect(),
                    );
                    cache.order.push_back(key);
                    if cache.map.len() > 128
                        && let Some(old) = cache.order.pop_front()
                    {
                        cache.map.remove(&old);
                    }
                }
                let mask = self
                    .cleared
                    .get(&format!("{cx}:{cy}"))
                    .copied()
                    .unwrap_or(0);
                if let Some(items) = cache.map.get(&key) {
                    out.extend(
                        items
                            .iter()
                            .filter(|o| mask & (1 << (num(&o.data, "slot") as u32)) == 0)
                            .cloned(),
                    );
                }
            }
        }
        out
    }
    pub fn nearby(&self, p: Point, r: f64) -> Vec<Object> {
        self.objects
            .iter()
            .filter(|o| (o.p.x - p.x).abs() <= r && (o.p.y - p.y).abs() <= r)
            .cloned()
            .chain(
                self.natural(p.offset(-r, -r), p.offset(r, r))
                    .into_iter()
                    .filter(|o| (o.p.x - p.x).abs() <= r && (o.p.y - p.y).abs() <= r),
            )
            .collect()
    }
    pub fn obstacles(&self, p: Point, r: f64) -> Vec<Object> {
        let mut ids = std::collections::HashSet::new();
        let mut out = Vec::new();
        for x in ((p.x - r) / 8.).floor() as i32..=((p.x + r) / 8.).floor() as i32 {
            for y in ((p.y - r) / 8.).floor() as i32..=((p.y + r) / 8.).floor() as i32 {
                for i in self.cells.get(&(x, y)).into_iter().flatten() {
                    if ids.insert(*i) {
                        out.push(self.obstacles[*i].clone());
                    }
                }
            }
        }
        if p.x - r < 0. || p.y - r < 0. || p.x + r > 64. || p.y + r > 48. {
            out.extend(
                self.natural(p.offset(-r - 2., -r - 2.), p.offset(r + 2., r + 2.))
                    .into_iter()
                    .filter(|o| footprint(&o.kind).is_some()),
            );
        }
        out
    }
    pub fn bridge_at(&self, p: Point, r: f64) -> bool {
        self.objects.iter().filter(|o| o.kind == "bridge").any(|o| {
            let g = bridge(o);
            let (t, d, _, _, _) = bridge_point(g, p);
            g.complete && (0.0..=1.0).contains(&t) && d <= g.width / 2. - r
        })
    }
    pub fn walkable(&self, p: Point, r: f64) -> bool {
        if !(p.x + p.y).is_finite()
            || p.x.abs() > terrain::WORLD_EDGE - 4.
            || p.y.abs() > terrain::WORLD_EDGE - 4.
        {
            return false;
        }
        if [
            p,
            p.offset(r, 0.),
            p.offset(-r, 0.),
            p.offset(0., r),
            p.offset(0., -r),
        ]
        .iter()
        .all(|q| !terrain::water(self.seed, *q))
        {
            return true;
        }
        self.bridge_at(p, r)
    }
    pub fn clear(&self, p: Point, r: f64, ignore: Option<&str>) -> bool {
        if !self.walkable(p, r) {
            return false;
        }
        let blocked = |o: &Object| Some(o.id.as_str()) != ignore && hits(p, r, o);
        // This boolean query can visit a shared obstacle twice without changing
        // its answer; no cloned obstacle list or deduplication set is needed.
        for x in ((p.x - r) / 8.).floor() as i32..=((p.x + r) / 8.).floor() as i32 {
            for y in ((p.y - r) / 8.).floor() as i32..=((p.y + r) / 8.).floor() as i32 {
                if self
                    .cells
                    .get(&(x, y))
                    .into_iter()
                    .flatten()
                    .any(|i| blocked(&self.obstacles[*i]))
                {
                    return false;
                }
            }
        }
        if p.x - r >= 0. && p.y - r >= 0. && p.x + r <= 64. && p.y + r <= 48. {
            return true;
        }
        let min = p.offset(-r - 2., -r - 2.);
        let max = p.offset(r + 2., r + 2.);
        let mut cache = self.chunks.borrow_mut();
        for cy in (min.y / 16.).floor() as i32..=(max.y / 16.).floor() as i32 {
            for cx in (min.x / 16.).floor() as i32..=(max.x / 16.).floor() as i32 {
                let key = (cx, cy);
                if let std::collections::hash_map::Entry::Vacant(e) = cache.map.entry(key) {
                    e.insert(
                        terrain::chunk(self.seed, cx, cy)
                            .iter()
                            .map(Object::read)
                            .collect(),
                    );
                    cache.order.push_back(key);
                    if cache.map.len() > 128
                        && let Some(old) = cache.order.pop_front()
                    {
                        cache.map.remove(&old);
                    }
                }
                let mask = self
                    .cleared
                    .get(&format!("{cx}:{cy}"))
                    .copied()
                    .unwrap_or(0);
                if cache
                    .map
                    .get(&key)
                    .into_iter()
                    .flatten()
                    .any(|o| mask & (1 << (num(&o.data, "slot") as u32)) == 0 && blocked(o))
                {
                    return false;
                }
            }
        }
        true
    }
    pub fn can_place(
        &self,
        kind: &str,
        p: Point,
        ignore: Option<&str>,
        ignore_creatures: bool,
    ) -> bool {
        let (fx, fy) = footprint(kind).unwrap_or((0.4, 0.4));
        let probe = Object {
            id: String::new(),
            kind: kind.into(),
            p,
            level: 1.,
            data: std::rc::Rc::new(Value::Null),
        };
        if !ignore_creatures
            && self
                .creatures
                .iter()
                .any(|(_, q)| hits(*q, BODY_RADIUS, &probe))
        {
            return false;
        }
        for o in self.objects.iter().filter(|o| o.kind == "bridge") {
            let g = bridge(o);
            let (t, d, length, dx, dy) = bridge_point(g, p);
            let along = dx.abs() * fx + dy.abs() * fy + 1.2;
            let across = dy.abs() * fx + dx.abs() * fy + BODY_RADIUS;
            if t * length > -along && t * length < length + along && d < g.width / 2. + across {
                return false;
            }
        }
        for dx in [-fx, 0., fx] {
            for dy in [-fy, 0., fy] {
                let q = p.offset(dx, dy);
                if !terrain::ground(self.seed, q) || self.bridge_at(q, 0.) {
                    return false;
                }
            }
        }
        !self.nearby(p, 8.).iter().any(|o| {
            if Some(o.id.as_str()) == ignore || ["flowers", "stump"].contains(&o.kind.as_str()) {
                return false;
            }
            let (bx, by) = footprint(&o.kind).unwrap_or((0.28, 0.28));
            (o.p.x - p.x).abs() < fx + bx + 0.35 && (o.p.y - p.y).abs() < fy + by + 0.35
        })
    }
    pub fn service_slots(&self, o: &Object, from: Point) -> Vec<Value> {
        if o.kind == "bridge" {
            let g = bridge(o);
            let side = if from.distance(g.a) < from.distance(g.b) {
                "a"
            } else {
                "b"
            };
            let bank = if side == "a" { g.a } else { g.b };
            return [-0.95, -0.3, 0.35, 1.]
                .iter()
                .enumerate()
                .filter_map(|(i, d)| {
                    let p = bank.offset(0., *d);
                    self.clear(p, BODY_RADIUS, None)
                        .then(|| json!({"x":p.x,"y":p.y,"slot":i,"side":side}))
                })
                .collect();
        }
        let (fx, fy) = footprint(&o.kind).unwrap_or((0.2, 0.2));
        let n = (slots(&o.kind) as f64 * o.level).min(24.) as usize;
        let mut points: Vec<Value> = Vec::new();
        for i in 0..n {
            for offset in [0., 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1.] {
                let angle = 2. * std::f64::consts::PI * i as f64 / n as f64
                    + std::f64::consts::PI / 4.
                    + offset * std::f64::consts::PI / n as f64;
                let scale = 1. / angle.cos().abs().max(angle.sin().abs());
                let p = o.p.offset(
                    angle.cos() * (fx + 0.55) * scale,
                    angle.sin() * (fy + 0.55) * scale,
                );
                if self.clear(p, BODY_RADIUS, None)
                    && points.iter().all(|q| Point::read(q).distance(p) >= 0.6)
                {
                    points.push(json!({"x":p.x,"y":p.y,"slot":i}));
                    if n > 1 {
                        break;
                    }
                }
            }
        }
        if n == 1 {
            points.sort_by(|a, b| {
                Point::read(a)
                    .distance(from)
                    .total_cmp(&Point::read(b).distance(from))
            });
        }
        points
    }
    pub fn free(&self, p: Point, others: &[Point], radius: f64) -> Option<Point> {
        let mut ring = 0.;
        while ring <= radius {
            for a in 0..if ring == 0. { 1 } else { 12 } {
                let angle = a as f64 * std::f64::consts::PI / 6.;
                let q = p.offset(angle.cos() * ring, angle.sin() * ring);
                if self.clear(q, BODY_RADIUS, None)
                    && !others
                        .iter()
                        .any(|c| c.distance(q) < BODY_RADIUS * 2. + 0.06)
                {
                    return Some(q);
                }
            }
            ring += 0.65;
        }
        None
    }
    pub fn swept(&self, c: &mut Point, dx: f64, dy: f64) -> f64 {
        let n = (crate::value::js_hypot(dx, dy) / 0.14).ceil().max(1.);
        let mut moved = 0.;
        for _ in 0..n as usize {
            let old = *c;
            if self.clear(c.offset(dx / n, dy / n), BODY_RADIUS, None) {
                c.x += dx / n;
                c.y += dy / n;
            } else if self.clear(c.offset(dx / n, 0.), BODY_RADIUS, None) {
                c.x += dx / n;
            } else if self.clear(c.offset(0., dy / n), BODY_RADIUS, None) {
                c.y += dy / n;
            }
            moved += c.distance(old);
        }
        moved
    }
    pub fn line_clear(&self, a: Point, b: Point, objects: &[Object]) -> bool {
        // Conservative segment bounds avoid testing every distant obstacle at every sample.
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let possible: Vec<_> = objects
            .iter()
            .filter(|o| {
                let Some((fx, fy)) = footprint(&o.kind) else {
                    return false;
                };
                let mut lo = 0_f64;
                let mut hi = 1_f64;
                for (origin, delta, center, radius) in [
                    (a.x, dx, o.p.x, fx + BODY_RADIUS + 1e-9),
                    (a.y, dy, o.p.y, fy + BODY_RADIUS + 1e-9),
                ] {
                    if delta == 0. {
                        if (origin - center).abs() > radius {
                            return false;
                        }
                    } else {
                        let t0 = (center - radius - origin) / delta;
                        let t1 = (center + radius - origin) / delta;
                        lo = lo.max(t0.min(t1));
                        hi = hi.min(t0.max(t1));
                    }
                }
                lo <= hi
            })
            .collect();
        let n = (a.distance(b) / 0.3).ceil() as usize;
        for i in 0..=n {
            let t = i as f64 / n.max(1) as f64;
            let p = a.offset((b.x - a.x) * t, (b.y - a.y) * t);
            if !self.walkable(p, BODY_RADIUS) || possible.iter().any(|o| hits(p, BODY_RADIUS, o)) {
                return false;
            }
        }
        true
    }
}
