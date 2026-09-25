// Completed files keep their existing cache keys. Partial data lives alongside
// them, so removing a model's cache also removes its interrupted downloads.
export const DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const PART = "__tripelkins_download_part__";
const keyFor = (url, part) => {
  const key = new URL(url);
  key.searchParams.set(PART, String(part));
  return key.href;
};
const strongTag = headers => {
  const tag = headers.get("etag");
  return tag?.startsWith('"') && tag.endsWith('"') ? tag : null;
};
const lengthOf = headers => {
  const value = Number(headers.get("content-length"));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
};

export function createModelDownloader({
  storage = globalThis.caches,
  locks = globalThis.navigator?.locks,
  fetcher = (...args) => fetch(...args),
  estimate = () => globalThis.navigator?.storage?.estimate?.(),
  chunkBytes = DOWNLOAD_CHUNK_BYTES,
} = {}) {
  async function discard(cache, url) {
    for (const request of await cache.keys()) {
      const key = new URL(request.url);
      if (!key.searchParams.has(PART)) continue;
      key.searchParams.delete(PART);
      if (key.href === url) await cache.delete(request);
    }
  }
  async function checkpoint(cache, url) {
    const saved = await cache.match(keyFor(url, "index"));
    if (!saved) return null;
    try {
      const meta = await saved.json();
      if (meta.version !== 1 || meta.chunkBytes !== chunkBytes ||
          !Number.isSafeInteger(meta.total) || meta.total <= 0 ||
          !Number.isSafeInteger(meta.loaded) || meta.loaded < 0 || meta.loaded > meta.total ||
          meta.parts !== Math.ceil(meta.loaded / chunkBytes) ||
          (!meta.complete && meta.loaded % chunkBytes !== 0) ||
          (meta.complete && meta.loaded !== meta.total) ||
          !strongTag(new Headers({ etag: meta.etag || "" }))) throw new Error();
      // A tab may have closed between a part write and its index update. Only
      // indexed parts count; an unindexed tail is safely overwritten on retry.
      for (let part = 0; part < meta.parts; part++) {
        const stored = await cache.match(keyFor(url, part));
        const size = stored && lengthOf(stored.headers);
        await stored?.body?.cancel();
        if (size !== Math.min(chunkBytes, meta.loaded - part * chunkBytes))
          throw new Error();
      }
      return meta;
    } catch {
      await discard(cache, url);
      return null;
    }
  }
  async function room(bytes) {
    const space = await estimate()?.catch(() => null);
    if (space?.quota && space.quota - (space.usage || 0) < bytes + 32 * 1048576)
      throw new Error("Not enough browser storage to finish the model download. Saved progress is kept; free space and retry in Options.");
  }
  async function publish(cache, url, meta) {
    // Cache.put commits only a complete response. Keep every checkpoint until
    // that succeeds, even if the tab closes while assembling the final file.
    await room(meta.total);
    let part = 0;
    const body = new ReadableStream({
      async pull(controller) {
        if (part === meta.parts) { controller.close(); return; }
        const stored = await cache.match(keyFor(url, part));
        if (!stored) throw new Error("A download checkpoint was removed. Retry in Options.");
        const data = new Uint8Array(await stored.arrayBuffer());
        if (data.length !== Math.min(chunkBytes, meta.total - part * chunkBytes))
          throw new Error("A download checkpoint is incomplete. Retry in Options.");
        part++;
        controller.enqueue(data);
      },
    });
    await cache.put(url, new Response(body, { headers: {
      "Content-Type": meta.type, "Content-Length": String(meta.total), ETag: meta.etag,
    } }));
    const result = await cache.match(url);
    if (!result) throw new Error("The completed download could not be saved. Retry in Options.");
    await discard(cache, url).catch(() => {});
    return result;
  }
  return async function modelFile(input, {
    cacheName, allowDownload = false, onProgress = () => {}, requestInit = {},
  } = {}) {
    const url = new URL(input).href, file = new URL(url).pathname.split("/").pop();
    let lastReport = -Infinity, lastPhase;
    const report = data => {
      const now = performance.now();
      if (data.phase === lastPhase && data.loaded < data.total && now - lastReport < 250) return;
      lastReport = now; lastPhase = data.phase;
      onProgress({ file, ...data });
    };
    const run = async () => {
      if (!storage?.open) throw new Error("Browser download storage is unavailable. Enable browser storage and retry in Options.");
      const cache = await storage.open(cacheName);
      const hit = await cache.match(url);
      if (hit) {
        if (locks?.request) await discard(cache, url).catch(() => {});
        report({ phase: "cached", loaded: lengthOf(hit.headers), total: lengthOf(hit.headers) });
        return hit;
      }
      // Without cross-worker locking, retain the complete-file cache behavior
      // but don't let concurrent writers mutate the same checkpoint journal.
      let meta = locks?.request ? await checkpoint(cache, url) : null;
      if (meta?.complete) {
        report({ phase: "saving", loaded: meta.total, total: meta.total });
        return publish(cache, url, meta);
      }
      if (!allowDownload) return new Response(null, { status: 404 });
      let restarted = false;
      for (;;) {
        const controller = new AbortController();
        let timer;
        const touch = () => {
          clearTimeout(timer);
          timer = setTimeout(() => controller.abort(new Error("The model download stopped receiving data. Retry in Options to resume.")), 60000);
        };
        const signal = requestInit.signal
          ? AbortSignal.any([requestInit.signal, controller.signal]) : controller.signal;
        let response, reader;
        try {
          touch();
          const headers = new Headers(requestInit.headers);
          if (meta?.loaded) headers.set("Range", `bytes=${meta.loaded}-`);
          response = await fetcher(url, { ...requestInit, headers, signal, cache: "no-store" });
          touch();
          if (meta && response.status === 416 && !restarted) {
            await response.body?.cancel();
            await discard(cache, url);
            meta = null; restarted = true;
            report({ phase: "restart", message: `The saved range of ${file} is no longer available; restarting this file.` });
            continue;
          }
          if (meta && response.status === 206) {
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
            if (strongTag(response.headers) !== meta.etag ||
                (range && Number(range[3]) !== meta.total)) {
              await response.body?.cancel();
              await discard(cache, url);
              meta = null;
              if (restarted) throw new Error("The model file keeps changing. Retry later.");
              restarted = true;
              report({ phase: "restart", message: `${file} changed on the server; restarting this file safely.` });
              continue;
            }
            if (!range || Number(range[1]) !== meta.loaded || Number(range[2]) !== meta.total - 1 ||
                (response.headers.get("content-encoding") && response.headers.get("content-encoding") !== "identity"))
              throw new Error("The model host returned an invalid download range. Saved progress is kept; retry in Options.");
          } else if (response.status === 200) {
            if (meta) {
              await discard(cache, url);
              report({ phase: "restart", message: `The host restarted ${file}; downloading a complete file.` });
            }
            meta = null;
            const total = lengthOf(response.headers), etag = strongTag(response.headers);
            const encoded = response.headers.get("content-encoding");
            if (locks?.request && total && etag && (!encoded || encoded === "identity")) {
              meta = { version: 1, chunkBytes, total, etag, loaded: 0, parts: 0, complete: false,
                type: response.headers.get("content-type") || "application/octet-stream" };
            }
          } else {
            if (response.status === 206) throw new Error("The model host sent an unexpected partial file.");
            return response; // Preserve optional-file 404s for Transformers.
          }
          if (!meta) {
            // Hosts without a visible strong ETag/size (or compressed HTTP
            // bodies) cannot be safely resumed. Never append those responses.
            let loaded = 0;
            const total = lengthOf(response.headers);
            await room(total);
            report({ phase: "download", loaded, total, resumable: false });
            const encoded = response.headers.get("content-encoding");
            const body = response.body.pipeThrough(new TransformStream({
              transform(chunk, out) {
                touch(); loaded += chunk.byteLength;
                report({ phase: "download", loaded, total, resumable: false });
                out.enqueue(chunk);
              },
              flush() {
                if (total && (!encoded || encoded === "identity") && loaded !== total)
                  throw new Error("The model download ended before the complete file arrived.");
              },
            }));
            const storedHeaders = new Headers(response.headers);
            if (encoded && encoded !== "identity") {
              // Fetch already decoded the body; don't retain encoded byte counts.
              storedHeaders.delete("content-encoding");
              storedHeaders.delete("content-length");
            }
            await cache.put(url, new Response(body, { headers: storedHeaders }));
          } else {
            await room(meta.total + meta.total - meta.loaded);
            const resumed = meta.loaded;
            report({ phase: resumed ? "resume" : "download", loaded: resumed, total: meta.total, resumed });
            reader = response.body.getReader();
            const buffer = new Uint8Array(chunkBytes);
            let used = 0, received = meta.loaded;
            const savePart = async complete => {
              await cache.put(keyFor(url, meta.parts), new Response(buffer.subarray(0, used), {
                headers: { "Content-Length": String(used) },
              }));
              meta = { ...meta, loaded: meta.loaded + used, parts: meta.parts + 1, complete };
              await cache.put(keyFor(url, "index"), new Response(JSON.stringify(meta)));
              used = 0;
              report({ phase: "checkpoint", loaded: meta.loaded, total: meta.total, resumed });
              signal.throwIfAborted();
            };
            for (;;) {
              signal.throwIfAborted();
              const { value, done } = await reader.read();
              signal.throwIfAborted();
              touch();
              if (done) break;
              received += value.byteLength;
              if (received > meta.total) throw new Error("The model host sent more bytes than expected.");
              for (let offset = 0; offset < value.length;) {
                const size = Math.min(chunkBytes - used, value.length - offset);
                buffer.set(value.subarray(offset, offset + size), used);
                offset += size; used += size;
                // The last part is committed only after EOF and size validation.
                if (used === chunkBytes && meta.loaded + used < meta.total) await savePart(false);
              }
              report({ phase: "download", loaded: received, total: meta.total, resumed });
            }
            if (received !== meta.total) throw new Error("The model download was interrupted. Saved progress is kept; retry in Options to resume.");
            await savePart(true);
            clearTimeout(timer);
            report({ phase: "saving", loaded: meta.total, total: meta.total, resumed });
            return await publish(cache, url, meta);
          }
          const stored = await cache.match(url);
          if (!stored) throw new Error("The completed download could not be saved.");
          return stored;
        } catch (error) {
          if (error.name === "QuotaExceededError")
            throw new Error("Browser storage filled during the model download. Saved progress is kept; free space and retry in Options.");
          if (signal.aborted) throw signal.reason;
          throw new Error(`${error.message || "Model download interrupted."} Retry in Options; any saved download progress will be reused.`, { cause: error });
        } finally {
          clearTimeout(timer);
          await (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => {});
        }
      }
    };
    return locks?.request
      ? locks.request(`tripelkins-model:${cacheName}:${url}`, requestInit.signal ? { signal: requestInit.signal } : {}, run)
      : run();
  };
}

export const fetchModelFile = createModelDownloader();
