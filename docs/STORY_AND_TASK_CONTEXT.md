# Tripelkins: the journey here

## Opening story

Six illustrated scenes, ten seconds each. It appears before the welcome screen on a first visit. Existing players can replay it in **Options → Game → Their journey here**. Pause, skip, the close button and Escape are supported. Hidden tabs stop the story clock. Reduced-motion preferences disable illustration movement. No media or model download is needed; captions tell the story without changing the creature sound engine.

| Time | Scene | Story |
| --- | --- | --- |
| 0–10 s | Three suns. One home. | The Tripelkins grew up beneath three suns. They built garden cities, sang through the long evenings, and always left a light for someone coming home. |
| 10–20 s | The day the shadows vanished | Then all three suns flared together. The gardens burned. Families crowded the launch fields. One small spacecraft escaped, carrying the last living thread of their world. |
| 20–30 s | A terrible price for survival | The triple flare caught them beyond the last planet. Their DNA changed to endure it. Their bodies survived. The intelligence that built their cities did not. |
| 30–40 s | What the stars could not take | They could still feel hunger, seek warmth, and curl around a frightened friend. But they could no longer plan a tomorrow. The spacecraft kept searching for one. |
| 40–50 s | And then, there was you | Now it has found this quiet clearing. Feed them. Keep them clean. Give them room to play. Help one small life become a family that can survive. |
| 50–60 s | A future they can make themselves | When their family grows, help them think together again. Let them gather, build, and find their own way. Their old home is gone. Their story is not. |

**If one of them survives, everyone survives.**

The DNA change is fictional worldbuilding. Their warmth, instincts and personalities remain. The existing independence threshold and explicit permission still apply; the opening does not enable intelligence or authorize a download.

Preview without changing a saved colony: `?preview=prologue`. Previewing does not mark the opening as seen. The ordinary first-visit flag is local to this browser origin. Existing saves are not forced through onboarding again.

## A continuing story in the inbox

- 28 additional letters, including seven recovered flight records, connect the lost home to the settlement being built. Their conditions include care, gathering, exploration, family growth, independent projects, reopening paths and returning to orbit.
- New letters require a real milestone and are paced at no more than one per minute of simulation time. Later flight records require both time and settlement progress. Time alone does not manufacture an achievement.
- Existing incidents have distinct titles and now obey a 90-second incident interval. Notifications retain the existing 50-second spacing and five-second dismissal.
- Facility completion notes vary by building type and include a real crew member and location. Route requests explain the job and obstruction; a follow-up reports when a route is actually open.
- The inbox has Everything, Flight records, Colony letters, Milestones, Work & discoveries and Requests filters. It keeps 64 messages, preferring unanswered choices over routine letters when it fills.
- Seen/completed story IDs have a separate fixed limit of 128. Evicting an old inbox letter cannot make it repeat. These IDs, categories and pacing clocks survive save/export/restore. Existing story IDs and saved message text are preserved.

## Intelligence and prerequisites

The context now carries **task → purpose/parent project → obstruction → reachable prerequisite → resume task**.

For example: a crew needs timber for a rain shower, but cannot reach a tree. The access search identifies the first reachable tree or rock that can be cleared. Intelligence chooses that bounded clearance option; a rested worker performs it. The simulation verifies the new route, then resumes the original project. It never grants materials or claims success from the model's words alone.

- Hosted summaries retain the reason, task, parent project, checked obstacle, suggested next step and resume target for up to three priority requests. The full local state holds up to eight. Urgent care routes come before routine work.
- Laya receives a compact dependency explanation in required context, before optional history or scenery. Its option labels state what clearing achieves. Schedule prompts stay capped at 256 tokens and development at 320.
- Blocked gathering and hauling jobs retain their parent project even when the physical job did not have a construction ID. A project may lend a rested crew member to clear its own route; ongoing work is not stolen.
- Clearing still requires independence, intelligence, permission to work and an actually reachable tree/rock. Water, buildings, unexplored ground and story landmarks are not automatically demolished. Unsafe or unavailable routes generate a concrete help request.
- The fictional premise is optional hosted context. Live needs, permissions and task dependencies take precedence over lore when context is tight.

## Verification

All 104 existing regression tests passed after these changes. The cached Laya FP16 WebGPU check passed its schedule, command, construction, care-pressure, resource-development and 96-inference memory checks. Opening layout, pause, skip and the replay entry were checked in the browser; hidden previews correctly retain their story position. Hosted Jev inference was not exercised without an API key.

The authored letters are not model-generated claims. Model choices still pass the existing simulation and stale-result checks. No hosted API key is included in saves or this documentation.
