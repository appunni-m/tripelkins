# Persistent colony goals

Storage, rewind, command lifecycle and model-context details have since been revised; see [the current architecture review](CONTEXT_ARCHITECTURE.md). Earlier verification claims below apply to their recorded implementation.

Speak or type an objective such as “Grow to 50 Tripelkins,” “Keep everyone healthy,” “Finish the bridge,” “Collect 100 wood,” “Stockpile 40 ore,” or “Make 500 blocks.” One primary goal is interpreted per message.

## Lifecycle

1. **Interpret:** every local command runs through Laya. It chooses a supported objective or conversation; numeric quantities are copied from bounded numeric slots in the text. OpenRouter/Jev returns a validated objective and target using structured output. Unsupported commands and questions should select no objective.
2. **Remember:** the exact request, interpreting provider, target, creation time and status enter the world save. The first objective becomes active; subsequent objectives queue. Matching open goals are deduplicated.
3. **Plan:** derive milestones, current progress, available actions and blockers from the world. Feed these, the queue, recent conversation, group needs and feasible member assignments into provider context.
4. **Act:** the selected policy is expanded into assignments against current creatures, reachable objects and capacity. Local scheduling continues every two simulation seconds; enabled AI reviews roughly every 12 simulation seconds, with a bounded state-sensitive cache. Goal changes invalidate old decisions.
5. **Adapt:** urgent needs take priority. Care and growth objectives raise care thresholds; an ore reserve prevents factory jobs from consuming the stockpile. Missing supplies or facilities are shown as requests for the caretaker. Models cannot invent resources, bypass unlocks or mark objectives complete.
6. **Complete:** simulation measurements determine success. Completed goals release the next queued objective. Care is an ongoing duty until paused or set aside.

Goals survive reloads and are included in export/import and recovery. They do not expire after a minute. Open **Goals** with the flag button or active goal banner to see progress, milestones and blockers; pause, resume, reprioritize or set aside an objective. Pausing one goal allows the next queued goal to become active. Provider identities and reviews are kept in the save and can be inspected through Options → Advanced → Inspect colony context → Saved decision history. Background decisions cannot apply assignments while the world is paused; a fresh decision preview in Advanced does not apply assignments.

## Supported measurements

| Objective | Measurement                                              | Typical dependency                                  |
| --------- | -------------------------------------------------------- | --------------------------------------------------- |
| Care      | Lowest food/clean/play value among represented creatures | Care tools, replenishing food and enough facilities |
| Grow      | Total population, including the aggregate cohort         | Needs above the replication threshold               |
| Bridge    | Delivered logs / 24; bridge completion flag              | Caretaker chops trees, workers haul logs            |
| Wood      | Current wood reserve                                     | Finish bridge, then deliver spare logs              |
| Ore       | Current ore reserve                                      | Unlock industry and provide a stocked mine          |
| Blocks      | Current block reserve                                      | Supply ore and a factory                            |

The colony uses existing simulation abilities. It cannot chop trees, place buildings or choose moral actions on the caretaker's behalf. Goals stay visibly blocked when those prerequisites are missing. This is a finite, state-grounded planner, not an unrestricted agent. Model classification can be wrong; the accepted goal is stated in subtitles and can be set aside in Goals.

## Bounds and implementation

- Up to 8 unfinished goals, one active at a time; 12 closed goals retained.
- Up to 8 recent provider reviews per goal; reason limited to 240 characters.
- Commands limited to 500 characters; targets bounded to supported ranges.
- Five schedule policies: care, balanced, bridge/wood hauling, industry and ore mining.
- Laya schedule context: 192-token budget. Command interpretation: up to 320 tokens, within the model configuration limit.
- Relevant files: `src/game/goals.js`, `src/game/context.js`, `src/game/state.js`, `src/game/simulation.js`, `src/brain.js`, `src/conversation-ui.js` and `src/main.js`.
