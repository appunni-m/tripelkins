# Cloudflare Workers deployment

The production release is a GitHub Actions pipeline in
`.github/workflows/cloudflare-workers.yml`. It builds the static application,
packages it for Cloudflare Workers Static Assets, deploys it with Wrangler, and
checks the live response. Pushes to `main` deploy automatically. Manual
deployment runs are also restricted to `main`.

## GitHub and Cloudflare setup

Add these repository secrets in GitHub Settings → Secrets and variables →
Actions:

- `CLOUDFLARE_ACCOUNT_ID`: the account that owns the Worker.
- `CLOUDFLARE_API_TOKEN`: an account-scoped token with Cloudflare Workers edit
  access.

The workflow deploys the Worker named in `wrangler.jsonc`. Cloudflare creates
the `workers.dev` URL when the Worker is first deployed. GitHub shows that URL
on the `production` environment and the deployment job.

## Release pipeline

1. GitHub checks out full history, installs Node 24, Rust 1.98.1 and
   `wasm-pack` 0.15.0, then runs the existing Node and engine parity checks.
2. `npm run build` creates `dist/`, its SHA-256 deployment manifest, and the
   final `cloudflare-workers/` package.
3. The package includes Brotli (`.wasm.br`) and gzip (`.wasm.gz`) versions of
   each WASM asset and checks Cloudflare's 25 MiB per-file limit.
4. GitHub retains that exact package as a 14-day artifact. The deploy job
   downloads it and publishes it with Wrangler 4.141.0.
5. The workflow downloads every published asset and compares its decoded bytes
   with the build manifest. It also checks JavaScript and WASM MIME types and
   confirms each WASM response uses Brotli or gzip encoding.

The browser continues requesting the original `.wasm` URLs. `worker.js`
selects a `.wasm.br` or `.wasm.gz` sidecar based on `Accept-Encoding` and
returns it as `application/wasm`. The Worker marks the body as already encoded,
so the runtime does not compress it a second time. `Vary: Accept-Encoding`
keeps cached Brotli and gzip responses separate, while Cloudflare can negotiate
the response encoding supported by each browser.

The same `npm run build` output is used by GitHub Actions and Cloudflare Workers
Builds. With dependencies installed, the configured `npx wrangler deploy` and
`npx wrangler preview` commands publish or preview the package from
`wrangler.jsonc`.

Cloudflare Workers serves the existing client-side app and its pages; there is
no backend service or secret used by the game. The browser verification pages
remain available at `/engine-verify.html` and `/verify.html`. Model checks on
`verify.html` require separate download consent and may download large files.

## Rollback

Use the Worker's Deployments view in the Cloudflare dashboard to restore a
previous Worker version. A later push to `main` will publish the current source
again. Restoring site files does not roll back browser saves in IndexedDB;
export a colony before running an older application against it.
