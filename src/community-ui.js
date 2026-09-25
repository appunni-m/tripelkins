import { brainStatus } from "./brain.js";
import { collectStoryMessages, storyEntry, answerStory } from "./game/story.js";
import { nextNotice, setIndependence } from "./game/community.js";
import { projectName, projectStatus, projectPercent } from "./game/development.js";
import { htmlIfChanged } from "./ui-budget.js";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const stamp = (tick) => `${Math.floor(tick/60)}:${String(Math.floor(tick%60)).padStart(2,"0")}`;
export function createCommunityUI({ getWorld, ready, modal, closeModal, save, openIntelligence, onConsent, listen }) {
  let timer, wasReady = false, inboxFilter = "all";
  const categories = {flight:"Flight records",letter:"Colony letters",milestone:"Milestones",work:"Work & discoveries",help:"Requests"};
  function independenceText() {
    return ready()
      ? "Someone in the sky taught us how to stand on our own feet. May we cut trees, gather stone, work ore into blocks, supply the bridge and build our own care facilities, homes and workplaces? We will still listen to you, and care comes first."
      : "We would like to stand on our own feet. Please turn on intelligence in Options so we can think for ourselves. You can keep guiding and caring for us meanwhile.";
  }
  function consentButtons() {
    return `${ready() ? '<button class="primary" data-independence="yes">Let them grow independently</button>' : '<button class="primary" data-community-enable>Enable intelligence</button>'}<button class="secondary" data-independence="no">I’ll guide you for now</button>`;
  }
  function inbox() {
    const w = getWorld();
    collectStoryMessages(w);
    for (const m of w.community.inbox) { m.read = true; m.notified = true; }
    w.revision++;
    $("colony-notice").hidden = true;
    const entries = w.community.inbox.slice().reverse().filter(m=>inboxFilter==="all" || m.category===inboxFilter).map((m) => {
      const story = m.story && storyEntry(m.story);
      const pending = story && !w.story.responses.some((r)=>r.id===story.id) && story.responses.length>1;
      return `<article class="inbox-entry" data-category="${esc(m.category || "letter")}"><small>${stamp(m.tick)} · ${esc(categories[m.category] || "Colony letters")}${pending || m.action ? " · AWAITING YOUR REPLY" : ""}</small><h3>${esc(m.title)}</h3><p>${esc(m.action === "independence" ? independenceText() : m.text)}</p>${m.action === "independence" ? `<div class="button-row">${consentButtons()}</div>` : pending ? `<div class="button-row">${story.responses.map((r)=>`<button class="secondary" data-inbox-story="${esc(story.id)}" data-inbox-answer="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : ""}</article>`;
    }).join("");
    const filters = Object.entries({all:"Everything",...categories}).map(([key,label])=>`<button class="secondary" data-inbox-filter="${key}" aria-pressed="${inboxFilter===key}">${label}</button>`).join("");
    modal("Letters from the clearing", "THE INBOX · GAME PAUSED", `<p class="muted">Their journey, little victories, and the things they need help with. Up to 64 messages stay with this world; unanswered choices are kept first.</p><nav class="inbox-filters" aria-label="Filter inbox">${filters}</nav>${entries || '<p>No messages here yet. Their story unfolds as the colony grows.</p>'}`, "inbox");
    save();
  }
  function independence() {
    const w = getWorld();
    if (w.population <= 20 && w.community.consent === "unasked") return;
    modal("Standing on our own", "COLONY INDEPENDENCE · GAME PAUSED",
      `<p>${esc(independenceText())}</p><p class="muted">${w.community.consent === "accepted" ? "Independent building is allowed. You can take over again whenever you like." : "This choice can be changed in Options."} They use real materials, choose one development project at a time, and respect your work restrictions. Destructive powers and story choices remain yours.</p><div class="button-row">${consentButtons()}</div>`, "independence");
  }
  function update(status, notify = false) {
    const w = getWorld();
    collectStoryMessages(w);
    if (ready() && !wasReady && w.community.consent === "offered") {
      const invitation = w.community.inbox.find((m) => m.key === "independence");
      if (invitation?.read) {
        invitation.key = "independence-ready";
        invitation.title = "Now we can think together";
        invitation.read = false; invitation.notified = false;
        w.revision++;
      }
    }
    wasReady = ready();
    const unread = w.community.inbox.filter((m)=>!m.read).length;
    $("inbox-count").textContent = unread || "";
    $("inbox-count").hidden = !unread;
    $("inbox-button").setAttribute("aria-label",`Open inbox${unread ? `, ${unread} unread messages` : ""}`);
    $("thought-status").textContent = status.kind === "thinking" ? "Thinking…" : status.kind === "on" ? "Intelligence on" : status.title;
    $("thought-log").dataset.state = status.kind;
    if ($("thought-log").open) {
      const project = w.community.project;
      const jobs = w.creatures.reduce((counts,c)=>{ counts[c.task]=(counts[c.task]||0)+1;return counts; },{});
      const names = { idle:"waiting for a turn",eat:"eating",wash:"washing",play:"playing",home:"resting at home",explore:"scouting",gather:"cutting and gathering timber",quarry:"quarrying stone",refine:"working ore into blocks",construct:"building",haul:"carrying materials",mine:"mining",work:"making blocks",clean:"cleaning",social:"socialising",rest:"resting",orbit:"leaving for orbit" };
      const now = Object.entries(jobs).map(([key,count])=>`${count} ${names[key] || key}`).join(" · ");
      const entries = w.community.activity.slice(-12).reverse().map((a)=>`<li><small>${stamp(a.tick)} · ${esc(a.source)}</small><p>${esc(a.text)}</p>${a.detail ? `<span>${esc(a.detail)}</span>`:""}</li>`).join("");
      htmlIfChanged($("thought-content"),`<p class="thought-current">${esc(now || "The clearing is quiet.")}</p><small>${w.metrics.completed} tasks completed in this world · ${w.community.explored} areas scouted</small>${project ? `<p class="thought-project">${esc(projectName(project))} · ${projectPercent(w,project)}%<br>${esc(!ready() ? "Waiting for intelligence to reconnect." : !w.settings.autonomy ? "Colony initiative is paused in Options." : project.blocked || projectStatus(w,project))}</p>`:""}<p class="thought-explainer">${status.kind === "off" || status.kind === "unavailable" ? 'Instincts are keeping them alive. <button data-community-enable>Enable intelligence</button> to let them choose plans.' : !w.settings.autonomy ? "Colony initiative is paused in Options. You can still talk to them." : brainStatus.activeRequests ? "Considering a decision right now…" : "They think when there is a useful choice. Movement and care continue between decisions."}</p><ol>${entries || '<li>No decisions recorded yet.</li>'}</ol>`);
    }
    if (notify && !$("modal").open) {
      const message = nextNotice(w);
      if (message) {
        $("colony-notice-title").textContent = message.title;
        $("colony-notice-text").textContent = message.action === "independence" ? independenceText() : message.text;
        $("colony-notice").hidden = false;
        clearTimeout(timer);
        timer = setTimeout(()=>$("colony-notice").hidden=true,5000);
      }
    }
  }
  listen($("inbox-button"),"click",()=>{inboxFilter="all";inbox();});
  listen($("colony-notice-close"),"click",()=>$("colony-notice").hidden=true);
  listen($("colony-notice-read"),"click",inbox);
  listen(document,"click",(event)=>{
    const filter = event.target.closest("[data-inbox-filter]");
    if (filter && (filter.dataset.inboxFilter==="all" || Object.hasOwn(categories,filter.dataset.inboxFilter))) {
      inboxFilter=filter.dataset.inboxFilter; inbox();
    }
    if (event.target.closest("[data-community-enable]")) { $("colony-notice").hidden=true;openIntelligence(); }
    const consent = event.target.closest("[data-independence]");
    if (consent) {
      const yes = consent.dataset.independence === "yes";
      if (yes && !ready()) { openIntelligence(); return; }
      const w = getWorld();
      if (!setIndependence(w,yes)) return;
      if (yes) w.settings.autonomy = true;
      onConsent(); save(); closeModal();
    }
    const answer = event.target.closest("[data-inbox-story]");
    if (answer) {
      const w = getWorld();w.story.active=answer.dataset.inboxStory;
      answerStory(w,answer.dataset.inboxAnswer);
      const message = w.community.inbox.find((m)=>m.story===answer.dataset.inboxStory);
      if (message) { message.story=null;message.read=true;message.responseRequired=false; }
      save();inbox();
    }
  });
  return { update, inbox, independence, dispose:()=>clearTimeout(timer) };
}
