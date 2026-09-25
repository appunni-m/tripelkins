# GitHub Pages deployment

The public game is served from `https://appunni-m.github.io/tripelkins/`.
Repository Settings → Pages → Build and deployment → Source must be **GitHub Actions**.
The workflow runs on pushes to `main` and can also be dispatched manually.

## Deployment checks

1. `npm ci` installs the committed lockfile.
2. `npm run build` copies each ONNX runtime's matching loaders and binaries, builds both pages, removes unused duplicate binaries, and writes a SHA-256 deployment manifest. Missing runtime files, invalid WASM binaries, escaped HTML base paths and oversized output fail the build.
3. GitHub uploads and deploys `dist`.
4. The verification job downloads every published manifest asset, checks JavaScript/WASM MIME types, and compares file lengths and SHA-256 hashes against a build of the same commit. It waits briefly for CDN propagation before checking.

Run the HTTP checks locally after building:

```sh
npm run verify:pages -- https://appunni-m.github.io/tripelkins/
```

Open `https://appunni-m.github.io/tripelkins/verify.html`, also linked from Options → Advanced, for browser checks:

- HTTPS, all asset URLs, and the real microphone capture AudioWorklet module.
- IndexedDB and CacheStorage write/read using disposable, isolated test storage.
- Actual Laya load and inference on FP16 WebGPU and single-thread Q8 WASM.
- Actual Whisper Base English load and transcription: FP32 encoder with FP16 WebGPU or Q8 WASM decoder.
- Expected model files present in the game's browser caches.

Speech checks use a tester-supplied local recording of “Hello little friends. Please keep everyone happy and healthy.” Choose a recording you have permission to use, up to 15 seconds and 4 MB. It is decoded at 16 kHz and never uploaded. No speech sample is shipped. Without a file, speech checks are explicitly skipped before any model download. Verification never opens the microphone. Unsupported WebGPU is also reported as skipped, not passed.

Model checks use the production workers without substitutes. Checks run sequentially and terminate workers afterward. Downloaded weights remain available to the game. Allow roughly 2 GB for all four paths including runtime/supporting files; shared cached files reduce actual transfers. The report can be downloaded as JSON.

OpenRouter/Jev requests require a player-supplied key. Test connection and an actual message separately in Options → Advanced; the verification page never collects keys or sends paid API calls. A microphone API being available does not prove permission, real microphone capture or recognition quality on every device. Those require an explicit recording check on each target device.

## Hosting details

- Vite emits relative URLs, so the same build works at `/tripelkins/` and at the root of a custom domain, including workers and AudioWorklet files.
- In development, workers resolve ONNX files from Vite's public root. Built workers resolve them above their `assets/` directory. A shared resolver preserves the trailing slash required for dynamic module loading.
- Model weights come from Hugging Face with browser CORS. Runtime binaries come from this Pages site.
- One WASM thread avoids requiring cross-origin isolation headers on GitHub Pages.
- HTTPS permits WebGPU, IndexedDB, CacheStorage and microphone APIs where supported by the browser.
- The game and verification page have no server, secret or backend dependency.
- `localhost` and GitHub Pages have different storage origins. Existing local worlds must be exported and imported to move them to the public site. Model caches are also downloaded separately for each origin.

## Cloudflare CDN in front of GitHub Pages

Cloudflare needs a hostname on a domain you control; it cannot proxy the default `github.io` hostname. Add the hostname in Repository Settings → Pages → Custom domain, then create a Cloudflare `CNAME` from that hostname to `appunni-m.github.io` (do not append `/tripelkins/`). Keep the DNS record DNS-only until GitHub Pages has issued its HTTPS certificate. Then enable the Cloudflare proxy and set SSL/TLS mode to **Full (strict)**.

Create a Cache Rule for the exact hostname with **Eligible for cache**. Override the origin Edge TTL for successful `200–299` responses to one day; do not cache `300–599` responses. Leave Browser TTL set to respect origin headers. Enable Tiered Cache to reduce duplicate cache fills from different Cloudflare locations. After a deployment, purge this hostname so the HTML and stable-name WASM runtime files update promptly. A repeat request should show `cf-cache-status: HIT` in its response headers.
