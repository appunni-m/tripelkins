# Documentation review · 25 September 2026

## Scope and reader journeys

Reviewed the application at base revision
`00ecbb5ada2a8c972576a6cf646bee17f7fa4e36`, with the favicon/documentation changes
in this review. Profiles: end-user browser application, JavaScript application,
Rust/WASM engine and static-site deployment.

| Reader | First task and success signal | Next step / recovery |
| --- | --- | --- |
| Player | Open the game and meet the first creature without a model download | Game guide, options, troubleshooting |
| Returning player | Find intelligence, voice, exports and earlier worlds | Topic index, safe recovery steps |
| Contributor | Build the application using the pinned toolchain | Layer map, tests, worker checks, contribution route |
| Deployer | Publish the exact commit and inspect asset verification | Deployment jobs, manifest, rollback |
| Reviewer | Find data boundaries, license status and evidence limits | Security guidance, notices, migration contracts |

The README is the entry point. Detailed development, architecture, recovery and
licensing material has separate pages. Older subsystem notes remain available
as design history; the index states which runtime description takes precedence.

## Claim ledger

“Proved” below means established within the stated inspection/check scope, not a
claim of production readiness, universal compatibility or legal clearance.

| Material claim | Source of truth and check | Status |
| --- | --- | --- |
| Node 24, Rust 1.98.1, wasm-pack 0.15.0 are the project setup | Workflow, `rust-toolchain.toml`, `scripts/build-engine.mjs` | Proved configuration; not a fresh-machine install this review |
| Dev/build prepare WASM, ONNX runtimes and notices | `package.json`, preparation scripts, production build output | Proved on the existing macOS development environment |
| Simulation and planning run in Rust workers | `src/engine/worker.js`, `query-worker.js`, imports and current engine modules | Proved execution boundary; prior performance runs remain revision-bound |
| Laya and voice download allowances | `src/downloads.js`, `src/voice/model.js` | Declared estimates, not measured network transfers in this review |
| Voice uses FP32 encoder / Q8 decoder on both paths | `src/voice/model.js` | Proved configuration; corrected stale FP16 wording |
| Medium pace / one model worker default; one-to-three limit | `src/intelligence-settings.js`, options markup | Proved configuration |
| Local instincts allow first play without model setup | `src/main.js` welcome/setup flow and engine availability handling | Proved configured path; actual model quality is outside this review |
| Hosted context and transcript handling / in-memory keys | Provider adapter, brain and UI credential handling | Proved code boundary, not a security audit |
| Fonts require an external request | Google Fonts import in `src/style.css` | Proved; README no longer implies completely offline initial loading |
| Restore/pause and history boundaries | Worker, persistence adapter, Rust save/timeline implementations | Inspected; prior migration restore evidence remains in its report |
| CI checks regressions/parity before Pages; verifies published hashes | `.github/workflows/pages.yml`, deployment scripts | Proved configured workflow |
| Cross-platform source equality does not ensure identical built hashes | Prior macOS/Linux deployment comparison and strict manifest verifier | Observed limitation; deployment instructions corrected |
| Favicon variants ship with the site | Built HTML, `dist/` icon files and deployment manifest | Checked in the production build |
| No project license is declared | Repository root and package manifests | Proved absence; selecting terms requires owner action |
| Private vulnerability reporting / support commitments | No previously documented dedicated contact or support schedule | Unknown until maintainer confirms a private route |

## Validation

The review uses the Open Source documentation skill's deterministic inventory
and local-link audit, code/config inspection, the normal production build and
existing Node regression suite. Exact commands:

```sh
python3 <skill-root>/scripts/audit_documentation.py . --format json --strict
npm test
npm run build
git diff --check
```

`<skill-root>` means the installed `opensource-documentation` skill directory;
it is audit tooling, not a repository dependency. The built static HTML and icon
assets are inspected alongside the README's GitHub rendering. The
[migration contract](generated/engine-contract.md) and
[evidence report](generated/engine-migration-status.md) remain generated from
their existing sources; no counts or thresholds were manually rewritten.

The audit's broad-word warnings in the older feature/fog notes occur in statements
about things that are *not* guaranteed. The release checklist similarly records
limits of history cleanup. These are qualified limitations and are retained.
The absent project license remains a real open item, made explicit in the README
and notice guide instead of filled with assumed terms.

### Results for this change

- Existing Node regressions: 198 passed, zero failed.
- Production build: 48 manifest assets; SVG, 32-pixel ICO and 180-pixel touch PNG included.
- Documentation audit: zero errors; five review prompts (missing project license and qualified wording in this report and historical notes). No broken local links.
- Favicon artwork inspected at 16, 32, 64 and 180 pixels on light and dark backgrounds. Local preview resolves the icon URLs and logs no browser errors.
- Public GitHub metadata confirms issues are enabled, `main` is the default branch and no license is identified. The security page responds, but the anonymous response did not expose a private-reporting action; availability remains unconfirmed.
- Build emits the existing large-chunk warning. No bundle-splitting or gameplay changes are included.

## Remaining scope and limitations

- Project licensing and contribution terms require an owner decision. Existing
  dependency notices are not a license for the surrounding game.
- Private security-reporting availability needs confirmation. The guide provides
  a conditional platform route and a way to request a private contact without
  public disclosure. No response SLA or old-version support policy is invented.
- This pass does not document every Rust callable with rustdoc. The existing
  generated operation inventory is linked as an internal migration contract;
  it is not advertised as a stable SDK or complete semantic API documentation.
- No clean-machine installation, model redownload, paid provider call, microphone
  recording or new engine benchmark is part of this favicon/documentation change.
  The existing engine evidence is linked with its original scope.
- Older design notes retain JavaScript-reference paths and historical results.
  Their classification is explicit; a full rewrite of that history is not claimed.
- Accessibility behavior, all external model/license links and every supported
  browser are not exhaustively audited here. The game is still an experimental
  visual browser application.
