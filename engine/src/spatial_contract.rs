//! Public spatial exports delegate to the same geometry and navigation engine
//! used by simulation. This adapter only preserves the source argument shapes.
use crate::{
    Engine,
    geometry::{self, BODY_RADIUS, Geometry, Object},
    navigation::Navigation,
    terrain,
    value::*,
};
use serde_json::{Value, json};

fn bridge_geometry(o: &Value) -> Value {
    let g = geometry::bridge(&Object::read(o));
    let b = &o["bridge"];
    json!({"a":g.a,"b":g.b,"width":b.get("width").filter(|v|!v.is_null()).cloned().unwrap_or(json!(2.4)),
        "elevation":0.18,"required":b.get("required").filter(|v|!v.is_null()).cloned().unwrap_or(json!(24)),
        "delivered":b.get("delivered").filter(|v|crate::memory::truthy(v)).cloned().unwrap_or_else(||json!({"wood":o.get("stock").filter(|v|crate::memory::truthy(v)).cloned().unwrap_or(json!(0)),"bones":0})),
        "complete":b.get("complete").filter(|v|!v.is_null()).cloned().unwrap_or(json!(num(o,"stock")>=24.))})
}
fn radius(a: &Value, key: &str, default: f64) -> f64 {
    a.get(key)
        .map(|v| crate::memory::js_number(v).unwrap_or(f64::NAN))
        .unwrap_or(default)
}
impl Engine {
    pub(crate) fn spatial_contract(
        &mut self,
        key: &str,
        a: &Value,
    ) -> Result<Option<Value>, String> {
        let result = match key {
            "game.geometry.footprint" => json!(
                geometry::footprint(text(&self.contract_entity(&a["o"]), "type"))
                    .map(|(x, y)| [x, y])
            ),
            "game.geometry.bridgeGeometry" => bridge_geometry(&self.contract_entity(&a["o"])),
            "game.geometry.bridgePoint" => {
                let o = self.contract_entity(&a["o"]);
                let (t, distance, length, dx, dy) = geometry::bridge_point(
                    geometry::bridge(&Object::read(&o)),
                    Point::read(&a["p"]),
                );
                json!({"g":bridge_geometry(&o),"t":t,"distance":distance,"length":length,"dx":dx,"dy":dy})
            }
            "game.geometry.bridgeAt" => {
                let p = Point::read(&a["p"]);
                let r = radius(a, "radius", BODY_RADIUS);
                list(&self.world, "objects")
                    .iter()
                    .filter(|o| text(o, "type") == "bridge")
                    .find(|o| {
                        let b = geometry::bridge(&Object::read(o));
                        let (t, d, _, _, _) = geometry::bridge_point(b, p);
                        b.complete && (0.0..=1.0).contains(&t) && d <= b.width / 2. - r
                    })
                    .cloned()
                    .unwrap_or(Value::Null)
            }
            "game.geometry.walkableSurface" => json!(Geometry::new(&self.world).walkable(
                Point {
                    x: num(a, "x"),
                    y: num(a, "y")
                },
                radius(a, "radius", BODY_RADIUS)
            )),
            "game.geometry.hitsFootprint" => json!(geometry::hits(
                Point {
                    x: num(a, "x"),
                    y: num(a, "y")
                },
                num(a, "r"),
                &Object::read(&self.contract_entity(&a["o"]))
            )),
            "game.geometry.nearbyObstacles" => json!(
                Geometry::new(&self.world)
                    .obstacles(
                        Point {
                            x: num(a, "x"),
                            y: num(a, "y")
                        },
                        radius(a, "r", 5.)
                    )
                    .into_iter()
                    .map(|o| {
                        let mut value = o.data.as_ref().clone();
                        value["id"] = json!(o.id);
                        value
                    })
                    .collect::<Vec<_>>()
            ),
            "game.map.naturalBlocked" => {
                let p = Point {
                    x: num(a, "x"),
                    y: num(a, "y"),
                };
                json!(
                    !terrain::clearing(p)
                        && terrain::chunk(
                            num(&self.world["map"], "seed") as u32,
                            (p.x / 16.).floor() as i32,
                            (p.y / 16.).floor() as i32
                        )
                        .iter()
                        .any(|o| {
                            text(o, "type") != "flowers"
                                && num(o, "x").floor() == p.x
                                && num(o, "y").floor() == p.y
                                && (num(&self.world["map"]["cleared"], text(o, "chunk")) as u64
                                    & (1 << num(o, "slot") as u32))
                                    == 0
                        })
                )
            }
            "game.destruction.meteorTargetError" => json!(self.meteor_target_error(Point {
                x: num(a, "x"),
                y: num(a, "y")
            })),
            "game.navigation.lineClear" => {
                let objects = list(a, "objects")
                    .iter()
                    .map(|v| Object::read(&self.contract_entity(v)))
                    .collect::<Vec<_>>();
                json!(Geometry::new(&self.world).line_clear(
                    Point::read(&a["a"]),
                    Point::read(&a["b"]),
                    &objects
                ))
            }
            "game.navigation.withRouteCosts" => {
                return self.with_route_costs(|engine| {
                    engine.contract_dispatch("contract.call", &a["operation"])
                });
            }
            "game.navigation-grid.copyOccupancy" => {
                let width = num(a, "width");
                if width < 0. || width.fract() != 0. || width > 4096. {
                    return Err("Invalid occupancy grid width".into());
                }
                let mut nav = Navigation::default();
                nav.import_tiles(a.get("tiles").unwrap_or(&json!([])))?;
                let grid = nav.copy_occupancy(
                    &Geometry::new(&self.world),
                    width as usize,
                    num(a, "left") as i32,
                    num(a, "top") as i32,
                );
                let mut output = a
                    .get("grid")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_else(|| vec![json!(0); grid.len()]);
                if output.len() < grid.len() {
                    return Err("offset is out of bounds".into());
                }
                for (i, byte) in grid.into_iter().enumerate() {
                    output[i] = json!(byte);
                }
                json!({"grid":output,"tiles":nav.export_tiles()})
            }
            _ => return Ok(None),
        };
        Ok(Some(result))
    }
}
