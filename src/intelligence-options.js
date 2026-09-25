import { DECISION_SPEEDS, MAX_INTELLIGENCE_WORKERS, decisionPace, intelligenceWorkers } from "./intelligence-settings.js";

export function intelligenceControls(settings) {
  const speed = DECISION_SPEEDS.indexOf(decisionPace(settings)), workers = intelligenceWorkers(settings);
  return `<section class="intelligence-tuning" aria-label="Intelligence pace and workers">
    <div class="intelligence-knob">
      <div class="knob-heading"><label for="decision-speed">Decision speed</label><output id="decision-speed-value" for="decision-speed"></output></div>
      <input id="decision-speed" class="stepped-slider" type="range" min="0" max="3" step="1" value="${speed}" aria-describedby="decision-speed-help">
      <div class="slider-stops" aria-hidden="true">${DECISION_SPEEDS.map(p => `<span>${p.label}</span>`).join("")}</div>
      <p id="decision-speed-help" class="knob-help"></p>
    </div>
    <div class="intelligence-knob">
      <div class="knob-heading"><label for="intelligence-workers">Concurrent workers</label><output id="intelligence-workers-value" for="intelligence-workers"></output></div>
      <input id="intelligence-workers" class="stepped-slider" type="range" min="1" max="${MAX_INTELLIGENCE_WORKERS}" step="1" value="${workers}" aria-describedby="intelligence-workers-help intelligence-resource-help">
      <div class="slider-stops" aria-hidden="true"><span>1 · lightest</span><span>2</span><span>3 · most overlap</span></div>
      <p id="intelligence-workers-help" class="knob-help"></p>
      <p id="intelligence-resource-help" class="knob-resource"></p>
    </div>
    <p class="knob-runtime" id="intelligence-worker-status" role="status"></p>
  </section>`;
}

export function updateIntelligenceControls(settings, status) {
  const speed = document.getElementById("decision-speed"), workers = document.getElementById("intelligence-workers");
  if (!speed || !workers) return;
  const pace = DECISION_SPEEDS[Number(speed.value)] || DECISION_SPEEDS[1], count = Number(workers.value);
  const local = settings.provider === "laya", gpu = settings.backend !== "wasm";
  const text = (id, value) => {
    const element = document.getElementById(id);
    if (element.textContent !== value) element.textContent = value;
  };
  speed.style.setProperty("--range-fill", `${Number(speed.value) / 3 * 100}%`);
  workers.style.setProperty("--range-fill", `${(count - 1) / (MAX_INTELLIGENCE_WORKERS - 1) * 100}%`);
  speed.setAttribute("aria-valuetext", pace.label);
  workers.setAttribute("aria-valuetext", `${count} concurrent worker${count === 1 ? "" : "s"}`);
  text("decision-speed-value", pace.label);
  text("intelligence-workers-value", `${count} worker${count === 1 ? "" : "s"}`);
  text("decision-speed-help", `Review group plans every ${pace.schedule}s and building choices every ${pace.development}s while playing. ${local ? "Faster reviews use more CPU/GPU time and battery." : "Faster reviews can use more API credits."} Messages get priority; game speed and individual inference time stay the same.`);
  text("intelligence-workers-help", `Up to ${count} decision${count === 1 ? "" : "s"} at once. ${count === 1 ? "Planning, building choices and messages share one worker." : "Planning, building choices and messages can overlap."} ${local ? "Extra model copies open only when needed." : "This limits concurrent OpenRouter requests."}`);
  text("intelligence-resource-help", local
    ? `With ${count} loaded ${gpu ? "GPU" : "CPU"} ${count === 1 ? "copy" : "copies"}, model weights alone are about ${((gpu ? .846 : .524) * count).toFixed(2)} GB. Working memory, the browser and voice need more. Cached downloads are shared. More workers may compete for the same hardware; 1 uses the least memory.`
    : "Models run at your provider, so extra workers add no local model copies. Concurrent requests can reach provider rate limits. Billing depends on actual requests and your provider; idle workers send nothing.");
  const runtime = !status.ready
    ? "Your choices are saved on this device. Enable intelligence above to use them."
    : local
      ? `${status.activeRequests} active decision${status.activeRequests === 1 ? "" : "s"} · ${status.readyWorkers} local ${status.readyWorkers === 1 ? "copy" : "copies"} ready${status.workers > status.readyWorkers ? ` · ${status.workers - status.readyWorkers} preparing` : ""}. Lowering the limit releases extra copies after their current work finishes.`
      : `${status.activeRequests} active request${status.activeRequests === 1 ? "" : "s"} · limit ${status.workerLimit}.`;
  text("intelligence-worker-status", status.workerWarning || runtime);
}
