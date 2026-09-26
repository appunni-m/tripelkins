#![recursion_limit = "512"]
mod access;
mod commands;
mod community;
mod context;
mod context_budget;
mod contract;
mod density;
mod development;
mod discovery;
mod exploration;
mod geometry;
mod goals;
mod identity;
mod inspection;
mod jobs;
mod memory;
mod navigation;
mod outposts;
mod planning;
mod population;
mod resources;
mod save;
mod scheduling;
mod settlement;
mod simulation;
mod spatial;
mod spatial_contract;
mod state;
mod story;
mod terrain;
mod timeline;
mod timing;
mod traffic;
mod value;
use serde_json::{Value, json};
use value::*;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Engine {
    world: Value,
    nav: navigation::Navigation,
    geo: Option<((u64, u64, u64, bool), geometry::Geometry)>,
    route_cost_cache: Option<std::collections::HashMap<[u64; 4], f64>>,
    now_iso: String,
    planning_cache: std::collections::HashMap<String, Value>,
    sim: simulation::Runtime,
    density_index: std::cell::RefCell<density::DensityIndex>,
    discovery_index: std::cell::RefCell<discovery::DiscoveryIndex>,
}
#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(snapshot: &str) -> Result<Engine, JsValue> {
        Self::from_json(snapshot).map_err(|e| JsValue::from_str(&e))
    }
    pub fn snapshot(&self) -> String {
        self.world.to_string()
    }
    pub fn frame(&self, known_discovery_revision: f64) -> Result<String, JsValue> {
        self.presentation_frame_json(known_discovery_revision)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }
    pub fn dispatch(&mut self, operation: &str, input: &str) -> Result<String, JsValue> {
        self.call_json(operation, input)
            .map_err(|e| JsValue::from_str(&e))
    }
}
impl Engine {
    pub fn from_json(snapshot: &str) -> Result<Self, String> {
        let world: Value = serde_json::from_str(snapshot).map_err(|e| e.to_string())?;
        if !world.is_object() {
            return Err("World must be an object".into());
        }
        Ok(Self {
            world,
            nav: navigation::Navigation::default(),
            geo: None,
            route_cost_cache: None,
            now_iso: "2000-01-01T00:00:00.000Z".into(),
            planning_cache: Default::default(),
            sim: simulation::Runtime::default(),
            density_index: Default::default(),
            discovery_index: Default::default(),
        })
    }
    pub fn call_json(&mut self, operation: &str, input: &str) -> Result<String, String> {
        let input: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
        let seed = num(&self.world["map"], "seed") as u32;
        let result = match operation {
            "navigation.waypoint" => self.nav.waypoint_value(
                &geometry::Geometry::new(&self.world),
                Point::read(&input["from"]),
                Point::read(&input["to"]),
            ),
            "navigation.routeCost" => {
                json!(self.route_cost(Point::read(&input["from"]), Point::read(&input["to"])))
            }
            "navigation.memory" => {
                json!({"fields":self.nav.field_count(),"bytes":self.nav.bytes(),"limit":192})
            }
            "discovery.reveal" => json!(self.reveal(
                Point::read(&input["point"]),
                input["radius"].as_f64().unwrap_or(10.)
            )),
            "discovery.isExplored" => json!(self.is_explored(Point::read(&input))),
            "discovery.summary" => self.discovery_summary(),
            "terrain.normalize" => terrain::normalize(&input["map"], flag(&input, "required"))?,
            "clock" => {
                self.now_iso = text(&input, "iso").to_owned();
                if let Some(value) = input.get("monotonicMs") {
                    timing::set_fixed(value.as_f64());
                }
                Value::Null
            }
            "presentation" => {
                if let Some(ui) = input.get("ui") {
                    if !self.world["ui"].is_object() {
                        self.world["ui"] = json!({});
                    }
                    for key in [
                        "x", "y", "zoom", "tool", "tab", "paused", "muted", "welcome", "selected",
                    ] {
                        if let Some(value) = ui.get(key) {
                            self.world["ui"][key] = value.clone();
                        }
                    }
                }
                if let Some(settings) = input.get("settings") {
                    self.world["settings"] = settings.clone();
                }
                if !self.world["runtime"].is_object() {
                    self.world["runtime"] = json!({});
                }
                for key in ["intelligenceAvailable", "growth"] {
                    if let Some(value) = input.get(key)
                        && !value.is_null()
                    {
                        self.world["runtime"][key] = value.clone();
                    }
                }
                Value::Null
            }
            "diagnostics.workerTick" => {
                let ms = num(&input, "milliseconds");
                let previous = self.world["runtime"]["workerMs"].as_f64().unwrap_or(ms);
                self.world["runtime"]["workerMs"] = json!(previous * 0.9 + ms * 0.1);
                Value::Null
            }
            "identity" => {
                json!({"name":"tripelkins-engine","version":env!("CARGO_PKG_VERSION"),"protocol":1})
            }
            "snapshot" => self.world.clone(),
            "geometry.clearPosition" => json!(geometry::Geometry::new(&self.world).clear(
                Point::read(&input["point"]),
                input["radius"].as_f64().unwrap_or(geometry::BODY_RADIUS),
                input["ignore"].as_str()
            )),
            "geometry.canPlace" => json!(geometry::Geometry::new(&self.world).can_place(
                text(&input, "type"),
                Point::read(&input["point"]),
                input["ignore"].as_str(),
                flag(&input, "ignoreCreatures")
            )),
            "geometry.serviceSlots" => {
                let o = geometry::Object::read(&input["object"]);
                json!(
                    geometry::Geometry::new(&self.world)
                        .service_slots(&o, input.get("from").map(Point::read).unwrap_or(o.p))
                )
            }
            "geometry.freePosition" => {
                let g = geometry::Geometry::new(&self.world);
                let others: Vec<_> = input
                    .get("others")
                    .and_then(Value::as_array)
                    .map(|v| v.iter().map(Point::read).collect())
                    .unwrap_or_else(|| g.creatures.iter().map(|(_, p)| *p).collect());
                json!(g.free(
                    Point::read(&input["point"]),
                    &others,
                    input["radius"].as_f64().unwrap_or(6.)
                ))
            }
            "geometry.sweptMove" => {
                let g = geometry::Geometry::new(&self.world);
                let mut p = Point::read(&input["point"]);
                let moved = g.swept(&mut p, num(&input, "dx"), num(&input, "dy"));
                json!({"point":p,"moved":moved})
            }
            "terrain.hash" => json!(terrain::hash(
                num(&input, "seed") as u32,
                num(&input, "x") as i32,
                num(&input, "y") as i32,
                num(&input, "salt") as u32
            )),
            "terrain.chunkObjects" => json!(terrain::chunk(
                seed,
                num(&input, "cx") as i32,
                num(&input, "cy") as i32
            )),
            "terrain.isGround" => json!(terrain::ground(seed, Point::read(&input))),
            "terrain.isWater" => json!(terrain::water(seed, Point::read(&input))),
            "terrain.biome" => json!(terrain::biome(seed, Point::read(&input))),
            "terrain.riverLeft" => json!(terrain::river_left(seed, num(&input, "y"))),
            "terrain.naturalObjects" => json!(terrain::natural(
                &self.world,
                Point::read(&input["min"]),
                Point::read(&input["max"])
            )),
            "terrain.nearbyObjects" => json!(terrain::nearby(
                &self.world,
                Point::read(&input),
                num(&input, "radius")
            )),
            "terrain.clearNatural" => json!(terrain::clear_natural(&mut self.world, &input)),
            _ => {
                if let Some(result) = self.simulation_dispatch(operation, &input)? {
                    result
                } else if let Some(result) = self.state_dispatch(operation, &input)? {
                    result
                } else if let Some(result) = self.planning_dispatch(operation, &input)? {
                    result
                } else if let Some(result) = self.contract_dispatch(operation, &input)? {
                    result
                } else {
                    return Err(format!("Unsupported engine operation: {operation}"));
                }
            }
        };
        serde_json::to_string(&result).map_err(|e| e.to_string())
    }
}
