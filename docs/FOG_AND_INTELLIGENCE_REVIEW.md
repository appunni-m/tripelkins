# Exploration and live development context

Engineering notes; historical measurements below predate the current artwork and growth tuning.

25 September 2026. This follows the independent gathering implementation.

## Player experience

The clearing starts visible around the lander. Unexplored ground is covered with dark, soft-edged fog. Every creature reveals ground around it as it moves; healthy scouts still venture beyond the settlement through ordinary instincts. Moving the camera reveals nothing. Discovered ground remains visible, and the player cannot place tools or drag objects into unknown territory. A small “Unexplored” hint explains the mist when the camera leaves known ground. No extra setup or model download is required.

Old saves keep the formerly visible clearing, existing settlements, current residents and retained scout destinations visible. Exact earlier exploration was not stored before this change, so older journeys beyond that evidence cannot be reconstructed. The final story scene retains its existing visibility.

## Persistence and rendering

- `discovery` stores 16-cell masks in at most 2,048 regions. Initial cells are four world units wide. Discoveries are part of normal snapshots, exports and timeline deltas, so a rewind restores the explored map at that moment.
- If the region budget fills, masks merge at half resolution. Earlier discoveries remain known; nearby previously unknown cells may become visible as precision decreases. This is a deliberate bounded-memory tradeoff for a procedural world, not a claim of unlimited exact map history.
- Fog uses one 18×18 filtered texture per visible terrain chunk. Textures and materials are disposed with streamed chunks. Updates follow discovery revisions, rather than regenerating terrain each frame.
- IndexedDB version 9 fences older clients that would discard discovery state. Existing records/stores are preserved. Restoring does not simulate elapsed real time or turn intelligence on automatically.

## Confirmed intelligence gaps and changes

1. **Optional need information:** the former Laya building request put detailed needs after optional descriptions. Token packing could omit it. Current hunger, washing/play pressure, unreachable residents and estimated capacity shortages are mandatory context. Schedules use up to 256 tokens; development uses up to 320. Optional descriptions can be dropped; required state cannot silently disappear.
2. **Facility counts were insufficient:** a distant home or bath could satisfy a global count while the relevant residents lacked service. Care context now checks nearby entrances with the game's navigation and apportions sustainable service estimates across the residents sharing them. The estimates are planning guidance, not a claim of guaranteed throughput. Food stock and actual low needs remain separate facts.
3. **Poor placement:** the longest-distance resident was often a solitary scout. Care sites now score the demand served among nearby residents. The first long simulation exposed remote baths followed by hunger losses; placement by served demand corrected that fixture.
4. **Unreliable model priority:** actual Laya inference sometimes chose timber or industry while care was short. An unserved essential need or widespread low needs now restricts the decision to relevant care facilities, homes/theatres where useful, or waiting. Explicit resource goals retain their existing scope. Personal urgent care always interrupts work. This rule is shared by Laya and Jev rather than being entrusted to prompt wording.
5. **Stale results:** project options and sites are recomputed after inference. A facility already supplied by the player or unrelated expansion during a new care shortage is rejected. Cached schedule identity includes stock, care demand, active development and feasible task counts. Schedules still expand against live members and targets.
6. **Incomplete hosted development context:** Jev/OpenRouter now receive current care plus the actual offered projects, sites, costs/targets and reasons as essential bounded context. Jev context diagnostics correctly identify the provider. Care/growth instructions no longer insist that only the caretaker can supply missing facilities when independence is available.
7. **Omniscient map samples:** context object lists, natural resource samples, worker object targets and development sites respect explored ground. Terrain remains deterministic; the explored-mask data itself is not sent to the model. Only a small area/resolution summary is included.

The model chooses among locally validated projects. It never creates materials, assigns invented coordinates, overrides consent, or replays a historical model response during restore. An orchard or bath is not the only correct response to a shortage: a dwelling supplies both food and washing.

## Verification

Regression coverage includes persistent discovery, negative coordinates, camera-only movement, legacy saves, damaged input, exact history rewind, mask compaction, hidden resources, reachable care capacity, additional facilities, stale results, cache identity and homes as valid care choices. The deployment check page exercises actual Laya workers with missing facilities, insufficient existing food/washing capacity, resource projects and a nine-choice context-budget case. Jev uses transport fixtures; an authenticated paid OpenRouter run is not part of these checks.

The 30-minute simulation uses deterministic project selection, no caretaker tools and a restore at minute 15. It is an execution/restore check, not 30 minutes of model calls. The original story playthrough still reaches the ending. These bounded fixtures do not guarantee survival for every possible player layout.

Final checks on this Mac: 98 automated tests pass. Actual Laya WebGPU and Q8 WASM pass the 12 scheduling scenarios, 12 command cases, three missing-care projects, two insufficient-capacity cases and four resource projects. Both choose dwellings for the extra food/washing cases, physically finish them and incur no deaths. Those decisions took 100–104 ms on WebGPU and 3,556–3,624 ms on WASM. The nine-choice input used 310 of 320 tokens, omitting six optional descriptions while retaining all required state. GPU buffer reuse passes 96 samples. These timings are device-specific.

The final 30-minute execution fixture grew from 24 to 288 inhabitants, with no deaths, a completed bridge, two mines, one factory, four dwellings and 2,015,552 energy. The retained record has 46 objects, 18 inbox entries, 40 activity entries and 35 recent scout destinations; the permanent discovered map is stored separately.
