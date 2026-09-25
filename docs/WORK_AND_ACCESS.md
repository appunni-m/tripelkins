# Work, care and blocked routes

## Care leaves time for work

Normal decay per simulation second is now 0.08 food, 0.05 cleanliness and 0.065 amusement (previously 0.19, 0.12 and 0.16). Pollution and the cost of replication remain separate. Ordinary care starts below 68; a care-focused schedule starts below 78. Urgent care still interrupts work at the configured floor, normally 35. Existing useful work keeps its reservation while the worker remains safe.

Rest only raises amusement toward 70. It never lowers an already happier creature to 70. Meals, baths and play restore needs quickly, creating a longer interval for useful work.

## Sharing work

The scheduler reserves urgent care and existing commitments first. Available workers then get turns in order of their last useful assignment. A persisted colony counter and per-creature `lastWorkTurn` prevent the same birth ordinals from winning every tie. Assignments consume turns only when applied; evaluating multiple model choices does not change fairness.

Preferred roles rotate with time and completed work. Project recruitment uses the same queue among available workers, with comfortable workers ahead of those recovering. Service slots and actual supplies still determine how many creatures can use a building simultaneously. Waiting for a free bath or an empty mine is not reported as a blocked path. Scouts scale with population, up to 64 simultaneous frontier trips; each trip checks travel, return access and food reserves.

The old fixed 96-body birth rule has been replaced by the adaptive budget described in [ADAPTIVE_EXPANSION.md](ADAPTIVE_EXPANSION.md). There is no 288-population rule in current source. Legacy district residents retain their housing accounting; new births remain named individuals until rendering/CPU headroom or the explicit 2,048-body memory safeguard pauses births.

Industrial capacity also scales with the colony: the planner can propose one mine per 32 residents and one factory per 48, subject to resources, unlocks, discovered nodes and urgent care. The previous two-mine/one-factory ceiling is gone. Activity totals include waiting residents so the whole visible colony is accounted for.

## Route recovery

The navigation grid keeps its fixed allocation but shifts toward workers on longer routes, so jobs 42–64 units away are no longer excluded by a target-centered field. Service points can use an alternative side of an object when their original side is obstructed. Walking around an obstacle counts as progress even when it temporarily increases distance from the final destination. Bridge waiting does not consume the travel timeout.

Failed real schedules and stalled journeys create at most eight saved access requests. Each records the destination, original task, reason, status and any clearing crew. Requests are deduplicated, bounded and removed when the destination is reachable, obsolete or abandoned.

At most one request is reviewed every six simulation seconds. A bounded weighted route search treats trees and rocks as removable at a higher cost than walking. Water, buildings, the mountain and undiscovered land remain blocked. The search proposes only the first obstruction that a real worker can reach.

Laya/Jev receives a concrete clearance option alongside development options, including its destination and obstruction. A model-selected crew uses the existing gather/quarry actions, spends real work time and produces the usual wood/ore. The route is checked again after removal; the next tree is a new decision. This can run while another construction project waits. Independence, intelligence, work restrictions and region restrictions apply throughout.

When the colony needs help, a deduplicated inbox message explains the destination and requested assistance. Existing notification spacing applies. The activity log records blockage, model assignment and reopening. Goals show opening the route as a child goal. Hosted context includes a compact blocked-work summary; exact worker assignments and full route searches stay local. Local context includes the blocked count and concrete clearance options within its token budget.

The mountain story remains a player choice: placing and tapping TNT. Opening its approach is ordinary clearance work; the model cannot trigger that destructive story action.

## Persistence and limits

Fairness counters, at most eight requests and one assigned worker per request are normalized on restore. Inbox, activity and event history use their existing bounds. Search arrays are temporary, contain at most 104 × 104 cells and are not saved. No model conversation or expanding path history is added to storage.

Build and deployment status are reported with each change; these rules do not imply an unmeasured performance or model-success guarantee.
