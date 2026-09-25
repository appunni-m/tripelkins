# Independent gathering and development

Current concurrent-crew behavior, persistence and routing changes are documented in [Local crews and routing review](LOCAL_CREWS_AND_ROUTING_REVIEW.md). The single-project limits below describe the earlier implementation.
Engineering notes; historical measurements below predate the current artwork and growth tuning.

25 September 2026. The first independence implementation only gathered timber for a pending banana tree, bath or roundabout. Breaking rocks, making the first blocks and placing workplaces still depended on caretaker tools. This follow-up closes those gaps.

## What the player sees

After the invitation above 20 residents, enable intelligence and accept **Colony independence** in Options. The colony can choose timber reserves, quarrying, hand processing of ore, supplying the crossing, and useful construction. The Activity panel shows the actual crew's current jobs and project progress. “Cut trees”, “gather wood”, “break stone” and existing ore/block goals use the same command pipeline. Stop-work, named groups, region restrictions and care still apply.

The independent building list is banana groves, baths, roundabouts, mines, factories, dwellings and theatres. Mines require a real, stocked node; catalog unlocks and prices apply. Destructive tools, TNT, orbital construction and story decisions remain player actions.

## Timber balance

Later buildings use timber for frames and stone blocks for the structure. Early care costs and the six-wood tree yield stay the same.

| Building | Wood | Blocks |
| --- | ---: | ---: |
| Mine | 12 | 25 |
| Cottage | 18 | 100 |
| Stone workshop | 24 | 150 |
| Clubhouse | 36 | 500 |

The reserve target is the largest of 24 wood, twice the most expensive unlocked independent building's timber cost, and six wood per eight ground residents (the population contribution is capped at 144). Refill starts below half that target, with enough for one unlocked building as the minimum. The crew continues to its target, avoiding repeated tiny gathering trips. These are planning targets; they do not prevent spending wood on care or construction.

Reserve projects are available during ordinary play and active growth/care goals. They rank ahead of optional expansion when wood is low. Bridge construction and the first block-making project gather their own inputs, so a spare wood pile cannot postpone those economic milestones. Urgent care still takes precedence, and explicit wood/ore/block/bridge orders retain their own resource target. Consent, intelligence readiness, stop-work, route access and scope restrictions continue to apply. The reserve is derived from current state, so restored colonies need no new saved ledger.

The toolbar, insufficient-material message, completion activity, Laya prompt and Jev context use both building costs. Both providers receive current timber stock, refill threshold and target; wood and block changes also invalidate cached schedule context. Existing buildings incur no retroactive charge.

### Current balance verification

- All 104 existing regression tests pass, including construction charges, timber gathering, permissions and restore.
- The real cached Laya FP16 WebGPU worker passes 12 schedule scenarios, 12 commands, three construction cases, two care-pressure cases, four resource-development cases, the nine-choice/320-token budget check and 96 GPU buffer iterations. Jev's existing fixture transport checks pass; no live account request was made.
- The existing 30-minute deterministic development script **fails its bridge assertion both before and after this patch**. The unchanged baseline (`c70bf89`) and final balance patch both finish with 698 residents, zero deaths, 12 wood, zero blocks/ore, 14 groves, nine showers, four gardens and 20 completed projects. Repeated care construction starves the crossing and later industry in that fixture. This remains an existing progression limitation; the historical successful long-run result below must not be treated as current verification.
- An initial reserve-priority experiment delayed the crossing further. The final rule defers reserve-only work while the crossing or first block-making option is available, restoring the baseline long-run result. No failing assertion was removed or weakened.

## Execution and accounting

- Laya/Jev selects a listed project or waits. The local scheduler expands it into work for at most four crew members, with reachable positions, individual needs and reserved stock/slots. There is one development project at a time.
- Trees become stumps and yield six wood. Workers can collect existing logs too. Rocks become piles of three ore, then are collected. Hand processing consumes one stored ore for ten blocks and ten energy, matching the caretaker hammer economy. Factories retain their existing ore costs, output and pollution.
- Shared inventory is abstract storage. Workers visit bridge/factory service positions to supply up to three stored units per action. Loose materials and mine output retain the existing cargo/delivery paths. No material is created by selecting a project or building candidate.
- Construction consumes the catalog price once, on completion. Partial work and gathered resources survive interruptions and restore. Cancelling a project does not consume its materials. Turning off consent, initiative or intelligence stops the new development jobs.
- Care shortages are ranked by current pressure as well as facility counts. Future capacity additions cannot endlessly outrank an otherwise healthy colony's crossing and industrial expansion. Factories choose locations near mines; homes and other useful buildings prefer workplaces or resident clusters. Reachable entrances are checked. Care facilities can still serve outlying groups.

The long run initially exposed factories following distant scouts, producing very long commutes while ore accumulated. Workplace anchors correct this. A second issue was a fixed 1.5-tile placement exclusion rejecting physically clear housing entrances; construction now uses the existing footprint/body clearance consistently.

## Persistence and model context

Existing snapshots and the bounded timeline store the active project's type, numeric resource target, crew, site, source and progress. New quarry/refine jobs use the shared task catalog for save normalization, history, animation, sounds and scheduling. No unbounded work queue is added. Resource discovery materializes only a few reachable procedural objects within the existing map/object limits.

IndexedDB version 8 fences clients that would discard these fields. It preserves existing stores and records. Restored work waits for intelligence readiness; there is no offline simulation.

Laya's project prompt is bounded to 320 tokens with up to eight feasible candidates plus waiting. Required context includes population, care counts, permission and the active player goal. Jev receives the same project choices and the existing bounded hosted context. Late results still pass world identity, epoch, command revision, readiness and pause checks. A real OpenRouter account evaluation remains separate from the fixture transport checks.

## Verification

- `npm test`: 87 tests pass, including eleven new checks for independent timber/stone/blocks, bridge supply, real building costs, factory delivery, consent/readiness, interrupted goals, save/timeline restoration, model context and workplace placement.
- `npm run verify:development`: 30 simulated minutes, no caretaker tools, deterministic project selection, restore at minute 15. Population grows from 24 to 192 with zero deaths. The bridge completes; two mines, one factory and two homes are built; energy reaches 2,212,140. Retained state: 52 objects, 16 inbox messages, 40 activity entries and 64 scouting cells. This measures execution over time, not 30 minutes of model decisions.
- Actual Laya WebGPU and WASM workers choose and complete all four development fixtures, alongside the three care-building cases, twelve schedule fixtures and twelve command fixtures. GPU development decisions measured about 84–124 ms and WASM about 2.5–2.7 seconds on this Mac browser. Timings vary by device. GPU buffer reuse checks also pass.
- The caretaker playthrough still reaches the story ending with no losses before the deliberate final catastrophe. The production build succeeds with its 26-asset deployment manifest.

These checks establish the bounded scenarios above; they do not guarantee zero losses for every player layout or validate live Jev billing/model quality.

The subsequent [fog and intelligence review](FOG_AND_INTELLIGENCE_REVIEW.md) updates discovery persistence, nearby care-capacity planning, context freshness and the shared care-first candidate rules. Its verification results supersede the corresponding earlier measurements above.
