import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

if (!process.argv[2])
  throw new Error("Pass the deployed Worker URL as the first argument.");
const base = new URL(process.argv[2]);
if (!base.pathname.endsWith("/"))
  base.pathname += "/";
const expected = JSON.parse(
  await readFile("cloudflare-workers/deployment-manifest.json", "utf8"),
);
const brotliPaths = new Set(
  expected.delivery?.brotliAssets?.map((asset) => asset.path) || [],
);
const gzipPaths = new Set(
  expected.delivery?.gzipAssets?.map((asset) => asset.path) || [],
);
async function request(path) {
  const url = new URL(path, base);
  url.searchParams.set("deployment", expected.commit);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(180000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}
let published;
// Worker deployments can finish before every edge serves the new manifest.
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    published = await (await request("deployment-manifest.json")).json();
    if (published.commit !== expected.commit)
      throw new Error(
        `CDN serves ${published.commit}, expected ${expected.commit}`,
      );
    break;
  } catch (error) {
    if (attempt === 11) throw error;
    console.log(`Waiting for the Worker deployment: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
let next = 0,
  failures = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < expected.assets.length) {
      const asset = expected.assets[next++];
      try {
        const response = await request(asset.path);
        const mime = response.headers.get("content-type") || "";
        if (asset.path.endsWith(".wasm") && !mime.includes("application/wasm"))
          throw new Error(`WASM MIME is ${mime}`);
        if (brotliPaths.has(asset.path) || gzipPaths.has(asset.path)) {
          const encoding = response.headers.get("content-encoding");
          if (encoding !== "br" && encoding !== "gzip")
            throw new Error(`WASM response has unexpected Content-Encoding: ${encoding}`);
        }
        if (/\.(?:m?js)$/.test(asset.path) && !/(?:java|ecma)script/.test(mime))
          throw new Error(`JavaScript MIME is ${mime}`);
        const hash = createHash("sha256");
        let bytes = 0;
        for await (const part of response.body) {
          hash.update(part);
          bytes += part.length;
        }
        if (bytes !== asset.bytes || hash.digest("hex") !== asset.sha256)
          throw new Error("Downloaded bytes differ from the build artifact");
        console.log(`PASS ${asset.path} (${bytes} bytes)`);
      } catch (error) {
        failures++;
        console.error(`FAIL ${asset.path}: ${error.message}`);
      }
    }
  }),
);
if (failures)
  throw new Error(`${failures} deployed asset(s) failed verification.`);
console.log(
  `Verified ${expected.assets.length} Cloudflare Worker assets for ${published.commit} at ${base.href}`,
);
