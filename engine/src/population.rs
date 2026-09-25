use crate::{Engine, value::*};
use serde_json::{Value, json};
pub const MAX_POPULATION: f64 = 1e15;
impl Engine {
    pub(crate) fn sync_population(&mut self) {
        let count = list(&self.world, "creatures").len() as f64;
        let room = MAX_POPULATION - count;
        self.world["cohort"] = json!(num(&self.world, "cohort").floor().min(room).max(0.));
        self.world["orbital"]["population"] = json!(
            num(&self.world["orbital"], "population")
                .floor()
                .min(room - num(&self.world, "cohort"))
                .max(0.)
        );
        self.world["population"] =
            json!(count + num(&self.world, "cohort") + num(&self.world["orbital"], "population"));
    }
    pub(crate) fn launch(&mut self, c: &mut Value) -> bool {
        if list(&self.world, "creatures").len() <= 8 {
            return false;
        }
        if num(c, "carry") > 0. {
            let kind = if text(c, "cargoKind").is_empty() {
                "wood"
            } else {
                text(c, "cargoKind")
            }
            .to_string();
            increment(&mut self.world["inventory"], &kind, num(c, "carry"));
            c["carry"] = json!(0);
        }
        self.density_index.borrow_mut().remember_position(c);
        self.world["creatures"]
            .as_array_mut()
            .unwrap()
            .retain(|o| !same_id(&o["id"], &c["id"]));
        increment(&mut self.world["orbital"], "population", 1.);
        increment(&mut self.world["orbital"], "launches", 1.);
        let time = num(&self.world, "time");
        self.world["orbital"]["lastLaunch"] = json!(time);
        if let Some(o) = self.world["objects"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|o| text(o, "type") == "cannon")
        {
            o["phase"] = json!(time);
        }
        let departed = self.world["departed"].as_array_mut().unwrap();
        departed.push(json!({"id":c["id"],"name":c["name"],"cause":"orbit","tick":time}));
        if departed.len() > 32 {
            departed.drain(..departed.len() - 32);
        }
        self.note_evidence(
            "launches",
            &format!("{} left for orbit.", text(c, "name")),
            1.,
            Some(text(c, "id")),
        );
        self.remember(
            "launch",
            &format!("{} is part of the orbital collective.", text(c, "name")),
            Some(text(c, "id")),
        );
        self.sync_population();
        true
    }
    pub(crate) fn step_cohorts(&mut self, dt: f64) {
        self.world["orbital"]["fraction"] = json!(0);
        if num(&self.world["orbital"], "population") > 0. && num(&self.world, "stage") == 2. {
            let energy = num(&self.world["orbital"], "population") * 0.025 * dt;
            self.world["progress"]["energy"] =
                json!((num(&self.world["progress"], "energy") + energy).min(MAX_POPULATION));
            self.world["orbital"]["energy"] =
                json!((num(&self.world["orbital"], "energy") + energy).min(MAX_POPULATION));
        }
        let homes = self.housing_capacity();
        self.world["district"]["capacity"] = json!(homes);
        self.world["district"]["population"] = self.world["cohort"].clone();
        let cohort = num(&self.world, "cohort");
        if cohort > 0. {
            let supported = cohort.min(homes);
            let unsupported = (cohort - supported).max(0.);
            self.world["district"]["health"] = json!(
                (num(&self.world["district"], "health")
                    + dt * if unsupported > 0. { -0.15 } else { 0.2 })
                .clamp(0., 100.)
            );
            let growth = supported * 0.003 * dt + num(&self.world["district"], "fraction");
            let births = growth.floor().min((homes - cohort).max(0.)).min(
                (MAX_POPULATION
                    - list(&self.world, "creatures").len() as f64
                    - cohort
                    - num(&self.world["orbital"], "population"))
                .max(0.),
            );
            self.world["district"]["fraction"] = json!(growth - growth.floor());
            increment(&mut self.world, "cohort", births);
            if unsupported > 0. && num(&self.world["district"], "health") == 0. {
                let amount =
                    unsupported * 0.005 * dt + num(&self.world["district"], "lossFraction");
                let lost = unsupported.min(amount.floor());
                self.world["district"]["lossFraction"] = json!(amount % 1.);
                increment(&mut self.world, "cohort", -lost);
                if lost > 0. {
                    self.note_evidence(
                        "neglect",
                        &format!(
                            "{} unrepresented residents were lost without housing.",
                            lost
                        ),
                        lost,
                        None,
                    );
                    self.note_evidence(
                        "deaths",
                        &format!("{} district residents died from unmet needs.", lost),
                        lost,
                        None,
                    );
                }
            }
        }
        self.sync_population();
        self.refresh_district();
    }
    fn housing_capacity(&self) -> f64 {
        list(&self.world, "objects")
            .iter()
            .filter(|o| text(o, "type") == "dwelling")
            .map(|o| num(o, "level") * 48.)
            .sum()
    }
    pub(crate) fn refresh_district(&mut self) {
        let homes = self.housing_capacity();
        let cohort = num(&self.world, "cohort");
        let supported = cohort.min(homes);
        let unsupported = (cohort - supported).max(0.);
        let healthy = num(&self.world["district"], "health") > 0.;
        self.world["district"]["capacity"] = json!(homes);
        self.world["district"]["population"] = json!(cohort);
        self.world["district"]["healthCounts"] = json!({"healthy":supported,"unwell":if healthy{unsupported}else{0.},"critical":if healthy{0.}else{unsupported}});
        self.world["district"]["allocations"] =
            json!({"care":(supported/8.).ceil(),"rest":(cohort-(supported/8.).ceil()).max(0.)});
        self.world["district"]["rates"] = json!({"births":if cohort<homes{supported*0.003}else{0.},"deaths":if healthy{0.}else{unsupported*0.005},"energy":0});
    }
}
