# GitHub Pages deployment

The public game is served from `https://appunni-m.github.io/tripelkins/`.
Repository Settings → Pages → Build and deployment → Source must be **GitHub Actions**.
The workflow runs on pushes to `main` and can also be dispatched manually.

## Prerequisites

Use the Node, Rust and wasm-pack versions in [Contributing](../CONTRIBUTING.md).
Pages CI uses Ubuntu and Node 24, installs Rust 1.98.1 and wasm-pack 0.15.0, and
checks out full history for the pinned migration reference.

## Deployment checks

1. `npm ci` installs the committed lockfile.
2. `npm test` and `npm run verify:engine` run the Node regressions and native/WASM canonical migration comparisons.
3. `npm run build` compiles the locked Rust engine to WASM, generates software notices, copies each ONNX runtime's matching loaders and binaries, builds the game and verification pages, removes unused duplicate ONNX binaries, and writes a SHA-256 deployment manifest. Missing runtime files, invalid WASM binaries, escaped HTML base paths and oversized output fail the build.
4. GitHub uploads and deploys `dist`.
5. The verification job downloads every published manifest asset, checks JavaScript/WASM MIME types, and compares file lengths and SHA-256 hashes against a build of the same commit. It waits briefly for CDN propagation before checking.

Run the HTTP checks against the same build environment and revision as the deployment.
The command compares the local `dist/deployment-manifest.json` with the hosted
bytes; matching source commits alone do not promise identical macOS and Linux
WASM hashes. The CI verification job rebuilds on Linux. A macOS build may report
missing hashed filenames when compared with the Linux release. Use the matching
CI artifact for a manual production comparison.

For a local preview, build and serve `dist/`, then pass the URL printed by Vite
(with a trailing slash) to `npm run verify:pages`. For the matching production
artifact:

```sh
npm run verify:pages -- https://appunni-m.github.io/tripelkins/
```

Open `https://appunni-m.github.io/tripelkins/verify.html`, also linked from Options → Advanced, for browser checks:

- HTTPS, all asset URLs, and the real microphone capture AudioWorklet module.
- IndexedDB and CacheStorage write/read using disposable, isolated test storage.
- Actual Laya load and inference on FP16 WebGPU and single-thread Q8 WASM.
- Actual Whisper Base English load and transcription: FP32 encoder with a Q8 decoder on both WebGPU and WASM.
- Expected model files present in the game's browser caches.
- **25-resident audit · cached Laya GPU** measures real choices, workload and
  movement over five simulated minutes without reading saved colonies. See the
  [audit and reward breakdown](INTELLIGENCE_AUDIT.md).
- **Download resume · ~53 MB** interrupts one Laya file, resumes it in a new
  worker and checks its SHA-256 against the model's published hash. See [resumable downloads](MODEL_DOWNLOADS.md).

Speech checks use a tester-supplied local recording of “Hello little friends. Please keep everyone happy and healthy.” Choose a recording you have permission to use, up to 15 seconds and 4 MB. It is decoded at 16 kHz and never uploaded. No speech sample is shipped. Without a file, speech checks are explicitly skipped before any model download. Verification never opens the microphone. Unsupported WebGPU is also reported as skipped, not passed.

Model checks use the production workers without substitutes. Checks run sequentially and terminate workers afterward. Downloaded weights remain available to the game. Allow roughly 2 GB for all four paths including runtime/supporting files; shared cached files reduce actual transfers. The report can be downloaded as JSON.

OpenRouter/Jev requests require a player-supplied key. Test connection and an actual message separately in Options → Advanced; the verification page never collects keys or sends paid API calls. A microphone API being available does not prove permission, real microphone capture or recognition quality on every device. Those require an explicit recording check on each target device.

The `/tripelkins/engine-verify.html` page runs disposable 25/300/600-resident Rust worker checks, including rendering, pause, restore and concurrent context preparation. It does not download models or overwrite a saved colony.

## Hosting details

- Vite emits relative URLs, so the same build works at `/tripelkins/` and at the root of a custom domain, including workers and AudioWorklet files.
- In development, workers resolve ONNX files from Vite's public root. Built workers resolve them above their `assets/` directory. A shared resolver preserves the trailing slash required for dynamic module loading.
- Model weights come from Hugging Face with browser CORS. Runtime binaries come from this Pages site.
- Each Rust/WASM instance runs without shared memory: an authoritative simulation worker and a bounded read-only planning worker. Model inference retains its existing workers. No cross-origin isolation headers are required.
- HTTPS permits WebGPU, IndexedDB, CacheStorage and microphone APIs where supported by the browser.
- The game and verification page have no server, secret or backend dependency.
- `localhost` and GitHub Pages have different storage origins. Existing local worlds must be exported and imported to move them to the public site. Model caches are also downloaded separately for each origin.

## Earlier site-payload measurements

This section records the pre-Rust JavaScript payload experiment at `77fd3ce`.
Its sizes and test counts are historical. For the current engine workload, use
the [Rust migration report](RUST_ENGINE_MIGRATION.md); inspect the current
`dist/deployment-manifest.json` for current artifact sizes.

Production builds keep Three.js in its own content-hashed chunk. Changes to the
game's rendering and colony code no longer change the renderer's asset URL, so
returning browsers can reuse it from cache. This uses the same installed Three.js
package, exports and renderer settings. No game, model, prompt, sound or save
logic changes.

Debug source maps are omitted from the published package by default. To produce
a local debug build, run `BUILD_SOURCEMAPS=true npm run build`. Vite development
debugging is unaffected. Licenses, credits, verification pages and all matching
runtime binaries remain included.

Measured against commit `77fd3ce`, using the same locked dependencies:

| Measurement | Before | After |
| --- | ---: | ---: |
| Published files, including source maps, excluding the manifest itself | 121,765,795 B | 113,632,890 B |
| Initial game JavaScript, uncompressed | 894,547 B | 894,094 B |
| Initial game JavaScript, local gzip estimate | 261,174 B | 260,902 B |
| Renderer reusable independently of game chunks | bundled with game code | 533,435 B (131,044 B gzip estimate) |

The package is about 6.7% smaller; first-visit JavaScript is effectively unchanged.
The main player-facing saving is reuse of the renderer after game updates when
the browser retains its cache. Gzip figures are local estimates, not measured CDN
transfer sizes. Source maps were not part of normal game startup downloads.
CSS and the public runtime loaders/binaries match their previous SHA-256 hashes.

Verification: all 104 existing Node tests pass, the production industry preview
renders with the split renderer, and all three browser drawing workloads pass.
The performance fixture now distributes its 48 surface bodies across both
riverbanks, spanning at least 60 by 30 ground units. Collision clearance and
non-overlap are checked before simulation; jobs are planned from the new
positions. The million/billion cases still represent orbital populations as
aggregates. These are different workloads from earlier clustered benchmarks,
so their timings should not be presented as a speedup comparison.

The source-entry variant of Three.js was also measured and rejected: it increased
the renderer's gzip size by about 4 KB. Model worker code is identical apart from
the removed debug source-map links.

## Cloudflare CDN in front of GitHub Pages

Cloudflare needs a hostname on a domain you control; it cannot proxy the default `github.io` hostname. Add the hostname in Repository Settings → Pages → Custom domain, then create a Cloudflare `CNAME` from that hostname to `appunni-m.github.io` (do not append `/tripelkins/`). Keep the DNS record DNS-only until GitHub Pages has issued its HTTPS certificate. Then enable the Cloudflare proxy and set SSL/TLS mode to **Full (strict)**.

Create a Cache Rule for the exact hostname with **Eligible for cache**. Override the origin Edge TTL for successful `200–299` responses to one day; do not cache `300–599` responses. Leave Browser TTL set to respect origin headers. Enable Tiered Cache to reduce duplicate cache fills from different Cloudflare locations. After a deployment, purge this hostname so the HTML and stable-name WASM runtime files update promptly. A repeat request should show `cf-cache-status: HIT` in its response headers.

## Failed deployment and rollback

Inspect the build, deploy and verify jobs independently. A successful upload is
not a successful published-file check. A failed build leaves the prior Pages
deployment in place; a failure after publication requires checking what commit
the live `deployment-manifest.json` identifies.

For a bad application release, revert the specific offending change through a
reviewed commit on `main`, then let the normal pipeline rebuild and verify it.
Do not rewrite repository history or delete browser saves as a rollback method.
Export a colony before running an older application against it: restoring site
files does not roll back IndexedDB, and an older schema reader may reject a newer
world. Check import/restore compatibility on a disposable world first.

The public model checks are optional and may download large files. Rollback or
asset verification does not automatically run paid requests or microphone tests.
