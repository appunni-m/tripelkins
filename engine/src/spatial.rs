use crate::{
    Engine,
    geometry::{BODY_RADIUS, Geometry, Object, hits},
    terrain,
    value::*,
};
use serde_json::Value;
impl Engine {
    fn ensure_geometry(&mut self) {
        let stamp = (
            num(&self.world["map"], "seed").to_bits(),
            num(&self.world["map"], "revision").to_bits(),
            num(&self.world, "navRevision").to_bits(),
            flag(&self.world["progress"], "bridge"),
        );
        if self.geo.as_ref().is_none_or(|(old, _)| *old != stamp) {
            self.nav.reset(format!("{stamp:?}"));
            if let Some(cache) = self.route_cost_cache.as_mut() {
                cache.clear();
            }
            self.geo = Some((stamp, Geometry::new(&self.world)));
        }
    }
    /// Reuse exact route queries only within one synchronous planning operation.
    /// Nested planning helpers share the outer scope, matching the reference engine.
    pub(crate) fn with_route_costs<T>(&mut self, operation: impl FnOnce(&mut Self) -> T) -> T {
        if self.route_cost_cache.is_some() {
            return operation(self);
        }
        self.route_cost_cache = Some(Default::default());
        let result = operation(self);
        self.route_cost_cache = None;
        result
    }
    pub(crate) fn route_cost(&mut self, from: Point, to: Point) -> f64 {
        self.ensure_geometry();
        let key = [from.x, from.y, to.x, to.y].map(|v| if v == 0. { 0 } else { v.to_bits() });
        if let Some(value) = self
            .route_cost_cache
            .as_ref()
            .and_then(|cache| cache.get(&key))
        {
            return *value;
        }
        let Some((_, g)) = &self.geo else {
            return f64::INFINITY;
        };
        let value = self.nav.cost(g, from, to);
        if let Some(cache) = self.route_cost_cache.as_mut()
            && cache.len() < 8192
        {
            cache.insert(key, value);
        }
        value
    }
    pub(crate) fn waypoint(&mut self, from: Point, to: Point) -> Option<Point> {
        self.ensure_geometry();
        let (_, g) = self.geo.as_ref()?;
        self.nav.waypoint(g, from, to)
    }
    pub(crate) fn swept_move(&mut self, p: &mut Point, dx: f64, dy: f64) -> f64 {
        self.ensure_geometry();
        self.geo.as_ref().map_or(0., |(_, g)| g.swept(p, dx, dy))
    }
    pub(crate) fn clear_at(&mut self, p: Point, radius: f64, ignore: Option<&str>) -> bool {
        self.ensure_geometry();
        self.geo
            .as_ref()
            .is_some_and(|(_, g)| g.clear(p, radius, ignore))
    }
    pub(crate) fn clear_position(&mut self, p: Point) -> bool {
        self.ensure_geometry();
        self.geo
            .as_ref()
            .is_some_and(|(_, g)| g.clear(p, BODY_RADIUS, None))
    }
    pub(crate) fn service_slots(&mut self, o: &Value, from: Option<Point>) -> Vec<Value> {
        self.ensure_geometry();
        let o = Object::read(o);
        self.geo
            .as_ref()
            .map_or_else(Vec::new, |(_, g)| g.service_slots(&o, from.unwrap_or(o.p)))
    }
    pub(crate) fn free_position(
        &mut self,
        p: Point,
        others: &[Point],
        radius: f64,
    ) -> Option<Point> {
        self.ensure_geometry();
        self.geo
            .as_ref()
            .and_then(|(_, g)| g.free(p, others, radius))
    }
    pub(crate) fn can_place(
        &mut self,
        kind: &str,
        p: Point,
        ignore: Option<&str>,
        ignore_creatures: bool,
    ) -> bool {
        self.ensure_geometry();
        if !ignore_creatures {
            let o = Object {
                id: String::new(),
                kind: kind.into(),
                p,
                level: 1.,
                data: std::rc::Rc::new(Value::Null),
            };
            if list(&self.world, "creatures")
                .iter()
                .any(|c| hits(Point::read(c), BODY_RADIUS, &o))
            {
                return false;
            }
        }
        self.geo
            .as_ref()
            .is_some_and(|(_, g)| g.can_place(kind, p, ignore, true))
    }
    pub(crate) fn nearby_objects(&mut self, p: Point, r: f64) -> Vec<Value> {
        self.ensure_geometry();
        let mut out: Vec<_> = list(&self.world, "objects")
            .iter()
            .filter(|o| (num(o, "x") - p.x).abs() <= r && (num(o, "y") - p.y).abs() <= r)
            .cloned()
            .collect();
        if let Some((_, g)) = &self.geo {
            out.extend(
                g.natural(p.offset(-r, -r), p.offset(r, r))
                    .into_iter()
                    .filter(|o| (o.p.x - p.x).abs() <= r && (o.p.y - p.y).abs() <= r)
                    .map(|o| o.data.as_ref().clone()),
            );
        }
        out
    }
    pub(crate) fn natural_object(&mut self, id: &str) -> Option<Value> {
        let parts: Vec<_> = id.split(':').collect();
        if parts.len() != 4
            || parts[0] != "g"
            || parts[1].trim_start_matches('-').len() > 8
            || parts[2].trim_start_matches('-').len() > 8
            || parts[3].len() > 2
        {
            return None;
        }
        let x = parts[1].parse::<i32>().ok()?;
        let y = parts[2].parse::<i32>().ok()?;
        let slot = parts[3].parse::<u32>().ok()?;
        if slot > 15 {
            return None;
        }
        let mask = self.world["map"]["cleared"][format!("{x}:{y}")]
            .as_u64()
            .unwrap_or(0);
        if mask & (1 << slot) != 0 {
            return None;
        }
        terrain::chunk(num(&self.world["map"], "seed") as u32, x, y)
            .into_iter()
            .find(|o| text(o, "id") == id)
    }
}
