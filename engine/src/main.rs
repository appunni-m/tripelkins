use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
use tripelkins_engine::Engine;
fn main() {
    let mut engine = None;
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let result = (|| -> Result<Value, String> {
            let input: Value = serde_json::from_str(&line.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            let op = input["operation"].as_str().ok_or("Missing operation")?;
            if op == "load" {
                engine = Some(Engine::from_json(&input["input"].to_string())?);
                return Ok(json!(true));
            }
            let e = engine.as_mut().ok_or("Load a world first")?;
            if op == "__measure" {
                let operation = input["input"]["operation"]
                    .as_str()
                    .ok_or("Missing measured operation")?;
                let args = input["input"]["input"].to_string();
                let start = std::time::Instant::now();
                let output = e.call_json(operation, &args)?;
                let elapsed_ms = start.elapsed().as_secs_f64() * 1000.;
                let value: Value = serde_json::from_str(&output).map_err(|e| e.to_string())?;
                return Ok(json!({"value":value,"elapsedMs":elapsed_ms}));
            }
            serde_json::from_str(&e.call_json(op, &input["input"].to_string())?)
                .map_err(|e| e.to_string())
        })();
        let output = match result {
            Ok(v) => json!({"status":"ok","value":v}),
            Err(e) => json!({"status":"error","message":e}),
        };
        if writeln!(stdout, "{output}")
            .and_then(|()| stdout.flush())
            .is_err()
        {
            break;
        }
    }
}
