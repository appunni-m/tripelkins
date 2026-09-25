import test from "node:test";
import assert from "node:assert/strict";
import { createModelDownloader } from "../src/model-download.js";

const url = "https://models.example/weights.onnx";
const data = Uint8Array.from({ length: 19 }, (_, i) => i + 1);
const output = response => response.arrayBuffer().then(b => new Uint8Array(b));
function environment() {
  const entries = new Map(), queues = new Map();
  const key = value => typeof value === "string" ? value : value.url;
  const cache = {
    async match(value) {
      const saved = entries.get(key(value));
      return saved ? new Response(saved.bytes, { headers: saved.headers }) : undefined;
    },
    async put(value, response) {
      assert.notEqual(response.status, 206, "CacheStorage cannot store a 206 response");
      const bytes = await response.arrayBuffer(); // Commit only after EOF.
      entries.set(key(value), { bytes, headers: [...response.headers] });
    },
    async delete(value) { return entries.delete(key(value)); },
    async keys() { return [...entries.keys()].map(value => new Request(value)); },
  };
  const locks = { request(name, options, callback) {
    const run = (queues.get(name) || Promise.resolve()).then(() => {
      options.signal?.throwIfAborted();
      return callback();
    });
    queues.set(name, run.catch(() => {}));
    return run;
  } };
  return { cache, entries, options: { storage: { open: async () => cache }, locks,
    chunkBytes: 4, estimate: async () => ({ quota: 1e9, usage: 0 }) } };
}
function response(bytes = data, { start = 0, etag = '"version-1"', fail = false,
  full = false, wrongStart = false, truncate = false } = {}) {
  let sent = false;
  const body = fail ? new ReadableStream({ pull(controller) {
    if (sent) { controller.error(new TypeError("Connection lost")); return; }
    sent = true;
    controller.enqueue(bytes.slice(start, start + 10));
  } }) : bytes.slice(start, truncate ? bytes.length - 1 : undefined);
  const headers = { "Content-Length": String(bytes.length - start), "Content-Type": "application/octet-stream" };
  if (etag) headers.ETag = etag;
  if (start && !full) headers["Content-Range"] = `bytes ${start + Number(wrongStart)}-${bytes.length - 1}/${bytes.length}`;
  return new Response(body, { status: start && !full ? 206 : 200, headers });
}
async function interrupted(env) {
  const download = createModelDownloader({ ...env.options, fetcher: async () => response(data, { fail: true }) });
  await assert.rejects(download(url, { cacheName: "test", allowDownload: true }), /Connection lost/);
  assert.equal(await env.cache.match(url), undefined, "partial bytes must never be exposed as a complete model");
}

test("a new downloader resumes persisted checkpoints after an interruption and reuses the completed file", async () => {
  const env = environment(); await interrupted(env);
  let calls = 0;
  const download = createModelDownloader({ ...env.options, fetcher: async (_, init) => {
    calls++; assert.equal(init.headers.get("range"), "bytes=8-");
    return response(data, { start: 8 });
  } });
  assert.deepEqual(await output(await download(url, { cacheName: "test", allowDownload: true })), data);
  assert.deepEqual(await output(await download(url, { cacheName: "test" })), data);
  assert.equal(calls, 1);
  assert.deepEqual([...env.entries.keys()], [url], "checkpoints must be removed after publication");
});

test("a background cache-only load never resumes network traffic without download consent", async () => {
  const env = environment(); await interrupted(env);
  const download = createModelDownloader({ ...env.options, fetcher: () => { throw new Error("Unexpected network"); } });
  assert.equal((await download(url, { cacheName: "test" })).status, 404);
  assert.ok(env.entries.size > 0);
});

test("an ignored Range response replaces the prefix instead of appending a whole file to it", async () => {
  const env = environment(); await interrupted(env);
  const download = createModelDownloader({ ...env.options, fetcher: async () => response() });
  assert.deepEqual(await output(await download(url, { cacheName: "test", allowDownload: true })), data);
});

test("a changed ETag restarts the file and never mixes old and new bytes", async () => {
  const env = environment(); await interrupted(env);
  const changed = data.map(n => n + 50), ranges = [];
  const download = createModelDownloader({ ...env.options, fetcher: async (_, init) => {
    const range = init.headers.get("range"); ranges.push(range);
    return response(changed, { start: range ? 8 : 0, etag: '"version-2"' });
  } });
  assert.deepEqual(await output(await download(url, { cacheName: "test", allowDownload: true })), changed);
  assert.deepEqual(ranges, ["bytes=8-", null]);
});

test("invalid ranges and truncated tails cannot publish an incomplete model", async () => {
  for (const broken of [{ wrongStart: true }, { truncate: true }]) {
    const env = environment(); await interrupted(env);
    const download = createModelDownloader({ ...env.options, fetcher: async () => response(data, { start: 8, ...broken }) });
    await assert.rejects(download(url, { cacheName: "test", allowDownload: true }));
    assert.equal(await env.cache.match(url), undefined);
  }
});

test("a missing saved part restarts instead of returning corrupted bytes", async () => {
  const env = environment(); await interrupted(env);
  env.entries.delete([...env.entries.keys()].find(k => k.endsWith("=0")));
  const download = createModelDownloader({ ...env.options, fetcher: async (_, init) => {
    assert.equal(init.headers.get("range"), null); return response();
  } });
  assert.deepEqual(await output(await download(url, { cacheName: "test", allowDownload: true })), data);
});

test("complete checkpoints survive a failed final cache write and finish offline", async () => {
  const env = environment(), put = env.cache.put;
  env.cache.put = async (key, value) => {
    if (key === url) throw new DOMException("Full", "QuotaExceededError");
    return put(key, value);
  };
  const first = createModelDownloader({ ...env.options, fetcher: async () => response() });
  await assert.rejects(first(url, { cacheName: "test", allowDownload: true }), /storage filled/);
  env.cache.put = put;
  const next = createModelDownloader({ ...env.options, fetcher: () => { throw new Error("Unexpected network"); } });
  assert.deepEqual(await output(await next(url, { cacheName: "test" })), data);
  assert.deepEqual([...env.entries.keys()], [url]);
});

test("concurrent worker downloaders share one transfer through the origin lock", async () => {
  const env = environment(); let calls = 0;
  const options = { ...env.options, fetcher: async () => { calls++; return response(); } };
  const first = createModelDownloader(options), second = createModelDownloader(options);
  const responses = await Promise.all([first, second].map(fn => fn(url, { cacheName: "test", allowDownload: true })));
  for (const value of responses) assert.deepEqual(await output(value), data);
  assert.equal(calls, 1);
});

test("non-resumable hosts preserve complete caching and reject short bodies", async () => {
  for (const etag of [null, 'W/"weak"']) {
    const env = environment();
    const download = createModelDownloader({ ...env.options, fetcher: async () => response(data, { etag }) });
    assert.deepEqual(await output(await download(url, { cacheName: "test", allowDownload: true })), data);
    assert.deepEqual([...env.entries.keys()], [url]);
  }
  const env = environment();
  const download = createModelDownloader({ ...env.options, fetcher: async () => response(data, { etag: null, truncate: true }) });
  await assert.rejects(download(url, { cacheName: "test", allowDownload: true }));
  assert.equal(await env.cache.match(url), undefined);
});

test("a server's unsatisfiable range restarts and optional-file 404s remain optional", async () => {
  const env = environment(); await interrupted(env); let calls = 0;
  const download = createModelDownloader({ ...env.options, fetcher: async () => ++calls === 1
    ? new Response(null, { status: 416 }) : response() });
  assert.deepEqual(await output(await download(url, { cacheName: "test", allowDownload: true })), data);
  const optional = createModelDownloader({ ...environment().options, fetcher: async () => new Response(null, { status: 404 }) });
  assert.equal((await optional(url, { cacheName: "test", allowDownload: true })).status, 404);
});

test("lack of Web Locks falls back to a complete download without unsafe partial writes", async () => {
  const env = environment();
  const download = createModelDownloader({ ...env.options, locks: null, fetcher: async () => response() });
  assert.deepEqual(await output(await download(url, { cacheName: "test", allowDownload: true })), data);
  assert.deepEqual([...env.entries.keys()], [url]);
});
