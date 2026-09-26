//! Reservation-based, fair individual scheduler. Planning has no world effects.
use crate::{
    Engine, density,
    development::*,
    exploration::scout_limit,
    geometry::{Object, bridge},
    value::*,
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
pub const TASKS: [&str; 17] = [
    "idle",
    "eat",
    "wash",
    "play",
    "haul",
    "mine",
    "work",
    "home",
    "orbit",
    "explore",
    "social",
    "rest",
    "clean",
    "gather",
    "quarry",
    "refine",
    "construct",
];
// A scored entrance stays typed while sorting; only the chosen assignment is serialized.
struct Candidate {
    cost: f64,
    switching: f64,
    point: Value,
    target: Value,
    slot: Value,
}
fn open_job(c: &Value) -> bool {
    c["job"].is_object()
        && !["completed", "blocked", "cancelled"].contains(&text(&c["job"], "state"))
}
fn slot_key(target: &Value, slot: &Value) -> String {
    format!("{}:{}", js_json(target), js_json(slot))
}
fn construction_key(p: &Value, s: &Value) -> String {
    format!("construction:{}:{}", js_json(p), js_json(s))
}
fn take_stock(stock: &mut HashMap<String, f64>, key: String, n: f64) {
    *stock.entry(key).or_default() += n;
}
fn stock_at(stock: &HashMap<String, f64>, key: &str) -> f64 {
    stock.get(key).copied().unwrap_or(0.)
}
fn target_stock_key(id: &Value) -> String {
    js_json(id)
}
fn purpose(task: &str, target: &Value) -> String {
    match task {
        "eat" => "Recover food",
        "wash" => "Recover cleanliness",
        "play" => "Recover play",
        "home" => "Recover food and cleanliness",
        "clean" => "Clear pollution before returning to work",
        "haul" => "Deliver real material to the bridge or store",
        "mine" => "Extract available ore",
        "work" => "Convert reserved ore into blocks",
        "orbit" => "Join the orbital collective",
        "explore" => "Inspect an accessible discovery",
        "gather" => "Cut trees and gather real timber for our project",
        "quarry" => "Break rocks and collect their ore",
        "refine" => "Work stored ore into blocks by hand",
        _ => return format!("Visit {}", target.as_str().unwrap_or("")),
    }
    .into()
}
fn unique(v: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    v.into_iter().filter(|t| seen.insert(t.clone())).collect()
}
impl Engine {
    fn orbital_priority(&self) -> bool {
        let plan = orbital_plan(&self.world);
        flag(&plan, "missionActive") && text(&plan, "phase") == "launch"
    }
    fn orbital_assignment_limit(&self) -> usize {
        if !self.orbital_priority() {
            return 0;
        }
        num(&orbital_plan(&self.world), "eligible") as usize
    }
    fn crowded(&self, c: &Value) -> bool {
        self.resident_density(Point::read(c)) > 6.
            || self
                .density_index
                .borrow()
                .has_neighbors(&self.world, c, 3., 4)
    }
    pub fn allows_task(&mut self, task: &str, c: &Value) -> bool {
        if ["gather", "quarry", "refine", "construct"].contains(&task)
            && self
                .clearance_task(c)
                .as_ref()
                .is_none_or(|r| text(r, "task") != task)
            && !self.project_tasks(c).iter().any(|t| t == task)
        {
            return false;
        }
        let scope = list(&self.world["directives"], "members");
        if !scope.is_empty() && !scope.iter().any(|id| same_id(id, &c["id"])) {
            return true;
        }
        if flag(&self.world["directives"], "pauseWork")
            && ["haul", "mine", "work", "orbit"].contains(&task)
        {
            return false;
        }
        !(flag(&self.world["directives"], "avoidPollution") && task == "work")
    }
    pub fn work_targets(&mut self, c: &Value, task: &str) -> Vec<Value> {
        let project_task = self.project_task(c);
        let project_tasks = self.project_tasks(c);
        let clearance = self.clearance_task(c);
        list(&self.world, "objects")
            .iter()
            .filter(|o| {
                // Reject unrelated kinds before fog/region checks. All predicates
                // are read-only; their result and original object order are unchanged.
                let kind = text(o, "type");
                let relevant = match task {
                    "eat" => ["banana", "orchard"].contains(&kind),
                    "gather" => ["tree", "log"].contains(&kind),
                    "quarry" => ["rock", "ore"].contains(&kind),
                    "wash" => kind == "bath",
                    "play" => ["cricketball", "roundabout", "theatre"].contains(&kind),
                    "home" => kind == "dwelling",
                    "clean" | "work" => kind == "factory",
                    "mine" => kind == "mine",
                    "orbit" => kind == "cannon",
                    "haul" => {
                        ["log", "bone", "ore", "factory", "bridge", "sculpture"].contains(&kind)
                    }
                    "explore" => ["monolith", "mountain", "node"].contains(&kind),
                    _ => false,
                };
                if !relevant {
                    return false;
                }
                if !self.is_explored(Point::read(o)) {
                    return false;
                }
                let committed = same_id(&c["target"], &o["id"]) && open_job(c);
                if !committed && Point::read(c).distance(Point::read(o)) > 64. {
                    return false;
                }
                let scope = list(&self.world["directives"], "members");
                if self.world["directives"]["region"].is_object()
                    && (scope.is_empty() || scope.iter().any(|id| same_id(id, &c["id"])))
                    && ["mine", "work", "explore", "orbit", "gather", "quarry"].contains(&task)
                    && (num(o, "x") > 42.) != (num(&self.world["directives"]["region"], "x") > 42.)
                {
                    return false;
                }
                let kind = text(o, "type");
                if task == "eat" {
                    return ["banana", "orchard"].contains(&kind) && num(o, "stock") > 0.;
                }
                if let Some(r) = &clearance
                    && ["gather", "quarry"].contains(&task)
                {
                    return task == text(r, "task") && same_id(&o["id"], &r["target"]);
                }
                match task {
                    "gather" => {
                        project_task.as_deref() == Some("gather")
                            && (kind == "tree" || (kind == "log" && num(o, "stock") > 0.))
                    }
                    "quarry" => {
                        project_tasks.iter().any(|t| t == "quarry")
                            && (kind == "rock" || (kind == "ore" && num(o, "stock") > 0.))
                    }
                    "wash" => kind == "bath",
                    "play" => ["cricketball", "roundabout", "theatre"].contains(&kind),
                    "home" => kind == "dwelling",
                    "clean" => {
                        kind == "factory"
                            && list(&self.world, "pollution")
                                .iter()
                                .any(|z| same_id(&z["source"], &o["id"]) && num(z, "amount") > 0.)
                    }
                    "haul" => {
                        if num(c, "carry") > 0. {
                            if text(c, "cargoKind") == "ore" {
                                kind == "factory" && num(o, "inputOre") < 60.
                            } else {
                                kind == "bridge" && !bridge(&Object::read(o)).complete
                                    || kind == "sculpture"
                                        && num(o, "stock") < 12.
                                        && text(c, "cargoKind") == "wood"
                            }
                        } else {
                            ["log", "bone", "ore"].contains(&kind) && num(o, "stock") > 0.
                                || self.stored_supply(c, o).is_some()
                        }
                    }
                    "mine" => kind == "mine" && num(o, "stock") > 0.,
                    "work" => {
                        kind == "factory"
                            && num(o, "inputOre") >= 3.
                            && !list(&self.world["memory"], "goals")
                                .iter()
                                .any(|g| text(g, "status") == "active" && text(g, "kind") == "ore")
                    }
                    "orbit" => {
                        kind == "cannon"
                            && self.orbital_priority()
                            && !flag(c, "favorite")
                            && minimum(c) >= ORBITAL_VOLUNTEER_NEED
                            && num(c, "sickness") < 50.
                            && num(c, "carry") == 0.
                    }
                    "explore" => {
                        ["monolith", "mountain", "node"].contains(&kind)
                            && !flag(o, "discovered")
                            && !list(c, "encounters").iter().any(|e| {
                                text(e, "kind") == "discovery" && same_id(&e["other"], &o["id"])
                            })
                    }
                    _ => false,
                }
            })
            .cloned()
            .collect()
    }
    fn desired_tasks(&mut self, c: &Value, mut policy: &str) -> Vec<String> {
        let mut needs = [("fed", "eat"), ("clean", "wash"), ("amused", "play")];
        needs.sort_by(|a, b| num(c, a.0).total_cmp(&num(c, b.0)));
        let floor = num(&self.world["directives"], "careFloor").max(35.);
        let urgent: Vec<String> = needs
            .iter()
            .filter(|(k, _)| num(c, k) < floor)
            .flat_map(|(k, t)| {
                if *k == "amused" {
                    vec![t.to_string()]
                } else {
                    vec![t.to_string(), "home".into()]
                }
            })
            .collect();
        if num(c, "sickness") >= 50. {
            let mut a = Vec::new();
            if num(c, "fed") < 35. {
                a.extend(["home".into(), "eat".into()]);
            }
            a.extend(["wash".into(), "home".into()]);
            a.extend(urgent);
            a.push("rest".into());
            return unique(a);
        }
        if !urgent.is_empty() {
            let mut a = urgent;
            a.push("rest".into());
            return unique(a);
        }
        if num(c, "carry") > 0. {
            let mut a = vec!["haul".into()];
            a.extend(
                needs
                    .iter()
                    .filter(|(k, _)| num(c, k) < 55.)
                    .map(|(_, t)| t.to_string()),
            );
            a.push("rest".into());
            return a;
        }
        let care: Vec<String> = needs
            .iter()
            .filter(|(k, _)| num(c, k) < if policy == "care" { 78. } else { 68. })
            .flat_map(|(k, t)| {
                if *k == "amused" {
                    vec![t.to_string()]
                } else {
                    vec![t.to_string(), "home".into()]
                }
            })
            .collect();
        let scope = list(&self.world["directives"], "members");
        if !scope.is_empty() && !scope.iter().any(|id| same_id(id, &c["id"])) && policy == "build" {
            policy = "balanced";
        }
        let mut work: Vec<String> = match policy {
            "build" => vec!["haul", "work", "mine"],
            "mine" => vec!["mine", "haul", "work"],
            "industry" => vec!["work", "haul", "mine", "orbit"],
            _ => vec!["haul", "work", "mine", "orbit"],
        }
        .into_iter()
        .map(str::to_owned)
        .collect();
        let role = work_role(&self.world, c);
        let maintain = self.world["settings"]["autonomy"] != json!(false)
            && list(&self.world, "pollution")
                .iter()
                .any(|z| num(z, "amount") >= 20.);
        if policy == "balanced" && role < 3 {
            let first = ["haul", "mine", "work"][role];
            work.sort_by_key(|t| t != first);
        }
        if (policy == "expand" || (policy == "balanced" && role == 3)) && minimum(c) >= 76. {
            work.insert(0, "explore".into());
        }
        let mut a = care;
        if maintain {
            a.push("clean".into());
        }
        if let Some(r) = self.clearance_task(c) {
            a.push(text(&r, "task").into());
        }
        a.extend(self.project_tasks(c));
        if self.orbital_priority() && !flag(c, "favorite") {
            a.push("orbit".into());
        }
        a.extend(work);
        if minimum(c) >= 76. && num(c, "carry") == 0. && self.crowded(c) {
            a.push("explore".into());
        }
        a.extend(
            needs
                .iter()
                .filter(|(k, _)| num(c, k) < 85.)
                .map(|(_, t)| t.to_string()),
        );
        if role == 3 {
            a.push("explore".into());
        }
        a.extend(["social".into(), "rest".into()]);
        unique(a)
            .into_iter()
            .filter(|t| self.allows_task(t, c))
            .collect()
    }
    fn reserve_assignment(
        &self,
        slots: &mut HashSet<String>,
        stock: &mut HashMap<String, f64>,
        a: &Value,
    ) {
        let task = text(a, "task");
        if ["construct", "refine"].contains(&task) {
            slots.insert(construction_key(&a["project"], &a["slot"]));
        }
        if task == "refine" {
            take_stock(stock, "inventory:ore".into(), 1.);
        }
        let c = list(&self.world, "creatures")
            .iter()
            .find(|c| same_id(&c["id"], &a["id"]));
        let target = list(&self.world, "objects")
            .iter()
            .find(|o| same_id(&o["id"], &a["target"]));
        if let (Some(c), Some(o)) = (c, target) {
            if task == "quarry" && text(o, "type") == "rock" {
                take_stock(stock, "pending:ore".into(), 3.);
                take_stock(
                    stock,
                    format!(
                        "pending:ore:{}",
                        js_json(
                            &worker_project(&self.world, c)
                                .map(|p| p["id"].clone())
                                .unwrap_or(Value::Null)
                        )
                    ),
                    3.,
                );
            }
            if task == "haul"
                && num(c, "carry") == 0.
                && let Some(supply) = self.stored_supply(c, o)
            {
                take_stock(stock, format!("inventory:{supply}"), 3.);
            }
        }
        if !a["target"].is_null() {
            slots.insert(slot_key(&a["target"], &a["slot"]));
            if ["eat", "mine", "haul", "work", "gather", "quarry"].contains(&task) {
                let key = if task == "work" {
                    format!("{}:ore", js_json(&a["target"]))
                } else {
                    target_stock_key(&a["target"])
                };
                take_stock(stock, key, if task == "work" { 3. } else { 1. });
            }
        }
    }
    pub fn make_plan(&mut self, policy: &str) -> Value {
        let scoped = self.density_index.borrow_mut().begin_positions(&self.world);
        let plan = self.make_plan_with_positions(policy);
        if scoped {
            self.density_index.borrow_mut().end_positions();
        }
        plan
    }
    fn make_plan_with_positions(&mut self, policy: &str) -> Value {
        let started = crate::timing::now();
        let mut slots = HashSet::new();
        let mut stock = HashMap::new();
        let mut assignments: Vec<Value> = Vec::new();
        let mut assignment_points: Vec<Point> = Vec::new();
        let mut idle_points: Vec<Point> = Vec::new();
        let mut access: Vec<Value> = Vec::new();
        let mut slot_cache: HashMap<String, Vec<Value>> = HashMap::new();
        let orbit_limit = self.orbital_assignment_limit();
        let floor = num(&self.world["directives"], "careFloor").max(35.);
        let refining_crews = projects(&self.world)
            .iter()
            .filter(|p| text(p, "type") == "refine")
            .count()
            .max(1) as f64;
        let priority = |c: &Value| {
            if minimum(c) < floor || num(c, "sickness") >= 50. {
                0
            } else if open_job(c) && !["idle", "rest", "social"].contains(&text(c, "task")) {
                1
            } else {
                2
            }
        };
        let mut members = list(&self.world, "creatures").to_vec();
        members.sort_by(|a, b| {
            priority(a)
                .cmp(&priority(b))
                .then_with(|| {
                    if priority(a) == 0 {
                        minimum(a).total_cmp(&minimum(b))
                    } else {
                        std::cmp::Ordering::Equal
                    }
                })
                .then_with(|| work_order(a, b))
        });
        for c in &members {
            let position = Point::read(c);
            let project = self.worker_project(c);
            let tasks = self.desired_tasks(c, policy);
            let old = &c["job"];
            let target = list(&self.world, "objects")
                .iter()
                .find(|o| same_id(&o["id"], &c["target"]))
                .cloned();
            let task = text(c, "task");
            let serving = ["eat", "wash", "play", "home"].contains(&task)
                && !(minimum(c) < 10. && !tasks.iter().take(2).any(|t| t == task));
            let construction_valid = !["construct", "refine"].contains(&task)
                || (project.as_ref().is_some_and(|p| {
                    same_id(&old["project"], &p["id"])
                        && (if task == "construct" {
                            project_funded(&self.world, p)
                        } else {
                            num(&self.world["inventory"], "ore") - stock_at(&stock, "inventory:ore")
                                > 0.
                        })
                }) && !slots.contains(&construction_key(&old["project"], &old["slot"])));
            let preserve = !["idle", "rest", "social"].contains(&task)
                && (num(c, "carry") == 0.
                    || ["haul", "eat", "wash", "home", "play"].contains(&task))
                && open_job(c)
                && construction_valid
                && self.allows_task(task, c)
                && (serving
                    || num(c, "sickness") < 50. && minimum(c) >= floor
                    || tasks.iter().take(2).any(|t| t == task));
            let old_target_valid = c["target"].is_null()
                || self
                    .work_targets(c, task)
                    .iter()
                    .any(|o| same_id(&o["id"], &c["target"]));
            let old_stock_valid = target.as_ref().is_none_or(|t| {
                !["eat", "mine", "haul"].contains(&task)
                    || ["bridge", "factory", "sculpture"].contains(&text(t, "type"))
                    || num(t, "stock") - stock_at(&stock, &target_stock_key(&t["id"])) >= 1.
            });
            let supply = target.as_ref().and_then(|o| self.stored_supply(c, o));
            let no_supply = task == "haul"
                && num(c, "carry") == 0.
                && supply.as_ref().is_some_and(|s| {
                    self.delivery_stock(s) - stock_at(&stock, &format!("inventory:{s}")) <= 0.
                });
            if preserve
                && old_target_valid
                && old_stock_valid
                && !no_supply
                && old["point"].is_object()
                && self.clear_position(Point::read(&old["point"]))
                && !assignment_points
                    .iter()
                    .any(|a| a.distance(Point::read(&old["point"])) < 0.6)
                && num(&self.world, "time")
                    - old["lastProgress"].as_f64().unwrap_or(num(old, "started"))
                    < 45.
                && !slots.contains(&slot_key(&c["target"], &old["slot"]))
                && (task != "work"
                    || target.as_ref().map_or(0., |t| num(t, "inputOre"))
                        - stock_at(&stock, &format!("{}:ore", js_json(&c["target"])))
                        >= 3.)
            {
                let a = json!({"id":c["id"],"task":c["task"],"target":c["target"],"slot":old["slot"],"point":old["point"],"purpose":old["purpose"],"keep":true,"project":old["project"]});
                self.reserve_assignment(&mut slots, &mut stock, &a);
                assignment_points.push(Point::read(&a["point"]));
                if a["target"].is_null() {
                    idle_points.push(Point::read(&a["point"]));
                }
                assignments.push(a);
                continue;
            }
            let mut chosen = None;
            let mut obstruction = None;
            for task in tasks {
                let t = task.as_str();
                if t == "orbit"
                    && assignments
                        .iter()
                        .filter(|a| text(a, "task") == "orbit")
                        .count()
                        >= orbit_limit
                {
                    continue;
                }
                if t == "quarry"
                    && project
                        .as_ref()
                        .is_some_and(|p| text(p, "type") == "refine")
                    && self.clearance_task(c).is_none()
                {
                    let p = project.as_ref().unwrap();
                    let shortage = self.refining_shortage(p);
                    if shortage <= stock_at(&stock, "pending:ore")
                        || stock_at(&stock, &format!("pending:ore:{}", js_json(&p["id"])))
                            >= (shortage / refining_crews).ceil()
                    {
                        continue;
                    }
                }
                if t == "explore"
                    && assignments
                        .iter()
                        .filter(|a| text(a, "task") == "explore")
                        .count()
                        >= scout_limit(&self.world, policy)
                {
                    continue;
                }
                if ["construct", "refine"].contains(&t) {
                    if let Some(p) = &project {
                        let permitted = if t == "construct" {
                            project_funded(&self.world, p)
                        } else {
                            num(&self.world["inventory"], "ore") - stock_at(&stock, "inventory:ore")
                                > 0.
                        };
                        let points = self.construction_slots(p);
                        if permitted
                            && let Some(point) = points.iter().find(|s| {
                                !slots.contains(&construction_key(&p["id"], &s["slot"]))
                                    && !assignment_points
                                        .iter()
                                        .any(|a| a.distance(Point::read(s)) < 0.6)
                                    && self.route_cost(position, Point::read(s)).is_finite()
                            })
                        {
                            chosen = Some(
                                json!({"id":c["id"],"task":t,"target":null,"slot":point["slot"],"point":point,"project":p["id"],"purpose":format!("Work on our {}",project_name(p).to_lowercase())}),
                            );
                            break;
                        }
                        if obstruction.is_none()
                            && (if t == "construct" {
                                project_funded(&self.world, p)
                            } else {
                                num(&self.world["inventory"], "ore") > 0.
                            })
                            && !points
                                .iter()
                                .any(|s| self.route_cost(position, Point::read(s)).is_finite())
                        {
                            obstruction = Some(
                                json!({"unit":c["id"],"task":t,"project":p["id"],"point":points.first().cloned().unwrap_or_else(||crate::access::access_point(p,c).json())}),
                            );
                        }
                    }
                    continue;
                }
                if ["rest", "social"].contains(&t) {
                    let crowded = self.crowded(c);
                    if t == "social" && crowded {
                        continue;
                    }
                    if text(c, "task") == t
                        && old["point"].is_object()
                        && (!crowded || Point::read(&old["point"]).distance(position) > 2.)
                        && open_job(c)
                        && self.clear_position(Point::read(&old["point"]))
                        && num(&self.world, "time")
                            - old["lastProgress"].as_f64().unwrap_or(num(old, "started"))
                            < 45.
                        && !assignment_points
                            .iter()
                            .any(|a| a.distance(Point::read(&old["point"])) < 0.6)
                    {
                        chosen = Some(
                            json!({"id":c["id"],"task":t,"target":null,"slot":old["slot"],"point":old["point"],"partner":old["partner"],"purpose":old["purpose"],"keep":true}),
                        );
                        break;
                    }
                    let phase = num(c, "birthOrdinal") * 2.3999632297;
                    let radius = if crowded { 7. } else { 1.5 };
                    let mut anchor = position.offset(phase.cos() * radius, phase.sin() * radius);
                    if crowded && num(c, "carry") == 0. && minimum(c) > 55. {
                        let mut alternatives: Vec<_> = (0..8)
                            .map(|i| {
                                let angle = phase + i as f64 * std::f64::consts::PI / 4.;
                                position.offset(angle.cos() * radius, angle.sin() * radius)
                            })
                            .filter(|p| self.is_explored(*p) && self.clear_position(*p))
                            .collect::<Vec<_>>()
                            .into_iter()
                            .map(|p| {
                                let score = density::reward(self.resident_density(p), 6.)
                                    - assignment_points
                                        .iter()
                                        .map(|a| (4. - a.distance(p)).max(0.))
                                        .sum::<f64>();
                                (p, score)
                            })
                            .collect();
                        alternatives.sort_by(|a, b| b.1.total_cmp(&a.1));
                        if let Some((p, _)) = alternatives
                            .into_iter()
                            .find(|(p, _)| self.route_cost(position, *p).is_finite())
                        {
                            anchor = p;
                        }
                    }
                    let partner = if t == "social" {
                        members.iter().find(|o| {
                            !same_id(&o["id"], &c["id"])
                                && ["idle", "rest"].contains(&text(o, "task"))
                                && Point::read(o).distance(position) < 4.
                                && num(o, "amused") < 85.
                                && !assignments.iter().any(|a| same_id(&a["partner"], &o["id"]))
                        })
                    } else {
                        None
                    };
                    if t == "social" && partner.is_none() {
                        continue;
                    }
                    let wanted = if let Some(partner) = partner {
                        Point::read(partner).offset(phase.cos() * 1.1, phase.sin() * 1.1)
                    } else if num(c, "carry") > 0.
                        || !crowded
                            && !self
                                .density_index
                                .borrow()
                                .has_neighbors(&self.world, c, 1.2, 1)
                    {
                        position
                    } else {
                        anchor
                    };
                    let point = self
                        .free_position(wanted, &idle_points, 3.)
                        .or_else(|| self.free_position(position, &idle_points, 3.));
                    let Some(point) = point else {
                        continue;
                    };
                    if !self.clear_position(point) || !self.route_cost(position, point).is_finite()
                    {
                        continue;
                    }
                    chosen = Some(
                        json!({"id":c["id"],"task":t,"target":null,"slot":num(c,"birthOrdinal")%12.,"point":point,"partner":partner.map(|p|p["id"].clone()),"purpose":if t=="social"{"Share play and strengthen a bond"}else{"Rest in a clear, quiet place"}}),
                    );
                    break;
                }
                let mut candidates: Vec<Candidate> = Vec::new();
                for o in self.work_targets(c, t) {
                    if t == "haul"
                        && num(c, "carry") == 0.
                        && let Some(supply) = self.stored_supply(c, &o)
                        && self.delivery_stock(&supply)
                            - stock_at(&stock, &format!("inventory:{supply}"))
                            <= 0.
                    {
                        continue;
                    }
                    if list(c, "blocked").iter().any(|b| {
                        same_id(&b["target"], &o["id"])
                            && num(b, "until") > num(&self.world, "time")
                            && b["revision"].as_f64() == self.world["navRevision"].as_f64()
                    }) {
                        continue;
                    }
                    if ["eat", "mine", "haul"].contains(&t)
                        && !["bridge", "factory", "sculpture"].contains(&text(&o, "type"))
                        && num(&o, "stock") - stock_at(&stock, &target_stock_key(&o["id"])) < 1.
                    {
                        continue;
                    }
                    if t == "work"
                        && num(&o, "inputOre")
                            - stock_at(&stock, &format!("{}:ore", js_json(&o["id"])))
                            < 3.
                    {
                        continue;
                    }
                    let key = format!(
                        "{}:{}",
                        o["id"],
                        if text(&o, "type") == "bridge" {
                            if num(c, "x") < num(&o, "x") { "a" } else { "b" }
                        } else {
                            "all"
                        }
                    );
                    let entrances = slot_cache
                        .entry(key)
                        .or_insert_with(|| self.service_slots(&o, Some(position)));
                    if entrances.is_empty() && obstruction.is_none() {
                        obstruction = Some(
                            json!({"unit":c["id"],"task":t,"target":o["id"],"point":crate::access::access_point(&o,c)}),
                        );
                    }
                    for p in entrances {
                        if slots.contains(&slot_key(&o["id"], &p["slot"]))
                            || assignments
                                .iter()
                                .any(|a| Point::read(&a["point"]).distance(Point::read(p)) < 0.6)
                        {
                            continue;
                        }
                        let switching = if !c["target"].is_null()
                            && !same_id(&c["target"], &o["id"])
                        {
                            2. + 2. * num(&c["traits"], "diligence")
                        } else {
                            0.
                        } + if minimum(c) > 45.
                            && ["eat", "wash", "play", "home"].contains(&t)
                        {
                            12_f64.min(-density::reward(self.resident_density(Point::read(&o)), 6.))
                        } else {
                            0.
                        };
                        candidates.push(Candidate {
                            cost: position.distance(Point::read(p)) + switching,
                            switching,
                            point: p.clone(),
                            target: o["id"].clone(),
                            slot: p["slot"].clone(),
                        });
                    }
                }
                candidates.sort_by(|a, b| a.cost.total_cmp(&b.cost));
                let mut best: Option<Candidate> = None;
                for mut a in candidates {
                    if best.as_ref().is_some_and(|b| a.cost > b.cost) {
                        break;
                    }
                    let cost = self.route_cost(position, Point::read(&a.point)) + a.switching;
                    if !cost.is_finite() && obstruction.is_none() {
                        obstruction = Some(
                            json!({"unit":c["id"],"task":t,"target":a.target,"point":a.point}),
                        );
                    }
                    if cost.is_finite() && best.as_ref().is_none_or(|b| cost < b.cost) {
                        a.cost = cost;
                        best = Some(a);
                    }
                }
                if let Some(best) = best {
                    chosen = Some(
                        json!({"id":c["id"],"task":t,"cost":best.cost,"switching":best.switching,"point":best.point,"target":best.target,"slot":best.slot,"purpose":purpose(t,&best.target)}),
                    );
                    break;
                }
                if t == "explore"
                    && let Some(point) = self.frontier(c, &assignments, policy)
                {
                    chosen = Some(
                        json!({"id":c["id"],"task":t,"target":null,"slot":c["birthOrdinal"],"point":point,"purpose":"Scout new ground, then return for care"}),
                    );
                    break;
                }
            }
            let mut a=chosen.unwrap_or_else(||json!({"id":c["id"],"task":"idle","target":null,"slot":0,"point":{"x":c["x"],"y":c["y"]},"purpose":"No accessible work; waiting for help"}));
            if !flag(&a, "keep") && a["partner"].is_null() {
                a.as_object_mut().unwrap().remove("partner");
            }
            if let Some(r) = obstruction
                && access.len() < 4
                && !USEFUL_TASKS.contains(&text(&a, "task"))
                && !access.iter().any(|old| {
                    same_id(&old["target"], &r["target"]) && same_id(&old["project"], &r["project"])
                })
            {
                access.push(r);
            }
            self.reserve_assignment(&mut slots, &mut stock, &a);
            assignment_points.push(Point::read(&a["point"]));
            if a["target"].is_null() {
                idle_points.push(Point::read(&a["point"]));
            }
            assignments.push(a);
        }
        json!({"id":policy,"time":self.world["time"],"revision":self.world["revision"],"commandRevision":self.world["commandRevision"],"assignments":assignments,"access":access,"schedulerMs":crate::timing::now()-started})
    }
    pub fn apply_plan(&mut self, plan: &Value) -> bool {
        let assignments = list(plan, "assignments");
        if !plan.is_object()
            || num(&self.world, "time") - num(plan, "time") > 30.
            || plan["commandRevision"].as_f64() != self.world["commandRevision"].as_f64()
            || assignments.len() != list(&self.world, "creatures").len()
        {
            return false;
        }
        let mut ids = HashSet::new();
        let mut slots = HashSet::new();
        let mut stock = HashMap::new();
        for a in assignments {
            let Some(c) = list(&self.world, "creatures")
                .iter()
                .find(|c| same_id(&c["id"], &a["id"]))
                .cloned()
            else {
                return false;
            };
            let task = text(a, "task");
            let waiting = task == "idle"
                && a["target"].is_null()
                && a["point"]["x"].as_f64() == c["x"].as_f64()
                && a["point"]["y"].as_f64() == c["y"].as_f64();
            if !ids.insert(crate::value::js_json(&a["id"]))
                || !TASKS.contains(&task)
                || !a["point"].is_object()
                || !waiting && !self.clear_position(Point::read(&a["point"]))
            {
                return false;
            }
            if !a["target"].is_null()
                && (!list(&self.world, "objects")
                    .iter()
                    .any(|o| same_id(&o["id"], &a["target"]))
                    || slots.contains(&slot_key(&a["target"], &a["slot"])))
            {
                return false;
            }
            if !self.allows_task(task, &c) {
                return false;
            }
            if ["construct", "refine"].contains(&task)
                && (worker_project(&self.world, &c)
                    .is_none_or(|p| !same_id(&p["id"], &a["project"]))
                    || slots.contains(&construction_key(&a["project"], &a["slot"])))
            {
                return false;
            }
            if task == "refine"
                && num(&self.world["inventory"], "ore") - stock_at(&stock, "inventory:ore") <= 0.
            {
                return false;
            }
            if !a["target"].is_null()
                && !self
                    .work_targets(&c, task)
                    .iter()
                    .any(|o| same_id(&o["id"], &a["target"]))
            {
                return false;
            }
            let target = list(&self.world, "objects")
                .iter()
                .find(|o| same_id(&o["id"], &a["target"]));
            if let Some(target) = target {
                if task == "haul"
                    && num(&c, "carry") == 0.
                    && let Some(supply) = self.stored_supply(&c, target)
                    && self.delivery_stock(&supply)
                        - stock_at(&stock, &format!("inventory:{supply}"))
                        <= 0.
                {
                    return false;
                }
                if ["eat", "mine", "haul"].contains(&task)
                    && !["bridge", "factory", "sculpture"].contains(&text(target, "type"))
                    && num(target, "stock") - stock_at(&stock, &target_stock_key(&a["target"])) < 1.
                {
                    return false;
                }
            }
            if task == "work"
                && target.map_or(0., |o| num(o, "inputOre"))
                    - stock_at(&stock, &format!("{}:ore", js_json(&a["target"])))
                    < 3.
            {
                return false;
            }
            self.reserve_assignment(&mut slots, &mut stock, a);
        }
        for a in assignments {
            let index = list(&self.world, "creatures")
                .iter()
                .position(|c| same_id(&c["id"], &a["id"]))
                .unwrap();
            let c = &self.world["creatures"][index];
            if flag(a, "keep") && c["job"].is_object() {
                continue;
            }
            if c["job"].is_object()
                && text(&c["job"], "state") != "completed"
                && (c["task"] != a["task"] || !same_id(&c["target"], &a["target"]))
            {
                increment(&mut self.world["metrics"], "switches", 1.);
            }
            if USEFUL_TASKS.contains(&text(a, "task")) {
                self.record_work(&a["id"]);
            }
            let time = self.world["time"].clone();
            let c = &mut self.world["creatures"][index];
            let distance = Point::read(c).distance(Point::read(&a["point"]));
            c["task"] = a["task"].clone();
            c["target"] = a["target"].clone();
            c["work"] = json!(0);
            c["job"] = json!({"state":"reserved","slot":a["slot"],"point":a["point"],"partner":a["partner"],"project":a["project"],"purpose":a["purpose"],"started":time,"lastProgress":time,"progressAt":time,"bestDistance":distance,"expected":a["cost"].as_f64().unwrap_or(distance)/1.6+20.});
        }
        self.world["runtime"]["schedulerMs"] = plan["schedulerMs"].clone();
        self.world["runtime"]["assignments"] = json!(assignments.len());
        for r in list(plan, "access") {
            self.request_access(r.clone());
        }
        true
    }
    pub fn sync_groups(&mut self) {
        let mut groups = Vec::new();
        for (i, role) in ["care", "hauling", "production", "discovery"]
            .iter()
            .enumerate()
        {
            let members: Vec<_> = list(&self.world, "creatures")
                .iter()
                .filter(|c| work_role(&self.world, c) == i)
                .map(|c| c["id"].clone())
                .collect();
            if members.is_empty() {
                continue;
            }
            let jobs: Vec<_> = list(&self.world["memory"], "jobs")
                .iter()
                .filter(|j| members.iter().any(|id| same_id(id, &j["unit"])))
                .collect();
            let outcomes: Vec<_> = jobs
                .iter()
                .skip(jobs.len().saturating_sub(8))
                .map(|j| format!("{} completed at {}s", text(j, "task"), num(j, "tick")))
                .collect();
            groups.push(json!({"id":format!("group-{i}"),"role":role,"revision":self.world["commandRevision"],"project":match *role{"hauling"=>"bridge","production"=>"energy",_=>role},"members":members,"outcomes":outcomes}));
        }
        self.world["groups"] = json!(groups);
    }
}
