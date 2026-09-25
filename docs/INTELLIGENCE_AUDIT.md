# 25-resident intelligence audit

## Reproduction

Measured September 25, 2026, against the pre-change `0fd6389` logic and the
revised logic. Both browser runs used real cached Laya FP16 WebGPU inference,
the same deterministic 25-resident colony, accepted independence, medium speed,
and 300 simulated seconds. The fixture starts near (24,24), with two groves,
three washing places, two play facilities, trees, an unfinished bridge, zero
stored timber, and needs at 85. Births are held to isolate 25 residents.

This is a controlled diagnostic, not a replay of the player's save. Simulation
uses fixed 0.1-second steps and waits during inference. It does not measure five
minutes of rendering, GPU duty, competing tabs, or asynchronous responses during
live play. Model decisions below are real calls, not the CLI's rule reference.

Run **Deployment checks → 25-resident audit · cached Laya GPU** at `verify.html`.
It reads cached weights only and never reads or writes the player's colony.
The downloadable report includes every resident's name, task, purpose, position,
distance and completed useful-work cycles. For simulation without a model, run
`node scripts/audit-colony.mjs`; its choices are labelled Diagnostic rule reference.

## Results

| Measure over 300 simulated seconds | Before | After |
| --- | ---: | ---: |
| Actual schedule model calls | 2 | 66 |
| Actual development model calls | 4 | 6 |
| Reviews with one distinct schedule | 23 / 25 | 0 / 66 |
| Useful work, including travel to work/scouting | 18.46% | 24.59% |
| Rest task, including travel to rest | 56.09% | 49.91% |
| Idle between assignments | 6.27% | 6.05% |
| Completed development projects | 3 | 5 |
| Explored ground area at the end | 10,400 | 10,768 |
| Residents within 10 units of (24,24) at the end | 9 | 11 |
| Residents who completed useful work | 25 / 25 | 25 / 25 |
| Deaths / route stalls | 0 / 0 | 0 / 0 |

The revised final snapshot had 15 resting, two scouting, four gathering timber,
three washing and one playing. Every resident moved 145–298 ground units during
the run. A still-looking resident is not necessarily permanently idle. The
bridge was selected at second 76 and completed before second 199; this consumed
more crew time than another care building. A sixth project was underway at the end.
Laya chose balanced allocation 65 times and expansion once. The greater call
count does not mean an equal improvement in planning quality.

## Confirmed causes and changes

1. **Nearly identical allocations.** Every policy had the same frontier crew
   limit; deduplication commonly left one plan and bypassed Laya. Recovery,
   balanced and expansion now allocate one scout per 24, 12 and five residents:
   two, three and five for this fixture. Existing journeys keep their reservations.
   Paths, permissions and care still constrain actual assignments.
2. **Misleading care reward.** A wash could receive reward for low food or play,
   and comfortable top-ups looked productive. Care now scores the actual need
   treated below the work-care threshold of 68. Recovery is omitted if its care
   benefit is zero and nobody is sick. Other policies still protect individual care.
3. **Weak local context.** Choice labels now state the proposed crew mix. Required
   context includes healthy available workers, permissions, goals and lowest needs.
   Signed density/travel costs follow early; the old local summary removed every
   negative effect. Resource choices explain their purpose, including bridge access
   to land and mining. Urgent care context omits unrelated unlocks so immediate
   shortages retain priority. Schedules now have up to 320 tokens; optional details
   can still be omitted. Hosted context contains workload, task allocations and
   reward components too.
4. **Delayed reviews after work.** Useful work/care completion, changed goals,
   access requests and completed projects can trigger an earlier review. Event
   spacing is one-third of the regular interval, at least one second. Rest does
   not trigger calls. Finished projects no longer add another whole building
   cooldown. Worker limits and conversation priority remain in effect for both
   Laya and Jev/OpenRouter.
5. **Poor visibility.** The thought log separates group/building calls from reviews
   that needed no model. Advanced options display candidate planning scores.

The two-second scheduler was investigated but is not the primary cause:
`goalPolicy` already carries the selected policy forward, with care and explicit
goal rules. It was not replaced. The fixture also did not reproduce round-robin
starvation: all residents eventually worked. Laya returned float32 logits,
ruling out interpreting float16 bit patterns as scores.

## What the reward means

These are **handwritten planning estimates**, not online reinforcement learning.
Laya/Jev choose feasible plans; neither is trained from colony outcomes here.
A model probability is not a game reward.

| Component | Contribution to the fallback score |
| --- | --- |
| Care | Treated deficit below 68 / estimated trip and service time, × 8 |
| Material work | Estimated useful rate × 2; × 6 for wood/bridge goals |
| Production | Estimated useful rate × 2; × 6 for ore/blocks goals |
| Discovery | Estimated scouting rate × 3; × 8 for crowding/growth goals |
| Commitments | +0.15 per preserved assignment |
| Maintenance | Estimated pollution removal rate × 2 |
| Space | Average signed density score at proposed destinations |
| Travel | Minus average estimated one-way travel seconds / 60 |

Density target is six residents per 100 ground units, measured in a radius of ten.
For density `d`, `r = (d - 6) / 6`; score is `-4*r²` above target and `-0.6*r²`
below. Examples: density 0 → -0.6, 3 → -0.15, 6 → 0, 9 → -1, 12 → -4.
Building placement also considers existing buildings, care coverage, travel and
outpost benefit. These costs never damage residents.

## Remaining limitations

- One development project has at most four crew members. More model calls do not
  create more physical work slots; healthy residents still have substantial rest.
- Central facilities attract return visits. Eleven residents ended near the center,
  versus nine before. The entire colony becoming stuck was not reproduced, but
  these results do **not** establish that central clustering is fixed.
- Laya still favoured balanced allocation and care-building expansion, although it
  also completed the bridge. More calls do not establish strategic competence. The
  [export's model card](https://huggingface.co/inferenceprince/laya-onnx) documents
  limitations on fine procedural decisions and the need for task-specific validation.
- Jev uses the same revised choices, workload, rewards and event timing. Its
  request contract is tested; no paid live Jev run was made during this audit.
- Results do not establish a complete campaign, all saved layouts or mobile performance.

## Verification and model-quality failures

The real WebGPU suite keeps its existing quality thresholds. It now records all
schedule failures and continues through the remaining checks, then reports FAIL
with the full results rather than stopping at the first throughput shortfall.

- All 12 schedule fixtures preserved permissions, survival, the care bound and
  route-stall bound.
- Two still missed the useful-work threshold of 80% of the updated rule reference:
  `new-command` completed 8 useful tasks versus 12, and `holdout-empty-7` completed
  7 versus 9. Both chose balanced instead of the larger exploration crew.
- All 12 command fixtures, three construction fixtures, two care-capacity fixtures
  and four resource/bridge projects passed. The nine-choice development context
  fit in 298 tokens.
- The 96-inference GPU buffer check retained 842,593,136 bytes after both the first
  and final repeated shape cycles. This measures requested GPU buffers, not driver
  memory or the whole browser.
- The Node regression suite and production build pass. Jev's request contract is
  covered with a fake transport; this is not evidence of live Jev decision quality.

The remaining model-quality failures are intentionally visible. Improving them
requires broader scenario evaluation and potentially task-specific model training;
the game does not silently call a rule-based correction a model decision.
