import { reveal } from "./discovery.js";
// Bounded, branch-local player messages and consent. No browser or model state is saved.
export const INBOX_LIMIT = 64;
export function initialCommunity() {
  return {
    consent: "unasked", project: null, projects: [], nextProject: 1, lastProjectAt: -60,
    completed: 0, inbox: [], nextMessage: 1, lastNoticeAt: -60,
    visited: [], explored: 0, activity: [], plan: null, workTurn: 0, access: [], nextAccess: 1,
  };
}
export function postMessage(w, { key = null, title = "A note from the colony", text, story = null, action = null, category = "letter", responseRequired = false }) {
  const s = w.community;
  if (key && s.inbox.some((m) => m.key === key)) return null;
  const message = { id: s.nextMessage++, key, title: title.slice(0, 100), text: String(text).slice(0, 1200),
    tick: w.time, story, action, category, responseRequired, read: false, notified: false };
  s.inbox.push(message);
  if (s.inbox.length > INBOX_LIMIT) {
    // Keep unresolved decisions in preference to routine/read conversation lines.
    let expendable = s.inbox.findIndex(m=>m.read && !m.action && !m.responseRequired);
    if (expendable<0) expendable = s.inbox.findIndex(m=>!m.action && !m.responseRequired);
    s.inbox.splice(expendable < 0 ? 0 : expendable, 1);
  }
  w.revision++;
  return message;
}
export function activity(w, kind, text, source = "Instincts", detail = "") {
  const last = w.community.activity.at(-1);
  if (last && last.kind === kind && last.text === text && last.source === source && last.detail === detail && w.time-last.tick<30) return;
  w.community.activity.push({ tick: w.time, kind, text: text.slice(0, 220), source: source.slice(0, 80), detail: detail.slice(0, 300) });
  w.community.activity = w.community.activity.slice(-40);
}
export function offerIndependence(w) {
  if (w.population <= 20 || w.community.consent !== "unasked" || w.stage >= 3) return;
  w.community.consent = "offered";
  postMessage(w, { key: "independence", title: "Could we stand on our own?",
    text: "There are more than twenty of us now. You helped our family survive. Could we use shared intelligence to gather timber and stone, grow food, and build a home of our own?", action: "independence", category:"help" });
}
export function setIndependence(w, accepted) {
  if (accepted && w.population <= 20 && w.community.consent === "unasked") return false;
  w.community.consent = accepted ? "accepted" : "declined";
  // Material is paid only on completion, so cancelling has nothing to refund.
  if (!accepted) { w.community.project = null; w.community.projects = []; }
  w.navRevision++;
  for (const m of w.community.inbox) if (m.action === "independence") { m.action = null; m.read = true; m.notified = true; }
  w.commandRevision++;
  w.revision++;
  activity(w, "consent", accepted ? "You let us gather resources and build our own settlement." : "You will guide our building for now.", "Your choice");
  return true;
}
export function nextNotice(w) {
  if (w.time - w.community.lastNoticeAt < 50) return null;
  const pending = w.community.inbox.filter((m) => !m.notified && !m.read);
  const m = pending.find((m) => m.action) || pending.at(-1);
  if (!m) return null;
  // A restored/advanced colony can unlock many old milestones at once. Keep all
  // of them in the inbox, but do not play a backlog of popups for minutes.
  for (const old of pending) if (!old.action) old.notified = true;
  m.notified = true;
  w.community.lastNoticeAt = w.time;
  return m;
}
export function visitFrontier(w, p) {
  reveal(w,p);
  const key = `${Math.floor(p.x / 8)}:${Math.floor(p.y / 8)}`;
  if (!w.community.visited.includes(key)) {
    w.community.visited.push(key);
    w.community.visited = w.community.visited.slice(-64);
    w.community.explored++;
  }
}
