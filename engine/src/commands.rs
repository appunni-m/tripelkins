use crate::{Engine, goals::goal_options, value::*};
use regex::Regex;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
pub const COMMAND_QUESTION: &str = "Which lasting goal is explicitly requested? Choose none for questions, negations or unsupported tasks.";
fn regex(pattern: &str) -> Regex {
    static CACHE: LazyLock<Mutex<HashMap<String, Regex>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    let mut cache = CACHE.lock().expect("command regular expression cache");
    // JS word boundaries are ASCII, even when the surrounding command has names
    // in another script. Keep its whitespace matching and ordered alternatives.
    cache
        .entry(pattern.to_owned())
        .or_insert_with(|| {
            Regex::new(&format!("(?i){}", pattern.replace(r"\b", r"(?-u:\b)")))
                .expect("constant command expression")
        })
        .clone()
}
fn matches(pattern: &str, text: &str) -> bool {
    regex(pattern).is_match(text)
}
pub fn command_options(text: &str) -> Value {
    let patterns = [
        (
            "care",
            r"\b(?:care|healthy|fed|feed|food|wash|clean|happy|play|safe)\b",
        ),
        (
            "grow",
            r"\b(?:grow|growth|multiply|reproduce|population)\b|\b(?:reach|to|of)\s+(?:\d[\d,.]*|[a-z-]+)\s+(?:tripelkins|creatures)\b",
        ),
        ("bridge", r"\bbridge\b"),
        ("wood", r"\b(?:wood|logs?|timber|trees?|chop|cutting)\b"),
        ("ore", r"\b(?:ore|rocks?|stones?|quarry)\b"),
        ("blocks", r"\b(?:blocks?|cut stone)\b"),
    ];
    let mentioned: Vec<_> = patterns
        .iter()
        .filter(|(_, p)| matches(p, text))
        .map(|(k, _)| *k)
        .collect();
    let all = goal_options();
    if mentioned.is_empty() {
        all
    } else {
        Value::Object(
            all.as_object()
                .unwrap()
                .iter()
                .filter(|(k, _)| k.as_str() == "none" || mentioned.contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        )
    }
}
pub fn command_input(text: &str) -> Value {
    json!({"question":COMMAND_QUESTION,"requiredContext":format!("Player command: {text}."),"contextParts":[],"maxTokens":320,"options":command_options(text)})
}
pub fn information_question(text: &str) -> bool {
    matches(
        r"(?:^|[,;.!?]\s*)\s*(?:how\s+(?:many|much|are|is|do|does|did|can)|what\s+(?:is|are|do|does|did|happened)|where\s+(?:is|are|do)|why\b|who\s+(?:is|are))\b",
        text,
    )
}
pub fn number_from_command(text: &str, kind: &str) -> f64 {
    let numbers = [
        ("zero", 0),
        ("one", 1),
        ("two", 2),
        ("three", 3),
        ("four", 4),
        ("five", 5),
        ("six", 6),
        ("seven", 7),
        ("eight", 8),
        ("nine", 9),
        ("ten", 10),
        ("eleven", 11),
        ("twelve", 12),
        ("thirteen", 13),
        ("fourteen", 14),
        ("fifteen", 15),
        ("sixteen", 16),
        ("seventeen", 17),
        ("eighteen", 18),
        ("nineteen", 19),
        ("twenty", 20),
        ("thirty", 30),
        ("forty", 40),
        ("fifty", 50),
        ("sixty", 60),
        ("seventy", 70),
        ("eighty", 80),
        ("ninety", 90),
    ];
    let word = format!(
        "(?:{}|hundred|thousand|million)",
        numbers
            .iter()
            .map(|(w, _)| *w)
            .collect::<Vec<_>>()
            .join("|")
    );
    let pattern = regex(&format!(r"\b{word}(?:[\s-]+(?:and\s+)?{word})*\b"));
    let replaced = pattern.replace_all(text, |captures: &regex::Captures<'_>| {
        let mut total = 0_u64;
        let mut part = 0_u64;
        for token in captures[0]
            .to_lowercase()
            .split(|c: char| c.is_whitespace() || c == '-')
        {
            if let Some((_, n)) = numbers.iter().find(|(w, _)| *w == token) {
                part = part.saturating_add(*n);
            } else if token == "hundred" {
                part = part.max(1).saturating_mul(100);
            } else if token == "thousand" || token == "million" {
                total = total.saturating_add(part.max(1).saturating_mul(if token == "thousand" {
                    1000
                } else {
                    1000000
                }));
                part = 0;
            }
        }
        total.saturating_add(part).min(1000000).to_string()
    });
    let units = match kind {
        "care" => "percent|%|needs|health",
        "grow" => "tripelkins?|creatures?|members?|population",
        "wood" => "wood|logs?",
        "ore" => "ore",
        "blocks" => "blocks?|cut stone",
        _ => return 0.,
    };
    let before = regex(&format!(
        r"\b(\d[\d,]{{0,8}})\s*(?:healthy\s+|happy\s+)?(?:{units})"
    ));
    let after = regex(&format!(
        r"(?:{units})\s+(?:to\s+|above\s+|at\s+)?(\d[\d,]{{0,8}})\b"
    ));
    let growth = regex(r"\bgrow(?:\s+the\s+colony)?\s+(?:to\s+)?(\d[\d,]{0,8})\b");
    before
        .captures(&replaced)
        .or_else(|| after.captures(&replaced))
        .or_else(|| {
            if kind == "grow" {
                growth.captures(&replaced)
            } else {
                None
            }
        })
        .and_then(|c| c[1].replace(',', "").parse::<f64>().ok())
        .unwrap_or(0.)
}
impl Engine {
    pub(crate) fn parse_constraints(&self, message: &str, selected: Option<&str>) -> Value {
        let listener = self.resolve_listener(message, selected);
        if let Some(error) = listener.get("error") {
            return json!({"error":error});
        }
        let mut result = json!({"listener":listener["id"],"changes":{},"negated":false});
        if information_question(message) {
            result["question"] = json!(true);
            return result;
        }
        let stop = matches(
            r"\b(?:do not|don't|dont|stop|pause|hold off|not yet)\b[\s\S]{0,45}\b(?:build|building|work|working|haul|hauling|chop|chopping|cut|cutting|gather|gathering|quarry|quarrying|mine|mining|refine|refining|project|bridge)\b|\b(?:build|work|project)\b.{0,12}\bnot yet\b",
            message,
        );
        let resume = matches(
            r"\b(?:resume|continue|start again)\b.{0,30}\b(?:build|work|haul|chop|cutting|gather|quarry|mine|refine|project|bridge)",
            message,
        );
        if stop {
            result["changes"]["pauseWork"] = json!(true);
            result["negated"] = json!(true);
            result["reply"] =
                json!("We will hold that work. Eating, washing and play will continue.");
        }
        if resume {
            result["changes"]["pauseWork"] = json!(false);
            result["reply"] =
                json!("We can return to the project while looking after one another.");
        }
        if matches(
            r"\b(?:avoid|reduce|no|without|stop)\b.{0,18}\bpollution\b",
            message,
        ) {
            result["changes"]["avoidPollution"] = json!(true);
            result["reply"] = json!(
                "We will hold factory work and keep caring for one another. You can clean the ground with the mop."
            );
        }
        if matches(
            r"\b(?:allow|resume)\b.{0,12}\b(?:factory|pollution)",
            message,
        ) {
            result["changes"]["avoidPollution"] = json!(false);
        }
        if matches(r"\bkeep\b.{0,40}\b(?:fed|healthy|safe|clean)\b", message) {
            result["changes"]["careFloor"] = json!(55);
        }
        if listener["id"].is_string()
            && matches(
                r"\b(?:help|build|haul|mine|work|chop|cut|gather|quarry|refine|stop|pause|resume)\b",
                message,
            )
        {
            result["changes"]["members"] = json!([listener["id"]]);
        }
        if matches(r"\b(?:everyone|all of you|whole colony)\b", message) {
            result["changes"]["members"] = json!([]);
        }
        if matches(r"\b(?:east|west)\b.{0,12}\b(?:bank|side|region)\b", message) {
            result["changes"]["region"] =
                json!({"x":if matches(r"\beast\b",message){50}else{24},"y":25});
        }
        if !flag(&result, "negated") {
            result["negated"] = json!(
                matches(r"\b(?:do not|don't|dont|never|not)\b", message)
                    && num(&result["changes"], "careFloor") == 0.
            );
        }
        result
    }
    pub(crate) fn commit_constraints(&mut self, result: &Value) {
        let Some(changes) = result["changes"].as_object() else {
            return;
        };
        if changes.is_empty() {
            return;
        }
        for (k, v) in changes {
            self.world["directives"][k] = v.clone();
        }
        increment(&mut self.world, "commandRevision", 1.);
        increment(&mut self.world, "revision", 1.);
        if flag(&result["changes"], "pauseWork") || flag(&result["changes"], "avoidPollution") {
            let members = list(&self.world["directives"], "members").to_vec();
            for c in self.world["creatures"].as_array_mut().unwrap() {
                if !members.is_empty() && !members.contains(&c["id"]) {
                    continue;
                }
                if flag(&result["changes"], "pauseWork")
                    && [
                        "haul",
                        "mine",
                        "work",
                        "orbit",
                        "gather",
                        "quarry",
                        "refine",
                        "construct",
                    ]
                    .contains(&text(c, "task"))
                    || flag(&result["changes"], "avoidPollution") && text(c, "task") == "work"
                {
                    if c["job"].is_object() {
                        c["job"]["state"] = json!("cancelled");
                    }
                    c["task"] = json!("idle");
                    c["target"] = Value::Null;
                    c["work"] = json!(0);
                }
            }
        }
        self.note_evidence(
            "autonomy",
            result["reply"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("Agreed on boundaries for the current work."),
            1.,
            None,
        );
    }
}
