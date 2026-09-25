use crate::{
    Engine, density,
    development::*,
    exploration::west_bank,
    geometry::{Object, bridge},
    outposts::*,
    value::*,
};
use serde_json::{Value, json};
use std::collections::HashMap;
pub fn factory_input_target(o: &Value) -> f64 {
    (30. * num(o, "level").max(1.)).min(60.)
}
pub fn outpost_reason(p: &Value) -> String {
    if !flag(p, "worthwhile") {
        return String::new();
    }
    let workers = num(p, "workers");
    if text(p, "purpose") == "ore-delivery" {
        if num(p, "unserved") > 0. {
            format!("Process ore beside {workers} miners without a reachable workshop.")
        } else {
            format!(
                "Shorter ore trips for {workers} miners: save about {} worker-seconds over five minutes; repay building effort in {}s.",
                num(p, "savedSeconds").js_round(),
                num(p, "paybackSeconds")
            )
        }
    } else if num(p, "unserved") > 0. {
        format!("Local support for {workers} residents without a reachable service.")
    } else {
        format!(
            "Local support for {workers} residents: save about {} worker-seconds over five minutes; repay building effort in {}s.",
            num(p, "savedSeconds").js_round(),
            num(p, "paybackSeconds")
        )
    }
}
impl Engine {
    pub fn independent(&self) -> bool {
        text(&self.world["community"], "consent") == "accepted"
            && self.world["settings"]["autonomy"] != json!(false)
            && flag(&self.world["runtime"], "intelligenceAvailable")
            && num(&self.world, "stage") < 3.
    }
    fn scoped(&self, c: &Value) -> bool {
        (list(&self.world["directives"], "members").is_empty()
            || list(&self.world["directives"], "members")
                .iter()
                .any(|id| same_id(id, &c["id"])))
            && !flag(&self.world["directives"], "pauseWork")
    }
    fn allowed_region(&self, p: Point) -> bool {
        self.is_explored(p)
            && (flag(&self.world["progress"], "bridge") || west_bank(&self.world, p))
            && (!self.world["directives"]["region"].is_object()
                || (p.x > 42.) == (num(&self.world["directives"]["region"], "x") > 42.))
    }
    fn resource_needed(&self, p: &Value) -> bool {
        if text(p, "type") == "crossing" {
            return !flag(&self.world["progress"], "bridge");
        }
        if let Some(kind) = material(text(p, "type")) {
            num(&self.world["inventory"], kind) < num(p, "target")
        } else {
            !project_funded(&self.world, p)
        }
    }
    pub fn project_allowed(&self, c: &Value) -> bool {
        let Some(p) = worker_project(&self.world, c) else {
            return false;
        };
        let goal = list(&self.world["memory"], "goals")
            .iter()
            .find(|g| text(g, "status") == "active");
        let required = match goal.map(|g| text(g, "kind")) {
            Some("wood") => "timber",
            Some("bridge") => "crossing",
            Some("ore") => "quarry",
            _ => "",
        };
        self.independent()
            && self.scoped(c)
            && (required.is_empty()
                || text(p, "type") == required
                || CARE_BUILDINGS.contains(&text(p, "type")))
            && !(goal.is_some_and(|g| text(g, "kind") == "blocks")
                && construction(p)
                && !CARE_BUILDINGS.contains(&text(p, "type")))
    }
    pub fn project_task(&self, c: &Value) -> Option<String> {
        if !self.project_allowed(c) {
            return None;
        }
        let p = worker_project(&self.world, c)?;
        let needed = self.resource_needed(p);
        let task = match text(p, "type") {
            "crossing" => {
                if num(&self.world["inventory"], "wood") > 0. {
                    "haul"
                } else {
                    "gather"
                }
            }
            "timber" => {
                if needed {
                    "gather"
                } else {
                    return None;
                }
            }
            "quarry" => {
                if needed {
                    "quarry"
                } else {
                    return None;
                }
            }
            "refine" => {
                if !needed {
                    return None;
                } else if num(&self.world["inventory"], "ore") > 0. {
                    "refine"
                } else {
                    "quarry"
                }
            }
            _ => {
                if num(&self.world["inventory"], "wood")
                    < num(&project_requirements(&self.world, p), "wood")
                {
                    "gather"
                } else if project_funded(&self.world, p) {
                    "construct"
                } else {
                    return None;
                }
            }
        };
        Some(task.into())
    }
    pub fn local_ore(&mut self, p: &Value) -> Vec<Value> {
        let stamp = json!([
            (num(&self.world, "time") / 2.).floor(),
            self.world["navRevision"],
            self.world["map"]["revision"],
            self.world["discovery"]["revision"],
            list(&self.world, "objects").len()
        ]);
        if self.planning_cache.get("ore-stamp") != Some(&stamp) {
            self.planning_cache.insert("ore-stamp".into(), stamp);
            self.planning_cache.insert("ore-projects".into(), json!({}));
        }
        let key = crate::value::js_json(&p["id"]);
        if self.planning_cache["ore-projects"].get(&key).is_none() {
            let crew: Vec<_> = list(&self.world, "creatures")
                .iter()
                .filter(|c| list(p, "crew").iter().any(|id| same_id(id, &c["id"])))
                .cloned()
                .collect();
            let objects: Vec<_> = list(&self.world, "objects")
                .iter()
                .filter(|o| {
                    text(o, "type") == "ore"
                        && self.is_explored(Point::read(o))
                        && Point::read(o).distance(Point::read(p)) <= 32.
                })
                .cloned()
                .collect();
            let mut ids = Vec::new();
            for o in objects {
                let mut near = crew.clone();
                near.sort_by(|a, b| {
                    Point::read(a)
                        .distance(Point::read(&o))
                        .total_cmp(&Point::read(b).distance(Point::read(&o)))
                });
                if near.into_iter().take(4).any(|c| {
                    self.service_slots(&o, Some(Point::read(&c)))
                        .iter()
                        .any(|s| self.route_cost(Point::read(&c), Point::read(s)).is_finite())
                }) {
                    ids.push(o["id"].clone());
                }
            }
            self.planning_cache.get_mut("ore-projects").unwrap()[&key] = json!(ids);
        }
        let ids = self.planning_cache["ore-projects"][&key]
            .as_array()
            .cloned()
            .unwrap_or_default();
        list(&self.world, "objects")
            .iter()
            .filter(|o| {
                ids.iter().any(|id| same_id(id, &o["id"]))
                    && text(o, "type") == "ore"
                    && num(o, "stock") > 0.
            })
            .cloned()
            .collect()
    }
    pub fn refining_shortage(&mut self, p: &Value) -> f64 {
        let loose = self
            .local_ore(p)
            .iter()
            .map(|o| num(o, "stock"))
            .sum::<f64>();
        let carried = list(&self.world, "creatures")
            .iter()
            .filter(|c| {
                list(p, "crew").iter().any(|id| same_id(id, &c["id"]))
                    && text(c, "cargoKind") == "ore"
                    && !list(&self.world, "objects")
                        .iter()
                        .any(|o| same_id(&o["id"], &c["target"]) && text(o, "type") == "factory")
            })
            .map(|c| num(c, "carry"))
            .sum::<f64>();
        (((num(p, "target") - num(&self.world["inventory"], "blocks")) / 10.).ceil()
            - num(&self.world["inventory"], "ore")
            - loose
            - carried)
            .max(0.)
    }
    pub fn refining_ore_reserve(&self) -> f64 {
        let ps: Vec<_> = projects(&self.world)
            .into_iter()
            .filter(|p| text(p, "type") == "refine")
            .collect();
        let need = ps
            .iter()
            .map(|p| ((num(p, "target") - num(&self.world["inventory"], "blocks")) / 10.).ceil())
            .fold(0., f64::max);
        if self.independent() {
            need.min(ps.iter().map(|p| list(p, "crew").len() as f64).sum::<f64>())
        } else {
            0.
        }
    }
    pub fn delivery_stock(&self, kind: &str) -> f64 {
        (num(&self.world["inventory"], kind)
            - if kind == "ore" {
                self.refining_ore_reserve()
            } else {
                0.
            })
        .max(0.)
    }
    pub fn factory_input_target(&self, o: &Value) -> f64 {
        factory_input_target(o)
    }
    pub fn project_tasks(&mut self, c: &Value) -> Vec<String> {
        let Some(task) = self.project_task(c) else {
            return Vec::new();
        };
        let p = self.worker_project(c).unwrap();
        if text(&p, "type") != "refine" {
            return vec![task];
        }
        let mut tasks = Vec::new();
        if num(&self.world["inventory"], "ore") > 0. {
            tasks.push("refine".into());
        }
        if !self.local_ore(&p).is_empty() {
            tasks.push("haul".into());
        }
        if self.refining_shortage(&p) > 0. {
            tasks.push("quarry".into());
        }
        tasks
    }
    pub fn stored_supply(&self, c: &Value, o: &Value) -> Option<String> {
        let kind = text(o, "type");
        let p = if kind == "bridge" {
            bridge(&Object::read(o)).a
        } else {
            Point::read(o)
        };
        if !self.independent() || !self.scoped(c) || !self.allowed_region(p) {
            return None;
        }
        if kind == "factory"
            && num(o, "inputOre") < factory_input_target(o)
            && self.delivery_stock("ore") > 0.
            && !list(&self.world["memory"], "goals")
                .iter()
                .any(|g| text(g, "status") == "active" && text(g, "kind") == "ore")
        {
            return Some("ore".into());
        }
        if kind == "bridge"
            && !bridge(&Object::read(o)).complete
            && num(&self.world["inventory"], "wood") > 0.
            && worker_project(&self.world, c).is_some_and(|p| text(p, "type") == "crossing")
            && self.project_allowed(c)
        {
            return Some("wood".into());
        }
        None
    }
    pub fn construction_slots(&mut self, p: &Value) -> Vec<Value> {
        if !p.is_object() {
            return Vec::new();
        }
        let corners = [(-2.3, -2.3), (2.3, -2.3), (2.3, 2.3), (-2.3, 2.3)];
        let n = if construction(p) {
            4
        } else {
            list(p, "crew").len().max(4)
        };
        (0..n)
            .filter_map(|i| {
                let scale = if construction(p) {
                    1.
                } else {
                    1. + (i / 4) as f64 * 0.6
                };
                let (x, y) = corners[i % 4];
                let point = Point::read(p).offset(x * scale, y * scale);
                self.clear_position(point)
                    .then(|| json!({"x":point.x,"y":point.y,"slot":i}))
            })
            .collect()
    }
}
impl Engine {
    fn site_valid(&mut self, kind: &str, p: Point) -> bool {
        if projects(&self.world)
            .iter()
            .any(|o| Point::read(o).distance(p) < if text(o, "type") == kind { 18. } else { 6. })
        {
            return false;
        }
        let node = if kind == "mine" {
            self.nearby_objects(p, 2.).into_iter().find(|o| {
                text(o, "type") == "node"
                    && num(o, "stock") > 0.
                    && Point::read(o).distance(p) < 0.1
            })
        } else {
            None
        };
        (kind != "mine" || node.is_some())
            && self.can_place(kind, p, node.as_ref().map(|o| text(o, "id")), false)
            && (kind == "mine"
                || !list(&self.world, "objects").iter().any(|o| {
                    density::SETTLEMENT_TYPES.contains(&text(o, "type"))
                        && Point::read(o).distance(p) < 6.
                }))
    }
    fn find_sites(&mut self, kind: &str, expanding: bool) -> Vec<Value> {
        let members: Vec<_> = list(&self.world, "creatures")
            .iter()
            .filter(|c| {
                num(c, "sickness") < 50.
                    && (list(&self.world["directives"], "members").is_empty()
                        || list(&self.world["directives"], "members")
                            .iter()
                            .any(|id| same_id(id, &c["id"])))
            })
            .cloned()
            .collect();
        let builders: Vec<_> = members
            .iter()
            .filter(|c| {
                num(c, "carry") == 0.
                    && !working(c)
                    && worker_project(&self.world, c).is_none()
                    && self.scoped(c)
            })
            .cloned()
            .collect();
        if kind == "mine" {
            for c in &builders {
                for node in self
                    .nearby_objects(Point::read(c), 28.)
                    .into_iter()
                    .filter(|o| text(o, "type") == "node" && num(o, "stock") > 0.)
                {
                    let p = Point::read(&node);
                    if self.allowed_region(p)
                        && self.site_valid(kind, p)
                        && self
                            .construction_slots(&node)
                            .iter()
                            .any(|p| self.route_cost(Point::read(c), Point::read(p)).is_finite())
                    {
                        return vec![
                            json!({"x":p.x,"y":p.y,"density":self.site_density(p),"benefit":0,"travel":Point::read(c).distance(p)}),
                        ];
                    }
                }
            }
            return Vec::new();
        }
        if builders.is_empty() {
            return Vec::new();
        }
        let builder_for = |p: Point| {
            builders
                .iter()
                .min_by(|a, b| {
                    Point::read(a)
                        .distance(p)
                        .total_cmp(&Point::read(b).distance(p))
                })
                .unwrap()
                .clone()
        };
        let services: Vec<_> = list(&self.world, "objects")
            .iter()
            .filter(|o| {
                text(o, "type") == kind || (kind != "roundabout" && text(o, "type") == "dwelling")
            })
            .cloned()
            .collect();
        let demand: HashMap<_, _> = self
            .care_demand(kind)
            .iter()
            .map(|d| (text(d, "id").to_owned(), num(d, "weight")))
            .collect();
        let benefit = |p: Point| {
            members
                .iter()
                .map(|c| {
                    demand.get(text(c, "id")).copied().unwrap_or(0.)
                        * (1. - p.distance(Point::read(c)) / 20.).max(0.)
                })
                .sum::<f64>()
        };
        let workplaces: Vec<_> = list(&self.world, "objects")
            .iter()
            .filter(|o| {
                if kind == "factory" {
                    text(o, "type") == "mine" && num(o, "stock") > 0.
                } else {
                    text(o, "type") == "factory"
                }
            })
            .cloned()
            .collect();
        let mut anchors = if CARE_BUILDINGS.contains(&kind) {
            // Benefit scans the whole crew. Compute it once per resident rather
            // than twice for every sort comparison; the stable order and exact
            // arithmetic inside each score remain unchanged.
            let mut a: Vec<_> = members
                .iter()
                .map(|c| (c, benefit(Point::read(c))))
                .collect();
            a.sort_by(|a, b| b.1.total_cmp(&a.1));
            a.truncate(6);
            a.into_iter().map(|(c, _)| c.clone()).collect()
        } else if !workplaces.is_empty() {
            let nearest = |o: &Value| {
                services
                    .iter()
                    .map(|s| Point::read(s).distance(Point::read(o)))
                    .fold(80., f64::min)
            };
            let mut a = workplaces;
            a.sort_by(|a, b| nearest(b).total_cmp(&nearest(a)));
            a.truncate(4);
            a
        } else {
            let mut a = members.clone();
            a.sort_by(|a, b| {
                num(&self.site_density(Point::read(b)), "residents")
                    .total_cmp(&num(&self.site_density(Point::read(a)), "residents"))
            });
            a.truncate(3);
            a
        };
        for a in &mut anchors {
            a["builder"] = builder_for(Point::read(a));
        }
        if !care_services(kind).is_empty() {
            for mut camp in self.outpost_camps() {
                if !care_services(kind)
                    .iter()
                    .any(|k| camp["distances"][k].as_f64().unwrap_or(f64::INFINITY) > 18.)
                    || anchors
                        .iter()
                        .any(|p| Point::read(p).distance(Point::read(&camp)) < 10.)
                {
                    continue;
                }
                camp["builder"] = builder_for(Point::read(&camp));
                anchors.push(camp);
            }
        }
        if kind == "orchard" && expanding {
            let visited = list(&self.world["community"], "visited");
            for key in visited.iter().skip(visited.len().saturating_sub(12)) {
                let parts: Vec<f64> = key
                    .as_str()
                    .unwrap_or("")
                    .split(':')
                    .filter_map(|s| s.parse().ok())
                    .collect();
                if parts.len() != 2 {
                    continue;
                }
                let p = Point {
                    x: parts[0] * 8. + 4.,
                    y: parts[1] * 8. + 4.,
                };
                let builder = builder_for(p);
                if Point::read(&builder).distance(p) < 48. {
                    anchors.push(json!({"x":p.x,"y":p.y,"builder":builder}));
                }
            }
        }
        let buildings: Vec<_> = list(&self.world, "objects")
            .iter()
            .filter(|o| density::SETTLEMENT_TYPES.contains(&text(o, "type")))
            .cloned()
            .chain(self.work_projects().into_iter().filter(construction))
            .collect();
        let mut candidates = Vec::new();
        for c in anchors.into_iter().take(12) {
            for i in 0..24 {
                let angle = i as f64 * 2.399963 + num(&self.world["community"], "completed");
                let r = 7. + (i / 8) as f64 * 5.;
                let p = Point {
                    x: (num(&c, "x") + angle.cos() * r).js_round(),
                    y: (num(&c, "y") + angle.sin() * r).js_round(),
                };
                if !self.allowed_region(p)
                    || services.iter().any(|o| Point::read(o).distance(p) < 8.)
                    || buildings.iter().any(|o| Point::read(o).distance(p) < 6.)
                    || !self.can_place(kind, p, None, false)
                    || list(&self.world, "creatures")
                        .iter()
                        .any(|c| (num(c, "x") - p.x).abs() < 1.5 && (num(c, "y") - p.y).abs() < 1.5)
                {
                    continue;
                }
                let builder = &c["builder"];
                let density = self.site_density(p);
                let served = benefit(p);
                let travel = Point::read(builder).distance(p);
                if travel > 32. {
                    continue;
                }
                let outpost = self.assess_outpost(kind, p, travel, false);
                let pollution = if kind == "factory" {
                    members
                        .iter()
                        .map(|c| (1. - Point::read(c).distance(p) / 12.).max(0.))
                        .sum::<f64>()
                } else {
                    0.
                };
                let score = served * 12. + num(&density, "reward") * 3. - travel * 0.15
                    + if flag(&outpost, "worthwhile") {
                        80_f64.min(
                            num(&outpost, "netSeconds").max(0.) / 8.
                                + num(&outpost, "unserved") * 3.,
                        )
                    } else {
                        0.
                    }
                    - pollution * 3.;
                candidates.push(json!({"x":p.x,"y":p.y,"builder":builder,"benefit":served,"density":density,"travel":travel,"outpost":outpost,"score":score}));
            }
        }
        candidates.sort_by(|a, b| num(b, "score").total_cmp(&num(a, "score")));
        let mut sites: Vec<Value> = Vec::new();
        for mut p in candidates.into_iter().take(40) {
            if sites
                .iter()
                .any(|s| Point::read(s).distance(Point::read(&p)) < 10.)
            {
                continue;
            }
            let slots = self.construction_slots(&p);
            let origin = Point::read(&p["builder"]);
            if slots
                .iter()
                .any(|s| self.route_cost(origin, Point::read(s)).is_finite())
                && self
                    .service_slots(&json!({"x":p["x"],"y":p["y"],"type":kind,"level":1}), None)
                    .iter()
                    .any(|s| self.route_cost(origin, Point::read(s)).is_finite())
            {
                let distance = slots
                    .iter()
                    .map(|s| self.route_cost(origin, Point::read(s)))
                    .fold(f64::INFINITY, f64::min);
                p["outpost"] = self.assess_outpost(kind, Point::read(&p), distance, true);
                p.as_object_mut().unwrap().remove("builder");
                sites.push(p);
                if sites.len() == 3 {
                    break;
                }
            }
        }
        sites
    }
    fn resource_choice(
        &mut self,
        id: &str,
        target: f64,
        description: String,
        priority: f64,
        workers: &[Value],
    ) -> Option<Value> {
        let active: Vec<_> = self
            .work_projects()
            .into_iter()
            .filter(|p| text(p, "type") == id)
            .collect();
        if id == "crossing" && !active.is_empty() {
            return None;
        }
        let demand = ((target - num(&self.world["inventory"], material(id).unwrap())).max(0.)
            / match id {
                "refine" => 10.,
                "timber" => 6.,
                _ => 3.,
            })
        .ceil();
        let assigned = active
            .iter()
            .map(|p| list(p, "crew").len() as f64)
            .sum::<f64>();
        let limit = if id == "crossing" {
            1
        } else {
            8_usize
                .min((list(&self.world, "creatures").len() as f64 / 40.).ceil() as usize)
                .min(((demand - assigned).max(0.) / 12.).ceil() as usize)
        };
        let types = if ["timber", "crossing"].contains(&id) {
            ["tree", "log"]
        } else {
            ["rock", "ore"]
        };
        let demand_sites: Vec<_> = self
            .work_projects()
            .into_iter()
            .filter(|p| construction(p) && !project_funded(&self.world, p))
            .collect();
        let mut candidates: Vec<_> = workers
            .iter()
            .filter(|c| num(c, "carry") == 0. && !working(c) && self.allowed_region(Point::read(c)))
            .cloned()
            .collect();
        candidates.sort_by(work_order);
        let mut sources: HashMap<(i64, i64), Vec<Value>> = HashMap::new();
        let mut scored = Vec::new();
        for c in candidates {
            let cell = (
                (num(&c, "x") / 12.).floor() as i64,
                (num(&c, "y") / 12.).floor() as i64,
            );
            sources.entry(cell).or_insert_with(|| {
                self.nearby_objects(
                    Point {
                        x: cell.0 as f64 * 12. + 6.,
                        y: cell.1 as f64 * 12. + 6.,
                    },
                    38.,
                )
                .into_iter()
                .filter(|o| {
                    types.contains(&text(o, "type"))
                        && self.allowed_region(Point::read(o))
                        && (["tree", "rock"].contains(&text(o, "type")) || num(o, "stock") > 0.)
                })
                .collect()
            });
            let mut nearby: Vec<_> = sources[&cell]
                .iter()
                .filter(|o| Point::read(o).distance(Point::read(&c)) <= 32.)
                .cloned()
                .collect();
            nearby.sort_by(|a, b| {
                Point::read(a)
                    .distance(Point::read(&c))
                    .total_cmp(&Point::read(b).distance(Point::read(&c)))
            });
            let source = nearby.into_iter().take(3).find(|o| {
                self.service_slots(o, Some(Point::read(&c)))
                    .iter()
                    .any(|s| self.route_cost(Point::read(&c), Point::read(s)).is_finite())
            });
            let stocked = if id == "refine" {
                num(&self.world["inventory"], "ore") > 0.
            } else {
                id == "crossing" && num(&self.world["inventory"], "wood") > 0.
            };
            if source.is_none() && !stocked {
                continue;
            }
            let demand_distance = demand_sites
                .iter()
                .map(|p| Point::read(p).distance(Point::read(&c)))
                .fold(48., f64::min);
            let score = source
                .as_ref()
                .map_or(0., |o| Point::read(o).distance(Point::read(&c)))
                + demand_distance * 0.35;
            scored.push((c, score));
        }
        scored.sort_by(|a, b| a.1.total_cmp(&b.1).then(work_order(&a.0, &b.0)));
        let mut camps: Vec<Value> = Vec::new();
        for (c, _) in scored {
            if camps.len() >= limit {
                break;
            }
            if active
                .iter()
                .chain(&camps)
                .all(|p| Point::read(p).distance(Point::read(&c)) >= 18.)
            {
                camps.push(json!({"x":c["x"],"y":c["y"]}));
            }
        }
        let first = camps.first()?;
        Some(
            json!({"id":id,"x":first["x"],"y":first["y"],"camps":camps,"target":target,"priority":priority,"description":format!("{description} {} local crews share this target.",camps.len())}),
        )
    }
    pub fn settlement_choices(&mut self) -> Vec<Value> {
        self.with_route_costs(|engine| engine.settlement_choices_uncached())
    }
    fn settlement_choices_uncached(&mut self) -> Vec<Value> {
        let count = list(&self.world, "creatures").len();
        if !self.independent()
            || projects(&self.world).len() >= project_limit(&self.world)
            || count == 0
            || list(&self.world, "objects").len() >= 2044
            || flag(&self.world["directives"], "pauseWork")
            || num(&self.world, "time") - num(&self.world["community"], "lastProjectAt")
                < (development_interval(&self.world) / 3.).max(1.)
        {
            return Vec::new();
        }
        let goal = self.active_goal();
        let milestone = colony_milestone(&self.world);
        let industry = industry_milestone(&self.world);
        let care = self.care_context();
        let plan = self.development_plan();
        let workers: Vec<_> = list(&self.world, "creatures")
            .iter()
            .filter(|c| {
                self.scoped(c)
                    && num(c, "sickness") < 50.
                    && worker_project(&self.world, c).is_none()
            })
            .cloned()
            .collect();
        if !workers.iter().any(|c| self.allowed_region(Point::read(c))) {
            return Vec::new();
        }
        let mut choices = Vec::new();
        if let Some(g) = &goal {
            let kind = text(g, "kind");
            let target = num(g, "target");
            let request = match kind {
                "wood" => Some((
                    "timber",
                    format!(
                        "Cut trees and gather logs until we store {target} wood, as requested."
                    ),
                )),
                "ore" => Some((
                    "quarry",
                    format!(
                        "Break rocks and collect ore until we store {target} ore, as requested. Keep the ore."
                    ),
                )),
                "bridge" if !flag(&self.world["progress"], "bridge") => Some((
                    "crossing",
                    "Cut timber and carry stored wood to finish the river bridge.".into(),
                )),
                _ => None,
            };
            if let Some((id, description)) = request
                && let Some(c) = self.resource_choice(
                    id,
                    if id == "crossing" { 24. } else { target },
                    description,
                    100.,
                    &workers,
                )
            {
                choices.push(c);
            }
        }
        let resource_goal = !milestone.is_null()
            || goal
                .as_ref()
                .is_some_and(|g| ["wood", "ore", "bridge", "blocks"].contains(&text(g, "kind")));
        let outposts = self.outpost_context();
        for kind in INDEPENDENT_BUILDINGS {
            let spec = building_spec(kind);
            if !unlocked(&self.world, kind)
                || num(&spec, "cost") > 0. && uncommitted_blocks(&self.world) < num(&spec, "cost")
                || kind == "factory" && flag(&self.world["directives"], "avoidPollution")
                || resource_goal && !CARE_BUILDINGS.contains(&kind)
            {
                continue;
            }
            let existing = list(&self.world, "objects")
                .iter()
                .filter(|o| text(o, "type") == kind && (kind != "mine" || num(o, "stock") > 0.))
                .count()
                + projects(&self.world)
                    .iter()
                    .filter(|p| text(p, "type") == kind)
                    .count();
            let status = match kind {
                "orchard" => Some(&care["food"]),
                "bath" => Some(&care["wash"]),
                "roundabout" => Some(&care["play"]),
                _ => None,
            };
            if !CARE_BUILDINGS.contains(&kind) {
                let needed = (count as f64
                    / match kind {
                        "mine" => 32.,
                        "factory" => 48.,
                        "dwelling" => 24.,
                        _ => 64.,
                    })
                .ceil();
                if existing as f64 >= needed {
                    continue;
                }
                if kind == "mine" {
                    let processors = list(&self.world, "objects")
                        .iter()
                        .filter(|o| text(o, "type") == "factory")
                        .count()
                        + projects(&self.world)
                            .iter()
                            .filter(|p| text(p, "type") == "factory")
                            .count();
                    let matched = (processors as f64 * (5. * 3. / 2.8) / (4. * 3. / 3.))
                        .ceil()
                        .max(1.);
                    if existing as f64 >= matched {
                        continue;
                    }
                }
                if kind == "theatre" && count < 40 {
                    continue;
                }
            } else {
                let s = status.unwrap();
                let strained = num(s, "low") > count as f64 / 4.;
                let expansion = kind == "orchard" && flag(&plan, "expanding");
                let gap = outposts
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|c| care_services(kind).contains(&text(c, "kind")));
                if resource_goal && num(s, "urgent") == 0. && !strained && !gap {
                    continue;
                }
                if num(s, "short") == 0.
                    && num(s, "growthShort") == 0.
                    && !strained
                    && !expansion
                    && !gap
                    || existing as f64 >= (count as f64 / 4.).ceil()
                {
                    continue;
                }
            }
            let priority = if let Some(s) = status {
                (if existing == 0 && num(s, "unserved") > 0. {
                    100.
                } else if num(s, "low") > count as f64 / 4. {
                    80.
                } else if num(s, "short") > 0. {
                    70.
                } else if num(s, "growthShort") > 0. {
                    60.
                } else if kind == "orchard" && flag(&plan, "expanding") {
                    56.
                } else {
                    30.
                }) + 15_f64.min(num(s, "urgent") + num(s, "short") / count as f64 * 10.)
            } else if ["mine", "factory"].contains(&kind) {
                if !industry.is_null() {
                    if kind == "factory" { 90. } else { 85. }
                } else {
                    55.
                }
            } else {
                40.
            };
            let sites = self.find_sites(kind, flag(&plan, "expanding"));
            if let Some(point) = sites.first() {
                let mut c = point.clone();
                c["id"] = json!(kind);
                c["sites"] = json!(sites);
                c["cost"] = building_materials(kind);
                c["priority"] = json!(priority.max(if flag(&point["outpost"], "worthwhile") {
                    78.
                } else {
                    0.
                }));
                c["description"] = json!(format!(
                    "Build {}: {} now{}; costs {}. {} Gather missing timber before construction. {}",
                    building_name(kind),
                    existing,
                    status.map_or(String::new(), |s| format!(
                        "; {} low, {} residents lack nearby capacity, {} out of reach",
                        num(s, "low"),
                        num(s, "short"),
                        num(s, "unserved")
                    )),
                    building_cost(kind),
                    outpost_reason(&point["outpost"]),
                    text(&spec, "help")
                ));
                choices.push(c);
            }
        }
        if !resource_goal
            && !flag(&self.world["progress"], "bridge")
            && list(&self.world, "objects")
                .iter()
                .any(|o| text(o, "type") == "bridge")
            && let Some(c) = self.resource_choice(
                "crossing",
                24.,
                "Gather timber and carry wood to finish the bridge, opening the other bank.".into(),
                if goal.is_some() { 100. } else { 60. },
                &workers,
            )
        {
            choices.push(c);
        }
        let has_factory = list(&self.world, "objects")
            .iter()
            .any(|o| text(o, "type") == "factory");
        if !industry.is_null()
            && has_factory
            && !list(&self.world, "objects")
                .iter()
                .any(|o| text(o, "type") == "mine" && num(o, "stock") > 0.)
            && num(&self.world["inventory"], "ore") < 12.
            && let Some(c) = self.resource_choice(
                "quarry",
                12_f64.max((count as f64 / 8.).ceil()),
                "Supply our stone workshops with real ore while we establish stocked mines.".into(),
                80.,
                &workers,
            )
        {
            choices.push(c);
        }
        if !resource_goal
            && num(&self.world, "stage") >= 2.
            && !has_factory
            && num(&self.world["inventory"], "blocks") < 300.
            || goal.as_ref().is_some_and(|g| text(g, "kind") == "blocks")
            || text(&milestone, "project") == "refine"
        {
            let target = goal
                .as_ref()
                .filter(|g| text(g, "kind") == "blocks")
                .map_or(300., |g| num(g, "target"));
            if let Some(c)=self.resource_choice("refine",target,"Break rocks, collect ore and work it into blocks by hand. Reach the factory unlock without help from the sky.".into(),if goal.is_some()||!milestone.is_null(){100.}else if !industry.is_null(){90.}else{50.},&workers){choices.push(c);}
        } else if !industry.is_null()
            && uncommitted_blocks(&self.world) < 150.
            && ((list(&self.world, "objects")
                .iter()
                .filter(|o| text(o, "type") == "factory")
                .count()
                + projects(&self.world)
                    .iter()
                    .filter(|p| text(p, "type") == "factory")
                    .count()) as f64)
                < (count as f64 / 48.).ceil()
        {
            let target =
                num(&self.world["inventory"], "blocks") - uncommitted_blocks(&self.world) + 300.;
            let priority = if list(&self.world, "objects")
                .iter()
                .any(|o| text(o, "type") == "mine" && num(o, "stock") > 0.)
                && !has_factory
            {
                90.
            } else {
                75.
            };
            if let Some(c)=self.resource_choice("refine",target,"Make a building reserve of 300 uncommitted blocks so idle neighborhoods can establish more workplaces.".into(),priority,&workers){choices.push(c);}
        }
        let reserve = timber_reserve(&self.world);
        if flag(&reserve, "refill")
            && !choices.iter().any(|c| {
                ["crossing", "refine"].contains(&text(c, "id"))
                    || CARE_BUILDINGS.contains(&text(c, "id")) && num(c, "priority") >= 80.
            })
        {
            let description = format!(
                "Replenish building timber: {} wood stored, below the {} minimum. Collect loose logs or cut trees until {} wood is ready for upcoming buildings.",
                num(&reserve, "stock"),
                num(&reserve, "minimum"),
                num(&reserve, "target")
            );
            if let Some(c) = self.resource_choice(
                "timber",
                num(&reserve, "target"),
                description,
                75.,
                &workers,
            ) {
                choices.push(c);
            }
        }
        choices.sort_by(|a, b| num(b, "priority").total_cmp(&num(a, "priority")));
        choices.truncate(8);
        choices
    }
}
impl Engine {
    pub fn start_settlement(&mut self, choice: &Value, source: &str) -> bool {
        let started = self.start_project(choice, source);
        if started
            && RESOURCE_PROJECTS.contains(&text(choice, "id"))
            && text(choice, "id") != "crossing"
        {
            for camp in list(choice, "camps").iter().skip(1).take(7) {
                let mut c = choice.clone();
                c["x"] = camp["x"].clone();
                c["y"] = camp["y"].clone();
                c.as_object_mut().unwrap().remove("camps");
                self.start_project(&c, source);
            }
        }
        started
    }
    fn start_project(&mut self, choice: &Value, source: &str) -> bool {
        let kind = text(choice, "id");
        if kind == "clearance" {
            return self.start_clearance(choice, source);
        }
        let p = Point::read(choice);
        if !self.independent()
            || projects(&self.world).len() >= project_limit(&self.world)
            || !INDEPENDENT_BUILDINGS.contains(&kind) && !RESOURCE_PROJECTS.contains(&kind)
            || flag(&self.world["directives"], "pauseWork")
            || list(&self.world, "objects").len() >= 2044
            || !self.allowed_region(p)
            || INDEPENDENT_BUILDINGS.contains(&kind)
                && (!unlocked(&self.world, kind)
                    || uncommitted_blocks(&self.world) < num(&building_spec(kind), "cost")
                    || !self.site_valid(kind, p))
            || kind == "factory" && flag(&self.world["directives"], "avoidPollution")
        {
            return false;
        }
        let goal = self.active_goal();
        let required = match goal.as_ref().map(|g| text(g, "kind")) {
            Some("wood") => "timber",
            Some("bridge") => "crossing",
            Some("ore") => "quarry",
            _ => "",
        };
        if !required.is_empty() && required != kind && !CARE_BUILDINGS.contains(&kind)
            || goal.as_ref().is_some_and(|g| text(g, "kind") == "blocks")
                && kind != "refine"
                && !CARE_BUILDINGS.contains(&kind)
        {
            return false;
        }
        let slots = self.construction_slots(choice);
        if projects(&self.world).iter().any(|o| {
            text(o, "type") == kind && (kind == "crossing" || Point::read(o).distance(p) < 18.)
        }) {
            return false;
        }
        let local_count = list(&self.world, "creatures")
            .iter()
            .filter(|c| Point::read(c).distance(p) <= 24.)
            .count();
        let crew_size = if INDEPENDENT_BUILDINGS.contains(&kind) || kind == "crossing" {
            4
        } else {
            ((local_count as f64 / 3.).ceil() as usize).clamp(4, 16)
        };
        let candidates: Vec<_> = list(&self.world, "creatures")
            .iter()
            .filter(|c| {
                num(c, "carry") == 0.
                    && num(c, "sickness") < 50.
                    && !working(c)
                    && worker_project(&self.world, c).is_none()
                    && Point::read(c).distance(p) <= 32.
                    && !list(&self.world["community"], "access").iter().any(|r| {
                        text(r, "status") == "clearing"
                            && list(r, "crew").iter().any(|id| same_id(id, &c["id"]))
                    })
                    && (list(&self.world["directives"], "members").is_empty()
                        || list(&self.world["directives"], "members")
                            .iter()
                            .any(|id| same_id(id, &c["id"])))
            })
            .cloned()
            .collect();
        let mut crew: Vec<_> = candidates
            .into_iter()
            .filter(|c| {
                slots
                    .iter()
                    .any(|p| self.route_cost(Point::read(c), Point::read(p)).is_finite())
            })
            .collect();
        crew.sort_by(|a, b| {
            (minimum(a) < 60.)
                .cmp(&(minimum(b) < 60.))
                .then(work_order(a, b))
                .then(
                    Point::read(a)
                        .distance(p)
                        .total_cmp(&Point::read(b).distance(p)),
                )
        });
        crew.truncate(crew_size);
        if crew.is_empty() {
            return false;
        }
        let site_reason = if choice["density"].is_object() {
            format!(
                "{} At {}, {}; {:.1} residents / 100 ground units; density reward {:.1}; {} units from builder.",
                outpost_reason(&choice["outpost"]),
                p.x,
                p.y,
                num(&choice["density"], "residents"),
                num(&choice["density"], "reward"),
                num(choice, "travel").js_round()
            )
        } else {
            String::new()
        };
        let milestone = colony_milestone(&self.world);
        let industry = industry_milestone(&self.world);
        let parent = goal.as_ref().map(|g| g["id"].clone()).unwrap_or_else(|| {
            if !milestone.is_null() {
                milestone["id"].clone()
            } else if !industry.is_null() {
                industry["id"].clone()
            } else {
                json!("colony")
            }
        });
        let id = self.world["community"]["nextProject"].clone();
        increment(&mut self.world["community"], "nextProject", 1.);
        let project = json!({"id":id,"type":kind,"x":p.x,"y":p.y,"crew":crew.iter().map(|c|c["id"].clone()).collect::<Vec<_>>(),"target":choice["target"].as_f64().unwrap_or(24.).floor().clamp(1.,1e6),"progress":0,"required":32,"started":self.world["time"],"source":source,"blocked":"","parentGoal":parent,"subgoal":choice.get("subgoal").cloned().unwrap_or(json!(kind)),"siteReason":site_reason});
        self.add_work_project(project.clone());
        self.world["community"]["lastProjectAt"] = self.world["time"].clone();
        self.prepare_timber();
        increment(&mut self.world, "commandRevision", 1.);
        increment(&mut self.world, "navRevision", 1.);
        increment(&mut self.world, "revision", 1.);
        let message = format!(
            "We chose {} at {}, {}.",
            project_name(&project).to_lowercase(),
            p.x.js_round(),
            p.y.js_round()
        );
        let goal_name = goal.as_ref().map(|g| text(g, "kind")).unwrap_or_else(|| {
            if !milestone.is_null() {
                text(&milestone, "title")
            } else if !industry.is_null() {
                text(&industry, "title")
            } else {
                "healthy growth"
            }
        });
        let description = choice["description"]
            .as_str()
            .unwrap_or("Gather real materials and respect our needs.");
        self.activity(
            "construction",
            &message,
            source,
            &format!(
                "{} local workers; {} crews active. {site_reason} Goal: {goal_name}. {description}",
                crew.len(),
                projects(&self.world).len()
            ),
        );
        self.remember(
            "self-build",
            &format!(
                "The colony chose {} with {source}.",
                project_name(&project).to_lowercase()
            ),
            None,
        );
        true
    }
    pub fn prepare_timber(&mut self) {
        for p in self.work_projects() {
            self.prepare_project(&p);
        }
    }
    fn prepare_project(&mut self, p: &Value) {
        if !self.independent() {
            return;
        }
        let goal = self.active_goal();
        let required = match goal.as_ref().map(|g| text(g, "kind")) {
            Some("wood") => "timber",
            Some("ore") => "quarry",
            Some("bridge") => "crossing",
            Some("blocks") => "refine",
            _ => "",
        };
        if !required.is_empty()
            && text(p, "type") != required
            && !CARE_BUILDINGS.contains(&text(p, "type"))
        {
            self.remove_work_project(&p["id"]);
            self.world["community"]["lastProjectAt"] =
                json!(num(&self.world, "time") - development_interval(&self.world));
            increment(&mut self.world, "commandRevision", 1.);
            increment(&mut self.world, "navRevision", 1.);
            self.activity(
                "project",
                "We will work toward your new goal.",
                "Your words",
                "Gathered resources remain in storage.",
            );
            return;
        }
        if !list(p, "crew").iter().any(|id| {
            list(&self.world, "creatures")
                .iter()
                .any(|c| same_id(&c["id"], id))
        }) || num(&self.world, "time") - num(p, "started") > 240.
        {
            self.remove_work_project(&p["id"]);
            self.world["community"]["lastProjectAt"] = self.world["time"].clone();
            increment(&mut self.world, "commandRevision", 1.);
            increment(&mut self.world, "navRevision", 1.);
            self.activity("blocked","Our crew needs a new plan.","Instincts","Materials already gathered remain in storage. We will reconsider after caring for everyone.");
            return;
        }
        let crew: Vec<_> = list(&self.world, "creatures")
            .iter()
            .filter(|c| {
                list(p, "crew").iter().any(|id| same_id(id, &c["id"])) && self.project_allowed(c)
            })
            .cloned()
            .collect();
        if crew.is_empty()
            || !self.resource_needed(p)
            || !self
                .project_tasks(&crew[0])
                .iter()
                .any(|t| ["gather", "quarry"].contains(&t.as_str()))
        {
            return;
        }
        let types = if ["quarry", "refine"].contains(&text(p, "type")) {
            ["rock", "ore"]
        } else {
            ["tree", "log"]
        };
        let objects: Vec<_> = list(&self.world, "objects")
            .iter()
            .filter(|o| {
                types.contains(&text(o, "type")) && Point::read(o).distance(Point::read(p)) <= 32.
            })
            .cloned()
            .collect();
        let mut count = 0;
        for o in objects {
            if self.project_source_accessible(&o, &crew) {
                count += 1;
            }
        }
        let short = match text(p, "type") {
            "refine" => self.refining_shortage(p),
            "quarry" => num(p, "target") - num(&self.world["inventory"], "ore"),
            _ => {
                let target = match text(p, "type") {
                    "timber" => num(p, "target"),
                    "crossing" => 24.,
                    _ => num(&project_requirements(&self.world, p), "wood"),
                };
                target - num(&self.world["inventory"], "wood")
            }
        };
        let sources = 12_usize.min(list(p, "crew").len()).min(
            ((short / if types[0] == "rock" { 3. } else { 6. })
                .ceil()
                .max(1.)) as usize,
        );
        if count >= sources {
            return;
        }
        let mut natural: Vec<_> = self
            .nearby_objects(Point::read(p), 32.)
            .into_iter()
            .filter(|o| {
                types.contains(&text(o, "type"))
                    && text(o, "id").starts_with("g:")
                    && Point::read(o).distance(Point::read(p)) <= 32.
            })
            .collect();
        natural.sort_by(|a, b| {
            Point::read(a)
                .distance(Point::read(p))
                .total_cmp(&Point::read(b).distance(Point::read(p)))
        });
        for o in natural.iter().take(24) {
            if count >= sources || list(&self.world, "objects").len() >= 2044 {
                break;
            }
            if self.project_source_accessible(o, &crew) && self.materialize_object(o).is_some() {
                count += 1;
            }
        }
        if count == 0 {
            let mut all: Vec<_> = list(&self.world, "objects")
                .iter()
                .filter(|o| types.contains(&text(o, "type")))
                .cloned()
                .chain(natural)
                .filter(|o| self.allowed_region(Point::read(o)))
                .collect();
            all.sort_by(|a, b| {
                Point::read(a)
                    .distance(Point::read(p))
                    .total_cmp(&Point::read(b).distance(Point::read(p)))
            });
            if let Some(o) = all.first() {
                let point = self
                    .service_slots(o, Some(Point::read(&crew[0])))
                    .first()
                    .cloned()
                    .unwrap_or_else(|| crate::access::access_point(o, &crew[0]).json());
                self.request_access(json!({"target":o["id"],"point":point,"unit":crew[0]["id"],"task":self.project_task(&crew[0]),"project":p["id"]}));
            }
        }
    }
    fn project_source_accessible(&mut self, o: &Value, crew: &[Value]) -> bool {
        self.allowed_region(Point::read(o))
            && self.service_slots(o, None).iter().any(|s| {
                crew.iter()
                    .any(|c| self.route_cost(Point::read(c), Point::read(s)).is_finite())
            })
    }
    pub fn settlement_decision_choices(&mut self) -> Vec<Value> {
        let mut choices = self.clearance_choices();
        choices.extend(self.settlement_choices());
        let urgent: Vec<_> = choices
            .iter()
            .filter(|c| CARE_BUILDINGS.contains(&text(c, "id")) && num(c, "priority") >= 80.)
            .cloned()
            .collect();
        let useful: Vec<_> = choices
            .into_iter()
            .filter(|c| {
                urgent.is_empty()
                    || text(c, "id") == "clearance"
                    || urgent.iter().any(|u| {
                        care_services(text(u, "id"))
                            .iter()
                            .any(|k| care_services(text(c, "id")).contains(k))
                    })
            })
            .collect();
        let mut selected: Vec<_> = useful
            .iter()
            .take(4)
            .cloned()
            .map(|mut c| {
                c.as_object_mut().unwrap().remove("sites");
                c
            })
            .collect();
        for c in useful.iter().take(3) {
            for site in list(c, "sites").iter().skip(1) {
                if selected.len() >= 6 {
                    break;
                }
                let mut item = c.clone();
                item.as_object_mut().unwrap().remove("sites");
                item.as_object_mut()
                    .unwrap()
                    .extend(site.as_object().unwrap().clone());
                selected.push(item);
            }
        }
        let mut counts: HashMap<String, usize> = HashMap::new();
        for c in &mut selected {
            let kind = text(c, "id").to_owned();
            let count = counts.entry(kind.clone()).or_default();
            *count += 1;
            if c["key"].is_null() {
                c["key"] = json!(if *count == 1 {
                    kind.clone()
                } else {
                    format!("{kind}_{count}")
                });
            }
            if c["subgoal"].is_null() {
                c["subgoal"] = json!(if CARE_BUILDINGS.contains(&kind.as_str()) {
                    format!("care-{}", care_services(&kind)[0])
                } else {
                    kind
                });
            }
        }
        selected
    }
    pub fn current_settlement_choice(&mut self, choice: &Value) -> Option<Value> {
        if !choice.is_object() {
            return None;
        }
        if text(choice, "id") == "clearance" {
            return self.clearance_choices().into_iter().find(|c| {
                same_id(&c["request"], &choice["request"])
                    && same_id(&c["blocker"], &choice["blocker"])
            });
        }
        let choices = self.settlement_decision_choices();
        let current = choices.iter().find(|c| same_id(&c["id"], &choice["id"]))?;
        let urgent: Vec<_> = choices
            .iter()
            .filter(|c| CARE_BUILDINGS.contains(&text(c, "id")) && num(c, "priority") >= 80.)
            .collect();
        if !urgent.is_empty()
            && !urgent.iter().any(|c| {
                care_services(text(c, "id"))
                    .iter()
                    .any(|k| care_services(text(current, "id")).contains(k))
            })
        {
            return None;
        }
        let kind = text(choice, "id");
        let p = Point::read(choice);
        let mut c = choice.clone();
        if INDEPENDENT_BUILDINGS.contains(&kind) {
            if !self.allowed_region(p) || !self.site_valid(kind, p) {
                return None;
            }
            let density = self.site_density(p);
            if num(&density, "reward") < num(&current["density"], "reward") - 12. {
                return None;
            }
            let outpost = self.assess_outpost(kind, p, num(choice, "travel"), true);
            if flag(&choice["outpost"], "worthwhile") && !flag(&outpost, "worthwhile") {
                return None;
            }
            c["density"] = density;
            c["outpost"] = outpost;
            return Some(c);
        }
        if !self.allowed_region(p)
            || projects(&self.world).iter().any(|p| {
                text(p, "type") == kind
                    && (kind == "crossing" || Point::read(p).distance(Point::read(choice)) < 18.)
            })
        {
            return None;
        }
        c["target"] = current["target"].clone();
        if choice["camps"].is_array() {
            c["camps"] = json!(
                list(choice, "camps")
                    .iter()
                    .filter(|p| self.allowed_region(Point::read(p))
                        && !projects(&self.world)
                            .iter()
                            .any(|active| text(active, "type") == kind
                                && Point::read(active).distance(Point::read(p)) < 18.))
                    .cloned()
                    .collect::<Vec<_>>()
            );
        }
        Some(c)
    }
    pub fn finish_settlement(&mut self) -> Vec<Value> {
        let mut finished = Vec::new();
        for p in self.work_projects() {
            if self.finish_project(&p) {
                finished.push(p["id"].clone());
            }
        }
        finished
    }
    fn finish_project(&mut self, p: &Value) -> bool {
        if !self.independent() {
            return false;
        }
        if !construction(p) {
            if self.resource_needed(p) {
                return false;
            }
            increment(&mut self.world["community"], "completed", 1.);
            self.world["community"]["lastProjectAt"] =
                json!(num(&self.world, "time") - development_interval(&self.world));
            self.remove_work_project(&p["id"]);
            increment(&mut self.world, "commandRevision", 1.);
            increment(&mut self.world, "navRevision", 1.);
            self.activity(
                "gathered",
                &format!("{} finished.", project_name(p)),
                p["source"].as_str().unwrap_or("Instincts"),
                "Real materials gathered by the crew; ready for the next project.",
            );
            return true;
        }
        if num(p, "progress") < num(p, "required") || !project_funded(&self.world, p) {
            return false;
        }
        let kind = text(p, "type");
        if let Some(error) = self.place_building(kind, num(p, "x"), num(p, "y")) {
            if text(p, "blocked") != error {
                self.activity(
                    "blocked",
                    &format!("{} is waiting.", building_name(kind)),
                    "Instincts",
                    &error,
                );
            }
            if same_id(&self.world["community"]["project"]["id"], &p["id"]) {
                self.world["community"]["project"]["blocked"] = json!(error);
            } else if let Some(current) = self.world["community"]["projects"]
                .as_array_mut()
                .and_then(|a| a.iter_mut().find(|a| same_id(&a["id"], &p["id"])))
            {
                current["blocked"] = json!(error);
            }
            let node = if kind == "mine" {
                self.nearby_objects(Point::read(p), 2.)
                    .into_iter()
                    .find(|o| text(o, "type") == "node")
            } else {
                None
            };
            if !self.can_place(
                kind,
                Point::read(p),
                node.as_ref().map(|n| text(n, "id")),
                true,
            ) {
                self.remove_work_project(&p["id"]);
                self.world["community"]["lastProjectAt"] = self.world["time"].clone();
                increment(&mut self.world, "commandRevision", 1.);
                increment(&mut self.world, "navRevision", 1.);
            }
            return false;
        }
        increment(&mut self.world["community"], "completed", 1.);
        self.world["community"]["lastProjectAt"] =
            json!(num(&self.world, "time") - development_interval(&self.world));
        self.remove_work_project(&p["id"]);
        self.activity(
            "built",
            &format!("{} finished.", building_name(kind)),
            p["source"].as_str().unwrap_or("Instincts"),
            &format!(
                "{} used. The whole colony can use it now.",
                building_cost(kind)
            ),
        );
        self.post_message(self.completion_letter(p, building_name(kind)));
        true
    }
}
