use crate::{
    Engine,
    geometry::{Object, bridge, bridge_point},
    value::*,
};
use serde_json::Value;
use std::collections::HashMap;
#[derive(Default)]
pub(crate) struct BridgeTraffic {
    // Direction, first request, most recent request. Cancelled jobs must not
    // retain a turn indefinitely just because their resident is still alive.
    pub waiting: HashMap<String, (i8, f64, f64)>,
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
            // Passing lanes are only created for decks at least two units wide.
            if !g.complete || g.width >= 2. {
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
            let registered = self
                .sim
                .traffic
                .get(text(o, "id"))
                .is_some_and(|r| r.waiting.contains_key(text(c, "id")));
            if !registered && Point::read(c).distance(if at.0 < 0.5 { g.a } else { g.b }) > 6. {
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
                .and_modify(|v| {
                    if v.0 != direction {
                        *v = (direction, time, time);
                    } else {
                        v.2 = time;
                    }
                })
                .or_insert((direction, time, time));
            record.waiting.retain(|_, v| time - v.2 < 1.);
            let on_deck = list(&self.world, "creatures").iter().any(|c| {
                let p = bridge_point(g, Point::read(c));
                p.0 > 0.02 && p.0 < 0.98 && p.1 < g.width / 2.
            });
            if on_deck {
                let allowed = record.direction == Some(direction) && time < record.until;
                if allowed {
                    record.waiting.remove(text(c, "id"));
                }
                return allowed;
            }
            if time >= record.until || record.direction.is_none() {
                record.direction = record
                    .waiting
                    .iter()
                    .min_by(|(a, (_, at, _)), (b, (_, bt, _))| at.total_cmp(bt).then(a.cmp(b)))
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

    /// A waiting queue stands beside the approach, leaving the exit usable.
    /// This is a walking destination, never a relocation or a saved reservation.
    pub(crate) fn bridge_waiting_point(&mut self, c: &Value) -> Option<Point> {
        let id = text(c, "id");
        let mut holding = None;
        for o in list(&self.world, "objects") {
            let Some(record) = self.sim.traffic.get(text(o, "id")) else {
                continue;
            };
            let Some(&(direction, _, _)) = record.waiting.get(id) else {
                continue;
            };
            let g = bridge(&Object::read(o));
            let (_, _, _, dx, dy) = bridge_point(g, Point::read(c));
            let sign = f64::from(direction);
            let entry = if direction == 1 { g.a } else { g.b };
            let delta = Point::read(c).offset(-entry.x, -entry.y);
            // Clear the approach without sending the tail of a large queue
            // arbitrarily far backwards into occupied workplaces.
            let back = (-sign * (delta.x * dx + delta.y * dy)).max(2.4);
            let side = (sign * (-delta.x * dy + delta.y * dx)).max(1.2);
            holding = Some(entry.offset(
                -dx * sign * back - dy * sign * side,
                -dy * sign * back + dx * sign * side,
            ));
            break;
        }
        holding.filter(|p| self.clear_position(*p))
    }
}
