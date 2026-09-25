use serde_json::{Value, json};

/// JavaScript ID equality preserves strings versus numbers, while JSON number
/// spelling (for example `2` versus `2.0`) does not change a numeric identity.
pub fn same_id(left: &Value, right: &Value) -> bool {
    if left.is_number() && right.is_number() {
        left.as_f64() == right.as_f64()
    } else {
        left == right
    }
}
pub fn num(v: &Value, key: &str) -> f64 {
    v[key].as_f64().unwrap_or(0.0)
}
pub fn number(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
pub fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub fn flag(v: &Value, key: &str) -> bool {
    v[key].as_bool().unwrap_or(false)
}
pub fn list<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v[key].as_array().map(Vec::as_slice).unwrap_or(&[])
}
pub fn set_num(v: &mut Value, key: &str, n: f64) {
    v[key] = json!(n);
}
pub fn increment(v: &mut Value, key: &str, n: f64) {
    set_num(v, key, num(v, key) + n);
}
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
impl Point {
    pub fn read(v: &Value) -> Self {
        Self {
            x: num(v, "x"),
            y: num(v, "y"),
        }
    }
    pub fn distance(self, p: Self) -> f64 {
        js_hypot(self.x - p.x, self.y - p.y)
    }
    pub fn offset(self, x: f64, y: f64) -> Self {
        Self {
            x: self.x + x,
            y: self.y + y,
        }
    }
    pub fn json(self) -> Value {
        json!({"x":self.x,"y":self.y})
    }
}

/// JavaScript Number.isInteger accepts JSON numbers written with a decimal.
pub fn uint(value: &Value) -> Option<u64> {
    let n = value.as_f64()?;
    if n.is_finite() && n >= 0. && n.fract() == 0. && n <= 9007199254740991. {
        Some(n as u64)
    } else {
        None
    }
}

/// Serialize numbers with ECMAScript spelling, including exponent boundaries.
/// Preserve insertion order and JSON string escaping for history/context bytes.
pub fn js_json(value: &Value) -> String {
    fn append(v: &Value, output: &mut String) {
        match v {
            Value::Number(n) => {
                output.push_str(ryu_js::Buffer::new().format_finite(n.as_f64().unwrap()));
            }
            Value::Array(a) => {
                output.push('[');
                for (index, item) in a.iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    append(item, output);
                }
                output.push(']');
            }
            Value::Object(o) => {
                output.push('{');
                for (index, (key, item)) in o.iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    output.push_str(&serde_json::to_string(key).unwrap());
                    output.push(':');
                    append(item, output);
                }
                output.push('}');
            }
            _ => output.push_str(&v.to_string()),
        }
    }
    let mut output = String::new();
    append(value, &mut output);
    output
}

pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}
pub fn js_number(v: &Value) -> f64 {
    match v {
        Value::Null => 0.,
        Value::Bool(b) => {
            if *b {
                1.
            } else {
                0.
            }
        }
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => {
            let s = s.trim();
            if s.is_empty() {
                0.
            } else {
                s.parse().unwrap_or(f64::NAN)
            }
        }
        Value::Array(a) if a.is_empty() => 0.,
        Value::Array(a) if a.len() == 1 => js_number(&a[0]),
        _ => f64::NAN,
    }
}
pub fn region_key_part(value: &str, max_digits: usize, bound: f64) -> bool {
    let digits = value.strip_prefix('-').unwrap_or(value);
    !digits.is_empty()
        && digits.len() <= max_digits
        && digits.bytes().all(|b| b.is_ascii_digit())
        && value
            .parse::<i64>()
            .is_ok_and(|n| (n as f64).abs() <= bound)
}

/// Match the reference runtime's two-argument Math.hypot evaluation order.
/// A one-ULP difference can select a different otherwise-symmetric building site.
pub fn js_hypot(x: f64, y: f64) -> f64 {
    let x = x.abs();
    let y = y.abs();
    if x.is_infinite() || y.is_infinite() {
        return f64::INFINITY;
    }
    if x.is_nan() || y.is_nan() {
        return f64::NAN;
    }
    let maximum = x.max(y);
    if maximum == 0. {
        return 0.;
    }
    let a = x / maximum;
    let b = y / maximum;
    (a * a + b * b).sqrt() * maximum
}
