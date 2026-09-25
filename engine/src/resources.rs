use crate::{
    Engine,
    geometry::{Object, bridge},
    identity::encounter,
    value::*,
};
use serde_json::{Value, json};

pub(crate) fn bridge_state(o: &Value) -> Value {
    let g = bridge(&Object::read(o));
    json!({"a":g.a,"b":g.b,"width":g.width,"elevation":0.18,
      "required":o["bridge"]["required"].as_f64().unwrap_or(24.),
      "delivered":o["bridge"].get("delivered").filter(|x|!x.is_null()).cloned().unwrap_or(json!({"wood":num(o,"stock"),"bones":0})),"complete":g.complete})
}
pub(crate) fn accepts_project(o: &Value, kind: &str) -> bool {
    text(o, "type") == "sculpture" && num(o, "stock") < 12. && kind == "wood"
}
impl Engine {
    pub(crate) fn release_cargo(&mut self, c: &mut Value) {
        if num(c, "carry") > 0. {
            let kind = if text(c, "cargoKind").is_empty() {
                "wood"
            } else {
                text(c, "cargoKind")
            }
            .to_string();
            increment(&mut self.world["inventory"], &kind, num(c, "carry"));
            c["carry"] = json!(0);
            c["cargoKind"] = Value::Null;
        }
    }
    pub(crate) fn deposit(&mut self, kind: &str, p: Point, stock: f64) -> Option<Value> {
        if let Some(o) = self.world["objects"].as_array_mut().and_then(|a| {
            a.iter_mut()
                .find(|o| text(o, "type") == kind && Point::read(o).distance(p) < 2.)
        }) {
            increment(o, "stock", stock);
            return Some(o.clone());
        }
        if list(&self.world, "objects").len() < 2048 {
            return self.add_object(kind, p.x, p.y, json!({"stock":stock}));
        }
        let material = match kind {
            "log" => "wood",
            "bone" => "bones",
            "ore" => "ore",
            "corpse" => "corpses",
            _ => return None,
        };
        increment(&mut self.world["inventory"], material, stock);
        None
    }
    pub(crate) fn die(&mut self, victims: &[Value], cause: &str, actor: &str) -> usize {
        let living: Vec<_> = victims
            .iter()
            .filter(|c| {
                list(&self.world, "creatures")
                    .iter()
                    .any(|o| same_id(&o["id"], &c["id"]))
            })
            .cloned()
            .collect();
        let time = num(&self.world, "time");
        for mut c in living.clone() {
            self.density_index.borrow_mut().remember_position(&c);
            self.release_cargo(&mut c);
            let sacrifice = matches!(cause, "bug" | "swarm");
            let p = Point::read(&c);
            self.deposit(
                if sacrifice { "bone" } else { "corpse" },
                p,
                if sacrifice { 8. } else { 1. },
            );
            for other in self.world["creatures"].as_array_mut().into_iter().flatten() {
                if !same_id(&other["id"], &c["id"]) && Point::read(other).distance(p) < 6. {
                    encounter(other, "loss", Some(text(&c, "id")), time);
                }
            }
            self.world["departed"].as_array_mut().unwrap().push(
                json!({"id":c["id"],"name":c["name"],"cause":cause,"tick":time,"actor":actor}),
            );
            self.remember(
                "loss",
                &format!(
                    "{} died ({}). {}",
                    text(&c, "name"),
                    cause,
                    if sacrifice {
                        "Eight bones remain."
                    } else {
                        "Their remains are kept."
                    }
                ),
                Some(text(&c, "id")),
            );
            self.note_evidence(
                "deaths",
                &format!("{} died from {}.", text(&c, "name"), cause),
                1.,
                Some(text(&c, "id")),
            );
            let dimension = if sacrifice {
                "sacrificed"
            } else {
                match cause {
                    "hammer" => "hammer",
                    "meteor" => "meteorDeaths",
                    "pollution" => "pollutionDeaths",
                    _ => "neglect",
                }
            };
            self.note_evidence(
                dimension,
                &format!("{}: {}.", text(&c, "name"), cause),
                1.,
                Some(text(&c, "id")),
            );
        }
        if living.is_empty() {
            return 0;
        }
        self.world["creatures"]
            .as_array_mut()
            .unwrap()
            .retain(|c| !living.iter().any(|o| same_id(&o["id"], &c["id"])));
        let departed = self.world["departed"].as_array_mut().unwrap();
        if departed.len() > 32 {
            departed.drain(..departed.len() - 32);
        }
        let population = list(&self.world, "creatures").len() as f64
            + num(&self.world, "cohort")
            + num(&self.world["orbital"], "population");
        self.world["population"] = json!(population);
        increment(&mut self.world, "commandRevision", 1.);
        living.len()
    }
    pub(crate) fn deliver(&mut self, c: &mut Value, o: &mut Value) {
        let mut g = bridge_state(o);
        let kind = if text(c, "cargoKind").is_empty() {
            "wood"
        } else {
            text(c, "cargoKind")
        }
        .to_string();
        if flag(&g, "complete") {
            self.release_cargo(c);
            return;
        }
        let remaining =
            num(&g, "required") - num(&g["delivered"], "wood") - num(&g["delivered"], "bones");
        let amount = num(c, "carry").min(remaining);
        increment(&mut g["delivered"], &kind, amount);
        increment(c, "carry", -amount);
        self.note_evidence(
            "deliveries",
            &format!("{} delivered {} {}.", text(c, "name"), amount, kind),
            1.,
            Some(text(c, "id")),
        );
        self.note_evidence(
            if kind == "bones" {
                "bonesDelivered"
            } else {
                "woodDelivered"
            },
            &format!("{} {} became part of the bridge.", amount, kind),
            amount,
            Some(text(c, "id")),
        );
        o["stock"] = json!(num(&g["delivered"], "wood") + num(&g["delivered"], "bones"));
        self.activity(
            "bridge",
            &format!(
                "{} delivered {} {}. Bridge: {}/{}.",
                text(c, "name"),
                amount,
                kind,
                num(o, "stock"),
                num(&g, "required")
            ),
            "Instincts",
            "",
        );
        if num(o, "stock") >= num(&g, "required") {
            g["complete"] = json!(true);
            self.world["progress"]["bridge"] = json!(true);
            self.world["stage"] = json!(num(&self.world, "stage").max(2.));
            increment(&mut self.world, "navRevision", 1.);
            increment(&mut self.world, "commandRevision", 1.);
            self.remember(
                "bridge",
                "The bridge is complete. Both banks are connected.",
                Some(text(o, "id")),
            );
            self.post_message(json!({"key":format!("bridge-complete:{}",text(o,"id")),"title":"The other bank","text":"We finished the crossing. The ore deposits and mountain are within reach now. Our world has room to grow."}));
        }
        o["bridge"] = g;
        if num(c, "carry") > 0. {
            self.release_cargo(c);
        } else {
            c["cargoKind"] = Value::Null;
        }
    }
    pub(crate) fn supply_project(&mut self, c: &mut Value, o: &mut Value) -> bool {
        if !accepts_project(o, text(c, "cargoKind")) {
            return false;
        }
        let used = num(c, "carry").min(12. - num(o, "stock"));
        increment(o, "stock", used);
        increment(c, "carry", -used);
        if num(c, "carry") == 0. {
            c["cargoKind"] = Value::Null;
        }
        if num(o, "stock") >= 12. {
            let message = "The sculpture keeps the shape of our first question.";
            self.remember("project", message, Some(text(o, "id")));
            self.note_evidence("discovered", message, 1., Some(text(o, "id")));
            o["discovered"] = json!(true);
        }
        true
    }
    pub(crate) fn pollution_at(&self, p: Point) -> f64 {
        list(&self.world, "pollution")
            .iter()
            .map(|z| {
                num(z, "amount") * (1. - Point::read(z).distance(p) / num(z, "radius")).max(0.)
            })
            .sum()
    }
    pub(crate) fn pollute(&mut self, o: &Value, amount: f64) {
        let pollution = self.world["pollution"].as_array_mut().unwrap();
        let index = if let Some(i) = pollution
            .iter()
            .position(|z| same_id(&z["source"], &o["id"]))
        {
            i
        } else {
            pollution.push(json!({"source":o["id"],"x":o["x"],"y":o["y"],"radius":5,"amount":0}));
            pollution.len() - 1
        };
        let z = &mut pollution[index];
        z["amount"] = json!((num(z, "amount") + amount).min(250.));
        if pollution.len() > 64 {
            pollution.drain(..pollution.len() - 64);
        }
        self.world["progress"]["pollution"] = json!(
            list(&self.world, "pollution")
                .iter()
                .map(|z| num(z, "amount"))
                .sum::<f64>()
                .min(1000.)
        );
    }
    pub(crate) fn clean_pollution(&mut self, p: Point) {
        let mut removed = 0.;
        for z in self.world["pollution"].as_array_mut().into_iter().flatten() {
            if Point::read(z).distance(p) < num(z, "radius") + 3. {
                let n = num(z, "amount").min(40.);
                increment(z, "amount", -n);
                removed += n;
            }
        }
        self.world["pollution"]
            .as_array_mut()
            .unwrap()
            .retain(|z| num(z, "amount") > 0.1);
        self.world["progress"]["pollution"] = json!(
            list(&self.world, "pollution")
                .iter()
                .map(|z| num(z, "amount"))
                .sum::<f64>()
        );
        for c in self.world["creatures"].as_array_mut().into_iter().flatten() {
            if Point::read(c).distance(p) < 4. {
                c["clean"] = json!(num(c, "clean").max(90.));
                c["sickness"] = json!((num(c, "sickness") - 30.).max(0.));
            }
        }
        if removed > 0. {
            self.note_evidence(
                "cleaned",
                &format!(
                    "Cleaned {} pollution near ({}, {}).",
                    crate::simulation::js_round(removed),
                    crate::simulation::js_round(p.x),
                    crate::simulation::js_round(p.y)
                ),
                removed,
                None,
            );
            self.remember(
                "cleanup",
                "The air clears around this part of the settlement.",
                None,
            );
        }
    }
    pub(crate) fn maintain_factory(&mut self, o: &Value, amount: f64) -> f64 {
        let zones = self.world["pollution"].as_array_mut().unwrap();
        let Some(z) = zones.iter_mut().find(|z| same_id(&z["source"], &o["id"])) else {
            return 0.;
        };
        let removed = amount.max(0.).min(num(z, "amount"));
        increment(z, "amount", -removed);
        zones.retain(|z| num(z, "amount") > 0.);
        self.world["progress"]["pollution"] = json!(
            list(&self.world, "pollution")
                .iter()
                .map(|z| num(z, "amount"))
                .sum::<f64>()
        );
        removed
    }
}
