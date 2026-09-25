import {
  chirpCreature,
  songPhrase,
  stopCreatureVoice,
} from "./creature-voice.js";

const TASK_MOODS = {
  gather: "work",
  quarry: "work",
  refine: "work",
  construct: "work",
  clean: "wash",
  eat: "eat",
  wash: "wash",
  play: "play",
  home: "content",
  haul: "work",
  mine: "work",
  work: "work",
  orbit: "work",
  social: "greet",
  explore: "greet",
  rest: "content",
};
const minimum = (c) => Math.min(c.fed, c.clean, c.amused);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Presentation only. No random simulation state, history entries or save data.
// At most one record per living creature and eight short-lived queued calls.
export class ColonyLife {
  constructor() {
    this.members = new Map();
    this.calls = new Map();
    this.nextCall = 0;
    this.nextAmbient = 0;
    this.turn = 0;
    this.quiet = true;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  }
  reset(w, time) {
    stopCreatureVoice();
    this.world = w;
    this.members.clear();
    this.calls.clear();
    this.nextCall = time + 300;
    this.nextAmbient = time + 1200;
    this.turn = 0;
    this.replyUntil = 0;
    for (const c of w.creatures) this.members.set(c.id, this.record(c));
  }
  record(c) {
    return {
      x: c.x,
      y: c.y,
      fed: c.fed,
      clean: c.clean,
      amused: c.amused,
      work: c.work,
      growth: c.growth,
      target: c.target,
      movingUntil: 0,
      working: false,
      facing: 1,
      nextVoice: 0,
      reaction: null,
      song: null,
    };
  }
  cue(c, mood, time, priority = 1) {
    if (!this.members.has(c.id)) this.members.set(c.id, this.record(c));
    if (this.calls.size < 8 || this.calls.has(c.id)) {
      const old = this.calls.get(c.id);
      if (!old || priority >= old.priority)
        this.calls.set(c.id, {
          id: c.id,
          mood,
          due: time,
          expires: time + 1800,
          priority,
        });
    }
  }
  react(c, mood, time, duration = 1100) {
    const state = this.members.get(c.id);
    if (state) state.reaction = { mood, start: time, end: time + duration };
  }
  touch(w, c, time) {
    if (!c || !w.creatures.includes(c)) return;
    if (this.world !== w) this.reset(w, time);
    this.react(c, "greet", time);
    this.cue(c, minimum(c) < 25 ? "need" : "greet", time, 4);
  }
  reply(w, listener, mood, phrase, time, view) {
    if (this.world !== w) this.reset(w, time);
    this.calls.clear();
    this.replyUntil = time + phrase.duration * 1000 + 500;
    const visible = w.creatures.filter((c) => view.audibility(c).volume > 0);
    visible.sort(
      (a, b) =>
        Number(b.id === listener) - Number(a.id === listener) ||
        distance(a, w.ui) - distance(b, w.ui),
    );
    for (const [i, c] of visible.slice(0, w.population < 6 ? 1 : 3).entries()) {
      this.members.get(c.id).song = { ...phrase, start: time + i * 40 };
      this.react(
        c,
        mood === "blocked" ? "need" : "greet",
        time,
        phrase.duration * 1000,
      );
    }
  }
  update(w, time, { paused, listening, view }) {
    if (this.world !== w) this.reset(w, time);
    const quiet = paused || w.ui.muted || listening;
    if (quiet && !this.quiet) {
      stopCreatureVoice();
      for (const state of this.members.values()) state.song = null;
      this.replyUntil = 0;
    }
    if (quiet) this.calls.clear();
    if (!quiet && this.quiet) this.nextAmbient = time + 800;
    this.quiet = quiet;
    const present = new Set();
    for (const c of w.creatures) {
      present.add(c.id);
      let state = this.members.get(c.id);
      if (!state) {
        state = this.record(c);
        this.members.set(c.id, state);
        if (!paused) {
          this.react(c, "birth", time, 1600);
          if (!quiet) this.cue(c, "birth", time, 3);
        }
      }
      const moved = distance(c, state) > 0.002;
      if (moved) {
        state.movingUntil = time + 180;
        if (Math.abs(c.x - state.x) > 0.002)
          state.facing = c.x > state.x ? 1 : -1;
      }
      state.working = c.work > 0 && time >= state.movingUntil;
      if (!paused) {
        let reaction;
        if (
          c.gesture?.until > w.time &&
          c.gesture.until !== state.lastGesture
        ) {
          const mood =
            {
              song: "content",
              mourning: "need",
              comfort: "greet",
              celebration: "birth",
              farewell: "greet",
              question: "greet",
            }[c.gesture.kind] || "play";
          this.react(c, mood, time);
          this.cue(c, mood, time, 3);
          state.lastGesture = c.gesture.until;
        }
        if (c.clean > state.clean + 3) reaction = "wash";
        else if (c.growth < state.growth - 15) reaction = "birth";
        else if (c.work > 0 && (state.work === 0 || state.target !== c.target))
          reaction = TASK_MOODS[c.task];
        else if (
          minimum(c) < 25 &&
          Math.min(state.fed, state.clean, state.amused) >= 25
        )
          reaction = "need";
        if (reaction) {
          this.react(c, reaction, time);
          if (!quiet && time >= state.nextVoice)
            this.cue(c, reaction, time, reaction === "need" ? 3 : 1);
        }
      }
      Object.assign(state, {
        x: c.x,
        y: c.y,
        fed: c.fed,
        clean: c.clean,
        amused: c.amused,
        work: c.work,
        growth: c.growth,
        target: c.target,
      });
    }
    for (const id of this.members.keys())
      if (!present.has(id)) {
        this.members.delete(id);
        this.calls.delete(id);
      }
    for (const [id, call] of this.calls)
      if (time > call.expires) this.calls.delete(id);
    if (paused || listening || time < this.replyUntil) return;
    const visible = w.creatures.filter((c) => view.audibility(c).volume > 0);
    // Silent players still see calls and mouth movement. Their mute choice is respected.
    if (time >= this.nextAmbient && visible.length) {
      const candidates = visible.filter(
        (c) => time >= this.members.get(c.id).nextVoice,
      );
      const c = candidates[this.turn % Math.max(1, candidates.length)];
      if (c) {
        const state = this.members.get(c.id);
        const mood =
          minimum(c) < 25
            ? "need"
            : state.working
              ? TASK_MOODS[c.task] || "content"
              : "content";
        this.cue(c, mood, time);
        this.turn++;
      }
      this.nextAmbient = time + 2800 + (this.turn % 4) * 450;
    }
    if (time < this.nextCall) return;
    const call = [...this.calls.values()]
      .filter((call) => call.due <= time)
      .sort((a, b) => b.priority - a.priority)[0];
    if (!call) return;
    this.calls.delete(call.id);
    const c = w.creatures.find((c) => c.id === call.id);
    if (!c) return;
    const spatial = view.audibility(c);
    if (spatial.volume <= 0) return;
    const state = this.members.get(c.id);
    const companions =
      call.mood === "content" &&
      call.priority > 0 &&
      this.turn % 4 === 0 &&
      !state.working
        ? visible
            .filter(
              (other) =>
                other.id !== c.id &&
                distance(c, other) < 6 &&
                minimum(other) > 35 &&
                !this.members.get(other.id).working &&
                time >= this.members.get(other.id).nextVoice,
            )
            .slice(0, w.population < 40 ? 1 : 2)
        : [];
    const phrase = w.ui.muted
      ? songPhrase(call.mood)
      : chirpCreature(c.id, w.population, call.mood, {
          pan: spatial.pan,
          volume: 0.07 * spatial.volume,
          layers: companions.length + 1,
        });
    state.song = { ...phrase, start: time };
    state.nextVoice = time + 5500;
    for (const [i, friend] of companions.entries()) {
      const member = this.members.get(friend.id);
      member.song = { ...phrase, start: time + (i + 1) * 40 };
      member.nextVoice = time + 5500;
      this.calls.delete(friend.id);
    }
    this.nextCall = time + Math.max(1500, phrase.duration * 1000 + 500);
    if (
      !companions.length &&
      ["content", "greet", "birth"].includes(call.mood) &&
      call.priority !== 0
    ) {
      const friend = visible.find(
        (other) =>
          other.id !== c.id &&
          distance(c, other) < 6 &&
          minimum(other) > 35 &&
          time >= this.members.get(other.id).nextVoice,
      );
      if (friend) this.cue(friend, "content", this.nextCall, 0);
    }
  }
  pose(c, time) {
    const state = this.members.get(c.id);
    const seed = Number(c.id.slice(1)) || 0;
    const moving = state && time < state.movingUntil;
    const reaction = state?.reaction?.end > time ? state.reaction.mood : null;
    const task = state?.working ? c.task : null;
    const cycle = time / 150 + seed;
    let frame = moving
      ? `walk${Math.floor(cycle) % 2}`
      : (time / 1000 + seed * 0.7) % 4.7 < 0.15
        ? "blink"
        : "idle";
    let lift = moving
      ? Math.abs(Math.sin(cycle * Math.PI)) * 2.3
      : Math.sin(time / 550 + seed) * 0.35;
    let sx = 1,
      sy = 1,
      effect = null,
      offsetX = 0;
    if (task === "eat") {
      frame = `eat${Math.floor(cycle) % 2}`;
      sx = 1.05;
      sy = 0.94;
      effect = "crumbs";
    } else if (task === "wash" || task === "clean" || reaction === "wash") {
      frame = "wash";
      offsetX = Math.sin(time / 55) * 1.2;
      effect = "bubbles";
    } else if (task === "play" || reaction === "birth") {
      frame = `play${Math.floor(cycle) % 2}`;
      const hop = Math.max(0, Math.sin(time / 155 + seed));
      lift = hop * (reaction === "birth" ? 9 : 6);
      sx = 1.08 - hop * 0.14;
      sy = 0.94 + hop * 0.15;
      effect = reaction === "birth" ? "sparkles" : null;
    } else if (["mine", "work", "gather", "quarry", "refine", "construct"].includes(task)) {
      frame = `work${Math.floor(cycle) % 2}`;
      sy = 0.94 + Math.sin(time / 115) * 0.06;
      effect = "dust";
    } else if (task === "haul" || task === "orbit") {
      frame = `play${Math.floor(cycle) % 2}`;
      sy = 0.94 + Math.sin(time / 150) * 0.06;
    } else if (task === "home") {
      frame = "blink";
      sy = 0.93;
    } else if (minimum(c) < 25) {
      frame = "need";
      sy = 0.92;
      effect =
        c.fed <= c.clean && c.fed <= c.amused
          ? "hunger"
          : c.clean <= c.amused
            ? "dirty"
            : "lonely";
    } else if (reaction === "greet") {
      frame = `play${Math.floor(cycle) % 2}`;
      lift = Math.max(0, Math.sin(time / 140)) * 3;
    }
    const song = state?.song;
    if (
      song &&
      time >= song.start &&
      time < song.start + song.duration * 1000
    ) {
      const note = (time - song.start - 35) / (song.beat * 1000);
      const open = note >= 0 && note < song.notes.length && note % 1 < 0.75;
      if (!task && !moving) {
        frame = open ? "sing" : "idle";
        sy = open ? 1.06 : 1;
        lift = open ? 2.5 : 0;
      } else if (open) frame = "sing";
      if (open) effect = "notes";
    }
    if (this.reducedMotion.matches) {
      lift = 0;
      sx = 1;
      sy = 1;
      offsetX = 0;
    }
    return {
      frame,
      lift,
      sx,
      sy,
      offsetX,
      facing: state?.facing || 1,
      effect,
      effectLift: this.reducedMotion.matches ? 0 : (time / 55 + seed) % 8,
    };
  }
  dispose() {
    stopCreatureVoice();
    this.members.clear();
    this.calls.clear();
  }
}
