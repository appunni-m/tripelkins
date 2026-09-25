//! Shared work-project budgets and progress. Derived values never spend stock.
use crate::{Engine, value::*};
use serde_json::{Value, json};
pub const CARE_BUILDINGS: [&str; 3] = ["orchard", "bath", "roundabout"];
pub const INDEPENDENT_BUILDINGS: [&str; 7] = [
    "orchard",
    "bath",
    "roundabout",
    "mine",
    "factory",
    "dwelling",
    "theatre",
];
pub const RESOURCE_PROJECTS: [&str; 4] = ["timber", "quarry", "refine", "crossing"];
pub const USEFUL_TASKS: [&str; 10] = [
    "haul",
    "mine",
    "work",
    "orbit",
    "explore",
    "clean",
    "gather",
    "quarry",
    "refine",
    "construct",
];
pub fn working(c: &Value) -> bool {
    USEFUL_TASKS.contains(&text(c, "task"))
        && c["job"].is_object()
        && !["completed", "cancelled", "blocked"].contains(&text(&c["job"], "state"))
}
pub fn work_order(a: &Value, b: &Value) -> std::cmp::Ordering {
    num(a, "lastWorkTurn")
        .total_cmp(&num(b, "lastWorkTurn"))
        .then(num(a, "birthOrdinal").total_cmp(&num(b, "birthOrdinal")))
}
pub fn work_role(w: &Value, c: &Value) -> usize {
    ((num(c, "birthOrdinal") + num(c, "workCycles") + (num(w, "time") / 60.).floor()) % 4.) as usize
}
pub fn minimum(c: &Value) -> f64 {
    num(c, "fed").min(num(c, "clean")).min(num(c, "amused"))
}
pub fn material(kind: &str) -> Option<&'static str> {
    match kind {
        "timber" | "crossing" => Some("wood"),
        "quarry" => Some("ore"),
        "refine" => Some("blocks"),
        _ => None,
    }
}
pub fn construction(p: &Value) -> bool {
    INDEPENDENT_BUILDINGS.contains(&text(p, "type"))
}
pub fn project_name(p: &Value) -> &'static str {
    match text(p, "type") {
        "timber" => "Timber reserve",
        "quarry" => "Stone gathering",
        "refine" => "Block workshop",
        "crossing" => "Supply the bridge",
        kind => building_name(kind),
    }
}
pub fn building_name(kind: &str) -> &'static str {
    match kind {
        "orchard" => "Banana grove",
        "bath" => "Rain shower",
        "roundabout" => "Bounce garden",
        "mine" => "Mine",
        "factory" => "Stone workshop",
        "dwelling" => "Cottage",
        "theatre" => "Clubhouse",
        "sculpture" => "Keepsake",
        "flowers" => "Flowers",
        "tnt" => "Demolition charge",
        "cannon" => "Sky launcher",
        _ => "Colony work",
    }
}
pub fn building_spec(kind: &str) -> Value {
    match kind {
        "orchard" => {
            json!({"wood":10,"population":10,"capacity":3,"help":"Grows a small, replenishing supply of bananas."})
        }
        "bath" => {
            json!({"wood":6,"population":6,"capacity":1,"help":"A little privacy. Cleans one creature at a time."})
        }
        "roundabout" => {
            json!({"wood":12,"population":15,"capacity":5,"help":"A place to play together."})
        }
        "mine" => {
            json!({"wood":12,"cost":25,"blocks":50,"stage":2,"capacity":4,"help":"Place on a stone deposit. Workers extract ore."})
        }
        "factory" => {
            json!({"wood":24,"cost":150,"blocks":300,"stage":2,"capacity":5,"help":"Turns ore into blocks. Leaves pollution behind."})
        }
        "dwelling" => {
            json!({"wood":18,"cost":100,"blocks":200,"stage":2,"capacity":6,"help":"Food, showers, and somewhere to belong."})
        }
        "theatre" => {
            json!({"wood":36,"cost":500,"blocks":1000,"stage":2,"capacity":20,"help":"Entertains a crowd and puts a spring in their step."})
        }
        "sculpture" => json!({"cost":50,"blocks":100,"stage":2,"capacity":2}),
        _ => json!({}),
    }
}
pub fn building_materials(kind: &str) -> Value {
    let s = building_spec(kind);
    json!({"wood":num(&s,"wood"),"blocks":num(&s,"cost")})
}
pub fn building_cost(kind: &str) -> String {
    let s = building_spec(kind);
    let mut a = Vec::new();
    if num(&s, "wood") > 0. {
        a.push(format!("{} wood", num(&s, "wood")));
    }
    if num(&s, "cost") > 0. {
        a.push(format!("{} blocks", num(&s, "cost")));
    }
    if a.is_empty() {
        "No materials".into()
    } else {
        a.join(" + ")
    }
}
pub fn unlocked(w: &Value, kind: &str) -> bool {
    let s = building_spec(kind);
    num(w, "population") >= num(&s, "population")
        && num(w, "stage") >= num(&s, "stage")
        && num(&w["progress"], "peakBlocks") >= num(&s, "blocks")
}
pub fn projects(w: &Value) -> Vec<&Value> {
    let mut out = Vec::new();
    if w["community"]["project"].is_object() {
        out.push(&w["community"]["project"]);
    }
    out.extend(list(&w["community"], "projects"));
    out
}
pub fn worker_project<'a>(w: &'a Value, c: &Value) -> Option<&'a Value> {
    projects(w)
        .into_iter()
        .find(|p| list(p, "crew").iter().any(|id| same_id(id, &c["id"])))
}
pub fn project_limit(w: &Value) -> usize {
    ((list(w, "creatures").len() as f64 / 12.).ceil() as usize).clamp(1, 24)
}
pub fn development_interval(w: &Value) -> f64 {
    match text(&w["settings"], "decisionSpeed") {
        "slow" => 60.,
        "fast" => 15.,
        "extra-fast" => 8.,
        _ => 30.,
    }
}
pub fn project_requirements(w: &Value, p: &Value) -> Value {
    let s = building_spec(text(p, "type"));
    let (mut wood, mut blocks) = (num(&s, "wood"), num(&s, "cost"));
    for previous in projects(w) {
        if same_id(&previous["id"], &p["id"]) {
            break;
        }
        let s = building_spec(text(previous, "type"));
        wood += num(&s, "wood");
        blocks += num(&s, "cost");
    }
    json!({"wood":wood,"blocks":blocks})
}
pub fn project_funded(w: &Value, p: &Value) -> bool {
    if !p.is_object() {
        return false;
    }
    let r = project_requirements(w, p);
    num(&w["inventory"], "wood") >= num(&r, "wood")
        && num(&w["inventory"], "blocks") >= num(&r, "blocks")
}
pub fn uncommitted_blocks(w: &Value) -> f64 {
    (num(&w["inventory"], "blocks")
        - projects(w)
            .iter()
            .map(|p| num(&building_spec(text(p, "type")), "cost"))
            .sum::<f64>())
    .max(0.)
}
pub fn colony_milestone(w: &Value) -> Value {
    if list(&w["memory"], "goals")
        .iter()
        .any(|g| text(g, "status") == "active")
        || num(w, "stage") >= 3.
        || !flag(&w["progress"], "hatched")
    {
        return Value::Null;
    }
    if num(w, "stage") == 2. && num(&w["progress"], "peakBlocks") < 300. {
        let v = num(&w["progress"], "peakBlocks");
        json!({"id":"story-first-blocks","kind":"blocks","project":"refine","target":300,"value":v,"remaining":(300.-v).max(0.),"title":"Brightness in the stone","step":"Quarry rocks, collect ore and refine the first 300 blocks to unlock a stone workshop."})
    } else {
        Value::Null
    }
}
pub fn industry_milestone(w: &Value) -> Value {
    if list(&w["memory"], "goals")
        .iter()
        .any(|g| text(g, "status") == "active")
        || num(w, "stage") != 2.
        || num(&w["progress"], "peakBlocks") < 300.
        || num(&w["progress"], "energy") >= 1500000.
    {
        return Value::Null;
    }
    let v = num(&w["progress"], "energy");
    json!({"id":"story-industry","kind":"energy","project":"industry","target":1500000,"value":v,"remaining":1500000.-v,"title":"A new kind of world","step":"Build stocked mines and stone workshops in local neighborhoods; carry ore and produce energy. Keep care available."})
}
pub fn timber_reserve(w: &Value) -> Value {
    let largest = INDEPENDENT_BUILDINGS
        .iter()
        .filter(|k| unlocked(w, k))
        .map(|k| num(&building_spec(k), "wood"))
        .fold(12., f64::max);
    let committed = projects(w)
        .iter()
        .map(|p| num(&building_spec(text(p, "type")), "wood"))
        .sum::<f64>();
    let target = 24_f64
        .max(largest * 2.)
        .max(144_f64.min((list(w, "creatures").len() as f64 / 8.).ceil() * 6.))
        + committed;
    let minimum = 12_f64.max(largest).max((target / 2.).ceil());
    let stock = num(&w["inventory"], "wood").floor();
    let goal = list(&w["memory"], "goals")
        .iter()
        .find(|g| text(g, "status") == "active");
    json!({"stock":stock,"minimum":minimum,"target":target,"short":(target-stock).max(0.),"refill":stock<minimum&&goal.is_none_or(|g|["grow","care"].contains(&text(g,"kind")))})
}
impl Engine {
    pub fn work_projects(&self) -> Vec<Value> {
        projects(&self.world).into_iter().cloned().collect()
    }
    pub fn worker_project(&self, c: &Value) -> Option<Value> {
        worker_project(&self.world, c).cloned()
    }
    pub fn project_funded(&self, p: &Value) -> bool {
        project_funded(&self.world, p)
    }
    pub fn add_work_project(&mut self, p: Value) {
        if self.world["community"]["project"].is_null() {
            self.world["community"]["project"] = p;
        } else {
            self.world["community"]["projects"]
                .as_array_mut()
                .unwrap()
                .push(p);
        }
    }
    pub fn remove_work_project(&mut self, id: &Value) {
        let mut keep: Vec<_> = self
            .work_projects()
            .into_iter()
            .filter(|p| !same_id(&p["id"], id))
            .collect();
        self.world["community"]["project"] = if keep.is_empty() {
            Value::Null
        } else {
            keep.remove(0)
        };
        self.world["community"]["projects"] = json!(keep);
    }
    pub fn record_work(&mut self, id: &Value) {
        increment(&mut self.world["community"], "workTurn", 1.);
        let turn = self.world["community"]["workTurn"].clone();
        if let Some(c) = self.world["creatures"]
            .as_array_mut()
            .and_then(|a| a.iter_mut().find(|c| same_id(&c["id"], id)))
        {
            c["lastWorkTurn"] = turn;
        }
    }
}
impl Engine {
    pub fn development_plan(&mut self) -> Value {
        let goal = self.active_goal();
        let care = self.care_context();
        let mut milestone = colony_milestone(&self.world);
        if milestone.is_null() {
            milestone = industry_milestone(&self.world);
        }
        let density = self.density_summary();
        let n = list(&self.world, "creatures").len() as f64;
        let growing = milestone.is_null()
            && goal
                .as_ref()
                .is_none_or(|g| ["grow", "care"].contains(&text(g, "kind")));
        let mut children = Vec::new();
        for (kind, name) in [
            ("food", "Grow enough food"),
            ("wash", "Provide enough washing places"),
            ("play", "Make room for shared play"),
        ] {
            let s = &care[kind];
            let growth = if growing { num(s, "growthShort") } else { 0. };
            children.push(json!({"id":format!("care-{kind}"),"kind":crate::outposts::care_type(kind),"title":name,"remaining":num(s,"short").max(num(s,"urgent")).max(growth),"status":if num(s,"urgent")>0.||num(s,"low")>n/4.{"urgent"}else if num(s,"short")>0.||growth>0.{"needed"}else{"satisfied"}}));
        }
        let d = &self.world["discovery"];
        let cells = d["regions"]
            .as_object()
            .map(|a| {
                a.values()
                    .map(|v| v.as_u64().unwrap_or(0).count_ones() as f64)
                    .sum::<f64>()
            })
            .unwrap_or(0.);
        let expanding = n > 20.
            && growing
            && (num(&density, "crowded") > 0.
                || cells * num(d, "cell").powi(2) < n / num(&density, "target") * 100. * 2.);
        let outposts = self.outpost_context();
        for camp in outposts.as_array().unwrap().iter().take(2) {
            let at = camp["at"]
                .as_array()
                .unwrap()
                .iter()
                .map(scalar_string)
                .collect::<Vec<_>>();
            children.push(json!({"id":format!("outpost:{}:{}",text(camp,"kind"),at.join(":")),"kind":crate::outposts::care_type(text(camp,"kind")),"status":"needed","remaining":camp["residents"],"title":format!("Support {} residents at {}: {}",num(camp,"residents"),at.join(", "),if flag(camp,"unserved"){String::from("no reachable service")}else{format!("{}s care round trip",num(camp,"roundTripSeconds"))})}));
        }
        children.push(json!({"id":"space","kind":"explore","title":"Scout space for the next neighborhood","remaining":density["crowded"],"status":if expanding{"needed"}else{"satisfied"}}));
        if !milestone.is_null() {
            children.push(json!({"id":milestone["id"],"kind":milestone["project"],"title":milestone["step"],"remaining":milestone["remaining"],"status":"needed"}));
        }
        if let Some(g) = &goal {
            let kind = text(g, "kind");
            if ["wood", "ore", "blocks", "bridge"].contains(&kind) {
                let value = if kind == "bridge" {
                    if flag(&self.world["progress"], "bridge") {
                        24.
                    } else {
                        list(&self.world, "objects")
                            .iter()
                            .find(|o| text(o, "type") == "bridge")
                            .map_or(0., |o| num(o, "stock"))
                    }
                } else {
                    num(&self.world["inventory"], kind)
                };
                children.push(json!({"id":format!("goal-{kind}"),"kind":match kind{"wood"=>"timber","ore"=>"quarry","blocks"=>"refine",_=>"crossing"},"title":if kind=="bridge"{"Finish the crossing".into()}else{format!("Store {} {kind}",num(g,"target"))},"remaining":(num(g,"target")-value).max(0.),"status":if value>=num(g,"target"){"satisfied"}else{"needed"}}));
            }
        }
        let ps = self.work_projects();
        let timber = timber_reserve(&self.world);
        if ps.is_empty()
            && flag(&timber, "refill")
            && text(&self.world["community"], "consent") == "accepted"
        {
            children.push(json!({"id":"timber-buffer","kind":"timber","title":format!("Keep {} wood ready for building",num(&timber,"target")),"remaining":timber["short"],"status":"needed"}));
        }
        if ps.iter().any(construction) {
            let wood = (ps
                .iter()
                .map(|p| num(&building_spec(text(p, "type")), "wood"))
                .sum::<f64>()
                - num(&self.world["inventory"], "wood"))
            .max(0.);
            children.push(json!({"id":"materials","kind":"timber","title":"Gather materials for our building","remaining":wood,"status":if wood>0.{"needed"}else{"satisfied"}}));
        }
        for r in list(&self.world["community"], "access").iter().take(2) {
            children.push(json!({"id":format!("access:{}",scalar_string(&r["id"])),"kind":"clearance","title":format!("Open a path to the {}",text(r,"label")),"remaining":1,"status":if text(r,"status")=="clearing"{"working"}else{"blocked"}}));
        }
        for (i, p) in ps.iter().enumerate() {
            let value = if text(p, "type") == "crossing" {
                if flag(&self.world["progress"], "bridge") {
                    24.
                } else {
                    list(&self.world, "objects")
                        .iter()
                        .find(|o| text(o, "type") == "bridge")
                        .map_or(0., |o| num(o, "stock"))
                }
            } else {
                num(
                    &self.world["inventory"],
                    material(text(p, "type")).unwrap_or(""),
                )
            };
            children.push(json!({"id":if i==0{"project".into()}else{format!("project:{}",scalar_string(&p["id"]))},"kind":p["type"],"title":format!("Finish {} at {}, {}",text(p,"type"),num(p,"x").js_round(),num(p,"y").js_round()),"status":if text(p,"blocked").is_empty(){"working"}else{"blocked"},"remaining":if material(text(p,"type")).is_some(){(num(p,"target")-value).max(0.)}else{(num(p,"required")-num(p,"progress")).max(0.)}}));
        }
        children.sort_by_key(|c| text(c, "status") == "satisfied");
        children.truncate(7);
        let title = goal
            .as_ref()
            .map(|g| match text(g, "kind") {
                "grow" => crate::goals::goal_title(g),
                "care" => "Keep everyone comfortable".into(),
                "wood" => format!("Store {} wood", num(g, "target")),
                "ore" => format!("Store {} ore", num(g, "target")),
                "blocks" => format!("Save {} blocks", num(g, "target")),
                _ => "Finish the river crossing".into(),
            })
            .unwrap_or_else(|| {
                if !milestone.is_null() {
                    text(&milestone, "title").into()
                } else {
                    "Grow a healthy, spacious colony".into()
                }
            });
        json!({"parent":goal.as_ref().map(|g|g["id"].clone()).unwrap_or_else(||if !milestone.is_null(){milestone["id"].clone()}else{json!("colony")}),"title":title,"expanding":expanding,"density":density,"children":children})
    }
    pub fn update_development_plan(&mut self) -> Value {
        let p = self.development_plan();
        if crate::value::js_json(&self.world["community"]["plan"]) != crate::value::js_json(&p) {
            self.world["community"]["plan"] = p.clone();
            increment(&mut self.world, "revision", 1.);
        }
        p
    }
    pub fn project_status(&self, p: &Value) -> String {
        if !p.is_object() {
            return String::new();
        }
        if text(p, "type") == "crossing" {
            return "Cutting timber and carrying wood to the river.".into();
        }
        if let Some(m) = material(text(p, "type")) {
            return format!(
                "{}/{} {m} · {}",
                num(&self.world["inventory"], m).floor(),
                num(p, "target"),
                if text(p, "type") == "refine" {
                    "gather stone, then work the ore into blocks"
                } else {
                    "gather nearby resources"
                }
            );
        }
        let needed = project_requirements(&self.world, p);
        if num(&self.world["inventory"], "wood") < num(&needed, "wood") {
            return format!(
                "Gathering wood: {}/{}, including earlier crews",
                num(&self.world["inventory"], "wood"),
                num(&needed, "wood")
            );
        }
        if num(&self.world["inventory"], "blocks") < num(&needed, "blocks") {
            return format!(
                "Waiting for blocks: {}/{}, including earlier crews",
                num(&self.world["inventory"], "blocks"),
                num(&needed, "blocks")
            );
        }
        "The crew is building; care comes first.".into()
    }
}

/// JavaScript rounding preserves the original negative-half tile decisions.
pub trait JsRound {
    fn js_round(self) -> f64;
}
impl JsRound for f64 {
    fn js_round(self) -> f64 {
        (self + 0.5).floor()
    }
}

/// JavaScript scalar interpolation for persisted keys containing numeric IDs.
pub fn scalar_string(v: &Value) -> String {
    v.as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| crate::value::js_json(v))
}
