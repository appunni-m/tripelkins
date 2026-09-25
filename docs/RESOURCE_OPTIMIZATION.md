# CPU, memory and population review

Update: [Intelligence controls](INTELLIGENCE_CONTROLS.md) now allow an explicit
1–3 worker limit. One remains the default. The single-worker measurements below
describe the original baseline, not concurrent pool performance.

Status: engineering verification complete, Engineering notes; historical measurements below predate the current artwork and growth tuning.

25 September 2026. Device and
reference acceptance limits are listed below. Publication is recorded separately.

## Requirements and evidence

| Requirement | Current evidence | Remaining work |
| --- | --- | --- |
| Low CPU for play and paused Options | 30 Hz presentation; retained paused frames; 10 Hz simulation; browser checks report zero paused draws | Longer real-session frame/CPU soak, including populated restored worlds |
| Low memory with millions of lives | Named bodies capped at 192 (96 for new births); aggregate orbital/district counts; same records and useful work at 48/1M/1B benchmark starts; maximum object/history fixture passes | Total process RAM includes browser/ORT overhead; JS heap is not total memory |
| GPU inference, CPU game/UI logic | Automatic Laya and speech no longer silently switch to WASM; explicit CPU compatibility remains in Options | Verify whole application background/wake and simultaneous voice/decision lifecycle |
| Small model memory | One Laya worker; voice opens on demand; background workers released after 30 seconds, pagehide immediately; GPU buffers plateau across 96 varied decisions | GPU weights alone need ~843 MB; driver and ORT host heaps are additional |
| Self-sustaining, purposeful growing colony | Thirty-minute run starts with 1M lives, completes 5,742 jobs and has zero deaths with no caretaker intervention; physical maintenance removes pollution | Millions are aggregate orbital residents producing energy, not millions of independent named agents; detailed surface workers remain bounded |
| Storage/context remain bounded | Saturated 192-body/768-object fixture: save <430 KB, full context <194 KB, hosted projection <=16 KB; four rewind branches remain below 8 MiB | Device storage quotas remain browser-controlled |

## Causes found and changes

1. `main.js` rendered every display refresh even while paused. Rendering now runs
   at up to 30 Hz, paused scenes retain their frame, hidden scenes don't render,
   and unchanged paused autosaves are skipped. UI remains ordinary DOM on the
   CPU; Three.js still uses WebGL for its small draw pass.
2. Toolbar invalidation depended on exact population and peak blocks. It now
   depends on actual unlock/visibility states. Resource and inspector HTML only
   changes when displayed content changes. Need bars use displayed integers.
3. The route profile was dominated by repeated line-of-sight checks against all
   nearby obstacles and repeated queries across five candidate policies. A
   conservative segment/box broad phase keeps the original rounded-footprint
   sampling. A synchronous, bounded per-candidate-set cache shares exact route
   costs; it is discarded before world state can change.
4. Navigation used a grid plus costs for every destination. The cost sentinel
   already encodes blocked cells. Only costs persist per field; occupancy and BFS
   queue are reused scratch. The 192-field typed-array cap is 4,854,528 bytes.
5. Build previews placed structures on existing bodies. Their placements are now
   repaired before running jobs. Independently, one trapped idle creature can no
   longer reject all other creatures' assignments. It remains in place safely.
6. Renderer ghost geometry is reused. Material caches are pruned and released
   across restored worlds. Model invariant-token caches have an explicit cap.
7. Both inference paths formerly could silently fall back to CPU. That fallback
   is removed. GPU failure leaves built-in game instincts running; compatibility
   CPU inference is an explicit option. Speech no longer allocates an extra audio
   copy for an automatic CPU retry.

## Measurements on this Mac

These historical measurements used the simulation and context code. Run the benchmark commands below for current results.

| Synthetic 192-body workload | Before | After |
| --- | ---: | ---: |
| Initial schedule | 250 ms | 154 ms |
| Two simulated seconds | 69 ms | 46 ms |

The old industry review scene's initial profile was **not** a useful-work
benchmark: invalid idle assignments prevented every schedule from applying.
Do not compare its all-idle measurements with a repaired, working colony as a
speedup claim. The table above uses the separate unchanged synthetic fixture.

After fixing that scene, a 60-second scale workload at initial 48 / 1,000,000 /
1,000,000,000 lives takes 1.15 / 1.19 / 1.23 seconds elapsed in Node. Each finishes
276 jobs with zero deaths, ending at 78 named bodies. Navigation arrays use
2,947,840 bytes for all three. Saved worlds are approximately 151 KB and full
contexts approximately 44 KB. Post-GC live JS heaps are 7.6 / 8.1 / 8.1 MB.
**Node RSS is 191–277 MB**: live heap size is not process memory.

Production browser `performance.html` passes all three scenarios. Over 120
frames / 12 simulated seconds, each finishes 35 jobs with 48 named bodies,
97 textures, three geometries, approximately 96 KB saves, and 1,768,704 bytes of
navigation arrays. Mean CPU submission/drawing time is 0.60 / 0.50 / 0.47 ms per
frame. Simulation CPU time totals 273 / 274 / 260 ms. Each paused scene does zero
redraws and repaints correctly after a camera move. Browser JS heap samples were
38.8 / 43.5 / 53.7 MB without forced GC; those numbers exclude GPU/driver memory.

`verify.html` passed all 12 Laya WebGPU behavior fixtures after the buffer policy
change; the four actual warm model decisions took 128–135 ms. Eight single-choice
fixtures bypass inference. Loading cached weights took 2.4 seconds. This is a
small corpus on one device, not a universal latency or accuracy guarantee.

## Model constraints and design decisions

### Measured GPU pool comparison

Both variants use the same explicit GPU device features, weights, 12 behavior
fixtures, then 48 actual forward passes (three cycles of 16 input lengths).
Both pass all behavior gates and select identical policies. Buffer sizes at the
end of cycles one, two and three are exactly equal within each variant.

| Policy | Retained buffer bytes | Peak buffer bytes | Warm p50 | Warm p95 |
| --- | ---: | ---: | ---: | ---: |
| Original bucket pool | 870,201,328 | 870,617,200 | 57.8 ms | 69.1 ms |
| `lazyRelease` | 842,591,472 | 858,495,824 | 63.8 ms | 95.6 ms |

Keep `lazyRelease` for the requested memory preference: it retains 27.6 MB less
and still leaves these sparse, background decisions comfortably responsive.
This is a small percentage of the entire checkpoint. **Weights alone retain
842,588,032 GPU buffer bytes** in this build. Multiple model workers would
multiply that allocation; grouping millions of lives never needs more workers.
Host/WASM memory and GPU driver/pipeline allocations are additional, not included
in these numbers. The diagnostic wrapper counts buffer creation/destruction and
does not retain buffer references. It is enabled only on the verification page.

Failed diagnostic variant: reading `ort.env.webgpu.device` before the native
runtime initialized returned `undefined`. The verification now creates and passes
an explicit device through the supported execution-provider option, allowing
allocation measurement before loading any weights. Production does not need or
use this wrapper.

Keep the FP16 Laya checkpoint and existing Whisper Base accuracy. Laya's Q8
conversion is designed for WASM; its model card warns that the WebGPU kernel does
not support the 8-bit graph. Do not replace it with Q4 purely to save memory:
the conversion author reports substantial agreement loss on their small corpus.
[Q8 model card](https://huggingface.co/nvkudva/laya-web-q8)

Laya's GPU session uses the supported `lazyRelease` storage-buffer policy to
release temporary buffers at the end of a run while retaining weights. The
verification page compares it against the original `bucket` pool using a measured
GPU device and varied input lengths. Requested GPU-buffer bytes exclude pipelines,
driver allocations and WASM/JS host heaps; report those limitations with results.
[ONNX WebGPU session options](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.WebGpuExecutionProviderOption.html)

No WebAssembly rewrite of simulation yet: measured work is repeated search and
allocation. Removing those operations gives a larger, safer return than moving
the same algorithm across a JS/WASM boundary. Revisit only after the next profile.

## Extended verification and defects recovered

- Full shape comparison: 96 GPU decisions per
  policy, 2/3/5/7 choices, actual lengths 45–318 tokens with 192/320-token limits.
  Both policies plateau after the first shape cycle. `lazyRelease` retains
  842,593,120 bytes versus 892,329,968 for `bucket` (49.7 MB less). Warm p50/p95
  are 99/174 ms versus 91/153 ms. This extends the earlier 48-sample comparison.
- Autonomous thirty-minute run: 5,742 completed
  jobs, including 563 mining, 563 hauling, 318 production and 22 cleanup tasks;
  zero deaths. Population reaches the explicit safe cap of 10^15. Detailed
  individuals leave through real cannon launches; their identities are not
  silently reused. Maximum save 236 KB, context 68 KB, navigation 4.85 MB and
  live JS heap 8.8 MB. RSS peaks around 378 MB in this Node run.
- The first soak exposed two real bugs: district births could spend capacity
  already taken by orbital births in the same tick; and a legal narrow gap
  between trees could disconnect a creature from the coarser route grid. Census
  capacity is now shared, and collision-checked connectors search farther grid
  rings when immediate neighbors are blocked. Neither fix skips collisions or
  restores health. Birth care costs are charged only when a birth succeeds.
- Factory maintenance is now physical, reserved work performed by healthy
  creatures. It removes actual pollution and adds no resources or free care.
  Sick hungry creatures prioritize a home/food before another wash. Cleanup and
  sickness affect candidate plan evaluation and survive saves.
- Saturated storage check: 192 detailed
  bodies, 768 objects, 145 save/history/context cycles, command/event compaction,
  and six rewinds retain at most four branches. Restored names, needs, cargo,
  commands and exact population match. Maximum save 428 KB, full context 193 KB,
  hosted context <=16 KB. Final history 2.98 MB. Live JS heap after GC is 28 MB;
  **Node RSS is 688 MB**, including temporary serialization allocations retained
  by the allocator. This is a rapid stress workload, not 688 MB per million lives.
- Full legal caretaker story run completes in 27.8 simulated minutes, with
  6,393 jobs and zero instruction violations. One neglect loss occurred before
  the deliberate catastrophe; the separate established-colony soak had none. Human reading/placement time and
  microphone accuracy remain separate.
- In the real game Options, cached Laya becomes `FP16 WebGPU ready`; Voice
  technology remains `Not loaded` until requested. Download sizes and metered
  data implications are visible before enablement. Preview checks never access
  the player's saved colony.

## Command interpretation follow-up

Live UI verification caught a valid resource command being interpreted as
conversation when unrelated colony context was appended. Laya command inference
now receives the complete player instruction; the chosen goal is subsequently
grounded in simulation state. Schedule inference retains its detailed colony
context. Explicit resource/entity words narrow possible goals, with “no goal”
always available. Factual questions return actual inventory/population facts and
cannot change directives. These guards are shared with the Jev command path.

A fixed eight-case command corpus and four wording variations now run through
both real local workers on the verification page. Initial holdout failure:
“Please help us reach 80 Tripelkins” selected blocks. Offering only goals consistent
with explicitly named resources/entities prevents that mismatch while preserving
real model choice. No goal is created by a keyword fallback while Laya is off.

Final production-preview run: all six checks pass (assets/worklet, storage,
Laya GPU/WASM, Whisper GPU/WASM). All 12 schedule fixtures and all 12 command
cases pass on each local runtime. Two factual questions are handled without
inference. Ten actual GPU command calls measured 46–62 ms; WASM equivalents
1.00–1.54 seconds. These are warm measurements on this Mac. Whisper returned
the exact synthetic sentence on both runtimes: 798 ms GPU, 2,435 ms WASM.
Live microphones/accents are not represented by that synthetic fixture.

## Reproduction and remaining device acceptance

`npm test` (46 tests), `npm run benchmark`, `npm run benchmark:scale`,
`npm run benchmark:soak`, `npm run benchmark:storage`,
`npm run verify:experience`, `npm run build`. Browser checks are
`performance.html` and `verify.html` under the deployed `/tripelkins/` path.

Actual GPU/CPU failures, background release/resume, microphone behavior and
thermal throttling vary by browser/device. The resource timer is unit tested;
full back/forward-cache and live microphone acceptance remain target-device
checks. Authenticated Jev quality/cost still requires the user's OpenRouter key.
No million-person individual-agent simulation or universal millisecond latency
is claimed. Cohorts explicitly summarize housing care and orbital census/
energy; all physical surface logistics run through the bounded worker simulation.
