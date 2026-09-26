# Growth, exploration and settlement placement

## Why the colony stopped

- Natural births became anonymous housed residents after 96 visible creatures. Without spare housing, replication stopped.
- Scouts searched a fixed 18–32 unit ring around food. Once that ring was revealed, they had no further destination.
- Routine care started below 62%, although replication requires every need above 65% for 50 simulated seconds.
- Development offered the model one position per building type. Placement favored the existing cluster; the model could not compare neighborhoods.

## Growth admission

Natural births now remain individual creatures with names, history and jobs. They no longer spill into anonymous housing. Existing district/orbital ledgers are preserved for older saves and story progression.

`GrowthBudget` reviews five seconds of active play at a time. It opens room gradually, in batches of 4–16 births, as healthy parents become ready. Loading a large saved colony starts from its existing count, and never deletes anyone to meet a new budget. Above-budget periods hold births; headroom below 85% of the threshold resumes admission, preventing rapid toggling. Paused and hidden periods are excluded. Measurements are rebuilt after a reload or restore.

The target is **50% estimated rendering GPU duty**, calculated from average WebGL execution time and actual render frequency. Asynchronous `EXT_disjoint_timer_query_webgl2` queries sample every tenth drawn frame. At most four queries are pending, disjoint samples are discarded, old queries expire, and no synchronous GPU wait is used.

This is not total device GPU utilization. It excludes the compositor, other applications, and Laya/Whisper compute on separate devices/queues. Unsupported or stale GPU timing falls back to frame/main-thread measurements. Main-thread duty above 45%, or more than 20% of observed time in frames exceeding 75 ms, also holds growth. The governor cannot guarantee an operating-system GPU meter will read 50%.

There are separate memory safeguards: 2,048 individual creatures and 2,048 saved objects. These are upper bounds, not promised performance levels. Growth can stop below them due to care, crowding, CPU cost or rendering load. History still compacts within its existing 8 MiB budget. World imports allow 16 MiB files. IndexedDB version 10 fences older clients that would truncate individuals above 192.

Options → Advanced → Growth & settlement reports the measurement source, duty estimate, CPU work and reason for waiting. Technical details stay out of ordinary game controls.

## Exploration and settlement expansion

Scouts compare multiple rings up to 52 units from nearby food outposts, including partially revealed edges. They choose destinations that reveal new cells, avoid duplicating other scouts, obey region/bridge restrictions and have a reachable return to food within their hunger budget. Scouts are bounded to 1–16 according to colony size.

New orchards can be planned near recently scouted ground, 18–38 units from existing food. Each new food outpost extends the next scouting range. Expansion remains physical: scouts walk, crews gather wood, and builders work at reachable entrances. No camera movement reveals fog.

Routine care now starts at 72%. Residents need all needs above 65% to grow. Early colonies use an approximately five-second healthy growth period and stop early expansion at 21 named residents; the period returns to 180 seconds once twenty residents live on the ground. Density, urgent care and device headroom still affect birth timing. Urgent care interrupts work. A new expansion schedule is available to Jev/Laya and to a healthy colony with an explicit growth goal.

## Density cost

Default target `X = 6` residents per 100 square ground units, measured in a radius-10 neighborhood. Let `e = (density - X) / X`:

- Above target: reward = `-4 * e²`.
- Below target: reward = `-0.6 * e²`.
- Placement also penalizes more than three buildings within radius 12 by `-2 * excess²`.

These are explicit planning scores, not learned reinforcement-training weights. They never damage creatures. Placement balances these scores with unmet care demand, travel, pollution separation and the benefit of a new outpost. New free-positioned buildings keep six units of separation; mines must use an actual ore node and retain physical clearance. Care destinations and resting places also consider crowding, while urgent care takes the nearest feasible route.

## Parent goals and child goals

The colony derives a bounded plan from the active player goal, current care and density. Children cover food, washing, play, scouting, requested stockpiles/crossings, gathering building materials and completing the current project. Care planning reserves approximately 20% extra sustainable capacity for the next generation. Urgent care can precede a resource objective.

Up to six concrete project/site alternatives plus “wait” are sent to intelligence. Each includes its location, benefit and density cost. Hosted context carries compact child goals and scores. Local Laya uses a bounded 320-token input. Exact individual assignments and pathfinding stay in the simulation.

The returned site is revalidated at its original coordinates. Changed needs, blocked placement or a materially worse density score cause replanning. The response cannot silently move a building elsewhere. The activity log records the chosen position and reason.

The current child plan, selected parent/child IDs, project and site reason are included in browser snapshots and timeline history. Child completion is derived from real state, not a model claim. Children are recomputed after restore; runtime budgets are not restored from another device/session.

## Sources and practical limits

- [Khronos WebGL2 timer query specification](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/) defines asynchronous elapsed-time queries, disjoint results and cleanup.
- [MDN timer query reference](https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query) explains timing GL commands without stalling the rendering pipeline.

The controller is an admission policy, not a benchmark result. Sustained population capacity depends on device, browser, visible scene, model workload and settlement layout. Production builds and disposable UI observations do not establish long-run throughput or guarantee a particular population.
