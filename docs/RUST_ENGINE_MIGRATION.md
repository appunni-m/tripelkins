# Rust engine migration

## Boundary

The requested target is the full simulation and planning engine in Rust/WASM,
owned by a dedicated module Web Worker. This is a migration of the current game,
not a redesign. Reference revision: `ae3350fd53414258ce7a9f94a0fe8315c7dafe29`.

One worker owns world state and advances the fixed 100 ms simulation clock.
A second Rust/WASM worker evaluates read-only planning queries against snapshots,
so a large candidate search cannot stop the simulation clock. Its queue is
bounded to eight requests and is discarded on restore. Decision recording and
all commits remain on the authoritative worker.
Rendering, camera/input, DOM, and Web Audio remain browser presentation adapters.
Laya inference and speech retain their model workers; Jev retains its network
adapter. They receive bounded context from the engine and return a choice tagged
with the world generation and command revision. Only the engine can apply it.

## Required engine domains

- Seeded terrain, discovery/fog, bridge surfaces, collision and navigation.
- Needs, movement, growth, identity, deaths, resources and industry.
- Every player tool, placement, upgrades, destruction and launcher arrivals.
- Scheduling, commitments, reservations, fairness, traffic and access clearing.
- Goals/subgoals, local project crews, outpost economics, density and planning.
- Candidate generation, rewards, context budgets and model-choice validation.
- Story/evidence, inbox, consent, conversations and bounded history.
- Save validation/migration, snapshots, timelines and restore semantics.

## Browser contract

Commands have a protocol version, request ID and world generation. Invalid or
stale commands cannot overwrite a restored world. Pause and visibility suspend
simulation time; there is no offline catch-up. A single writer preserves the
existing IndexedDB conflict protections. Snapshot and restore operations are
ordered with simulation commands. Credentials never enter saved state.

Quota or IndexedDB failures preserve the live world for export and retry. A
conflicting writer pauses this tab. Closing a browser cannot guarantee an
uncompleted asynchronous write: the most recent completed five-second autosave
and retained timeline are the recovery boundary.

The renderer receives bounded snapshots and keeps its existing movement animation. There is at most one pending presentation
snapshot, so a slow tab cannot accumulate an unbounded message queue. A worker
failure must stop advancement and present a recoverable error, not silently
restart the colony.

The JSON boundary preserves JavaScript numeric comparisons for revisions and
numeric project/access IDs. Context and timeline byte accounting use the
ECMAScript number formatter from `ryu-js` 1.0.3, with no optional features, to
preserve exponent formatting as well as ordinary integer values. The crate's
Rust 1.71 minimum is below the pinned 1.98.1 toolchain.

Strings at this boundary must be well-formed Unicode. Lone UTF-16 surrogate
code units are not representable in Rust strings. A description cutoff that
would split a surrogate pair keeps the last complete character instead. This
edge is explicitly outside the compatibility claim.

## Verification and rollout

The JavaScript reference is executed live from its pinned revision against the
same input-only workflows as native Rust and WASM. Compare resource accounting,
assignments, movement, decisions, state transitions, events and save round trips.
Measure actual 25/300/600 walking residents in expanded terrain, including both
cold navigation and warm operation. Measure tail frame/input latency separately
from worker throughput. A busy worker is not proof of a smooth frame loop.

Production cutover requires complete engine coverage, browser parity, pause/
restore/stale-response checks, and GitHub Pages worker/WASM asset verification.
During implementation the existing game remains the runnable reference. Do not
claim completion or deploy a partial substitute.

The inventory discovers 285 exports in the relevant source modules: 282 engine
exports and three retained presentation functions (`project`, `unproject`, and
`terrainChunk`). The latter are explicitly listed by the inventory command;
they are outside the engine denominator, not reported as ported or tested Rust.

Canonical workflows use fresh source and target processes. During development,
one run with shared reference modules returned route cost 21 where the same
reference inputs returned 24 on subsequent runs; the Rust output and complete
world observations were identical between runs. Fifteen repeated prefix runs,
100 isolated calls, and eight source-only sequences did not reproduce it.
The cause of that rare reference variation was not established. Process
isolation prevents prior workflows' caches and optimization state from affecting
canonical results; no observations were dropped or numeric tolerances widened.

The coverage collector evaluates 44 component plans using one instrumented
execution when their selectors match. Its summary counts that execution once.
Function, line and region thresholds remain 80%, 70% and 65% respectively;
branch counts are reported only where LLVM supplies them. WASM source coverage
is unavailable, so native coverage is not presented as WASM coverage.

Profiling identified repeated colony-wide benefit calculations inside the
building-site sort and repeated JSON coordinate reads during scheduling. The
Rust engine computes each sort key once and keeps typed positions only within a
read-only scheduling call, preserving evaluation order and cache invalidation.

## Profile before migration

On this development machine, the existing browser performance page's 300-body
spread workload measured 4.6 ms mean render CPU, 175 ms p95 frame CPU and 362 ms
maximum simulation step. Context preparation took 319 ms. These device-specific
figures include browser overhead; they identify blocking engine work, not a GPU
utilization claim. The full deterministic Node workload separately measured
3947 ms over ten simulation seconds with 81 completions.

A lazy navigation experiment retained the exact deterministic state digest but
still had a 440 ms maximum step. It was removed from the production source before
starting the port; reducing one kernel did not solve main-thread isolation.

## Sources

- [WASM in a worker](https://wasm-bindgen.github.io/wasm-bindgen/examples/wasm-in-web-worker.html)
- [serde_json](https://docs.rs/serde_json/latest/serde_json/)
- [wasm-bindgen](https://docs.rs/wasm-bindgen/latest/wasm_bindgen/)
- [ECMAScript number formatter, ryu-js 1.0.3](https://crates.io/crates/ryu-js/1.0.3)

## Browser measurements on the verified build

Measured on an Apple M3 Pro (18 GiB), macOS/Darwin 24.6.0, in the Codex browser.
Each disposable expanded-map fixture walked for 12.1 simulated seconds while
context queries ran on the separate planning worker. These are local measurements,
not a performance guarantee for other devices.

| Residents | p95 frame work | p95 frame gap | Maximum gap | Main-thread long tasks | Wall time for 12.1 s simulation |
|---:|---:|---:|---:|---:|---:|
| 25 | 3.7 ms | 10.2 ms | 23.9 ms | 0 | 12.05 s |
| 300 | 4.6 ms | 10.2 ms | 19.9 ms | 0 | 12.39 s |
| 600 | 4.4 ms | 10.2 ms | 27.3 ms | 0 | 14.92 s |

All three fixtures passed pause, restore, resident-count and useful-work checks.
The 600-resident simulation still ran slower than real time; rendering remained
responsive. Further throughput optimization can be made independently of the UI.
A real IndexedDB save also reloaded and restored through the game's options with
its custom name, inventory and needs preserved; restoring left it paused.

The local production HTTP preview verified all 45 shipped files, including both
worker entries and the engine WASM, against their SHA-256 hashes and MIME types.
Inference adapters and microphone capture remain browser integrations. This
migration verifies their scheduling/revision boundaries; it does not establish
new live-model accuracy or microphone-quality measurements.

## Verification record

The clean code snapshot `bb1e91f` passed 198/198 JavaScript regressions,
938/938 canonical comparisons across native and WASM, and 3,934/3,934 checks
during LLVM collection. All 132/132 component thresholds and 20/20 performance
budgets passed. The generated evidence page records immutable binary/consumer
digests, run IDs, coverage counts, and the exact manifest identity.

The static contract audit reports 282/282 engine exports, 292/292 parity
requirement mappings, 282/282 coverage mappings and 10/10 benchmark mappings.
The retained diagnostic suites remain available; no old evidence was substituted
for live comparisons.
