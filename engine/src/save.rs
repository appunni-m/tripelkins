//! Import validation and schema migration with the established save allowlists.
use crate::{
    Engine, community,
    geometry::{BODY_RADIUS, Geometry, Object, bridge},
    memory::{bounded as n, clipped, js_string, normalize_memory, tail, truthy},
    story,
    value::*,
};
use serde_json::{Value, json};
use std::collections::HashSet;
const TASKS: &[&str] = &[
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
const STATES: &[&str] = &[
    "proposed",
    "reserved",
    "travelling",
    "queued",
    "working",
    "completed",
    "blocked",
    "cancelled",
];
const BUILDINGS: &[&str] = &[
    "sculpture",
    "bath",
    "orchard",
    "roundabout",
    "mine",
    "dwelling",
    "factory",
    "theatre",
    "cannon",
];
const DEVELOPMENT: &[&str] = &[
    "orchard",
    "bath",
    "roundabout",
    "dwelling",
    "theatre",
    "mine",
    "factory",
    "timber",
    "quarry",
    "refine",
    "crossing",
];
fn coord(v: &Value, fallback: f64) -> f64 {
    if v.is_null() {
        fallback
    } else {
        n(v, -1e9, 1e9)
    }
}
fn point(v: &Value) -> Value {
    json!({"x":coord(&v["x"],0.),"y":coord(&v["y"],0.)})
}
fn ns(v: &mut Value, k: &str, lo: f64, hi: f64) {
    v[k] = json!(n(&v[k], lo, hi));
}
fn ts(v: &mut Value, k: &str, max: usize) {
    v[k] = json!(clipped(
        &if truthy(&v[k]) {
            js_string(&v[k])
        } else {
            String::new()
        },
        max
    ));
}
fn valid_id(s: &str, prefix: char) -> bool {
    s.starts_with(prefix)
        && s.len() >= 2
        && s.len() <= 16
        && s[1..].bytes().all(|c| c.is_ascii_digit())
}
fn merge(default: &Value, raw: &Value) -> Value {
    let mut v = default.clone();
    if let (Some(d), Some(r)) = (v.as_object_mut(), raw.as_object()) {
        for (k, x) in r {
            if !["__proto__", "prototype", "constructor"].contains(&k.as_str()) {
                d.insert(
                    k.clone(),
                    if default[k].is_object() && x.is_object() {
                        merge(&default[k], x)
                    } else {
                        x.clone()
                    },
                );
            }
        }
    }
    v
}
fn theme(raw: &Value, depth: usize, field: &str) -> Result<Value, String> {
    if depth > 50 {
        return Err("The saved world contains excessively nested data.".into());
    }
    fn rename(k: &str) -> &str {
        match k {
            "gems" => "blocks",
            "peakGems" => "peakBlocks",
            "apple" => "banana",
            "sponge" => "cloth",
            "ball" => "cricketball",
            "egg" => "lander",
            _ => k,
        }
    }
    if let Some(a) = raw.as_array() {
        return a
            .iter()
            .map(|v| theme(v, depth + 1, field))
            .collect::<Result<Vec<_>, _>>()
            .map(|v| json!(v));
    }
    if let Some(o) = raw.as_object() {
        let mut result = json!({});
        for (k, v) in o {
            if ["__proto__", "constructor", "prototype"].contains(&k.as_str()) {
                continue;
            }
            let next = rename(k);
            if next != k && o.contains_key(next) {
                continue;
            }
            result[next] = theme(v, depth + 1, k)?;
        }
        return Ok(result);
    }
    if ["type", "tool", "kind", "material", "resource", "resources"].contains(&field)
        && let Some(s) = raw.as_str()
    {
        return Ok(json!(if s == "peakGems" { s } else { rename(s) }));
    }
    Ok(raw.clone())
}
pub(crate) fn theme_compatible_world(raw: &Value) -> Result<Value, String> {
    let encoded = crate::value::js_json(raw);
    let legacy = [
        "\"gems\"",
        "\"peakGems\"",
        "\"apple\"",
        "\"sponge\"",
        "\"ball\"",
        "\"egg\"",
    ]
    .iter()
    .any(|s| encoded.contains(s));
    let converted = if legacy {
        if encoded.encode_utf16().count() > 8 * 1024 * 1024 {
            return Err("The saved world exceeds the import budget.".into());
        }
        theme(raw, 0, "")?
    } else {
        raw.clone()
    };
    Ok(converted)
}
impl Engine {
    pub(crate) fn migrate_world(&mut self, raw: Value) -> Result<Value, String> {
        let raw = theme_compatible_world(&raw)?;
        if raw.is_null() {
            let seed = num(&self.world["map"], "seed") as u32;
            return Ok(self.create_world(false, seed));
        }
        if num(&raw, "schema") == 1. {
            return self.migrate_schema_one(&raw);
        }
        if ![2., 3., 4.].contains(&num(&raw, "schema"))
            || !raw["creatures"].is_array()
            || !raw["objects"].is_array()
        {
            return Err("Unsupported or damaged world file.".into());
        }
        for c in list(&raw, "creatures") {
            if c.is_null()
                || ["fed", "clean", "amused"].iter().any(|k| {
                    let v = &c[*k];
                    v.is_null()
                        || v.is_boolean()
                        || crate::memory::js_number(v).is_none_or(|n| !n.is_finite())
                })
            {
                return Err(
                    "This saved world has incomplete creature needs. Choose another saved copy."
                        .into(),
                );
            }
        }
        let base = self.create_world(true, 18492);
        let mut w = base.clone();
        w["schema"] = json!(4);
        w["map"] = crate::terrain::normalize(&raw["map"], num(&raw, "schema") >= 3.)?;
        for (k, lo, hi) in [
            ("seed", 0., 4294967295.),
            ("nextId", 1., 1e15),
            ("nextEvent", 1., 1e15),
            ("revision", 0., 1e15),
            ("time", 0., 1e12),
            ("stage", 1., 4.),
            ("cohort", 0., 1e15),
        ] {
            w[k] = json!(n(&raw[k], lo, hi));
        }
        for k in ["nextId", "nextEvent", "stage", "cohort"] {
            w[k] = json!(num(&w, k).floor());
        }
        let mut ids = HashSet::new();
        let valid_types = [
            "tree",
            "rock",
            "node",
            "bridge",
            "monolith",
            "mountain",
            "lander",
            "banana",
            "cricketball",
            "log",
            "bone",
            "ore",
            "stump",
            "corpse",
            "hole",
            "flowers",
        ];
        let objects: Vec<_> = list(&raw, "objects")
            .iter()
            .take(2048)
            .filter(|o| {
                (valid_types.contains(&text(o, "type")) || BUILDINGS.contains(&text(o, "type")))
                    && valid_id(text(o, "id"), 'o')
                    && ids.insert(text(o, "id").to_string())
            })
            .map(|o| {
                let mut o = o.clone();
                o["x"] = json!(coord(&o["x"], 0.));
                o["y"] = json!(coord(&o["y"], 0.));
                ns(&mut o, "stock", 0., 1e15);
                ns(&mut o, "progress", 0., 1e12);
                ns(&mut o, "variant", 0., 2.);
                for k in ["level", "quality"] {
                    o[k] = json!(
                        n(
                            o.get(k).filter(|v| !v.is_null()).unwrap_or(&json!(1)),
                            1.,
                            2.
                        )
                        .floor()
                    );
                }
                o
            })
            .collect();
        w["objects"] = json!(objects);
        let creatures: Vec<_> = list(&raw, "creatures")
            .iter()
            .take(2048)
            .filter(|c| valid_id(text(c, "id"), 'c') && ids.insert(text(c, "id").to_string()))
            .map(|c| {
                let mut c = c.clone();
                c["name"] = json!(clipped(
                    &if truthy(&c["name"]) {
                        js_string(&c["name"])
                    } else {
                        "Pip".into()
                    },
                    100
                ));
                for k in ["x", "y"] {
                    c[k] = json!(coord(&c[k], 0.));
                }
                for k in ["fed", "clean", "amused"] {
                    ns(&mut c, k, 0., 100.);
                }
                for (k, hi) in [
                    ("age", 1e12),
                    ("growth", 50.),
                    ("work", 100.),
                    ("deadTime", 30.),
                    ("carry", 12.),
                ] {
                    ns(&mut c, k, 0., hi);
                }
                for (k, p) in [("wanderX", "x"), ("wanderY", "y")] {
                    c[k] = json!(coord(&c[k], num(&c, p)));
                }
                if !list(&w, "objects")
                    .iter()
                    .any(|o| same_id(&o["id"], &c["target"]))
                {
                    c["target"] = Value::Null;
                }
                c["boost"] = json!(truthy(&c["boost"]));
                c
            })
            .collect();
        w["creatures"] = json!(creatures);
        let overflow = list(&raw, "creatures")
            .iter()
            .skip(2048)
            .filter(|c| valid_id(text(c, "id"), 'c') && ids.insert(text(c, "id").to_string()))
            .count();
        increment(&mut w, "cohort", overflow as f64);
        w["population"] = json!((num(&w, "cohort") + list(&w, "creatures").len() as f64).min(1e15));
        for k in ["wood", "blocks", "ore", "bones", "corpses"] {
            w["inventory"][k] = json!(n(&raw["inventory"][k], 0., 1e15));
        }
        for k in [
            "hatched",
            "bridge",
            "monolith",
            "energy",
            "peakBlocks",
            "chopped",
            "bugs",
            "pollution",
            "uplinks",
            "grabber",
            "swarm",
            "tnt",
            "cannon",
            "choicePending",
        ] {
            if let Some(v) = raw["progress"].get(k) {
                w["progress"][k] = if v.is_boolean() {
                    v.clone()
                } else {
                    json!(n(v, 0., 1e15))
                };
            }
        }
        ns(&mut w["progress"], "pollution", 0., 1000.);
        if let Some(memory) = raw.get("memory") {
            crate::memory::validate_memory(memory)?;
        }
        let normalized = normalize_memory(&raw["memory"]);
        w["memory"] = merge(&w["memory"], &normalized);
        w["memory"]["recent"] = json!(
            tail(&raw["memory"]["recent"], 160)
                .into_iter()
                .filter(|e| e["kind"].is_string())
                .map(|mut e| {
                    if !e.is_object() {
                        e = json!({});
                    }
                    ns(&mut e, "id", 0., 1e15);
                    ns(&mut e, "tick", 0., 1e12);
                    e["at"] = e["at"]
                        .as_str()
                        .map(|s| json!(clipped(s, 32)))
                        .unwrap_or(Value::Null);
                    ts(&mut e, "kind", 40);
                    ts(&mut e, "message", 220);
                    e["entity"] = e["entity"]
                        .as_str()
                        .map(|s| json!(clipped(s, 40)))
                        .unwrap_or(Value::Null);
                    e
                })
                .collect::<Vec<_>>()
        );
        w["memory"]["totals"] = json!({});
        if let Some(t) = raw["memory"]["totals"].as_object() {
            for (k, v) in t.iter().take(64) {
                if !["__proto__", "constructor", "prototype"].contains(&k.as_str()) {
                    w["memory"]["totals"][clipped(k, 40)] = json!(n(v, 0., 1e15));
                }
            }
        }
        w["memory"]["choices"] = json!(
            tail(&raw["memory"]["choices"], 32)
                .iter()
                .map(|v| clipped(&js_string(v), 100))
                .collect::<Vec<_>>()
        );
        w["memory"]["activity"] = json!({});
        for k in TASKS {
            if let Some(v) = raw["memory"]["activity"].get(k) {
                w["memory"]["activity"][*k] = json!(n(v, 0., 1e15));
            }
        }
        w["memory"]["jobs"] = json!(
            tail(&raw["memory"]["jobs"], 64)
                .into_iter()
                .filter(|j| TASKS.contains(&text(j, "task")))
                .map(|mut j| {
                    if !j.is_object() {
                        j = json!({});
                    }
                    ts(&mut j, "unit", 40);
                    ts(&mut j, "target", 40);
                    ns(&mut j, "tick", 0., 1e12);
                    j
                })
                .collect::<Vec<_>>()
        );
        w["memory"]["conversations"] = json!(
            tail(&raw["memory"]["conversations"], 24)
                .into_iter()
                .filter(|t| t["text"].is_string() && t["reply"].is_string())
                .map(|mut t| {
                    if !t.is_object() {
                        t = json!({});
                    }
                    ts(&mut t, "text", 500);
                    ts(&mut t, "reply", 500);
                    if text(&t, "source").is_empty() {
                        t["source"] = json!("Local conversation");
                    }
                    ts(&mut t, "source", 80);
                    ns(&mut t, "tick", 0., 1e12);
                    t["listener"] = t["listener"]
                        .as_str()
                        .map(|s| json!(clipped(s, 40)))
                        .unwrap_or(Value::Null);
                    t
                })
                .collect::<Vec<_>>()
        );
        w["memory"]["goals"] = crate::goals::normalize_goals(&raw["memory"]["goals"]);
        let lp = &raw["memory"]["lastPlan"];
        if ["care", "balanced", "expand", "build", "industry", "mine"].contains(&text(lp, "policy"))
        {
            let mut p = lp.clone();
            ts(&mut p, "source", 60);
            ns(&mut p, "tick", 0., 1e12);
            if !list(&w["memory"], "goals")
                .iter()
                .any(|g| same_id(&g["id"], &p["goalId"]))
            {
                p["goalId"] = Value::Null;
            }
            w["memory"]["lastPlan"] = p;
        } else {
            w["memory"]["lastPlan"] = Value::Null;
        }
        let u = &raw["ui"];
        w["ui"] = merge(&base["ui"], u);
        for k in ["x", "y"] {
            w["ui"][k] = json!(coord(&u[k], 24.));
        }
        w["ui"]["zoom"] = json!(n(
            u.get("zoom").filter(|v| !v.is_null()).unwrap_or(&json!(1)),
            0.55,
            2.4
        ));
        w["ui"]["tool"] = json!(clipped(
            u["tool"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("inspect"),
            40
        ));
        w["ui"]["selected"] = u["selected"]
            .as_str()
            .map(|s| json!(clipped(s, 40)))
            .unwrap_or(Value::Null);
        if !["care", "build", "tools"].contains(&text(u, "tab")) {
            w["ui"]["tab"] = json!("care");
        }
        for k in ["muted", "paused", "welcome"] {
            w["ui"][k] = json!(truthy(&u[k]));
        }
        let s = &raw["settings"];
        w["settings"] = merge(&base["settings"], s);
        for k in ["backend", "localBackend", "voiceBackend"] {
            w["settings"][k] = if ["webgpu", "wasm"].contains(&text(s, k)) {
                s[k].clone()
            } else if k == "backend" {
                json!("auto")
            } else {
                Value::Null
            };
        }
        for (k, max) in [("model", 120), ("url", 300)] {
            w["settings"][k] = json!(clipped(
                s[k].as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(text(&base["settings"], k)),
                max
            ));
        }
        w["settings"]["autonomy"] = json!(s["autonomy"] != json!(false));
        if !["slow", "medium", "fast", "extra-fast"].contains(&text(s, "decisionSpeed")) {
            w["settings"]["decisionSpeed"] = json!("medium");
        }
        w["settings"]["intelligenceWorkers"] = json!(n(&s["intelligenceWorkers"], 1., 3.).round());
        for k in ["localEnabled", "voiceEnabled"] {
            w["settings"][k] = json!(flag(s, k));
        }
        w["settings"]["voiceConfigured"] =
            json!(flag(s, "voiceConfigured") || flag(s, "voiceEnabled"));
        w["savedAt"] = if truthy(&raw["savedAt"]) {
            raw["savedAt"].clone()
        } else {
            Value::Null
        };
        for g in list(&w["memory"], "goals") {
            ids.insert(text(g, "id").into());
        }
        for id in ids {
            let v = id
                .get(1..)
                .and_then(|s| s.parse::<f64>().ok())
                .map(|n| n + 1.)
                .unwrap_or(1.);
            let max = num(&w, "nextId").max(v);
            set_num(&mut w, "nextId", max);
        }
        let next = list(&w["memory"], "recent")
            .iter()
            .map(|e| num(e, "id") + 1.)
            .fold(num(&w, "nextEvent"), f64::max);
        set_num(&mut w, "nextEvent", next);
        self.migrate_extensions(&mut w, &raw)?;
        w["discovery"] = crate::discovery::normalize(&raw["discovery"], &w)?;
        strip_save_fields(&mut w);
        Ok(w)
    }
    fn migrate_schema_one(&mut self, raw: &Value) -> Result<Value, String> {
        let new = self.create_world(false, num(&self.world["map"], "seed") as u32);
        let mut staging = Engine::from_json(&new.to_string())?;
        staging.now_iso = self.now_iso.clone();
        staging.world["objects"]
            .as_array_mut()
            .unwrap()
            .retain(|o| text(o, "type") != "lander");
        staging.world["progress"]["hatched"] = json!(true);
        let pop = n(&raw["population"], 0., 1e15).floor();
        for _ in 0..(pop as usize).min(2048) {
            let x = 19. + staging.random() * 11.;
            let y = 19. + staging.random() * 11.;
            if let Some(c) = staging.add_creature(x, y, None)
                && let Some(c) = staging.world["creatures"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|x| same_id(&x["id"], &c["id"]))
            {
                for k in ["fed", "clean", "amused"] {
                    c[k] = json!(n(
                        raw["needs"]
                            .get(k)
                            .filter(|v| !v.is_null())
                            .unwrap_or(&json!(70)),
                        0.,
                        100.
                    ));
                }
            }
        }
        staging.world["cohort"] = json!(pop - list(&staging.world, "creatures").len() as f64);
        staging.world["population"] = json!(pop);
        for k in ["wood", "blocks", "ore", "bones", "corpses"] {
            staging.world["inventory"][k] = json!(n(&raw["inventory"][k], 0., 1e15));
        }
        let mut count = 0;
        if let Some(b) = raw["buildings"].as_object() {
            for (kind, value) in b {
                if BUILDINGS.contains(&kind.as_str()) {
                    for _ in 0..n(value, 0., 8.).ceil() as usize {
                        staging.add_object(
                            kind,
                            19. + (count % 5) as f64 * 3.,
                            17. + (count / 5) as f64 * 3.,
                            json!({"stock":if kind=="orchard"{6}else{0}}),
                        );
                        count += 1;
                    }
                }
            }
        }
        if truthy(&raw["partTwo"]) {
            staging.world["stage"] = json!(2);
            staging.world["progress"]["bridge"] = json!(true);
            staging.world["progress"]["monolith"] = json!(true);
        }
        staging.world["progress"]["peakBlocks"] = staging.world["inventory"]["blocks"].clone();
        staging.world["settings"]["provider"] =
            json!(if text(raw, "brainProvider") == "openrouter" {
                "openrouter"
            } else {
                "laya"
            });
        for (k, r, max) in [
            ("url", "openRouterUrl", 300),
            ("model", "openRouterModel", 120),
        ] {
            if !text(raw, r).is_empty() {
                staging.world["settings"][k] = json!(clipped(text(raw, r), max));
            }
        }
        for e in tail(&raw["history"], 40) {
            staging.remember(
                "legacy",
                e["value"]
                    .as_str()
                    .unwrap_or(e["kind"].as_str().unwrap_or("A past action")),
                None,
            );
        }
        staging.remember(
            "migration",
            "Your earlier colony has moved into its new world. The original save is archived.",
            None,
        );
        staging.world["ui"]["paused"] = json!(true);
        staging.world["discovery"] = crate::discovery::normalize(&Value::Null, &staging.world)?;
        self.migrate_world(staging.world)
    }
    pub(crate) fn migrate_extensions(&mut self, w: &mut Value, raw: &Value) -> Result<(), String> {
        validate_extension_records(w, raw)?;
        let time = num(w, "time");
        let current: HashSet<_> = list(w, "creatures")
            .iter()
            .map(|c| text(c, "id").to_string())
            .collect();
        w["nextBirth"] = json!(n(&raw["nextBirth"], 0., 1e15).floor());
        for k in ["commandRevision", "navRevision"] {
            w[k] = json!(n(&raw[k], 0., 1e15));
        }
        let geometry = Geometry::new(w);
        let mut next_birth = num(w, "nextBirth");
        for (i, c) in w["creatures"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .enumerate()
        {
            let original = list(raw, "creatures")
                .iter()
                .find(|item| same_id(&item["id"], &c["id"]))
                .unwrap_or(&Value::Null);
            for key in [
                "birthOrdinal",
                "dictionaryVersion",
                "nameIndex",
                "customName",
                "parentId",
                "birthTick",
                "traits",
                "favorite",
                "encounters",
                "relationships",
                "cargoKind",
                "heading",
                "sickness",
                "boostUntil",
                "lastWorkTurn",
                "workCycles",
                "task",
                "blocked",
                "job",
            ] {
                c[key] = original[key].clone();
            }
            c["identityVersion"] = json!(1);
            c["birthOrdinal"] = json!(
                n(
                    c.get("birthOrdinal")
                        .filter(|v| !v.is_null())
                        .unwrap_or(&json!(i)),
                    0.,
                    1e15
                )
                .floor()
            );
            c["dictionaryVersion"] = json!(if num(c, "dictionaryVersion") == 1. {
                1
            } else {
                0
            });
            c["nameIndex"] = json!(n(&c["nameIndex"], 0., 16383.).floor());
            for k in ["customName", "parentId"] {
                c[k] = if truthy(&c[k]) {
                    json!(clipped(
                        &js_string(&c[k]),
                        if k == "customName" { 100 } else { 40 }
                    ))
                } else {
                    Value::Null
                };
            }
            ns(c, "birthTick", 0., time);
            let original_traits = c["traits"].clone();
            if !c["traits"].is_object() {
                c["traits"] = json!({});
            }
            for k in ["curiosity", "sociability", "diligence"] {
                c["traits"][k] = json!(n(
                    original_traits
                        .get(k)
                        .filter(|v| !v.is_null())
                        .unwrap_or(&json!(0.5)),
                    0.,
                    1.
                ));
            }
            c["favorite"] = json!(truthy(&c["favorite"]));
            c["encounters"] = json!(
                tail(&c["encounters"], 8)
                    .into_iter()
                    .map(|mut e| {
                        if !e.is_object() {
                            e = json!({});
                        }
                        ts(&mut e, "kind", 24);
                        ts(&mut e, "other", 40);
                        ns(&mut e, "tick", 0., 1e15);
                        e
                    })
                    .collect::<Vec<_>>()
            );
            c["relationships"] = json!(
                tail(&c["relationships"], 4)
                    .into_iter()
                    .map(|mut e| {
                        if !e.is_object() {
                            e = json!({});
                        }
                        ts(&mut e, "id", 40);
                        e["affinity"] =
                            json!(e.get("affinity").map(|v| n(v, -10., 10.)).unwrap_or(-10.));
                        ns(&mut e, "last", 0., 1e15);
                        e
                    })
                    .collect::<Vec<_>>()
            );
            if !["wood", "bones", "ore"].contains(&text(c, "cargoKind")) {
                c["cargoKind"] = if num(c, "carry") > 0. {
                    json!("wood")
                } else {
                    Value::Null
                };
            }
            c["heading"] = json!(n(
                c.get("heading")
                    .filter(|v| !v.is_null())
                    .unwrap_or(&json!(0)),
                -std::f64::consts::PI,
                std::f64::consts::PI
            ));
            ns(c, "sickness", 0., 100.);
            ns(c, "boostUntil", 0., 1e12);
            for k in ["lastWorkTurn", "workCycles"] {
                c[k] = json!(n(&c[k], 0., 1e15).floor());
            }
            if !TASKS.contains(&text(c, "task")) {
                c["task"] = json!("idle");
            }
            c["blocked"] = json!(
                tail(&c["blocked"], 8)
                    .into_iter()
                    .map(|mut b| {
                        if !b.is_object() {
                            b = json!({});
                        }
                        ts(&mut b, "target", 40);
                        ns(&mut b, "until", 0., 1e12);
                        ns(&mut b, "revision", 0., 1e15);
                        b
                    })
                    .collect::<Vec<_>>()
            );
            let mut j = c["job"].clone();
            if STATES.contains(&text(&j, "state")) && !j["point"].is_null() {
                j["slot"] = json!(n(&j["slot"], 0., 64.).floor());
                j["point"] = point(&j["point"]);
                if !current.contains(text(&j, "partner")) {
                    j["partner"] = Value::Null;
                }
                j["project"] = if j["project"].is_null() || num(&j, "project") == 0. {
                    Value::Null
                } else {
                    json!(n(&j["project"], 0., 1e15).floor())
                };
                ts(&mut j, "purpose", 160);
                for k in ["started", "lastProgress"] {
                    ns(&mut j, k, 0., time);
                }
                j["progressAt"] = json!(n(
                    j.get("progressAt")
                        .filter(|v| !v.is_null())
                        .unwrap_or(&j["lastProgress"]),
                    0.,
                    time
                ));
                j["bestDistance"] = json!(n(
                    j.get("bestDistance")
                        .filter(|v| !v.is_null())
                        .unwrap_or(&json!(Point::read(c).distance(Point::read(&j["point"])))),
                    0.,
                    300.
                ));
                ns(&mut j, "expected", 0., 300.);
                c["job"] = j;
            } else {
                c["job"] = Value::Null;
            }
            if c["job"].is_null() && !c["target"].is_null() {
                let target = geometry
                    .objects
                    .iter()
                    .find(|o| Some(o.id.as_str()) == c["target"].as_str());
                let slot =
                    target.and_then(|o| geometry.service_slots(o, Point::read(c)).first().cloned());
                if let Some(p) = slot {
                    c["job"] = json!({"state":"reserved","slot":p["slot"],"point":p,"partner":null,"purpose":"Continue saved work","started":time,"lastProgress":time,"expected":60});
                } else {
                    c["task"] = json!("idle");
                    c["target"] = Value::Null;
                }
            }
            next_birth = next_birth.max(num(c, "birthOrdinal") + 1.);
        }
        w["nextBirth"] = json!(next_birth);
        for o in w["objects"].as_array_mut().unwrap() {
            let original = list(raw, "objects")
                .iter()
                .find(|x| same_id(&x["id"], &o["id"]))
                .unwrap_or(&Value::Null);
            if text(o, "type") == "bridge" {
                let g = bridge(&Object::read(o));
                let b = &original["bridge"];
                let required = n(
                    b.get("required")
                        .filter(|v| !v.is_null())
                        .unwrap_or(&json!(24)),
                    1.,
                    1000.,
                );
                let mut data = if b.is_object() {
                    merge(
                        &json!({"a":g.a,"b":g.b,"width":g.width,"required":required,"delivered":{"wood":0,"bones":0},"complete":false,"elevation":0.18}),
                        b,
                    )
                } else {
                    json!({"a":g.a,"b":g.b,"width":g.width,"required":24,"delivered":{"wood":num(o,"stock"),"bones":0},"complete":g.complete,"elevation":0.18})
                };
                if b.is_object() {
                    data["a"] = point(&b["a"]);
                    data["b"] = point(&b["b"]);
                    data["width"] = json!(n(&b["width"], 1., 4.));
                    data["required"] = json!(required);
                    for k in ["wood", "bones"] {
                        data["delivered"][k] = json!(n(&b["delivered"][k], 0., 1000.));
                    }
                    data["complete"] = json!(truthy(&b["complete"]));
                } else if flag(&raw["progress"], "bridge") {
                    data["complete"] = json!(true);
                    data["delivered"]["wood"] = data["required"].clone();
                }
                o["stock"] =
                    json!(num(&data["delivered"], "wood") + num(&data["delivered"], "bones"));
                o["bridge"] = data;
            }
            o["inputOre"] = json!(n(&original["inputOre"], 0., 60.));
            o["discovered"] = json!(truthy(&original["discovered"]));
            o["phase"] = json!(n(&original["phase"], 0., 1e12));
            o["contact"] = json!(if num(original, "contact") == 2. { 2 } else { 1 });
        }
        w["departed"] = json!(
            tail(&raw["departed"], 32)
                .into_iter()
                .map(|mut d| {
                    if !d.is_object() {
                        d = json!({});
                    }
                    for (k, max) in [("id", 40), ("name", 100), ("cause", 30), ("actor", 40)] {
                        ts(&mut d, k, max);
                    }
                    ns(&mut d, "tick", 0., 1e15);
                    d
                })
                .collect::<Vec<_>>()
        );
        w["pollution"] = json!(
            tail(&raw["pollution"], 64)
                .into_iter()
                .map(|mut z| {
                    if !z.is_object() {
                        z = json!({});
                    }
                    ts(&mut z, "source", 40);
                    z["x"] = json!(coord(&z["x"], 0.));
                    z["y"] = json!(coord(&z["y"], 0.));
                    ns(&mut z, "radius", 1., 12.);
                    ns(&mut z, "amount", 0., 250.);
                    z
                })
                .collect::<Vec<_>>()
        );
        if num(raw, "schema") < 4. && num(&w["progress"], "pollution") > 0. {
            let factories: Vec<_> = list(w, "objects")
                .iter()
                .filter(|o| text(o, "type") == "factory")
                .collect();
            w["pollution"]=json!(factories.iter().take(64).map(|o|json!({"source":o["id"],"x":o["x"],"y":o["y"],"radius":5,"amount":num(&w["progress"],"pollution")/factories.len().max(1) as f64})).collect::<Vec<_>>());
        }
        let s = &raw["story"];
        let mut st = merge(&story::initial_story(), s);
        for (k, limit) in [("completed", 128), ("seen", 128), ("queue", 24)] {
            let mut seen = HashSet::new();
            st[k] = json!(
                tail(&s[k], limit)
                    .into_iter()
                    .filter(|id| story::entry(id.as_str().unwrap_or("")).is_some()
                        && (k == "queue" || seen.insert(id.clone())))
                    .collect::<Vec<_>>()
            );
        }
        st["active"] = if story::entry(text(s, "active")).is_some() {
            s["active"].clone()
        } else {
            Value::Null
        };
        st["lastAt"] = json!(n(
            s.get("lastAt")
                .filter(|v| !v.is_null())
                .unwrap_or(&json!(-60)),
            -60.,
            1e12
        ));
        st["lastLetterAt"] = json!(n(
            s.get("lastLetterAt")
                .filter(|v| !v.is_null())
                .unwrap_or(&json!(time)),
            0.,
            time
        ));
        st["lastIncidentAt"] = json!(n(&s["lastIncidentAt"], 0., time));
        for (k, limit) in [("refusals", 24), ("archives", 6)] {
            st[k] = json!(
                tail(&s[k], limit)
                    .iter()
                    .map(|x| clipped(
                        &if truthy(x) {
                            js_string(x)
                        } else {
                            String::new()
                        },
                        40
                    ))
                    .collect::<Vec<_>>()
            );
        }
        st["promises"] = json!(
            tail(&s["promises"], 16)
                .into_iter()
                .map(|mut p| {
                    if !p.is_object() {
                        p = json!({});
                    }
                    ts(&mut p, "request", 40);
                    p["status"] = json!(if text(&p, "status") == "kept" {
                        "kept"
                    } else {
                        "pending"
                    });
                    ns(&mut p, "tick", 0., 1e15);
                    ns(&mut p, "before", 0., 1e15);
                    p
                })
                .collect::<Vec<_>>()
        );
        st["evidence"] = json!(
            tail(&s["evidence"], 24)
                .into_iter()
                .map(|mut e| {
                    if !e.is_object() {
                        e = json!({});
                    }
                    for (k, max) in [("kind", 40), ("first", 180), ("last", 180), ("entity", 40)] {
                        ts(&mut e, k, max);
                    }
                    ns(&mut e, "count", 0., 1e15);
                    ns(&mut e, "tick", 0., 1e15);
                    e
                })
                .collect::<Vec<_>>()
        );
        st["assessments"] = json!(
            tail(&s["assessments"], 5)
                .into_iter()
                .map(|mut a| {
                    if !a.is_object() {
                        a = json!({});
                    }
                    for (k, max) in [("dimension", 32), ("text", 220), ("consequence", 200)] {
                        ts(&mut a, k, max);
                    }
                    ns(&mut a, "value", 0., 1e15);
                    a
                })
                .collect::<Vec<_>>()
        );
        st["responses"] = json!(
            tail(&s["responses"], 32)
                .into_iter()
                .filter(|r| story::entry(text(r, "id")).is_some())
                .map(|mut r| {
                    if !r.is_object() {
                        r = json!({});
                    }
                    ts(&mut r, "response", 100);
                    ns(&mut r, "tick", 0., 1e15);
                    r
                })
                .collect::<Vec<_>>()
        );
        w["story"] = st;
        for k in story::initial_evidence().as_object().unwrap().keys() {
            w["evidence"][k] = json!(n(&raw["evidence"][k], 0., 1e15));
        }
        let d = &raw["directives"];
        w["directives"] = merge(&w["directives"], d);
        for k in ["pauseWork", "avoidPollution"] {
            w["directives"][k] = json!(truthy(&d[k]));
        }
        w["directives"]["careFloor"] = json!(n(
            d.get("careFloor")
                .filter(|v| !v.is_null())
                .unwrap_or(&json!(35)),
            35.,
            90.
        ));
        w["directives"]["members"] = json!(
            tail(&d["members"], 2048)
                .into_iter()
                .filter(|id| current.contains(id.as_str().unwrap_or("")))
                .collect::<Vec<_>>()
        );
        w["directives"]["region"] = if d["region"].is_null() {
            Value::Null
        } else {
            point(&d["region"])
        };
        for k in ["population", "fraction", "energy", "launches", "lastLaunch"] {
            w["orbital"][k] = json!(n(&raw["orbital"][k], 0., 1e15));
        }
        w["orbital"]["population"] = json!(num(&w["orbital"], "population").floor());
        w["orbital"]["fraction"] = json!(n(&raw["orbital"]["fraction"], 0., 0.999999999));
        for k in [
            "population",
            "capacity",
            "health",
            "fraction",
            "lossFraction",
        ] {
            w["district"][k] = json!(n(
                raw["district"]
                    .get(k)
                    .filter(|v| !v.is_null())
                    .unwrap_or(&json!(if k == "health" { 100 } else { 0 })),
                0.,
                1e15
            ));
        }
        for k in ["switches", "stalls", "completed", "violations", "decisions"] {
            w["metrics"][k] = json!(n(&raw["metrics"][k], 0., 1e15));
        }
        w["groups"] = json!(
            tail(&raw["groups"], 16)
                .into_iter()
                .map(|mut g| {
                    if !g.is_object() {
                        g = json!({});
                    }
                    for (k, max) in [("id", 40), ("role", 40), ("project", 80)] {
                        ts(&mut g, k, max);
                    }
                    ns(&mut g, "revision", 0., 1e15);
                    g["members"] = json!(
                        tail(&g["members"], 2048)
                            .into_iter()
                            .filter(|id| current.contains(id.as_str().unwrap_or("")))
                            .collect::<Vec<_>>()
                    );
                    g["outcomes"] = json!(
                        tail(&g["outcomes"], 8)
                            .iter()
                            .map(|x| clipped(
                                &if truthy(x) {
                                    js_string(x)
                                } else {
                                    String::new()
                                },
                                180
                            ))
                            .collect::<Vec<_>>()
                    );
                    g
                })
                .collect::<Vec<_>>()
        );
        w["decisions"] = json!(
            tail(&raw["decisions"], 32)
                .into_iter()
                .map(|mut d| {
                    if !d.is_object() {
                        d = json!({});
                    }
                    for (k, max) in [
                        ("goal", 80),
                        ("source", 80),
                        ("model", 120),
                        ("candidate", 24),
                        ("facts", 250),
                        ("expected", 200),
                        ("observed", 200),
                        ("rejection", 160),
                    ] {
                        ts(&mut d, k, max);
                    }
                    for k in ["tick", "baseline", "completed"] {
                        ns(&mut d, k, 0., 1e15);
                    }
                    d
                })
                .collect::<Vec<_>>()
        );
        self.migrate_community(w, raw, &current);
        let room = 1e15 - list(w, "creatures").len() as f64;
        w["cohort"] = json!(num(w, "cohort").floor().clamp(0., room));
        w["orbital"]["population"] = json!(
            num(&w["orbital"], "population")
                .floor()
                .clamp(0., room - num(w, "cohort"))
        );
        w["population"] = json!(
            list(w, "creatures").len() as f64 + num(w, "cohort") + num(&w["orbital"], "population")
        );
        let homes = list(w, "objects")
            .iter()
            .filter(|o| text(o, "type") == "dwelling")
            .map(|o| num(o, "level") * 48.)
            .sum::<f64>();
        let cohort = num(w, "cohort");
        let supported = cohort.min(homes);
        let unsupported = (cohort - supported).max(0.);
        let health = num(&w["district"], "health");
        w["district"]["capacity"] = json!(homes);
        w["district"]["population"] = json!(cohort);
        w["district"]["healthCounts"] = json!({"healthy":supported,"unwell":if health>0.{unsupported}else{0.},"critical":if health==0.{unsupported}else{0.}});
        w["district"]["allocations"] =
            json!({"care":(supported/8.).ceil(),"rest":(cohort-(supported/8.).ceil()).max(0.)});
        w["district"]["rates"] = json!({"births":if cohort<homes{supported*0.003}else{0.},"deaths":if health==0.{unsupported*0.005}else{0.},"energy":0});
        w["progress"]["secondContact"] = json!(truthy(&raw["progress"]["secondContact"]));
        w["progress"]["finalRequired"] =
            json!(n(&raw["progress"]["finalRequired"], 0., 3.).floor());
        let held = &raw["ui"]["held"];
        w["ui"]["held"] = if ["log", "bone", "ore", "corpse", "rock"].contains(&text(held, "type"))
        {
            merge(
                held,
                &json!({"stock":n(&held["stock"],0.,1e15),"id":clipped(text(held,"id"),40)}),
            )
        } else {
            Value::Null
        };
        w["settings"]["provider"] = json!(if ["laya", "openrouter", "jev"]
            .contains(&text(&raw["settings"], "provider"))
        {
            text(&raw["settings"], "provider")
        } else {
            "laya"
        });
        if num(raw, "schema") < 4. {
            let mut repaired = 0;
            for i in 0..list(w, "creatures").len() {
                let g = Geometry::new(w);
                let p = Point::read(&w["creatures"][i]);
                if !g.clear(p, BODY_RADIUS, None) {
                    let others: Vec<_> = g
                        .creatures
                        .iter()
                        .enumerate()
                        .filter(|(j, _)| *j != i)
                        .map(|(_, (_, p))| *p)
                        .collect();
                    if let Some(p) = g.free(p, &others, 10.) {
                        let c = &mut w["creatures"][i];
                        c["x"] = json!(p.x);
                        c["y"] = json!(p.y);
                        c["job"] = Value::Null;
                        c["target"] = Value::Null;
                        c["task"] = json!("idle");
                        repaired += 1;
                    }
                }
            }
            if !flag(&w["progress"], "monolith")
                && let Some(stone) = w["objects"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|o| text(o, "type") == "monolith")
            {
                stone["x"] = json!(35);
                stone["y"] = json!(25);
            }
            if flag(&w["progress"], "tnt") {
                w["progress"]["secondContact"] = json!(true);
            }
            w["ui"]["paused"] = json!(true);
            increment(w, "commandRevision", 1.);
            increment(w, "navRevision", 1.);
            let id = num(w, "nextEvent");
            increment(w, "nextEvent", 1.);
            w["memory"]["recent"].as_array_mut().unwrap().push(json!({"id":id,"tick":time.floor(),"at":self.now_iso,"kind":"migration","message":format!("World updated; names and health preserved. {repaired} creatures moved onto clear ground."),"entity":null}));
            w["memory"]["recent"] = json!(tail(&w["memory"]["recent"], 160));
        }
        strip_extension_fields(w);
        Ok(())
    }
    fn migrate_community(&self, w: &mut Value, raw: &Value, current: &HashSet<String>) {
        let time = num(w, "time");
        let c = &raw["community"];
        let mut result = merge(&community::initial_community(), c);
        if !["unasked", "offered", "accepted", "declined"].contains(&text(c, "consent")) {
            result["consent"] = json!("unasked");
        }
        for k in ["nextProject", "nextAccess", "nextMessage"] {
            result[k] = json!(n(&c[k], 0., 1e15).floor().max(1.));
        }
        result["workTurn"] = json!(
            list(w, "creatures")
                .iter()
                .map(|c| num(c, "lastWorkTurn"))
                .fold(n(&c["workTurn"], 0., 1e15), f64::max)
        );
        for k in ["completed", "explored"] {
            result[k] = json!(n(&c[k], 0., 1e15).floor());
        }
        for k in ["lastProjectAt", "lastNoticeAt"] {
            result[k] = json!(n(
                c.get(k).filter(|v| !v.is_null()).unwrap_or(&json!(-60)),
                -60.,
                time
            ));
        }
        result["access"] = json!(
            tail(&c["access"], 8)
                .into_iter()
                .filter(|r| r.is_object()
                    && !r["point"].is_null()
                    && TASKS.contains(&text(r, "task")))
                .map(|mut r| {
                    if !r.is_object() {
                        r = json!({});
                    }
                    r["id"] = json!(n(&r["id"], 0., 1e15).floor().max(1.));
                    for (k, max) in [("key", 80), ("label", 40), ("reason", 240), ("source", 80)] {
                        ts(&mut r, k, max);
                    }
                    for k in ["target", "blocker"] {
                        r[k] = r[k]
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .map(|s| json!(clipped(s, 40)))
                            .unwrap_or(Value::Null);
                    }
                    r["point"] = point(&r["point"]);
                    if !current.contains(text(&r, "unit")) {
                        r["unit"] = Value::Null;
                    }
                    r["project"] = if r["project"].is_null() || num(&r, "project") == 0. {
                        Value::Null
                    } else {
                        json!(n(&r["project"], 0., 1e15).floor())
                    };
                    for k in ["created", "lastSeen"] {
                        ns(&mut r, k, 0., time);
                    }
                    r["checked"] = json!(-10);
                    if !["waiting", "ready", "clearing", "help"].contains(&text(&r, "status")) {
                        r["status"] = json!("waiting");
                    }
                    r["crew"] = json!(
                        tail(&r["crew"], 1)
                            .into_iter()
                            .filter(|id| current.contains(id.as_str().unwrap_or("")))
                            .collect::<Vec<_>>()
                    );
                    r["notified"] = json!(truthy(&r["notified"]));
                    r
                })
                .collect::<Vec<_>>()
        );
        let mut visited = HashSet::new();
        result["visited"] = json!(
            tail(&c["visited"], 64)
                .into_iter()
                .filter(|v| {
                    let Some(s) = v.as_str() else { return false };
                    let p: Vec<_> = s.split(':').collect();
                    p.len() == 2
                        && p.iter().all(|part| {
                            let p = part.strip_prefix('-').unwrap_or(part);
                            !p.is_empty() && p.len() <= 10 && p.bytes().all(|c| c.is_ascii_digit())
                        })
                        && visited.insert(s.to_string())
                })
                .collect::<Vec<_>>()
        );
        result["inbox"] = json!(
            tail(&c["inbox"], 64)
                .into_iter()
                .filter(Value::is_object)
                .map(|mut m| {
                    if !m.is_object() {
                        m = json!({});
                    }
                    m["id"] = json!(n(&m["id"], 0., 1e15).floor());
                    m["key"] = m["key"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(|s| json!(clipped(s, 80)))
                        .unwrap_or(Value::Null);
                    ts(&mut m, "title", 100);
                    ts(&mut m, "text", 1200);
                    ns(&mut m, "tick", 0., time);
                    let entry = story::entry(text(&m, "story"));
                    if entry.is_none() {
                        m["story"] = Value::Null;
                    }
                    if text(&m, "action") != "independence" {
                        m["action"] = Value::Null;
                    }
                    if !["letter", "flight", "milestone", "work", "help"]
                        .contains(&text(&m, "category"))
                    {
                        m["category"] = json!("letter");
                    }
                    m["responseRequired"] = json!(entry.is_some_and(|e| {
                        list(&e, "responses").len() > 1
                            && !list(&w["story"], "responses")
                                .iter()
                                .any(|r| same_id(&r["id"], &m["story"]))
                    }));
                    m["read"] = json!(truthy(&m["read"]));
                    m["notified"] = json!(truthy(&m["notified"]));
                    m
                })
                .collect::<Vec<_>>()
        );
        result["activity"] = json!(
            tail(&c["activity"], 40)
                .into_iter()
                .map(|mut a| {
                    if !a.is_object() {
                        a = json!({});
                    }
                    ns(&mut a, "tick", 0., time);
                    for (k, max) in [("kind", 32), ("text", 220), ("source", 80), ("detail", 300)] {
                        ts(&mut a, k, max);
                    }
                    a
                })
                .collect::<Vec<_>>()
        );
        for (list_key, next_key) in [("inbox", "nextMessage"), ("access", "nextAccess")] {
            let next = list(&result, list_key)
                .iter()
                .map(|r| num(r, "id") + 1.)
                .fold(num(&result, next_key), f64::max);
            result[next_key] = json!(next);
        }
        if c["plan"]["children"].is_array() {
            let p = &c["plan"];
            let mut plan = p.clone();
            ts(&mut plan, "parent", 80);
            ts(&mut plan, "title", 120);
            plan["expanding"] = json!(truthy(&p["expanding"]));
            plan["density"] = merge(
                &p["density"],
                &json!({"target":6,"abovePenalty":4,"belowPenalty":0.6,"crowded":n(&p["density"]["crowded"],0.,2048.).floor(),"areas":tail(&p["density"]["areas"],6).iter().map(|a|json!({"x":coord(&a["x"],0.),"y":coord(&a["y"],0.),"residents":n(&a["residents"],0.,1e5),"buildings":n(&a["buildings"],0.,2048.)})).collect::<Vec<_>>()}),
            );
            plan["children"] = json!(
                tail(&p["children"], 7)
                    .into_iter()
                    .map(|mut s| {
                        if !s.is_object() {
                            s = json!({});
                        }
                        for (k, max) in [("id", 80), ("kind", 24), ("title", 120)] {
                            ts(&mut s, k, max);
                        }
                        ns(&mut s, "remaining", 0., 1e15);
                        if !["urgent", "needed", "satisfied", "working", "blocked"]
                            .contains(&text(&s, "status"))
                        {
                            s["status"] = json!("needed");
                        }
                        s
                    })
                    .collect::<Vec<_>>()
            );
            result["plan"] = plan;
        } else {
            result["plan"] = Value::Null;
        }
        result["project"] = Value::Null;
        result["projects"] = json!([]);
        let mut claimed = HashSet::new();
        let mut project_ids = HashSet::new();
        let mut projects = Vec::new();
        if !c["project"].is_null() {
            projects.push(c["project"].clone());
        }
        projects.extend(tail(&c["projects"], 23));
        for mut p in projects {
            if text(&result, "consent") != "accepted" || !DEVELOPMENT.contains(&text(&p, "type")) {
                continue;
            }
            let id = n(&p["id"], 0., 1e15).floor().max(1.);
            if project_ids.contains(&(id as u64)) {
                continue;
            }
            let mut members = HashSet::new();
            let crew: Vec<_> = tail(&p["crew"], 16)
                .into_iter()
                .filter(|id| {
                    let s = id.as_str().unwrap_or("");
                    current.contains(s) && !claimed.contains(s) && members.insert(s.to_string())
                })
                .collect();
            if crew.is_empty() {
                continue;
            }
            for id in &crew {
                claimed.insert(id.as_str().unwrap().to_string());
            }
            project_ids.insert(id as u64);
            p["id"] = json!(id);
            p["x"] = json!(coord(&p["x"], 0.));
            p["y"] = json!(coord(&p["y"], 0.));
            p["crew"] = json!(crew);
            p["target"] = json!(
                n(
                    p.get("target")
                        .filter(|v| !v.is_null())
                        .unwrap_or(&json!(24)),
                    1.,
                    1e6
                )
                .floor()
            );
            ns(&mut p, "progress", 0., 32.);
            p["required"] = json!(32);
            ns(&mut p, "started", 0., time);
            for (k, max) in [
                ("source", 80),
                ("blocked", 200),
                ("parentGoal", 80),
                ("subgoal", 40),
                ("siteReason", 240),
            ] {
                ts(&mut p, k, max);
            }
            if result["project"].is_null() {
                result["project"] = p;
            } else {
                result["projects"].as_array_mut().unwrap().push(p);
            }
            let next = num(&result, "nextProject").max(id + 1.);
            result["nextProject"] = json!(next);
        }
        w["community"] = result;
    }
}
fn validate_records(records: &Value, limit: usize, field: &str) -> Result<(), String> {
    if tail(records, limit).iter().any(Value::is_null) {
        return Err(format!(
            "Cannot read properties of null (reading '{field}')"
        ));
    }
    Ok(())
}
fn validate_extension_records(w: &Value, raw: &Value) -> Result<(), String> {
    for c in list(w, "creatures") {
        let original = list(raw, "creatures")
            .iter()
            .find(|v| same_id(&v["id"], &c["id"]))
            .unwrap_or(&Value::Null);
        for (name, limit, field) in [
            ("encounters", 8, "kind"),
            ("relationships", 4, "id"),
            ("blocked", 8, "target"),
        ] {
            validate_records(&original[name], limit, field)?;
        }
    }
    for (name, limit, field) in [
        ("departed", 32, "id"),
        ("pollution", 64, "source"),
        ("groups", 16, "id"),
        ("decisions", 32, "tick"),
    ] {
        validate_records(&raw[name], limit, field)?;
    }
    for (name, limit, field) in [
        ("promises", 16, "request"),
        ("evidence", 24, "kind"),
        ("assessments", 5, "dimension"),
        ("responses", 32, "id"),
    ] {
        validate_records(&raw["story"][name], limit, field)?;
    }
    validate_records(&raw["community"]["activity"], 40, "tick")?;
    if raw["community"]["plan"]["children"].is_array() {
        validate_records(
            &raw["community"]["plan"]["density"]["areas"],
            6,
            "residents",
        )?;
        validate_records(&raw["community"]["plan"]["children"], 7, "id")?;
    }
    Ok(())
}
fn keep(v: &mut Value, keys: &str) {
    if let Some(map) = v.as_object_mut() {
        map.retain(|key, _| keys.split(' ').any(|k| k == key));
    }
}
fn each(v: &mut Value, keys: &str) {
    if let Some(a) = v.as_array_mut() {
        for x in a {
            keep(x, keys);
        }
    }
}
fn strip_save_fields(w: &mut Value) {
    keep(
        w,
        "schema discovery seed map nextId nextEvent revision time population cohort stage creatures objects inventory progress memory ui settings savedAt nextBirth commandRevision navRevision groups departed pollution story evidence directives orbital district metrics decisions community",
    );
    each(
        &mut w["objects"],
        "id type x y stock level quality progress variant bridge inputOre discovered phase contact",
    );
    each(
        &mut w["creatures"],
        "id name x y fed clean amused age growth task target work wanderX wanderY deadTime carry boost identityVersion birthOrdinal dictionaryVersion nameIndex customName parentId birthTick traits favorite encounters relationships cargoKind heading sickness boostUntil lastWorkTurn workCycles blocked job",
    );
    keep(&mut w["inventory"], "wood blocks ore bones corpses");
    keep(
        &mut w["progress"],
        "hatched bridge monolith energy peakBlocks chopped bugs pollution uplinks grabber swarm tnt cannon choicePending secondContact finalRequired",
    );
    keep(
        &mut w["memory"],
        "commands summary recent totals choices jobs activity lastPlan conversations goals",
    );
    each(
        &mut w["memory"]["commands"],
        "id text reply status channel tick at source goalId listener",
    );
    each(&mut w["memory"]["recent"], "id tick at kind message entity");
    each(&mut w["memory"]["jobs"], "task unit target tick");
    each(
        &mut w["memory"]["conversations"],
        "text reply source tick listener",
    );
    keep(&mut w["memory"]["lastPlan"], "policy source tick goalId");
    keep(
        &mut w["ui"],
        "x y zoom tool selected tab muted paused welcome held",
    );
    keep(&mut w["ui"]["held"], "type stock id");
    keep(
        &mut w["settings"],
        "provider backend model url autonomy decisionSpeed intelligenceWorkers localEnabled localBackend voiceBackend voiceEnabled voiceConfigured",
    );
    keep(
        &mut w["evidence"],
        "care deliveries woodDelivered bonesDelivered deaths neglect pollutionDeaths hammer meteor meteorDeaths sacrificed cleaned discovered launches autonomy",
    );
    keep(
        &mut w["orbital"],
        "population fraction energy launches lastLaunch",
    );
    keep(
        &mut w["district"],
        "population capacity health fraction lossFraction healthCounts allocations rates",
    );
    keep(
        &mut w["metrics"],
        "switches stalls completed violations decisions",
    );
    strip_extension_fields(w);
}
fn strip_extension_fields(w: &mut Value) {
    for o in w["objects"].as_array_mut().unwrap() {
        if text(o, "type") == "bridge" {
            keep(
                &mut o["bridge"],
                "a b width elevation required delivered complete",
            );
            for p in ["a", "b"] {
                keep(&mut o["bridge"][p], "x y");
            }
            keep(&mut o["bridge"]["delivered"], "wood bones");
        }
    }
    for c in w["creatures"].as_array_mut().unwrap() {
        keep(&mut c["traits"], "curiosity sociability diligence");
        each(&mut c["encounters"], "kind other tick");
        each(&mut c["relationships"], "id affinity last");
        each(&mut c["blocked"], "target until revision");
        keep(
            &mut c["job"],
            "state slot point partner project purpose started lastProgress progressAt bestDistance expected",
        );
        if c["job"].is_object() {
            keep(&mut c["job"]["point"], "x y slot side");
        }
    }
    keep(&mut w["ui"]["held"], "type stock id");
    each(&mut w["departed"], "id name cause tick actor");
    each(&mut w["pollution"], "source x y radius amount");
    keep(
        &mut w["story"],
        "completed seen queue active lastAt lastLetterAt lastIncidentAt refusals promises responses archives evidence assessments",
    );
    each(&mut w["story"]["promises"], "request status tick before");
    each(&mut w["story"]["responses"], "id response tick");
    each(
        &mut w["story"]["evidence"],
        "kind count first last tick entity",
    );
    each(
        &mut w["story"]["assessments"],
        "dimension text value consequence",
    );
    keep(
        &mut w["directives"],
        "pauseWork avoidPollution careFloor members region",
    );
    keep(&mut w["directives"]["region"], "x y");
    each(
        &mut w["groups"],
        "id role project revision members outcomes",
    );
    each(
        &mut w["decisions"],
        "tick goal source model candidate facts expected observed rejection baseline completed",
    );
    let c = &mut w["community"];
    keep(
        c,
        "consent project projects nextProject lastProjectAt completed inbox nextMessage lastNoticeAt visited explored activity plan workTurn access nextAccess",
    );
    each(
        &mut c["access"],
        "id key target point unit task project label reason created lastSeen checked status blocker crew source notified",
    );
    each(
        &mut c["inbox"],
        "id key title text tick story action category responseRequired read notified",
    );
    each(&mut c["activity"], "tick kind text source detail");
    keep(&mut c["plan"], "parent title expanding density children");
    if c["plan"].is_object() {
        keep(
            &mut c["plan"]["density"],
            "target abovePenalty belowPenalty crowded areas",
        );
        each(
            &mut c["plan"]["density"]["areas"],
            "x y residents buildings",
        );
        each(&mut c["plan"]["children"], "id kind title remaining status");
    }
    let keys = "id type x y crew target progress required started source blocked parentGoal subgoal siteReason";
    keep(&mut c["project"], keys);
    each(&mut c["projects"], keys);
}
