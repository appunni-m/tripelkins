//! Read-only building information for the selected inspector, not a new planner.
use crate::{
    Engine,
    simulation::{format_count, upgrade_threshold},
    value::*,
};
use serde_json::{Value, json};

impl Engine {
    pub(crate) fn selected_building(&mut self) -> Value {
        let id = text(&self.world["ui"], "selected").to_owned();
        let Some(o) = list(&self.world, "objects")
            .iter()
            .find(|o| text(o, "id") == id)
            .cloned()
            .or_else(|| self.natural_object(&id))
        else {
            return Value::Null;
        };
        let kind = text(&o, "type");
        if !["mine", "factory", "dwelling", "theatre", "node"].contains(&kind) {
            return Value::Null;
        }
        let level = num(&o, "level").max(1.);
        let assigned: Vec<_> = list(&self.world, "creatures")
            .iter()
            .filter(|c| {
                same_id(&c["target"], &o["id"])
                    && c["job"].is_object()
                    && !["completed", "blocked", "cancelled"].contains(&text(&c["job"], "state"))
            })
            .cloned()
            .collect();
        let working = assigned
            .iter()
            .filter(|c| text(&c["job"], "state") == "working")
            .count();
        let queued = assigned
            .iter()
            .filter(|c| text(&c["job"], "state") == "queued")
            .count();
        let mut rows = Vec::new();
        if ["mine", "node"].contains(&kind) {
            rows.push(json!(["Ore remaining", format_count(num(&o, "stock"))]));
        }
        if kind == "mine" {
            rows.push(json!([
                "Per mining trip, up to",
                format!(
                    "{} ore",
                    format_count(3. * level * num(&o, "quality").max(1.))
                )
            ]));
        }
        if kind == "factory" {
            rows.push(json!(["Ore delivered", format_count(num(&o, "inputOre"))]));
            rows.push(json!([
                "Colony ore in store",
                format_count(num(&self.world["inventory"], "ore"))
            ]));
            rows.push(json!(["Conversion", "1 ore → 8 blocks"]));
            let pollution: f64 = list(&self.world, "pollution")
                .iter()
                .filter(|z| same_id(&z["source"], &o["id"]))
                .map(|z| num(z, "amount"))
                .sum();
            rows.push(json!(["Local pollution", format_count(pollution)]));
        }
        if kind != "node" {
            rows.push(json!([
                if ["dwelling", "theatre"].contains(&kind) {
                    "Visitors"
                } else {
                    "Crew assigned"
                },
                assigned.len().to_string()
            ]));
            rows.push(json!([
                "Here / approaching",
                format!("{} / {}", working, assigned.len() - working - queued)
            ]));
            if queued > 0 {
                rows.push(json!(["Waiting for space", queued.to_string()]));
            }
        }
        let access = list(&self.world["community"], "access")
            .iter()
            .find(|r| {
                same_id(&r["target"], &o["id"])
                    && !["done", "complete", "resolved"].contains(&text(r, "status"))
            })
            .map(|r| text(r, "reason").to_owned())
            .unwrap_or_default();
        let entrances_blocked = kind != "node" && self.service_slots(&o, None).is_empty();
        let status = if kind == "node" {
            "Build a mine on this deposit."
        } else if kind == "mine" && num(&o, "stock") <= 0. {
            "This deposit is exhausted. Explore for another stone deposit."
        } else if entrances_blocked {
            "Entrances are blocked. Leave clear ground around this building."
        } else if !access.is_empty() {
            &access
        } else if ["mine", "factory"].contains(&kind)
            && list(&self.world["directives"], "members").is_empty()
            && flag(&self.world["directives"], "pauseWork")
        {
            "Work is held by your request."
        } else if kind == "factory"
            && list(&self.world["directives"], "members").is_empty()
            && flag(&self.world["directives"], "avoidPollution")
        {
            "Production is held to avoid pollution."
        } else if kind == "factory" && num(&o, "inputOre") <= 0. {
            "Waiting for an ore delivery."
        } else if working > 0 {
            "In use."
        } else if queued > 0 {
            "Waiting for a clear working spot."
        } else if !assigned.is_empty() {
            "The crew is on its way."
        } else {
            "No one assigned yet. Activity shows the colony’s current priorities."
        };
        let threshold = upgrade_threshold(kind);
        let upgrade = if threshold == 0. {
            Value::Null
        } else {
            let cost = (threshold / 2.).floor();
            let unlocked = num(&self.world["progress"], "peakBlocks") >= threshold;
            let affordable = num(&self.world["inventory"], "blocks") >= cost;
            json!({"complete":level>=2., "cost":cost, "threshold":threshold,
                "available":level<2. && unlocked && affordable,
                "reason":if level>=2. {"Fully upgraded.".into()} else if !unlocked {
                    format!("Discover {} blocks to unlock level II.", format_count(threshold))
                } else if !affordable {format!("Need {} blocks in store.", format_count(cost))}
                else {format!("Upgrade to level II for {} blocks.", format_count(cost))}})
        };
        json!({"id":o["id"],"rows":rows,"status":status,"upgrade":upgrade})
    }
}
