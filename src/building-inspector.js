const esc = value => String(value ?? "").replace(/[&<>"']/g, c =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

// Facts and eligibility come from Rust. This module only formats the readout.
export function buildingDetails(object, inspection) {
  if (!inspection || inspection.id !== object.id) return "";
  const { rows, status, upgrade } = inspection;
  return `<dl class="building-facts">${rows.map(([label,value]) =>
    `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>
    <p class="building-status">${esc(status)}</p>${upgrade ?
      `<p id="building-upgrade-reason" class="building-upgrade-reason">${esc(upgrade.reason)}</p>${upgrade.complete ? "" :
        `<button class="upgrade" data-action="upgrade" aria-describedby="building-upgrade-reason" ${upgrade.available ? "" : "disabled"}>Upgrade to level II</button>`}` : ""}`;
}
