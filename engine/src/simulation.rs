use crate::{
    Engine,
    geometry::{BODY_RADIUS, Geometry},
    identity::encounter,
    resources::{accepts_project, bridge_state},
    traffic::BridgeTraffic,
    value::*,
};
use serde_json::{Value, json};
use std::collections::HashMap;

#[derive(Default)]
pub(crate) struct Runtime {
    paths: HashMap<String, TravelPath>,
    pub(crate) traffic: HashMap<String, BridgeTraffic>,
    bodies: HashMap<(i32, i32), Vec<usize>>,
    body_stamp: Option<(u64, usize)>,
}
struct TravelPath {
    signature: String,
    point: Point,
    at: f64,
    best_distance: f64,
}
pub(crate) fn upgrade_threshold(kind: &str) -> f64 {
    match kind {
        "factory" => 5000.,
        "mine" => 120000.,
        "dwelling" => 200000.,
        _ => 0.,
    }
}
fn minimum(c: &Value) -> f64 {
    num(c, "fed").min(num(c, "clean")).min(num(c, "amused"))
}
fn useful(task: &str) -> bool {
    matches!(
        task,
        "haul"
            | "mine"
            | "work"
            | "orbit"
            | "explore"
            | "clean"
            | "gather"
            | "quarry"
            | "refine"
            | "construct"
    )
}
pub(crate) fn js_round(n: f64) -> f64 {
    let value = (n + 0.5).floor();
    if value == 0. { 0. } else { value }
}
pub(crate) fn format_count(n: f64) -> String {
    let s = format!("{:.0}", n);
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            result.push(',');
        }
        result.push(c);
    }
    result
}
pub(crate) fn display_name(kind: &str) -> &str {
    match kind {
        "sculpture" => "Keepsake",
        "bath" => "Rain shower",
        "orchard" => "Banana grove",
        "roundabout" => "Bounce garden",
        "mine" => "Mine",
        "dwelling" => "Cottage",
        "factory" => "Stone workshop",
        "theatre" => "Clubhouse",
        "flowers" => "Flowers",
        "tnt" => "Demolition charge",
        "cannon" => "Sky launcher",
        "inspect" => "Hand",
        "banana" => "Banana",
        "cloth" => "Cloth",
        "cricketball" => "Cricket ball",
        "axe" => "Axe",
        "hammer" => "Hammer",
        "meteor" => "Meteor",
        "bug" => "Reclaimer",
        "pickaxe" => "Pickaxe",
        "chainsaw" => "Chainsaw",
        "grabber" => "Carry",
        "swarm" => "Reclaimer sweep",
        "mop" => "Scrub brush",
        "tree" => "Timber oak",
        "stump" => "Tree stump",
        "rock" => "Rock",
        "node" => "Stone deposit",
        "log" => "Timber",
        "bone" => "Bones",
        "corpse" => "Remains",
        "ore" => "Ore",
        "blocks" => "Cut stone",
        "lander" => "Spacecraft",
        "monolith" => "Survey beacon",
        "mountain" => "Mountain",
        "bridge" => "River bridge",
        "hole" => "Departure gate",
        "creature" => "Tripelkin",
        _ => "Colony object",
    }
}
pub(crate) fn building_spec(kind: &str) -> Value {
    match kind {
        "sculpture" => json!({"stage":2,"blocks":100,"cost":50,"capacity":2}),
        "bath" => json!({"population":6,"wood":6,"capacity":1}),
        "orchard" => json!({"population":10,"wood":10,"capacity":3}),
        "roundabout" => json!({"population":15,"wood":12,"capacity":5}),
        "mine" => json!({"blocks":50,"cost":25,"wood":12,"capacity":4,"stage":2}),
        "dwelling" => json!({"blocks":200,"cost":100,"wood":18,"capacity":6,"stage":2}),
        "factory" => json!({"blocks":300,"cost":150,"wood":24,"capacity":5,"stage":2}),
        "theatre" => json!({"blocks":1000,"cost":500,"wood":36,"capacity":20,"stage":2}),
        "flowers" => json!({"population":4,"wood":1,"capacity":0}),
        "tnt" => json!({"energy":1500000,"cost":0,"stage":2,"capacity":0}),
        "cannon" => json!({"flag":"secondContact","cost":0,"capacity":8}),
        _ => Value::Null,
    }
}
fn tool_spec(kind: &str) -> Value {
    match kind {
        "inspect" | "banana" | "cloth" | "cricketball" => json!({}),
        "axe" | "meteor" => json!({"population":4}),
        "hammer" => json!({"population":20}),
        "bug" => json!({"flag":"monolith"}),
        "pickaxe" => json!({"blocks":15,"stage":2}),
        "chainsaw" => json!({"blocks":400,"stage":2}),
        "grabber" => json!({"flag":"grabber"}),
        "swarm" => json!({"flag":"swarm"}),
        "mop" => json!({"flag":"pollution"}),
        _ => Value::Null,
    }
}
pub(crate) fn unlocked(w: &Value, spec: &Value) -> bool {
    num(w, "population") >= num(spec, "population")
        && num(w, "stage") >= num(spec, "stage")
        && num(&w["progress"], "peakBlocks") >= num(spec, "blocks")
        && num(&w["progress"], "energy") >= num(spec, "energy")
        && (text(spec, "flag").is_empty()
            || w["progress"][text(spec, "flag")]
                .as_bool()
                .unwrap_or(num(&w["progress"], text(spec, "flag")) != 0.))
}
pub(crate) fn building_cost(spec: &Value) -> String {
    let mut parts = Vec::new();
    if num(spec, "wood") > 0. {
        parts.push(format!("{} wood", format_count(num(spec, "wood"))));
    }
    if num(spec, "cost") > 0. {
        parts.push(format!("{} blocks", format_count(num(spec, "cost"))));
    }
    if parts.is_empty() {
        "No materials".into()
    } else {
        parts.join(" + ")
    }
}
impl Engine {
    pub(crate) fn reachable(&mut self, c: &Value, o: &Value) -> bool {
        let from = Point::read(c);
        self.service_slots(o, Some(from)).iter().any(|p| {
            self.waypoint(from, Point::read(p)).is_some() || from.distance(Point::read(p)) < 0.3
        })
    }
    fn put_creature(&mut self, c: Value) {
        if let Some(item) = self.world["creatures"]
            .as_array_mut()
            .and_then(|a| a.iter_mut().find(|o| same_id(&o["id"], &c["id"])))
        {
            *item = c;
        }
    }
    fn put_object(&mut self, o: Value) {
        if let Some(item) = self.world["objects"]
            .as_array_mut()
            .and_then(|a| a.iter_mut().find(|v| same_id(&v["id"], &o["id"])))
        {
            *item = o;
        }
    }
    fn remove_object(&mut self, id: &str) {
        if let Some(a) = self.world["objects"].as_array_mut() {
            a.retain(|o| text(o, "id") != id);
        }
    }
    fn west_bank(&self, p: Point) -> bool {
        p.x < crate::terrain::river_left(num(&self.world["map"], "seed") as u32, p.y)
    }
    fn ground(&self, p: Point) -> bool {
        crate::terrain::ground(num(&self.world["map"], "seed") as u32, p)
    }
    fn orbital_ready(&self) -> bool {
        flag(&self.world["progress"], "cannon")
            && num(&self.world["orbital"], "launches") >= 12.
            && num(&self.world["orbital"], "population") >= 12.
    }
    fn finish_job(&mut self, c: &mut Value, result: &str) {
        let task = text(c, "task").to_string();
        if result == "completed" && useful(&task) {
            increment(c, "workCycles", 1.);
        }
        increment(&mut self.world["memory"]["activity"], &task, 1.);
        let entry = json!({"task":task,"unit":c["id"],"target":c["target"].as_str().unwrap_or(""),"tick":num(&self.world,"time").floor()});
        let jobs = self.world["memory"]["jobs"].as_array_mut().unwrap();
        jobs.push(entry);
        if jobs.len() > 64 {
            jobs.drain(..jobs.len() - 64);
        }
        if c["job"].is_object() {
            c["job"]["state"] = json!(result);
        }
        increment(&mut self.world["metrics"], "completed", 1.);
        c["work"] = json!(0);
        c["task"] = json!("idle");
        c["target"] = Value::Null;
    }
    fn block_job(&mut self, c: &mut Value, reason: &str) {
        if c["job"]["point"].is_object()
            && ["path", "route", "position"]
                .iter()
                .any(|s| reason.contains(s))
        {
            self.request_access(json!({"unit":c["id"],"task":c["task"],"target":c["target"],"project":c["job"]["project"],"point":c["job"]["point"],"reason":reason}));
        }
        let time = num(&self.world, "time");
        if c["target"].is_string() {
            let entry =
                json!({"target":c["target"],"until":time+20.,"revision":self.world["navRevision"]});
            let blocked = c["blocked"].as_array_mut().unwrap();
            blocked.push(entry);
            if blocked.len() > 8 {
                blocked.drain(..blocked.len() - 8);
            }
        }
        increment(&mut self.world["metrics"], "stalls", 1.);
        if c["job"].is_object() {
            c["job"]["state"] = json!("blocked");
        }
        c["work"] = json!(0);
        c["task"] = json!("idle");
        c["target"] = Value::Null;
        if time - num(&self.world["runtime"], "lastBlockReport") > 30. {
            self.remember(
                "blocked",
                &format!("{}: {}", text(c, "name"), reason),
                Some(text(c, "id")),
            );
            self.world["runtime"]["lastBlockReport"] = json!(time);
        }
    }
    pub(crate) fn steer_move(&mut self, c: &mut Value, dx: f64, dy: f64) -> f64 {
        let stamp = (
            num(&self.world, "time").to_bits(),
            list(&self.world, "creatures").len(),
        );
        if self.sim.body_stamp != Some(stamp) {
            self.sim.body_stamp = Some(stamp);
            self.sim.bodies.clear();
            for (i, other) in list(&self.world, "creatures").iter().enumerate() {
                self.sim
                    .bodies
                    .entry((
                        num(other, "x").floor() as i32,
                        num(other, "y").floor() as i32,
                    ))
                    .or_default()
                    .push(i);
            }
        }
        let mut near = Vec::new();
        let p = Point::read(c);
        for x in p.x.floor() as i32 - 1..=p.x.floor() as i32 + 1 {
            for y in p.y.floor() as i32 - 1..=p.y.floor() as i32 + 1 {
                for i in self.sim.bodies.get(&(x, y)).into_iter().flatten() {
                    let o = &self.world["creatures"][*i];
                    if !same_id(&o["id"], &c["id"]) {
                        near.push(Point::read(o));
                    }
                }
            }
        }
        let mut point = p;
        let length = crate::value::js_hypot(dx, dy);
        let mut moved = 0.;
        if near.is_empty() {
            moved = self.swept_move(&mut point, dx, dy);
        } else {
            let angle = dy.atan2(dx);
            let n = (length / 0.12).ceil().max(1.);
            for _ in 0..n as usize {
                let mut found = false;
                for offset in [0., 0.55, 1., 1.57, 2.1, -0.55, -1., -1.57, -2.1] {
                    let vx = (angle + offset).cos() * length / n;
                    let vy = (angle + offset).sin() * length / n;
                    let next = point.offset(vx, vy);
                    if near
                        .iter()
                        .any(|o| o.distance(next) < BODY_RADIUS * 2. - 0.015)
                        || !self.clear_position(next)
                    {
                        continue;
                    }
                    moved += self.swept_move(&mut point, vx, vy);
                    found = true;
                    break;
                }
                if !found {
                    break;
                }
            }
        }
        c["x"] = json!(point.x);
        c["y"] = json!(point.y);
        moved
    }
    pub(crate) fn separate_bodies(&mut self) {
        let mut cells: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        for (i, c) in list(&self.world, "creatures").iter().enumerate() {
            cells
                .entry((num(c, "x").floor() as i32, num(c, "y").floor() as i32))
                .or_default()
                .push(i);
        }
        for i in 0..list(&self.world, "creatures").len() {
            let c = &self.world["creatures"][i];
            let start = Point::read(c);
            for x in start.x.floor() as i32 - 1..=start.x.floor() as i32 + 1 {
                for y in start.y.floor() as i32 - 1..=start.y.floor() as i32 + 1 {
                    for j in cells.get(&(x, y)).into_iter().flatten() {
                        let c = &self.world["creatures"][i];
                        let other = &self.world["creatures"][*j];
                        if text(c, "id") >= text(other, "id") {
                            continue;
                        }
                        let mut p = Point::read(c);
                        let mut q = Point::read(other);
                        let mut dx = p.x - q.x;
                        let mut dy = p.y - q.y;
                        let mut d = crate::value::js_hypot(dx, dy);
                        if d >= BODY_RADIUS * 2. + 0.03 {
                            continue;
                        }
                        if d < 0.001 {
                            dx = 1.;
                            dy = 0.;
                            d = 0.001;
                        }
                        let push = ((BODY_RADIUS * 2. + 0.03 - d) / 2.).min(0.1);
                        let den = if d < 0.002 { 1. } else { d };
                        let nx = dx / den;
                        let ny = dy / den;
                        self.swept_move(&mut p, nx * push, ny * push);
                        self.world["creatures"][i]["x"] = json!(p.x);
                        self.world["creatures"][i]["y"] = json!(p.y);
                        self.swept_move(&mut q, -nx * push, -ny * push);
                        self.world["creatures"][*j]["x"] = json!(q.x);
                        self.world["creatures"][*j]["y"] = json!(q.y);
                    }
                }
            }
        }
    }
    fn growth_density(&self, p: Point) -> f64 {
        self.resident_density(p)
    }
    fn travel(&mut self, c: &mut Value, dt: f64) -> bool {
        if !c["job"]["point"].is_object() {
            return false;
        }
        let point = Point::read(&c["job"]["point"]);
        let time = num(&self.world, "time");
        let len = Point::read(c).distance(point);
        if c["job"]["bestDistance"].is_null() || len < num(&c["job"], "bestDistance") - 0.15 {
            c["job"]["bestDistance"] = json!(len);
            c["job"]["progressAt"] = json!(time);
        }
        let target = list(&self.world, "objects")
            .iter()
            .find(|o| same_id(&o["id"], &c["target"]));
        let loose = target.is_some_and(|o| {
            matches!(text(o, "type"), "banana" | "log" | "ore" | "bone")
                && Point::read(c).distance(Point::read(o)) < 0.85
        });
        if len < 0.42 || loose {
            c["job"]["state"] = json!("working");
            return true;
        }
        if !self.can_enter_bridge(c, point) {
            if let Some(holding) = self.bridge_waiting_point(c) {
                let delta = holding.offset(-num(c, "x"), -num(c, "y"));
                let distance = Point { x: 0., y: 0. }.distance(delta);
                if distance > 0.15 {
                    let stride = (1.65 * dt).min(distance);
                    let moved = self.steer_move(c, delta.x / distance * stride, delta.y / distance * stride);
                    if moved > 0.01 { c["heading"] = json!(delta.y.atan2(delta.x)); }
                }
            }
            c["job"]["state"] = json!("queued");
            c["job"]["lastProgress"] = json!(time);
            c["job"]["progressAt"] = json!(time);
            increment(&mut c["job"], "started", dt);
            return false;
        }
        let signature = format!(
            "{}:{}:{}:{}",
            self.world["navRevision"], self.world["map"]["revision"], point.x, point.y
        );
        let id = text(c, "id").to_string();
        let old = Point::read(c);
        if self
            .sim
            .paths
            .get(&id)
            .is_some_and(|p| p.signature == signature && old.distance(p.point) < 0.2)
        {
            c["job"]["progressAt"] = json!(time);
        }
        let replace = self.sim.paths.get(&id).is_none_or(|p| {
            p.signature != signature || old.distance(p.point) < 0.2 || time - p.at > 3.
        });
        if replace {
            if let Some(p) = self.waypoint(old, point) {
                self.sim.paths.insert(
                    id.clone(),
                    TravelPath {
                        signature,
                        point: p,
                        at: time,
                        best_distance: old.distance(p),
                    },
                );
            } else {
                self.sim.paths.remove(&id);
            }
        }
        let Some(p) = self.sim.paths.get(&id).map(|p| p.point) else {
            self.block_job(c, "No clear path to the work position.");
            return false;
        };
        let dx = p.x - old.x;
        let dy = p.y - old.y;
        let d = crate::value::js_hypot(dx, dy);
        let speed = if num(c, "boostUntil") > time {
            2.1
        } else {
            1.65
        };
        let stride = (speed * dt).min(d);
        let moved = self.steer_move(c, dx / d.max(0.001) * stride, dy / d.max(0.001) * stride);
        c["job"]["state"] = json!(if moved > 0.001 {
            "travelling"
        } else {
            "queued"
        });
        if moved > 0.01 {
            c["job"]["lastProgress"] = json!(time);
            c["heading"] = json!(dy.atan2(dx));
            let remaining = Point::read(c).distance(p);
            if let Some(path) = self.sim.paths.get_mut(&id)
                && remaining < path.best_distance - 0.15
            {
                path.best_distance = remaining;
                c["job"]["progressAt"] = json!(time);
            }
        }
        // A live queue is not a terrain obstruction. Keep the existing job
        // while nearby travellers take their turn, including long bridge queues.
        let cell = (old.x.floor() as i32, old.y.floor() as i32);
        let crowd_wait = (cell.0 - 2..=cell.0 + 2).any(|x| {
            (cell.1 - 2..=cell.1 + 2).any(|y| {
                self.sim.bodies.get(&(x, y)).into_iter().flatten().any(|i| {
                    let other = &self.world["creatures"][*i];
                    !same_id(&other["id"], &c["id"])
                        && Point::read(other).distance(Point::read(c)) < 1.2
                        && matches!(text(&other["job"], "state"), "travelling" | "queued")
                })
            })
        });
        if crowd_wait {
            c["job"]["lastProgress"] = json!(time);
            c["job"]["progressAt"] = json!(time);
            increment(&mut c["job"], "started", dt);
        }
        if time - num(&c["job"], "lastProgress") > 8.
            || time
                - c["job"]["progressAt"]
                    .as_f64()
                    .unwrap_or(num(&c["job"], "started"))
                > 30.
            || time - num(&c["job"], "started") > num(&c["job"], "expected") + 45.
        {
            self.block_job(c, "The route or service position stayed blocked.");
        }
        false
    }
    pub(crate) fn step_world(&mut self, dt: f64) {
        if flag(&self.world["ui"], "paused")
            || !flag(&self.world["progress"], "hatched")
            || num(&self.world, "stage") >= 3.
        {
            return;
        }
        let dt = dt.clamp(0., 0.1);
        increment(&mut self.world, "time", dt);
        let time = num(&self.world, "time");
        if self.world["runtime"].is_null()
            || time
                - self.world["runtime"]["lastSchedule"]
                    .as_f64()
                    .unwrap_or(-10.)
                >= 2.
        {
            for g in self.advance_goals() {
                self.remember(
                    "goal-complete",
                    &format!("We reached our goal: {}.", text(&g, "kind")),
                    None,
                );
            }
            let policy = self.goal_policy();
            let plan = self.make_plan(&policy);
            self.apply_plan(&plan);
            self.world["runtime"]["lastSchedule"] = json!(time);
            self.reveal_colony();
            self.sync_groups();
            self.update_story();
            self.offer_independence();
            self.prepare_timber();
            self.review_access();
            self.update_development_plan();
        }
        let mut deaths = Vec::new();
        let mut births = Vec::new();
        let growth_seconds = if list(&self.world, "creatures").len() < 20 {
            75.
        } else {
            180.
        };
        let ids: Vec<_> = list(&self.world, "creatures")
            .iter()
            .map(|c| text(c, "id").to_string())
            .collect();
        for id in ids {
            let Some(mut c) = list(&self.world, "creatures")
                .iter()
                .find(|c| text(c, "id") == id)
                .cloned()
            else {
                continue;
            };
            if num(&c, "carry") > 0.
                && !list(&self.world, "objects").iter().any(|o| {
                    if text(&c, "cargoKind") == "ore" {
                        text(o, "type") == "factory" && num(o, "inputOre") < 60.
                    } else {
                        (text(o, "type") == "bridge" && !flag(&bridge_state(o), "complete"))
                            || accepts_project(o, text(&c, "cargoKind"))
                    }
                })
            {
                self.release_cargo(&mut c);
            }
            increment(&mut c, "age", dt);
            for (key, decay) in [("fed", 0.08), ("clean", 0.05), ("amused", 0.065)] {
                let value = (num(&c, key) - dt * decay).max(0.);
                c[key] = json!(value);
            }
            let exposure = self.pollution_at(Point::read(&c));
            c["sickness"] = json!(
                (num(&c, "sickness")
                    + dt * if exposure > 12. {
                        exposure * 0.025
                    } else {
                        -0.5
                    })
                .clamp(0., 100.)
            );
            c["clean"] = json!((num(&c, "clean") - dt * exposure * 0.004).max(0.));
            c["deadTime"] = json!(if minimum(&c) <= 0. || num(&c, "sickness") >= 100. {
                num(&c, "deadTime") + dt
            } else {
                0.
            });
            if num(&c, "deadTime") >= 28. {
                let cause = if num(&c, "sickness") >= 100. {
                    "pollution"
                } else {
                    "neglect"
                };
                deaths.push((c.clone(), cause));
                self.put_creature(c);
                continue;
            }
            c["growth"] = json!(if minimum(&c) > 65. && num(&c, "sickness") < 25. {
                (num(&c, "growth")
                    + dt * 50. / growth_seconds
                        * (6. / self.growth_density(Point::read(&c)).max(6.)).min(1.))
                .min(50.)
            } else {
                (num(&c, "growth") - dt * 0.25).max(0.)
            });
            if num(&c, "growth") >= 50.
                && num(&self.world, "population") < 1e15
                && list(&self.world, "creatures").len() < 2048
                && !flag(&self.world["runtime"]["growth"], "held")
                && (list(&self.world, "creatures").len() as f64)
                    < self.world["runtime"]["growth"]["limit"]
                        .as_f64()
                        .unwrap_or(2048.)
            {
                births.push(id.clone());
            }
            self.process_creature_job(&mut c, dt);
            self.put_creature(c);
        }
        for (c, cause) in deaths {
            self.die(&[c], cause, "world");
        }
        for id in births {
            let Some(mut parent) = list(&self.world, "creatures")
                .iter()
                .find(|c| text(c, "id") == id)
                .cloned()
            else {
                continue;
            };
            let before = num(&self.world, "population");
            let child =
                self.add_creature(num(&parent, "x") + 0.7, num(&parent, "y"), Some(&parent));
            if num(&self.world, "population") > before {
                parent["growth"] = json!(0);
                increment(&mut parent, "fed", -10.);
                increment(&mut parent, "clean", -6.);
                increment(&mut parent, "amused", -6.);
            }
            if let Some(mut c) = child {
                encounter(&mut c, "birth", Some(&id), time);
                encounter(&mut parent, "birth", Some(text(&c, "id")), time);
                self.remember(
                    "birth",
                    &format!("{} joined us.", text(&c, "name")),
                    Some(text(&c, "id")),
                );
                self.put_creature(c);
            }
            self.put_creature(parent);
        }
        self.separate_bodies();
        let built = self.finish_settlement();
        if !built.is_empty() {
            let members: Vec<_> = list(&self.world, "creatures")
                .iter()
                .filter(|c| {
                    text(c, "task") == "construct"
                        && built.iter().any(|id| same_id(id, &c["job"]["project"]))
                })
                .cloned()
                .collect();
            for mut c in members {
                self.finish_job(&mut c, "completed");
                self.put_creature(c);
            }
        }
        self.step_cohorts(dt);
        for o in self.world["objects"].as_array_mut().into_iter().flatten() {
            match text(o, "type") {
                "orchard" => {
                    increment(o, "progress", dt);
                    let progress = num(o, "progress");
                    if progress >= 4. {
                        o["stock"] = json!(
                            (num(o, "stock") + (progress / 4.).floor()).min(12. * num(o, "level"))
                        );
                        o["progress"] = json!(progress % 4.);
                    }
                }
                "cricketball" => {
                    increment(o, "progress", dt);
                    if num(o, "progress") >= 240. {
                        o["remove"] = json!(true);
                    }
                }
                _ => {}
            }
        }
        self.world["objects"]
            .as_array_mut()
            .unwrap()
            .retain(|o| !flag(o, "remove"));
        self.world["progress"]["peakBlocks"] = json!(
            num(&self.world["progress"], "peakBlocks").max(num(&self.world["inventory"], "blocks"))
        );
        self.world["progress"]["grabber"] = json!(
            num(&self.world, "stage") >= 2. && num(&self.world["progress"], "chopped") >= 12.
        );
        self.world["progress"]["swarm"] =
            json!(num(&self.world, "stage") >= 2. && num(&self.world["progress"], "bugs") >= 3.);
        increment(&mut self.world, "revision", 1.);
        let completed = num(&self.world["metrics"], "completed");
        let urgent = list(&self.world, "creatures")
            .iter()
            .filter(|c| minimum(c) < 30.)
            .count();
        for d in self.world["decisions"].as_array_mut().into_iter().flatten() {
            if text(d, "observed").is_empty() && time - num(d, "tick") >= 20. {
                let count = completed - num(d, "baseline");
                d["completed"] = json!(count);
                d["observed"] = json!(format!(
                    "{} tasks finished in 20 seconds; {} urgent individuals.",
                    count, urgent
                ));
            }
        }
        self.sim.paths.retain(|id, _| {
            list(&self.world, "creatures")
                .iter()
                .any(|c| text(c, "id") == id)
        });
    }
    fn process_creature_job(&mut self, c: &mut Value, dt: f64) {
        let task = text(c, "task").to_string();
        // The scheduler tried delivery before choosing rest/idle. Keeping a
        // load after that fallback can lock the entire crew out of production:
        // a full local workshop and an empty distant one never clear cargo.
        // Use the existing colony store, conserving the load and freeing hands.
        // Completed mining jobs remain loaded until their next assignment.
        if num(c, "carry") > 0.
            && (matches!(task.as_str(), "rest" | "social")
                || (task == "idle" && text(&c["job"], "state") == "reserved"))
        {
            self.release_cargo(c);
        }
        if task == "idle"
            || c["job"].is_null()
            || matches!(
                text(&c["job"], "state"),
                "completed" | "blocked" | "cancelled"
            )
        {
            return;
        }
        let mut o = list(&self.world, "objects")
            .iter()
            .find(|o| same_id(&o["id"], &c["target"]))
            .cloned()
            .unwrap_or(Value::Null);
        let clearance = self.clearance_task(c);
        let project = self.worker_project(c);
        if matches!(task.as_str(), "gather" | "quarry" | "refine" | "construct")
            && clearance.as_ref().is_none_or(|v| text(v, "task") != task)
            && (!self.project_allowed(c)
                || (matches!(task.as_str(), "construct" | "refine")
                    && project
                        .as_ref()
                        .is_none_or(|p| !same_id(&p["id"], &c["job"]["project"]))))
        {
            c["task"] = json!("idle");
            c["target"] = Value::Null;
            c["job"] = Value::Null;
            return;
        }
        if c["target"].is_string() && o.is_null() {
            self.block_job(c, "That destination is no longer here.");
            return;
        }
        if !self.travel(c, dt) {
            return;
        }
        increment(c, "work", dt);
        let time = num(&self.world, "time");
        c["job"]["lastProgress"] = json!(time);
        if num(c, "carry") > 0. && matches!(task.as_str(), "eat" | "wash" | "play" | "home") {
            let kind = match text(c, "cargoKind") {
                "bones" => "bone",
                "ore" => "ore",
                _ => "log",
            };
            self.deposit(kind, Point::read(c), num(c, "carry"));
            c["carry"] = json!(0);
            c["cargoKind"] = Value::Null;
        }
        match task.as_str() {
            "eat" => {
                if num(&o, "stock") == 0. {
                    self.block_job(c, "The last banana was eaten.");
                    return;
                }
                c["fed"] = json!((num(c, "fed") + dt * 26.).min(100.));
                if num(c, "work") >= 1.5 {
                    increment(&mut o, "stock", -1.);
                    if text(&o, "type") == "banana" && num(&o, "stock") <= 0. {
                        o["remove"] = json!(true);
                    }
                    self.note_evidence(
                        "care",
                        &format!("{} finished a meal.", text(c, "name")),
                        1.,
                        Some(text(c, "id")),
                    );
                    self.finish_job(c, "completed");
                }
            }
            "wash" => {
                c["clean"] = json!((num(c, "clean") + dt * 24.).min(100.));
                c["sickness"] = json!((num(c, "sickness") - dt * 3.).max(0.));
                if num(c, "clean") >= 98. {
                    self.finish_job(c, "completed");
                }
            }
            "play" => {
                c["amused"] = json!((num(c, "amused") + dt * 18.).min(100.));
                if text(&o, "type") == "theatre" {
                    c["boostUntil"] = json!(time + 60.);
                    c["sickness"] = json!((num(c, "sickness") - dt * 4.).max(0.));
                }
                if num(c, "amused") >= 98. {
                    self.finish_job(c, "completed");
                }
            }
            "home" => {
                c["fed"] = json!((num(c, "fed") + dt * 14.).min(100.));
                c["clean"] = json!((num(c, "clean") + dt * 16.).min(100.));
                c["sickness"] = json!((num(c, "sickness") - dt * 2.).max(0.));
                if num(c, "fed").min(num(c, "clean")) >= 97. {
                    self.finish_job(c, "completed");
                }
            }
            "clean" => {
                let removed = self.maintain_factory(&o, dt * 4.);
                if removed > 0. {
                    self.note_evidence(
                        "cleaned",
                        &format!("{} maintained the works.", text(c, "name")),
                        removed,
                        Some(text(c, "id")),
                    );
                }
                if num(c, "work") >= 5. || removed == 0. {
                    self.finish_job(c, "completed");
                }
            }
            "haul" if num(c, "work") >= 1.2 => {
                let supply = if num(c, "carry") == 0. && !o.is_null() {
                    self.stored_supply(c, &o)
                } else {
                    None
                };
                if let Some(supply) = supply {
                    let limit = if supply == "wood" {
                        num(&bridge_state(&o), "required") - num(&o, "stock")
                    } else {
                        self.factory_input_target(&o) - num(&o, "inputOre")
                    };
                    let amount = 3_f64.min(self.delivery_stock(&supply)).min(limit);
                    increment(&mut self.world["inventory"], &supply, -amount);
                    if supply == "ore" {
                        increment(&mut o, "inputOre", amount);
                    } else {
                        c["carry"] = json!(amount);
                        c["cargoKind"] = json!("wood");
                        self.deliver(c, &mut o);
                    }
                    self.finish_job(c, "completed");
                } else if num(c, "carry") == 0. && matches!(text(&o, "type"), "bridge" | "factory")
                {
                    self.block_job(c, "The stored delivery is no longer available.");
                } else if accepts_project(&o, text(c, "cargoKind")) {
                    self.supply_project(c, &mut o);
                    self.finish_job(c, "completed");
                } else if text(&o, "type") == "bridge" {
                    self.deliver(c, &mut o);
                    self.finish_job(c, "completed");
                } else if text(&o, "type") == "factory" && text(c, "cargoKind") == "ore" {
                    let amount = num(c, "carry").min(60. - num(&o, "inputOre"));
                    increment(&mut o, "inputOre", amount);
                    increment(c, "carry", -amount);
                    if num(c, "carry") == 0. {
                        c["cargoKind"] = Value::Null;
                    }
                    self.finish_job(c, "completed");
                } else if num(&o, "stock") > 0. {
                    let kind = match text(&o, "type") {
                        "bone" => "bones",
                        "ore" => "ore",
                        _ => "wood",
                    };
                    let amount = num(&o, "stock").min(if kind == "bones" { 4. } else { 3. });
                    increment(&mut o, "stock", -amount);
                    if kind == "ore"
                        && project
                            .as_ref()
                            .is_some_and(|p| text(p, "type") == "refine")
                    {
                        increment(&mut self.world["inventory"], "ore", amount);
                    } else {
                        increment(c, "carry", amount);
                        c["cargoKind"] = json!(kind);
                    }
                    if num(&o, "stock") == 0. {
                        o["remove"] = json!(true);
                    }
                    self.finish_job(c, "completed");
                } else {
                    self.block_job(c, "The material was already collected.");
                }
            }
            "mine" if num(c, "work") >= 3. => {
                let n = num(&o, "stock").min(
                    3. * num(&o, "level")
                        * o["quality"].as_f64().filter(|q| *q != 0.).unwrap_or(1.),
                );
                increment(&mut o, "stock", -n);
                if list(&self.world, "objects")
                    .iter()
                    .any(|o| text(o, "type") == "factory")
                    && num(&self.world["inventory"], "ore") >= self.refining_ore_reserve()
                    && !list(&self.world["memory"], "goals")
                        .iter()
                        .any(|g| text(g, "kind") == "ore" && text(g, "status") == "active")
                {
                    c["carry"] = json!(n);
                    c["cargoKind"] = json!("ore");
                } else {
                    increment(&mut self.world["inventory"], "ore", n);
                }
                self.finish_job(c, "completed");
            }
            "work" if num(c, "work") >= 2.8 => {
                let amount = num(&o, "inputOre").min(3. * num(&o, "level"));
                if amount == 0. {
                    self.block_job(c, "The works need a delivery of ore.");
                    return;
                }
                increment(&mut o, "inputOre", -amount);
                let blocks = amount * 8.;
                increment(&mut self.world["inventory"], "blocks", blocks);
                increment(&mut self.world["progress"], "energy", blocks * 1024.);
                self.pollute(&o, 0.5 * num(&o, "level"));
                self.finish_job(c, "completed");
            }
            "orbit" if num(c, "work") >= 5. => {
                self.finish_job(c, "completed");
                self.launch(c);
            }
            "gather" if num(c, "work") >= 6. => {
                if text(&o, "type") == "tree" {
                    o["type"] = json!("stump");
                    increment(&mut self.world["inventory"], "wood", 6.);
                    increment(&mut self.world["progress"], "chopped", 1.);
                    increment(&mut self.world, "navRevision", 1.);
                    self.remember(
                        "self-gather",
                        &format!(
                            "{} cut a tree and gathered six wood for the colony.",
                            text(c, "name")
                        ),
                        Some(text(c, "id")),
                    );
                } else if text(&o, "type") == "log" && num(&o, "stock") > 0. {
                    let amount = num(&o, "stock").min(3.);
                    increment(&mut o, "stock", -amount);
                    increment(&mut self.world["inventory"], "wood", amount);
                    if num(&o, "stock") == 0. {
                        o["remove"] = json!(true);
                    }
                }
                self.finish_job(c, "completed");
            }
            "quarry" if num(c, "work") >= 6. => {
                if text(&o, "type") == "rock" {
                    o["type"] = json!("ore");
                    o["stock"] = json!(3);
                    increment(&mut self.world, "navRevision", 1.);
                    self.remember(
                        "self-quarry",
                        &format!("{} broke a rock into three ore.", text(c, "name")),
                        Some(text(c, "id")),
                    );
                    self.activity(
                        "quarry",
                        &format!("{} broke a rock into ore.", text(c, "name")),
                        "Instincts",
                        "",
                    );
                } else if text(&o, "type") == "ore" && num(&o, "stock") > 0. {
                    let amount = num(&o, "stock").min(3.);
                    increment(&mut o, "stock", -amount);
                    increment(&mut self.world["inventory"], "ore", amount);
                    if num(&o, "stock") == 0. {
                        o["remove"] = json!(true);
                    }
                }
                self.finish_job(c, "completed");
            }
            "refine" if num(c, "work") >= 3. => {
                if num(&self.world["inventory"], "ore") < 1. {
                    self.block_job(c, "The workshop needs more ore.");
                    return;
                }
                increment(&mut self.world["inventory"], "ore", -1.);
                increment(&mut self.world["inventory"], "blocks", 10.);
                increment(&mut self.world["progress"], "energy", 10.);
                self.finish_job(c, "completed");
            }
            "construct" => {
                if let Some(project) = project
                    && self.independent()
                    && self.project_funded(&project)
                {
                    let id = &project["id"];
                    if same_id(&self.world["community"]["project"]["id"], &project["id"]) {
                        let p = &mut self.world["community"]["project"];
                        p["progress"] = json!((num(p, "progress") + dt).min(num(p, "required")));
                    } else if let Some(p) = self.world["community"]["projects"]
                        .as_array_mut()
                        .and_then(|a| a.iter_mut().find(|p| same_id(&p["id"], id)))
                    {
                        p["progress"] = json!((num(p, "progress") + dt).min(num(p, "required")));
                    }
                }
            }
            "explore" if num(c, "work") >= 3. => {
                let other = if o.is_null() {
                    format!(
                        "ground:{}:{}",
                        (num(c, "x") / 8.).floor(),
                        (num(c, "y") / 8.).floor()
                    )
                } else {
                    text(&o, "id").into()
                };
                encounter(c, "discovery", Some(&other), time);
                let seen = if o.is_null() {
                    format!("{} scouted new ground.", text(c, "name"))
                } else {
                    format!(
                        "{} inspected the {}.",
                        text(c, "name"),
                        display_name(text(&o, "type")).to_lowercase()
                    )
                };
                self.note_evidence("discovered", &seen, 1., Some(text(c, "id")));
                if o.is_null() {
                    self.visit_frontier(Point::read(c));
                } else {
                    o["discovered"] = json!(true);
                }
                let report = if o.is_null() {
                    format!("{} reached new ground.", text(c, "name"))
                } else {
                    seen
                };
                self.activity(
                    "explore",
                    &report,
                    "Instincts",
                    &format!(
                        "At {}, {}. Care remains the first priority.",
                        js_round(num(c, "x")),
                        js_round(num(c, "y"))
                    ),
                );
                self.finish_job(c, "completed");
            }
            "social" if num(c, "work") >= 3. => {
                let partner = list(&self.world, "creatures")
                    .iter()
                    .find(|o| same_id(&o["id"], &c["job"]["partner"]))
                    .cloned();
                let loss = list(c, "encounters")
                    .iter()
                    .any(|e| text(e, "kind") == "loss" && time - num(e, "tick") < 30.);
                let birth = list(c, "encounters")
                    .iter()
                    .any(|e| text(e, "kind") == "birth" && time - num(e, "tick") < 20.);
                let kind = if loss {
                    if num(&c["traits"], "sociability") > 0.5 {
                        "comfort"
                    } else {
                        "mourning"
                    }
                } else if birth {
                    "celebration"
                } else if num(&self.world["orbital"], "lastLaunch") > 0.
                    && time - num(&self.world["orbital"], "lastLaunch") < 15.
                {
                    "farewell"
                } else if list(c, "encounters")
                    .iter()
                    .any(|e| text(e, "kind") == "discovery" && time - num(e, "tick") < 20.)
                {
                    "question"
                } else if !list(c, "relationships").iter().any(|r| {
                    partner
                        .as_ref()
                        .is_some_and(|p| same_id(&r["id"], &p["id"]))
                }) {
                    "greeting"
                } else if num(c, "amused") > 65.
                    && partner.as_ref().is_some_and(|p| num(p, "amused") > 65.)
                {
                    "song"
                } else {
                    "shared-play"
                };
                if let Some(mut partner) = partner
                    && Point::read(c).distance(Point::read(&partner)) < 3.
                {
                    encounter(c, kind, Some(text(&partner, "id")), time);
                    encounter(&mut partner, kind, Some(text(c, "id")), time);
                    c["amused"] = json!((num(c, "amused") + 12.).min(100.));
                    partner["amused"] = json!((num(&partner, "amused") + 8.).min(100.));
                    let gesture = json!({"kind":kind,"until":time+2.});
                    c["gesture"] = gesture.clone();
                    partner["gesture"] = gesture;
                    self.put_creature(partner);
                }
                self.finish_job(c, "completed");
            }
            "rest" if num(c, "work") >= 4. => {
                if num(c, "amused") < 70. {
                    c["amused"] = json!((num(c, "amused") + 3.).min(70.));
                }
                self.finish_job(c, "completed");
            }
            _ => {}
        }
        if !o.is_null() && task != "orbit" {
            self.put_object(o);
        }
    }
    pub(crate) fn place_building(&mut self, kind: &str, x: f64, y: f64) -> Option<String> {
        let spec = building_spec(kind);
        if spec.is_null() || !unlocked(&self.world, &spec) {
            return Some("That has not been discovered yet.".into());
        }
        if list(&self.world, "objects").len() >= 2048 {
            return Some(
                "There are too many saved objects. Remove something first; you can still explore."
                    .into(),
            );
        }
        let mut point = Point { x, y };
        if !self.ground(point)
            || (!flag(&self.world["progress"], "bridge") && !self.west_bank(point))
        {
            return Some("Find a clear patch of reachable ground.".into());
        }
        if num(&self.world["inventory"], "wood") < num(&spec, "wood")
            || num(&self.world["inventory"], "blocks") < num(&spec, "cost")
        {
            return Some(format!(
                "We need {} for this building.",
                building_cost(&spec)
            ));
        }
        let node = if kind == "mine" {
            self.nearby_objects(point, 3.)
                .into_iter()
                .find(|o| text(o, "type") == "node" && Point::read(o).distance(point) < 2.)
        } else {
            None
        };
        if kind == "mine" && node.is_none() {
            return Some("Mines belong on sparkling nodes.".into());
        }
        if let Some(node) = &node {
            point = Point::read(node);
        }
        if !Geometry::new(&self.world).can_place(
            kind,
            point,
            node.as_ref().map(|o| text(o, "id")),
            false,
        ) {
            return Some(
                "There is something in the way. Leave room for entrances and walking.".into(),
            );
        }
        if node
            .as_ref()
            .is_some_and(|o| !crate::terrain::clear_natural(&mut self.world, o))
        {
            return Some("This world's saved changes are full. You can keep exploring or start another world in Options.".into());
        }
        increment(&mut self.world["inventory"], "wood", -num(&spec, "wood"));
        increment(&mut self.world["inventory"], "blocks", -num(&spec, "cost"));
        if let Some(node) = &node {
            self.remove_object(text(node, "id"));
        }
        self.add_object(kind,point.x,point.y,json!({"stock":if kind=="orchard"{6.}else{node.as_ref().map(|n|num(n,"stock")).unwrap_or(0.)},"level":1,"quality":node.as_ref().map(|n|num(n,"level")).filter(|v|*v!=0.).unwrap_or(1.)}));
        if kind == "cannon" {
            self.world["progress"]["cannon"] = json!(true);
        }
        increment(&mut self.world, "navRevision", 1.);
        increment(&mut self.world, "commandRevision", 1.);
        self.remember(
            "build",
            &format!("Built {}.", display_name(kind).to_lowercase()),
            None,
        );
        None
    }
    pub(crate) fn interact(&mut self, tool: &str, x: f64, y: f64, entity: Option<&str>) -> Value {
        if let Some(kind) = tool.strip_prefix("build:") {
            return json!({"message":self.place_building(kind,x,y).unwrap_or("A new place for the colony.".into()),"sound":"build"});
        }
        let spec = tool_spec(tool);
        if !spec.is_null()
            && !unlocked(&self.world, &spec)
            && !(tool == "grabber" && self.world["ui"]["held"].is_object())
        {
            return json!({"message":"Keep growing to discover this tool."});
        }
        let c = entity.and_then(|id| {
            list(&self.world, "creatures")
                .iter()
                .find(|c| text(c, "id") == id)
                .cloned()
        });
        let o = entity.and_then(|id| {
            list(&self.world, "objects")
                .iter()
                .find(|o| text(o, "id") == id)
                .cloned()
                .or_else(|| self.natural_object(id))
        });
        let p = Point { x, y };
        if tool == "meteor" {
            return self.meteor_impact(p);
        }
        if tool == "inspect" {
            if let Some(o) = &o {
                match text(o, "type") {
                    "bridge" => {
                        self.world["ui"]["selected"] = o["id"].clone();
                        return json!({});
                    }
                    "sculpture" => {
                        return json!({"message":if num(o,"stock")>=12.{"The sculpture keeps the shape of our first question.".to_string()}else{format!("We have {} of 12 wood. Leave logs nearby and we will bring them.",num(o,"stock").min(12.))}});
                    }
                    "lander" => {
                        self.remove_object(text(o, "id"));
                        let baby = self.add_creature(num(o, "x"), num(o, "y"), None);
                        self.world["progress"]["hatched"] = json!(true);
                        self.world["ui"]["selected"] = baby
                            .as_ref()
                            .map(|c| c["id"].clone())
                            .unwrap_or(Value::Null);
                        self.remember("hatch", "Hello. Are you looking after me?", None);
                        return json!({"message":"Hello. Are you looking after me?","sound":"birth"});
                    }
                    "monolith" => {
                        return if !flag(&self.world["progress"], "monolith") {
                            json!({"choice":"monolith"})
                        } else if num(o, "contact") == 2.
                            && !flag(&self.world["progress"], "secondContact")
                        {
                            json!({"choice":"second-contact"})
                        } else if self.orbital_ready() {
                            json!({"choice":"nuke"})
                        } else {
                            json!({"message":"We are becoming something larger."})
                        };
                    }
                    "tnt" => {
                        if !list(&self.world, "objects").iter().any(|a| {
                            text(a, "type") == "mountain"
                                && Point::read(a).distance(Point::read(o)) < 10.
                        }) {
                            return json!({"message":"The TNT needs to be closer to the mountain."});
                        }
                        self.remove_object(text(o, "id"));
                        self.world["progress"]["tnt"] = json!(true);
                        self.add_object("monolith", 52., 13., json!({"contact":2}));
                        increment(&mut self.world, "navRevision", 1.);
                        increment(&mut self.world, "commandRevision", 1.);
                        self.note_evidence(
                            "discovered",
                            "The demolition charge uncovered another survey beacon.",
                            1.,
                            None,
                        );
                        self.remove_object(text(o, "id"));
                        self.remember(
                            "tnt",
                            "The mountain remains. We need more than force.",
                            None,
                        );
                        return json!({"message":"It was not enough. Perhaps the answer is above us.","sound":"build"});
                    }
                    _ => {}
                }
            }
            self.world["ui"]["selected"] = entity.map(|id| json!(id)).unwrap_or(Value::Null);
            return json!({});
        }
        if matches!(tool, "banana" | "cricketball") {
            if !self.clear_position(p)
                || (!flag(&self.world["progress"], "bridge") && !self.west_bank(p))
            {
                return json!({"message":if tool=="banana"{"Drop it on reachable grass."}else{"Find some reachable grass to play on."}});
            }
            if list(&self.world, "objects")
                .iter()
                .filter(|o| text(o, "type") == tool)
                .count()
                >= if tool == "banana" { 32 } else { 8 }
            {
                return json!({"message":if tool=="banana"{"There are still bananas on the ground."}else{"There are enough balls to share."}});
            }
            if self
                .add_object(
                    tool,
                    x,
                    y,
                    if tool == "banana" {
                        json!({"stock":1})
                    } else {
                        json!({})
                    },
                )
                .is_none()
            {
                return json!({"message":"There are too many things in this world. Clear unused objects first."});
            }
            self.remember(
                if tool == "banana" { "feed" } else { "play" },
                if tool == "banana" {
                    "A banana, given freely."
                } else {
                    "Made time for play."
                },
                None,
            );
            return json!({"sound":"care"});
        }
        if tool == "cloth" {
            if let Some(mut c) = c {
                c["clean"] = json!(100);
                let message = format!("Washed {}.", text(&c, "name"));
                self.note_evidence("care", &message, 1., Some(text(&c, "id")));
                self.remember("wash", &message, Some(text(&c, "id")));
                self.put_creature(c);
                return json!({"message":"Squeaky clean.","sound":"care"});
            }
            return json!({"message":"Use the cloth on a creature."});
        }
        if matches!(tool, "axe" | "chainsaw") {
            let mut count = 0;
            let mut blocked = false;
            for tree in self.nearby_objects(p, 8.) {
                if text(&tree, "type") != "tree"
                    || !(o.as_ref().is_some_and(|o| same_id(&o["id"], &tree["id"]))
                        || (tool == "chainsaw" && Point::read(&tree).distance(p) < 3.))
                {
                    continue;
                }
                if text(&tree, "id").starts_with("g:") && list(&self.world, "objects").len() >= 2048
                {
                    blocked = true;
                    continue;
                }
                let Some(mut saved) = self.materialize_object(&tree) else {
                    blocked = true;
                    continue;
                };
                saved["type"] = json!("stump");
                self.put_object(saved);
                self.deposit("log", Point::read(&tree).offset(0.7, 0.6), 6.);
                increment(&mut self.world, "navRevision", 1.);
                count += 1;
            }
            if count > 0 {
                increment(&mut self.world["progress"], "chopped", count as f64);
                self.remember(
                    "chop",
                    &format!(
                        "Chopped {} tree{}.",
                        count,
                        if count > 1 { "s" } else { "" }
                    ),
                    None,
                );
                return json!({"sound":"build","message":"They will put this wood to work."});
            }
            return json!({"message":if blocked{"There is no room to save more changes. Clear unused objects or start another world in Options."}else{"Tap a tree to chop it."}});
        }
        if tool == "hammer"
            && let Some(c) = &c
        {
            self.die(std::slice::from_ref(c), "hammer", "caretaker");
            return json!({"message":format!("{} was beneath the hammer.",text(c,"name")),"sound":"loss"});
        }
        if matches!(tool, "hammer" | "pickaxe") {
            let mut changed = 0;
            let mut blocked = false;
            for mut target in self.nearby_objects(p, 8.) {
                if !(o.as_ref().is_some_and(|o| same_id(&o["id"], &target["id"]))
                    || (tool == "pickaxe"
                        && text(&target, "type") == "rock"
                        && Point::read(&target).distance(p) < 3.))
                {
                    continue;
                }
                let kind = text(&target, "type").to_string();
                if kind == "rock" {
                    let Some(saved) = self.materialize_object(&target) else {
                        blocked = true;
                        continue;
                    };
                    target = saved;
                    target["type"] = json!("ore");
                    target["stock"] = json!(3);
                    self.put_object(target);
                    changed += 1;
                } else if kind == "ore" && tool == "hammer" {
                    increment(
                        &mut self.world["inventory"],
                        "blocks",
                        num(&target, "stock") * 10.,
                    );
                    increment(
                        &mut self.world["progress"],
                        "energy",
                        num(&target, "stock") * 10.,
                    );
                    self.world["progress"]["peakBlocks"] = json!(
                        num(&self.world["progress"], "peakBlocks")
                            .max(num(&self.world["inventory"], "blocks"))
                    );
                    self.remove_object(text(&target, "id"));
                    changed += 1;
                } else if tool == "hammer"
                    && (matches!(kind.as_str(), "stump" | "corpse" | "flowers")
                        || !building_spec(&kind).is_null())
                {
                    if !crate::terrain::clear_natural(&mut self.world, &target) {
                        blocked = true;
                        continue;
                    }
                    increment(
                        &mut self.world["inventory"],
                        "ore",
                        num(&target, "inputOre"),
                    );
                    self.remove_object(text(&target, "id"));
                    if kind == "mine" {
                        self.add_object("node",num(&target,"x"),num(&target,"y"),json!({"stock":target["stock"],"level":target["quality"].as_f64().filter(|v|*v!=0.).unwrap_or(1.)}));
                    }
                    self.remember(
                        "remove",
                        &format!("Removed {}.", display_name(&kind).to_lowercase()),
                        None,
                    );
                    changed += 1;
                }
            }
            if changed > 0 {
                increment(&mut self.world, "navRevision", 1.);
                increment(&mut self.world, "commandRevision", 1.);
                self.remember(
                    "hammer",
                    &format!(
                        "Worked {} resource{}.",
                        changed,
                        if changed > 1 { "s" } else { "" }
                    ),
                    None,
                );
                return json!({"sound":"build","message":if tool=="pickaxe"{"Ore uncovered. Use the hammer to make blocks."}else{"A little work goes a long way."}});
            }
            return json!({"message":if blocked{"There is no room to save more changes. Clear unused objects or start another world in Options."}else{"Use this on rocks, loose ore, or a building."}});
        }
        if matches!(tool, "bug" | "swarm") {
            if let Some(c) = c {
                return json!({"choice":tool,"entity":c["id"]});
            }
            if let Some(mut o) = o
                && text(&o, "type") == "corpse"
            {
                o["type"] = json!("bone");
                o["stock"] = json!(8. * num(&o, "stock").max(1.));
                self.put_object(o);
                if tool == "bug" {
                    increment(&mut self.world["progress"], "bugs", 1.);
                }
                self.remember("bones", "Even a life that ended can become a bridge.", None);
                return json!({"sound":"build"});
            }
            return json!({"message":"The bug needs a creature."});
        }
        if tool == "mop" {
            self.clean_pollution(p);
            return json!({"sound":"care"});
        }
        if tool == "grabber" {
            let held = self.world["ui"]["held"].clone();
            if held.is_object() {
                if !self.clear_position(p)
                    || (!flag(&self.world["progress"], "bridge") && !self.west_bank(p))
                    || list(&self.world, "objects").len() >= 2048
                {
                    return json!({"message":"Find a clear patch with room to put this down."});
                }
                self.add_object(text(&held, "type"), x, y, json!({"stock":held["stock"]}));
                self.remember(
                    "relocate",
                    &format!(
                        "Placed {}.",
                        display_name(text(&held, "type")).to_lowercase()
                    ),
                    None,
                );
                self.world["ui"]["held"] = Value::Null;
                increment(&mut self.world, "navRevision", 1.);
                increment(&mut self.world, "commandRevision", 1.);
                return json!({"message":"Right here.","sound":"care"});
            }
            if let Some(o) = o
                && matches!(text(&o, "type"), "log" | "bone" | "ore" | "corpse")
            {
                self.world["ui"]["held"] =
                    json!({"id":o["id"],"type":o["type"],"stock":o["stock"]});
                self.remove_object(text(&o, "id"));
                increment(&mut self.world, "navRevision", 1.);
                increment(&mut self.world, "commandRevision", 1.);
                return json!({"message":format!("Carrying {}. Tap clear ground to put it down.",display_name(text(&o,"type")).to_lowercase()),"sound":"care"});
            }
            return json!({"message":"Pick up logs, bones, ore or remains, then tap to place them."});
        }
        json!({})
    }
    pub(crate) fn choose(&mut self, kind: &str, answer: &str, entity: Option<&str>) -> String {
        let choices = self.world["memory"]["choices"].as_array_mut().unwrap();
        choices.push(json!(format!("{kind}:{answer}")));
        if choices.len() > 32 {
            choices.drain(..choices.len() - 32);
        }
        increment(&mut self.world, "commandRevision", 1.);
        if kind == "monolith" && !flag(&self.world["progress"], "monolith") {
            self.world["progress"]["monolith"] = json!(true);
            self.world["stage"] = json!(if flag(&self.world["progress"], "bridge") {
                2
            } else {
                1
            });
            increment(&mut self.world["inventory"], "blocks", 30.);
            self.world["progress"]["peakBlocks"] =
                json!(num(&self.world["progress"], "peakBlocks").max(30.));
            self.note_evidence("discovered", "Activated the survey beacon.", 1., None);
            self.post_message(json!({"key":"bridge-materials","title":"A way across","text":"The survey beacon unlocked the Reclaimer. Bones were someone; wood can carry us just as well. Chop trees or send stored wood at the bridge. Finishing the crossing opens the mines and the mountain."}));
            if answer == "care" {
                self.world["directives"]["careFloor"] = json!(55);
            }
            self.remember(
                "choice",
                if answer == "care" {
                    "We promised to put life before output."
                } else {
                    "We agreed to discover what we could become."
                },
                None,
            );
        }
        if kind == "second-contact" && flag(&self.world["progress"], "tnt") {
            self.world["progress"]["secondContact"] = json!(true);
            self.note_evidence(
                "discovered",
                "The mountain survey beacon revealed a route into orbit.",
                1.,
                None,
            );
            self.remember("choice", "A new question points toward the sky.", None);
        }
        if matches!(kind, "bug" | "swarm") && answer == "yes" {
            let Some(c) = list(&self.world, "creatures")
                .iter()
                .find(|c| Some(text(c, "id")) == entity)
                .cloned()
            else {
                return "They are no longer here.".into();
            };
            let victims: Vec<_> = list(&self.world, "creatures")
                .iter()
                .filter(|a| {
                    same_id(&a["id"], &c["id"])
                        || (kind == "swarm" && Point::read(a).distance(Point::read(&c)) < 3.)
                })
                .cloned()
                .collect();
            let count = self.die(&victims, kind, "caretaker");
            if kind == "bug" {
                increment(&mut self.world["progress"], "bugs", 1.);
            }
            self.remember(
                "sacrifice",
                &format!("{} lives became materials.", count),
                None,
            );
        }
        if kind == "nuke" {
            if answer != "yes" {
                self.world["story"]["refusals"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!("nuke"));
                self.note_evidence(
                    "autonomy",
                    "Chose to keep the colony and decline the final destructive project.",
                    1.,
                    None,
                );
                return "We can stay here. The choice is yours.".into();
            }
            if !self.orbital_ready() {
                return "The collective is not ready.".into();
            }
            let mut survivors: Vec<_> = list(&self.world, "creatures")
                .iter()
                .take(3)
                .cloned()
                .collect();
            let lost = num(&self.world, "population") - survivors.len() as f64;
            self.note_evidence(
                "deaths",
                &format!(
                    "The final transformation ended {} lives.",
                    format_count(lost)
                ),
                lost,
                None,
            );
            for c in &mut survivors {
                self.release_cargo(c);
                c["job"] = Value::Null;
                c["task"] = json!("idle");
                c["target"] = Value::Null;
            }
            self.world["cohort"] = json!(0);
            self.world["orbital"]["population"] = json!(0);
            self.world["objects"] = json!([]);
            self.world["pollution"] = json!([]);
            self.world["progress"]["pollution"] = json!(0);
            self.world["stage"] = json!(3);
            self.world["progress"]["finalRequired"] = json!(survivors.len());
            self.world["ui"]["held"] = Value::Null;
            self.world["ui"]["x"] = json!(24);
            self.world["ui"]["y"] = json!(24);
            self.add_object("hole", 24., 24., json!({}));
            for (i, c) in survivors.iter_mut().enumerate() {
                c["x"] = json!(20 + i * 2);
                c["y"] = json!(27);
            }
            let count = survivors.len();
            self.world["creatures"] = json!(survivors);
            increment(&mut self.world, "navRevision", 1.);
            self.sync_population();
            self.refresh_district();
            self.world["story"]["assessments"] = self.assessment();
            self.update_story();
            self.remember(
                "nuke",
                &format!(
                    "The world opened. {} lives ended; {} remain at the connection.",
                    format_count(lost),
                    count
                ),
                None,
            );
            if count == 0 {
                self.world["stage"] = json!(4);
            }
        }
        "We will remember.".into()
    }
    pub(crate) fn relocate(&mut self, id: &str, p: Point) -> Option<String> {
        let o = list(&self.world, "objects")
            .iter()
            .find(|o| text(o, "id") == id)
            .cloned()
            .or_else(|| self.natural_object(id));
        let Some(o) = o.filter(|o| text(o, "type") == "rock") else {
            return Some("Only a loose rock can be dragged this way.".into());
        };
        if !Geometry::new(&self.world).can_place("rock", p, Some(id), false) {
            return Some("There is no room for the rock there.".into());
        }
        let Some(mut saved) = self.materialize_object(&o) else {
            return Some("There is no room to save another change.".into());
        };
        saved["x"] = json!(p.x);
        saved["y"] = json!(p.y);
        let saved_id = text(&saved, "id").to_string();
        self.put_object(saved);
        increment(&mut self.world, "navRevision", 1.);
        increment(&mut self.world, "commandRevision", 1.);
        self.remember("relocate", "Moved a rock out of the way.", Some(&saved_id));
        None
    }
    pub(crate) fn connect_survivor(&mut self, id: &str) -> bool {
        let c = list(&self.world, "creatures")
            .iter()
            .find(|c| text(c, "id") == id)
            .cloned();
        if num(&self.world, "stage") != 3.
            || c.is_none()
            || !list(&self.world, "objects")
                .iter()
                .any(|o| text(o, "type") == "hole")
        {
            return false;
        }
        let c = c.unwrap();
        self.world["creatures"]
            .as_array_mut()
            .unwrap()
            .retain(|o| text(o, "id") != id);
        increment(&mut self.world["progress"], "uplinks", 1.);
        let departed =
            json!({"id":c["id"],"name":c["name"],"cause":"connection","tick":self.world["time"]});
        let entries = self.world["departed"].as_array_mut().unwrap();
        entries.push(departed);
        if entries.len() > 32 {
            entries.drain(..entries.len() - 32);
        }
        self.sync_population();
        increment(&mut self.world, "commandRevision", 1.);
        increment(&mut self.world, "revision", 1.);
        self.remember(
            "uplink",
            &format!("{} joined the connection.", text(&c, "name")),
            Some(id),
        );
        if num(&self.world["progress"], "uplinks") >= num(&self.world["progress"], "finalRequired")
        {
            self.world["stage"] = json!(4);
        }
        true
    }
    pub(crate) fn withdraw_material(&mut self, kind: &str) -> bool {
        let object = match kind {
            "wood" => "log",
            "bones" => "bone",
            "ore" => "ore",
            "corpses" => "corpse",
            _ => return false,
        };
        if self.world["ui"]["held"].is_object() || num(&self.world["inventory"], kind) == 0. {
            return false;
        }
        let amount =
            num(&self.world["inventory"], kind).min(if kind == "corpses" { 1. } else { 6. });
        increment(&mut self.world["inventory"], kind, -amount);
        self.world["ui"]["held"] = json!({"type":object,"stock":amount,"id":null});
        self.world["ui"]["tool"] = json!("grabber");
        increment(&mut self.world, "commandRevision", 1.);
        self.remember(
            "withdraw",
            &format!(
                "Took {} {} from storage to place in the world.",
                amount, kind
            ),
            None,
        );
        true
    }
    pub(crate) fn bridge_project(&self, selected: Option<&Value>) -> Option<Value> {
        let bridge = selected.or_else(|| {
            list(&self.world, "objects")
                .iter()
                .find(|o| text(o, "type") == "bridge")
        })?;
        let g = bridge_state(bridge);
        let a = Point::read(&g["a"]);
        let staged: f64 = list(&self.world, "objects")
            .iter()
            .filter(|o| {
                matches!(text(o, "type"), "log" | "bone")
                    && num(o, "stock") > 0.
                    && self.west_bank(Point::read(o)) == self.west_bank(a)
                    && Point::read(o).distance(a) < 8.
            })
            .map(|o| num(o, "stock"))
            .sum();
        let carried: f64 = list(&self.world, "creatures")
            .iter()
            .filter(|c| {
                num(c, "carry") > 0.
                    && matches!(text(c, "cargoKind"), "wood" | "bones")
                    && Point::read(c).distance(a) < 32.
            })
            .map(|c| num(c, "carry"))
            .sum();
        let delivered = num(&g["delivered"], "wood") + num(&g["delivered"], "bones");
        let remaining = (num(&g, "required") - delivered).max(0.);
        Some(
            json!({"id":bridge["id"],"required":g["required"],"delivered":delivered,"remaining":remaining,"wood":g["delivered"]["wood"],"bones":g["delivered"]["bones"],"staged":staged,"carried":carried,"complete":g["complete"],"needed":(remaining-staged-carried).max(0.)}),
        )
    }
    pub(crate) fn supply_bridge(&mut self, id: &str) -> String {
        let bridge = list(&self.world, "objects")
            .iter()
            .find(|o| text(o, "id") == id && text(o, "type") == "bridge")
            .cloned();
        let project = self.bridge_project(bridge.as_ref());
        if bridge.is_none() || project.as_ref().is_none_or(|p| flag(p, "complete")) {
            return "This crossing needs no more wood.".into();
        }
        let bridge = bridge.unwrap();
        let project = project.unwrap();
        if list(&self.world, "creatures").is_empty() {
            return "We need living carriers to build the bridge.".into();
        }
        let amount = num(&project, "needed")
            .min(num(&self.world["inventory"], "wood"))
            .floor();
        if amount == 0. {
            return if num(&project, "needed") > 0. {
                "Chop more trees to provide wood."
            } else {
                "There are already enough materials waiting at the crossing."
            }
            .into();
        }
        let g = bridge_state(&bridge);
        let point = self.free_position(Point::read(&g["a"]).offset(-2.7, -1.), &[], 4.);
        let Some(point) =
            point.filter(|p| self.west_bank(*p) && list(&self.world, "objects").len() < 2048)
        else {
            return "Clear some space on this bank for a wood pile.".into();
        };
        if self
            .add_object("log", point.x, point.y, json!({"stock":amount}))
            .is_none()
        {
            return "There is no room for another wood pile.".into();
        }
        increment(&mut self.world["inventory"], "wood", -amount);
        increment(&mut self.world, "commandRevision", 1.);
        self.remember(
            "bridge-supply",
            &format!("Set out {} stored wood for the river crossing.", amount),
            Some(id),
        );
        self.activity(
            "bridge",
            &format!("{} wood is waiting for carriers at the bridge.", amount),
            "You",
            "",
        );
        format!(
            "{} wood set out. We will carry it when our needs are met.",
            amount
        )
    }
    pub(crate) fn upgrade(&mut self, id: &str) -> String {
        let Some(mut o) = list(&self.world, "objects")
            .iter()
            .find(|o| text(o, "id") == id)
            .cloned()
        else {
            return "This structure cannot be upgraded.".into();
        };
        let threshold = upgrade_threshold(text(&o, "type"));
        if threshold == 0. || num(&o, "level") >= 2. {
            return "This structure cannot be upgraded.".into();
        }
        if num(&self.world["progress"], "peakBlocks") < threshold {
            return format!(
                "Discover {} blocks to unlock this upgrade.",
                format_count(threshold)
            );
        }
        let price = (threshold / 2.).floor();
        if num(&self.world["inventory"], "blocks") < price {
            return format!("The upgrade costs {} blocks.", format_count(price));
        }
        increment(&mut self.world["inventory"], "blocks", -price);
        o["level"] = json!(2);
        let kind = text(&o, "type").to_string();
        self.put_object(o);
        increment(&mut self.world, "navRevision", 1.);
        increment(&mut self.world, "commandRevision", 1.);
        self.remember(
            "upgrade",
            &format!("Upgraded {}.", display_name(&kind).to_lowercase()),
            None,
        );
        "A little more efficient.".into()
    }
    pub(crate) fn meteor_target_error(&self, p: Point) -> Option<String> {
        if num(&self.world, "stage") >= 3. {
            return Some("This story has reached the connection.".into());
        }
        if !(p.x + p.y).is_finite()
            || !self.ground(p)
            || (!flag(&self.world["progress"], "bridge") && !self.west_bank(p))
        {
            return Some("Aim at reachable ground.".into());
        }
        None
    }
    pub(crate) fn meteor_impact(&mut self, p: Point) -> Value {
        if let Some(message) = self.meteor_target_error(p) {
            return json!({"message":message});
        }
        let victims: Vec<_> = list(&self.world, "creatures")
            .iter()
            .filter(|c| Point::read(c).distance(p) <= 2.5)
            .cloned()
            .collect();
        let targets: Vec<_> = self
            .nearby_objects(p, 4.5)
            .into_iter()
            .filter(|o| {
                let kind = text(o, "type");
                !matches!(kind, "tnt" | "cannon")
                    && (matches!(kind, "tree" | "rock" | "stump" | "flowers" | "cricketball")
                        || !building_spec(kind).is_null())
                    && Point::read(o).distance(p) <= 2.5
            })
            .collect();
        let mut destroyed = 0;
        let mut blocked = 0;
        for o in &targets {
            if text(o, "type") == "tree" {
                let Some(mut o) = self.materialize_object(o) else {
                    blocked += 1;
                    continue;
                };
                o["type"] = json!("stump");
                self.put_object(o);
            } else {
                if !crate::terrain::clear_natural(&mut self.world, o) {
                    blocked += 1;
                    continue;
                }
                self.remove_object(text(o, "id"));
                increment(&mut self.world["inventory"], "ore", num(o, "inputOre"));
                if text(o, "type") == "mine" {
                    self.add_object("node",num(o,"x"),num(o,"y"),json!({"stock":o["stock"],"level":o["quality"].as_f64().filter(|v|*v!=0.).unwrap_or(1.)}));
                }
            }
            destroyed += 1;
        }
        let lost = self.die(&victims, "meteor", "caretaker");
        for c in self.world["creatures"].as_array_mut().unwrap() {
            if targets.iter().any(|o| same_id(&o["id"], &c["target"])) {
                c["task"] = json!("idle");
                c["target"] = Value::Null;
                c["job"] = Value::Null;
                c["work"] = json!(0);
            }
        }
        for project in self.work_projects() {
            if Point::read(&project).distance(p) <= 2.5 {
                self.remove_work_project(&project["id"]);
                self.world["community"]["lastProjectAt"] = self.world["time"].clone();
                self.activity(
                    "construction",
                    "The meteor destroyed our unfinished building.",
                    "You",
                    "",
                );
            }
        }
        increment(&mut self.world, "navRevision", 1.);
        increment(&mut self.world, "commandRevision", 1.);
        let detail = format!(
            "{} lives lost; {} trees, rocks or structures struck.",
            lost, destroyed
        );
        self.note_evidence(
            "meteor",
            &format!(
                "A meteor fell at ({}, {}). {}",
                js_round(p.x),
                js_round(p.y),
                detail
            ),
            1.,
            None,
        );
        self.remember("meteor", &detail, None);
        self.activity("meteor", &detail, "You", "");
        self.post_message(json!({"key":"meteor-first","title":"Something fell from the sky","text":if lost>0{"The same sky that gave us bananas took someone away. We remember who was here."}else{"Something fell from the sky. We saw what it could do to the world around us."}}));
        json!({"sound":"meteor","effect":{"type":"meteor","x":p.x,"y":p.y},"message":format!("{}{}",detail,if blocked>0{" Some ground could not be changed because the saved map is full."}else{""})})
    }
    pub(crate) fn current_goal(&self) -> Value {
        let progress = &self.world["progress"];
        let stage = num(&self.world, "stage");
        let population = num(&self.world, "population");
        if !flag(progress, "hatched") {
            return json!([
                "A LITTLE LANDING",
                "Tap the spacecraft. Someone has arrived."
            ]);
        }
        if population == 0. {
            return json!([
                "THE CLEARING IS QUIET",
                "Your story is saved. Start a new landing in Options."
            ]);
        }
        if stage == 4. {
            return json!([
                "JOURNEY RECORDED",
                "Open the colony journal to revisit this settlement."
            ]);
        }
        if stage == 3. {
            return json!([
                "MAKE A CONNECTION",
                "Drag the remaining creatures into the opening."
            ]);
        }
        if self.orbital_ready() {
            return json!(["ONE LAST CHANGE", "Visit the survey beacon."]);
        }
        if flag(progress, "cannon") {
            return json!([
                "A HOME ABOVE",
                format!(
                    "{} / 12 journeys to the orbital home. Tap IN ORBIT to visit.",
                    num(&self.world["orbital"], "launches").min(12.)
                )
            ]);
        }
        if flag(progress, "tnt") && !flag(progress, "secondContact") {
            return json!([
                "A NEW ROUTE",
                "Visit the survey beacon revealed near the mountain."
            ]);
        }
        if flag(progress, "tnt") {
            return json!([
                "BEYOND THE SKY",
                "Build a sky launcher. Grow an orbital home."
            ]);
        }
        if population >= 4. && !flag(progress, "bridge") {
            let detail = if let Some(p) = self.bridge_project(None) {
                format!(
                    "{}/{} delivered. {} Tap to find the crossing.",
                    num(&p, "delivered").floor(),
                    num(&p, "required"),
                    if num(&p, "carried") > 0. {
                        format!("{} being carried.", num(&p, "carried"))
                    } else if num(&p, "staged") > 0. {
                        "Materials are ready for carriers.".into()
                    } else {
                        "Chop trees or send stored wood.".into()
                    }
                )
            } else {
                "Chop trees. Your creatures will carry wood to the river.".into()
            };
            return json!(["BUILD THE BRIDGE", detail]);
        }
        if stage == 2. && num(progress, "peakBlocks") < 300. {
            return json!([
                "BRIGHTNESS IN THE STONE",
                if text(&self.world["community"], "consent") == "accepted" {
                    "Your independent crew can quarry rocks and work ore into blocks. A stone workshop unlocks at 300 blocks."
                } else {
                    "Take ore from its counter; hammer it into blocks. Unlock a stone workshop at 300 blocks."
                }
            ]);
        }
        if stage == 2. {
            return if num(progress, "energy") >= 1500000. {
                json!([
                    "THE MOUNTAIN",
                    "Place a demolition charge beside the mountain, then tap the charge."
                ])
            } else {
                json!([
                    "A NEW KIND OF WORLD",
                    "Mine ore. Make blocks. Reach 1.5M energy."
                ])
            };
        }
        if population < 4. {
            return json!([
                "GROW TRIPELKIN NUMBERS",
                "Keep each little one fed, clean and amused."
            ]);
        }
        json!([
            "WHAT LIES BEYOND?",
            "Chop trees. Your creatures will carry wood to the bridge."
        ])
    }
}

impl Engine {
    pub(crate) fn simulation_dispatch(
        &mut self,
        operation: &str,
        input: &Value,
    ) -> Result<Option<Value>, String> {
        let entity = input["entity"]
            .as_str()
            .or_else(|| input["entity"]["id"].as_str());
        let id = text(input, "id");
        let result = match operation {
            "simulation.reachable" => {
                let c = input
                    .get("creature")
                    .cloned()
                    .or_else(|| {
                        list(&self.world, "creatures")
                            .iter()
                            .find(|c| text(c, "id") == id)
                            .cloned()
                    })
                    .ok_or("Resident does not exist")?;
                let o = input
                    .get("object")
                    .cloned()
                    .or_else(|| {
                        list(&self.world, "objects")
                            .iter()
                            .find(|o| same_id(&o["id"], &input["target"]))
                            .cloned()
                    })
                    .ok_or("Object does not exist")?;
                json!(self.reachable(&c, &o))
            }
            "simulation.stepWorld" => {
                self.step_world(num(input, "dt"));
                Value::Null
            }
            "simulation.interact" => {
                let revision = num(&self.world, "commandRevision");
                let mut result = self.interact(
                    text(input, "tool"), num(input, "x"), num(input, "y"), entity,
                );
                // The live command tells presentation whether construction really
                // happened; failed placement must not play the success sound.
                if text(input, "tool").starts_with("build:") {
                    let placed = num(&self.world, "commandRevision") > revision;
                    result["placed"] = json!(placed);
                    if !placed { result.as_object_mut().unwrap().remove("sound"); }
                }
                result
            },
            "simulation.choose" => {
                json!(self.choose(text(input, "kind"), text(input, "answer"), entity))
            }
            "simulation.placeBuilding" => {
                json!(self.place_building(text(input, "type"), num(input, "x"), num(input, "y")))
            }
            "simulation.relocate" => json!(self.relocate(id, Point::read(&input["point"]))),
            "simulation.connectSurvivor" => json!(self.connect_survivor(id)),
            "simulation.withdrawMaterial" => json!(self.withdraw_material(text(input, "kind"))),
            "simulation.supplyBridge" => json!(self.supply_bridge(id)),
            "simulation.upgrade" => json!(self.upgrade(id)),
            "simulation.meteorImpact" => self.meteor_impact(Point::read(input)),
            "simulation.currentGoal" => self.current_goal(),
            "simulation.bridgeProject" => {
                let object = list(&self.world, "objects")
                    .iter()
                    .find(|o| text(o, "id") == id);
                self.bridge_project(object).unwrap_or(Value::Null)
            }
            "simulation.separateBodies" => {
                self.separate_bodies();
                Value::Null
            }
            "simulation.steerMove" => {
                let Some(mut c) = list(&self.world, "creatures")
                    .iter()
                    .find(|c| text(c, "id") == id)
                    .cloned()
                else {
                    return Err("Resident does not exist".into());
                };
                let moved = self.steer_move(&mut c, num(input, "dx"), num(input, "dy"));
                self.put_creature(c);
                json!(moved)
            }
            "population.stepCohorts" => {
                self.step_cohorts(num(input, "dt"));
                Value::Null
            }
            "population.syncPopulation" => {
                self.sync_population();
                Value::Null
            }
            "population.refreshDistrict" => {
                self.refresh_district();
                Value::Null
            }
            "population.launch" => {
                let Some(mut c) = list(&self.world, "creatures")
                    .iter()
                    .find(|c| text(c, "id") == id)
                    .cloned()
                else {
                    return Err("Resident does not exist".into());
                };
                let result = self.launch(&mut c);
                self.put_creature(c);
                json!(result)
            }
            "resources.pollutionAt" => json!(self.pollution_at(Point::read(input))),
            "resources.pollute" => {
                let Some(o) = list(&self.world, "objects")
                    .iter()
                    .find(|o| text(o, "id") == id)
                    .cloned()
                else {
                    return Err("Object does not exist".into());
                };
                self.pollute(&o, num(input, "amount"));
                Value::Null
            }
            "resources.cleanPollution" => {
                self.clean_pollution(Point::read(input));
                Value::Null
            }
            "resources.maintainFactory" => {
                let Some(o) = list(&self.world, "objects")
                    .iter()
                    .find(|o| text(o, "id") == id)
                    .cloned()
                else {
                    return Err("Object does not exist".into());
                };
                json!(self.maintain_factory(&o, num(input, "amount")))
            }
            "resources.deposit" => self
                .deposit(text(input, "type"), Point::read(input), num(input, "stock"))
                .unwrap_or(Value::Null),
            "resources.releaseCargo" => {
                let Some(mut c) = list(&self.world, "creatures")
                    .iter()
                    .find(|c| text(c, "id") == id)
                    .cloned()
                else {
                    return Err("Resident does not exist".into());
                };
                self.release_cargo(&mut c);
                self.put_creature(c);
                Value::Null
            }
            "resources.die" => {
                let victims: Vec<_> = list(&self.world, "creatures")
                    .iter()
                    .filter(|c| list(input, "ids").contains(&c["id"]))
                    .cloned()
                    .collect();
                json!(self.die(
                    &victims,
                    text(input, "cause"),
                    input["actor"].as_str().unwrap_or("caretaker")
                ))
            }
            "resources.deliver" | "resources.supplyProject" => {
                let Some(mut c) = list(&self.world, "creatures")
                    .iter()
                    .find(|c| text(c, "id") == id)
                    .cloned()
                else {
                    return Err("Resident does not exist".into());
                };
                let Some(mut o) = list(&self.world, "objects")
                    .iter()
                    .find(|o| same_id(&o["id"], &input["target"]))
                    .cloned()
                else {
                    return Err("Object does not exist".into());
                };
                let result = if operation == "resources.deliver" {
                    self.deliver(&mut c, &mut o);
                    Value::Null
                } else {
                    json!(self.supply_project(&mut c, &mut o))
                };
                self.put_creature(c);
                self.put_object(o);
                result
            }
            _ => return Ok(None),
        };
        Ok(Some(result))
    }
}
