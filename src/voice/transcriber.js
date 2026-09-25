// This known Whisper checkpoint always needs all three components. The generic
// Transformers pipeline discovers optional components at `main`, independently
// of the requested revision. A cached-only wake must use our pinned files only.
export async function createTranscriber(api, modelId, options) {
  // Tokenizer discovery in 4.3 also drops the revision. This worker only serves
  // one checkpoint; pin discovery and fetch URLs to the same browser cache key.
  api.env.remotePathTemplate = `{model}/resolve/${options.revision}/`;
  const tokenizer = await api.AutoTokenizer.from_pretrained(modelId, options);
  const processor = await api.AutoProcessor.from_pretrained(modelId, options);
  if (typeof tokenizer !== "function" || !processor?.feature_extractor)
    throw new Error("Speech recognition setup is incomplete. Reopen voice setup in Options.");
  const model = await api.WhisperForConditionalGeneration.from_pretrained(modelId, options);
  try {
    return new api.AutomaticSpeechRecognitionPipeline({
      task: "automatic-speech-recognition", tokenizer, processor, model,
    });
  } catch (error) {
    await model.dispose();
    throw error;
  }
}
