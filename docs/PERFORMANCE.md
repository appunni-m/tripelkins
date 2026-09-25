# Performance evidence — 24 September 2026

The later [Intelligence controls](INTELLIGENCE_CONTROLS.md) add optional concurrent
workers. Measurements on this page are for a single worker.

For the ongoing CPU/memory/population optimization and newer measurements, see
[Resource optimization](RESOURCE_OPTIMIZATION.md).

Observed in the Codex in-app browser on the user's Mac, using the app's **Request fresh AI decision** control. The colony had 24 creatures. No decision-cache hits were used in these measurements. Input was 127 tokens. These samples are indicative, not a cross-device guarantee or a task-quality evaluation.

| Backend / phase | Round trip | Model run |
|---|---:|---:|
| Q8 WASM, fresh | 2,387 ms | 2,384 ms |
| FP16 WebGPU, first decision | 1,540 ms | 1,534 ms |
| FP16 WebGPU, warm fresh #1 | 294 ms | 293 ms |
| FP16 WebGPU, warm fresh #2 | 119 ms | 118 ms |
| FP16 WebGPU, warm fresh #3 | 168 ms | 168 ms |

The first GPU call includes pipeline work. The model download and session initialization are additional startup costs. `inferenceMs` measures the awaited ONNX run from the worker, including transfers and synchronization; it is **not** a GPU-kernel-only timestamp. `roundTripMs` also includes worker dispatch and result handling. Context preparation is separately instrumented. Q8 additionally exposes encoder and head elapsed times.

This demonstrates hundreds-of-milliseconds fresh Laya decisions for this scenario on this machine. It does not demonstrate universal sub-100 ms latency, equivalent accuracy across conversions, performance at all 192 simulated creatures, or task-specific intelligence. The displayed decision confidence is not used as evidence of game-task correctness.

## Changes that remove work

- Maximum 192 input tokens instead of the previous 512; compact spatial/needs summaries, invariant option tokens cached.
- Four complete candidate schedules, one model call for every group; no per-creature requests.
- Shared model session in one worker; one inference in flight; no duplicate 500–850 MB model workers.
- Bounded semantic choice cache with visible cache-vs-fresh attribution. Cached policies are expanded against current entities and capacities.
- Dispose inputs, encoder outputs and decision tensors after every run.
- Stream model downloads into CacheStorage without an unbounded JavaScript chunk list. Fixed model cache names; users can remove downloads independently of their world.
- GPU uses the separate FP16 graph, not the Q8 graph's incompatible MatMulNBits operation.
- Shared bounded navigation fields, static sprite textures, limited active simulation, aggregate large populations, coalesced snapshots and compressed history.

## Remaining work for a strict latency SLO

Collect representative small, medium and saturated colony scenarios. Measure cold load, first execution, warmed p50/p95, input shape changes, memory peaks and thermal throttling on target browsers/devices. Evaluate choice quality independently. If every fresh decision must be below 100 ms, train/distill a much smaller game policy; the current generic Laya checkpoints do not provide that guarantee. Additional workers improve concurrency only when compute and memory permit; they do not shorten a single model's dependency chain.
