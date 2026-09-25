use crate::{
    Engine,
    memory::{clipped, tail},
    value::*,
};
use serde_json::{Value, json};
use std::sync::OnceLock;
pub fn content() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("../data/story.json")).unwrap())
}
pub fn initial_story() -> Value {
    json!({"completed":[],"seen":[],"queue":[],"active":null,"lastAt":-60,"lastLetterAt":0,"lastIncidentAt":0,"refusals":[],"promises":[],"responses":[],"archives":[],"evidence":[],"assessments":[]})
}
pub fn initial_evidence() -> Value {
    json!({"care":0,"deliveries":0,"woodDelivered":0,"bonesDelivered":0,"deaths":0,"neglect":0,"pollutionDeaths":0,"hammer":0,"meteor":0,"meteorDeaths":0,"sacrificed":0,"cleaned":0,"discovered":0,"launches":0,"autonomy":0})
}
pub fn entry(id: &str) -> Option<Value> {
    ["beats", "incidents", "philosophy", "chapters"]
        .iter()
        .flat_map(|k| list(content(), k))
        .find(|e| text(e, "id") == id)
        .cloned()
}
fn contains(v: &Value, k: &str, id: &str) -> bool {
    list(v, k).iter().any(|x| x.as_str() == Some(id))
}
fn has(w: &Value, k: &str, n: usize) -> bool {
    list(w, "objects")
        .iter()
        .filter(|o| text(o, "type") == k)
        .count()
        >= n
}
fn comfortable(w: &Value) -> bool {
    !list(w, "creatures").is_empty()
        && list(w, "creatures")
            .iter()
            .all(|c| num(c, "fed").min(num(c, "clean")).min(num(c, "amused")) >= 60.)
}
fn completed_goal(w: &Value) -> bool {
    list(&w["memory"], "goals")
        .iter()
        .any(|g| text(g, "status") == "completed")
}
fn when(w: &Value, id: &str) -> bool {
    let p = &w["progress"];
    let e = &w["evidence"];
    let a = &w["memory"]["activity"];
    let total = &w["memory"]["totals"];
    let pop = num(w, "population");
    let time = num(w, "time");
    let c = &w["community"];
    match id {
        "awakening" => flag(p, "hatched"),
        "first-meal" => num(a, "eat") > 0.,
        "first-wash" => num(total, "wash") > 0. || num(a, "wash") > 0.,
        "first-play" => num(a, "play") > 0.,
        "first-child" => pop >= 2.,
        "shared-care" => pop >= 6.,
        "garden" => has(w, "orchard", 1),
        "roundabout" => has(w, "roundabout", 1),
        "first-contact" => flag(p, "monolith"),
        "material-choice" => flag(p, "monolith") && has(w, "bridge", 1),
        "first-delivery" => num(e, "deliveries") > 0.,
        "crossing" => flag(p, "bridge"),
        "first-ore" => num(&w["inventory"], "ore") > 0. || num(a, "mine") > 0.,
        "first-mine" => has(w, "mine", 1),
        "first-factory" => has(w, "factory", 1),
        "dwelling" => has(w, "dwelling", 1),
        "culture" => has(w, "theatre", 1),
        "mountain-question" => num(p, "energy") >= 100000.,
        "charge-ready" => num(p, "energy") >= 1500000.,
        "failed-charge" => flag(p, "tnt"),
        "second-contact" => flag(p, "secondContact"),
        "launch" => num(&w["orbital"], "population") > 0.,
        "last-choice" => {
            flag(p, "cannon")
                && num(&w["orbital"], "launches") >= 12.
                && num(&w["orbital"], "population") >= 12.
        }
        "connection" => num(w, "stage") >= 3.,
        "incident-hunger" => list(w, "creatures").iter().any(|c| num(c, "fed") < 28.),
        "incident-dirt" => list(w, "creatures").iter().any(|c| num(c, "clean") < 28.),
        "incident-lonely" => list(w, "creatures").iter().any(|c| num(c, "amused") < 28.),
        "incident-first-loss" => num(e, "deaths") > 0.,
        "incident-hammer-loss" => num(e, "hammer") > 0.,
        "incident-sacrifice" => num(e, "sacrificed") > 0.,
        "incident-wood-route" => flag(p, "bridge") && num(e, "bonesDelivered") == 0.,
        "incident-bone-route" => num(e, "bonesDelivered") > 0.,
        "incident-pollution" => num(p, "pollution") > 30.,
        "incident-cleanup" => num(e, "cleaned") > 0.,
        "incident-upgrade" => list(w, "objects").iter().any(|o| num(o, "level") > 1.),
        "incident-blocked" => num(&w["metrics"], "stalls") > 2.,
        "incident-bond" => list(w, "creatures").iter().any(|c| {
            list(c, "relationships")
                .iter()
                .any(|r| num(r, "affinity") >= 3.)
        }),
        "incident-renamed" => num(total, "rename") > 0.,
        "incident-promise-kept" => completed_goal(w),
        "incident-project-held" => flag(&w["directives"], "pauseWork"),
        "incident-orbital-care" => num(&w["orbital"], "launches") >= 12.,
        "incident-refusal" => !list(&w["story"], "refusals").is_empty(),
        "letter-flight-one" => flag(p, "hatched") && time >= 45.,
        "letter-warmth" => time >= 90. && comfortable(w),
        "letter-three-friends" => pop >= 3. && time >= 120.,
        "letter-flight-two" => pop >= 3. && time >= 240.,
        "letter-first-timber" => num(a, "gather") > 0.,
        "letter-beyond-clearing" => num(c, "explored") >= 3.,
        "letter-meal-routine" => {
            num(a, "eat") >= 20. && num(a, "play") >= 10. && num(a, "wash") >= 10.
        }
        "letter-flight-three" => time >= 420. && pop >= 6.,
        "letter-twenty" => pop >= 20.,
        "letter-permission" => text(c, "consent") == "accepted",
        "letter-first-independent" => num(c, "completed") >= 1.,
        "letter-flight-four" => time >= 660. && num(c, "completed") >= 1.,
        "letter-second-grove" => has(w, "orchard", 2),
        "letter-second-shower" => has(w, "bath", 2),
        "letter-second-garden" => has(w, "roundabout", 2),
        "letter-safe-crossing" => flag(p, "bridge") && num(c, "explored") >= 6.,
        "letter-path-reopened" => num(total, "unblocked") > 0.,
        "letter-fifty" => pop >= 50.,
        "letter-flight-five" => time >= 900. && num(c, "explored") >= 8.,
        "letter-shelter" => has(w, "dwelling", 1),
        "letter-ore-work" => num(a, "quarry") >= 5. || num(a, "mine") >= 5.,
        "letter-shared-song" => has(w, "theatre", 1),
        "letter-promise" => completed_goal(w),
        "letter-hundred" => pop >= 100.,
        "letter-flight-six" => time >= 1200. && num(c, "completed") >= 3.,
        "letter-outposts" => has(w, "orchard", 3) && num(c, "explored") >= 12.,
        "letter-orbit-home" => num(&w["orbital"], "population") > 0.,
        "letter-new-lullaby" => time >= 1500. && num(c, "completed") >= 5. && comfortable(w),
        _ => {
            if let Some(i) = list(content(), "philosophy")
                .iter()
                .position(|b| text(b, "id") == id)
            {
                list(&w["story"], "completed")
                    .iter()
                    .filter(|x| !x.as_str().unwrap_or("").starts_with("letter-"))
                    .count()
                    >= 2 + i * 2
            } else {
                false
            }
        }
    }
}
fn entry_text(w: &Value, e: &Value) -> String {
    let name = list(w, "creatures")
        .iter()
        .find(|c| flag(c, "favorite"))
        .or_else(|| list(w, "creatures").first())
        .map(|c| text(c, "name"))
        .unwrap_or("A little friend");
    match text(e, "id") {
        "letter-warmth" => format!(
            "{name} has food, clean fur and something to play with. No grand discovery today. Just a little life that can afford to feel safe."
        ),
        "letter-beyond-clearing" => format!(
            "{name} has a larger world to wonder about now. Our scouts have reached {} patches of new ground. The mist is beginning to look like an invitation.",
            num(&w["community"], "explored")
        ),
        "letter-promise" => format!(
            "We finished a goal you gave us. {name} has a whole colony to share that moment with. Your words stayed with us between the little steps."
        ),
        _ => text(e, "text").into(),
    }
}
fn unique_tail(v: &mut Value, max: usize) {
    let mut seen = std::collections::HashSet::new();
    let a = v.as_array_mut().unwrap();
    a.retain(|x| seen.insert(x.to_string()));
    let n = a.len().saturating_sub(max);
    a.drain(..n);
}
impl Engine {
    pub(crate) fn note_evidence(
        &mut self,
        kind: &str,
        message: &str,
        amount: f64,
        entity: Option<&str>,
    ) {
        if self.world["evidence"].get(kind).is_some() {
            let n = (num(&self.world["evidence"], kind) + amount).min(1e15);
            set_num(&mut self.world["evidence"], kind, n);
        }
        let time = num(&self.world, "time");
        let a = self.world["story"]["evidence"].as_array_mut().unwrap();
        if let Some(old) = a.iter_mut().find(|e| text(e, "kind") == kind) {
            increment(old, "count", amount);
            old["last"] = json!(clipped(message, 180));
            old["tick"] = json!(time);
            old["entity"] = json!(entity);
        } else {
            a.push(json!({"kind":kind,"count":amount,"first":clipped(message,180),"last":clipped(message,180),"tick":time,"entity":entity}));
        }
        self.world["story"]["evidence"] = json!(tail(&self.world["story"]["evidence"], 24));
    }
    fn enqueue_story(&mut self, id: &str) {
        if !contains(&self.world["story"], "seen", id)
            && !contains(&self.world["story"], "queue", id)
            && !list(&self.world["community"], "inbox")
                .iter()
                .any(|m| text(m, "key") == format!("story:{id}"))
        {
            let q = self.world["story"]["queue"].as_array_mut().unwrap();
            q.push(json!(id));
            q.truncate(24);
        }
    }
    pub(crate) fn update_story(&mut self) {
        let mut milestone = false;
        for beat in list(content(), "beats") {
            let id = text(beat, "id");
            if !contains(&self.world["story"], "completed", id) && when(&self.world, id) {
                self.world["story"]["completed"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(id));
                self.enqueue_story(id);
                milestone = true;
            }
        }
        if milestone
            && let Some(b) = list(content(), "philosophy").iter().find(|b| {
                let id = text(b, "id");
                when(&self.world, id)
                    && !contains(&self.world["story"], "seen", id)
                    && !list(&self.world["community"], "inbox")
                        .iter()
                        .any(|m| text(m, "key") == format!("story:{id}"))
            })
        {
            self.enqueue_story(text(b, "id"));
        }
        let time = num(&self.world, "time");
        if time - num(&self.world["story"], "lastLetterAt") >= 60.
            && let Some(b) = list(content(), "chapters").iter().find(|b| {
                !contains(&self.world["story"], "completed", text(b, "id"))
                    && when(&self.world, text(b, "id"))
            })
        {
            let id = text(b, "id");
            self.world["story"]["completed"]
                .as_array_mut()
                .unwrap()
                .push(json!(id));
            self.world["story"]["lastLetterAt"] = json!(time);
            self.enqueue_story(id);
        }
        if time
            - num(&self.world["story"], "lastAt").max(num(&self.world["story"], "lastIncidentAt"))
            > 90.
            && list(&self.world["story"], "queue").len() < 3
            && let Some(b) = list(content(), "incidents").iter().find(|b| {
                let id = text(b, "id");
                !contains(&self.world["story"], "seen", id)
                    && !contains(&self.world["story"], "queue", id)
                    && !list(&self.world["community"], "inbox")
                        .iter()
                        .any(|m| text(m, "key") == format!("story:{id}"))
                    && when(&self.world, id)
            })
        {
            self.enqueue_story(text(b, "id"));
            self.world["story"]["lastIncidentAt"] = json!(time);
        }
        let flags = [
            flag(&self.world["progress"], "hatched"),
            num(&self.world, "population") >= 6.,
            flag(&self.world["progress"], "bridge"),
            has(&self.world, "factory", 1),
            num(&self.world["orbital"], "population") > 0.,
            num(&self.world, "stage") >= 3.,
        ];
        for (i, yes) in flags.iter().enumerate() {
            let id = text(&content()["archives"][i], "id");
            if *yes && !contains(&self.world["story"], "archives", id) {
                self.world["story"]["archives"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(id));
            }
        }
        let kept: Vec<_> = list(&self.world["story"], "promises")
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                text(p, "status") == "pending"
                    && ((text(p, "request") == "mop"
                        && num(&self.world["evidence"], "cleaned") > num(p, "before"))
                        || has(&self.world, text(p, "request"), 1))
            })
            .map(|(i, p)| (i, text(p, "request").to_string()))
            .collect();
        for (i, request) in kept {
            self.world["story"]["promises"][i]["status"] = json!("kept");
            self.note_evidence("care", &format!("Kept a promise: {request}"), 1., None);
        }
    }
    pub(crate) fn collect_story_messages(&mut self) {
        let mut ids = Vec::new();
        if let Some(id) = self.world["story"]["active"].as_str() {
            ids.push(id.to_string());
        }
        for id in list(&self.world["story"], "queue") {
            if let Some(id) = id.as_str()
                && !ids.iter().any(|s| s == id)
            {
                ids.push(id.to_string());
            }
        }
        self.world["story"]["queue"] = json!([]);
        self.world["story"]["active"] = Value::Null;
        for id in ids {
            let Some(e) = entry(&id) else { continue };
            if contains(&self.world["story"], "seen", &id) {
                continue;
            }
            let message=self.post_message(json!({"key":format!("story:{id}"),"title":e["title"],"text":entry_text(&self.world,&e),"story":id,"category":e["category"].as_str().unwrap_or(if e.get("request").is_some(){"help"}else{"milestone"}),"responseRequired":list(&e,"responses").len()>1}));
            if message.is_some()
                && id.starts_with("thought-")
                && let Some(m) = self.world["community"]["inbox"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|m| same_id(&m["id"], &message.as_ref().unwrap()["id"]))
            {
                m["notified"] = json!(true);
            }
            if list(&e, "responses").len() == 1 {
                self.world["story"]["seen"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(id));
                unique_tail(&mut self.world["story"]["seen"], 128);
            }
        }
    }
    pub(crate) fn next_story(&mut self) -> Option<Value> {
        if let Some(id) = self.world["story"]["active"].as_str() {
            return entry(id);
        }
        if num(&self.world, "time") - num(&self.world["story"], "lastAt") < 12. {
            return None;
        }
        let q = self.world["story"]["queue"].as_array_mut().unwrap();
        if q.is_empty() {
            return None;
        }
        let id = q.remove(0);
        self.world["story"]["active"] = id.clone();
        entry(id.as_str().unwrap_or(""))
    }
    pub(crate) fn answer_story(&mut self, response: &str) {
        let Some(e) = entry(text(&self.world["story"], "active")) else {
            return;
        };
        let response = if list(&e, "responses")
            .iter()
            .any(|r| r.as_str() == Some(response))
        {
            response
        } else {
            e["responses"][0].as_str().unwrap_or("Listen")
        };
        let id = text(&e, "id");
        let time = num(&self.world, "time");
        self.world["story"]["responses"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":id,"response":response,"tick":time}));
        self.world["story"]["responses"] = json!(tail(&self.world["story"]["responses"], 32));
        if response == "We can choose together" {
            self.note_evidence(
                "autonomy",
                &format!("At “{}”, agreed to choose together.", text(&e, "title")),
                1.,
                None,
            );
        }
        if response == "What do you think?" {
            self.note_evidence(
                "discovered",
                &format!(
                    "Asked the collective about {}.",
                    id.replacen("thought-", "", 1)
                ),
                1.,
                None,
            );
        }
        self.world["story"]["seen"]
            .as_array_mut()
            .unwrap()
            .push(json!(id));
        unique_tail(&mut self.world["story"]["seen"], 128);
        self.world["story"]["lastAt"] = json!(time);
        self.world["story"]["active"] = Value::Null;
        if let Some(request) = e["request"].as_str() {
            if response == "Not now" {
                self.world["story"]["refusals"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(request));
                unique_tail(&mut self.world["story"]["refusals"], 24);
                self.note_evidence(
                    "autonomy",
                    &format!(
                        "Declined the request for {request}; the colony respected the answer."
                    ),
                    1.,
                    None,
                );
            }
            if response == "I will help" {
                let p = json!({"request":request,"status":"pending","tick":time,"before":self.world["evidence"]["cleaned"]});
                self.world["story"]["promises"]
                    .as_array_mut()
                    .unwrap()
                    .push(p);
                self.world["story"]["promises"] = json!(tail(&self.world["story"]["promises"], 16));
            }
        }
        increment(&mut self.world, "commandRevision", 1.);
        increment(&mut self.world, "revision", 1.);
    }
    pub(crate) fn assessment(&self) -> Value {
        let w = &self.world;
        let e = &w["evidence"];
        let proof = |kind: &str| {
            list(&w["story"], "evidence")
                .iter()
                .find(|x| text(x, "kind") == kind)
                .map(|x| text(x, "last"))
                .filter(|s| !s.is_empty())
        };
        json!([
 {"dimension":"Care","text":proof("care").unwrap_or("Small gifts and facilities shaped daily life."),"value":num(e,"care"),"consequence":format!("{} losses from unmet needs.",num(e,"neglect"))},
 {"dimension":"Expediency","text":proof("meteorDeaths").or_else(||proof("hammer")).or_else(||proof("sacrificed")).unwrap_or("No deliberate sacrifices were recorded."),"value":num(e,"sacrificed")+num(e,"hammer")+num(e,"meteorDeaths"),"consequence":format!("{} wood and {} bones reached the crossing. {} lives were lost to meteors.",num(e,"woodDelivered"),num(e,"bonesDelivered"),num(e,"meteorDeaths"))},
 {"dimension":"Curiosity","text":proof("discovered").unwrap_or("The first lander was the beginning of discovery."),"value":num(e,"discovered"),"consequence":format!("{} archive entries opened.",list(&w["story"],"archives").len())},
 {"dimension":"Stewardship","text":proof("cleaned").unwrap_or("The ground remembers what production left behind."),"value":num(e,"cleaned"),"consequence":format!("{} pollution remains; {} losses from exposure.",num(&w["progress"],"pollution").round(),num(e,"pollutionDeaths"))},
 {"dimension":"Autonomy","text":proof("autonomy").unwrap_or("The colony worked within the choices you made."),"value":num(e,"autonomy"),"consequence":format!("{} promises kept; {} requests declined.",list(&w["story"],"promises").iter().filter(|p|text(p,"status")=="kept").count(),list(&w["story"],"refusals").len())}])
    }
    pub(crate) fn archive_entries(&self) -> Value {
        json!(
            list(content(), "archives")
                .iter()
                .filter(|a| contains(&self.world["story"], "archives", text(a, "id")))
                .collect::<Vec<_>>()
        )
    }
}
impl Engine {
    pub(crate) fn completion_letter(&self, p: &Value, title: &str) -> Value {
        static DATA: OnceLock<Value> = OnceLock::new();
        let lines = DATA.get_or_init(|| {
            serde_json::from_str(include_str!("../data/completion-letters.json")).unwrap()
        });
        let options = lines[text(p, "type")].as_array();
        let line = options
            .map(|lines| {
                lines[((num(p, "id") as usize).saturating_sub(1)) % lines.len()]
                    .as_str()
                    .unwrap()
            })
            .unwrap_or("The work is finished. We are ready to consider our next step together.");
        let author = list(&self.world, "creatures")
            .iter()
            .find(|c| list(p, "crew").iter().any(|id| same_id(id, &c["id"])))
            .map(|c| text(c, "name"));
        json!({"key":format!("built:{}",num(p,"id")),"category":"work","title":format!("{title} · ready for the colony"),"text":format!("{}{line} ({}, {})",author.map(|a|format!("{a}, for the building crew: ")).unwrap_or_else(||"Our building crew: ".into()),num(p,"x").round(),num(p,"y").round())})
    }
}
