//! Density penalties influence planning only; they never remove residents.
use crate::{Engine, development::JsRound, value::*};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
pub const SETTLEMENT_TYPES: [&str; 7] = [
    "orchard",
    "bath",
    "roundabout",
    "dwelling",
    "theatre",
    "factory",
    "mine",
];
#[derive(Default)]
pub struct DensityIndex {
    stamp: Option<(i64, usize, u64)>,
    cells: HashMap<(i64, i64), Vec<usize>>,
    members: Vec<CachedPoint>,
    buildings: Vec<CachedPoint>,
    // A scheduler call is read-only. Decode positions once for that call while
    // retaining the original per-second bucket membership.
    positions: Option<(Vec<Point>, Vec<Point>)>,
    live_positions: Option<Vec<(Value, Point)>>,
}
struct CachedPoint {
    id: Value,
    index: usize,
    last: Point,
}
impl CachedPoint {
    fn position(&mut self, creatures: &[Value]) -> Point {
        if creatures
            .get(self.index)
            .is_none_or(|c| !same_id(&c["id"], &self.id))
        {
            if let Some(index) = creatures.iter().position(|c| same_id(&c["id"], &self.id)) {
                self.index = index;
            } else {
                // The reference cache keeps removed object references until its
                // original stamp changes, even if a birth replaces the count.
                return self.last;
            }
        }
        self.last = Point::read(&creatures[self.index]);
        self.last
    }
}
impl DensityIndex {
    pub(crate) fn clear(&mut self) {
        *self = Self::default();
    }
    fn refresh(&mut self, w: &Value) {
        let stamp = (
            (num(w, "time")).floor() as i64,
            list(w, "creatures").len(),
            num(w, "navRevision") as u64,
        );
        if self.stamp == Some(stamp) {
            return;
        }
        self.stamp = Some(stamp);
        self.cells.clear();
        self.members.clear();
        for (i, c) in list(w, "creatures").iter().enumerate() {
            self.members.push(CachedPoint {
                id: c["id"].clone(),
                index: i,
                last: Point::read(c),
            });
            self.cells
                .entry((
                    (num(c, "x") / 10.).floor() as i64,
                    (num(c, "y") / 10.).floor() as i64,
                ))
                .or_default()
                .push(i);
        }
        self.buildings = list(w, "objects")
            .iter()
            .enumerate()
            .filter(|(_, o)| SETTLEMENT_TYPES.contains(&text(o, "type")))
            .map(|(index, o)| CachedPoint {
                id: o["id"].clone(),
                index,
                last: Point::read(o),
            })
            .collect();
    }
    pub(crate) fn begin_positions(&mut self, w: &Value) -> bool {
        if self.positions.is_some() {
            return false;
        }
        // Preserve lazy bucket creation: an urgent-care plan may never request
        // density, so entering a planning scope must not establish its stamp.
        self.positions = Some((Vec::new(), Vec::new()));
        self.live_positions = Some(
            list(w, "creatures")
                .iter()
                .map(|c| (c["id"].clone(), Point::read(c)))
                .collect(),
        );
        true
    }
    pub(crate) fn end_positions(&mut self) {
        self.positions = None;
        self.live_positions = None;
    }
    pub(crate) fn has_neighbors(&self, w: &Value, c: &Value, radius: f64, count: usize) -> bool {
        let point = Point::read(c);
        if let Some(positions) = &self.live_positions {
            positions
                .iter()
                .filter(|(id, p)| !same_id(id, &c["id"]) && p.distance(point) < radius)
                .take(count)
                .count()
                >= count
        } else {
            list(w, "creatures")
                .iter()
                .filter(|o| !same_id(&o["id"], &c["id"]) && Point::read(o).distance(point) < radius)
                .take(count)
                .count()
                >= count
        }
    }
    pub(crate) fn remember_position(&mut self, c: &Value) {
        if let Some(member) = self.members.iter_mut().find(|m| same_id(&m.id, &c["id"])) {
            member.last = Point::read(c);
        }
    }
    fn residents(&mut self, w: &Value, p: Point) -> f64 {
        self.refresh(w);
        let creatures = list(w, "creatures");
        let objects = list(w, "objects");
        if self
            .positions
            .as_ref()
            .is_some_and(|(residents, buildings)| {
                residents.len() != self.members.len() || buildings.len() != self.buildings.len()
            })
        {
            self.positions = Some((
                self.members
                    .iter_mut()
                    .map(|c| c.position(creatures))
                    .collect(),
                self.buildings
                    .iter_mut()
                    .map(|o| o.position(objects))
                    .collect(),
            ));
        }
        let mut neighbors = 0;
        for x in ((p.x - 10.) / 10.).floor() as i64..=((p.x + 10.) / 10.).floor() as i64 {
            for y in ((p.y - 10.) / 10.).floor() as i64..=((p.y + 10.) / 10.).floor() as i64 {
                for index in self.cells.get(&(x, y)).into_iter().flatten() {
                    let position = match &self.positions {
                        Some((residents, _)) => residents.get(*index).copied(),
                        None => self.members.get_mut(*index).map(|c| c.position(creatures)),
                    };
                    if position.is_some_and(|c| c.distance(p) <= 10.) {
                        neighbors += 1;
                    }
                }
            }
        }
        neighbors as f64 * 100. / (std::f64::consts::PI * 100.)
    }
    fn at(&mut self, w: &Value, p: Point) -> Value {
        let residents = self.residents(w, p);
        let objects = list(w, "objects");
        let buildings = match &self.positions {
            Some((_, positions)) => positions.iter().filter(|o| o.distance(p) <= 12.).count(),
            None => self
                .buildings
                .iter_mut()
                .filter_map(|o| {
                    let position = o.position(objects);
                    (position.distance(p) <= 12.).then_some(())
                })
                .count(),
        };
        json!({"residents":residents,"buildings":buildings})
    }
}
pub fn reward(value: f64, target: f64) -> f64 {
    let ratio = (value - target) / target;
    -(if ratio >= 0. { 4. } else { 0.6 }) * ratio * ratio
}
impl Engine {
    pub fn resident_density(&self, p: Point) -> f64 {
        self.density_index.borrow_mut().residents(&self.world, p)
    }
    pub fn density_at(&self, p: Point) -> Value {
        self.density_index.borrow_mut().at(&self.world, p)
    }
    pub fn site_density(&self, p: Point) -> Value {
        let mut d = self.density_at(p);
        let excess = (num(&d, "buildings") + 1. - 3.).max(0.);
        d["reward"] = json!(reward(num(&d, "residents"), 6.) - excess * excess * 2.);
        d
    }
    pub fn density_summary(&self) -> Value {
        let mut seen = HashSet::new();
        let mut areas = Vec::new();
        for c in list(&self.world, "creatures") {
            let x = (num(c, "x") / 12.).floor();
            let y = (num(c, "y") / 12.).floor();
            if !seen.insert((x as i64, y as i64)) {
                continue;
            }
            let p = Point {
                x: x * 12. + 6.,
                y: y * 12. + 6.,
            };
            let mut a = json!({"x":p.x,"y":p.y});
            a.as_object_mut()
                .unwrap()
                .extend(self.density_at(p).as_object().unwrap().clone());
            areas.push(a);
        }
        areas.sort_by(|a, b| num(b, "residents").total_cmp(&num(a, "residents")));
        let crowded = areas
            .iter()
            .filter(|a| num(a, "residents") > 6. * 1.2)
            .count();
        areas.truncate(6);
        for a in &mut areas {
            a["residents"] = json!((num(a, "residents") * 10.).js_round() / 10.);
        }
        json!({"target":6,"abovePenalty":4,"belowPenalty":0.6,"crowded":crowded,"areas":areas})
    }
}
