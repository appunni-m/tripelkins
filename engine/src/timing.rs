//! Monotonic diagnostic timing, excluded from deterministic gameplay decisions.
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace=performance,js_name=now)]
    fn performance_now() -> f64;
}
#[cfg(target_arch = "wasm32")]
fn real_now() -> f64 {
    performance_now()
}
#[cfg(not(target_arch = "wasm32"))]
fn real_now() -> f64 {
    static START: std::sync::LazyLock<std::time::Instant> =
        std::sync::LazyLock::new(std::time::Instant::now);
    START.elapsed().as_secs_f64() * 1000.
}

thread_local! { static FIXED:std::cell::Cell<Option<f64>>=const {std::cell::Cell::new(None)}; }
/// Deterministic clock input used by the cross-runtime replay harness.
pub(crate) fn set_fixed(value: Option<f64>) {
    FIXED.set(value);
}
pub(crate) fn now() -> f64 {
    FIXED.get().unwrap_or_else(real_now)
}
