//! Bounded obstruction requests and the first reachable clearing step.
use crate::{
    Engine,
    development::*,
    geometry::{BODY_RADIUS, Geometry, footprint, hits},
    value::*,
};
use serde_json::{Value, json};
use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashMap},
};
pub fn access_point(o: &Value, c: &Value) -> Point {
    let (fx, fy) = footprint(text(o, "type")).unwrap_or((0.3, 0.3));
    let dx = num(c, "x") - num(o, "x");
    let dy = num(c, "y") - num(o, "y");
    if dx.abs() > dy.abs() {
        Point::read(o).offset(if dx < 0. { -1. } else { 1. } * (fx + 0.6), 0.)
    } else {
        Point::read(o).offset(0., if dy < 0. { -1. } else { 1. } * (fy + 0.6))
    }
}
fn priority(r: &Value) -> f64 {
    if ["eat", "wash", "play", "home"].contains(&text(r, "task")) {
        110.
    } else if !r["project"].is_null() {
        100.
    } else {
        90.
    }
}
fn label(kind: &str) -> String {
    match kind {
        "tree" => "Timber oak",
        "rock" => "Rock",
        "node" => "Stone deposit",
        "log" => "Timber",
        "bone" => "Bones",
        "ore" => "Ore",
        "monolith" => "Survey beacon",
        "mountain" => "Mountain",
        "bridge" => "River bridge",
        "banana" => "Banana",
        "cricketball" => "Cricket ball",
        _ => building_name(kind),
    }
    .to_lowercase()
}
impl Engine {
    pub fn clearance_enabled(&self) -> bool {
        self.independent() && !flag(&self.world["directives"], "pauseWork")
    }
    fn access_capable(&self, c: &Value) -> bool {
        num(c, "carry") == 0.
            && num(c, "sickness") < 50.
            && minimum(c) >= 45.
            && (list(&self.world["directives"], "members").is_empty()
                || list(&self.world["directives"], "members")
                    .iter()
                    .any(|id| same_id(id, &c["id"])))
    }
    fn access_region(&self, p: Point) -> bool {
        !self.world["directives"]["region"].is_object()
            || (p.x > 42.) == (num(&self.world["directives"]["region"], "x") > 42.)
    }
    fn access_object(&mut self, id: &Value) -> Option<Value> {
        list(&self.world, "objects")
            .iter()
            .find(|o| same_id(&o["id"], id))
            .cloned()
            .or_else(|| id.as_str().and_then(|id| self.natural_object(id)))
    }
    pub fn clearance_task(&self, c: &Value) -> Option<Value> {
        if !self.clearance_enabled() || !self.access_capable(c) {
            return None;
        }
        let r = list(&self.world["community"], "access").iter().find(|r| {
            text(r, "status") == "clearing"
                && list(r, "crew").iter().any(|id| same_id(id, &c["id"]))
        })?;
        let o = list(&self.world, "objects")
            .iter()
            .find(|o| same_id(&o["id"], &r["blocker"]))?;
        if self.access_region(Point::read(o)) && ["tree", "rock"].contains(&text(o, "type")) {
            Some(json!({"target":o["id"],"task":if text(o,"type")=="tree"{"gather"}else{"quarry"}}))
        } else {
            None
        }
    }
    pub fn request_access(&mut self, details: Value) {
        if !details["point"].is_object()
            || !self.is_explored(Point::read(&details["point"]))
            || !self.access_region(Point::read(&details["point"]))
        {
            return;
        }
        let Some(c) = list(&self.world, "creatures")
            .iter()
            .find(|c| same_id(&c["id"], &details["unit"]))
            .cloned()
        else {
            return;
        };
        let mut project = details["project"].clone();
        if project.is_null()
            && ["gather", "quarry", "construct", "refine", "haul"].contains(&text(&details, "task"))
            && let Some(p) = self.worker_project(&c)
        {
            project = p["id"].clone();
        }
        let destination = self.access_object(&details["target"]);
        let points = destination
            .as_ref()
            .map(|o| self.service_slots(o, Some(Point::read(&c))))
            .unwrap_or_else(|| vec![details["point"].clone()]);
        if points
            .iter()
            .any(|p| self.route_cost(Point::read(&c), Point::read(p)).is_finite())
        {
            return;
        }
        let key = details["target"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| {
                if !project.is_null() {
                    format!("project:{}", scalar_string(&project))
                } else {
                    format!(
                        "ground:{}:{}",
                        num(&details["point"], "x").js_round(),
                        num(&details["point"], "y").js_round()
                    )
                }
            });
        let now = self.world["time"].clone();
        if let Some(i) = list(&self.world["community"], "access")
            .iter()
            .position(|r| text(r, "key") == key)
        {
            let r = &mut self.world["community"]["access"][i];
            r["lastSeen"] = now;
            if r["project"].is_null() && !project.is_null() {
                r["project"] = project;
                r["task"] = details["task"].clone();
                r["unit"] = details["unit"].clone();
                increment(&mut self.world, "revision", 1.);
            }
            return;
        }
        if list(&self.world["community"], "access").len() >= 8 {
            return;
        }
        let name = destination
            .as_ref()
            .map(|o| label(text(o, "type")))
            .unwrap_or_else(|| {
                if !project.is_null() {
                    "building site".into()
                } else {
                    "new ground".into()
                }
            });
        let reason = details["reason"].as_str().unwrap_or("No clear path");
        let r = json!({"id":self.world["community"]["nextAccess"],"key":key,"target":details["target"],"point":{"x":details["point"]["x"],"y":details["point"]["y"]},"unit":details["unit"],"task":details["task"],"project":project,"label":name,"reason":reason,"created":now,"lastSeen":now,"checked":-10,"status":"waiting","blocker":null,"crew":[],"source":"","notified":false});
        increment(&mut self.world["community"], "nextAccess", 1.);
        self.world["community"]["access"]
            .as_array_mut()
            .unwrap()
            .push(r);
        self.activity(
            "blocked",
            &format!("{} needs a route to the {name}.", text(&c, "name")),
            "Instincts",
            reason,
        );
        self.remember(
            "blocked",
            &format!(
                "{} cannot reach the {name}; looking for a way through.",
                text(&c, "name")
            ),
            details["unit"].as_str(),
        );
        increment(&mut self.world, "revision", 1.);
    }
    pub fn access_purpose(&self, r: &Value) -> String {
        let task = match text(r, "task") {
            "gather" => "gather timber",
            "quarry" => "collect ore",
            "mine" => "mine ore",
            "work" => "make blocks",
            "haul" => "deliver materials",
            "eat" => "get food",
            "wash" => "wash",
            "play" => "play",
            "home" => "rest",
            "construct" => "build",
            "explore" => "explore",
            "refine" => "working ore into blocks",
            "clean" => "caring for the clearing",
            "social" => "spending time together",
            "rest" => "resting",
            "orbit" => "going to orbit",
            "idle" => "looking around",
            _ => "continue work",
        };
        if let Some(p) = projects(&self.world)
            .into_iter()
            .find(|p| same_id(&p["id"], &r["project"]))
        {
            let name = match text(p, "type") {
                "timber" => "the wood reserve",
                "quarry" => "the ore reserve",
                "refine" => "the block reserve",
                "crossing" => "the river bridge",
                kind => building_name(kind),
            };
            format!("{task} for {name}")
        } else {
            task.into()
        }
    }
    fn save_access(&mut self, r: Value) {
        if let Some(i) = list(&self.world["community"], "access")
            .iter()
            .position(|a| same_id(&a["id"], &r["id"]))
        {
            self.world["community"]["access"][i] = r;
        }
    }
    fn remove_access(&mut self, r: &Value, resolved: bool) {
        self.world["community"]["access"]
            .as_array_mut()
            .unwrap()
            .retain(|a| !same_id(&a["id"], &r["id"]));
        if resolved {
            let source = r["source"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("Instincts");
            self.activity(
                "unblocked",
                &format!("The path to the {} is open again.", text(r, "label")),
                source,
                "",
            );
            self.remember(
                "unblocked",
                &format!("The colony can reach the {} again.", text(r, "label")),
                None,
            );
            if flag(r, "notified") {
                self.post_message(json!({"key":format!("access-open:{}",scalar_string(&r["id"])),"category":"work","title":"There is a way through now","text":format!("The path to the {} near {}, {} is open. We can try {} again. We will check the route before sending the next worker.",text(r,"label"),num(&r["point"],"x").js_round(),num(&r["point"],"y").js_round(),self.access_purpose(r))}));
            }
        }
        increment(&mut self.world, "revision", 1.);
    }
    fn ask_access_help(&mut self, r: &mut Value, message: &str) {
        if text(r, "status") == "help" {
            r["reason"] = json!(message);
        }
        if flag(r, "notified") || num(&self.world, "time") - num(r, "created") < 12. {
            return;
        }
        let name = list(&self.world, "creatures")
            .iter()
            .find(|c| same_id(&c["id"], &r["unit"]))
            .map(|c| text(c, "name"))
            .unwrap_or("One of our workers");
        let text = format!(
            "{name} is trying to {}, but cannot reach the {} near {}, {}. {message}",
            self.access_purpose(r),
            text(r, "label"),
            num(&r["point"], "x").js_round(),
            num(&r["point"], "y").js_round()
        );
        self.post_message(json!({"key":format!("access:{}",scalar_string(&r["id"])),"title":"Could you help us get through?","category":"help","text":text}));
        r["notified"] = json!(true);
    }
    fn clearing_step(&mut self, c: &Value, to: Point) -> Option<Value> {
        let origin = Point::read(c);
        if origin.distance(to) > 64. {
            return None;
        }
        let cell = 0.75;
        let ox = ((origin.x.min(to.x) - 5.) / cell).floor() * cell;
        let oy = ((origin.y.min(to.y) - 5.) / cell).floor() * cell;
        let width = 104_usize.min(((origin.x.max(to.x) + 5. - ox) / cell).ceil() as usize + 1);
        let height = 104_usize.min(((origin.y.max(to.y) + 5. - oy) / cell).ceil() as usize + 1);
        let count = width * height;
        let index = |p: Point| {
            ((p.y - oy) / cell).js_round() as i64 * width as i64
                + ((p.x - ox) / cell).js_round() as i64
        };
        let start = index(origin);
        let end = index(to);
        if start < 0 || end < 0 || start >= count as i64 || end >= count as i64 {
            return None;
        }
        let (start, end) = (start as usize, end as usize);
        let geom = Geometry::new(&self.world);
        let objects = geom.obstacles(
            Point {
                x: ox + width as f64 * cell / 2.,
                y: oy + height as f64 * cell / 2.,
            },
            crate::value::js_hypot(width as f64, height as f64) * cell / 2. + 4.,
        );
        let mut cost = vec![1_u8; count];
        let mut labels: HashMap<usize, Vec<Value>> = HashMap::new();
        for y in 0..height {
            for x in 0..width {
                let p = Point {
                    x: ox + x as f64 * cell,
                    y: oy + y as f64 * cell,
                };
                if !geom.walkable(p, BODY_RADIUS) || !self.is_explored(p) || !self.access_region(p)
                {
                    cost[y * width + x] = 255;
                }
            }
        }
        for o in objects {
            let Some((fx, fy)) = footprint(&o.kind) else {
                continue;
            };
            let removable = ["tree", "rock"].contains(&o.kind.as_str()) && self.is_explored(o.p);
            let x0 = ((o.p.x - fx - BODY_RADIUS - ox) / cell).floor().max(0.) as usize;
            let x1 = ((o.p.x + fx + BODY_RADIUS - ox) / cell)
                .ceil()
                .min(width as f64 - 1.) as usize;
            let y0 = ((o.p.y - fy - BODY_RADIUS - oy) / cell).floor().max(0.) as usize;
            let y1 = ((o.p.y + fy + BODY_RADIUS - oy) / cell)
                .ceil()
                .min(height as f64 - 1.) as usize;
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let i = y * width + x;
                    if i >= count
                        || !hits(
                            Point {
                                x: ox + x as f64 * cell,
                                y: oy + y as f64 * cell,
                            },
                            BODY_RADIUS + 0.08,
                            &o,
                        )
                    {
                        continue;
                    }
                    if !removable {
                        cost[i] = 255;
                    } else if cost[i] != 255 {
                        cost[i] = 24;
                        labels.entry(i).or_default().push(o.data.as_ref().clone());
                    }
                }
            }
        }
        if cost[start] == 255 || cost[end] == 255 {
            return None;
        }
        let mut distances = vec![u32::MAX; count];
        let mut previous = vec![usize::MAX; count];
        let mut heap = BinaryHeap::new();
        let mut serial = 0_usize;
        distances[start] = 0;
        heap.push(Reverse((0_u32, serial, start)));
        while let Some(Reverse((d, _, i))) = heap.pop() {
            if d != distances[i] {
                continue;
            }
            if i == end {
                break;
            }
            let x = i % width;
            let y = i / width;
            for next in [
                if x > 0 { Some(i - 1) } else { None },
                if x < width - 1 { Some(i + 1) } else { None },
                if y > 0 { Some(i - width) } else { None },
                if y < height - 1 {
                    Some(i + width)
                } else {
                    None
                },
            ]
            .into_iter()
            .flatten()
            {
                if cost[next] == 255 {
                    continue;
                }
                let score = d + u32::from(cost[next]);
                if score >= distances[next] {
                    continue;
                }
                distances[next] = score;
                previous[next] = i;
                serial += 1;
                heap.push(Reverse((score, serial, next)));
            }
        }
        if distances[end] == u32::MAX {
            return None;
        }
        let mut path = Vec::new();
        let mut i = end;
        while i != start && i != usize::MAX {
            path.push(i);
            i = previous[i];
        }
        for i in path.into_iter().rev() {
            for o in labels.get(&i).into_iter().flatten() {
                if self
                    .service_slots(o, Some(origin))
                    .iter()
                    .any(|p| self.route_cost(origin, Point::read(p)).is_finite())
                {
                    return Some(o.clone());
                }
            }
        }
        None
    }
    pub fn review_access(&mut self) {
        if list(&self.world["community"], "access").is_empty()
            || num(&self.world, "time") < num(&self.world["runtime"], "nextAccessReview")
        {
            return;
        }
        self.world["runtime"]["nextAccessReview"] = json!(num(&self.world, "time") + 6.);
        let mut r = list(&self.world["community"], "access")
            .iter()
            .min_by(|a, b| num(a, "checked").total_cmp(&num(b, "checked")))
            .unwrap()
            .clone();
        r["checked"] = self.world["time"].clone();
        let target = self.access_object(&r["target"]);
        if !r["target"].is_null() && target.is_none()
            || !r["project"].is_null()
                && !projects(&self.world)
                    .iter()
                    .any(|p| same_id(&p["id"], &r["project"]))
            || num(&self.world, "time") - num(&r, "lastSeen") > 180.
            || !self.access_region(Point::read(&r["point"]))
        {
            self.remove_access(&r, false);
            return;
        }
        let requester = list(&self.world, "creatures")
            .iter()
            .find(|c| same_id(&c["id"], &r["unit"]));
        let mut workers: Vec<_> = list(&self.world, "creatures")
            .iter()
            .filter(|c| {
                self.access_capable(c)
                    && Point::read(c).distance(Point::read(&r["point"])) <= 64.
                    && requester.is_none_or(|who| {
                        same_id(&c["id"], &who["id"])
                            || Point::read(c).distance(Point::read(who)) < 12.
                    })
            })
            .cloned()
            .collect();
        workers.sort_by(|a, b| {
            Point::read(a)
                .distance(Point::read(&r["point"]))
                .total_cmp(&Point::read(b).distance(Point::read(&r["point"])))
        });
        workers.truncate(4);
        let points = target
            .as_ref()
            .map(|o| {
                self.service_slots(
                    o,
                    Some(
                        workers
                            .first()
                            .map(Point::read)
                            .unwrap_or(Point::read(&r["point"])),
                    ),
                )
            })
            .unwrap_or_else(|| vec![r["point"].clone()]);
        if workers.iter().any(|c| {
            points
                .iter()
                .any(|p| self.route_cost(Point::read(c), Point::read(p)).is_finite())
        }) {
            self.remove_access(&r, true);
            return;
        }
        if workers.is_empty() {
            r["status"] = json!("help");
            self.ask_access_help(
                &mut r,
                "We need rested workers nearby and care on this side of the river.",
            );
            self.save_access(r);
            return;
        }
        let current = self.access_object(&r["blocker"]);
        if text(&r, "status") == "clearing"
            && self.clearance_enabled()
            && let Some(current) = current
            && ["tree", "rock"].contains(&text(&current, "type"))
        {
            let crew: Vec<_> = list(&self.world, "creatures")
                .iter()
                .filter(|c| {
                    list(&r, "crew").iter().any(|id| same_id(id, &c["id"]))
                        && self.access_capable(c)
                })
                .cloned()
                .collect();
            if crew.iter().any(|c| {
                self.service_slots(&current, Some(Point::read(c)))
                    .iter()
                    .any(|p| self.route_cost(Point::read(c), Point::read(p)).is_finite())
            }) {
                r["lastSeen"] = self.world["time"].clone();
                self.save_access(r);
                return;
            }
        }
        r["crew"] = json!([]);
        r["blocker"] = Value::Null;
        let p = points.first().map(Point::read).unwrap_or_else(|| {
            target
                .as_ref()
                .map(|o| access_point(o, &workers[0]))
                .unwrap_or(Point::read(&r["point"]))
        });
        if let Some(blocker) = self.clearing_step(&workers[0], p) {
            r["blocker"] = blocker["id"].clone();
            r["status"] = json!("ready");
            r["reason"] = json!(format!(
                "Clear a {} at {}, {} to reach the {}.",
                text(&blocker, "type"),
                num(&blocker, "x").js_round(),
                num(&blocker, "y").js_round(),
                text(&r, "label")
            ));
            let message = if !self.clearance_enabled() {
                "Trees or rocks block our route. Allow independence and enable intelligence in Options so we can clear a path, or use the axe or hammer to help us."
            } else {
                "Trees or rocks block our route. We are asking the colony to choose a clearing crew so we can continue."
            };
            self.ask_access_help(&mut r, message);
        } else {
            r["status"] = json!("help");
            let message = if !flag(&self.world["progress"], "bridge")
                && num(&workers[0], "x") < 42.
                && num(&r["point"], "x") > 42.
            {
                "We need the river bridge completed before we can reach the other bank."
            } else {
                "We cannot find a safe clearing route. Please open space around the destination with the axe or hammer, or move a building blocking its entrance."
            };
            self.ask_access_help(&mut r, message);
        }
        self.save_access(r);
    }
    pub fn clearance_choices(&mut self) -> Vec<Value> {
        if !self.clearance_enabled() {
            return Vec::new();
        }
        let mut requests: Vec<_> = list(&self.world["community"], "access")
            .iter()
            .filter(|r| text(r, "status") == "ready" && !r["blocker"].is_null())
            .cloned()
            .collect();
        requests.sort_by(|a, b| {
            priority(b)
                .total_cmp(&priority(a))
                .then(num(a, "created").total_cmp(&num(b, "created")))
        });
        requests.into_iter().take(2).map(|r|{let object=self.access_object(&r["blocker"]);json!({"id":"clearance","key":format!("clearance_{}",scalar_string(&r["id"])),"request":r["id"],"blocker":r["blocker"],"x":r["point"]["x"],"y":r["point"]["y"],"priority":priority(&r),"subgoal":format!("access:{}",scalar_string(&r["id"])),"description":format!("{} This unblocks {}.",text(&r,"reason"),self.access_purpose(&r)),"task":r["task"],"project":r["project"],"obstacle":object.map(|o|o["type"].clone()),"resume":self.access_purpose(&r)})}).collect()
    }
    pub fn start_clearance(&mut self, choice: &Value, source: &str) -> bool {
        if !self.clearance_enabled() {
            return false;
        }
        let Some(mut r) = list(&self.world["community"], "access")
            .iter()
            .find(|r| {
                same_id(&r["id"], &choice["request"])
                    && same_id(&r["blocker"], &choice["blocker"])
                    && text(r, "status") == "ready"
            })
            .cloned()
        else {
            return false;
        };
        let Some(o) = self.access_object(&r["blocker"]) else {
            return false;
        };
        if !["tree", "rock"].contains(&text(&o, "type")) || !self.access_region(Point::read(&o)) {
            return false;
        }
        let mut candidates: Vec<_> = list(&self.world, "creatures")
            .iter()
            .filter(|c| {
                self.access_capable(c)
                    && !working(c)
                    && worker_project(&self.world, c)
                        .is_none_or(|p| same_id(&p["id"], &r["project"]))
                    && !list(&self.world["community"], "access").iter().any(|a| {
                        !same_id(&a["id"], &r["id"])
                            && text(a, "status") == "clearing"
                            && list(a, "crew").iter().any(|id| same_id(id, &c["id"]))
                    })
            })
            .cloned()
            .collect();
        candidates.sort_by(work_order);
        let Some(c) = candidates.into_iter().find(|c| {
            self.service_slots(&o, Some(Point::read(c)))
                .iter()
                .any(|p| self.route_cost(Point::read(c), Point::read(p)).is_finite())
        }) else {
            return false;
        };
        let Some(saved) = self.materialize_object(&o) else {
            return false;
        };
        r["blocker"] = saved["id"].clone();
        r["status"] = json!("clearing");
        r["crew"] = json!([c["id"]]);
        r["source"] = json!(source);
        r["lastSeen"] = self.world["time"].clone();
        self.record_work(&c["id"]);
        increment(&mut self.world, "commandRevision", 1.);
        increment(&mut self.world, "revision", 1.);
        self.activity(
            "clearance",
            &format!(
                "{} will open the path to the {}.",
                text(&c, "name"),
                text(&r, "label")
            ),
            source,
            text(&r, "reason"),
        );
        self.remember(
            "clearance",
            &format!(
                "{source} assigned {} to {}",
                text(&c, "name"),
                text(&r, "reason").to_lowercase()
            ),
            c["id"].as_str(),
        );
        self.save_access(r);
        true
    }
    pub fn access_brief(&mut self) -> String {
        let mut requests = list(&self.world["community"], "access").to_vec();
        requests.sort_by(|a, b| {
            priority(b)
                .total_cmp(&priority(a))
                .then(num(a, "created").total_cmp(&num(b, "created")))
        });
        let Some(r) = requests
            .iter()
            .find(|r| text(r, "status") == "ready")
            .or_else(|| requests.first())
        else {
            return String::new();
        };
        let object = self.access_object(&r["blocker"]);
        let project = projects(&self.world)
            .into_iter()
            .find(|p| same_id(&p["id"], &r["project"]));
        format!(
            "Blocked {}{}: {}. {}",
            text(r, "task"),
            project.map_or(String::new(), |p| format!(" for {}", text(p, "type"))),
            text(r, "status"),
            object.map_or(
                "Needs a safe route or rested crew; do not repeat the blocked journey.".into(),
                |o| format!(
                    "{} {}; then resume {}.",
                    if text(r, "status") == "clearing" {
                        "Crew clearing"
                    } else {
                        "Clear"
                    },
                    text(&o, "type"),
                    text(r, "task")
                )
            )
        )
    }
    pub fn access_context(&mut self) -> Value {
        let mut requests = list(&self.world["community"], "access").to_vec();
        requests.sort_by(|a, b| {
            priority(b)
                .total_cmp(&priority(a))
                .then(num(a, "created").total_cmp(&num(b, "created")))
        });
        json!(requests.into_iter().take(8).map(|r|{let o=self.access_object(&r["blocker"]);let step=if text(&r,"status")=="clearing"{"Finish the assigned clearing step, then check the route again."}else if text(&r,"status")=="ready"{if self.clearance_enabled(){"Choose the matching clearance option. Keep the parent project; replan its route after removal."}else{"Ask for independence, intelligence or work permission before assigning clearance."}}else{text(&r,"reason")};json!({"id":r["id"],"target":r["label"],"at":[num(&r["point"],"x").js_round(),num(&r["point"],"y").js_round()],"status":r["status"],"task":r["task"],"project":r["project"],"purpose":self.access_purpose(&r),"reason":r["reason"],"blocker":r["blocker"],"crew":list(&r,"crew").len(),"prerequisite":o.map(|o|json!({"action":if text(&o,"type")=="tree"{"gather"}else{"quarry"},"object":o["id"],"type":o["type"],"at":[num(&o,"x").js_round(),num(&o,"y").js_round()]})),"nextStep":step,"resume":{"task":r["task"],"target":r["target"],"project":r["project"]}})}).collect::<Vec<_>>())
    }
}
