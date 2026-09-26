import { isExplored } from "./game/discovery.js";
import { openingMarkup, playOpening } from "./opening-story.js";
import { GrowthBudget } from "./growth-budget.js";
import { EngineClient } from "./engine/client.js";
import { rustPlanner } from "./engine/planner.js";
import { createStorageClient } from "./engine/storage-client.js";
import { meteorTargetError } from "./game/destruction.js";
import { meteorSound } from "./meteor-sound.js";
import { scenario } from "./game/scenarios.js";
import { toolSignature as toolsKey, htmlIfChanged } from "./ui-budget.js";
import { createToolTray } from "./tool-tray.js";
import { mountUiIcons, uiIcon } from "./ui-icons.js";
import { DECISION_SPEEDS, decisionPace, decisionEvent, decisionDue, intelligenceWorkers } from "./intelligence-settings.js";
import { intelligenceControls, updateIntelligenceControls } from "./intelligence-options.js";
import { backgroundBudget } from "./background-budget.js";
import { JEV_MODEL } from "./providers/jev.js";

import {
  archiveEntries,
} from "./game/story.js";
import { bridgeGeometry } from "./game/geometry.js";
import { bridgeProject } from "./game/bridge-project.js";
import "./style.css";
import { WorldView } from "./world.js";
import { ColonyLife } from "./colony-life.js";
import { orbitSummary, orbitDetails } from "./orbit-ui.js";
import { buildingDetails } from "./building-inspector.js";
import { awakenCreatureVoice, stopCreatureVoice } from "./creature-voice.js";
import { naturalObject } from "./game/map.js";
import {
  BUILDINGS,
  buildingMaterials,
  buildingCost,
  TOOLS,
  TASK_NAMES,
  displayName,
  eventLabel,
  unlocked,
  lockReason,
  goal,
  LIMITS,
} from "./game/catalog.js";
import { iconUrl } from "./game/art.js";
import {
  loadLaya,
  resolveLayaBackend,
  decide,
  decideSettlement,
  stopBrain,
  brainStatus,
  configureBrain,
  configurePlanner,
  canDecide,
  checkOpenRouter,
  clearModelCache,
} from "./brain.js";
import guide from "../docs/GAME_GUIDE.md?raw";
import architecture from "../docs/ARCHITECTURE.md?raw";
import { createConversation } from "./conversation-ui.js";
import { createCommunityUI } from "./community-ui.js";

import { independent } from "./game/settlement.js";
import { resolveVoiceBackend, disposeVoice } from "./voice.js";
import { VOICE_MODEL } from "./voice/model.js";
import { DOWNLOADS, DOWNLOAD_NOTICE } from "./downloads.js";
import {
  activeGoal,
  goalTitle,
} from "./game/goals.js";
const $ = (id) => document.getElementById(id),
  esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const short = (n) =>
  n >= 1e12
    ? `${(n / 1e12).toFixed(1)}T`
    : n >= 1e9
      ? `${(n / 1e9).toFixed(1)}B`
      : n >= 1e6
        ? `${(n / 1e6).toFixed(1)}M`
        : n >= 10000
          ? `${(n / 1000).toFixed(1)}K`
          : Math.floor(n).toLocaleString();
mountUiIcons(document);
const appEvents = new AbortController();
const toolTray = createToolTray($("tool-tray"), $("tool-list"), $("tools-previous"), $("tools-next"), appEvents.signal);
function listen(target, kind, callback, options = {}) {
  target.addEventListener(kind, callback, { ...options, signal: appEvents.signal });
}
let world,
  token = "",
  view,
  last = performance.now(),
  sceneTime = 0,
  lastUi = 0,
  lastDraw = -Infinity,
  lastAI = -Infinity,
  lastSettlement = -Infinity,
  lastAIEvent = null, lastSettlementEvent = null,
  toastTimer,
  dialogType = "",
  optionsTab = "game",
  advancedNotice = "",
  downloadRequest = null,
  modelLoadId = 0,
  audio,
  changingWorld = false,
  recoveryEntries = [],
  historyMoments = [],
  animationFrame,
  frameTimer,
  prologuePlayer;
const previewScene = new URLSearchParams(location.search).get("preview");
const disposable = ["opening", "prologue", "bridge", "bridge-stock", "industry"].includes(previewScene);
const saveHealth = {status:"Opening your colony…",error:null,conflict:false,historyBytes:0};
let storageBlocked = false;
const engine = new EngineClient({
  onHealth: health => {Object.assign(saveHealth,health);if(health.conflict)storageBlocked=true;},
  onFailure: error => {storageBlocked=true;if(world)world.ui.paused=true;toast(error.message);},
});
const {saveWorld,checkpointWorld,replaceWorld,listRecoveryWorlds,listHistoryMoments,
  recoverMoment,downloadSave,importSaveFile,estimateStorage,persistStorage}=createStorageClient(engine);
try {
  world = await engine.initialize({preview:disposable,
    ...(disposable?{world:scenario(previewScene === "prologue" ? "opening" : previewScene)}:{})});
} catch (error) {
  $("modal-content").innerHTML=`<h2 id="dialog-title">Your colony couldn’t open</h2><p>Your saved world has not been replaced. Reload to try again.</p><details><summary>Details</summary><p>${esc(error.message)}</p></details><button class="primary" id="retry-engine">Reload game</button>`;
  $("modal").showModal();
  listen($("retry-engine"),"click",()=>location.reload());
  engine.dispose();
  throw error;
}
if(disposable)saveHealth.status="Preview · your saved colony is untouched";
storageBlocked=!!saveHealth.error;
configurePlanner(rustPlanner(engine));
const emptyGoalState={progress:0,value:0,step:"Considering our next steps…",blocker:null,milestones:[]};
const inspectGoal=(_world,objective)=>engine.views?.goalStates?.[objective.id] || emptyGoalState;
const colonyHealth=()=>engine.views?.health || {lowest:{fed:null,clean:null,amused:null},atRisk:0,critical:0,message:""};
configureBrain(world.settings);
const life = new ColonyLife();
const conversation = createConversation({
  engine,
  getWorld: () => world,
  getToken: () => token,
  openOptions: () => options("controls"),
  canConverse: () =>
    brainStatus.ready &&
    (world.settings.provider === "laya"
      ? world.settings.localEnabled
      : !!token),
  openIntelligence: () => options("intelligence"),
  closeModal,
  save,
  onGoal: () => {
    lastAI = -Infinity;
    lastSettlement = -Infinity;
    renderUi();
  },
  onReply: (listener, mood, phrase) =>
    life.reply(world, listener, mood, phrase, sceneTime, view),
});
// Unlock ordinary creature sounds on the first game gesture, independently of AI/voice setup.
function unlockCreatureSound(event) {
  if (!world.ui.muted && (event.type !== "keydown" || !event.repeat))
    awakenCreatureVoice();
}
listen(window, "pointerdown", unlockCreatureSound, { capture: true });
listen(window, "keydown", unlockCreatureSound, { capture: true });
function toast(text) {
  if (!text) return;
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 5000);
}
function speak(text) {
  if (text) engine.command("community.postMessage",{message:{text}}).catch(error=>toast(error.message));
}
function intelligenceReady() {
  return brainStatus.ready && !brainStatus.error &&
    (world.settings.provider === "laya" ? world.settings.localEnabled : !!token);
}
const communityUI = createCommunityUI({
  engine,
  getWorld:()=>world, ready:intelligenceReady, modal, closeModal, save, listen,
  openIntelligence:()=>options("intelligence"),
  onConsent:()=>{ lastSettlement = -Infinity;lastAI = -Infinity; },
});

function sound(kind = "care") {
  if (world.ui.muted) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    if(kind === "meteor" || kind === "meteor-fall") {
      meteorSound(audio,kind === "meteor-fall");
      return;
    }
    const oscillator = audio.createOscillator(),
      gain = audio.createGain();
    oscillator.type = "sine";
    const t = audio.currentTime;
    oscillator.frequency.setValueAtTime(
      kind === "loss" ? 250 : kind === "build" ? 190 : kind === "birth" ? 740 : 520,
      t,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === "loss" ? 90 : kind === "build" ? 110 : kind === "birth" ? 1080 : 780,
      t + 0.1,
    );
    gain.gain.setValueAtTime(0.035, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(t);
    oscillator.stop(t + 0.19);
  } catch {}
}
const savedSignatures = new WeakMap();
function save(force = true) {
  if (disposable) {
    saveHealth.status = "Preview · progress is not saved";
    return Promise.resolve(true);
  }
  if (storageBlocked || changingWorld) return false;
  const current = world;
  const signature = JSON.stringify([world.time, world.revision, world.commandRevision,
    world.navRevision, world.ui, world.settings]);
  if (!force && savedSignatures.get(current) === signature && !saveHealth.error)
    return Promise.resolve(true);
  return saveWorld(world).then((result) => {
    savedSignatures.set(current, signature);
    return result;
  }).catch((error) => {
    toast(saveHealth.status);
    console.warn("Local save:", error.message);
    if (saveHealth.conflict) {
      world.ui.paused = true;
      storageBlocked = true;
    }
    return false;
  });
}
function modal(title, eyebrow, body, type = "other") {
  prologuePlayer?.dispose();
  prologuePlayer = null;
  if (type !== "download") downloadRequest = null;
  conversation.close();
  if (type !== "recovery") recoveryEntries = [];
  dialogType = type;
  $("toast").hidden = true;
  $("speech").hidden = true;
  $("voice-subtitles").hidden = true;
  $("modal-content").innerHTML =
    `<div class="modal-inner ${type === "options" ? "game-options" : ""}"><div class="modal-header"><div><div class="eyebrow">${esc(eyebrow)}</div><h2 id="dialog-title">${esc(title)}</h2></div><button data-action="close" aria-label="Close dialog">${uiIcon("close")}</button></div>${body}</div>`;
  $("modal").setAttribute("aria-labelledby", "dialog-title");
  if (!$("modal").open) $("modal").showModal();
  engine.updatePresentation({paused:true,ui:world.ui,settings:world.settings});
  renderUi();
}
function closeModal() {
  if (changingWorld) return;
  if (prologuePlayer) { prologuePlayer.finish(); return; }
  if (dialogType === "welcome") {
    world.ui.welcome = true;
    save();
  }

  $("modal").close();
  downloadRequest = null;
  recoveryEntries = [];
  dialogType = "";
  last = performance.now();
  renderUi();
}
function providerFields() {
  return `<div class="provider-options"><button class="provider-card ${world.settings.provider === "laya" ? "selected" : ""}" data-provider="laya"><span class="badge">ON YOUR DEVICE</span><strong>Laya</strong><span>Private decisions on your device. Review the download before enabling.</span></button><button class="provider-card ${world.settings.provider === "jev" ? "selected" : ""}" data-provider="jev"><span class="badge">TYPED DECISIONS</span><strong>Jev · OpenRouter</strong><span>Choose bounded plans with the latest Jev release.</span></button><button class="provider-card ${world.settings.provider === "openrouter" ? "selected" : ""}" data-provider="openrouter"><span class="badge">OPTIONAL CHAT ADAPTER</span><strong>OpenRouter chat</strong><span>Connect a hosted model. Switch whenever you like.</span></button></div><div id="provider-fields">${world.settings.provider === "laya" ? `<label>Local runtime<select id="backend"><option value="auto" ${world.settings.backend === "auto" ? "selected" : ""}>Automatic · GPU</option><option value="wasm" ${world.settings.backend === "wasm" ? "selected" : ""}>CPU compatibility · Laya Q8 · 524 MB</option><option value="webgpu" ${world.settings.backend === "webgpu" ? "selected" : ""}>Laya FP16 · WebGPU · experimental · 846 MB</option></select></label><p class="muted">Creatures react immediately using local instincts. Laya refines group schedules in the background. Automatic mode uses WebGPU with FP16 support. It never switches silently to CPU inference; select CPU compatibility explicitly if needed. Enabling Laya may download 524–846 MB of weights plus runtime files. You will see the total allowance before starting. Startup can take time.</p><div class="button-row"><button class="secondary" data-action="load-model">${brainStatus.ready ? "Review & reload Laya" : "Review Laya download"}</button><button class="secondary" data-action="clear-models">Remove downloaded models</button></div>` : `<div class="form-grid"><label class="wide">API base URL<input id="api-url" type="url" value="${esc(world.settings.url)}" autocomplete="off" spellcheck="false"></label><label>Model<input id="api-model" value="${esc(world.settings.model)}" autocomplete="off" spellcheck="false"></label><label>API key · this tab only<input id="api-key" type="password" value="${esc(token)}" autocomplete="off" placeholder="sk-or-…"></label></div><p class="muted">Only colony context is sent to the URL above. Your key stays in this tab and is never saved or exported. Provider usage may cost credits.</p><button class="secondary" data-action="connect">Connect OpenRouter</button>`}</div><div class="status-line" id="brain-status">${esc(brainStatus.detail)}</div>`;
}
function captureSettings() {
  if (!$("modal").open || dialogType !== "options") return;
  const prior = JSON.stringify([
    world.settings.backend,
    world.settings.url,
    world.settings.model,
    token,
  ]);
  if ($("backend")) world.settings.backend = $("backend").value;
  if ($("api-url")) world.settings.url = $("api-url").value.trim();
  if ($("api-model")) world.settings.model = $("api-model").value.trim();
  if ($("api-key")) token = $("api-key").value;
  if ($("autonomy")) world.settings.autonomy = $("autonomy").checked;
  if ($("decision-speed")) world.settings.decisionSpeed = DECISION_SPEEDS[Number($("decision-speed").value)]?.id || "medium";
  if ($("intelligence-workers")) world.settings.intelligenceWorkers = intelligenceWorkers({ intelligenceWorkers: $("intelligence-workers").value });
  configureBrain(world.settings);
  if ($("option-sound")) {
    world.ui.muted = !$("option-sound").checked;
    if (world.ui.muted) conversation.silence();
    else awakenCreatureVoice();
  }
  if (
    prior !==
    JSON.stringify([
      world.settings.backend,
      world.settings.url,
      world.settings.model,
      token,
    ])
  ) {
    modelLoadId++;
    stopBrain();
  }
}
function openingStory(replay = false) {
  modal("Tripelkins", "BEFORE THE FIRST LANDING", openingMarkup(iconUrl("creature")), "prologue");
  prologuePlayer = playOpening($("modal-content"), () => {
    prologuePlayer = null;
    if (replay) options("game");
    else welcome();
  });
}
function welcome() {
  modal(
    "A little life. A whole world.",
    "TRIPELKINS",
    `<p class="tagline">If one of them survives, everyone survives.</p><div class="welcome-creature"><img src="${iconUrl("creature")}" alt="A curious Tripelkin"></div><p>A little spacecraft has landed. Someone small is waiting inside. Nurture them, and help their colony find its feet.</p><div class="button-row end"><button class="primary" data-action="enter">Enter the clearing →</button></div><p class="muted">Your world is saved as you play. Intelligence starts off: built-in instincts keep care, movement and growth working. Enable intelligence in Options when you want to talk or give lasting goals. No model download is needed to start.</p><button class="secondary" data-action="welcome-intelligence">Explore intelligence options</button>`,
    "welcome",
  );
}
function intelligenceState() {
  if (brainStatus.busy && !brainStatus.ready)
    return {
      kind: "loading",
      title: "Preparing intelligence…",
      action: "View progress",
      detail:
        "You can return to the clearing and keep playing while it gets ready.",
    };
  if (
    brainStatus.activeRequests > 0 ||
    (!brainStatus.error && performance.now() - brainStatus.lastUsedAt < 800)
  )
    return {
      kind: "thinking",
      title: "The colony is thinking…",
      action: "Options",
      detail: "Understanding your words or choosing what to do together.",
    };
  if (brainStatus.error)
    return {
      kind: "unavailable",
      title: "Intelligence unavailable",
      action: "Set up",
      detail:
        "Built-in instincts are keeping the game running. Check your connection or review the download below.",
    };
  if (
    brainStatus.ready &&
    (world.settings.provider === "laya" ? world.settings.localEnabled : !!token)
  )
    return {
      kind: "on",
      title: "Intelligence on",
      action: "Options",
      detail:
        "They can understand messages and agree on goals. Hold Space to set up talking, or press T to type.",
    };
  return {
    kind: "off",
    title: "Intelligence off",
    action: "Enable",
    detail:
      "Built-in instincts are active. Care, movement, building and growth work without a model download.",
  };
}
function intelligenceCard() {
  const state = intelligenceState();
  return `<div class="intelligence-card"><div><strong id="intelligence-title">${state.title}</strong><p id="intelligence-detail">${state.detail}</p></div><div class="button-row"><button class="primary" id="intelligence-enable" data-action="${optionsTab === "intelligence" ? (world.settings.provider === "laya" ? "load-model" : "intelligence-connect") : "intelligence"}">${optionsTab === "intelligence" ? (world.settings.provider === "laya" ? "Review Laya download" : "Connect OpenRouter") : "Intelligence options"}</button><button class="secondary" id="intelligence-disable" data-action="disable-intelligence">Turn off</button></div><p class="muted" id="intelligence-progress" role="status"></p></div>`;
}
function renderIntelligenceTuning() { updateIntelligenceControls(world.settings, brainStatus); }
async function reviewDownload(kind, requestedBackend = null) {
  captureSettings();
  const request = { kind, world, backend: null };
  downloadRequest = request;
  modal(
    "Before you download",
    "OPTIONS · GAME PAUSED",
    '<p role="status">Checking the suitable runtime for this device…</p>',
    "download",
  );
  try {
    const backend = requestedBackend || (
      kind === "laya"
        ? await resolveLayaBackend(world.settings.backend)
        : await resolveVoiceBackend());
    if (downloadRequest !== request || request.world !== world) return;
    request.backend = backend;
    const info = DOWNLOADS[kind][backend];
    modal(
      "Enable " + (kind === "laya" ? "intelligence" : "talking") + "?",
      "OPTIONS · DOWNLOAD DETAILS",
      `<div class="download-cost"><span>INITIAL DOWNLOAD · ${esc(info.name)}</span><strong>Allow about ${info.allowance} MB</strong><p>About ${info.weights} MB of model weights, plus runtime and supporting files. The amount depends on files already cached.</p></div><p>${DOWNLOAD_NOTICE}</p><p>${kind === "laya" ? "This enables understanding messages and choosing group plans. Your colony remains playable using built-in instincts while it loads, or if you skip it. Voice is a separate optional download." : "This enables speech recognition on your device. Microphone permission is requested when you speak. Intelligence is also needed to interpret the transcript; with OpenRouter selected, the text is sent to your configured service."}</p><p class="muted">Only this runtime is approved. If another download is needed, we will ask again. You can stop setup in Options; files already downloaded may remain cached.</p><div class="button-row"><button class="primary" data-action="download-confirm">Download & enable · ~${info.allowance} MB</button><button class="secondary" data-action="close">Keep playing without downloading</button></div>`,
      "download",
    );
  } catch (error) {
    if (downloadRequest !== request) return;
    modal(
      "Setup could not start",
      "OPTIONS · GAME PAUSED",
      `<p>${esc(error.message)}</p><button class="primary" data-action="close">Keep playing</button>`,
    );
  }
}
async function options(tab = "game") {
  optionsTab = [
    "game",
    "intelligence",
    "controls",
    "saves",
    "advanced",
  ].includes(tab)
    ? tab
    : "game";
  const pages = {
    game: () =>
      `<p class="options-intro">The mist lifts as your colony explores. Discovered ground stays on your map.</p>${intelligenceCard()}${world.population > 20 || world.community.consent !== "unasked" ? `<div class="option-row"><span><b>Colony independence</b><small>${world.community.consent === "accepted" ? "Allowed · they gather resources, supply projects and build their settlement." : "Let the colony ask to gather, build and grow independently."}</small></span><button class="secondary" data-action="independence">Change</button></div>` : ""}<div class="option-list"><label class="option-row"><span><b>Sound</b><small>Little songs, chirps and sounds of the clearing.</small></span><input class="game-toggle" id="option-sound" type="checkbox" ${world.ui.muted ? "" : "checked"}><span class="toggle-track" aria-hidden="true"></span></label><label class="option-row"><span><b>Colony initiative</b><small>Let the colony choose how to work together.</small></span><input class="game-toggle" id="autonomy" type="checkbox" ${world.settings.autonomy ? "checked" : ""}><span class="toggle-track" aria-hidden="true"></span></label><div class="option-row"><span><b>Talk to the colony</b><small>${world.settings.voiceEnabled ? "Tap the microphone, or hold Space and release." : "Let them hear your voice, or press T to type."}</small></span><button class="secondary" data-options-tab="controls">${world.settings.voiceEnabled ? "Controls" : "Set up"}</button></div><div class="option-row"><span><b>Their journey here</b><small>A one-minute story of three suns and one small spacecraft.</small></span><button class="secondary" data-action="opening-story">Replay opening</button></div></div>`,
    intelligence: () =>
      `${intelligenceCard()}${intelligenceControls(world.settings)}<p>Built-in instincts keep them moving, eating, washing, playing and growing as their needs are met. You can use every care and building tool with intelligence off.</p><p>Enable intelligence to interpret your messages, agree on lasting goals and refine group plans. Existing goals continue through the game’s own rules when intelligence is off.</p><div class="provider-options"><button class="provider-card ${world.settings.provider === "laya" ? "selected" : ""}" data-action="choose-local"><span class="badge">ON YOUR DEVICE</span><strong>Laya · local intelligence</strong><span>Free inference. A large initial download, kept in browser storage. Review the size before you start.</span></button><button class="provider-card ${world.settings.provider === "jev" ? "selected" : ""}" data-provider="jev"><span class="badge">ONLINE CONNECTION</span><strong>Jev via OpenRouter</strong><span>No local intelligence model download. Your API key and internet are required; usage may cost credits.</span></button></div><p class="muted">Voice is a separate, optional download in Controls. With intelligence enabled, you can type with T without downloading voice files. If you arrived here after writing a message, it is kept in the typing box; resend it when you are ready.</p><button class="secondary" data-options-tab="advanced">Connection & runtime options</button>`,
    controls: () =>
      `<div class="voice-intro"><div class="hold-key">SPACE</div><h3>Tap to talk. Tap again to send.</h3><p>You can also hold the microphone or Space, then release.</p><p>Your words appear as subtitles.<br>They answer in their own little song.</p></div><div class="voice-option"><div id="voice-setup-status" class="status-line" role="status"></div><div class="button-row"><button class="primary" id="voice-enable" data-action="voice-enable">Enable talking</button><button class="secondary" id="voice-disable" data-action="voice-disable">Turn off talking</button></div><p class="muted">Optional ${VOICE_MODEL.name} download: about ${DOWNLOADS.whisper.wasm.weights} MB of weights, plus runtime files (allow ${DOWNLOADS.whisper.wasm.allowance} MB). This English speech model replaces Tiny. Existing players need to approve its new download once. Review the amount before enabling. Cached files are reused; metered data charges may apply. Audio stays on your device. <button class="text-button" data-options-tab="intelligence">Intelligence must also be enabled to understand your words.</button></p></div><dl class="controls-list"><div><dt><kbd>T</kbd></dt><dd>Type a message</dd></div><div><dt><kbd>P</kbd></dt><dd>Pause or continue</dd></div><div><dt><kbd>1</kbd>–<kbd>4</kbd></dt><dd>Hand, banana, cloth, cricket ball</dd></div><div><dt><kbd>Esc</kbd></dt><dd>Cancel talking / open Options</dd></div><div><dt>Drag</dt><dd>Explore new land; arrow keys work too. Right-drag to pan over movable objects.</dd></div><div><dt>Scroll / pinch / + −</dt><dd>Zoom in or out, from the very first lander</dd></div><div><dt>COLONY</dt><dd>Return to your colony</dd></div></dl>`,
    saves: () =>
      `<p class="options-intro">Your little world, kept safe.</p><div class="save-card"><img src="${iconUrl("creature")}" alt=""><div><b>${short(world.population)} Tripelkins</b><span id="options-save-status">${esc(saveHealth.status)}</span><small>Progress is saved as you play on this device.</small></div></div><div class="save-actions"><button class="secondary" data-action="history">Read our story & earlier moments</button><button class="secondary" data-action="inbox">Read the inbox</button><button class="secondary" data-action="archive">Open the archive</button><button class="secondary" data-action="export">Download a saved world</button><button class="secondary" data-action="import">Open a saved world</button><button class="secondary" data-action="restore">Restore an earlier world</button><button class="secondary" data-action="persist">Keep this world on this device</button></div><div class="divider"></div><div class="option-row"><span><b>A new beginning</b><small>Your current world will be kept for you.</small></span><button class="secondary" data-action="new">Start a new landing</button></div><p class="status-line" id="options-notice" role="status"></p>`,
    advanced: () =>
      `<p class="options-intro">Connections & diagnostics</p>${providerFields()}<div class="status-line" id="advanced-notice" role="status">${esc(advancedNotice)}</div><details><summary>Decision timing & context</summary><div id="diagnostics" class="status-line"></div><div class="button-row"><button class="secondary" data-action="fresh">Preview fresh decision</button><button class="secondary" data-action="context">Inspect colony context</button></div><p class="muted">Previewing a decision leaves the paused world unchanged.</p></details><details><summary>Growth & settlement</summary><div id="growth-diagnostics" class="status-line"></div><p class="muted">Target: 50% estimated rendering GPU duty. This measures our WebGL drawing, not device-wide GPU utilization or model inference. If GPU timing is unavailable, frame time and main-thread load control growth. New births wait under load; existing creatures stay. A separate 2,048-creature storage safeguard bounds saved state.</p><p class="muted">Neighborhood density target: 6 residents per 100 ground units. Crowding penalty: 4 × squared relative error; isolation penalty: 0.6 × squared relative error. Placement also considers building spacing, care coverage and travel. These are planning costs, never health damage.</p></details><details><summary>Voice technology</summary><p class="muted">${VOICE_MODEL.name} transcribes English on this device. The audio encoder uses full precision; the decoder uses Q8 on WebGPU or single-thread WASM. The first download is about ${DOWNLOADS.whisper.wasm.weights} MB of model weights plus runtime files. Recordings are never stored or uploaded. With OpenRouter selected, transcripts and colony context are sent to your configured endpoint.</p><div id="voice-diagnostics" class="status-line"></div><button class="secondary" data-action="voice-clear">Remove Whisper download</button><button class="secondary" data-action="voice-cpu">CPU voice compatibility</button><p class="muted">Voice normally stays on the GPU. CPU compatibility is optional and may use more CPU while transcribing; it uses the same cached weights.</p></details><details><summary>Storage & recovery</summary><p class="muted" id="storage-info">${esc(saveHealth.status)}</p><button class="secondary" data-action="legacy">Restore original prototype</button></details><div class="button-row"><button class="secondary" data-action="guide">Game guide & systems</button><a class="secondary" href="${import.meta.env.BASE_URL}credits.html" target="_blank" rel="noopener">Credits & licenses ↗</a><a class="secondary" href="${import.meta.env.BASE_URL}verify.html" target="_blank" rel="noopener">Deployment checks ↗</a></div>`,
  };
  modal(
    "Options",
    "Ⅱ  GAME PAUSED",
    `<nav class="options-nav" aria-label="Options sections">${[
      ["game", "Game"],
      ["intelligence", "Intelligence"],
      ["controls", "Controls"],
      ["saves", "Saved worlds"],
      ["advanced", "Advanced"],
    ]
      .map(
        ([key, label]) =>
          `<button data-options-tab="${key}" ${optionsTab === key ? 'aria-current="page"' : ""}>${label}</button>`,
      )
      .join(
        "",
      )}</nav><section class="options-page" aria-label="${optionsTab}">${pages[optionsTab]()}</section><footer class="options-footer"><span>Your world will wait for you.</span><button class="primary" data-action="close">Back to the clearing</button></footer>`,
    "options",
  );
  conversation.render();
  renderUi();
  if (optionsTab !== "advanced") return;
  const info = await estimateStorage();
  if ($("storage-info"))
    $("storage-info").textContent =
      `${saveHealth.status} · ${info}. Rewind history ${(saveHealth.historyBytes / 1048576).toFixed(2)} / 8 MB. ${world.creatures.length}/${LIMITS.creatures} individually simulated; ${world.memory.recent.length}/${LIMITS.events} recent events. Older actions remain in summaries.`;
}
async function switchWorld(next, message, source = next, origin = null) {
  if (disposable) {
    toast("Open the normal game to use your saved worlds.");
    return;
  }
  if (changingWorld) return;
  const showOpening = !next.ui?.welcome;
  changingWorld = true;
  modelLoadId++;
  conversation.close();
  stopBrain();
  try {
    const committed = await replaceWorld(world, next, source, origin);
    if (committed.settings.url !== world.settings.url) token = "";
    world = committed;
    configureBrain(world.settings);
    storageBlocked = false;
    lastAI = -Infinity;
    lastSettlement = -Infinity;
    toolSignature = "";
    changingWorld = false;
    closeModal();
    renderUi();
    if (showOpening) openingStory();
    else toast(message);
    if (world.settings.provider === "laya" && world.settings.localEnabled)
      loadModel();
  } catch (error) {
    changingWorld = false;
    if(engine.failed){showOptionsNotice(error.message);toast(error.message);}
    else{showOptionsNotice(`Your current world is still here. ${error.message}`);
      toast("The world could not be saved. Your current colony has been kept.");}
  }
}
async function recoveryMenu(legacyOnly = false) {
  modal(
    "Earlier worlds",
    "GAME PAUSED",
    '<p role="status">Finding your saved worlds…</p>',
    "recovery",
  );
  try {
    const entries = await listRecoveryWorlds();
    if (dialogType !== "recovery") return;
    recoveryEntries = legacyOnly
      ? entries.filter((entry) => entry.legacy || entry.key === "legacy-v1")
      : entries;
    renderRecovery();
  } catch (error) {
    if (dialogType === "recovery")
      modal(
        "Could not read earlier worlds",
        "GAME PAUSED",
        `<p>${esc(error.message)}</p><button class="primary" data-options-tab="saves">Back to saved worlds</button>`,
        "recovery",
      );
  }
}
function renderRecovery() {
  modal(
    "Earlier worlds",
    "GAME PAUSED",
    `<p>Choose a moment to return to. Restored worlds stay paused, with their saved needs unchanged. Your current world is kept too.</p><div class="recovery-list">${
      recoveryEntries
        .map((entry, index) => {
          if (entry.error)
            return `<article class="recovery-card"><h3>${esc(entry.label)}</h3><p>This save cannot be opened: ${esc(entry.error)}</p></article>`;
          const { world: saved, health } = entry;
          const date =
            entry.savedAt && Number.isFinite(Date.parse(entry.savedAt))
              ? new Date(entry.savedAt).toLocaleString()
              : "Date not recorded";
          const needs = Object.entries(health.lowest)
            .map(
              ([key, value]) =>
                `${{ fed: "Food", clean: "Cleanliness", amused: "Play" }[key]} ${value === null ? "—" : `${Math.round(value)}%`}`,
            )
            .join(" · ");
          return `<article class="recovery-card"><h3>${esc(entry.label)}</h3><small>${esc(date)} · ${Math.floor(saved.time / 60)} minutes played</small><p><b>${short(saved.population)} Tripelkins</b> · ${saved.creatures.length} in the clearing</p><p>${needs}</p>${health.message ? `<p class="goal-blocker">${esc(health.message)} They will need care when you resume.</p>` : !saved.population && saved.progress.hatched ? '<p class="goal-blocker">This colony has no surviving Tripelkins.</p>' : ""}<small>Care buildings: ${esc(entry.facilities.map(displayName).join(", ") || "none")}</small>${entry.legacy ? '<p class="muted">This prototype uses colony-wide needs. Individual lives and positions are recreated when it is opened.</p>' : ""}<div class="button-row"><button class="secondary" data-action="recover:${index}">Restore this world, paused</button>${health.atRisk ? `<button class="primary" data-action="rescue:${index}">Restore with fresh care</button>` : ""}</div>${health.atRisk ? '<p class="muted">Fresh care raises food, cleanliness and play to at least 70% and resets the neglect timer. The original save stays available. The world opens paused.</p>' : ""}</article>`;
        })
        .join("") || "<p>No earlier worlds have been saved yet.</p>"
    }</div><div class="button-row"><button class="primary" data-options-tab="saves">Back to saved worlds</button></div>`,
    "recovery",
  );
}
async function historyMenu() {
  modal(
    "Your story",
    "GAME PAUSED",
    "<p>Finding the moments you shared…</p>",
    "history",
  );
  try {
    const paths = await listHistoryMoments();
    if (dialogType !== "history") return;
    historyMoments = [];
    const choices = paths
      .map(
        (path) =>
          `<optgroup label="${esc(path.label)} · ${esc(new Date(path.moments.at(-1).at).toLocaleString())}">${path.moments
            .map((moment) => {
              const index =
                historyMoments.push({ branch: path.id, ...moment }) - 1;
              return `<option value="${index}">${esc(new Date(moment.at).toLocaleString())} · ${Math.floor(moment.tick / 60)}m ${Math.floor(moment.tick % 60)}s · ${short(moment.population)} Tripelkins</option>`;
            })
            .join("")}</optgroup>`,
      )
      .join("");
    const summary = world.memory.summary;
    const words = world.memory.commands
      .slice()
      .reverse()
      .map(
        (command) =>
          `<article class="journal-entry"><time>${Math.floor(command.tick / 60)} MIN · ${esc(command.channel.toUpperCase())} · ${esc(command.status.toUpperCase())}</time><p>“${esc(command.text)}”</p>${command.reply ? `<p>${esc(command.reply)}</p>` : ""}</article>`,
      )
      .join("");
    modal(
      "Your story",
      "GAME PAUSED",
      `<p>Your recent words and shared moments are kept here. Older details become a short record of milestones and totals.</p><div class="button-row"><button class="secondary" data-action="journal">Read the colony journal</button><button class="secondary" data-action="export">Download current world & story</button></div><h3>Return to an earlier moment</h3><p>Preview a saved moment before choosing it. It opens paused; the path you leave is kept for a while too.</p>${choices ? `<label>Saved moments<select id="history-moment">${choices}</select></label><button class="secondary" data-action="preview-moment">Preview this moment</button>` : "<p>Your first moments will appear as you play.</p>"}<p class="muted">Recent moments are kept automatically, within a fixed space limit. Older moments eventually roll off. Downloaded worlds include their story, but not every rewind point.</p><details><summary>What we remember from before</summary><p>${short(summary.eventsCompacted)} older events · ${short(summary.commandsCompacted)} older messages folded into the story.</p><p>${short(world.memory.totals.birth || 0)} births · ${short(world.memory.totals.loss || 0)} losses · ${short(world.memory.totals["goal-complete"] || 0)} goals reached.</p>${summary.milestones.map((item) => `<p>${Math.floor(item.tick / 60)} MIN · ${esc(item.message)}</p>`).join("") || "<p>Lasting milestones will appear here.</p>"}</details><h3>Your words</h3>${words || "<p>Your next conversation will appear here. Earlier replies remain in the colony journal.</p>"}<div class="button-row"><button class="primary" data-options-tab="saves">Back to saved worlds</button></div>`,
      "history",
    );
  } catch (error) {
    if (dialogType === "history")
      modal(
        "Your story is unavailable",
        "GAME PAUSED",
        `<p>${esc(error.message)}</p><button class="primary" data-options-tab="saves">Back to saved worlds</button>`,
        "history",
      );
  }
}
async function goalsModal() {
  const current=world;
  const plan=await engine.query("development.plan");
  if(current!==world)return;
  engine.views=await engine.query("planning.ui");
  const entries = [...world.memory.goals].sort((a, b) => {
    const order = {
      active: 0,
      queued: 1,
      paused: 2,
      completed: 3,
      cancelled: 4,
    };
    return order[a.status] - order[b.status];
  });
  modal(
    "Something to grow toward.",
    "THE COLONY REMEMBERS",
    `<p class="muted">Tell us what you hope for. We’ll work toward it together, and remember where we left off when you return.</p><article class="goal-card"><b>Our next steps</b><p>${esc(plan.title)}</p><ul class="subgoal-list">${plan.children.map(s=>`<li><span>${s.status === "satisfied" ? "✓" : s.status === "working" ? "↻" : "○"}</span><div>${esc(s.title)}<small>${esc({satisfied:"Ready",urgent:"Care comes first",needed:"Next to work on",working:"Crew at work",waiting:"Waiting for materials",blocked:"Waiting for a clear path"}[s.status])}</small></div></li>`).join("")}</ul></article><div class="goal-list">${
      entries.length
        ? entries
            .map((g) => {
              const state = inspectGoal(world, g),
                ended = ["completed", "cancelled"].includes(g.status);
              return `<article class="goal-card ${g.status}"><div class="goal-card-heading"><span class="badge">${esc(g.status.toUpperCase())}${g.kind === "care" && g.status === "active" ? " · ONGOING" : ""}</span><b>${esc(goalTitle(g))}</b></div><blockquote>“${esc(g.command)}”</blockquote><progress max="1" value="${state.progress}" aria-label="Goal progress"></progress><div class="goal-progress-label">${Math.floor(state.value).toLocaleString()} / ${g.target.toLocaleString()}${g.kind === "care" ? "% · lowest need" : ""}</div><p>${esc(ended ? (g.status === "completed" ? "We reached this objective." : "You set this goal aside.") : state.step)}</p>${!ended && state.blocker ? `<p class="goal-blocker">We need your help: ${esc(state.blocker)}</p>` : ""}<details><summary>Our next steps</summary><ol>${state.milestones.map((item) => `<li>${esc(item)}</li>`).join("")}</ol></details>${!ended ? `<div class="button-row">${g.status === "active" ? `<button class="secondary" data-goal-action="pause" data-goal-id="${esc(g.id)}">Pause goal</button>` : `<button class="secondary" data-goal-action="focus" data-goal-id="${esc(g.id)}">${g.status === "paused" ? "Resume this goal" : "Focus on this"}</button>`}<button class="secondary" data-goal-action="cancel" data-goal-id="${esc(g.id)}">Set aside</button></div>` : ""}</article>`;
            })
            .join("")
        : `<div class="goals-empty"><b>What should we become?</b><p>“Grow to 50 Tripelkins.”<br>“Keep everyone healthy.”<br>“Finish the bridge.”</p><small>One active goal, a queue for what comes next, and your shared history.</small></div>`
    }</div><div class="button-row end"><button class="secondary" data-action="talk">Type a goal</button><button class="primary" data-action="close">Back to the clearing</button></div>`,
    "goals",
  );
}
function journal() {
  modal(
    "We remember.",
    "COLONY JOURNAL",
    `<div class="stats-grid"><div class="stat"><b>${short(world.population)}</b>lives in the collective</div><div class="stat"><b>${world.memory.totals.birth || 0}</b>replications remembered</div><div class="stat"><b>${world.memory.choices.length}</b>lasting choices</div></div><details><summary>Our conversations</summary><div class="conversation-history">${world.memory.conversations.map((turn) => `<div class="conversation-turn"><p class="your-words"><small>YOU</small>${esc(turn.text)}</p><p class="their-words"><small>THE COLONY · TRANSLATED</small>${esc(turn.reply)}</p></div>`).join("") || "Our first words are still ahead of us."}</div></details><div class="journal-list">${world.memory.recent
      .filter((event) => event.kind !== "plan")
      .slice()
      .reverse()
      .map(
        (e) =>
          `<div class="journal-entry"><time>${Math.floor(e.tick / 60)} MIN · ${esc(eventLabel(e.kind).toUpperCase())}</time><p>${esc(e.kind === "goal" ? e.message.replace(/^.*? interpreted a lasting goal: /, "We agreed on a goal: ") : e.message)}</p></div>`,
      )
      .join(
        "",
      )}</div><div class="button-row"><button class="primary" data-action="close">Back to the clearing</button></div>`,
    "journal",
  );
}
function guideModal(which = "guide") {
  modal(
    which === "guide"
      ? "Welcome to your colony."
      : "A world worth building.",
    "GAME GUIDE & SYSTEMS",
    `<div class="button-row"><button class="secondary" data-options-tab="advanced">← Advanced options</button><button class="secondary" data-action="guide">Game guide</button><button class="secondary" data-action="architecture">Systems</button></div><div class="research">${esc(which === "guide" ? guide : architecture).replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')}</div>`,
    "guide",
  );
}
function choiceDialog(kind, entity) {
  const text = {
    "second-contact": [
      "THE SKY IS ALSO A PLACE.",
      "The mountain survey uncovered a route to orbit. Will you help us reach orbit while keeping a home for those who stay?",
    ],
    monolith: [
      "WE HAVE BEEN LISTENING.",
      "There are more of us now. We could build a world that cares for every one of us. Or a world that reaches further than any of us can imagine. What should we become?",
    ],
    bug: [
      "IS A LIFE A RESOURCE?",
      "This creature will become bones. The others will remember what you taught them.",
    ],
    swarm: [
      "HOW MANY IS ENOUGH?",
      "Every creature near this one will become bones. This choice stays with the colony.",
    ],
    nuke: [
      "ONE LAST CHANGE.",
      "The collective is ready. Beyond the mountain, beyond the sky, there may be a way to speak as one. Shall we open it?",
    ],
  }[kind];
  modal(
    text[0],
    "A CONVERSATION",
    `<img class="portrait" src="${iconUrl("creature")}" alt="A curious Tripelkin"><p>${text[1]}</p><div class="button-row"><button class="secondary" data-choice="${kind}" data-answer="${kind === "monolith" ? "care" : "no"}" data-entity="${esc(entity || "")}">${kind === "monolith" ? "Look after each other." : kind === "second-contact" ? "Keep a home below." : kind === "nuke" ? "Keep our world." : "Let them live."}</button><button class="primary" data-choice="${kind}" data-answer="${kind === "monolith" ? "explore" : "yes"}" data-entity="${esc(entity || "")}">${kind === "monolith" ? "Let’s find out." : kind === "second-contact" ? "We can reach the sky." : kind === "nuke" ? "Open the connection." : "Use the Reclaimer."}</button></div>`,
    "choice",
  );
}
async function ending() {
  const entries = world.story.assessments.length
    ? world.story.assessments
    : await engine.query("story.assessment");
  modal(
    "Our journey together",
    "COLONY JOURNAL",
    `<div class="ending"><img class="portrait" src="${iconUrl("creature")}" alt="Tripelkin"><p>You taught us what mattered, one choice at a time.</p>${entries.map((a) => `<section class="reflection"><h3>${esc(a.dimension)}</h3><p>${esc(a.text)}</p><small>${esc(a.consequence)}</small></section>`).join("")}<p class="muted">This is a reflection on this colony’s story. You can return to an earlier moment and let it continue.</p><div class="button-row"><button class="secondary" data-action="export">Keep this world</button><button class="primary" data-action="history">Return to an earlier moment</button></div></div>`,
    "ending",
  );
}
function showStory() {
  communityUI.update(intelligenceState(), !conversation.listening && $("chat-composer").hidden);
}

function renameDialog() {
  const c = world.creatures.find((c) => c.id === world.ui.selected);
  if (!c) return;
  modal(
    "A name of their own",
    "ONE SMALL LIFE",
    `<form id="rename-form" data-creature-id="${esc(c.id)}" novalidate><label for="creature-name">Name</label><input id="creature-name" value="${esc(c.name)}" autocomplete="off" enterkeyhint="done" aria-describedby="rename-help rename-error"><p id="rename-help" class="muted">Up to 30 characters. Each living Tripelkin needs a different name.</p><p id="rename-error" role="status"></p><div class="button-row end"><button type="button" class="secondary" data-action="close">Cancel</button><button type="submit" class="primary">Keep this name</button></div></form>`,
    "rename",
  );
  $("creature-name").focus();
  $("creature-name").select();
}
function archiveDialog() {
  const entries = archiveEntries(world);
  modal(
    "Small discoveries",
    "THE ARCHIVE",
    `<p class="muted">Notes from the colony’s journey.</p>${entries.length ? entries.map((a) => `<article class="reflection"><h3>${esc(a.title)}</h3><p>${esc(a.text)}</p></article>`).join("") : "<p>The first discovery is still waiting inside the spacecraft.</p>"}`,
    "archive",
  );
}
function renderTools() {
  const tab = world.ui.tab;
  const focusedTool = $("tool-list").contains(document.activeElement) ? document.activeElement.dataset.tool : null;
  for (const b of $("tabs").children)
    b.classList.toggle("active", b.dataset.tab === tab);
  const entries = (
    tab === "build"
      ? Object.entries(BUILDINGS)
      : Object.entries(TOOLS).filter(([key]) =>
          tab === "care"
            ? ["inspect", "banana", "cloth", "cricketball"].includes(key)
            : !["inspect", "banana", "cloth", "cricketball"].includes(key),
        )
  ).filter(
    ([key, spec]) =>
      (!spec.stage || spec.stage <= world.stage) &&
      (!spec.flag || world.progress[spec.flag] || (key === "grabber" && world.ui.held)) &&
      (!spec.energy || world.progress.energy >= spec.energy),
  );
  htmlIfChanged($("tool-list"), entries
    .map(([key, spec]) => {
      const ready = unlocked(world, spec) || (key === "grabber" && !!world.ui.held);
      const tool = tab === "build" ? `build:${key}` : key;
      return `<button class="tool ${world.ui.tool === tool ? "active" : ""} ${ready ? "" : "locked"}" data-tool="${tool}" aria-pressed="${world.ui.tool === tool}" aria-label="${esc(spec.name)}${ready ? "" : `, unlock at ${lockReason(spec)}`}" title="${esc(ready ? `${spec.help}${tab === "build" ? ` Cost: ${buildingCost(spec)}.` : ""}` : lockReason(spec))}"><img src="${iconUrl(spec.icon)}" alt=""><span>${esc(spec.name)}</span>${tab === "build" && ready ? `<small>${Object.entries(buildingMaterials(spec)).filter(([,amount])=>amount>0).map(([kind,amount])=>`${short(amount)} ${kind}`).join("<br>")}</small>` : !ready ? `<small>${esc(lockReason(spec))}</small>` : ""}</button>`;
    })
    .join(""));
  toolTray.refresh(tab, world.ui.tool, focusedTool);
  const selected =
    TOOLS[world.ui.tool] || BUILDINGS[world.ui.tool.replace("build:", "")];
  $("tool-hint").textContent = selected?.help || "Tap a creature to meet them.";
  if (world.ui.held && world.ui.tool === "grabber")
    $("tool-hint").textContent = `Holding ${world.ui.held.stock} ${world.ui.held.type}. Tap reachable grass to put it down.`;
}
function bridgeDetails(o) {
  const p = bridgeProject(world,o);
  return `<progress max="${p.required}" value="${p.delivered}" aria-label="Bridge construction"></progress><p>${p.complete
    ? "Both banks are connected. The mines and mountain are now within reach."
    : `${p.staged} materials at the crossing · ${p.carried} being carried. Feed, wash and entertain the workers so they can build.`}</p>${p.complete ? "" : `<div class="button-row"><button class="secondary" data-action="bridge-supply" ${!p.needed || !world.inventory.wood ? "disabled" : ""}>Send ${Math.floor(Math.min(p.needed,world.inventory.wood))} stored wood</button><button class="secondary" data-action="bridge-axe">Chop trees</button></div><small>Wood is sufficient. The Reclaimer also provides bones as an alternative material.</small>`}`;
}
let toolSignature = "";
function renderUi() {
  renderIntelligenceTuning();
  $("fog-hint").hidden = isExplored(world,world.ui);
  const intelligence = intelligenceState();
  communityUI.update(intelligence);
  $("intelligence-status").dataset.state = intelligence.kind;
  const intelligenceLabel = `${intelligence.title} · ${intelligence.action === "Enable" ? "Open options to enable" : "Open intelligence options"}`;
  $("intelligence-status").title = intelligenceLabel;
  $("intelligence-status").setAttribute("aria-label", intelligenceLabel);
  if ($("intelligence-title")) {
    $("intelligence-title").textContent = intelligence.title;
    $("intelligence-detail").textContent = intelligence.detail;
    $("intelligence-enable").hidden =
      optionsTab === "intelligence" &&
      ["on", "thinking", "loading"].includes(intelligence.kind);
    $("intelligence-disable").hidden = !brainStatus.ready && !brainStatus.busy;
    $("intelligence-progress").textContent =
      optionsTab === "intelligence" && (brainStatus.busy || brainStatus.error)
        ? brainStatus.detail
        : "";
  }
  $("population-count").textContent = short(world.population);
  const orbit = orbitSummary(world);
  $("population").title = `${orbit.ground.toLocaleString()} on the ground · ${orbit.residents.toLocaleString()} in the orbital colony. Find your colony.`;
  const objective = activeGoal(world);
  const state = objective ? inspectGoal(world, objective) : null;
  const health = colonyHealth(world);
  const [title, detail] = health.atRisk
    ? ["THE COLONY NEEDS YOU", health.message]
    : objective
      ? [goalTitle(objective), state.blocker || state.step]
      : goal(world);
  $("goal-title").textContent = title;
  $("goal-detail").textContent = detail;
  htmlIfChanged($("resources"),
    `<button class="resource" data-material="wood" title="Put wood on the ground"><img src="${iconUrl("log")}" alt="Wood">${short(world.inventory.wood)}</button>${world.inventory.bones ? `<button class="resource" data-material="bones" title="Place bones">${short(world.inventory.bones)} bones</button>` : ""}${world.inventory.corpses ? `<button class="resource" data-material="corpses" title="Place stored remains">${short(world.inventory.corpses)} remains</button>` : ""}${world.stage >= 2 ? `<span class="resource" title="Cut stone for construction"><img src="${iconUrl("stone")}" alt="Cut stone">${short(world.inventory.blocks)}</span><button class="resource" data-material="ore" title="Place ore"><img src="${iconUrl("ore")}" alt="Ore">${short(world.inventory.ore)}</button>` : ""}${orbit.available ? `<button class="resource orbit-button ${orbit.flying ? "in-flight" : ""}" data-action="orbit" title="See their orbital home and arrivals" aria-label="View orbital home">${uiIcon("orbit")} ${short(orbit.residents)} <small>IN ORBIT</small></button>` : ""}`);
  $("save-status").textContent = saveHealth.status;
  if ($("options-save-status"))
    $("options-save-status").textContent = saveHealth.status;
  const paused = world.ui.paused || $("modal").open;
  htmlIfChanged($("pause"), uiIcon(paused ? "play" : "pause"));
  $("pause").setAttribute("aria-label", paused ? "Resume game" : "Pause game");
  htmlIfChanged($("sound"), uiIcon(world.ui.muted ? "muted" : "sound"));
  $("sound").setAttribute(
    "aria-label",
    world.ui.muted ? "Turn sound on" : "Mute sound",
  );
  $("sound").title = world.ui.muted
    ? "Sound off · turn on creature songs"
    : "Creature songs on · mute sound";
  $("pause-label").hidden = !paused;
  const signature = toolsKey(world);
  if (signature !== toolSignature) {
    toolSignature = signature;
    renderTools();
  }
  const c = world.creatures.find((c) => c.id === world.ui.selected),
    o =
      world.objects.find((o) => o.id === world.ui.selected) ||
      naturalObject(world, world.ui.selected);
  const selectedOrbit = world.ui.selected === "orbital-home" && orbit.available;
  $("inspector").hidden = !c && !o && !selectedOrbit;
  if (selectedOrbit) {
    htmlIfChanged($("inspector"), `<button class="close" data-action="deselect" aria-label="Close orbital home">${uiIcon("close")}</button><h3>Our orbital home</h3>${orbitDetails(world,orbit)}`);
  } else if (c) {
    htmlIfChanged($("inspector"),
      `<button class="close" data-action="deselect" aria-label="Close creature details">${uiIcon("close")}</button><h3 class="creature-name">${esc(c.name)}</h3><div class="identity-actions"><button data-action="rename" aria-label="Rename ${esc(c.name)}">${uiIcon("edit")} Rename</button><button data-action="favorite" aria-label="${c.favorite ? "Unpin" : "Pin"} this creature" aria-pressed="${!!c.favorite}">${uiIcon("star")} ${c.favorite ? "Pinned" : "Pin"}</button></div><p>${TASK_NAMES[c.task] || "Exploring"}${c.carry ? ` · ${c.carry} ${esc(c.cargoKind)}` : ""}</p><small>${esc(c.job?.state === "queued" ? "Waiting for a clear space" : c.job?.purpose || "")}</small>${["fed", "clean", "amused"].map((n) => `<div class="need"><span>${n === "fed" ? "FED" : n === "clean" ? "CLEAN" : "AMUSED"}</span><div class="meter" role="meter" aria-label="${n}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(c[n])}"><i style="width:${Math.round(c[n])}%;${c[n] < 30 ? "background:#be765c" : ""}"></i></div><span>${Math.round(c[n])}</span></div>`).join("")}<small>${Math.min(c.fed, c.clean, c.amused) > 65 ? "Feeling good. Growing a little more…" : "Every little need matters."}</small>`);
  } else if (o) {
    htmlIfChanged($("inspector"),
      `<button class="close" data-action="deselect" aria-label="Close object details">${uiIcon("close")}</button><h3>${esc(displayName(o.type))}${o.level > 1 ? " II" : ""}</h3><p>${esc(BUILDINGS[o.type]?.help || (o.type === "bridge" ? `Delivered: ${Math.floor(o.stock)}/${bridgeGeometry(o).required} · ${bridgeGeometry(o).delivered.wood} wood, ${bridgeGeometry(o).delivered.bones} bones` : o.type === "monolith" ? "Tap the survey beacon with the hand." : "Part of our little world."))}</p>${o.type === "bridge" ? bridgeDetails(o) : ""}${o.type === "cannon" ? orbitDetails(world,orbit) : ""}${buildingDetails(o,engine.views?.building)}`);
  }
  if ($("brain-status"))
    $("brain-status").textContent =
      `${brainStatus.busy ? "Thinking… " : ""}${brainStatus.detail}`;
  const t = brainStatus.timing;
  if ($("growth-diagnostics")) {
    const g=world.runtime?.growth;
    $("growth-diagnostics").textContent=g
      ? `${g.reason}. ${world.creatures.length} individual creatures. ${g.gpuDuty===null ? "GPU timing unavailable or warming; using frame-time safeguards" : `${(g.gpuDuty*100).toFixed(1)}% estimated rendering duty / 50% target`}. Main-thread work ${(g.cpuDuty*100).toFixed(1)}%. Births ${g.held?"waiting":"allowed as care permits"}.`
      : "Measuring device headroom when play resumes.";
  }
  if ($("diagnostics")) {
    $("diagnostics").textContent = t
      ? `${brainStatus.source} · ${t.roundTripMs ? `${Math.round(t.roundTripMs)} ms round trip` : t.cacheMs !== undefined ? `${t.cacheMs.toFixed(2)} ms cache lookup` : ""} · ${t.tokens || "—"} tokens · ${t.inferenceMs ? `${Math.round(t.inferenceMs)} ms fresh inference` : ""} · ${brainStatus.decisions} fresh decisions, ${brainStatus.cacheHits} cached choices. Local scheduler: ${(world.runtime?.schedulerMs || 0).toFixed(2)} ms (not model inference). ${t.truncated ? "Some lower-priority context was omitted to fit the model." : ""}`
      : `No fresh model decision yet. Local instincts are running. Scheduler: ${(world.runtime?.schedulerMs || 0).toFixed(2)} ms for ${world.creatures.length} creatures.`;
    const review=brainStatus.scheduleReview;
    if(review) $("diagnostics").textContent += ` Group calls ${brainStatus.scheduleCalls}; development calls ${brainStatus.developmentCalls}; single-choice reviews ${brainStatus.singleChoiceReviews}. ${review.reason||""} Planning scores: ${review.choices.map(c=>`${c.id} ${c.reward.total.toFixed(2)}`).join("; ")}. These are estimates, not online learning rewards.`;
  }
}
async function runAI(fresh = false) {
  if (!world.creatures.length || (!fresh && !world.settings.autonomy)) {
    if (fresh)
      showAdvancedNotice(
        "A decision needs a living colony. Open a spacecraft first.",
      );
    return;
  }
  const current = world;
  try {
    const result = await decide(fresh ? await engine.query("state.migrateWorld",{raw:world}) : world, token, {
      fresh,
    });
    if (!result || current !== world) {
      if (fresh)
        showAdvancedNotice(
          "A decision is already in progress or the provider is not ready. Please try again shortly.",
        );
      return;
    }
    if (fresh) {
      showAdvancedNotice(
        `${result.source}: ${result.policy} · ${Math.round(result.timing?.roundTripMs || 0)} ms. Preview only; no assignments were applied.`,
      );
      return;
    }
    if (world.ui.paused || $("modal").open || document.hidden) {
      lastAI = -Infinity;
      lastSettlement = -Infinity;
      return;
    }
    await engine.command("planning.commitDecision",{result});
  } catch (error) {
    if (fresh) showAdvancedNotice(error.message);
  }
}
async function runSettlement() {
  const current = world;
  try {
  const result = await decideSettlement(current,token);
  if (!result || current !== world || world.ui.paused || $("modal").open || document.hidden ||
      !independent(world) || world.commandRevision !== result.revision) return;
  if(await engine.command("settlement.commitDecision",{result})){lastAI=-Infinity;save();}
  } catch (error) {
    if (current === world) showAdvancedNotice(error.message);
  }
}

function showAdvancedNotice(message) {
  advancedNotice = message;
  if ($("advanced-notice")) $("advanced-notice").textContent = message;
}
function showOptionsNotice(message) {
  if ($("options-notice")) $("options-notice").textContent = message;
  else if ($("advanced-notice")) showAdvancedNotice(message);
}

async function loadModel({
  mode = world.settings.backend,
  allowDownload = false,
} = {}) {
  if (brainStatus.busy) return;
  const current = world,
    loadId = ++modelLoadId;
  if (allowDownload) {
    world.settings.localEnabled = true;
    save();
  }
  brainStatus.error = null;
  brainStatus.detail = allowDownload
    ? "Opening approved local model…"
    : "Opening cached local model…";
  renderUi();
  try {
    configureBrain(world.settings);
    const result = await loadLaya(mode, undefined, { allowDownload });
    if (
      !result ||
      current !== world ||
      loadId !== modelLoadId ||
      !world.settings.localEnabled ||
      world.settings.provider !== "laya"
    )
      return;
    world.settings.localBackend = result.backend;
    save();
    lastAI = -Infinity;
    lastSettlement = -Infinity;
  } catch (error) {
    if (
      current !== world ||
      loadId !== modelLoadId ||
      !world.settings.localEnabled ||
      world.settings.provider !== "laya"
    )
      return;
    brainStatus.detail = error.message;
    brainStatus.error = error.message;
  }
  renderUi();
}
view = new WorldView(
  $("world"),
  () => world,
  async (p, entity) => {
    if (world.ui.paused || $("modal").open) return;
    if (!isExplored(world,p)) { toast("Let the colony explore this ground first."); return; }
    if (!world.progress.hatched && entity?.type === "lander")
      world.ui.tool = "inspect";
    if (world.ui.tool === "meteor" && unlocked(world,TOOLS.meteor)) {
      const error=meteorTargetError(world,p.x,p.y);
      if(error) {toast(error);return;}
      const current=world;
      const launched=view.launchMeteor(p,sceneTime,async ()=>{
        if(current!==world)return;
        const result=await engine.command("simulation.meteorImpact",{x:p.x,y:p.y});
        if(result.message)speak(result.message);
        if(result.sound)sound(result.sound);
        await engine.command("planning.reschedule",{policy:current.memory.lastPlan?.policy || "balanced"});
        renderUi();save();
      });
      if(launched)sound("meteor-fall");
      else toast("Let the sky settle for a moment.");
      return;
    }
    const result = await engine.command("simulation.interact",{tool:world.ui.tool,x:p.x,y:p.y,entity:entity?.id || null});
    if (world.ui.tool === "inspect") life.touch(world, entity, sceneTime);
    if (result.choice) choiceDialog(result.choice, result.entity);
    else {
      if (result.message) {
        if (result.placed === false) toast(result.message);
        else speak(result.message);
      }
      if (result.sound) {
        sound(result.sound);
        await engine.command("planning.reschedule",{policy:world.memory.lastPlan?.policy || "balanced"});
      }
    }
    renderUi();
    save();
  },
  async (creature, target, point) => {
    if (world.ui.paused || $("modal").open) return;
    if (!isExplored(world,point)) { toast("Let the colony explore this ground first."); return; }
    if (creature.type === "rock") {
      const error = await engine.command("simulation.relocate",{id:creature.id,point});
      if (error) toast(error);
      save();
      return;
    }
    if (world.stage !== 3 || target?.type !== "hole") return;
    if (!await engine.command("simulation.connectSurvivor",{id:creature.id})) return;
    if (world.stage === 4) {
      ending();
    } else {
      speak("We can hear you a little more clearly.");
    }
    save();
  },
  life,
);
$("population-icon").src = iconUrl("creature");
$("menu").onclick = () => options();
$("journal-button").onclick = journal;
$("goals-button").onclick = goalsModal;
$("population").onclick = () => {
  view.focus(world.creatures[0]?.x ?? 24, world.creatures[0]?.y ?? 24);
  world.ui.selected = world.creatures[0]?.id || null;
  renderUi();
};
$("zoom-out").onclick = () => view.zoom(1 / 1.2);
$("zoom-in").onclick = () => view.zoom(1.2);
$("camera-home").onclick = () => $("population").click();
$("goal").onclick = () => {
  if (activeGoal(world) && (activeGoal(world).kind !== "bridge" || world.progress.bridge)) {
    goalsModal();
    return;
  }
  if (world.population < 4) view.focus();
  else if (!world.progress.bridge) {
    const bridge = world.objects.find((o) => o.type === "bridge");
    if (bridge) {
      view.focus(bridge.x-3, bridge.y);
      world.ui.selected = bridge.id;
      world.ui.tool = "inspect";
      renderUi();
    }
  }
  else if (world.stage === 1) view.focus(51, 22);
  else view.focus(52, 22);
  toast(goal(world)[1]);
};
$("pause").onclick = () => {
  if (saveHealth.conflict) {
    toast("A newer world is open in another tab. Reload to continue.");
    return;
  }
  world.ui.paused = !world.ui.paused;
  renderUi();
  save();
};
$("sound").onclick = () => {
  world.ui.muted = !world.ui.muted;
  if (world.ui.muted) conversation.silence();
  else awakenCreatureVoice();
  renderUi();
  sound();
  save();
};
$("tabs").onclick = (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) {
    world.ui.tab = b.dataset.tab;
    renderTools();
    save();
  }
};
$("tool-list").onclick = (e) => {
  const b = e.target.closest("[data-tool]");
  if (!b) return;
  const key = b.dataset.tool,
    spec = key.startsWith("build:") ? BUILDINGS[key.slice(6)] : TOOLS[key];
  if (!unlocked(world, spec) && !(key === "grabber" && world.ui.held)) {
    toast(`${spec.name} unlocks at ${lockReason(spec)}.`);
    return;
  }
  world.ui.tool = key;
  renderTools();
  save();
};
async function action(name) {
  if (name === "orbit") {
    world.ui.selected = "orbital-home";
    renderUi();
    return;
  }
  if (name === "bridge-supply") {
    toast(await engine.command("simulation.supplyBridge",{id:world.ui.selected}));
    await engine.command("planning.reschedule");
    lastAI = -Infinity;
    renderUi();
    save();
    return;
  }
  if (name === "bridge-axe") {
    world.ui.tool = "axe";
    world.ui.tab = "tools";
    world.ui.selected = null;
    renderUi();
    save();
    return;
  }
  if (name === "rename") {
    renameDialog();
    return;
  }
  if (name === "archive") {
    archiveDialog();
    return;
  }
  if (name === "favorite") {
    const c = world.creatures.find((c) => c.id === world.ui.selected);
    if (c) {
      await engine.command("identity.favorite",{id:c.id});
      renderUi();
      save();
    }
    return;
  }
  if (name === "save-name") {
    const form = $("rename-form");
    if (!form || dialogType !== "rename" || form.dataset.saving) return;
    const current = world, c = world.creatures.find((c) => c.id === form.dataset.creatureId);
    if (!c) { $("rename-error").textContent = "This Tripelkin is no longer here."; return; }
    const input = $("creature-name");
    const result = await engine.command("identity.renameCreature",{id:c.id,input:input.value});
    if (result.error) {
      $("rename-error").textContent = result.error;
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    form.dataset.saving = "true";
    const button = form.querySelector('[type="submit"]');
    input.disabled = true;
    button.disabled = true;
    button.textContent = "Saving…";
    const saved = await save();
    if (world !== current || !form.isConnected || dialogType !== "rename") return;
    delete form.dataset.saving;
    input.disabled = false;
    button.disabled = false;
    button.textContent = "Keep this name";
    if (!saved) {
      $("rename-error").textContent = `The name changed in this session, but could not be saved. ${saveHealth.status}. Your entry is kept here.`;
      return;
    }
    closeModal();
    toast(`${result.name} it is.`);
    return;
  }
  if (changingWorld) return;
  if (name.startsWith("recover:") || name.startsWith("rescue:")) {
    const entry = recoveryEntries[Number(name.split(":")[1])];
    if (entry?.world) {
      const next = await engine.query("state.recoverSnapshot",{raw:entry.world,rescue:name.startsWith("rescue:")});
      await switchWorld(
        next,
        "Earlier world restored. Check their needs, then press P to continue.",
        entry.world,
        entry.origin || {
          savedWorld: entry.key || null,
          at: entry.savedAt || null,
        },
      );
    }
    return;
  }
  if (dialogType === "options") {
    captureSettings();
    save();
  }
  if (name === "voice-enable") return reviewDownload("whisper");
  if (name.startsWith("voice-")) return conversation.action(name);
  if (name === "talk") return conversation.open();
  if (name === "goals") return goalsModal();
  switch (name) {
    case "close":
      captureSettings();
      closeModal();
      save();
      break;
    case "deselect":
      world.ui.selected = null;
      renderUi();
      break;
    case "enter":
      captureSettings();
      world.ui.welcome = true;
      closeModal();
      save();
      if (!world.progress.hatched)
        speak("There you are. Tap the spacecraft to say hello.");
      break;
    case "welcome-intelligence":
      world.ui.welcome = true;
      save();
      options("intelligence");
      break;
    case "opening-story":
      captureSettings();
      openingStory(true);
      break;
    case "independence":
      communityUI.independence();
      break;
    case "inbox":
      communityUI.inbox();
      break;
    case "intelligence":
      options("intelligence");
      break;
    case "intelligence-connect":
      options("advanced");
      break;
    case "choose-local":
      if (world.settings.provider !== "laya") {
        modelLoadId++;
        stopBrain();
      }
      world.settings.provider = "laya";
      save();
      await reviewDownload("laya");
      break;
    case "load-model":
      await reviewDownload("laya");
      break;
    case "voice-cpu":
      await reviewDownload("whisper", "wasm");
      break;
    case "download-confirm": {
      const request = downloadRequest;
      if (!request?.backend || request.world !== world) return;
      downloadRequest = null;
      if (request.kind === "laya") {
        options("intelligence");
        await loadModel({ mode: request.backend, allowDownload: true });
      } else {
        options("controls");
        await conversation.action("voice-enable", request.backend);
      }
      break;
    }
    case "disable-intelligence":
      modelLoadId++;
      stopBrain();
      world.settings.localEnabled = false;
      token = "";
      brainStatus.detail =
        "Intelligence is off. Built-in instincts are active.";
      save();
      options("intelligence");
      break;
    case "clear-models":
      modelLoadId++;
      world.settings.localEnabled = false;
      save();
      await clearModelCache();
      showAdvancedNotice(brainStatus.detail);
      break;
    case "connect": {
      captureSettings();
      stopBrain();
      const connectingWorld = world,
        connectionId = ++modelLoadId;
      brainStatus.busy = true;
      brainStatus.detail = "Checking your OpenRouter connection…";
      try {
        const detail = await checkOpenRouter(world.settings.url, token);
        if (
          connectionId !== modelLoadId ||
          world !== connectingWorld ||
          !["openrouter", "jev"].includes(world.settings.provider)
        )
          return;
        brainStatus.detail = detail;
        brainStatus.ready = true;
        brainStatus.error = null;
        lastAI = -Infinity;
        lastSettlement = -Infinity;
        showAdvancedNotice(brainStatus.detail);
        save();
      } catch (e) {
        if (connectionId !== modelLoadId || world !== connectingWorld) return;
        brainStatus.ready = false;
        brainStatus.error = e.message;
        brainStatus.detail = e.message;
        showAdvancedNotice(e.message);
      } finally {
        if (connectionId === modelLoadId) brainStatus.busy = false;
        renderUi();
      }
      break;
    }
    case "fresh":
      captureSettings();
      if (world.settings.provider === "laya" && !brainStatus.ready)
        showAdvancedNotice("Load the selected local model first.");
      else await runAI(true);
      break;
    case "context": {
      const ctx = await engine.query("planning.buildContext",{includePlans:true});
      modal(
        "What the colony remembers.",
        "LIVE AI CONTEXT",
        `<div class="button-row"><button class="secondary" data-options-tab="advanced">← Advanced options</button></div><p class="muted">${ctx.context.groups.length} groups · ${world.creatures.length} members · feasible complete candidate schedules. Laya receives up to 320 tokens for schedules and development, with current needs kept ahead of optional details. OpenRouter receives a budgeted projection; the full view below stays in the game.</p><pre class="research">${esc(JSON.stringify({ current: ctx.context, budget: brainStatus.contextBudget, lastHostedRequest: brainStatus.sentContext }, null, 2))}</pre><details><summary>Saved decision history</summary><pre class="research">${esc(JSON.stringify({ goals: world.memory.goals, decisions: world.decisions, projects: world.groups, promises: world.story.promises }, null, 2))}</pre></details>`,
        "context",
      );
      break;
    }
    case "export":
      await downloadSave(world);
      break;
    case "import":
      $("import-file").click();
      break;
    case "persist":
      showOptionsNotice(
        (await persistStorage())
          ? "Your browser will keep this world on this device. Download a copy to keep it elsewhere, too."
          : "Your browser couldn’t reserve a space. Download a copy of your world to keep it safe.",
      );
      break;
    case "history":
      await historyMenu();
      break;
    case "preview-moment": {
      const point = historyMoments[Number($("history-moment")?.value)];
      if (!point) break;
      const restored = await recoverMoment(point.branch, point.id);
      if (dialogType !== "history") break;
      recoveryEntries = [
        {
          label: "A moment from your story",
          origin: { branch: point.branch, moment: point.id },
          world: restored,
          savedAt: point.at,
          health: await engine.query("state.colonyHealth",{world:restored}),
          facilities: restored.objects
            .filter((o) =>
              ["orchard", "bath", "roundabout", "dwelling", "theatre"].includes(
                o.type,
              ),
            )
            .map((o) => o.type),
        },
      ];
      renderRecovery();
      break;
    }
    case "legacy":
    case "restore":
      await recoveryMenu(name === "legacy");
      break;
    case "new":
      modal(
        "Another small beginning.",
        "NEW WORLD",
        `<p>Your current world will be archived on this device. You can restore it in Options.</p><div class="button-row"><button class="secondary" data-action="close">Keep playing</button><button class="primary" data-action="new-confirm">Archive world & start a new landing</button></div>`,
        "new",
      );
      break;
    case "new-confirm": {
      const next = await engine.query("state.createWorld",{empty:false,seed:crypto.getRandomValues(new Uint32Array(1))[0]});
      next.settings = { ...world.settings };
      await switchWorld(next, "A new little life. Press P when you’re ready.");
      break;
    }
    case "journal":
      journal();
      break;
    case "guide":
      guideModal();
      break;
    case "architecture":
      guideModal("architecture");
      break;
    case "upgrade":
      toast(
        await engine.command("simulation.upgrade",{id:world.ui.selected}),
      );
      save();
      break;
  }
}
listen(document, "click", async (e) => {
  const material = e.target.closest("[data-material]");
  if (material && !world.ui.paused && !$("modal").open) {
    if (world.ui.held || await engine.command("simulation.withdrawMaterial",{kind:material.dataset.material})) {
      world.ui.tool = "grabber";
      toast("Tap clear ground to place it.");
      renderUi();
      save();
    }
    return;
  }
  if (changingWorld) {
    e.preventDefault();
    return;
  }
  const goalButton = e.target.closest("[data-goal-action]");
  if (goalButton) {
    const changed=await engine.command("goals.change",{id:goalButton.dataset.goalId,action:goalButton.dataset.goalAction});
    if(changed){
      lastAI = -Infinity;
      lastSettlement = -Infinity;
      save();
      renderUi();
      goalsModal();
    }
    return;
  }
  const section = e.target.closest("[data-options-tab]");
  if (section) {
    captureSettings();
    save();
    options(section.dataset.optionsTab);
    return;
  }
  const provider = e.target.closest("[data-provider]");
  if (provider) {
    captureSettings();
    if (world.settings.provider !== provider.dataset.provider) {
      modelLoadId++;
      world.settings.provider = provider.dataset.provider;
      if (world.settings.provider === "jev") world.settings.model = JEV_MODEL;
      else if (
        world.settings.provider === "openrouter" &&
        world.settings.model.includes("jev")
      )
        world.settings.model = "openai/gpt-5-mini";
      stopBrain();
    }
    save();
    options("advanced");
    return;
  }
  const choice = e.target.closest("[data-choice]");
  if (choice) {
    if (choice.dataset.choice === "nuke" && choice.dataset.answer === "yes") {
      try {
        if (!disposable) await checkpointWorld(world);
      } catch (error) {
        toast("Could not keep a restore point. Your world is unchanged.");
        return;
      }
    }
    speak(
      await engine.command("simulation.choose",{kind:choice.dataset.choice,answer:choice.dataset.answer,entity:choice.dataset.entity}),
    );
    closeModal();
    sound("birth");
    save();

    return;
  }
  const button = e.target.closest("[data-action]");
  if (button)
    action(button.dataset.action).catch((e) => {
      showAdvancedNotice(e.message);
      toast(
        "Something went wrong. Please try again. Details are in Advanced options.",
      );
    });
});
listen($("modal"), "cancel", (event) => {
  event.preventDefault();
  captureSettings();
  closeModal();
  save();
});
listen($("modal"), "change", (e) => {
  if (["decision-speed", "intelligence-workers"].includes(e.target.id)) {
    captureSettings();
    renderIntelligenceTuning();
    save();
  }
  if (["option-sound", "autonomy"].includes(e.target.id)) {
    captureSettings();
    save();
    renderUi();
  }
  if (e.target.id === "backend") {
    captureSettings();
    stopBrain();
    brainStatus.detail = "Runtime changed. Load the selected model when ready.";
  }
});
listen($("modal"), "input", (e) => {
  if (["decision-speed", "intelligence-workers"].includes(e.target.id)) renderIntelligenceTuning();
});
listen($("modal"), "submit", (e) => {
  if (e.target.id !== "rename-form") return;
  e.preventDefault();
  const form = e.target;
  action("save-name").catch(() => {
    if (!form.isConnected) return;
    delete form.dataset.saving;
    form.querySelector("input").disabled = false;
    const button = form.querySelector('[type="submit"]');
    button.disabled = false;
    button.textContent = "Keep this name";
    $("rename-error").textContent = "We could not keep that name. Your entry is still here.";
  });
});
$("import-file").onchange = async (e) => {
  if (changingWorld || !e.target.files.length) return;
  try {
    const next = await importSaveFile(e.target.files[0]);
    await switchWorld(
      next,
      "World opened, paused. Check their needs, then press P to continue.",
    );
  } catch (error) {
    showAdvancedNotice(error.message);
    toast(
      "We couldn’t open that saved world. Please choose a Tripelkins save file.",
    );
  }
  e.target.value = "";
};
listen(window, "keydown", (e) => {
  if (e.defaultPrevented) return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.isContentEditable) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  if ($("modal").open) return;
  const pan = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }[e.key];
  if (pan) {
    e.preventDefault();
    view.pan(pan[0] * 120, pan[1] * 120);
    return;
  }
  if (["+", "=", "-", "_"].includes(e.key)) {
    e.preventDefault();
    view.zoom(e.key === "+" || e.key === "=" ? 1.2 : 1 / 1.2);
    return;
  }
  if (e.code === "KeyP") {
    e.preventDefault();
    $("pause").click();
  }
  if (e.key === "Escape") options();
  if (e.key.toLowerCase() === "t") conversation.open();
  const tool = { 1: "inspect", 2: "banana", 3: "cloth", 4: "cricketball" }[e.key];
  if (tool) {
    world.ui.tool = tool;
    world.ui.tab = "care";
    renderTools();
  }
});
const modelBudget = backgroundBudget({
  release: () => {
    if (world.settings.provider === "laya") {
      modelLoadId++;
      stopBrain("The background tab released its model memory.");
      brainStatus.detail = "Intelligence is resting while this tab is hidden.";
    }
    disposeVoice();
  },
  resume: () => {
    if (world.settings.provider === "laya" && world.settings.localEnabled)
      loadModel();
    // Voice wakes on demand; don't load two models at once just to show the UI.
  },
});
listen(document, "visibilitychange", () => {
  modelBudget.hidden(document.hidden);
  if (document.hidden) {
    engine.updatePresentation({paused:true,ui:world.ui,settings:world.settings});
    stopCreatureVoice();
    conversation.close();
    save();
  }
  last = performance.now();
});
listen(window, "pagehide", () => {
  conversation.close();
  modelBudget.suspend();
  save();
});
listen(window, "pageshow", () => modelBudget.hidden(document.hidden));
const growthBudget = new GrowthBudget();
function frame(now) {
  const workStarted = performance.now(), elapsed = now - last;
  const delta = Math.min((now - last) / 1000, 0.2);
  last = now;
  const paused =
    storageBlocked ||
    changingWorld ||
    view.contextLost ||
    document.hidden ||
    $("modal").open ||
    world.ui.paused;
  if (growthBudget.world !== world) growthBudget.reset(world, now);
  engine.updatePresentation({paused,ui:world.ui,settings:world.settings,
    intelligenceAvailable:intelligenceReady(),growth:growthBudget.state});
  if(!paused)sceneTime+=delta*1000;
  // Simulation remains at 10 Hz. Pixel-art presentation needs at most 30 Hz,
  // independent of a 60/120/144 Hz monitor. Paused frames are retained.
  let rendered = false;
  if (!document.hidden && now - lastDraw >= 1000 / 30 - 1) {
    life.update(world, sceneTime, {
      paused,
      listening: conversation.listening,
      view,
    });
    rendered = view.render(sceneTime, { paused }) === true;
    lastDraw = now;
  }
  if (!document.hidden && now - lastUi > 400) {
    renderUi();
    if (!paused) showStory();
    lastUi = now;
  }
  const developmentEvent=decisionEvent(world,"development"), scheduleEvent=decisionEvent(world,"schedule");
  if (!paused && !conversation.listening && decisionDue(world.settings,"development",world.time-lastSettlement,developmentEvent!==lastSettlementEvent) && independent(world) && canDecide("development")) {
    lastSettlement = world.time;
    lastSettlementEvent=developmentEvent;
    runSettlement();
  }
  if (!paused && !conversation.listening && decisionDue(world.settings,"schedule",world.time-lastAI,scheduleEvent!==lastAIEvent) && canDecide("schedule")) {
    lastAI = world.time;
    lastAIEvent=scheduleEvent;
    runAI();
  }
  growthBudget.update(world, { now, elapsed, cpuMs: performance.now() - workStarted,
    rendered, gpu: view.gpuTimer.stats, paused });
  // Keep model progress/options responsive without redrawing the colony.
  if (paused) frameTimer = setTimeout(() => {
    animationFrame = requestAnimationFrame(frame);
  }, document.hidden ? 1000 : 100);
  else animationFrame = requestAnimationFrame(frame);
}
renderUi();
conversation.warm();
modelBudget.hidden(document.hidden);
animationFrame = requestAnimationFrame(frame);
if (previewScene === "prologue" || !world.ui.welcome) openingStory();
else if (world.stage === 4) ending();
else if (world.settings.provider === "laya" && world.settings.localEnabled)
  loadModel();

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    appEvents.abort();
    prologuePlayer?.dispose();
    cancelAnimationFrame(animationFrame);
    clearTimeout(frameTimer);
    modelBudget.dispose();
    clearTimeout(toastTimer);
    audio?.close();
    window.removeEventListener("pointerdown", unlockCreatureSound, {
      capture: true,
    });
    window.removeEventListener("keydown", unlockCreatureSound, {
      capture: true,
    });
    life.dispose();
    stopBrain();
    communityUI.dispose();
    conversation.dispose();
    view.dispose();
    engine.dispose();
  });
