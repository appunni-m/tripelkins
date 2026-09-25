// Verification only: real HTTP, CacheStorage and Web Locks in a fresh worker.
// No model is initialized and no player cache or saved world is opened.
import { createModelDownloader, DOWNLOAD_CHUNK_BYTES } from "./model-download.js";
self.onmessage = async ({ data }) => {
  const { id, url, cacheName, interrupt = false, cachedOnly = false } = data;
  const controller = new AbortController(), ranges = [];
  let saved = 0;
  const download = createModelDownloader({ fetcher: (input, options) => {
    ranges.push(options.headers.get("range"));
    return fetch(input, options);
  } });
  try {
    if (!navigator.locks) throw new Error("Web Locks are unavailable.");
    const response = await download(url, {
      cacheName, allowDownload: !cachedOnly, requestInit: { signal: controller.signal },
      onProgress: progress => {
        if (progress.phase === "checkpoint") {
          saved = progress.loaded;
          if (interrupt && saved >= DOWNLOAD_CHUNK_BYTES) controller.abort(new Error("Intentional checkpoint interruption"));
        }
        self.postMessage({ id, type: "progress", ...progress });
      },
    });
    if (!response.ok) throw new Error(`Download returned HTTP ${response.status}.`);
    if (interrupt) throw new Error("The host did not provide a resumable response.");
    const body = await response.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", body);
    const sha256 = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    self.postMessage({ id, type: "result", result: { bytes: body.byteLength, sha256, ranges } });
  } catch (error) {
    if (interrupt && controller.signal.aborted && saved >= DOWNLOAD_CHUNK_BYTES)
      self.postMessage({ id, type: "result", result: { interrupted: true, saved, ranges } });
    else self.postMessage({ id, type: "error", error: error.message });
  }
};
