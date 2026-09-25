use crate::{
    Engine,
    geometry::{Geometry, footprint},
    terrain,
    value::*,
};
use serde_json::{Value, json};
impl Engine {
    fn reset_world_caches(&mut self) {
        self.geo = None;
        self.nav = Default::default();
        self.route_cost_cache = None;
        self.planning_cache.clear();
        self.sim = Default::default();
        self.density_index.borrow_mut().clear();
        self.discovery_index.borrow_mut().clear();
    }
    pub(crate) fn random(&mut self) -> f64 {
        let next = (num(&self.world, "seed") as u32)
            .wrapping_mul(1664525)
            .wrapping_add(1013904223);
        self.world["seed"] = json!(next);
        next as f64 / 4294967296.
    }
    pub(crate) fn add_object(&mut self, kind: &str, x: f64, y: f64, extra: Value) -> Option<Value> {
        if list(&self.world, "objects").len() >= 2048 {
            return None;
        }
        let id = num(&self.world, "nextId");
        increment(&mut self.world, "nextId", 1.);
        let mut o =
            json!({"id":format!("o{id}"),"type":kind,"x":x,"y":y,"stock":0,"level":1,"progress":0});
        if let Some(extra) = extra.as_object() {
            for (k, v) in extra {
                o[k] = v.clone();
            }
        }
        self.world["objects"]
            .as_array_mut()
            .unwrap()
            .push(o.clone());
        if footprint(kind).is_some() || kind == "bridge" {
            increment(&mut self.world, "navRevision", 1.);
        }
        Some(o)
    }
    pub(crate) fn materialize_object(&mut self, o: &Value) -> Option<Value> {
        if !text(o, "id").starts_with("g:") {
            return Some(o.clone());
        }
        if list(&self.world, "objects").len() >= 2048 || !terrain::clear_natural(&mut self.world, o)
        {
            return None;
        }
        self.add_object(text(o,"type"),num(o,"x"),num(o,"y"),json!({"stock":o["stock"],"level":o["level"],"variant":o["variant"],"progress":o["progress"]}))
    }
    pub(crate) fn add_creature(&mut self, x: f64, y: f64, source: Option<&Value>) -> Option<Value> {
        if num(&self.world, "population") >= 1e15 {
            return None;
        }
        let len = list(&self.world, "creatures").len();
        if source.is_some()
            && (len >= 2048
                || flag(&self.world["runtime"]["growth"], "held")
                || len as f64
                    >= self.world["runtime"]["growth"]["limit"]
                        .as_f64()
                        .unwrap_or(2048.))
        {
            return None;
        }
        if len >= 2048 {
            increment(&mut self.world, "cohort", 1.);
            increment(&mut self.world, "population", 1.);
            return None;
        }
        let id = num(&self.world, "nextId");
        increment(&mut self.world, "nextId", 1.);
        let identity = self.identity(source);
        let mut c = json!({"id":format!("c{id}"),"x":x,"y":y,"fed":if source.is_some(){72}else{54},"clean":if source.is_some(){74}else{58},"amused":if source.is_some(){76}else{46},"age":0,"growth":0,"task":"idle","target":null,"work":0,"wanderX":x,"wanderY":y,"deadTime":0,"carry":0});
        for (k, v) in identity.as_object().unwrap() {
            c[k] = v.clone();
        }
        let g = Geometry::new(&self.world);
        let others: Vec<_> = g.creatures.iter().map(|(_, p)| *p).collect();
        if let Some(p) = g.free(Point { x, y }, &others, 6.) {
            c["x"] = json!(p.x);
            c["y"] = json!(p.y);
        } else {
            if source.is_none() {
                increment(&mut self.world, "cohort", 1.);
                increment(&mut self.world, "population", 1.);
            }
            return None;
        }
        c["cargoKind"] = Value::Null;
        c["job"] = Value::Null;
        c["sickness"] = json!(0);
        c["blocked"] = json!([]);
        self.world["creatures"]
            .as_array_mut()
            .unwrap()
            .push(c.clone());
        self.reveal(Point::read(&c), 10.);
        increment(&mut self.world, "population", 1.);
        Some(c)
    }
    pub(crate) fn create_world(&mut self, empty: bool, map_seed: u32) -> Value {
        let mut fresh =
            Engine::from_json(include_str!("../data/world.json")).expect("valid world defaults");
        fresh.now_iso = self.now_iso.clone();
        fresh.world["map"]["seed"] = json!(if empty { 18492 } else { map_seed });
        if !empty {
            let mut y = 3.;
            while y < 46. {
                let mut x = 3.;
                while x < 63. {
                    if !(x > 38. && x < 46.) {
                        let edge = x < 9. || y < 9. || y > 39. || x > 57.;
                        let patch = (x > 30. && y < 21.) || (x < 16. && y > 30.);
                        if (edge && fresh.random() > 0.12) || (patch && fresh.random() > 0.4) {
                            let ox = x + fresh.random();
                            let oy = y + fresh.random();
                            let variant = (fresh.random() * 3.).floor();
                            fresh.add_object("tree", ox, oy, json!({"variant":variant}));
                        }
                    }
                    x += 2.6;
                }
                y += 2.3;
            }
            for _ in 0..20 {
                let x = 11. + fresh.random() * 26.;
                let y = 11. + fresh.random() * 26.;
                if crate::value::js_hypot(x - 24., y - 24.) > 4. {
                    fresh.add_object("rock", x, y, json!({}));
                }
            }
            for (kind, x, y) in [
                ("bridge", 42., 25.),
                ("monolith", 35., 25.),
                ("mountain", 57., 9.),
            ] {
                fresh.add_object(kind, x, y, json!({}));
            }
            for i in 0..5 {
                fresh.add_object(
                    "node",
                    48. + (i % 3) as f64 * 4.,
                    28. + (i / 3) as f64 * 6.,
                    json!({"stock":100000,"level":if i==4{2}else{1}}),
                );
            }
            for (kind, x, y) in [
                ("lander", 24., 24.),
                ("flowers", 20., 22.),
                ("flowers", 28., 28.),
            ] {
                fresh.add_object(kind, x, y, json!({}));
            }
            fresh.remember("arrival", "A tiny spacecraft. A whole new beginning.", None);
        }
        fresh.world
    }
}
pub fn colony_health(w: &Value) -> Value {
    let keys = ["fed", "clean", "amused"];
    let c = list(w, "creatures");
    let mut lowest = json!({});
    for k in keys {
        lowest[k] = if c.is_empty() {
            Value::Null
        } else {
            json!(c.iter().map(|c| num(c, k)).fold(f64::INFINITY, f64::min))
        };
    }
    let minimum = |c: &Value| num(c, "fed").min(num(c, "clean")).min(num(c, "amused"));
    let at_risk = c.iter().filter(|c| minimum(c) < 20.).count();
    let critical = c.iter().filter(|c| minimum(c) <= 0.).count();
    let help: Vec<_> = keys
        .iter()
        .filter(|k| !lowest[**k].is_null() && num(&lowest, k) < 20.)
        .map(|k| match *k {
            "fed" => "give bananas",
            "clean" => "use the cloth",
            _ => "place a cricket ball",
        })
        .collect();
    json!({"lowest":lowest,"atRisk":at_risk,"critical":critical,"message":if help.is_empty(){String::new()}else{format!("{at_risk} need care: {}.",help.join(", "))}})
}
impl Engine {
    pub(crate) fn state_dispatch(
        &mut self,
        operation: &str,
        input: &Value,
    ) -> Result<Option<Value>, String> {
        let result = match operation {
            "state.clamp" => json!(crate::memory::bounded(
                &input["v"],
                num(input, "lo"),
                num(input, "hi")
            )),
            "community.initialCommunity" => crate::community::initial_community(),
            "community.nextNotice" => self.next_notice().unwrap_or(Value::Null),
            "identity.identity" => self.identity(input.get("parent").filter(|v| !v.is_null())),
            "story.initialStory" => crate::story::initial_story(),
            "story.initialEvidence" => crate::story::initial_evidence(),
            "theme-compat.themeCompatibleWorld" | "state.themeCompatibleWorld" => {
                crate::save::theme_compatible_world(input.get("raw").unwrap_or(input))?
            }
            "memory.compactEvents" => {
                let mut memory = input
                    .get("memory")
                    .cloned()
                    .unwrap_or_else(|| self.world["memory"].clone());
                crate::memory::compact_events(&mut memory, list(input, "events"));
                if input.get("memory").is_none() {
                    self.world["memory"] = memory.clone();
                }
                memory
            }
            "save-schema.extendWorld" | "state.extendWorld" => {
                let defaults: Value =
                    serde_json::from_str(include_str!("../data/world.json")).unwrap();
                for k in [
                    "nextBirth",
                    "commandRevision",
                    "navRevision",
                    "groups",
                    "departed",
                    "pollution",
                    "story",
                    "evidence",
                    "directives",
                    "orbital",
                    "district",
                    "metrics",
                    "decisions",
                    "community",
                ] {
                    self.world[k] = defaults[k].clone();
                }
                self.world["inventory"]["corpses"] = json!(0);
                self.reset_world_caches();
                Value::Null
            }
            "save-schema.migrateExtensions" | "state.migrateExtensions" => {
                let mut next = self.world.clone();
                self.migrate_extensions(&mut next, input.get("raw").unwrap_or(input))?;
                self.world = next;
                self.reset_world_caches();
                Value::Null
            }
            "state.createWorld" => {
                self.create_world(flag(input, "empty"), num(input, "seed") as u32)
            }
            "state.migrateWorld" | "save.migrateWorld" => self.migrate_world(
                input
                    .get("raw")
                    .or_else(|| input.get("world"))
                    .cloned()
                    .unwrap_or(Value::Null),
            )?,
            "state.recoverSnapshot" => {
                let mut next = self.migrate_world(input["raw"].clone())?;
                if flag(input, "rescue") {
                    for c in next["creatures"].as_array_mut().unwrap() {
                        for key in ["fed", "clean", "amused"] {
                            c[key] = json!(num(c, key).max(70.));
                        }
                        c["deadTime"] = json!(0);
                        c["target"] = Value::Null;
                        c["task"] = json!("idle");
                        c["work"] = json!(0);
                    }
                    let mut recovery = Engine::from_json(&next.to_string())?;
                    recovery.now_iso = self.now_iso.clone();
                    recovery.remember(
                        "recovery",
                        "You restored this world with fresh food, a wash and time to play.",
                        None,
                    );
                    next = recovery.world;
                }
                next
            }
            "state.colonyHealth" | "save.colonyHealth" | "health.colonyHealth" => {
                colony_health(input.get("world").unwrap_or(&self.world))
            }
            "state.addObject" => self
                .add_object(
                    text(input, "type"),
                    num(input, "x"),
                    num(input, "y"),
                    input.get("extra").cloned().unwrap_or(json!({})),
                )
                .unwrap_or(Value::Null),
            "state.materializeObject" => self
                .materialize_object(input.get("object").unwrap_or(input))
                .unwrap_or(Value::Null),
            "state.addCreature" => {
                let source = input.get("source").cloned();
                self.add_creature(
                    num(input, "x"),
                    num(input, "y"),
                    source.as_ref().filter(|s| !s.is_null()),
                )
                .unwrap_or(Value::Null)
            }
            "state.random" => json!(self.random()),
            "state.remember" | "memory.remember" => {
                self.remember(
                    text(input, "kind"),
                    text(input, "message"),
                    input["entity"].as_str(),
                );
                Value::Null
            }
            "identity.dictionaryName" => {
                json!(crate::identity::dictionary_name(num(input, "index") as i64))
            }
            "identity.rename" | "identity.renameCreature" => {
                let result = self.rename_creature(
                    text(input, "id"),
                    input["input"].as_str().unwrap_or(text(input, "text")),
                );
                if !result.get("error").is_some() && result["old"] != result["name"] {
                    self.remember(
                        "rename",
                        &format!("{} is now {}.", text(&result, "old"), text(&result, "name")),
                        Some(text(input, "id")),
                    );
                }
                result
            }
            "identity.resolveListener" => {
                self.resolve_listener(text(input, "text"), input["selected"].as_str())
            }
            "identity.encounter" => {
                let time = num(&self.world, "time");
                if let Some(c) = self.world["creatures"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|c| same_id(&c["id"], &input["id"]))
                {
                    crate::identity::encounter(
                        c,
                        text(input, "kind"),
                        input["other"].as_str(),
                        input["tick"].as_f64().unwrap_or(time),
                    );
                }
                Value::Null
            }
            "identity.favorite" => {
                if let Some(c) = self.world["creatures"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|c| same_id(&c["id"], &input["id"]))
                {
                    let favorite = input["favorite"].as_bool().unwrap_or(!flag(c, "favorite"));
                    c["favorite"] = json!(favorite);
                    let name = text(c, "name").to_string();
                    self.remember(
                        "favorite",
                        &format!("{name} {}.", if favorite { "pinned" } else { "unpinned" }),
                        Some(text(input, "id")),
                    );
                }
                Value::Null
            }
            "memory.normalize" | "memory.normalizeMemory" => {
                let raw = input
                    .get("memory")
                    .or_else(|| input.get("raw"))
                    .unwrap_or(input);
                crate::memory::validate_memory(raw)?;
                crate::memory::normalize_memory(raw)
            }
            "memory.beginCommand" => self.begin_command(
                text(input, "text"),
                text(input, "channel"),
                input["listener"].as_str(),
                text(input, "id"),
            ),
            "memory.interruptCommands" => {
                self.interrupt_commands();
                self.world.clone()
            }
            "memory.interruptSnapshot" => {
                let mut world = input["world"].clone();
                if let Some(commands) = world["memory"]["commands"].as_array_mut() {
                    for c in commands {
                        if text(c, "status") == "pending" {
                            c["status"] = json!("interrupted");
                        }
                    }
                }
                world
            }
            "timeline.append" | "timeline.appendTimeline" => crate::timeline::append_timeline(
                &input["history"],
                &input["previous"],
                &input["record"],
                &input["replacement"],
                &list(input, "ids")
                    .iter()
                    .map(|v| v.as_str().unwrap_or("").to_string())
                    .collect::<Vec<_>>(),
            )?,
            "timeline.readMoment" => crate::timeline::read_moment(
                input.get("branch").unwrap_or(&input["history"]),
                text(input, "id"),
            )?,
            "timeline.latestWorld" => crate::timeline::latest_world(&input["branch"])?,
            "timeline.size" | "timeline.historySize" => {
                json!(crate::timeline::history_size(&input["history"]))
            }
            "story.update" | "story.updateStory" => {
                self.update_story();
                Value::Null
            }
            "story.collect" | "story.collectStoryMessages" => {
                self.collect_story_messages();
                Value::Null
            }
            "story.next" | "story.nextStory" => self.next_story().unwrap_or(Value::Null),
            "story.entry" | "story.storyEntry" => {
                crate::story::entry(text(input, "id")).unwrap_or(Value::Null)
            }
            "story.answer" | "story.answerStory" => {
                if input["id"].is_string() {
                    self.world["story"]["active"] = input["id"].clone();
                }
                self.answer_story(text(input, "response"));
                Value::Null
            }
            "story.assessment" => self.assessment(),
            "story.archives" | "story.archiveEntries" => self.archive_entries(),
            "story.noteEvidence" => {
                self.note_evidence(
                    text(input, "kind"),
                    text(input, "text"),
                    input["amount"].as_f64().unwrap_or(1.),
                    input["entity"].as_str(),
                );
                Value::Null
            }
            "community.postMessage" => self
                .post_message(input.get("message").unwrap_or(input).clone())
                .unwrap_or(Value::Null),
            "community.activity" => {
                self.activity(
                    text(input, "kind"),
                    text(input, "text"),
                    input["source"].as_str().unwrap_or("Instincts"),
                    text(input, "detail"),
                );
                Value::Null
            }
            "community.offerIndependence" => {
                self.offer_independence();
                Value::Null
            }
            "community.setIndependence" => {
                let accepted = flag(input, "accepted");
                let result = self.set_independence(accepted);
                if result && accepted {
                    self.world["settings"]["autonomy"] = json!(true);
                }
                json!(result)
            }
            "community.visitFrontier" => {
                self.visit_frontier(Point::read(input.get("point").unwrap_or(input)));
                Value::Null
            }
            "community.openInbox" => {
                self.collect_story_messages();
                for m in self.world["community"]["inbox"].as_array_mut().unwrap() {
                    m["read"] = json!(true);
                    m["notified"] = json!(true);
                }
                increment(&mut self.world, "revision", 1.);
                Value::Null
            }
            "community.update" => {
                self.collect_story_messages();
                if flag(input, "becameReady")
                    && text(&self.world["community"], "consent") == "offered"
                    && let Some(m) = self.world["community"]["inbox"]
                        .as_array_mut()
                        .unwrap()
                        .iter_mut()
                        .find(|m| text(m, "key") == "independence" && flag(m, "read"))
                {
                    m["key"] = json!("independence-ready");
                    m["title"] = json!("Now we can think together");
                    m["read"] = json!(false);
                    m["notified"] = json!(false);
                    increment(&mut self.world, "revision", 1.);
                }
                if flag(input, "notify") {
                    self.next_notice().unwrap_or(Value::Null)
                } else {
                    Value::Null
                }
            }
            "community.answerStory" => {
                let id = text(input, "id");
                self.world["story"]["active"] = json!(id);
                self.answer_story(text(input, "response"));
                if let Some(m) = self.world["community"]["inbox"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|m| text(m, "story") == id)
                {
                    m["story"] = Value::Null;
                    m["read"] = json!(true);
                    m["responseRequired"] = json!(false);
                }
                Value::Null
            }
            "conversation.begin" => self.conversation_begin(input),
            "conversation.complete" => self.conversation_complete(input)?,
            "conversation.simpleIntent" => {
                json!(crate::community::simple_intent(text(input, "text")))
            }
            "conversation.localReply" => {
                json!(self.local_reply(text(input, "intent"), input["listener"].as_str()))
            }
            "conversation.informationReply" => {
                json!(self.information_reply(text(input, "text"), input["listener"].as_str()))
            }
            "conversation.cancel" | "conversation.fail" => {
                if let Some(c) = self.world["memory"]["commands"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|c| same_id(&c["id"], &input["id"]) && text(c, "status") == "pending")
                {
                    c["status"] = json!(if operation == "conversation.cancel" {
                        "cancelled"
                    } else {
                        "failed"
                    });
                    if operation == "conversation.fail" {
                        c["reply"] = json!("The colony could not reply. You can try again.");
                    }
                    increment(&mut self.world, "revision", 1.);
                }
                Value::Null
            }
            _ => return Ok(None),
        };
        Ok(Some(result))
    }
}
