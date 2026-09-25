//! Exact bounded state transitions; history restoration never reruns simulation.
use crate::value::*;
use serde_json::{Value, json};
const MAX_FRAMES: usize = 120;
const MAX_BRANCHES: usize = 4;
const MAX_BYTES: usize = 8 * 1024 * 1024;
fn safe(k: &str) -> bool {
    !["__proto__", "prototype", "constructor"].contains(&k)
}
fn same_state(a: &Value, b: &Value) -> bool {
    let mut a = a.clone();
    let mut b = b.clone();
    a["savedAt"] = Value::Null;
    b["savedAt"] = Value::Null;
    a == b
}
fn diff(before: &Value, after: &Value, path: &[String], changes: &mut Vec<Value>) {
    if before == after {
        return;
    }
    if let (Some(a), Some(b)) = (before.as_object(), after.as_object()) {
        let mut keys: Vec<_> = a.keys().cloned().collect();
        for k in b.keys() {
            if !a.contains_key(k) {
                keys.push(k.clone());
            }
        }
        for k in keys {
            if !safe(&k) {
                continue;
            }
            let mut p = path.to_vec();
            p.push(k.clone());
            if !b.contains_key(&k) {
                changes.push(json!({"path":p,"remove":true}));
            } else if !a.contains_key(&k) {
                changes.push(json!({"path":p,"value":b[&k]}));
            } else {
                diff(&a[&k], &b[&k], &p, changes);
            }
        }
    } else {
        changes.push(json!({"path":path,"value":after}));
    }
}
pub fn apply(world: &mut Value, patch: &Value) -> Result<(), String> {
    for change in patch.as_array().ok_or("Invalid history change.")? {
        let path = change["path"].as_array().ok_or("Invalid history change.")?;
        if path.is_empty() || path.iter().any(|k| !k.as_str().is_some_and(safe)) {
            return Err("Invalid history change.".into());
        }
        let mut target = &mut *world;
        for key in &path[..path.len() - 1] {
            target = target
                .get_mut(key.as_str().unwrap())
                .filter(|v| v.is_object() || v.is_array())
                .ok_or("Incomplete history.")?;
        }
        let key = path.last().unwrap().as_str().unwrap();
        if flag(change, "remove") {
            if let Some(map) = target.as_object_mut() {
                map.remove(key);
            } else {
                return Err("Invalid history change.".into());
            }
        } else {
            target[key] = change["value"].clone();
        }
    }
    Ok(())
}
pub fn read_moment(branch: &Value, id: &str) -> Result<Value, String> {
    let mut w = branch["base"]["world"].clone();
    if text(&branch["base"], "id") == id {
        return Ok(w);
    }
    for frame in list(branch, "frames") {
        apply(&mut w, &frame["patch"])?;
        if text(frame, "id") == id {
            return Ok(w);
        }
    }
    Err("That moment is no longer in the retained history.".into())
}
pub fn latest_world(branch: &Value) -> Result<Value, String> {
    read_moment(
        branch,
        list(branch, "frames")
            .last()
            .map(|f| text(f, "id"))
            .unwrap_or(text(&branch["base"], "id")),
    )
}
fn advance_base(branch: &mut Value) -> Result<(), String> {
    let f = branch["frames"]
        .as_array_mut()
        .ok_or("Incomplete history.")?
        .remove(0);
    let mut w = branch["base"]["world"].take();
    apply(&mut w, &f["patch"])?;
    branch["base"] = json!({"id":f["id"],"at":f["at"],"world":w});
    increment(branch, "compacted", 1.);
    Ok(())
}
fn append_frame(
    branch: &mut Value,
    w: &Value,
    previous: Option<&Value>,
    next: &mut impl FnMut() -> Result<String, String>,
) -> Result<(), String> {
    let before = if let Some(previous) = previous {
        previous.clone()
    } else {
        latest_world(branch)?
    };
    if same_state(&before, w) {
        return Ok(());
    }
    let mut patch = Vec::new();
    diff(&before, w, &[], &mut patch);
    branch["frames"].as_array_mut().ok_or("Incomplete history.")?.push(json!({"id":next()?,"at":w["savedAt"],"tick":w["time"],"population":w["population"],"patch":patch}));
    Ok(())
}
pub fn append_timeline(
    input: &Value,
    previous: &Value,
    record: &Value,
    replacement: &Value,
    ids: &[String],
) -> Result<Value, String> {
    let mut history = if input.is_null() {
        json!({"schema":1,"version":0,"branches":[]})
    } else {
        input.clone()
    };
    if num(&history, "schema") != 1. {
        return Err("This history needs a newer game version.".into());
    }
    let mut cursor = 0;
    let mut next = || {
        let value = ids
            .get(cursor)
            .cloned()
            .ok_or("History identifiers were not supplied.");
        cursor += 1;
        value.map_err(str::to_string)
    };
    let previous = (!previous.is_null()).then_some(previous);
    let replace = !replacement.is_null() && replacement != &json!(false);
    let branches = history["branches"]
        .as_array_mut()
        .ok_or("Incomplete history.")?;
    if branches.is_empty() || replace {
        if let (Some(branch), Some(previous)) = (branches.last_mut(), previous)
            && replace
        {
            append_frame(branch, previous, None, &mut next)?;
        }
        let branch = json!({"id":next()?,"startedAt":record["savedAt"],"compacted":0,"previousPath":branches.last().map(|b|b["id"].clone()),"restoredFrom":replacement.get("origin"),"base":{"id":next()?,"at":record["savedAt"],"world":record},"frames":[]});
        branches.push(branch);
    } else if previous.is_none_or(|p| !same_state(p, record)) {
        append_frame(branches.last_mut().unwrap(), record, previous, &mut next)?;
    }
    increment(&mut history, "version", 1.);
    let branches = history["branches"].as_array_mut().unwrap();
    for branch in branches.iter_mut() {
        while list(branch, "frames").len() > MAX_FRAMES {
            advance_base(branch)?;
        }
    }
    let excess = branches.len().saturating_sub(MAX_BRANCHES);
    branches.drain(..excess);
    while history_size(&history) > MAX_BYTES {
        let branches = history["branches"].as_array_mut().unwrap();
        if !list(&branches[0], "frames").is_empty() {
            advance_base(&mut branches[0])?;
        } else if branches.len() > 1 {
            branches.remove(0);
        } else {
            return Err("This world is too large for its history budget. Download a copy.".into());
        }
    }
    Ok(history)
}
pub fn history_size(history: &Value) -> usize {
    if history.is_null() {
        0
    } else {
        json_byte_size(history)
    }
}

// JSON.stringify uses ECMAScript number spelling (1, not 1.0). Keeping the
// same byte accounting preserves the existing browser history budget.
fn json_byte_size(v: &Value) -> usize {
    match v {
        Value::Null => 4,
        Value::Bool(value) => {
            if *value {
                4
            } else {
                5
            }
        }
        Value::Number(value) => ryu_js::Buffer::new()
            .format_finite(value.as_f64().unwrap())
            .len(),
        Value::String(value) => serde_json::to_string(value).unwrap().len(),
        Value::Array(items) => {
            2 + items.len().saturating_sub(1) + items.iter().map(json_byte_size).sum::<usize>()
        }
        Value::Object(items) => {
            2 + items.len().saturating_sub(1)
                + items
                    .iter()
                    .map(|(key, value)| {
                        serde_json::to_string(key).unwrap().len() + 1 + json_byte_size(value)
                    })
                    .sum::<usize>()
        }
    }
}
