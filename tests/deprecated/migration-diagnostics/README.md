# Retained migration diagnostics

These are input/configuration files for the older domain-specific diagnostic runners. They contain no stored expected outcomes. Both sides still execute the JavaScript oracle pinned at `ae3350fd53414258ce7a9f94a0fe8315c7dafe29` and the native or shipped-WASM consumer independently.

The canonical manifest is `tests/fixtures/manifest.json`. Its input corpus covers every required public export and fully maps the 125 simulation stimuli into canonical cases. The larger historical spatial, state and planning workflows are retained here or beside their runners until their complete sequence-level behavior is represented by canonical workflows. They remain registered commands in the native coverage plan and must not be deleted merely because representative canonical cases pass.

| Retained input | Runner | Purpose |
| --- | --- | --- |
| `spatial.json` | `scripts/migration/parity.mjs` | Terrain, geometry, routes and discovery sequences |
| `state.json` | `engine/tests/state-parity.mjs` | Identity, memory, story, malformed saves and exact history compaction |
| `engine/tests/simulation-inputs.json` | `engine/tests/simulation-parity.mjs` | Mechanics and resource/action transitions |
| `engine/tests/planning-inputs.json` | `engine/tests/planning-parity.mjs` | 25/300/600 resident planning and retained-cache simulation sequences |
| Source-authored cases | `engine/tests/spatial-contract-parity.mjs` | Spatial public argument and mutation contracts |

No diagnostic JSON output is an oracle or input truth. The canonical result files live under ignored `artifacts/migration/` and bind observations to manifest, stimulus, source, target and collector identities.
