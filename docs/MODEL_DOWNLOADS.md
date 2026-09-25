# Resumable model downloads

Laya and Whisper share the downloader in `src/model-download.js`. If setup is
interrupted by a connection failure, tab closure, background worker release or
reload, retry setup in Options. The same browser/site resumes each unfinished
file from its last saved 4 MiB checkpoint. Up to one unfinished checkpoint may
be transferred again. Completed files retain their existing cache URLs and are
reused without a network request.

## Storage and correctness

- Partial blocks and a small index live in the model's existing CacheStorage
  cache. Nothing is added to colony snapshots or activity history. Removing a
  model's downloads also removes its checkpoints.
- Write each block before advancing its index. An interrupted write cannot
  advertise bytes that were never saved. A missing block invalidates the prefix.
- An origin-wide Web Lock serializes writers for the same cache/file across
  tabs and workers. Waiters recheck the completed cache after acquiring the lock.
- Retry with `Range: bytes=<saved-offset>-`. Check the strong ETag, total size,
  Content-Range boundaries and actual received length before appending data.
  Changed files or an ignored/unsatisfiable range restart that file safely.
- Only a complete response is published under the real model URL. Assembly
  streams one checkpoint at a time; it does not collect all blocks in a JS array.
  Retain the checkpoints until CacheStorage commits the complete response, then
  remove them. A failed final write can be retried without downloading again.
- Finalization temporarily needs both the partial blocks and the complete file
  in browser storage. Space checks account for this and keep a 32 MiB allowance
  for the game. Concurrent files and other tabs can still consume quota between
  checks; a storage failure retains committed checkpoints.
- A 60-second network inactivity timeout preserves progress. The existing load
  watchdogs refresh on worker progress, allowing a slow active download to run
  for longer than five minutes. Inference deadlines are unchanged.

## Consent and limits

Reloads and background wakeups use cache-only loading. They do not authorize
new network traffic: return to Options to resume a partial download. Fully
downloaded checkpoints can finish local assembly without network permission.
Resuming does not mean a background download continues after the tab closes.

Safe resume requires CacheStorage, Web Locks, unencoded byte responses, a strong
ETag and readable range headers. Hosts without the necessary validators, or
browsers without Web Locks, retain complete-file caching and restart interrupted
files. Missing range headers never cause unverified bytes to be appended.
Browser storage eviction, clearing downloads, changing site origins, or changing
model URLs can remove reusable progress. Existing completed model caches remain
compatible. Model weights, tokenization, inference and game state are unchanged.

The implementation uses the browser's [HTTP Range support](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Range)
and validates [Content-Range](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Range).
Single byte-range requests are CORS-safelisted; response validators still need
to be exposed by a cross-origin host.

## Verification

- `npm test`: interruption/reload, complete-file reuse, consent, ignored ranges,
  changed ETags, malformed ranges, truncation, missing blocks, failed publication,
  concurrent callers, optional 404s, and non-resumable fallbacks.
- `verify.html` → **Download resume · ~14 MB**: real HTTP, real CacheStorage and
  three successive workers. Interrupt after 4,194,304 bytes, request
  `bytes=4194304-` in the second worker, compare the completed file's SHA-256 with
  the deployment manifest, and confirm cache-only reuse in the third worker.
  The cache is disposable and never touches saved colonies or model caches.
- Current Laya FP16/Q8 and Whisper hosts returned `206`, strong ETags, valid
  Content-Range values, and CORS-exposed validators in small range probes.
  This confirms the hosts' current HTTP behavior, not uninterrupted availability.

Vite's default preview server uses weak ETags, so it intentionally takes the
complete-file fallback. Verify byte resumption on GitHub Pages or a static server
with strong validators. The local production check used the latter and matched
all 14,239,897 bytes against the build manifest.
