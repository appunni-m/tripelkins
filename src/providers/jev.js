// OpenRouter's typed Decisions API. Jev does not generate chat text.
export const JEV_MODEL = "~typesafe/jev-latest";
export function decisionsURL(endpoint = "https://openrouter.ai/api/v1") {
  const u = new URL(endpoint);
  if (u.username || u.password || u.search || u.hash || u.protocol !== "https:")
    throw new Error(
      "Use an HTTPS API URL without credentials or query parameters.",
    );
  u.pathname =
    u.pathname.replace(/\/(?:v1|alpha\/decisions)\/?$/, "").replace(/\/$/, "") +
    "/alpha/decisions";
  return u.href;
}
export async function askJev({
  settings,
  token,
  state,
  options,
  question = "Choose the useful, feasible plan that best advances the current goal while preserving care and commitments.",
  signal,
  fetcher = fetch,
}) {
  if (!token) throw new Error("Connect your OpenRouter key in Options.");
  if (Object.keys(options).length < 2)
    throw new Error(
      "A decision requires at least two meaningful alternatives.",
    );
  const body = {
    model: settings.model?.includes("jev") ? settings.model : JEV_MODEL,
    state,
    questions: {
      decision: { type: "choice", instructions: question, criteria: options },
    },
  };
  if (new TextEncoder().encode(JSON.stringify(body)).length > 24000)
    throw new Error("Decision context is too large.");
  const response = await fetcher(decisionsURL(settings.url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
      : AbortSignal.timeout(25000),
  });
  if (!response.ok)
    throw new Error(`OpenRouter decision request failed (${response.status}).`);
  const data = await response.json(),
    answer = data.answers?.decision;
  if (answer?.type !== "choice" || !Object.hasOwn(options, answer.choice))
    throw new Error("Jev returned an unknown decision.");
  return {
    policy: answer.choice,
    source: "Jev via OpenRouter",
    model: String(data.model || body.model).slice(0, 120),
    confidence: answer.confidence,
    timing: { tokens: data.usage?.input_tokens, cost: data.usage?.cost },
  };
}
