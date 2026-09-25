// The first slot preserves older saves/UI integrations. Additional simultaneous
// crews are bounded independently of map size and survive snapshots.
export const MAX_WORK_PROJECTS = 24;
export const MAX_PROJECT_CREW = 16;
export function workProjects(w) {
  return [w.community.project, ...(w.community.projects || [])].filter(Boolean);
}
export function workerProject(w, c) {
  if (w.community.project?.crew.includes(c.id)) return w.community.project;
  return w.community.projects?.find(p=>p.crew.includes(c.id)) || null;
}
export function projectById(w, id) {
  if (w.community.project?.id===id) return w.community.project;
  return w.community.projects?.find(p=>p.id===id) || null;
}
export function projectLimit(w) {
  return Math.min(MAX_WORK_PROJECTS,Math.max(1,Math.ceil(w.creatures.length/12)));
}
export function addWorkProject(w, p) {
  if (!w.community.project) w.community.project=p;
  else (w.community.projects ||= []).push(p);
}
export function removeWorkProject(w, id) {
  const keep=workProjects(w).filter(p=>p.id!==id);
  w.community.project=keep.shift() || null;
  w.community.projects=keep;
}
