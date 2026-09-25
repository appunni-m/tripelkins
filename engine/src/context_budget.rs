use crate::value::*;
use serde_json::{Value, json};
fn pick(v: &Value, keys: &[&str]) -> Value {
    let mut result = json!({});
    for key in keys {
        if let Some(value) = v.get(key) {
            result[*key] = value.clone();
        }
    }
    result
}
// Context descriptions use the source string budget in UTF-16 code units.
// Keep the wire string well formed when a supplementary character meets the edge.
fn description_prefix(value: &str) -> String {
    let mut units = 0;
    value
        .chars()
        .take_while(|character| {
            units += character.len_utf16();
            units <= 160
        })
        .collect()
}
fn rounded(v: &Value) -> Value {
    v.as_f64()
        .map(|f| json!((f + 0.5).floor()))
        .unwrap_or(Value::Null)
}
fn size(v: &Value) -> usize {
    js_json(v).len()
}
fn add(
    packed: &mut Value,
    omitted: &mut Vec<String>,
    budget: usize,
    key: &str,
    value: Option<Value>,
) {
    let Some(value) = value else { return };
    let mut trial = packed.clone();
    trial[key] = value;
    if size(&trial) <= budget {
        *packed = trial;
    } else {
        omitted.push(key.into());
    }
}
fn history(
    packed: &mut Value,
    omitted: &mut Vec<String>,
    budget: usize,
    key: &str,
    entries: &[Value],
) {
    let mut start = 0;
    while start < entries.len() {
        let mut trial = packed.clone();
        trial[key] = json!(&entries[start..]);
        if size(&trial) <= budget {
            *packed = trial;
            break;
        }
        start += 1;
    }
    if start > 0 {
        omitted.push(key.into());
    }
}
pub(crate) fn pack_hosted_context(full: &Value, budget: usize) -> Result<Value, String> {
    let mut minimum = json!({});
    for key in ["fed", "clean", "amused"] {
        minimum[key] = if list(full, "groups").is_empty() {
            Value::Null
        } else {
            json!(
                list(full, "groups")
                    .iter()
                    .map(|g| num(&g["needs"][key], "min"))
                    .fold(f64::INFINITY, f64::min)
            )
        };
    }
    let mut packed = json!({"version":4});
    for key in ["workload", "currentMilestone", "care"] {
        if let Some(value) = full.get(key) {
            packed[key] = value.clone();
        }
    }
    if full["developmentPlan"].is_object() {
        let p = &full["developmentPlan"];
        let mut plan = pick(p, &["parent", "expanding"]);
        plan["children"] = json!(
            list(p, "children")
                .iter()
                .map(|s| pick(s, &["kind", "status", "remaining"]))
                .collect::<Vec<_>>()
        );
        plan["density"] = pick(
            &p["density"],
            &["target", "crowded", "abovePenalty", "belowPenalty"],
        );
        packed["developmentPlan"] = plan;
    }
    for key in ["timber", "growthBudget"] {
        if let Some(value) = full.get(key) {
            packed[key] = value.clone();
        }
    }
    if !list(full, "blockedWork").is_empty() {
        packed["blockedWork"] = json!({"count":list(full,"blockedWork").len(),"requests":list(full,"blockedWork").iter().take(3).map(|r|pick(r,&["id","target","at","status","task","project","purpose","reason","prerequisite","nextStep","resume"])).collect::<Vec<_>>()});
    }
    if full["development"].is_object() {
        let d = &full["development"];
        let mut value = pick(d, &["densityRule", "outposts"]);
        value["choices"]=json!(list(d,"choices").iter().map(|c|{let mut r=pick(c,&["key","id","at","camps","target","cost","priority"]);if c["density"].is_object(){r["density"]=json!({"residents":((num(&c["density"],"residents")*10.+0.5).floor())/10.,"reward":((num(&c["density"],"reward")*10.+0.5).floor())/10.});}for key in ["benefit","travel"]{if c.get(key).is_some(){r[key]=rounded(&c[key]);}}for key in ["outpost","subgoal"]{if let Some(v)=c.get(key){r[key]=v.clone();}}if text(c,"id")=="clearance"{for key in ["request","blocker"]{if let Some(v)=c.get(key){r[key]=v.clone();}}r["description"]=json!(description_prefix(text(c,"description")));}r}).collect::<Vec<_>>());
        packed["development"] = value;
    }
    for key in [
        "tick",
        "population",
        "represented",
        "stage",
        "inventory",
        "bridge",
        "bridgeConstruction",
        "pollution",
    ] {
        if let Some(value) = full.get(key) {
            packed[key] = value.clone();
        }
    }
    packed["lowestNeeds"] = minimum;
    packed["longTermGoal"] = if full["longTermGoal"].is_object() {
        pick(
            &full["longTermGoal"],
            &["kind", "target", "value", "policy", "blocker"],
        )
    } else {
        Value::Null
    };
    packed["policies"] = json!(
        list(full, "candidates")
            .iter()
            .map(|c| c["id"].clone())
            .collect::<Vec<_>>()
    );
    for key in ["permissions", "independence", "commandRevision"] {
        if let Some(value) = full.get(key) {
            packed[key] = value.clone();
        }
    }
    packed["coverage"] = json!(
        "Current state is authoritative. Individual schedules execute locally. History and object details are bounded samples, not a complete transcript."
    );
    if size(&packed) > budget {
        return Err(
            "This connection has too little context space for the colony's essential state.".into(),
        );
    }
    let mut omitted = Vec::new();
    add(
        &mut packed,
        &mut omitted,
        budget,
        "candidateEffects",
        Some(json!(
            list(full, "candidates")
                .iter()
                .map(|c| {
                    let mut p = pick(c, &["id", "description", "allocation"]);
                    if let Some(v) = c.get("expected") {
                        p["effects"] = v.clone();
                    }
                    if let Some(v) = c.get("reward") {
                        p["reward"] = v.clone();
                    }
                    p
                })
                .collect::<Vec<_>>()
        )),
    );
    add(
        &mut packed,
        &mut omitted,
        budget,
        "promises",
        Some(full["story"].get("promises").cloned().unwrap_or(json!([]))),
    );
    add(
        &mut packed,
        &mut omitted,
        budget,
        "colonyStory",
        full["story"].get("premise").cloned(),
    );
    for key in ["projects", "outcomes"] {
        add(
            &mut packed,
            &mut omitted,
            budget,
            key,
            Some(full.get(key).cloned().unwrap_or(json!([]))),
        );
    }
    for (key, source) in [
        ("orbital", "orbital"),
        ("district", "district"),
        ("facilities", "objectCounts"),
        ("player", "player"),
        ("terrain", "terrain"),
    ] {
        add(
            &mut packed,
            &mut omitted,
            budget,
            key,
            full.get(source).cloned(),
        );
    }
    add(&mut packed,&mut omitted,budget,"groups",Some(json!(list(full,"groups").iter().map(|g|json!({"id":g["id"],"count":list(g,"members").len(),"center":g["center"],"needs":g["needs"],"urgent":list(g,"urgent").len()})).collect::<Vec<_>>())));
    history(
        &mut packed,
        &mut omitted,
        budget,
        "recentCommands",
        list(&full["memory"], "commands"),
    );
    add(
        &mut packed,
        &mut omitted,
        budget,
        "lastingChoices",
        full["memory"].get("choices").cloned(),
    );
    add(
        &mut packed,
        &mut omitted,
        budget,
        "lifetimeTotals",
        full["memory"].get("totals").cloned(),
    );
    let milestones = list(&full["memory"]["summary"], "milestones");
    history(
        &mut packed,
        &mut omitted,
        budget,
        "milestones",
        &milestones[milestones.len().saturating_sub(4)..],
    );
    add(
        &mut packed,
        &mut omitted,
        budget,
        "goalQueue",
        Some(json!(
            list(full, "goalQueue")
                .iter()
                .map(|g| pick(g, &["kind", "target"]))
                .collect::<Vec<_>>()
        )),
    );
    history(
        &mut packed,
        &mut omitted,
        budget,
        "recentEvents",
        list(&full["memory"], "recent"),
    );
    add(
        &mut packed,
        &mut omitted,
        budget,
        "candidateWork",
        Some(json!(
            list(full, "candidates")
                .iter()
                .map(|c| {
                    let mut p = pick(c, &["id", "description"]);
                    p["groups"] = json!(
                        list(c, "groups")
                            .iter()
                            .map(|g| {
                                let mut tasks = json!({});
                                for j in list(g, "jobs") {
                                    increment(&mut tasks, text(j, "task"), 1.);
                                }
                                json!({"id":g["id"],"tasks":tasks})
                            })
                            .collect::<Vec<_>>()
                    );
                    p
                })
                .collect::<Vec<_>>()
        )),
    );
    let mut objects = list(full, "objects").to_vec();
    objects.sort_by(|a, b| {
        if a["id"] == full["player"]["selected"] {
            std::cmp::Ordering::Less
        } else if b["id"] == full["player"]["selected"] {
            std::cmp::Ordering::Greater
        } else {
            num(a, "stock").total_cmp(&num(b, "stock"))
        }
    });
    objects.truncate(12);
    add(
        &mut packed,
        &mut omitted,
        budget,
        "objectSample",
        Some(json!(objects)),
    );
    let conversations = list(&full["memory"], "conversations");
    history(
        &mut packed,
        &mut omitted,
        budget,
        "recentConversation",
        &conversations[conversations.len().saturating_sub(2)..],
    );
    Ok(json!({"bytes":size(&packed),"context":packed,"budget":budget,"omitted":omitted}))
}
