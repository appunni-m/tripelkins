# Troubleshooting Tripelkins

Start with the symptom below. Before changing storage or importing another
world, export your colony from **Options → Saved worlds**. Avoid clearing site
data as a first step: it can remove both your saves and model downloads.

[Game guide](GAME_GUIDE.md) · [Documentation index](README.md)

## The game is blank or fails to load

1. Open the [public game](https://appunni-m.github.io/tripelkins/) over HTTPS, or
   use `npm run dev -- --host 127.0.0.1` locally. Do not open built HTML with `file://`.
2. Reload once after a deployment. Check the browser console for the first
   missing file or initialization error, rather than only later errors.
3. For local development, complete `npm ci` and the documented Rust/wasm-pack
   setup. Start through `npm run dev`; starting Vite directly can skip runtime
   and WASM preparation.
4. If a `.wasm` or `.mjs` file fails, run `npm run build` and check the matching
   URL in the served output. Keep loaders and binaries from the same build.

The published `/tripelkins/verify.html` page checks runtime assets and browser
storage. Model-specific checks need separate download consent; they are not
required to diagnose a missing static file.

## Intelligence is off, unavailable or seems idle

1. Open **Options → Intelligence**. A running colony does not imply an enabled
   model. Choose Laya or a hosted provider and complete its setup.
2. For local Laya, review the download allowance. Automatic mode expects WebGPU
   with FP16 support; it does not silently change to CPU. Select **CPU
   compatibility** explicitly if that hardware path is unavailable.
3. For Jev/OpenRouter, confirm the endpoint, model and current-tab key in
   **Options → Advanced**. Reloading a tab requires entering the key again.
   Provider errors can also mean exhausted credits or rate limits.
4. Check **Colony independence** after the population exceeds twenty and enable
   **Colony initiative** if you want autonomous development.
5. Expand **Activity** and inspect the active goal. Care needs, unavailable
   materials, blocked paths, existing commitments and occupied model slots can
   delay new work. Extra workers cannot make an impossible action feasible.

Use **Options → Advanced → Decision timing & context** to preview a fresh
choice or inspect current context. The world stays paused while these diagnostics
are open. [Decision intervals and concurrency](INTELLIGENCE_CONTROLS.md).

## A model download stopped

Retry its setup in Options. Where the host and browser support resuming, the
loader continues from saved 4 MB checkpoints. Completed files are reused.
Allow spare space: assembling a file temporarily needs checkpoints and the final
file together. Browser eviction, missing range support or changed remote content
can require a restart. Do not remove downloaded models if your aim is to resume
one. See [download recovery](MODEL_DOWNLOADS.md).

## “We couldn't hear you just now”

1. Enable talking in **Options → Controls**, approve the separate voice download
   and allow microphone access for the site.
2. Tap **Talk**, speak, then tap again to send; or hold `Space`, speak and release.
   Press `T` for a typed alternative.
3. Check **Options → Advanced → Voice technology** for **Last voice error**.
   Include that error in a report, without private transcript text.
4. If the error concerns GPU initialization or inference, try **CPU voice
   compatibility**. Voice currently uses Whisper Base English; other languages
   are outside its intended configuration.

For a controlled transcription check, `/tripelkins/verify.html` accepts a local
recording. It does not open the microphone or upload the recording. A successful
fixture does not prove microphone quality or accuracy for every speaker.

## The creatures are silent

Turn on **Sound** in Options and check the browser/tab and system volume. Click
or tap the game so the browser can activate Web Audio. Creature sounds are
synthesized reactions, not English speech. Enabling Whisper affects input, not
their sound engine.

## Movement or rendering slows in a large colony

Try one intelligence worker and a slower decision pace first; local model copies
compete for memory and GPU resources. Close unused game tabs. Each tab can have
its own renderer and workers; the worker slider is not a browser-wide quota.

The engine runs off the rendering thread, but planning and simulation still
have finite throughput. The current expanded 600-resident benchmark falls behind
real time even while drawing remains smooth. Report population, explored area,
provider/runtime and what you were doing when the slowdown occurred. Use
`engine-verify.html` for a disposable workload rather than experimenting on your
only saved colony.

## My world is paused or another tab reports a conflict

Options and hidden tabs pause advancement. A restored world also opens paused;
review needs before resuming. If another tab is writing the same saved world,
continue in a single tab and export any unsaved progress before closing the
other one. Do not overwrite storage to resolve a conflict.

## Progress is missing or a restored colony needs care

Check the origin and browser profile first. `localhost`, `127.0.0.1` and the
public site do not share storage. Open the original location to export a world,
then import it at the destination.

In **Options → Saved worlds**, inspect earlier worlds and their needs before
restoring. Restore does not simulate time spent away. A selected snapshot can
already contain low needs; where offered, **Restore with fresh care** raises
care levels and resets neglect while retaining the original save. Both recovery
paths open paused. Check the saved-world list before resetting or clearing data.

If saving fails, keep the live tab open and export immediately. Browser quotas,
private browsing restrictions, eviction and interrupted writes can affect
persistence. No browser-local save is a substitute for an exported backup.

## Report an ordinary bug

[Open an issue](https://github.com/appunni-m/tripelkins/issues) with:

- The steps and expected versus observed behavior.
- Browser/OS/device, approximate population and whether the map is expanded.
- Provider, runtime and worker count if relevant; the first error message.
- A screenshot with private data removed, or a disposable reproduction.

Do not attach API keys, private conversations or your full browser storage.
Security concerns follow the [private-reporting guidance](../SECURITY.md).
