# Colony-wide movement pauses — 25 September 2026

## Cause and change

The simulation advanced in 100 ms steps, but every two playing seconds the same
worker also assigned jobs and calculated care coverage and outposts. This stopped
position updates for the whole colony while those synchronous searches ran.
Rendering could remain responsive while every resident stopped moving.

The live worker now delegates that calculation to one dedicated Rust/WASM
snapshot worker. Physical movement and work continue. The authoritative worker
validates and commits the proposal; the rules for resource reservations, care,
collision, goals and individual jobs remain in Rust. Model/context queries have
their own queue, so a model request cannot queue ahead of the automatic scheduler.
This adds one WASM helper, with at most one proposal in flight, independent of
the model-worker slider. See [architecture](ARCHITECTURE.md) for lifecycle and
staleness checks.

## Measurements

Disposable `groundFixture` worlds use actual walking bodies spread across camps,
with births held. Node/WASM measurements sampled 160 simulation steps. In the new
path, proposals were delivered five ticks after their snapshot to exercise work
continuing while planning. Planning and commit timings are separate from movement.

| Residents | Previous maximum synchronous step | New maximum movement step | New maximum plan commit |
| ---: | ---: | ---: | ---: |
| 25 | 38 ms | 12 ms | 0.7 ms |
| 300 | 365 ms | 42 ms | 22 ms |
| 600 | 1,458 ms | 97 ms | 61 ms |

These are local samples, not cross-device latency guarantees. The computational
cost of planning remains; it runs alongside movement rather than inside its tick.

The existing browser worker check also ran each population for twelve playing
seconds with concurrent context queries. It completed useful jobs and passed
pause, export and restore checks in all three cases.

| Residents | 95th percentile position-update gap | Maximum gap | Gaps above 150 ms | Main-thread long tasks |
| ---: | ---: | ---: | ---: | ---: |
| 25 | 107 ms | 110 ms | 0 | 0 |
| 300 | 108 ms | 140 ms | 0 | 0 |
| 600 | 124 ms | 202 ms | 3 | 0 |

The 600-resident run still has occasional brief gaps. This check uses preview
worlds and does not measure IndexedDB autosave latency or model inference under
maximum GPU/CPU contention. Rendering still consumes fixed-rate snapshots; this
change does not introduce position extrapolation or alter movement speed.

## Verification

- Existing JavaScript suite: 198 passed.
- Synchronous engine migration suite: 938 native/WASM comparisons passed.
- Existing browser checks: 25, 300 and 600 residents passed.
- Delayed-proposal diagnostics: all eight proposals accepted per population,
  useful work completed, and stale command/map/stage/age or paused proposals rejected.
- Worker lifecycle diagnostics: one outstanding request; invalidation, serialized
  commits, restoration, retired-worker errors and synchronous fallback checked.
- Clippy and production build passed.

The synchronous migration suite verifies the retained replay entry point. Live
assignment timing can differ because movement now continues while a proposal is
computed; browser and delayed-proposal checks exercise that separate boundary.
