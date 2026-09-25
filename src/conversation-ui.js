import { parseConstraints, commitConstraints } from "./game/commands.js";
import { converse, brainStatus } from "./brain.js";
import { applyPlan, makePlan } from "./game/simulation.js";
import { remember } from "./game/state.js";
import { postMessage, activity } from "./game/community.js";
import { createTalkGesture } from "./talk-gesture.js";
import { beginCommand } from "./game/memory.js";
import {
  addGoal,
  advanceGoals,
  activeGoal,
  goalTitle,
  inspectGoal,
  goalPolicy,
} from "./game/goals.js";
import {
  voiceStatus,
  connectVoice,
  prepareVoice,
  configureVoiceBackend,
  recordVoice,
  finishVoice,
  cancelVoice,
  clearVoiceCache,
  disposeVoice,
} from "./voice.js";
import {
  awakenCreatureVoice,
  singReply,
  stopCreatureVoice,
  disposeCreatureVoice,
} from "./creature-voice.js";
const $ = (id) => document.getElementById(id);
const editing = (event) =>
  event.target.closest?.("input, textarea, select, [contenteditable=true]");

export function createConversation({
  getWorld,
  getToken,
  openOptions,
  canConverse,
  openIntelligence,
  closeModal,
  save,
  onGoal,
  onReply,
}) {
  let controller,
    held = false,
    holdSource = null,
    listener = null,
    subtitleTimer,
    setupEpoch = 0,
    enabling = false,
    lastVoiceError = "",
    conversationError = "";
  connectVoice(render, (text) => {
    held = false;
    holdSource = null;
    send(text, listener, "voice");
  });
  function caption(who, text) {
    clearTimeout(subtitleTimer);
    $("voice-subtitles").hidden = false;
    const line = who === "you" ? $("player-subtitle") : $("colony-subtitle");
    line.hidden = false;
    line.textContent = text;
    if (who === "you") $("colony-subtitle").hidden = true;
    else
      subtitleTimer = setTimeout(
        () => {
          $("voice-subtitles").hidden = true;
        },
        6000,
      );
  }
  function render() {
    const phase = voiceStatus.phase;
    if (["error", "idle", "ready"].includes(phase)) { held = false; holdSource = null; }
    const enabled = getWorld().settings.voiceEnabled;
    const unavailable = voiceStatus.needsDownload || !!voiceStatus.setupError;
    if (phase === "error") lastVoiceError = voiceStatus.message;
    const capturing = ["requesting", "recording", "transcribing"].includes(
      phase,
    );
    $("talk").classList.toggle("recording", phase === "recording");
    $("talk").setAttribute("aria-pressed", String(phase === "recording"));
    $("talk").setAttribute(
      "aria-label",
      getWorld().settings.voiceEnabled
        ? "Tap to talk, tap again to send. Or hold and release. Space also works."
        : "Enable voice conversation",
    );
    $("talk-label").textContent = phase === "recording" ? "SEND" : "TALK";
    $("voice-live").hidden =
      $("modal").open ||
      (!capturing && !controller && (phase !== "error" || !enabled));
    $("voice-live").dataset.phase = phase;
    $("voice-live-text").textContent = controller
      ? "The colony is listening to your words…"
      : phase === "recording"
        ? `Listening · ${voiceStatus.seconds.toFixed(1)}s · ${holdSource === "keyboard" ? "release Space" : "tap again or release your hold"} to send`
        : phase === "requesting"
          ? "Opening microphone…"
          : phase === "transcribing"
            ? "Hearing your words…"
            : friendlyVoiceError();
    $("voice-live-level").style.transform =
      `scaleX(${Math.max(0.02, Math.min(1, voiceStatus.level * 5.5))})`;
    $("voice-setup-status") &&
      ($("voice-setup-status").textContent =
        enabling || phase === "loading"
          ? "Getting ready to hear you… You can keep playing while this finishes."
          : phase === "error" || unavailable
            ? voiceStatus.needsDownload
              ? "The current voice model needs a download. Review the amount below to enable talking."
              : friendlyVoiceError()
            : enabled
              ? "Talking is on. Tap the microphone to start and again to send, or hold Space and release."
              : "Talking is off. Enable intelligence to send messages; voice is an optional extra.");
    if ($("voice-enable")) {
      $("voice-enable").disabled = enabling || phase === "loading";
      $("voice-enable").hidden =
        enabled && phase !== "error" && !unavailable && !enabling;
      $("voice-enable").textContent = enabling
        ? "Getting ready…"
        : enabled
          ? "Review download & try again"
          : "Review voice download";
    }
    if ($("voice-disable")) $("voice-disable").hidden = !enabled;
    if ($("voice-diagnostics"))
      $("voice-diagnostics").textContent =
        `${voiceStatus.backend || "Not loaded"} · ${voiceStatus.message}${lastVoiceError ? ` · Last voice error: ${lastVoiceError}` : ""}${conversationError ? ` · Last conversation error: ${conversationError}` : ""}`;
    $("chat-send").disabled =
      !!controller || capturing || !$("chat-input").value.trim();
  }
  function friendlyVoiceError() {
    if (voiceStatus.needsDownload)
      return "Talking needs setup. Open Options → Controls, or press T to type.";
    const message = voiceStatus.message;
    if (/too quiet|too short/i.test(message))
      return "We couldn’t hear that. Speak a little closer and try again.";
    if (/access was declined|permission|notallowed/i.test(message))
      return "Allow your microphone in the browser to talk, or press T to type.";
    if (/microphone|https|audioworklet/i.test(message))
      return "Your microphone isn’t available. Please reconnect it or press T to type.";
    if (/timed out|too long/i.test(message))
      return "That took a little too long. Try a shorter message.";
    return "Speech recognition couldn’t finish. Try again or reopen voice setup in Options. Press T to type.";
  }
  function setup() {
    openOptions();
    render();
  }
  async function enable(backend) {
    const current = ++setupEpoch;
    const w = getWorld();
    w.settings.voiceEnabled = true;
    w.settings.voiceConfigured = true;
    enabling = true;
    save();
    const ready = await prepareVoice({ backend, allowDownload: true });
    if (current !== setupEpoch || w !== getWorld()) return;
    enabling = false;
    if (ready) {
      lastVoiceError = "";
      w.settings.voiceBackend = voiceStatus.backend;
      save();
    }
    render();
  }
  function start(source) {
    if (
      $("modal").open ||
      held ||
      ["requesting", "recording", "transcribing"].includes(voiceStatus.phase)
    )
      return;
    if (!canConverse()) {
      openIntelligence();
      return;
    }
    if (!getWorld().settings.voiceEnabled || voiceStatus.needsDownload) {
      setup();
      return;
    }
    controller?.abort();
    controller = null;
    held = true;
    holdSource = source;
    listener = getWorld().ui.selected;
    $("chat-composer").hidden = true;
    clearTimeout(subtitleTimer);
    $("voice-subtitles").hidden = true;
    stopCreatureVoice();
    awakenCreatureVoice();
    recordVoice();
  }
  function finish(source) {
    if (!held || holdSource !== source) return;
    held = false;
    holdSource = null;
    finishVoice();
    render();
  }
  function close() {
    held = false;
    holdSource = null;
    controller?.abort();
    controller = null;
    $("chat-composer").hidden = true;
    cancelVoice();
    stopCreatureVoice();
    render();
  }
  async function send(raw, target = getWorld().ui.selected, channel = "typed") {
    const text = String(raw).trim().slice(0, 500);
    if (!text) return;
    if (!canConverse()) {
      $("chat-input").value = text;
      openIntelligence();
      return;
    }
    controller?.abort();
    const current = new AbortController(),
      w = getWorld();
    controller = current;
    const reference = parseConstraints(w, text, target);
    target = reference.listener || target;
    const command = beginCommand(w, text, channel, target);
    remember(w, "command", text, target);
    const cancel = () => {
      if (command.status === "pending") {
        command.status = "cancelled";
        if (getWorld() === w) save();
      }
    };
    current.signal.addEventListener("abort", cancel, { once: true });
    caption("you", text);
    render();
    try {
      if ((await save()) === false)
        throw new Error(
          "Your words could not be saved. Check Saved worlds in Options.",
        );
      if (current.signal.aborted || getWorld() !== w) return;
      const answer = await converse(
        w,
        text,
        getToken(),
        target,
        current.signal,
      );
      if (current.signal.aborted || getWorld() !== w) return;
      if (answer.constraints) commitConstraints(w, answer.constraints);
      let mood = "reply";
      brainStatus.error = null;
      if (answer.goal) {
        const objective = addGoal(w, answer.goal, text, answer.source);
        command.goalId = objective.id;
        for (const finished of advanceGoals(w))
          remember(
            w,
            "goal-complete",
            `We reached our goal: ${goalTitle(finished)}.`,
          );
        const state = inspectGoal(w, objective);
        answer.reply =
          objective.status === "completed"
            ? `We have already reached that goal: ${goalTitle(objective)}.`
            : `${objective.status === "queued" ? "We’ll remember this for next" : objective.status === "paused" ? "This goal is saved and paused" : "We’ll keep working toward this"}: ${goalTitle(objective)}. ${state.blocker || state.step}`;
        remember(w, "goal", `We agreed on a goal: ${goalTitle(objective)}.`);
        const focus = activeGoal(w);
        if (focus?.id === objective.id) {
          w.memory.lastPlan = {
            policy: state.policy,
            source: "Goal planner",
            tick: Math.floor(w.time),
            goalId: focus.id,
          };
          applyPlan(w, makePlan(w, goalPolicy(w)));
        }
        mood = state.blocker ? "blocked" : "goal";
        onGoal?.();
      }
      command.status = "completed";
      command.reply = answer.reply.slice(0, 500);
      command.source = answer.source;
      w.memory.conversations.push({
        text,
        reply: answer.reply.slice(0, 500),
        source: answer.source,
        tick: Math.floor(w.time),
        listener: w.creatures.some((c) => c.id === target) ? target : null,
      });
      w.memory.conversations = w.memory.conversations.slice(-24);
      remember(
        w,
        "conversation",
        `You said: ${text.slice(0, 180)}`,
        target || null,
      );
      caption("colony", answer.reply);
      postMessage(w, { title: "A word with the colony", text: `You: ${text}\nThe colony: ${answer.reply}` });
      const message = w.community.inbox.at(-1);
      if (message) message.notified = true;
      activity(w, "conversation", "Heard your words", answer.source, answer.reply);
      const quiet = w.ui.paused || document.hidden || $("modal").open;
      const phrase = singReply(answer.reply, w.population, mood, {
        muted: w.ui.muted || quiet,
      });
      if (!quiet) onReply?.(target, mood, phrase);
      $("chat-input").value = "";
      save();
    } catch (error) {
      if (!current.signal.aborted && getWorld() === w) {
        command.status = "failed";
        command.reply = "The colony could not reply. You can try again.";
        save();
        conversationError = error.message;
        if (!/shorter message/i.test(error.message)) {
          brainStatus.error = error.message;
          brainStatus.detail = error.message;
        }
        caption(
          "colony",
          /shorter message/i.test(error.message)
            ? "That was a little too much to take in. Please try a shorter message."
            : "We lost the thread. Please try again. You can check the connection in Options.",
        );
        $("chat-input").value = text;
        $("chat-composer").hidden = false;
      }
    } finally {
      current.signal.removeEventListener("abort", cancel);
      if (controller === current) {
        controller = null;
        render();
      }
    }
  }
  function open() {
    if ($("modal").open) closeModal();
    $("chat-composer").hidden = !$("chat-composer").hidden;
    if (!$("chat-composer").hidden) $("chat-input").focus();
    render();
  }
  const talk = $("talk");
  const gesture = createTalkGesture({ start: () => start("pointer"), finish: () => finish("pointer"), active: () => held && holdSource === "pointer" });
  talk.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    talk.setPointerCapture(event.pointerId);
    gesture.down();
  };
  talk.onpointerup = () => gesture.up();
  talk.onpointercancel = () => {
    gesture.cancel();
    if (holdSource === "pointer") close();
  };
  talk.onlostpointercapture = () => {
    // Normal pointerup releases capture too; a latched tap must keep recording.
    if (gesture.pressed) { gesture.cancel(); if (holdSource === "pointer") close(); }
  };
  talk.onclick = (event) => {
    if (event.detail === 0) held ? finish(holdSource) : start("accessible");
  };
  $("talk-type").onclick = open;
  $("chat-close").onclick = () => {
    $("chat-composer").hidden = true;
  };
  $("chat-input").oninput = render;
  $("chat-form").onsubmit = (event) => {
    event.preventDefault();
    if (!$("chat-send").disabled) {
      awakenCreatureVoice();
      send($("chat-input").value);
      $("chat-composer").hidden = true;
    }
  };
  const keydown = (event) => {
    if (
      event.code === "Escape" &&
      (held ||
        ["requesting", "recording", "transcribing"].includes(
          voiceStatus.phase,
        ) ||
        controller ||
        !$("chat-composer").hidden)
    ) {
      event.preventDefault();
      close();
      return;
    }
    if (event.code !== "Space" || editing(event) || $("modal").open) return;
    event.preventDefault();
    if (!event.repeat) start("keyboard");
  };
  const keyup = (event) => {
    if (event.code === "Space" && holdSource === "keyboard") {
      event.preventDefault();
      finish("keyboard");
    }
  };
  const blur = () => {
    if (held || ["requesting", "recording"].includes(voiceStatus.phase))
      close();
  };
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", blur);
  return {
    get listening() {
      return (
        held ||
        !!controller ||
        ["requesting", "recording", "transcribing"].includes(voiceStatus.phase)
      );
    },
    open,
    close,
    render,
    silence: stopCreatureVoice,
    warm: async () => {
      const w = getWorld();
      if (getWorld() === w && w.settings.voiceEnabled)
        configureVoiceBackend(w.settings.voiceBackend);
      render();
    },
    action: async (name, backend) => {
      if (name === "voice-enable") await enable(backend);
      else if (name === "voice-setup") setup();
      else if (name === "voice-clear" || name === "voice-disable") {
        setupEpoch++;
        enabling = false;
        close();
        getWorld().settings.voiceEnabled = false;
        getWorld().settings.voiceConfigured = true;
        save();
        if (name === "voice-clear") await clearVoiceCache();
        else disposeVoice();
        render();
      }
    },
    dispose: () => {
      setupEpoch++;
      close();
      clearTimeout(subtitleTimer);
      disposeVoice();
      disposeCreatureVoice();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    },
  };
}
