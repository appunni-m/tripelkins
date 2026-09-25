//! Reachable service coverage and travel-versus-construction economics.
use crate::{Engine, development::*, value::*};
use serde_json::{Map, Value, json};
use std::collections::HashSet;
pub fn care_services(kind: &str) -> &'static [&'static str] {
    match kind {
        "orchard" => &["food"],
        "bath" => &["wash"],
        "roundabout" | "theatre" => &["play"],
        "dwelling" => &["food", "wash"],
        _ => &[],
    }
}
pub fn support(kind: &str) -> f64 {
    match kind {
        "orchard" => 14.,
        "bath" => 10.,
        "roundabout" => 20.,
        "dwelling" => 18.,
        "theatre" => 48.,
        _ => 0.,
    }
}
pub fn need_key(kind: &str) -> &'static str {
    match kind {
        "food" => "fed",
        "wash" => "clean",
        _ => "amused",
    }
}
pub fn care_type(kind: &str) -> &'static str {
    match kind {
        "food" => "orchard",
        "wash" => "bath",
        _ => "roundabout",
    }
}
fn round(n: f64) -> f64 {
    (n * 10.).js_round() / 10.
}
pub fn outpost_economics(v: &Value) -> Value {
    let decay = match text(v, "kind") {
        "food" => 0.08,
        "wash" => 0.05,
        _ => 0.065,
    };
    let visits = 300. * decay / 30.;
    let saved =
        num(v, "workers") * visits * 2. * (num(v, "oldDistance") - num(v, "newDistance")).max(0.)
            / 1.65;
    let build =
        32. + num(v, "wood") * 2. + num(v, "blocks") * 0.6 + num(v, "builderDistance") / 1.65;
    json!({"savedSeconds":round(saved),"buildSeconds":round(build),"netSeconds":round(saved-build),"paybackSeconds":if saved>0.{json!((300.*build/saved).ceil())}else{Value::Null}})
}
pub fn workshop_economics(v: &Value) -> Value {
    let trips = (num(v, "stock") / 3.)
        .min(num(v, "miners") * 300. / (3. + 2. * num(v, "oldDistance") / 1.65));
    let saved = trips * 2. * (num(v, "oldDistance") - num(v, "newDistance")).max(0.) / 1.65;
    let build = 32. + 24. * 2. + 150. * 0.6 + num(v, "builderDistance") / 1.65;
    json!({"savedSeconds":round(saved),"buildSeconds":round(build),"netSeconds":round(saved-build),"paybackSeconds":if saved>0.{json!((300.*build/saved).ceil())}else{Value::Null}})
}
pub fn care_summary(care: &Value) -> String {
    ["food", "wash", "play"]
        .iter()
        .map(|kind| {
            let c = &care[kind];
            format!(
                "{kind}: {} low, {} urgent, {} lack capacity, {} out of reach",
                num(c, "low"),
                num(c, "urgent"),
                num(c, "short"),
                num(c, "unserved")
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}
impl Engine {
    pub fn care_context(&mut self) -> Value {
        self.with_route_costs(|engine| engine.care_context_uncached())
    }
    fn care_context_uncached(&mut self) -> Value {
        let facilities: Vec<_> = list(&self.world, "objects")
            .iter()
            .filter(|o| support(text(o, "type")) > 0.)
            .cloned()
            .collect();
        let creatures = list(&self.world, "creatures").to_vec();
        let signature = json!([
            self.world["navRevision"],
            self.world["map"]["revision"],
            self.world["progress"]["bridge"],
            facilities
                .iter()
                .map(|o| json!([
                    o["id"],
                    o["type"],
                    o["x"],
                    o["y"],
                    o["level"],
                    num(o, "stock").floor()
                ]))
                .collect::<Vec<_>>(),
            creatures
                .iter()
                .map(|c| json!([
                    c["id"],
                    num(c, "x").floor(),
                    num(c, "y").floor(),
                    (num(c, "fed") / 5.).floor(),
                    (num(c, "clean") / 5.).floor(),
                    (num(c, "amused") / 5.).floor(),
                    c["task"],
                    c["job"]["state"]
                ]))
                .collect::<Vec<_>>()
        ]);
        if self.planning_cache.get("care-signature") == Some(&signature) {
            return self.planning_cache["care-value"].clone();
        }
        let mut result = Map::new();
        let mut demands = Map::new();
        for kind in ["food", "wash", "play"] {
            let key = need_key(kind);
            let providers: Vec<_> = facilities
                .iter()
                .filter(|o| care_services(text(o, "type")).contains(&kind))
                .cloned()
                .collect();
            let slots: Vec<_> = providers
                .iter()
                .map(|o| self.service_slots(o, None))
                .collect();
            let mut reachable: Vec<Vec<usize>> = Vec::new();
            let mut demand = vec![0.; providers.len()];
            for c in &creatures {
                let p = Point::read(c);
                let mut close: Vec<_> = providers
                    .iter()
                    .enumerate()
                    .filter(|(_, o)| Point::read(o).distance(p) <= 24.)
                    .map(|(i, o)| (i, Point::read(o).distance(p)))
                    .collect();
                close.sort_by(|a, b| a.1.total_cmp(&b.1));
                let mut places = Vec::new();
                for (i, _) in close.into_iter().take(4) {
                    if slots[i]
                        .iter()
                        .any(|s| self.route_cost(p, Point::read(s)).is_finite())
                    {
                        places.push(i);
                        demand[i] += 1.;
                    }
                }
                reachable.push(places);
            }
            let coverage: Vec<f64> = reachable
                .iter()
                .map(|a| {
                    a.iter()
                        .map(|i| {
                            support(text(&providers[*i], "type"))
                                * num(&providers[*i], "level").max(1.)
                                / demand[*i]
                        })
                        .sum::<f64>()
                        .min(1.)
                })
                .collect();
            let future: Vec<f64> = reachable
                .iter()
                .map(|a| {
                    a.iter()
                        .map(|i| {
                            support(text(&providers[*i], "type"))
                                * num(&providers[*i], "level").max(1.)
                                / (demand[*i] * 1.2)
                        })
                        .sum::<f64>()
                        .min(1.)
                })
                .collect();
            demands.insert(kind.into(),json!(creatures.iter().enumerate().map(|(i,c)|json!({"id":c["id"],"weight":1.-coverage[i]+((60.-num(c,key))/60.).max(0.)})).collect::<Vec<_>>()));
            let n = creatures.len() as f64;
            result.insert(kind.into(),json!({"facilities":providers.len(),"low":creatures.iter().filter(|c|num(c,key)<50.).count(),"urgent":creatures.iter().filter(|c|num(c,key)<35.).count(),"min":if n>0.{creatures.iter().map(|c|num(c,key)).fold(f64::INFINITY,f64::min).js_round()}else{100.},"unserved":reachable.iter().filter(|a|a.is_empty()).count(),"short":(n-coverage.iter().sum::<f64>()-1e-6).ceil().max(0.),"growthShort":(n-future.iter().sum::<f64>()-1e-6).ceil().max(0.),"stock":if kind=="food"{json!(providers.iter().filter(|o|text(o,"type")=="orchard").map(|o|num(o,"stock").floor()).sum::<f64>())}else{Value::Null}}));
        }
        let value = Value::Object(result);
        self.planning_cache
            .insert("care-signature".into(), signature);
        self.planning_cache
            .insert("care-value".into(), value.clone());
        self.planning_cache
            .insert("care-demands".into(), Value::Object(demands));
        value
    }
    pub fn care_demand(&mut self, kind: &str) -> Vec<Value> {
        self.care_context();
        let k = match kind {
            "orchard" => "food",
            "bath" => "wash",
            "roundabout" => "play",
            _ => return Vec::new(),
        };
        self.planning_cache["care-demands"][k]
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
    fn nearest_care(&mut self, p: Point, kind: &str, providers: &[Value]) -> f64 {
        let mut places: Vec<_> = providers
            .iter()
            .filter(|o| care_services(text(o, "type")).contains(&kind))
            .cloned()
            .collect();
        places.sort_by(|a, b| {
            Point::read(a)
                .distance(p)
                .total_cmp(&Point::read(b).distance(p))
        });
        let mut best = f64::INFINITY;
        for o in places.into_iter().take(4) {
            if Point::read(&o).distance(p) > 64. {
                continue;
            }
            for s in self.service_slots(&o, None).into_iter().take(3) {
                best = best.min(self.route_cost(p, Point::read(&s)));
            }
        }
        best
    }
    pub fn outpost_camps(&mut self) -> Vec<Value> {
        self.with_route_costs(|engine| engine.outpost_camps_uncached())
    }
    fn outpost_camps_uncached(&mut self) -> Vec<Value> {
        let stamp = json!([
            (num(&self.world, "time") / 5.).floor(),
            self.world["navRevision"],
            self.world["map"]["revision"],
            self.world["discovery"]["revision"],
            list(&self.world, "creatures").len(),
            self.world["commandRevision"]
        ]);
        if self.planning_cache.get("outpost-stamp") == Some(&stamp) {
            return self.planning_cache["outpost-camps"]
                .as_array()
                .cloned()
                .unwrap_or_default();
        }
        let creatures = list(&self.world, "creatures").to_vec();
        let mut bins: Vec<Value> = Vec::new();
        for c in &creatures {
            if text(c, "task") == "explore"
                || num(c, "sickness") >= 50.
                || (!list(&self.world["directives"], "members").is_empty()
                    && !list(&self.world["directives"], "members")
                        .iter()
                        .any(|id| same_id(id, &c["id"])))
            {
                continue;
            }
            let project = self.worker_project(c);
            let p = project.as_ref().unwrap_or_else(|| {
                if working(c) && c["job"]["point"].is_object() {
                    &c["job"]["point"]
                } else {
                    c
                }
            });
            if self.world["directives"]["region"].is_object()
                && (num(p, "x") > 42.) != (num(&self.world["directives"]["region"], "x") > 42.)
            {
                continue;
            }
            let idx = bins
                .iter()
                .position(|b| Point::read(b).distance(Point::read(p)) < 14.)
                .unwrap_or_else(|| {
                    bins.push(
                        json!({"x":p["x"],"y":p["y"],"type":p["type"],"members":[],"workers":0}),
                    );
                    bins.len() - 1
                });
            bins[idx]["members"]
                .as_array_mut()
                .unwrap()
                .push(c["id"].clone());
            if project.is_some() || working(c) {
                increment(&mut bins[idx], "workers", 1.);
            }
        }
        let providers: Vec<_> = list(&self.world, "objects")
            .iter()
            .chain(projects(&self.world))
            .filter(|o| !care_services(text(o, "type")).is_empty())
            .cloned()
            .collect();
        bins.retain(|b| list(b, "members").len() >= 4);
        bins.sort_by(|a, b| {
            num(b, "workers")
                .total_cmp(&num(a, "workers"))
                .then(list(b, "members").len().cmp(&list(a, "members").len()))
        });
        bins.truncate(16);
        for b in &mut bins {
            if b["type"].is_null() {
                b.as_object_mut().unwrap().remove("type");
            }
            let mut point = Point::read(b);
            if !self.clear_position(point) {
                point = self
                    .service_slots(b, None)
                    .into_iter()
                    .map(|s| Point::read(&s))
                    .find(|p| self.clear_position(*p))
                    .or_else(|| {
                        creatures
                            .iter()
                            .find(|c| {
                                list(b, "members").iter().any(|id| same_id(id, &c["id"]))
                                    && self.clear_position(Point::read(c))
                            })
                            .map(Point::read)
                    })
                    .unwrap_or(point);
            }
            b["x"] = json!(point.x);
            b["y"] = json!(point.y);
            let mut d = Map::new();
            for kind in ["food", "wash", "play"] {
                d.insert(
                    kind.into(),
                    json!(self.nearest_care(point, kind, &providers)),
                );
            }
            b["distances"] = Value::Object(d);
        }
        self.planning_cache.insert("outpost-stamp".into(), stamp);
        self.planning_cache
            .insert("outpost-camps".into(), json!(bins));
        bins
    }
    pub fn assess_outpost(
        &mut self,
        kind: &str,
        p: Point,
        builder_distance: f64,
        routed: bool,
    ) -> Value {
        if kind == "factory" {
            return self.assess_workshop(p, builder_distance, routed);
        }
        let kinds = care_services(kind);
        if kinds.is_empty() {
            return Value::Null;
        }
        let spec = building_spec(kind);
        let mut camps = self.outpost_camps();
        camps.retain(|c| Point::read(c).distance(p) <= 24.);
        camps.sort_by(|a, b| {
            Point::read(a)
                .distance(p)
                .total_cmp(&Point::read(b).distance(p))
        });
        let (mut remaining, mut saved, mut workers, mut unserved, mut round_trip) =
            (support(kind), 0., 0., 0., 0_f64);
        for c in camps {
            let n = remaining.min(list(&c, "members").len() as f64);
            if n == 0. {
                break;
            }
            let local = if routed {
                self.service_slots(&json!({"x":p.x,"y":p.y,"type":kind,"level":1}), None)
                    .iter()
                    .map(|s| self.route_cost(Point::read(&c), Point::read(s)))
                    .fold(f64::INFINITY, f64::min)
            } else {
                Point::read(&c).distance(p)
            };
            if !local.is_finite() {
                continue;
            }
            for k in kinds {
                let old = c["distances"][k].as_f64().unwrap_or(f64::INFINITY);
                if !old.is_finite() {
                    unserved += n;
                    continue;
                }
                saved += num(
                    &outpost_economics(
                        &json!({"workers":n,"oldDistance":old,"newDistance":local,"kind":k}),
                    ),
                    "savedSeconds",
                );
                round_trip = round_trip.max(2. * old / 1.65);
            }
            workers += n;
            remaining -= n;
        }
        let build = num(
            &outpost_economics(
                &json!({"kind":"food","wood":num(&spec,"wood"),"blocks":num(&spec,"cost"),"builderDistance":builder_distance}),
            ),
            "buildSeconds",
        );
        json!({"workers":workers,"unserved":unserved,"savedSeconds":round(saved),"buildSeconds":build,"netSeconds":round(saved-build),"paybackSeconds":if saved>0.{json!((300.*build/saved).ceil())}else{Value::Null},"roundTripSeconds":round_trip.ceil(),"worthwhile":workers>=4.&&(unserved>0.||saved>=build*1.25)})
    }
    fn assess_workshop(&mut self, p: Point, builder_distance: f64, routed: bool) -> Value {
        let mines: Vec<_> = list(&self.world, "objects")
            .iter()
            .filter(|o| {
                text(o, "type") == "mine"
                    && num(o, "stock") > 0.
                    && Point::read(o).distance(p) <= 28.
            })
            .take(4)
            .cloned()
            .collect();
        let factories: Vec<_> = list(&self.world, "objects")
            .iter()
            .chain(projects(&self.world))
            .filter(|o| text(o, "type") == "factory")
            .cloned()
            .collect();
        let stamp = json!([
            self.world["navRevision"],
            self.world["map"]["revision"],
            list(&self.world, "objects").len()
        ]);
        if self.planning_cache.get("delivery-stamp") != Some(&stamp) {
            self.planning_cache.insert("delivery-stamp".into(), stamp);
            self.planning_cache
                .insert("delivery-costs".into(), json!({}));
        }
        let (mut workers, mut saved, mut unserved, mut round_trip) = (0., 0., 0., 0_f64);
        let mut assigned = HashSet::new();
        for mine in mines {
            let crew: Vec<_> = list(&self.world, "creatures")
                .iter()
                .filter(|c| {
                    !assigned.contains(text(c, "id"))
                        && Point::read(c).distance(Point::read(&mine)) <= 28.
                })
                .take(4)
                .map(|c| text(c, "id").to_owned())
                .collect();
            let miners = crew.len() as f64;
            if miners == 0. {
                continue;
            }
            let Some(origin) = self.service_slots(&mine, None).first().map(Point::read) else {
                continue;
            };
            let id = text(&mine, "id");
            let old = if let Some(v) = self.planning_cache["delivery-costs"].get(id) {
                v.as_f64().unwrap_or(f64::INFINITY)
            } else {
                let mut nearby: Vec<_> = factories
                    .iter()
                    .filter(|f| Point::read(f).distance(Point::read(&mine)) <= 64.)
                    .cloned()
                    .collect();
                nearby.sort_by(|a, b| {
                    Point::read(a)
                        .distance(Point::read(&mine))
                        .total_cmp(&Point::read(b).distance(Point::read(&mine)))
                });
                let mut old = f64::INFINITY;
                for f in nearby.into_iter().take(4) {
                    for s in self.service_slots(&f, None).into_iter().take(3) {
                        old = old.min(self.route_cost(origin, Point::read(&s)));
                    }
                }
                self.planning_cache.get_mut("delivery-costs").unwrap()[id] = json!(old);
                old
            };
            let local = if routed {
                self.service_slots(&json!({"x":p.x,"y":p.y,"type":"factory","level":1}), None)
                    .iter()
                    .map(|s| self.route_cost(origin, Point::read(s)))
                    .fold(f64::INFINITY, f64::min)
            } else {
                origin.distance(p)
            };
            if !local.is_finite() {
                continue;
            }
            assigned.extend(crew);
            workers += miners;
            if !old.is_finite() {
                if num(&mine, "stock") >= 12. {
                    unserved += miners;
                }
                continue;
            }
            saved += num(
                &workshop_economics(
                    &json!({"miners":miners,"stock":mine["stock"],"oldDistance":old,"newDistance":local}),
                ),
                "savedSeconds",
            );
            round_trip = round_trip.max(2. * old / 1.65);
        }
        let build = num(
            &workshop_economics(&json!({"builderDistance":builder_distance})),
            "buildSeconds",
        );
        json!({"purpose":"ore-delivery","workers":workers,"unserved":unserved,"savedSeconds":round(saved),"buildSeconds":build,"netSeconds":round(saved-build),"paybackSeconds":if saved>0.{json!((300.*build/saved).ceil())}else{Value::Null},"roundTripSeconds":round_trip.ceil(),"worthwhile":workers>0.&&(unserved>0.||saved>=build*1.25)})
    }
    pub fn outpost_context(&mut self) -> Value {
        let mut out = Vec::new();
        for c in self.outpost_camps() {
            for kind in ["food", "wash", "play"] {
                let d = c["distances"][kind].as_f64().unwrap_or(f64::INFINITY);
                if !d.is_finite() || d > 18. {
                    out.push(json!({"at":[num(&c,"x").js_round(),num(&c,"y").js_round()],"residents":list(&c,"members").len(),"workers":c["workers"],"kind":kind,"roundTripSeconds":if d.is_finite(){json!((2.*d/1.65).ceil())}else{Value::Null},"unserved":!d.is_finite()}));
                }
            }
        }
        out.sort_by(|a, b| {
            flag(b, "unserved")
                .cmp(&flag(a, "unserved"))
                .then(num(b, "roundTripSeconds").total_cmp(&num(a, "roundTripSeconds")))
        });
        out.truncate(6);
        json!(out)
    }
}
