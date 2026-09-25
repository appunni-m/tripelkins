import { iconUrl } from "./game/art.js";

const escape = value => String(value ?? "").replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

export function orbitSummary(w) {
  const recent = w.departed.filter(c => c.cause === "orbit").slice(-4).reverse();
  return {
    available: w.orbital.population > 0 || w.objects.some(o => o.type === "cannon"),
    residents: w.orbital.population,
    ground: w.creatures.length + w.cohort,
    launches: w.orbital.launches,
    flying: w.orbital.launches > 0 && w.time - w.orbital.lastLaunch < 1.7,
    recent,
  };
}

export function orbitDetails(w, summary = orbitSummary(w)) {
  const latest = summary.recent[0];
  return `<div class="orbit-map ${summary.flying ? "in-flight" : ""}" role="img" aria-label="The clearing is connected to a shared home in orbit.">
    <svg viewBox="0 0 240 120" aria-hidden="true">
      <circle cx="41" cy="91" r="27" fill="#7b9290"/><path d="M20 80l18-9 16 8-4 11-17 1-5 16" fill="#a3ac7c"/>
      <path d="M62 79Q103 16 179 38" fill="none" stroke="#b2b4ae" stroke-dasharray="3 5"/>
      <path d="M163 39h67m-55-9v18m43-18v18" stroke="#8392a6" stroke-width="6"/>
      <ellipse cx="196" cy="39" rx="20" ry="13" fill="#beb1c7"/><path d="M182 35q14-17 28 0" fill="#a0c3b5"/>
      <circle cx="191" cy="42" r="3" fill="#e4d3a4"/><circle cx="202" cy="42" r="3" fill="#e4d3a4"/>
    </svg><img class="orbit-traveller" src="${iconUrl("creature")}" alt="">
    <span class="orbit-ground">Clearing</span><span class="orbit-home">Orbital home</span>
  </div><div class="orbit-census"><span><b>${summary.ground.toLocaleString()}</b> on the ground</span><span><b>${summary.residents.toLocaleString()}</b> ${summary.flying ? "in the orbital colony*" : "at their orbital home"}</span></div>
  <p class="orbit-arrival">${latest ? `${escape(latest.name)} ${summary.flying ? "is on the way up. They will reach the orbital home in a moment." : "reached the orbital home safely."}` : "Healthy volunteers will travel here. At least eight Tripelkins stay on the ground; pinned friends stay too."}</p>
  <small>${summary.launches.toLocaleString()} journeys · Only real arrivals add residents.${summary.flying ? " *Includes the current traveller." : ""}</small>
  ${summary.recent.length ? `<details class="orbit-arrivals"><summary>Recent travellers</summary><ul>${summary.recent.map(c=>`<li>${escape(c.name)} · ${w.time-c.tick<1.7 ? "on the way" : "arrived"}</li>`).join("")}</ul></details>` : ""}`;
}
