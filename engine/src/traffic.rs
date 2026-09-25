use crate::{
    Engine,
    geometry::{Object, bridge, bridge_point},
    value::*,
};
use serde_json::Value;
use std::collections::HashMap;
#[derive(Default)]
pub(crate) struct BridgeTraffic {
    pub waiting: HashMap<String, (i8, f64)>,
    pub direction: Option<i8>,
    pub until: f64,
}
impl Engine {
    pub(crate) fn can_enter_bridge(&mut self, c: &Value, destination: Point) -> bool {
        let time = num(&self.world, "time");
        for o in list(&self.world, "objects") {
            if text(o, "type") != "bridge" {
                continue;
            }
            let g = bridge(&Object::read(o));
            if !g.complete || g.width >= 1.7 {
                continue;
            }
            let at = bridge_point(g, Point::read(c));
            let to = bridge_point(g, destination);
            if at.0 > 0.02 && at.0 < 0.98 && at.1 < g.width / 2. {
                return true;
            }
            if (at.0 < 0.5) == (to.0 < 0.5) {
                continue;
            }
            if Point::read(c).distance(if at.0 < 0.5 { g.a } else { g.b }) > 1.8 {
                continue;
            }
            let record = self
                .sim
                .traffic
                .entry(text(o, "id").to_string())
                .or_default();
            let direction = if at.0 < 0.5 { 1 } else { -1 };
            record
                .waiting
                .entry(text(c, "id").to_string())
                .or_insert((direction, time));
            record.waiting.retain(|id, _| {
                list(&self.world, "creatures")
                    .iter()
                    .any(|c| text(c, "id") == id)
            });
            let on_deck = list(&self.world, "creatures").iter().any(|c| {
                let p = bridge_point(g, Point::read(c));
                p.0 > 0.02 && p.0 < 0.98 && p.1 < g.width / 2.
            });
            if on_deck {
                return record.direction == Some(direction) && time < record.until;
            }
            if time >= record.until || record.direction.is_none() {
                record.direction = record
                    .waiting
                    .iter()
                    .min_by(|(a, (_, at)), (b, (_, bt))| at.total_cmp(bt).then(a.cmp(b)))
                    .map(|(_, v)| v.0)
                    .or(Some(direction));
                record.until = time + 4.;
            }
            if record.direction == Some(direction) {
                record.waiting.remove(text(c, "id"));
                return true;
            }
            return false;
        }
        true
    }
}
