use crate::{Engine, development::*, exploration::west_bank, value::*};
use serde_json::{Value, json};
use std::collections::HashSet;
pub const GOAL_KINDS: [&str; 6] = ["care", "grow", "bridge", "wood", "ore", "blocks"];
pub fn goal_options() -> Value {
    json!({"none":"Conversation or unsupported request","care":"Keep the colony healthy","grow":"Grow the population","bridge":"Finish the river bridge","wood":"Collect and store wood","ore":"Mine and stockpile ore","blocks":"Produce and store cut stone"})
}
fn closed(g: &Value) -> bool {
    ["completed", "cancelled"].contains(&text(g, "status"))
}
fn latest_closed(input: &[Value]) -> Vec<Value> {
    let mut gs: Vec<_> = input.iter().filter(|g| closed(g)).cloned().collect();
    gs.sort_by(|a, b| {
        let tick = |g: &Value| {
            if js_number(&g["completedAt"]).is_finite() && js_number(&g["completedAt"]) != 0. {
                js_number(&g["completedAt"])
            } else if js_number(&g["createdAt"]).is_finite() {
                js_number(&g["createdAt"])
            } else {
                0.
            }
        };
        tick(a).total_cmp(&tick(b))
    });
    gs.into_iter().rev().take(12).collect()
}
fn clip(v: &Value, low: f64, high: f64) -> f64 {
    {
        let n = js_number(v);
        if n.is_finite() {
            n.clamp(low, high)
        } else {
            low
        }
    }
}
fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
fn formatted(n: f64) -> String {
    let s = format!("{}", n);
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}
pub fn goal_title(g: &Value) -> String {
    let target = num(g, "target");
    match text(g, "kind") {
        "care" => format!("Keep needs above {target}%"),
        "grow" => format!("Grow to {} Tripelkins", formatted(target)),
        "bridge" => "Finish the river bridge".into(),
        "wood" => format!("Store {} wood", formatted(target)),
        "ore" => format!("Stockpile {} ore", formatted(target)),
        "blocks" => format!("Save {} stone blocks", formatted(target)),
        _ => String::new(),
    }
}
pub fn normalize_goals(raw: &Value) -> Value {
    let Some(input) = raw.as_array() else {
        return json!([]);
    };
    let recent = latest_closed(input);
    let mut ids = HashSet::new();
    let (mut active, mut live, mut history) = (false, 0, 0);
    let mut result = Vec::new();
    for g in input.iter().skip(input.len().saturating_sub(40)) {
        if !GOAL_KINDS.contains(&text(g, "kind"))
            || !g["id"].is_string()
            || ids.contains(text(g, "id"))
            || !["active", "queued", "paused", "completed", "cancelled"]
                .contains(&text(g, "status"))
        {
            continue;
        }
        ids.insert(text(g, "id").to_owned());
        if closed(g) {
            if !recent.contains(g) {
                continue;
            }
            history += 1;
            if history > 12 {
                continue;
            }
        } else {
            live += 1;
            if live > 8 {
                continue;
            }
        }
        let mut status = text(g, "status");
        if status == "active" {
            status = if active { "queued" } else { "active" };
            active = true;
        }
        let reviews = list(g, "reviews");
        let reviews:Vec<_>=reviews.iter().skip(reviews.len().saturating_sub(8)).filter(|r|["care","balanced","expand","build","industry","mine"].contains(&text(r,"policy"))).map(|r|json!({"tick":clip(&r["tick"],0.,1e12),"policy":r["policy"],"reason":cut(text(r,"reason"),240),"source":cut(text(r,"source"),80)})).collect();
        result.push(json!({"id":cut(text(g,"id"),40),"kind":g["kind"],"target":if text(g,"kind")=="bridge"{24.}else{clip(&g["target"],if text(g,"kind")=="care"{50.}else{1.},if text(g,"kind")=="care"{95.}else{1e6}).js_round()},"command":cut(text(g,"command"),500),"source":cut(g["source"].as_str().filter(|s|!s.is_empty()).unwrap_or("Saved objective"),80),"status":status,"createdAt":clip(&g["createdAt"],0.,1e12),"completedAt":if g["completedAt"].is_null(){Value::Null}else{json!(clip(&g["completedAt"],0.,1e12))},"reviews":reviews}));
    }
    json!(result)
}
impl Engine {
    pub fn active_goal(&self) -> Option<Value> {
        list(&self.world["memory"], "goals")
            .iter()
            .find(|g| text(g, "status") == "active")
            .cloned()
    }
    pub fn goal_target(&self, kind: &str, requested: f64) -> f64 {
        if kind == "bridge" {
            return 24.;
        }
        let default = match kind {
            "care" => 75.,
            "grow" => (num(&self.world, "population") * 1.5).ceil().max(6.),
            "wood" => (num(&self.world["inventory"], "wood").floor() + 24.).max(48.),
            "ore" => num(&self.world["inventory"], "ore").floor() + 20.,
            _ => num(&self.world["inventory"], "blocks").floor() + 100.,
        };
        (if requested > 0. { requested } else { default })
            .clamp(
                if kind == "care" { 50. } else { 1. },
                if kind == "care" { 95. } else { 1e6 },
            )
            .js_round()
    }
    pub fn inspect_goal(&mut self, g: &Value) -> Value {
        let members = list(&self.world, "creatures");
        let needs = if members.is_empty() {
            0.
        } else {
            members.iter().map(minimum).fold(f64::INFINITY, f64::min)
        };
        let bridge = list(&self.world, "objects")
            .iter()
            .find(|o| text(o, "type") == "bridge");
        let nearby = |o: &Value| {
            members.iter().any(|c| {
                Point::read(c).distance(Point::read(o)) <= 64.
                    && (flag(&self.world["progress"], "bridge")
                        || west_bank(&self.world, Point::read(c))
                            == west_bank(&self.world, Point::read(o)))
            })
        };
        let stock = |types: &[&str]| {
            list(&self.world, "objects")
                .iter()
                .any(|o| types.contains(&text(o, "type")) && num(o, "stock") > 0. && nearby(o))
        };
        let has = |types: &[&str]| {
            list(&self.world, "objects")
                .iter()
                .any(|o| types.contains(&text(o, "type")) && nearby(o))
        };
        let kind = text(g, "kind");
        let target = num(g, "target");
        let value = match kind {
            "care" => needs.js_round(),
            "grow" => num(&self.world, "population"),
            "bridge" => {
                if flag(&self.world["progress"], "bridge") {
                    24.
                } else {
                    bridge.map_or(0., |o| num(o, "stock"))
                }
            }
            _ => num(&self.world["inventory"], kind).floor(),
        };
        let missing = if !stock(&["banana", "orchard"]) && !has(&["dwelling"]) {
            "Drop bananas or provide a stocked banana tree."
        } else if !has(&["bath", "dwelling"]) {
            "Wash creatures with the cloth or build a bathtub."
        } else if !has(&["cricketball", "roundabout", "theatre"]) {
            "Place a cricket ball or a shared play facility."
        } else {
            ""
        };
        let mut policy;
        let mut step: String;
        let mut blocker = String::new();
        let mut paths: Vec<String> = match kind {
            "care" => vec![
                "Provide food, washing and play".into(),
                format!("Raise everyone’s needs above {target}%"),
                "Maintain those needs as the colony changes".into(),
            ],
            "grow" => vec![
                "Provide enough shared care".into(),
                "Keep needs above 65% so creatures replicate".into(),
                format!("Reach {} total creatures", formatted(target)),
            ],
            "bridge" => vec![
                "Chop trees or send stored wood from the bridge panel".into(),
                "Assign carriers while meeting urgent needs".into(),
                "Deliver 24 logs to finish the bridge".into(),
            ],
            "wood" => vec![
                "Finish the bridge first".into(),
                "Chop trees to supply loose logs".into(),
                format!("Carry spare logs into a {target} wood reserve"),
            ],
            "ore" => vec![
                "Finish the bridge to reach the ore deposits".into(),
                "Place a mine on an ore node".into(),
                format!("Prioritize miners until the reserve reaches {target}"),
            ],
            _ => vec![
                "Unlock industry and provide a mine".into(),
                "Provide a factory and a supply of ore".into(),
                format!("Make blocks until the reserve reaches {target}"),
            ],
        };
        if ["care", "grow"].contains(&kind) {
            policy = "care";
            step = if kind == "care" {
                if value >= target {
                    "Maintain care as needs change."
                } else {
                    "Raise food, cleanliness and play together."
                }
            } else {
                "Keep everyone comfortable enough to replicate."
            }
            .into();
            blocker = missing.into();
        } else if ["bridge", "wood"].contains(&kind) {
            policy = "build";
            step = if !flag(&self.world["progress"], "bridge") {
                "Carry loose logs to the bridge."
            } else {
                "Deliver spare logs into the wood reserve."
            }
            .into();
            if !stock(&["log", "bone"]) && !members.iter().any(|c| num(c, "carry") > 0.) {
                blocker = if num(&self.world["inventory"], "wood") > 0.
                    && !flag(&self.world["progress"], "bridge")
                {
                    "Send stored wood from the bridge panel, or place it from the wood counter."
                } else {
                    "Chop trees with the axe to supply loose logs for the carriers."
                }
                .into();
            }
        } else {
            policy = if kind == "ore" { "mine" } else { "industry" };
            step = if kind == "ore" {
                "Stockpile ore; reserve it from factory use."
            } else {
                "Mine ore and turn it into blocks at factories."
            }
            .into();
            if !flag(&self.world["progress"], "bridge") {
                policy = "build";
                step = "Complete the bridge to reach industry.".into();
                if !stock(&["log", "bone"]) {
                    blocker = "Chop trees to supply the bridge with logs.".into();
                }
            } else if num(&self.world, "stage") < 2. {
                blocker = "Finish the river crossing to unlock industry.".into();
            } else if !stock(&["mine"])
                && !(kind == "blocks" && num(&self.world["inventory"], "ore") > 0.)
            {
                blocker =
                    "Place a mine on an ore node. Workers need a stocked, reachable mine.".into();
            } else if kind == "blocks" && !has(&["factory"]) {
                blocker = "Place a factory to turn mined ore into blocks.".into();
            }
        }
        let independent = text(&self.world["community"], "consent") == "accepted"
            && self.world["settings"]["autonomy"] != json!(false)
            && flag(&self.world["runtime"], "intelligenceAvailable");
        if independent && !members.is_empty() && ["care", "grow"].contains(&kind) {
            if !missing.is_empty() {
                step="Choose needed care facilities, gather timber and build near the residents who need them.".into();
            }
            blocker = projects(&self.world)
                .iter()
                .find(|p| !text(p, "blocked").is_empty())
                .map_or("", |p| text(p, "blocked"))
                .into();
            if kind == "grow" {
                paths = vec![
                    "Provide care for the next generation".into(),
                    "Scout new ground and build spaced care outposts".into(),
                    "Keep everyone comfortable and welcome new lives steadily".into(),
                ];
            }
        }
        if independent && !members.is_empty() && ["wood", "ore", "bridge", "blocks"].contains(&kind)
        {
            step = match kind {
                "wood" => "Cut trees and collect timber for the requested reserve.",
                "ore" => "Quarry rocks and collect ore; reserve it from processing.",
                "bridge" => "Gather timber and carry stored wood to the crossing.",
                _ => "Gather stone and work ore into blocks; keep existing factories supplied.",
            }
            .into();
            blocker = projects(&self.world)
                .iter()
                .find(|p| !text(p, "blocked").is_empty())
                .map_or("", |p| text(p, "blocked"))
                .into();
            paths = match kind {
                "wood" => vec![
                    "Choose a reachable stand of trees".into(),
                    "Cut timber and gather loose logs".into(),
                    format!("Store {target} wood"),
                ],
                "ore" => vec![
                    "Choose reachable stone".into(),
                    "Quarry rocks and collect ore".into(),
                    format!("Reserve {target} ore"),
                ],
                "blocks" => vec![
                    "Gather stone and ore".into(),
                    "Work ore into blocks by hand or at a supplied factory".into(),
                    format!("Store {target} stone blocks"),
                ],
                _ => vec![
                    "Cut trees or use stored wood".into(),
                    "Carry wood to the river while meeting needs".into(),
                    "Finish the crossing".into(),
                ],
            };
        }
        if members.is_empty() {
            blocker = if flag(&self.world["progress"], "hatched") {
                "There are no workers left. This goal remains in the saved story."
            } else {
                "Tap the spacecraft to meet the first worker."
            }
            .into();
        } else if needs < 30. {
            policy = "care";
            step = "Meet urgent needs before returning to the objective.".into();
            if !independent && !missing.is_empty() {
                blocker = missing.into();
            }
        }
        if list(&self.world["directives"], "members").is_empty()
            && flag(&self.world["directives"], "pauseWork")
            && !["care", "grow"].contains(&kind)
        {
            blocker = "This project is on hold at your request. Care continues.".into();
        }
        if flag(&self.world["directives"], "avoidPollution") && kind == "blocks" && !independent {
            blocker =
                "Factory work is held to avoid pollution. You can still hammer loose ore yourself."
                    .into();
        }
        if num(&self.world, "stage") == 4. {
            blocker = "This story has reached its ending.".into();
        }
        let complete = kind != "care" && value >= target;
        let subgoals = if text(g, "status") == "active" {
            self.development_plan()["children"].clone()
        } else {
            json!([])
        };
        json!({"value":value,"progress":(value/target).clamp(0.,1.),"complete":complete,"blocker":if complete{""}else{&blocker},"step":if complete{"Objective reached."}else{&step},"policy":policy,"milestones":paths,"subgoals":subgoals})
    }
    fn trim_goal_history(&mut self) {
        let recent = latest_closed(list(&self.world["memory"], "goals"));
        if let Some(goals) = self.world["memory"]["goals"].as_array_mut() {
            goals.retain(|g| !closed(g) || recent.contains(g));
        }
    }
    pub fn add_goal(&mut self, spec: &Value, command: &str, source: &str) -> Result<Value, String> {
        let kind = text(spec, "kind");
        if !GOAL_KINDS.contains(&kind) {
            return Err("The model returned an unsupported goal.".into());
        }
        let target = self.goal_target(kind, js_number(&spec["target"]));
        if let Some(g) = list(&self.world["memory"], "goals")
            .iter()
            .find(|g| !closed(g) && text(g, "kind") == kind && num(g, "target") == target)
        {
            return Ok(g.clone());
        }
        if list(&self.world["memory"], "goals")
            .iter()
            .filter(|g| !closed(g))
            .count()
            >= 8
        {
            return Err("Eight goals are already saved. Complete or cancel one in Goals before adding another.".into());
        }
        let g = json!({"id":format!("g{}",num(&self.world,"nextId")),"kind":kind,"target":target,"command":cut(command,500),"source":cut(source,80),"status":if self.active_goal().is_some(){"queued"}else{"active"},"createdAt":self.world["time"],"completedAt":null,"reviews":[]});
        increment(&mut self.world, "nextId", 1.);
        self.world["memory"]["goals"]
            .as_array_mut()
            .unwrap()
            .push(g.clone());
        self.trim_goal_history();
        increment(&mut self.world, "revision", 1.);
        increment(&mut self.world, "commandRevision", 1.);
        Ok(g)
    }
    pub fn advance_goals(&mut self) -> Vec<Value> {
        let mut finished = Vec::new();
        let goals = list(&self.world["memory"], "goals").to_vec();
        for (i, g) in goals.iter().enumerate() {
            if ["active", "queued"].contains(&text(g, "status"))
                && flag(&self.inspect_goal(g), "complete")
            {
                self.world["memory"]["goals"][i]["status"] = json!("completed");
                self.world["memory"]["goals"][i]["completedAt"] = self.world["time"].clone();
                finished.push(self.world["memory"]["goals"][i].clone());
                increment(&mut self.world, "revision", 1.);
            }
        }
        if self.active_goal().is_none()
            && let Some(next) = self.world["memory"]["goals"]
                .as_array_mut()
                .and_then(|a| a.iter_mut().find(|g| text(g, "status") == "queued"))
        {
            next["status"] = json!("active");
            increment(&mut self.world, "revision", 1.);
        }
        self.trim_goal_history();
        finished
    }
    pub fn change_goal(&mut self, id: &str, action: &str) -> Option<Value> {
        let i = list(&self.world["memory"], "goals")
            .iter()
            .position(|g| text(g, "id") == id && !closed(g))?;
        match action {
            "pause" => self.world["memory"]["goals"][i]["status"] = json!("paused"),
            "cancel" => {
                self.world["memory"]["goals"][i]["status"] = json!("cancelled");
                self.world["memory"]["goals"][i]["completedAt"] = self.world["time"].clone();
            }
            "focus" => {
                for g in self.world["memory"]["goals"].as_array_mut().unwrap() {
                    if text(g, "status") == "active" && text(g, "id") != id {
                        g["status"] = json!("queued");
                    }
                }
                self.world["memory"]["goals"][i]["status"] = json!("active");
            }
            _ => return None,
        }
        if self.active_goal().is_none()
            && let Some(next) = self.world["memory"]["goals"]
                .as_array_mut()
                .and_then(|a| a.iter_mut().find(|g| text(g, "status") == "queued"))
        {
            next["status"] = json!("active");
        }
        let g = self.world["memory"]["goals"][i].clone();
        increment(&mut self.world, "revision", 1.);
        increment(&mut self.world, "commandRevision", 1.);
        self.trim_goal_history();
        Some(g)
    }
    pub fn goal_policy(&mut self) -> String {
        let current = self.active_goal();
        if current.is_none()
            && text(&self.world["memory"]["lastPlan"], "policy") == "care"
            && list(&self.world, "creatures")
                .iter()
                .all(|c| minimum(c) >= 65.)
        {
            return "balanced".into();
        }
        let Some(current) = current else {
            return if !self.world["memory"]["lastPlan"]["goalId"].is_null() {
                "balanced"
            } else {
                self.world["memory"]["lastPlan"]["policy"]
                    .as_str()
                    .unwrap_or("balanced")
            }
            .into();
        };
        let state = self.inspect_goal(&current);
        if text(&state, "policy") == "care" {
            if text(&current, "kind") == "grow"
                && list(&self.world, "creatures")
                    .iter()
                    .all(|c| minimum(c) >= 70.)
            {
                return "expand".into();
            }
            return "care".into();
        }
        if same_id(&self.world["memory"]["lastPlan"]["goalId"], &current["id"]) {
            text(&self.world["memory"]["lastPlan"], "policy").into()
        } else {
            text(&state, "policy").into()
        }
    }
}
