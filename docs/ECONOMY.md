# Colony economy worksheet

Documented unlocks remain in `catalog.js`; purchase costs and rates below are deliberately authored tuning, not claimed official values. All durations are simulation seconds. Options, major conversations and hidden-tab pauses stop simulation time.

| System       | Rate/capacity                                                  | Consequence                                                                                                                                             |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Needs        | Food −0.19/s; clean −0.12/s; play −0.16/s                      | Urgent care overrides productive tasks; 28 continuous seconds at zero can cause death.                                                                  |
| Food         | +26/s, 1.5 seconds per stock                                   | One consumed banana per completed meal; orchard regenerates one stock per 4s up to 12 per level.                                                         |
| Bath         | +24 cleanliness/s; one service position                        | Recovery takes roughly 3s from low cleanliness, plus travel and queue.                                                                                  |
| Play         | +18 amusement/s                                                | Separate positions for balls, roundabouts and theatres. Theatre benefit expires after 60s.                                                              |
| Home         | +14 food/s and +16 cleanliness/s                               | Housing also supports 48 district residents per level.                                                                                                  |
| Reproduction | 50s above 65 in all needs, low sickness                        | Child requires clear space; after 96 detailed births, housing must have cohort capacity. Existing detailed saves up to 192 stay intact.                 |
| Tree         | Six wood                                                       | Carriers move three per trip; bridge consumes exactly 24 material units.                                                                                |
| Bug          | Eight bones per victim/remains                                 | Bone carriers move four per trip. Deaths and material use remain separately recorded.                                                                   |
| Mine         | Three ore × level × quality per 3s                             | Requires available stock; carriers deliver ore physically to a factory. Active ore-stockpile goals retain ore in inventory.                             |
| Factory      | Three ore per level per 2.8s; eight blocks per ore               | Input is delivered stock, capped at 60. Each block also yields 1,024 energy; each batch pollutes its local zone.                                          |
| Pollution    | 0.5 × level per batch; radius five                             | Exposure drives sickness; mop removes up to 40 per nearby zone and helps nearby creatures.                                                              |
| District     | Housed population grows at 0.3%/s until capacity               | Fractional growth/loss is retained; care/rest allocation and health counts are explicit. Districts produce no hidden industrial bonus.                  |
| Orbit        | Actual boarding and departure only; no automatic growth | Twelve real journeys establish the orbital home. Energy is 0.025 per orbital resident per second.                         |
| Ending       | Sky launcher plus twelve journeys and twelve orbital residents                       | Explicit choice and before-event save, world transformation, actual survivors and irreversible actions within that branch; rewind retains another path. |

Placing care beside eastern industry materially improves throughput. A single remote care hub creates avoidable travel and congestion. Keep entrances clear, make short mine–factory trips and distribute care. Model choices cannot compensate for absent supplies or inaccessible facilities.

The caretaker-driver run reached its final interaction at 25.7 simulated minutes, without reading pauses. That is engineering progression evidence; the 30–40-minute first-human-play target still requires an observed play session.
