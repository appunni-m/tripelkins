# Tripelkins systems

## Runtime engine

The live game now uses the [Rust/WASM engine](RUST_ENGINE_MIGRATION.md).
Simulation, planning, goals, story, save validation and history algorithms live in
`engine/src/`. `src/engine/worker.js` owns the world and browser storage adapter;
`query-worker.js` runs read-only Rust planning on snapshots. Rendering, input,
audio and provider transport remain browser adapters. The JavaScript rule files
listed in older subsystem notes below remain the migration reference.


Tripelkins is a static browser application built with Three.js and Vite. No game server is required.

## Simulation and presentation

`src/game/simulation.js` advances needs, multiplication, jobs and progression. Shared geometry, navigation, service reservations and traffic rules keep rendering and movement consistent. `src/game/access.js` detects blocked work and supports practical clearing plans. Terrain is generated deterministically in bounded chunks; discovery masks preserve fog-of-war exploration.

`src/world.js` renders the world. `src/game/art.js` supplies procedural sprites. `src/colony-life.js` coordinates animation and local reactions with the unchanged Web Audio sound engine in `src/creature-voice.js`.

## Intelligence

The planner constructs feasible group schedules. Laya, Jev or a configured OpenRouter model selects a bounded option; the chosen policy is expanded again against current state before assignments apply. Missing resources, care emergencies, player restrictions and blocked paths cannot be overridden by a model response.

Laya runs in dedicated single-thread WASM or WebGPU workers. The worker slider permits one to three concurrent model instances; the decision-speed control affects scheduling frequency. Jev uses OpenRouter's typed Decisions endpoint. The general chat adapter is separate. Long-term goals retain progress and blockers across saves.

## Speech and conversation

Whisper Base English runs locally in a dedicated worker. Voice capture is bounded, supports tap and hold gestures, and never stores raw audio in snapshots. Recognized commands use the chosen intelligence provider. Conversations and activity are bounded and compacted into longer-lived summaries.

## Storage

`src/persistence.js` manages IndexedDB snapshots, earlier moments, the journal and recovery transactions. `src/game/save-schema.js` validates saved state. `src/game/timeline.js` combines snapshots and bounded changes; restoration applies saved state without replaying simulation or model requests.

The Tripelkins database and model-cache names use their own namespace. World schemas and import behavior are unchanged. Existing world exports remain compatible. To carry a colony from a different namespace, export it from that installation and import it in Tripelkins. Browser histories stay in their original database; a world export is not a full database backup.

## Runtime and deployment

GitHub Pages uses `/tripelkins/`. Dev and build commands copy the installed ONNX runtime versions into `public/ort/` and `public/ort-whisper/`. These generated files are excluded from Git and included in the built site. `scripts/deployment-manifest.mjs` checks required files and records sizes and SHA-256 hashes. `scripts/verify-pages.mjs` compares published assets with that manifest.

See the topic documents for implementation detail: context architecture, goals, work/access, independent development, discovery, voice and adaptive expansion.
