# Feature and recovery review — 24 September 2026

Storage, rewind, command lifecycle and model-context details have since been revised; see [the current architecture review](CONTEXT_ARCHITECTURE.md). Earlier verification claims below apply to their recorded implementation.

## Evidence and scope

This is a source review of the implemented game, with inspection of the affected local colony through the journal and Saved worlds UI. The production bundle compiles. Automated gameplay regression tests were not added or run: that permission is still pending. No saved world was restored, reset or given care during this investigation.

The previous deployment report covers actual Pages downloads and Laya/Whisper inference, including cached restarts. Those checks do **not** establish correctness of save migration, long-term survival or the entire progression loop.

## Reported loss: evidence and cause

- The current journal records migration followed by 24 deaths during the first minute, with several banana placements.
- Recovery preview of the original prototype shows 24 living creatures, lowest food 0%, cleanliness 0%, play 99%, and an orchard. There is no bath in that converted world.
- Schema 1 stores shared needs. Migration copies those values to each individual. In the current simulation, any need at zero advances a neglect timer; after 28 seconds, the creature dies. Bananas alone cannot resolve zero cleanliness.
- This explains the observed first-minute collapse. It does not prove which recovery button the player used or why the older game originally saved zero needs.
- The prior recovery menu showed neither needs nor save age. Imports also resumed immediately, and five-second autosaves rapidly replaced the only previous snapshot.

### Changes

- Recovery now lists named saves with timestamps, population, lowest needs, care buildings and a warning for empty or endangered colonies.
- Restore, prototype migration and imports open paused. Loading an endangered active world also pauses it. No offline time is simulated.
- Normal restore retains the saved needs and neglect timer. The separate **Restore with fresh care** choice explicitly raises needs to at least 70%, resets the timer and records that intervention in the journal. It does not revive already dead individuals.
- The selected source is retained, together with the outgoing world; the original prototype archive is preserved.
- World replacement uses one IndexedDB transaction, waits for pending autosaves, blocks concurrent UI changes, and changes the displayed world only after commit. A failed write leaves the current world in place.
- Retention is bounded: eight minute checkpoints, active/previous/archived/source snapshots, a last healthy colony (all represented needs at least 35%), and the original prototype. Paused autosaves do not rotate checkpoints. Checkpoints use wall-clock minutes while gameplay changes; they are not an unlimited history.
- Missing or invalid creature needs reject a damaged import instead of becoming zero. Excess valid individuals join the numerical cohort; a legacy population of zero stays zero. Pollution is bounded to the simulation's existing 0–1000 range.
- The clearing now shows urgent care instructions before deaths, ahead of an ordinary goal hint.

## White flash

No intentional full-page white effect exists. It was not reproduced during this review and the inspected browser console had no rendering errors.

Confirmed code paths that can produce visual interruptions were addressed:

- Critical HTML background now matches the clearing before JavaScript, styles and fonts finish loading.
- Runtime preparation skips unchanged files. Previously every build rewrote public runtime assets watched by the local Vite server, allowing unnecessary full page reloads.
- Canvas resize ignores duplicate/zero sizes and immediately renders after changing the drawing buffer.
- Hot-update teardown cancels the animation frame, clears feedback timers and removes/disposes the renderer canvas and auxiliary materials.
- A lost graphics context pauses simulation; a restored context redraws without resuming unattended gameplay.

These are mitigations for identified interruption paths, not evidence that a particular one caused every reported flash.

## Feature inventory and review

| Area                              | Present behavior                                                                            | Review result / limits                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First visit, lander, care            | Welcome, hatch, bananas, cloth, cricketball, individual needs and replication                      | Source reviewed. New urgent-care hint and explicit recovery care address silent collapse. Balls expire after 200 simulation seconds; their lifetime is not currently shown. |
| Pause and options                 | Game/Controls/Saved worlds/Advanced, modal and hidden-tab pause, saved camera/tool/mute     | Source reviewed; recovery UI inspected. Options freeze simulation and animation time. No offline catch-up.                                                                                                                                                |
| Movement and group jobs           | Flow fields, capacity limits, five complete candidate schedules                             | Fixed scheduler selection of facilities with no usable path; urgent care may interrupt hauling. Navigation geometry can remain cached until the next simulation second. New scheduling changes still need regression and performance checks.              |
| Construction and bridge           | Bath, orchard, roundabout, dwellings, hauling logs/bones, 24-unit bridge, monolith          | Source reviewed. Unlocks, costs, occupancy and river rules exist. Legacy migration recreates positions and caps each building type at eight; it cannot reproduce the old layout exactly.                                                                  |
| Industry and tools                | Mine/node stock, ore, factories, blocks, pollution/mop, upgrades, axe/hammer/chainsaw/grabber | Source reviewed. Object cap paths need further work: a full world can reject a dropped resource while a tool action still reports success. No full economy playthrough this session.                                                                      |
| Moral choices and ending          | Bug/swarm confirmations, choice history, TNT, cannon, hole/uplinks and authored ending      | Source reviewed only. Commercial maps, assets and cinematics are not reproduced. No end-to-end late-game playthrough this session.                                                                                                                        |
| Large populations                 | Up to 192 individual creatures, numerical cohort, bounded object/event caches               | Arrays are bounded. **Open defect:** deaths can empty individual slots without promoting cohort members, leaving a nonzero population without active workers. Requires a defined cohort health/promotion rule and survival regressions.                   |
| Persistent goals                  | Care/grow/bridge/wood/ore/blocks, queue, pause/resume/cancel, milestones and blockers         | Source reviewed. Models select one supported goal; unsupported physical actions are not executed. Goals survive save/restore.                                                                                                                             |
| Laya                              | Worker inference, GPU/WASM fallback, selected policy expanded into live per-creature jobs   | Source reviewed. Fixed command context captured before a potentially long model load. Fresh latency is hardware dependent and not guaranteed to be milliseconds. Runtime/download execution was checked in the deployment task, not rerun here.           |
| OpenRouter / Jev                  | Configured endpoint/model, tab-only key, structured validated replies                       | Source reviewed. Restoring a different endpoint clears the current key. No authenticated hosted request was made in this review.                                                                                                                          |
| Voice and conversation            | Whisper Tiny, hold Space/pointer, subtitles, cancellation, wordless synthesized replies     | Source reviewed. Existing browser inference evidence is in DEPLOYMENT. Real microphone permission/audio and subjective chirp quality were not exercised here.                                                                                             |
| Persistence and history           | IndexedDB, bounded journal/counters/jobs/goals/conversations, import/export, quota handling | Recovery fixes above. Browser quota and eviction can still prevent persistence; downloads remain the portable backup. Multiple game tabs are not coordinated by a world-ownership lock.                                                                   |
| Rendering and responsive controls | Orthographic Three.js, pixel sprites, pan/zoom, tool ghosts, creature inspector             | Source reviewed; actual local recovery UI inspected. Flash mitigations above. No multi-device visual matrix this session.                                                                                                                                 |
| Pages delivery                    | Repository base URL, same-origin runtime files, verification page, Actions deployment       | Production build succeeds. Prior live checks cover asset hashes and real model execution. CI deployment result should be checked after pushing these changes.                                                                                             |

## Remaining work, in priority order

1. Define and implement coherent cohort health and promotion after individual deaths. Avoid silently generating healthy replacement creatures.
2. Add isolated regression coverage for zero-need prototype migration; normal/fresh-care restore; failed transactions; import cancellation; checkpoint retention during pause; blocked paths; care-before-hauling; group-plan completeness and goal persistence. Use a separate database and synthetic worlds.
3. Handle object-cap failures before consuming resources or reporting a successful action; expose expiring toys and inadequate facility capacity to players.
4. Coordinate ownership across multiple tabs to prevent older snapshots overwriting newer play.
5. Exercise full progression, population extremes, real microphone use, authenticated OpenRouter and supported mobile browsers. Measure new path selection at the maximum represented population.

## Recovering this colony

Open **Options → Saved worlds → Restore an earlier world**. The **Original prototype** entry contains the 24 living Tripelkins. **Restore with fresh care** offers a transparent recovery from its zero food/cleanliness. It opens paused. Before extended play, add sufficient food, baths or regular cloth care, and play facilities. The original prototype remains available.
