use crate::{Engine, value::*};
use serde_json::{Value, json};
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;
pub const DICTIONARY_SIZE: u64 = 16384;
fn names() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("../data/names.json")).unwrap())
}
pub fn dictionary_name(index: i64) -> String {
    let i = index.rem_euclid(16384) as usize;
    let n = names();
    format!(
        "{} {}{}",
        n["given"][i / 256].as_str().unwrap(),
        n["beginnings"][(i / 16) % 16].as_str().unwrap(),
        n["endings"][i % 16].as_str().unwrap()
    )
}
pub fn encounter(c: &mut Value, kind: &str, other: Option<&str>, tick: f64) {
    c["encounters"]
        .as_array_mut()
        .unwrap()
        .push(json!({"kind":kind,"other":other,"tick":tick}));
    c["encounters"] = json!(crate::memory::tail(&c["encounters"], 8));
    let Some(other) = other.filter(|s| !s.is_empty()) else {
        return;
    };
    let bonds = c["relationships"].as_array_mut().unwrap();
    let i = if let Some(i) = bonds.iter().position(|r| text(r, "id") == other) {
        i
    } else {
        bonds.push(json!({"id":other,"affinity":0,"last":tick}));
        bonds.len() - 1
    };
    let affinity =
        (num(&bonds[i], "affinity") + if kind == "loss" { -1. } else { 1. }).clamp(-10., 10.);
    bonds[i]["affinity"] = json!(affinity);
    bonds[i]["last"] = json!(tick);
    bonds.sort_by(|a, b| num(b, "last").total_cmp(&num(a, "last")));
    bonds.truncate(4);
}
impl Engine {
    pub(crate) fn identity(&mut self, parent: Option<&Value>) -> Value {
        let ordinal = num(&self.world, "nextBirth") as u64;
        increment(&mut self.world, "nextBirth", 1.);
        let seed = num(&self.world["map"], "seed") as u32;
        let index = ((ordinal as f64 * 7919. + (seed as u64 % DICTIONARY_SIZE) as f64)
            % DICTIONARY_SIZE as f64) as u64;
        let generation = ordinal / DICTIONARY_SIZE;
        let mut name = dictionary_name(index as i64);
        if generation > 0 {
            name.push_str(&format!(" {}", generation + 1));
        }
        if list(&self.world, "creatures")
            .iter()
            .any(|c| text(c, "name").to_lowercase() == name.to_lowercase())
        {
            name.push_str(&format!(" · {}", ordinal + 1));
        }
        let hash = |n: u32| {
            (((ordinal as u32).wrapping_add(1).wrapping_mul(n)) ^ seed) as f64 / 4294967296.
        };
        json!({"identityVersion":1,"birthOrdinal":ordinal,"dictionaryVersion":1,"nameIndex":index,"name":name,"customName":null,"parentId":parent.and_then(|p|p["id"].as_str()),"birthTick":self.world["time"],"traits":{"curiosity":hash(1597334677),"sociability":hash(3812015801),"diligence":hash(958282573)},"encounters":[],"relationships":[],"favorite":false})
    }
    pub(crate) fn rename_creature(&mut self, id: &str, input: &str) -> Value {
        // Control and format characters are removed before grapheme-count validation.
        let filtered:String=input.nfc().filter(|c|!c.is_control()&&!matches!(*c,'\u{00ad}'|'\u{0600}'..='\u{0605}'|'\u{061c}'|'\u{06dd}'|'\u{070f}'|'\u{0890}'..='\u{0891}'|'\u{08e2}'|'\u{180e}'|'\u{200b}'..='\u{200f}'|'\u{202a}'..='\u{202e}'|'\u{2060}'..='\u{2064}'|'\u{2066}'..='\u{206f}'|'\u{feff}'|'\u{fff9}'..='\u{fffb}'|'\u{110bd}'|'\u{110cd}'|'\u{13430}'..='\u{1343f}'|'\u{1bca0}'..='\u{1bca3}'|'\u{1d173}'..='\u{1d17a}'|'\u{e0001}'|'\u{e0020}'..='\u{e007f}')).collect();
        let name = filtered.split_whitespace().collect::<Vec<_>>().join(" ");
        if name.is_empty() {
            return json!({"error":"Give them a name first."});
        }
        if name.graphemes(true).count() > 30 {
            return json!({"error":"Choose a name with at most 30 characters."});
        }
        if list(&self.world, "creatures")
            .iter()
            .any(|c| text(c, "id") != id && text(c, "name").to_lowercase() == name.to_lowercase())
        {
            return json!({"error":"Someone here already has that name."});
        }
        let Some(c) = self.world["creatures"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|c| text(c, "id") == id)
        else {
            return json!({"error":"This resident is no longer here."});
        };
        let old = c["name"].clone();
        c["name"] = json!(name);
        c["customName"] = json!(name);
        increment(&mut self.world, "commandRevision", 1.);
        increment(&mut self.world, "revision", 1.);
        json!({"old":old,"name":name})
    }
    pub(crate) fn resolve_listener(&self, input: &str, selected: Option<&str>) -> Value {
        let t = input.to_lowercase();
        let people = list(&self.world, "creatures");
        let full: Vec<_> = people
            .iter()
            .filter(|c| t.contains(&text(c, "name").to_lowercase()))
            .collect();
        if full.len() == 1 {
            return json!({"id":full[0]["id"]});
        }
        let found = if !full.is_empty() {
            full
        } else {
            people
                .iter()
                .filter(|c| {
                    let first = text(c, "name")
                        .split(' ')
                        .next()
                        .unwrap_or("")
                        .to_lowercase();
                    t.match_indices(&first).any(|(i, _)| {
                        let word = |c: char| c.is_ascii_alphanumeric() || c == '_';
                        !t[..i].chars().last().is_some_and(word)
                            && !t[i + first.len()..].chars().next().is_some_and(word)
                    })
                })
                .collect()
        };
        if found.len() > 1 {
            if let Some(id) = selected.filter(|id| found.iter().any(|c| text(c, "id") == *id)) {
                return json!({"id":id});
            }
            return json!({"error":format!("Which one do you mean: {}? Select one of us and try again.",found.iter().take(3).map(|c|text(c,"name")).collect::<Vec<_>>().join(", "))});
        }
        json!({"id":found.first().and_then(|c|c["id"].as_str()).or_else(||selected.filter(|id|people.iter().any(|c|text(c,"id")==*id)))})
    }
}
