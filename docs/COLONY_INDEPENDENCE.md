# Colony independence, exploration and conversation

Current concurrent-crew behavior, persistence and routing changes are documented in [Local crews and routing review](LOCAL_CREWS_AND_ROUTING_REVIEW.md). The single-project limits below describe the earlier implementation.
Engineering notes; historical measurements below predate the current artwork and growth tuning.

25 September 2026. Follow-up to the experience implementation, addressing crowding, invisible intelligence, tap-to-talk, intrusive messages and independent care building.

## Decisions

1. **Spread and explore.** Rest uses nearby quiet ground rather than two fixed bank centers. A small, healthy scouting group visits reachable unvisited cells, including procedural terrain after landmarks are exhausted. Camps provide a food anchor and needs interrupt excursions. Three or more residents far from care can justify a new local facility. Exploration does not force the entire colony to migrate.
2. **Show real work.** The collapsed Activity panel sits above the tools at bottom right. It shows current task counts, completed work and scouting, followed by a bounded chronological log. Actual Laya/Jev decisions, cached policies, local schedules, conversations and instinctive actions retain distinct sources. It does not invent a model's private reasoning. No inference is forced when only one feasible schedule remains.
3. **Make Talk a tap control too.** A tap starts recording; the next tap sends. A hold of at least 350 ms sends on release. Space retains push-to-talk behavior. Normal pointer capture release does not cancel a latched tap. Cancellation, loss of focus, permission failures and the recording limit still release the microphone. Voice setup and inference remain separate from the gesture.
4. **Move interruptions to an inbox.** Notifications expire after five real seconds, with at least 50 simulation seconds between automatic notices. A backlog produces one notice, while all retained messages remain readable. Reflections follow actual milestones and go directly into the inbox. Incoming translated conversation subtitles last six seconds; the reply remains in history and the inbox. Dismissing a notice never answers a choice. Explicit inbox/options dialogs pause the game.
5. **Require permission to build.** More than 20 residents unlocks a one-time invitation. With intelligence off, the invitation asks the player to enable it; the colony remains playable. With intelligence on, it asks to stand on its own feet. Acceptance permits automatic care facilities only. Permission can be changed in Game options and remains unlocked if population later falls. A declined invitation does not repeatedly interrupt the player.

## Construction and intelligence

`settlementChoices` derives shortages from detailed local residents and distances to existing care; orbital population does not create millions of construction requests. A reachable site must pass terrain, bridge-approach, occupancy and spacing checks. The provider selects one bounded candidate or waits. A maximum of four workers physically gather timber and work around the reserved site. There is one project at a time.

A completed building pays the existing catalog price once through the same `placeBuilding` transaction as player construction. Trees become stumps and supply six real wood; collecting logs transfers their actual stock. No material is prepaid, so cancellation never needs a refund and restore cannot duplicate one. A passing creature delays completion; a new solid obstruction invalidates the site. Missing crews or long-blocked projects are reconsidered. Sick/urgent workers leave work for care. Stop-work, region and active wood/bridge instructions are respected. Turning intelligence or colony initiative off stops the building crew while ordinary care continues.

Construction is a separate, infrequent decision using the same Laya worker or configured Jev/OpenRouter connection. Laya receives concrete facility counts and concise action benefits within a 256-token budget. Hosted context retains independence/consent as essential state and stays within its existing byte allowance. Epoch, command revision, world identity, elapsed simulation time and pause/visibility guards prevent late decisions applying to a changed world.

The first model evaluation exposed a vague WASM prompt choosing to wait despite a missing food source. Explicit facility counts and action benefits corrected all three shortage cases on both runtimes. The first physical construction evaluation exposed a passer-by cancelling a finished bathtub; the reserved footprint and separate solid-obstruction check fix that case.

## Storage and restore

The existing snapshot plus bounded timeline remains authoritative. New branch-local state stores consent, at most one construction project, 64 inbox messages (1,200 characters each), 40 activity records, 64 recently scouted cells and aggregate totals. Timer handles, worker readiness, tokens and browser microphone state are not saved. A restored project waits for intelligence to reconnect. Job/activity normalization uses the shared task catalog, including exploration, maintenance, gathering and construction.

IndexedDB version 6 fences older tabs that cannot preserve these fields. Existing stores and worlds are retained. All changes participate in normal saves, export, restore and rewind. Opening an old snapshot still does not advance offline simulation or heal residents.

## Verification

- `npm test`: 59 checks, including tap/hold transitions, consent gating, construction conservation, physical completion of all three care buildings, interrupted work, stale Jev results, bounded state and restore.
- `npm run verify:community`: 30 simulated minutes with a deterministic project selector and a restore at minute 15. 96 residents, zero deaths, 18 completed buildings; 25 trees supplied 150 wood, of which 148 was spent and 2 remained. Final state: 65 objects, 32 inbox messages, 40 activity records and 64 recent scouting cells. This is a simulation check, not a claim of 30 minutes of model inference.
- Production browser checks: actual Laya WebGPU and WASM each pass the existing 12 schedule fixtures, 12 command fixtures, and three new missing-care construction fixtures. All three selected the missing facility, gathered timber and completed it. WebGPU construction decisions measured 88–91 ms; WASM measured 2,439–2,479 ms in this Mac browser. Device performance varies.
- The caretaker-driven story still reaches the ending in the full playthrough check (22.9 simulated minutes on the final run, with zero losses before the intentional final catastrophe).
- Browser UI review covers the activity panel, inbox, intelligence-off invitation, setup notice, and paused options. Microphone hardware/permission behavior and live transcription quality still require a check on the player's device. Jev's new request and stale-result handling are tested with a fixture API; authenticated live Jev usage requires the player's token.
