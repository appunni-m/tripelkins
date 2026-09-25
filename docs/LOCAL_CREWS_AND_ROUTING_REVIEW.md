# Local crews and routing review

25 September 2026. Follow-up to the report that a large colony appeared mostly idle despite enabled intelligence and accepted independence.

## Reproductions and causes

| Problem | Evidence | Change |
| --- | --- | --- |
| Useful resource work could not scale | The executor admitted only one development project with four members. Other residents were forbidden to quarry, gather or refine for it. More model calls could not change eligibility. | Several bounded, disjoint local crews can share a resource goal or build separate facilities. |
| Stone production repeatedly stopped and restarted | Any ore in inventory switched the whole block crew to refining; only residents with an ore reservation could actually refine. | Refiners and quarry workers operate together. Loose/carried ore and pending quarry reservations prevent unnecessary input production. |
| An explicit block goal stopped at 240/300 | The industrial schedule omitted hauling. Enough loose ore remained for the goal, so quarrying correctly stopped but the refining crew never collected that final input. | Refining crews explicitly collect loose ore under every schedule; a regression requires actual completion of all 300 blocks. |
| A distant bridge journey was abandoned | Mining from `(25,-55)` to `(55,-55)` via the bridge at `(42,25)` produced no ore in the original 180-second reproduction. The detour exceeded the destination search radius, appeared to move away from the goal and had an underestimated deadline. | The search radius applies to new jobs. Committed jobs survive detours; bridge length contributes to the estimate and forward progress along a route leg counts as progress. |
| Industrial progression disappeared from model context | After the first 300 blocks, the model mainly chose care expansion. The next visible energy objective was absent from its current milestone. | Both providers receive the industrial objective. Mines/workshops and building-material reserves can precede optional care expansion; urgent care and explicit player orders retain priority. |
| Workshop construction could starve | New small buildings consumed each incoming batch of wood before an older workshop accumulated its higher cost. | Pending buildings reserve materials in creation order, including at final completion. |
| Early development reviews could not assign work | The main loop supported event-triggered reviews, but the candidate generator still imposed the full 30-second interval on Medium. | Candidate eligibility uses the existing event-review minimum. Speed settings still determine the review cadence. |

The initial 300-resident, 90-second **rule reference** measured 4.22% literal idle time, 30.23% rest, and only 0.83% quarry/refine/haul activity combined. It produced 70 blocks. Scouting accounted for most of the work classified as useful. This supports the complaint about limited productive work; it does not establish that 90% of residents had no assignment.

## Execution and limits

- The original `community.project` slot remains readable. `community.projects` stores additional active crews. Capacity is one project per 12 surface residents, up to 24 projects. This is a bounded work queue, not a population cap.
- Building/bridge crews have up to four workers. Resource crews use local population to choose up to 16 workers. Crew members come from within 32 ground units, respect consent/directives and cannot belong to two projects. Ongoing useful work is retained.
- A resource option explicitly lists up to eight local camps, scaled by population and actual remaining demand. One model choice can mobilize those camps. The local executor validates every camp and gives every resident an individual reservation. Quarry input reservations are spread across crews.
- Processing positions include the project ID in their reservation keys. Ore, service slots and physical resources remain shared reservations across the whole schedule.
- Pending buildings reserve their block budget for admission of additional projects; completion still spends materials once through the existing construction transaction. The timber planning target includes timber needed by pending buildings.
- Saves, timeline restore, blocked-work requests, meteor damage, construction ghosts, child goals, hosted context and the thought log all identify the individual project. Destroying/cancelling one project preserves others.
- IndexedDB version 11 fences older tabs that would discard extra crews. Existing stores and colony records remain intact. Restored development waits for intelligence readiness.
- The thought log shows each crew's location, membership count, progress and blocker. Laya keeps its 320-token budget; hosted contexts keep their 16,000-byte budget. Detailed per-resident schedules execute locally.

## Verification

The regression suite includes real bridge traversal and completed mining, concurrent local assignments, shared ore reservations, parallel building budgets, snapshot/timeline restore, revoked independence, meteor damage, both model contexts, continuing industrial goals and event-triggered review eligibility.

The browser audit runs a disposable fixed colony of 300 actual surface residents across ten neighborhoods. It uses cached Laya FP16 WebGPU weights with downloads disabled, real provider responses and the production scheduler/simulation. It does not read the player's save. Model inference is awaited between simulated steps; this is a behavior audit rather than a rendering or wall-clock concurrency benchmark. The existing provider fixtures cover Jev's contract; no paid live Jev request is part of this review.

The local search remains bounded. These fixes preserve jobs through valid bridge detours; they do not introduce an unbounded world-sized path grid. Narrow collision gaps, sealed layouts and missing bridges still need clearance or another reachable site. Rest, care and waiting for material capacity remain real outcomes and are reported separately from productive work.

### Final results

- `npm test`: 145 tests pass (132 previous tests and 13 new crew/routing/contract regressions).
- Production build: passes; 37 checked assets in the deployment manifest. The existing Three.js chunk-size advisory remains.
- Cached Laya WebGPU regressions: 12 behavior scenarios, 12 command cases, three care-building completions, two care-pressure cases and four resource/crossing completions pass. The explicit block goal finishes at 300 blocks in 71 simulated seconds. The existing 96-inference GPU-buffer check also passes.
- Six simulated minutes with real Laya, 300 fixed surface residents: **106 actual model calls**, all 89 schedule applications accepted, 29 development selections started and none rejected. Every resident completed at least one useful activity, including scouting.
- Physical work completed: 15 quarry actions, 30 hand-refining actions, 140 mining actions, 15 workshop production actions, 65 timber actions and 33 hauling actions. Construction finished ten mines and one workshop; 28 crew projects completed. Energy reached **368,940**. Population remained 300 and the lowest needs stayed above 71 at the end.
- At the last sample: 25 mining, three hauling, ten building, one gathering, two producing at a workshop, 14 scouting, two between assignments, and 222 resting. No residents remained within ten units of the original center. Literal idle occupancy averaged 4.49%; **rest still averaged 52.81%**. This is not a claim of full employment: the fixture starts with no workplaces, and production capacity takes real materials and time to build.
- The large run recorded 38 stalled journeys across the six minutes. The specific distant-bridge regression finishes with zero stalls. General crowd congestion and every possible player layout are not proven solved by this bounded audit.
- A 300-body navigation workload retained its 192-field bound, approximately 4.97 MB of tracked navigation arrays. No rendering smoothness improvement is claimed here; the main-thread planning spikes documented in the earlier performance review remain relevant.

The earlier exploratory runs in this review were used to expose failures and adjust the implementation. In particular, reaching the first 300 blocks alone was insufficient: the final browser check also requires an actual completed workshop production action.
