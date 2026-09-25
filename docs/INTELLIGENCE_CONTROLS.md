# Intelligence pace and workers

Options → Intelligence has two stepped sliders. Defaults preserve the previous
review cadence and one local model copy. They do not enable intelligence or
authorize a model download. Settings are normalized in saved worlds, including
history, restores and exported files.

| Decision speed | Group-plan review | Development review / cooldown |
| --- | --- | --- |
| Slow | 30 seconds | 60 seconds |
| Med (default) | 12 seconds | 30 seconds |
| Fast | 6 seconds | 15 seconds |
| Extra fast | 3 seconds | 8 seconds |

Intervals use playing time; Options, pause and hidden tabs stop the game clock.
Messages receive the next free slot without waiting for a scheduled review.
Urgent replans can happen sooner. Existing projects, missing consent, unavailable
choices, caches and occupied workers can skip automatic inference. The choice
cache expires at the selected group-plan interval so it cannot mask faster reviews.
Speed changes neither simulation speed nor the duration of an individual inference.

## Concurrency

The worker slider ranges from **1 to 3**, covering the three independent kinds of
work: a colony schedule, a development choice, and a conversation. Each kind has
at most one request in flight. Duplicate background jobs are skipped, not queued;
their cadence is not advanced while capacity is occupied. One waiting conversation
has priority over new background work. There is no unbounded queue or per-creature
model fan-out.

- **Laya:** each slot is a dedicated Web Worker with its own WebGPU session or
  single-thread WASM sessions. The first copy follows the existing download review.
  Additional copies initialize only when independent work overlaps and can only
  read already-cached model files. An unavailable cache fails rather than silently
  downloading additional weights. Cached files are shared; inference memory is not.
- **Jev / OpenRouter:** the same slider caps concurrent model requests. It does
  not provision extra local model copies or promise reserved provider capacity.
  Faster cadence can increase credits spent; concurrent calls can encounter rate
  limits. Idle capacity sends nothing.
- Reducing the limit removes idle extra copies immediately. In-flight work drains
  before its copy is removed, and new requests respect the reduced limit.
- A failed additional local worker reduces concurrency to one when a healthy copy
  remains. Options explains the failure; changing the worker count permits a retry.
  Worker crash/load failure/timeout removes the affected copy.
- Stop, provider change, world restore and background release terminate all local
  copies and cancel all hosted activity controllers. Epoch/revision checks discard
  late results; plans and construction are still revalidated against live state.

## Resource explanation

The options show approximate **weight storage per loaded model copy**: 846 MB for
FP16 GPU or 524 MB for Q8 CPU, multiplied by the selected count. These are not total
process-memory estimates: activations, ONNX/WASM host memory, GPU pipelines/driver,
the game and optional Whisper add overhead. Three GPU copies imply about 2.54 GB
of model weights alone. The existing measured GPU-buffer evidence is in
[Resource optimization](RESOURCE_OPTIMIZATION.md); it is not a measurement of
this new concurrent pool. More copies can compete for the same hardware and do
not guarantee higher throughput. One remains the default for memory and battery.

The live status in Intelligence options reports active decisions and loaded/local
copies. These details stay out of the playfield.
