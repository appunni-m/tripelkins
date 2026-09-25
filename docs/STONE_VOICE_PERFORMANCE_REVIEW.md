# Stone progression, speech and surface population review

Measured September 25, 2026. These are disposable fixtures, not a replay of the
player's saved colony. The reported goal was **Brightness in the stone**, with
Laya enabled and independence accepted. The slowdown was around 300 actual
residents spread across the map.

## Stone progression

The visible story objective required the first 300 stone blocks, but the local
planner's default goal was growth. The hosted context omitted the visible story
goal, and optional care expansion competed with the first-block project. Explicit
spoken resource goals already worked; the implicit story milestone was missing.

The first-block milestone is now derived from authoritative stage and peak-block
state, included in required local context and mandatory hosted context, and
represented as a child goal. Optional expansion yields until this milestone is
met. Urgent care and explicit player goals retain precedence. Resource-project
remaining work now follows actual inventory, rather than the construction timer.
Spending blocks after the unlock cannot reopen the milestone.

**Real cached Laya FP16/WebGPU:** 25 residents, medium pace, births held, 300
simulated seconds; simulation waits while inference runs. Laya chose refining at
the start. The project finished at approximately second 157. Workers completed
12 quarry jobs and 30 refining jobs, physically carrying ore and producing 300
blocks. There were 49 actual model calls, 68 schedule reviews, and 23 reviews with
only one distinct schedule. All 25 completed useful work; no route stalls were
recorded. Useful-task occupancy was 29.01%, rest 46.07%, idle 6.29%. Thus this
fix resolves the milestone mismatch; it does not establish that idle time or all
later development choices are optimal. Jev/OpenRouter context contracts are
covered by regression tests; no paid remote inference was performed.

Reproduce with **verify.html → Stone milestone · cached Laya GPU**.

## Speech

The reported `null.feature_extractor` was a setup failure, not microphone silence.
Transformers 4.3.0's generic pipeline discovered optional components at `main`
without passing the requested revision. Its tokenizer loader also discovered
files at `main`. Our model/cache is pinned to a commit. Cached-only restarts could
therefore omit the processor or fail tokenizer setup despite having pinned files.

Whisper now loads tokenizer, processor and model explicitly, validates the
processor before allocating inference sessions, and pins the worker's remote
path template as well as loader options. It cannot report ready without the
required components. Failed assembly releases the model. Background loads still
cannot download missing files. Setup errors survive the recording path and the
normal UI distinguishes recognition failure from quiet speech.

The real download check also exposed a separate incompatibility: Transformers
uses one-byte Range requests for metadata, which the resumable downloader rejected
as unexpected partial weights. Metadata probes now pass through without entering
the model cache or changing a saved checkpoint. Consent is checked first.
Complete model downloads still validate ranges, sizes and ETags before publishing.

**Real cached Whisper Base English/WebGPU:** a generated 3.42-second WAV saying
“Hello little friends. Please keep everyone happy and healthy.” was transcribed
correctly in two fresh workers with downloads disabled. Inference took 882 and
872.5 ms; both returned the expected sentence. The microphone was not opened.
An initial sandboxed speech-synthesis attempt produced a silent 5 ms file; that
invalid fixture was replaced. Verification now rejects short/quiet recordings
before loading models, matching the game's capture threshold.

Reproduce with a chosen local recording and **Whisper cached restart · no download**.
Without a recording this is explicitly an inference smoke check, not an accuracy
test. Live microphone permissions, accents and noise still need device testing.

## 300 actual residents

The previous million/billion workloads retained only 48 walking bodies and used
orbital aggregates. They did not exercise the reported problem. `groundFixture`
now creates 300 or 600 actual residents in separate neighborhoods, with legal
positions, care facilities and procedural terrain. Births are held for comparison.

CPU profiling identified destination-field rebuilding and short route connectors
scanning full 84-unit obstacle neighborhoods. The navigation grid now shares
exact 0.75-unit occupancy cells in bounded 32×32 tiles, invalidated with existing
topology revisions. Short connectors query their local obstacle neighborhood.
No route resolution, movement speed, assignment frequency or inference pace was
reduced. Tile storage is capped at 128 KiB; navigation typed arrays remain under
5 MB. This is not a bound on total JS or GPU memory.

### Same-workload comparison

`node scripts/benchmark-ground.mjs 300`: 100 simulation steps (10 simulated
seconds), three context builds and three development-choice queries, no active
spoken goal and no inference/rendering. The baseline used `aa785e8` navigation
with the same current fixture and other code, via a temporary Node import hook.
Single-run measurements on this machine; not an FPS or GPU-usage claim.

| CPU measurement | Previous navigation | Shared occupancy/local connectors |
| --- | ---: | ---: |
| Total workload | 10,355 ms | 3,196 ms |
| Simulation | 5,520 ms | 1,563 ms |
| Context building | 4,834 ms | 1,632 ms |
| P95 simulation step | 511 ms | 133 ms |
| Maximum simulation step | 1,366 ms | 368 ms |
| Completed tasks | 81 | 81 |

Final simulation-state SHA-256 matched exactly:
`e8fa35364b4d0559519d57d1c2c6bbda26931aa4a25029b6f2b9b566aa9cc356`.
The checksum includes residents, objects, inventory, progression and work activity.
Regression checks also compare occupancy cells against direct geometric tests,
including negative coordinates, construction and procedural terrain.

### Browser result and remaining limitation

`performance.html` now measures real surface populations separately from orbital
aggregates. All five workloads passed work/save/bounded-storage/drawing checks.
These are correctness checks; passing does **not** certify smooth frame pacing.

| Measure | 300 bodies | 600 bodies |
| --- | ---: | ---: |
| Mean rendering CPU | 4.33 ms | 4.33 ms |
| P95 simulation step | 119 ms | 278 ms |
| Maximum simulation step | 320 ms | 975 ms |
| Context build | 307 ms | 697 ms |
| Navigation typed arrays | 4.96 MB | 4.99 MB |
| Save size | 345 KB | 677 KB |

Large synchronous planning bursts remain. Rendering is comparatively cheap in
these fixtures; further frame-pacing work should target planning off the UI
thread or incremental planning with stale-result checks. The current change is
a measured reduction, not a complete elimination of large-colony stutter.

The ONNX execution-provider warning is separate: some operations can execute on
CPU while WebGPU handles others. The official [WebGPU operator table](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md)
explicitly notes this warning for Shape. The warning alone does not identify the
placement of every node or establish a failed inference.
