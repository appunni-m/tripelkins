# Talking in the clearing

## Controls

- **Hold Space** or hold the microphone button to record. **Release to send.** Clips stop automatically after 15 seconds.
- First enable intelligence in Options → Intelligence. Talking while intelligence is off opens that setup page. Whisper is a separate opt-in download in Options → Controls: the confirmation shows the selected runtime, approximate data/storage allowance (180 MB WASM or 180 MB WebGPU including supporting files), metered-data costs and a skip choice. Technical details stay inside Options. The enabled setting and successful runtime are saved. Returning players and idle wakeups use cached files only; missing files require another explicit download review. Finding a cache does not turn voice on. Enabling talking leaves Options open and the game paused.
- Microphone permission is requested on the first recording. If you release while the permission prompt is open, that attempt is cancelled; hold again after allowing access.
- Your recognized words appear as subtitles. The selected provider interprets them automatically, and the colony answers with wordless sounds and translated subtitles. There is no English text-to-speech.
- **T** or the keyboard button opens a small typing field. Failed messages stay there for correction or retry. Conversation history is available in the journal.
- **P** pauses the game. **Escape** cancels a recording or pending conversation. Other windows, tab hiding, focus loss during capture, and page exit stop microphone capture.
- The game remains visible and continues during normal conversation. Options pauses simulation and creature animation like other game dialogs, and closing it restores the previous pause state. Conversation requests and microphone capture are cancelled when opening a dialog.

## Their sound

The sound engine uses vowel-like periodic waves, gentle pitch slides, quantized harmonics and layered choir voices. Goal acceptance and blocked requests have different melodic contours. All sounds are synthesized locally.

### Everyday creature life

Creature sound is independent of Laya, OpenRouter and Whisper. The first pointer or keyboard gesture unlocks browser audio. Living creatures near the camera make occasional calls, answer nearby companions, and sometimes sing together. Eating, washing, playing, work, new births and unmet needs have distinct melodic phrases. Inspecting a creature gets a little greeting. A colony with no living creatures, or a camera far away from them, is quiet.

Actual movement and work drive footstep frames, eating poses, washing bubbles, play hops, lifting and tool gestures. Singing mouths and small body pulses use the same note timing as the audio. Need symbols reflect food, cleanliness or amusement; birth sparkles only follow actual additions or replication. Played-with balls bounce. Reduced-motion preferences suppress hopping, shaking and bouncing. None of these effects invent completed jobs or change the game simulation.

`colony-life.js` keeps one presentation record per living creature and at most eight expiring calls. There is a minimum 1.5-second gap between call starts, a per-creature cooldown and at most six simultaneous synthesized voices. Nearby sound is panned across the screen and quieter at its edges. A shared compressor controls the mix. Web Audio nodes disconnect when they finish. Sprite frames and effect types come from a finite set; there is no audio download, AI request or per-frame save/history entry.

Muting, pausing, opening Options, hiding the page or starting microphone capture stops creature audio. Recording and command interpretation suppress ambient calls; replies take priority. Restoring or switching a world resets transient presentation state and does not replay its history. Visual reactions remain available with sound muted.

## Local transcription

[Whisper Base English ONNX](https://huggingface.co/onnx-community/whisper-base.en) replaces Tiny in the dedicated Transformers.js worker. Base has 74 million parameters versus Tiny's 39 million; the English-only checkpoint fits the game's existing English speech controls. Recognition improvement on a particular microphone/accent is not yet measured. [OpenAI's model card](https://huggingface.co/openai/whisper-base.en).

The encoder remains **FP32 on both runtimes**, because Whisper encoders are sensitive to quantization. The decoder uses **Q8 on both WebGPU and single-thread WASM**. Weight downloads are approximately **137 MB on either backend**, with full allowances of **180 MB** including supporting/runtime files. These are download allowances, not inference RAM estimates. [Per-module precision guidance](https://huggingface.co/docs/transformers.js/guides/dtypes), [model files](https://huggingface.co/onnx-community/whisper-base.en/tree/main/onnx).

`src/voice/model.js` owns the model ID, pinned revision, precision, file list, cache namespace and download sizes. English-only Whisper rejects multilingual `language`/`task` options, so the worker omits them. Decoding stays deterministic with a bounded output. WebGPU is preferred where FP16 is supported; automatic WASM fallback uses cached files only. Latency and peak memory will be higher than Tiny and depend on the device.

The upgrade uses a new cache. A previous Tiny enable flag does not permit any new download: a returning player sees a setup message and reviews Base English in Options → Controls. Tiny weights are retained until explicit Remove Whisper download or save-quota recovery; both operations include old and new caches. Background wakeups, restore and GPU fallback never download missing model files without approval. Cache accounting checks the pinned model's actual encoder and decoder paths and reserves save space.

AudioWorklet captures one bounded mono buffer, resampled locally to 16 kHz. Short or quiet clips are rejected. Microphone capture requests echo cancellation, noise suppression and automatic gain control when the browser supports them; PCM is still resampled locally rather than assuming the microphone supplies 16 kHz. A GPU retry retains at most one additional 15-second PCM copy. Audio is never persisted or uploaded. Whisper's worker is released after 90 seconds idle, and warmed again automatically without opening a setup window. Loading has a five-minute timeout and transcription a 90-second timeout.

Microphone capture requires [HTTPS or localhost](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet). Model cache eviction can require another download. Cache removal is available in Options → Advanced. Laya and Whisper use separately resolved ORT loaders and WASM binaries under `public/ort/` and `public/ort-whisper/`; both are prepared by the dev/build scripts.

## Conversation and lasting goals

On release, Laya performs actual command inference. It can select a supported objective or classify the message as conversation. The game expands recognized objectives into [persistent goals](GOALS.md). Laya remains a classifier; translated local dialogue is authored from live state. If intelligence is disabled or still loading, setup is shown and the typed draft is kept for resending; failures show a plain retry message in the clearing, with details in Options → Advanced, and do not silently create a goal using keyword rules.

With OpenRouter selected, transcripts, recent conversations and world context go to the configured model/endpoint automatically when released or typed messages are sent. Jev uses the typed Decisions API; a general chat-completions adapter remains a separate option. API keys stay in the tab and are never saved. The hosted model returns a validated goal, numeric target and translated reply.

The latest 24 full conversation turns are saved in IndexedDB, with 500-character input/reply limits. Six recent turns feed structured context. Export/import and recovery include conversations and goals. Older full turns are discarded; bounded journal snippets and event counts may remain.
