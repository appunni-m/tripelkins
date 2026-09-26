<p align="center"><img src="public/favicon.svg" width="96" height="96" alt="A cheerful lilac Tripelkin with pink ears and a cream muzzle"></p>

# Tripelkins

**If one of them survives, everyone survives.**

Nurture a small colony of cheerful creatures. Watch them multiply, explore through the fog, gather materials and build a home. Once the colony grows beyond twenty, you can let it become independent, with optional intelligence choosing how it works together.

**[Play in your browser](https://appunni-m.github.io/tripelkins/)** · [Game guide](docs/GAME_GUIDE.md) · [Documentation](docs/README.md) · [Contributing](CONTRIBUTING.md)

Tripelkins is an experimental browser game. It runs on a static site with a Rust/WASM simulation, Three.js rendering and browser-local saves. Intelligence and speech are optional; **no model download or API key is needed to start playing**. Performance and WebGPU support depend on your device. The project has not declared a license for its own code and artwork; see [licensing status](#license-and-credits).

## Your first colony

1. Open the game and enter the clearing. Tap the spacecraft to meet your first Tripelkin.
2. Use **Care** to offer a banana, wash with a cloth, or play with a cricket ball. Healthy residents multiply.
3. Pan and zoom to follow them. Open **Build** as new facilities become available.
4. Read colony messages in the **inbox**. Expand **Activity** to see work and intelligence decisions.
5. When the colony asks for independence, choose whether to allow it. Enable intelligence in **Options → Intelligence** for autonomous development and conversations.

| Control | Action |
| --- | --- |
| Drag / arrow keys | Move the camera |
| Scroll / pinch / `+` / `−` | Zoom |
| **COLONY** | Return to your residents |
| `P` / **Options** | Pause / open the paused options screen |
| `T` | Type to the colony |
| Hold `Space`, then release | Talk after enabling voice |
| Tap **Talk**, then tap again | Start and send a recording |

See [playing and saving](docs/GAME_GUIDE.md) or [troubleshooting](docs/TROUBLESHOOTING.md).

## Optional intelligence and voice

The game starts with built-in instincts. Laya makes decisions locally; Jev and the OpenRouter chat adapter send bounded colony context to your chosen endpoint. Models choose validated plans and lasting goals. The engine checks resource availability, access and current commands before applying them.

| Option | Where it runs | Download allowance |
| --- | --- | ---: |
| Laya · CPU compatibility | Single-thread WASM workers | About 600 MB |
| Laya · WebGPU | GPU model workers | About 950 MB |
| Whisper Base English · voice | Local WASM or WebGPU worker | About 180 MB |
| Jev / OpenRouter chat | Configured hosted endpoint | No local model weights; provider charges may apply |

Allowances include supporting files and are shown before you approve a download. Completed files are reused; interrupted transfers can resume from saved checkpoints where supported. Browser eviction or changed files can require another download. See [download behavior](docs/MODEL_DOWNLOADS.md).

**Options → Intelligence** controls decision speed and concurrency. One worker is the default. More local copies need more memory and may compete for the same GPU; hosted concurrency may increase API spending. See [pace and worker limits](docs/INTELLIGENCE_CONTROLS.md).

Voice transcribes English locally. Raw recordings are not saved or uploaded. With hosted intelligence selected, recognized words and bounded colony context are sent to the configured endpoint. API keys stay in the current tab and are not saved or exported. The site also requests fonts from Google Fonts and approved model files from Hugging Face; local inference does not make initial loading network-free. See [data and trust boundaries](SECURITY.md).

## Saved on your device

Worlds, names, goals, conversations, explored terrain, camera state and bounded history are stored in IndexedDB. There is no account or cloud sync. Paused and hidden tabs do not advance the simulation.

Use **Options → Saved worlds** to export a backup, import a world, or return to an earlier moment. Restored worlds open paused. An export contains the world, not the complete rewind database or downloaded models. Browsers, devices, `localhost` and the public site have separate storage. [Save and recovery details](docs/CONTEXT_ARCHITECTURE.md).

## Run locally

Use **Node.js 24**, **Rust 1.98.1** through rustup, and **wasm-pack 0.15.0**. These match the repository's toolchain and CI configuration.

```sh
git clone git@github.com:appunni-m/tripelkins.git
cd tripelkins
cargo install wasm-pack --version 0.15.0 --locked
npm ci
npm run dev -- --host 127.0.0.1
```

Open [localhost:5173/tripelkins/](http://localhost:5173/tripelkins/). The repository's `rust-toolchain.toml` selects Rust and the WASM target. The first start compiles the engine and prepares browser runtime files; subsequent starts reuse unchanged engine output. Public HTTPS cloning is also available from the repository's **Code** menu.

For a production build:

```sh
npm run build
npm run preview -- --host 127.0.0.1
```

Vite prints the preview URL. Serve `dist/` over HTTP; opening `index.html` as a local file will not run the workers correctly. No game server or cross-origin isolation headers are required. The default scripts bind all interfaces unless you pass the local-only host override above.

## Develop and deploy

- [Contributor guide](CONTRIBUTING.md): repository layout, checks and change workflow.
- [Architecture](docs/ARCHITECTURE.md): authoritative simulation, planning, inference and saves.
- [Engine migration report](docs/RUST_ENGINE_MIGRATION.md): parity evidence and measured performance limits.
- [Generated engine contract](docs/generated/engine-contract.md): the migration's operation inventory; not a stable external SDK.
- [Cloudflare Workers deployment](docs/DEPLOYMENT.md): GitHub Actions build, publish, asset verification and recovery.

Pushes to `main` run the existing checks, package WASM with Brotli and gzip variants, deploy to Cloudflare Workers, then verify published hashes and response headers. The `production` environment in GitHub Actions shows the deployed Worker URL. Browser checks at `/engine-verify.html` use disposable colonies; model checks at `/verify.html` require separate download consent.

## Help and contribution

For ordinary bugs or suggestions, [open an issue](https://github.com/appunni-m/tripelkins/issues). Include reproduction steps, browser/device, population and provider/runtime if relevant. Remove API keys and private conversation text from diagnostics. Read [troubleshooting](docs/TROUBLESHOOTING.md) first and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Security concerns follow [SECURITY.md](SECURITY.md).

## License and credits

**No project license is currently declared.** This repository does not grant an open-source license for the game's own code or artwork. Dependency licenses do not provide that permission. A project license requires the owner's decision.

Third-party software, fonts and optional models retain their respective terms. [Third-party notices](THIRD_PARTY_NOTICES.md) explain their sources; the built game includes **Options → Advanced → Credits & licenses**. The [release checklist](docs/RELEASE_CHECKLIST.md) records outstanding human review separately from automated checks.
