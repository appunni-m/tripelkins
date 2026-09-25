use crate::{Engine, value::*};
use serde_json::{Value, json};
pub const COMMAND_LIMIT: usize = 96;
pub fn clipped(value: &str, max: usize) -> String {
    let mut units = 0;
    value
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= max
        })
        .collect()
}
pub fn js_number(v: &Value) -> Option<f64> {
    match v {
        Value::Null => Some(0.),
        Value::Bool(value) => Some(if *value { 1. } else { 0. }),
        Value::Number(value) => value.as_f64(),
        Value::Array(_) => js_number(&Value::String(js_string(v))),
        Value::Object(_) => None,
        Value::String(value) => {
            let s = value.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
            if s.is_empty() {
                return Some(0.);
            }
            for (prefix, radix) in [
                ("0x", 16),
                ("0X", 16),
                ("0b", 2),
                ("0B", 2),
                ("0o", 8),
                ("0O", 8),
            ] {
                if let Some(digits) = s.strip_prefix(prefix) {
                    if digits.is_empty() {
                        return None;
                    }
                    return digits.chars().try_fold(0., |n, c| {
                        c.to_digit(radix)
                            .map(|digit| n * radix as f64 + digit as f64)
                    });
                }
            }
            s.parse::<f64>().ok().filter(|_| {
                !s.eq_ignore_ascii_case("inf")
                    && !s.eq_ignore_ascii_case("+inf")
                    && !s.eq_ignore_ascii_case("-inf")
            })
        }
    }
}
pub fn bounded(v: &Value, lo: f64, hi: f64) -> f64 {
    let n = js_number(v).filter(|n| n.is_finite()).unwrap_or(lo);
    // Match Math.max/Math.min even for callers supplying an inverted interval.
    n.min(hi).max(lo)
}
fn nullable_text(value: &Value, max: usize) -> String {
    clipped(
        &if value.is_null() {
            String::new()
        } else {
            js_string(value)
        },
        max,
    )
}
pub fn tail(v: &Value, max: usize) -> Vec<Value> {
    let a = v.as_array().cloned().unwrap_or_default();
    a[a.len().saturating_sub(max)..].to_vec()
}
pub(crate) fn validate_memory(raw: &Value) -> Result<(), String> {
    if raw.is_null() {
        return Err("Cannot read properties of null (reading 'commands')".into());
    }
    if tail(&raw["summary"]["milestones"], 24)
        .iter()
        .any(Value::is_null)
    {
        return Err("Cannot read properties of null (reading 'tick')".into());
    }
    Ok(())
}
pub fn normalize_memory(raw: &Value) -> Value {
    let commands = tail(&raw["commands"], COMMAND_LIMIT)
        .into_iter()
        .filter(|c| c["id"].is_string() && c["text"].is_string())
        .map(|mut c| {
            for (k, n) in [
                ("id", 60),
                ("text", 500),
                ("reply", 500),
                ("at", 32),
                ("source", 80),
            ] {
                c[k] = json!(nullable_text(&c[k], n));
            }
            if !["pending", "completed", "failed", "cancelled", "interrupted"]
                .contains(&text(&c, "status"))
            {
                c["status"] = json!("interrupted");
            }
            c["channel"] = json!(if text(&c, "channel") == "voice" {
                "voice"
            } else {
                "typed"
            });
            c["tick"] = json!(bounded(&c["tick"], 0., 1e12));
            for k in ["goalId", "listener"] {
                c[k] = if !truthy(&c[k]) {
                    Value::Null
                } else {
                    json!(nullable_text(&c[k], 40))
                };
            }
            c.as_object_mut().unwrap().retain(|key, _| {
                [
                    "id", "text", "reply", "status", "channel", "tick", "at", "source", "goalId",
                    "listener",
                ]
                .contains(&key.as_str())
            });
            c
        })
        .collect::<Vec<_>>();
    let s = &raw["summary"];
    let milestones=tail(&s["milestones"],24).iter().map(|m|json!({"tick":bounded(&m["tick"],0.,1e12),"kind":nullable_text(&m["kind"],40),"message":nullable_text(&m["message"],220)})).collect::<Vec<_>>();
    json!({"commands":commands,"summary":{"eventsCompacted":bounded(&s["eventsCompacted"],0.,1e15),"commandsCompacted":bounded(&s["commandsCompacted"],0.,1e15),"throughTick":bounded(&s["throughTick"],0.,1e12),"milestones":milestones}})
}
pub fn compact_events(memory: &mut Value, events: &[Value]) {
    for e in events {
        let s = &mut memory["summary"];
        let count = (num(s, "eventsCompacted") + 1.).min(1e15);
        set_num(s, "eventsCompacted", count);
        let through = num(s, "throughTick").max(num(e, "tick"));
        set_num(s, "throughTick", through);
        if [
            "goal",
            "goal-complete",
            "goal-change",
            "choice",
            "sacrifice",
            "build",
            "upgrade",
            "hatch",
            "bridge",
            "monolith",
            "ending",
            "migration",
            "recovery",
        ]
        .contains(&text(e, "kind"))
        {
            s["milestones"]
                .as_array_mut()
                .unwrap()
                .push(json!({"tick":e["tick"],"kind":e["kind"],"message":e["message"]}));
        }
    }
    memory["summary"]["milestones"] = json!(tail(&memory["summary"]["milestones"], 24));
}
impl Engine {
    pub(crate) fn remember(&mut self, kind: &str, message: &str, entity: Option<&str>) {
        let id = num(&self.world, "nextEvent");
        increment(&mut self.world, "nextEvent", 1.);
        let e = json!({"id":id,"tick":num(&self.world,"time").floor(),"at":self.now_iso,"kind":clipped(kind,40),"message":clipped(message,220),"entity":entity});
        let m = &mut self.world["memory"];
        m["recent"].as_array_mut().unwrap().push(e);
        let n = (num(&m["totals"], kind) + 1.).min(1e15);
        set_num(&mut m["totals"], kind, n);
        let excess = list(m, "recent").len().saturating_sub(160);
        if excess > 0 {
            let removed: Vec<_> = m["recent"]
                .as_array_mut()
                .unwrap()
                .drain(..excess)
                .collect();
            compact_events(m, &removed);
        }
        let keys: Vec<_> = m["totals"].as_object().unwrap().keys().cloned().collect();
        for k in &keys[..keys.len().saturating_sub(64)] {
            m["totals"].as_object_mut().unwrap().remove(k);
        }
        increment(&mut self.world, "revision", 1.);
    }
    pub(crate) fn begin_command(
        &mut self,
        value: &str,
        channel: &str,
        listener: Option<&str>,
        id: &str,
    ) -> Value {
        let command = json!({"id":id,"text":clipped(value,500),"reply":"","status":"pending","channel":channel,"tick":self.world["time"],"at":self.now_iso,"source":"","goalId":null,"listener":listener.map(|s|clipped(s,40))});
        let m = &mut self.world["memory"];
        m["commands"].as_array_mut().unwrap().push(command.clone());
        let excess = list(m, "commands").len().saturating_sub(COMMAND_LIMIT);
        if excess > 0 {
            m["commands"].as_array_mut().unwrap().drain(..excess);
            increment(&mut m["summary"], "commandsCompacted", excess as f64);
        }
        increment(&mut self.world, "revision", 1.);
        command
    }
    pub(crate) fn interrupt_commands(&mut self) {
        for c in self.world["memory"]["commands"].as_array_mut().unwrap() {
            if text(c, "status") == "pending" {
                c["status"] = json!("interrupted");
            }
        }
    }
}
pub fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.as_f64().unwrap_or(0.).to_string(),
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(|v| {
                if v.is_null() {
                    String::new()
                } else {
                    js_string(v)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}
