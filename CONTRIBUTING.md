# Contributing to Tripelkins

Start with the [project overview](README.md) and [architecture](docs/ARCHITECTURE.md).
This is a browser application written in JavaScript and Rust, not a published
npm library or Rust crate. The internal worker protocol can change with the app;
there is no separately versioned external SDK.

## Before a change

Use [issues](https://github.com/appunni-m/tripelkins/issues) for ordinary bugs,
questions and proposed changes. For a bug, give the steps, expected result,
actual result, browser/device and approximate colony size. State whether Laya,
Jev or built-in instincts were active. A small disposable reproduction is more
useful than a private save. Do not post keys or private transcripts.

Discuss changes to mechanics, save compatibility or model downloads before a
large implementation. The owner has not selected a project license or formal
contribution terms; ask for those terms before offering code or artwork for
redistribution. [Security reports](SECURITY.md) follow a separate route.

## Set up

Follow [Run locally](README.md#run-locally). Node 24, Rust 1.98.1 and wasm-pack
0.15.0 match CI. `npm ci` uses `package-lock.json`; Rust builds use
`engine/Cargo.lock`. Both development and production preparation generate the
WASM bindings, ONNX runtime copies and dependency notices.

`npm run dev -- --host 127.0.0.1` serves only this machine. The unmodified dev and
preview scripts bind `0.0.0.0`, which can expose the development site to your LAN.

## Find the right layer

| Area | Source |
| --- | --- |
| Simulation, needs, births, jobs, resources | `engine/src/simulation.rs`, `jobs.rs`, `resources.rs` |
| Navigation, obstacles, access clearing | `engine/src/navigation.rs`, `geometry.rs`, `access.rs` |
| Goals, groups, context, development | `engine/src/goals.rs`, `context.rs`, `planning.rs`, `development.rs` |
| State and history algorithms | `engine/src/save.rs`, `timeline.rs` |
| State owner and read-only planning worker | `src/engine/worker.js`, `query-worker.js` |
| Worker client and browser storage | `src/engine/client.js`, `storage-client.js`, `src/persistence.js` |
| Rendering, sprites, sound, UI | `src/world.js`, `src/game/art.js`, `src/creature-voice.js`, `src/main.js` |
| Inference and speech adapters | `src/brain.js`, `src/laya/`, `src/providers/jev.js`, `src/voice/` |
| Migration inputs, evidence and generators | `scripts/migration/`, `tests/fixtures/` |

The JavaScript rules under `src/game/` are the migration reference. Editing them
alone does not change the live simulation. Keep the intended behavior and
migration contracts explicit when changing engine rules.

Do not edit `engine/pkg/`, `dist/`, copied runtime directories or generated
notices. Build scripts regenerate them. The favicon source is
[`public/favicon.svg`](public/favicon.svg); the committed ICO and touch PNG are
raster versions of that design. Preserve its expression at 16 and 32 pixels.

## Checks

Run from the repository root:

```sh
npm test
npm run verify:engine
npm run build
npm run preview -- --host 127.0.0.1
```

- `npm test`: Node regressions for game behavior and browser adapters. This does
  not open a browser, download models or prove microphone quality.
- `npm run verify:engine`: inventory audit, native and WASM builds, and canonical
  comparisons with the pinned JavaScript revision. Keep full Git history; the
  source oracle needs that commit. Do not refresh expected behavior to hide a
  discrepancy.
- `npm run build`: compiles the engine if changed, prepares runtimes/notices,
  writes `dist/` and a manifest of shipped bytes.
- In the preview, open `/tripelkins/engine-verify.html` and run disposable
  25/300/600-resident worker checks. Verify the affected UI path as well.
- `/tripelkins/verify.html` includes optional model checks with download consent.
  Speech requires a tester-supplied local recording. Hosted calls require a key
  and can cost credits; they are not part of automatic verification.

For Rust changes, CI-equivalent builds use the pinned toolchain. Additional
checks used by the migration are:

```sh
env RUSTC_WRAPPER= cargo clippy --manifest-path engine/Cargo.toml --all-targets -- -D warnings
rustup component add llvm-tools
node scripts/migration/contracts/coverage.mjs
node scripts/migration/contracts/benchmark.mjs
node scripts/migration/contracts/aggregate.mjs
node scripts/migration/contracts/docs.mjs
```

Coverage and benchmarks are separate, more expensive evidence lanes. The normal
Pages workflow does not run them. Dirty-tree evidence is diagnostic; final
migration evidence must identify a clean implementation. See the
[migration report](docs/RUST_ENGINE_MIGRATION.md) for scope and thresholds.

The `benchmark:*`, `verify:experience`, `verify:community` and
`verify:development` scripts retain JavaScript reference workloads. Use the
worker page and migration benchmarks to assess the shipped Rust engine.

## Submit a reviewable change

Keep one purpose per change. Include the user impact, affected layers, commands
run and any skipped checks. Explain save/schema changes and a recovery path.
Update the relevant guide and [documentation index](docs/README.md) when behavior
changes. Do not include generated model files, local saves, recordings, tokens or
large diagnostic artifacts. Preserve third-party notices.

Pushes to `main` publish through GitHub Actions. Use a branch and pull request
for review; deployment requires the repository's normal write permissions.
See [deployment](docs/DEPLOYMENT.md) for verification and rollback.
