# Bridge progression and the meteor tool

25 September 2026. Bridge supply, progression and destruction behavior.

## Reproduced fault and fix

Before the fix, `withdrawMaterial(world, "wood")` removed six wood from storage and selected Grabber, but `interact(world, "grabber", ...)` immediately rejected it as locked. Grabber unlocks much later. A player trying to supply the first bridge from the wood counter therefore had a stranded stack. A control scene with loose logs already on the ground completed normally.

Putting down an already-held stack is now available immediately, including after restore. Picking up other objects still requires Grabber. Held stacks remain selectable in Tools and from the resource counters when the player switches tools. Placement cannot move supplies to the locked river bank. Withdrawal and placement update the action history and invalidate stale intelligence results.

The default objective from four residents is now **Build the bridge**, with the actual delivery count. Tapping it selects the crossing. Its panel shows progress, separate wood/bone totals, staged stock and carried stock, plus **Send stored wood** and **Chop trees**. Sending wood transfers only existing inventory into a physical pile near the bank. It does not complete the bridge or skip walking. Repeated clicks account for materials already staged/carried. The normal scheduler still respects care and stop-work commands.

First contact explains the wood/bone choice through the inbox. Each actual delivery appears in Activity; completion produces one inbox milestone. Both the local model's short context and hosted context include the real construction ledger. Industry and eastern land still require bridge completion.

## Meteor behavior and storage

Meteor appears in Tools at four residents. A 2.5-world-unit preview circle matches the simulation's center-based impact radius. It removes nearby ordinary structures and rocks, burns trees to stumps without producing timber, and kills detailed residents inside the radius. Carried supplies and remains use the existing conserved death transaction. A demolished mine leaves its remaining deposit; factory input ore returns to storage. Story landmarks, the lander, TNT, cannon, bridge and final connection are retained. A strike cannot bypass the river or the ending.

Meteors are caretaker actions, never model-selected jobs. Losses have their own cause and evidence counter rather than being counted as neglect or bone sacrifice. The story, inbox, Activity and final assessment retain the consequences. The visual effect is local, respects reduced motion, has a small fixed cap, and does not flash the entire page. Sound respects mute. Snapshots and rewind restore the actual pre-impact state; no physics or model call is replayed.

IndexedDB version 7 keeps existing records and closes older clients that cannot preserve the new consequence counters. Runtime animations are not saved. No model download or storage-budget expansion is required.

## Verification

- `npm test`: 66 checks pass, including seven focused regressions for early placement, first-contact gates, physical wood conservation through restore, provider context, impact boundaries, protected landmarks and exact rewind.
- `npm run build`: production bundle and 26-file deployment manifest pass.
- `npm run verify:experience`: the caretaker driver reaches the final connection in 22.9 simulated minutes with zero losses before the intentional final catastrophe. This checks progression; it is not a timed human play session or live inference run.
- `?preview=bridge-stock` is a disposable, paused scene with 24 stored wood and no loose logs. It never reads or writes the player's saved world. It supports reproducing the full supply interaction in the browser; `?preview=bridge` retains the existing loose-log fixture.

- Production browser preview: clicking the objective opened the bridge panel; sending 24 wood removed exactly 24 from storage. The bridge reached 24/24 at world time 1:23, and scouts subsequently inspected eastern nodes. Intelligence was off throughout this baseline check. A meteor then recorded six detailed losses and two struck objects; the local impact was visible and the browser reported no errors. This was a disposable colony.
- Actual Laya WebGPU checks passed: 12 schedule scenarios, 12 command scenarios, three construction scenarios and the GPU allocation soak. Construction inference was 82–86 ms on this run. The fresh worker used the existing model cache.
- Actual Laya WASM passed its corresponding schedule, command and construction checks. The browser reported two passed backends, zero failed and zero unsupported. Authenticated Jev and microphone input were not exercised in this follow-up.
