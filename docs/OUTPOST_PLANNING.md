# Local work and outpost planning

25 September 2026. Follow-up to local resource work stopping and the need for useful outposts as the explored map grows.

## Confirmed faults

- A refining crew counted every loose ore pile in the world as available input. Adding 30 ore at `(-180,-180)` changed a local plan from eight quarry workers to zero quarry workers and zero haulers. The crew could not reach the pile. Input accounting now counts explored ore reachable from that crew, within its local work area. Ore across a missing bridge also fails this check.
- Existing workshops could take the inputs needed by crews making construction blocks. A bounded input batch is now reserved for hand processing; physical workshop deliveries can use the surplus. Refining crews collect their loose ore into the shared inventory, and miners replenish the processing reserve before carrying surplus ore to workshops.
- Building demand was calculated from residents available to build. Busy residents were omitted. Demand now includes busy residents and their work locations, while builders are recruited separately.
- Resource camps were selected by worker order without checking their sources. Proposed crews now consider discovered, reachable trees/stone near outstanding construction. Both proposal and materialization use a 32-unit source radius. Work rotation still breaks ties and crew memberships remain disjoint.
- Mining and industrial schedule preferences omitted other useful work, leaving unassigned residents unable to deliver or process materials. Those preferences now order work; spare workers can fill the other useful jobs. Mines and workshops expand together using their actual processing rates: a mine slot yields three ore per three seconds, and a workshop slot processes three ore per 2.8 seconds. The colony bootstraps one mine, then budgets for processing before opening more mines.
- Stored-ore delivery targets two processing cycles per workshop slot (30 ore at level one, capped at 60). A workshop with that buffer available should assign workers to processing rather than filling every entrance with optional deliveries.

Trees are cut when wood is needed for construction, an explicit goal or the timber reserve. Stone is quarried and processed when there is a block/ore requirement. Real collection, travel, stock and construction transactions remain authoritative.

## The outpost calculation

The planning horizon is **300 simulation seconds**. Movement is estimated at **1.65 ground units per second**. Costs are in worker-seconds; they never spend resources or change health by themselves.

For food, washing or play:

```text
expected visits per resident = 300 × need decay / (98 − 68)
travel saved = served residents × expected visits × 2 × (old route − new route) / 1.65
building effort = 32 + 2 × wood cost + 0.6 × block cost + builder route / 1.65
payback time = 300 × building effort / travel saved
```

The material multipliers include a conservative sourcing allowance. Real gathering rates, travel, queueing, pollution and changing needs can differ from this estimate. A candidate needs at least four nearby residents and predicted savings of at least **1.25 times** the building effort. A group with no reachable service is considered a support gap separately; an impossible route is never presented as an actual travel time. Capacity limits how many residents a facility can claim to serve.

Example: 12 residents, a 40-unit food route reduced to eight units, ten wood, and a ten-unit builder route save about **372 worker-seconds** over five minutes. Estimated construction effort is **58 worker-seconds**, repaid in about **47 simulation seconds**.

Ore delivery uses the real three-ore batch and three-second mining cycle:

```text
delivery trips = min(remaining ore / 3, miners × 300 / (3 + 2 × old route / 1.65))
travel saved = delivery trips × 2 × (old route − new route) / 1.65
```

A nearby stone workshop is worthwhile when the saved carrying time covers its material, construction and access costs with the same margin. A nearly exhausted deposit cannot justify a workshop using imaginary future deliveries. Workshops are anchored near the least-served mines instead of repeatedly choosing the first mine in the object list.

Workers are counted once when several nearby deposits share the same potential crew; their savings cannot be added twice.

### Boundaries

- Care and work outposts use the existing grove, shower, play and workshop buildings. No new management panel is required.
- Routes account for obstacles and bridge detours. The existing 64-unit new-job search remains bounded. Final shortlisted sites use routed costs and legal entrances; cheap geometric estimates shortlist candidates first.
- The settlement inventory remains shared. Tree gathering and hand quarry collection already credit it on completion. The calculation does not invent return-to-depot journeys for those transactions; it models actual care trips and mine-to-workshop ore deliveries.
- Scouting alone does not establish local population demand. Working groups and settled residents do. Existing and pending facilities both count when evaluating duplicate support.
- Outpost planning retains at most 16 local groups and passes at most six support gaps into context. Route and source reachability caches are bounded and invalidated as topology changes. It does not store an unbounded travel trace.
- Existing consent, fog, work restrictions, building unlocks, material budgets and urgent care continue to apply.

## Intelligence, history and verification

Laya sees concise travel-saving or remote-support labels in its existing choices. Jev sees the same offers with worker counts, savings, construction effort and payback. Saved development child goals identify the support location. The existing thought log records the selected location and its reason. Asynchronous choices are rechecked against current demand.

Regression coverage includes inaccessible remote ore, an unbridged river, competing workshop input reservations, actual completion of a block goal, the two payoff formulae, exhausted deposits, remote busy workers, pending facilities, a lone scout, physical outpost construction using freshly cut trees, and stale choices after a group moves.

One older scheduler test now reveals an input source at its fourth camp. It still requires another development offer at the same event-review deadline; it no longer depends on hidden resources being offered before discovery.

These changes improve source selection and local support. They do not make every resident work continuously or prove every crowded layout free of congestion.

### Verification results

- Final regression suite: **160 tests pass**, including 15 new outpost and resource-chain regressions.
- Production build passes with 37 checked assets; the existing Three.js chunk-size advisory remains.
- Production-browser asset and storage checks pass.
- Real cached Laya WebGPU passes the existing 12 behavior scenarios, 12 command cases, independent care construction, resource/crossing completion checks and 96-inference GPU-buffer check. Jev's request/response and context-budget checks use fixtures; no paid live Jev request was made.
- The final six-minute, 300-resident run made **114 model calls**, accepted all 89 schedule applications, started 33 development selections and rejected three that could not start. It finished 36 crew projects, including seven mines and five workshops.
- Completed physical work: **58 timber-gathering actions, 37 quarry actions, 78 hand-refining actions, 89 mining actions, 87 hauling actions and 41 workshop production actions**. Energy reached **1,008,396**. The prior reviewed build's same workload completed 15 workshop actions and reached 368,940 energy. These are bounded behavior runs, not a frame-rate benchmark or proof for every saved colony.
- 298 of 300 residents completed useful work, including scouting. Rest occupied 46.75% of resident time; literal idle occupied 4.71%. At the end no resident was within ten units of the original center, needs were all at least 67, and population remained 300. There were **23 stalled journeys**, so crowd/path congestion is still possible.
- The fixture uses ten spread neighborhoods, cached model weights with downloads disabled, real provider responses and the production simulation. It never opens the player's save, holds births to isolate scheduling, and awaits inference between simulated steps. Two final runs produced the same aggregate results.
