use crate::value::*;
use serde_json::{Value, json};
pub const WORLD_EDGE: f64 = 1_000_000_000.;
pub fn hash(seed: u32, x: i32, y: i32, salt: u32) -> f64 {
    let mut n = seed
        ^ (x as u32).wrapping_mul(374761393)
        ^ (y as u32).wrapping_mul(668265263)
        ^ salt.wrapping_mul(1442695041);
    n = (n ^ (n >> 13)).wrapping_mul(1274126177);
    f64::from(n ^ (n >> 16)) / 4294967296.
}
fn noise(seed: u32, x: f64, y: f64, scale: f64) -> f64 {
    let gx = (x / scale).floor() as i32;
    let gy = (y / scale).floor() as i32;
    let smooth = |t: f64| t * t * (3. - 2. * t);
    let fx = smooth(x / scale - f64::from(gx));
    let fy = smooth(y / scale - f64::from(gy));
    let a = hash(seed, gx, gy, 0);
    let b = hash(seed, gx + 1, gy, 0);
    let c = hash(seed, gx, gy + 1, 0);
    let d = hash(seed, gx + 1, gy + 1, 0);
    (a + (b - a) * fx) * (1. - fy) + (c + (d - c) * fx) * fy
}
pub fn clearing(p: Point) -> bool {
    p.x >= 0. && p.x < 64. && p.y >= 0. && p.y < 48.
}
pub fn river_left(seed: u32, y: f64) -> f64 {
    let away = 0_f64.max(-y).max(y - 48.);
    if away == 0. {
        40.
    } else {
        40. + (noise(seed.wrapping_add(73), 0., y, 96.) - 0.5) * 28. * (away / 48.).min(1.)
    }
}
pub fn water(seed: u32, p: Point) -> bool {
    if p.x < 26. || p.x >= 59. {
        return false;
    }
    let left = river_left(seed, p.y);
    p.x >= left && p.x < left + 5.
}
pub fn ground(seed: u32, p: Point) -> bool {
    p.x.is_finite()
        && p.y.is_finite()
        && p.x.abs() < WORLD_EDGE - 2.
        && p.y.abs() < WORLD_EDGE - 2.
        && !water(seed, p)
}
pub fn biome(seed: u32, p: Point) -> &'static str {
    if clearing(p) {
        return "clearing";
    }
    let m = noise(seed, p.x, p.y, 48.) * 0.7 + noise(seed.wrapping_add(1), p.x, p.y, 16.) * 0.3;
    if m > 0.6 {
        "woodland"
    } else if m < 0.35 {
        "highland"
    } else {
        "meadow"
    }
}
pub fn chunk(seed: u32, cx: i32, cy: i32) -> Vec<Value> {
    let mut out = Vec::new();
    let key = format!("{cx}:{cy}");
    for slot in 0..16 {
        let cell_x = cx * 4 + slot % 4;
        let cell_y = cy * 4 + slot / 4;
        let p = Point {
            x: f64::from(cell_x) * 4. + 1. + hash(seed, cell_x, cell_y, 1) * 2.,
            y: f64::from(cell_y) * 4. + 1. + hash(seed, cell_x, cell_y, 2) * 2.,
        };
        if clearing(p) || !ground(seed, p) || (p.x - river_left(seed, p.y) - 2.5).abs() < 5. {
            continue;
        }
        let area = biome(seed, p);
        let roll = hash(seed, cell_x, cell_y, 3);
        let kind = if roll < if area == "woodland" { 0.65 } else { 0.18 } {
            "tree"
        } else if roll < if area == "highland" { 0.55 } else { 0.24 } {
            "rock"
        } else if roll < if area == "highland" { 0.62 } else { 0.27 } {
            "node"
        } else if roll > 0.88 {
            "flowers"
        } else {
            continue;
        };
        out.push(json!({"id":format!("g:{key}:{slot}"),"chunk":key,"slot":slot,"type":kind,"x":p.x,"y":p.y,
            "stock":if kind=="node" {100000}else{0},"level":if kind=="node" && hash(seed,cell_x,cell_y,4)>0.8 {2}else{1},
            "variant":(hash(seed,cell_x,cell_y,5)*3.).floor(),"progress":0}));
    }
    out
}
pub fn natural(w: &Value, min: Point, max: Point) -> Vec<Value> {
    let seed = num(&w["map"], "seed") as u32;
    let mut out = Vec::new();
    for cy in (min.y / 16.).floor() as i32..=(max.y / 16.).floor() as i32 {
        for cx in (min.x / 16.).floor() as i32..=(max.x / 16.).floor() as i32 {
            let mask = uint(&w["map"]["cleared"][format!("{cx}:{cy}")]).unwrap_or(0);
            out.extend(
                chunk(seed, cx, cy)
                    .into_iter()
                    .filter(|o| mask & (1 << (num(o, "slot") as u32)) == 0),
            );
        }
    }
    out
}
pub fn nearby(w: &Value, p: Point, r: f64) -> Vec<Value> {
    list(w, "objects")
        .iter()
        .cloned()
        .chain(natural(w, p.offset(-r, -r), p.offset(r, r)))
        .filter(|o| (num(o, "x") - p.x).abs() <= r && (num(o, "y") - p.y).abs() <= r)
        .collect()
}
pub fn clear_natural(w: &mut Value, o: &Value) -> bool {
    if !text(o, "id").starts_with("g:") {
        return true;
    }
    let key = text(o, "chunk");
    let old = uint(&w["map"]["cleared"][key]).unwrap_or(0);
    if old == 0 && w["map"]["cleared"].as_object().map_or(0, |m| m.len()) >= 2048 {
        return false;
    }
    w["map"]["cleared"][key] = json!(old | (1 << (num(o, "slot") as u32)));
    increment(&mut w["map"], "revision", 1.);
    true
}

#[allow(
    clippy::manual_clamp,
    reason = "Legacy revision migration converts NaN to zero; clamp would preserve NaN."
)]
pub fn normalize(raw: &Value, required: bool) -> Result<Value, String> {
    let mut map = json!({"version":1,"seed":18492,"revision":0,"cleared":{}});
    if !truthy(raw) {
        return if required {
            Err("This saved world is missing its terrain data.".into())
        } else {
            Ok(map)
        };
    }
    if num(raw, "version") != 1. {
        return Err("This world's terrain needs a newer game version.".into());
    }
    if !uint(&raw["seed"]).is_some_and(|n| n <= 4294967295) || !raw["cleared"].is_object() {
        return Err("This saved world's terrain data is incomplete.".into());
    }
    map["seed"] = raw["seed"].clone();
    let entries = raw["cleared"]
        .as_object()
        .ok_or("This saved world's terrain data is incomplete.")?;
    if entries.len() > 2048 {
        return Err("This saved map contains too many changed regions.".into());
    }
    for (key, mask) in entries {
        let parts: Vec<_> = key.split(':').collect();
        let valid = parts.len() == 2
            && parts
                .iter()
                .all(|p| region_key_part(p, 8, WORLD_EDGE / 16.));
        if !valid || !uint(mask).is_some_and(|n| n <= 65535) {
            return Err("This saved map has damaged terrain changes.".into());
        }
        if uint(mask).unwrap_or(0) > 0 {
            map["cleared"][key] = mask.clone();
        }
    }
    map["revision"] = json!(js_number(&raw["revision"]).max(0.).min(1e12));
    Ok(map)
}
