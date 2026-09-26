//! Snapshot scheduling for the live browser. Only the simulation worker commits.
use crate::{Engine, value::*};
use serde_json::{Value, json};

impl Engine {
    /// Runs on a disposable copy. Applying to that copy lets the development
    /// summary account for the proposed crews without blocking physical motion.
    pub(crate) fn background_schedule(&mut self) -> Value {
        let policy = self.goal_policy();
        let plan = self.make_plan(&policy);
        self.apply_plan(&plan);
        let development = self.development_plan();
        json!({"plan":plan,"development":development,"time":self.world["time"],
            "commandRevision":self.world["commandRevision"],"navRevision":self.world["navRevision"],
            "mapRevision":self.world["map"]["revision"],"stage":self.world["stage"]})
    }

    /// Revalidate stock, targets, slots and instruction scope against live state.
    /// A changed map/command or a slow response triggers a fresh snapshot instead.
    pub(crate) fn commit_schedule(&mut self, schedule: &Value) -> bool {
        let age = num(&self.world, "time") - num(schedule, "time");
        if !schedule.is_object()
            || flag(&self.world["ui"], "paused")
            || !(0. ..=3.).contains(&age)
            || schedule["commandRevision"] != self.world["commandRevision"]
            || schedule["navRevision"] != self.world["navRevision"]
            || schedule["mapRevision"] != self.world["map"]["revision"]
            || schedule["stage"] != self.world["stage"]
            || num(&self.world, "stage") >= 3.
            || !schedule["development"].is_object()
        {
            return false;
        }
        let mut plan = schedule["plan"].clone();
        if let Some(assignments) = plan["assignments"].as_array_mut() {
            for a in assignments {
                // A retained job may finish while the snapshot is being planned.
                // Preserve its live outcome/cargo rather than resurrecting it or
                // rejecting every crew's plan because one resident finished work.
                if flag(a, "keep")
                    && let Some(c) = list(&self.world, "creatures")
                        .iter()
                        .find(|c| same_id(&c["id"], &a["id"]))
                    && (c["task"] != a["task"]
                        || !same_id(&c["target"], &a["target"])
                        || ["completed", "blocked", "cancelled"]
                            .contains(&text(&c["job"], "state")))
                {
                    *a = json!({"id":c["id"],"task":"idle","target":null,"slot":0,
                        "point":{"x":c["x"],"y":c["y"]},"keep":true,
                        "purpose":"Keep the outcome of the finished job"});
                }
            }
        }
        if !self.apply_plan(&plan) {
            return false;
        }
        let development = &schedule["development"];
        if js_json(&self.world["community"]["plan"]) != js_json(development) {
            self.world["community"]["plan"] = development.clone();
            increment(&mut self.world, "revision", 1.);
        }
        true
    }
}
