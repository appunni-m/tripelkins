import { OPENING_DURATION, OPENING_SCENES } from "./game/prologue.js";
import "./opening-story.css";

export function openingMarkup(portrait) {
  return `<section class="opening-story" aria-label="The Tripelkins' journey">
    <div class="opening-art" aria-hidden="true">
      <div class="opening-stars"></div><div class="opening-suns"><i></i><i></i><i></i></div>
      <div class="opening-home"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="opening-trail"></div><div class="opening-ship"><div class="opening-window"><img src="${portrait}" alt=""></div><i></i><b></b></div>
      <div class="opening-ground"></div><div class="opening-seedling">❧</div>
    </div>
    <div class="opening-caption" aria-live="polite" aria-atomic="true"><p class="eyebrow" id="opening-chapter"></p><h3 id="opening-title"></h3><p id="opening-text"></p><strong id="opening-promise"></strong></div>
    <div class="opening-timeline" aria-label="Story progress" role="progressbar" aria-valuemin="0" aria-valuemax="60" aria-valuenow="0">${OPENING_SCENES.map(()=>'<i><b></b></i>').join("")}</div>
    <div class="opening-controls"><button class="secondary" id="opening-pause" aria-pressed="false">Pause story</button><span id="opening-clock">1:00</span><button class="text-button" id="opening-skip">Skip story →</button></div>
  </section>`;
}

export function playOpening(root, onComplete) {
  const events = new AbortController();
  const find = selector => root.querySelector(selector);
  const stage = find(".opening-story"), progress = find(".opening-timeline");
  let elapsed = 0, last = performance.now(), frame, paused = false, scene = -1, disposed = false;
  const dispose = () => { disposed = true; cancelAnimationFrame(frame); events.abort(); };
  const finish = () => { if (disposed) return; dispose(); onComplete(); };
  find("#opening-skip").addEventListener("click", finish, { signal: events.signal });
  find("#opening-pause").addEventListener("click", () => {
    paused = !paused;
    find("#opening-pause").textContent = paused ? "Continue story" : "Pause story";
    find("#opening-pause").setAttribute("aria-pressed", String(paused));
    stage.classList.toggle("is-paused", paused);
    last = performance.now();
  }, { signal: events.signal });
  document.addEventListener("visibilitychange", () => { last = performance.now(); }, { signal: events.signal });
  function tick(now) {
    if (disposed) return;
    if (!paused && !document.hidden) elapsed += Math.min((now-last)/1000, .25);
    last = now;
    if (elapsed >= OPENING_DURATION) { finish(); return; }
    const index = Math.min(OPENING_SCENES.length-1, Math.floor(elapsed/10));
    if (scene !== index) {
      scene = index;
      const entry = OPENING_SCENES[index];
      stage.dataset.scene = entry.id;
      find("#opening-chapter").textContent = `FLIGHT RECORD · ${String(index+1).padStart(2,"0")} / 06`;
      find("#opening-title").textContent = entry.title;
      find("#opening-text").textContent = entry.text;
      find("#opening-promise").textContent = entry.closing || "";
    }
    const remaining = Math.ceil(OPENING_DURATION-elapsed);
    find("#opening-clock").textContent = `${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,"0")}`;
    progress.setAttribute("aria-valuenow", String(Math.floor(elapsed)));
    progress.querySelectorAll("b").forEach((bar,i)=>bar.style.transform=`scaleX(${Math.max(0,Math.min(1,(elapsed-i*10)/10))})`);
    frame = requestAnimationFrame(tick);
  }
  tick(last);
  return { finish, dispose };
}
