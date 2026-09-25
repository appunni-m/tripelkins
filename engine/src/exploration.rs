use crate::{Engine, density, development::minimum, value::*};
use serde_json::{Value, json};
pub fn scout_limit(w: &Value, policy: &str) -> usize {
    let policy = if flag(&w["directives"], "pauseWork") && policy == "expand" {
        "balanced"
    } else {
        policy
    };
    let rate = match policy {
        "expand" => 5.,
        "care" => 24.,
        _ => 12.,
    };
    ((list(w, "creatures").len() as f64 / rate).ceil() as usize).clamp(1, 64)
}
pub fn west_bank(w: &Value, p: Point) -> bool {
    p.x < crate::terrain::river_left(num(&w["map"], "seed") as u32, p.y)
}
impl Engine {
    pub fn discovery_gain(&self, p: Point) -> usize {
        let mut gain = if self.is_explored(p) { 0 } else { 2 };
        for i in 0..8 {
            let a = i as f64 * std::f64::consts::PI / 4.;
            if !self.is_explored(p.offset(a.cos() * 8., a.sin() * 8.)) {
                gain += 1;
            }
        }
        gain
    }
    pub fn frontier(&mut self, c: &Value, assignments: &[Value], policy: &str) -> Option<Value> {
        if minimum(c) < 68.
            || num(c, "sickness") > 20.
            || num(c, "carry") != 0.
            || assignments
                .iter()
                .filter(|a| text(a, "task") == "explore")
                .count()
                >= scout_limit(&self.world, policy)
        {
            return None;
        }
        let camps: Vec<_> = list(&self.world, "objects")
            .iter()
            .filter(|o| ["orchard", "dwelling"].contains(&text(o, "type")))
            .cloned()
            .collect();
        let origin = Point::read(c);
        let mut anchors = if camps.is_empty() {
            vec![c.clone()]
        } else {
            camps.clone()
        };
        anchors.sort_by(|a, b| {
            Point::read(a)
                .distance(origin)
                .total_cmp(&Point::read(b).distance(origin))
        });
        anchors.truncate(3);
        let phase = num(c, "birthOrdinal") * 2.399963;
        let mut candidates = Vec::new();
        for camp in &anchors {
            for i in 0..16 {
                let angle = phase + i as f64 * std::f64::consts::PI / 8.;
                let radii: &[f64] = if camps.is_empty() {
                    &[8., 14.]
                } else {
                    &[16., 28., 40., 52.]
                };
                for radius in radii {
                    let p = Point::read(camp).offset(angle.cos() * radius, angle.sin() * radius);
                    if origin.distance(p) > 60.
                        || (!flag(&self.world["progress"], "bridge") && !west_bank(&self.world, p))
                    {
                        continue;
                    }
                    let scope = list(&self.world["directives"], "members");
                    if self.world["directives"]["region"].is_object()
                        && (scope.is_empty() || scope.iter().any(|id| same_id(id, &c["id"])))
                        && (p.x > 42.) != (num(&self.world["directives"]["region"], "x") > 42.)
                    {
                        continue;
                    }
                    if assignments.iter().any(|a| {
                        text(a, "task") == "explore" && Point::read(&a["point"]).distance(p) < 10.
                    }) {
                        continue;
                    }
                    let gain = self.discovery_gain(p);
                    if gain > 0 {
                        let score = gain as f64 * 4. - origin.distance(p) * 0.15
                            + density::reward(self.resident_density(p), 6.);
                        candidates.push((p, score));
                    }
                }
            }
        }
        candidates.sort_by(|a, b| b.1.total_cmp(&a.1));
        let occupied: Vec<_> = assignments
            .iter()
            .map(|a| Point::read(&a["point"]))
            .collect();
        for (candidate, _) in candidates.into_iter().take(8) {
            let Some(p) = self.free_position(candidate, &occupied, 2.) else {
                continue;
            };
            if (!flag(&self.world["progress"], "bridge") && !west_bank(&self.world, p))
                || self.discovery_gain(p) == 0
            {
                continue;
            }
            let cost = self.route_cost(origin, p);
            let mut home = if camps.is_empty() {
                cost
            } else {
                f64::INFINITY
            };
            if !camps.is_empty() {
                for camp in &anchors {
                    for s in self.service_slots(camp, None) {
                        home = home.min(self.route_cost(p, Point::read(&s)));
                    }
                }
            }
            if cost.is_finite()
                && home.is_finite()
                && (cost + home) / 1.65 * 0.08 < num(c, "fed") - 45.
            {
                return Some(json!({"x":p.x,"y":p.y}));
            }
        }
        None
    }
}
