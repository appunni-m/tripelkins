// Original supplied project; public sources do not enumerate the released items.
export const PROJECTS = {
  sculpture: {
    material: "wood",
    required: 12,
    completion: "The sculpture keeps the shape of our first question.",
  },
};
export function projectState(o) {
  const spec = PROJECTS[o?.type];
  return spec
    ? {
        ...spec,
        delivered: Math.min(spec.required, o.stock || 0),
        complete: (o.stock || 0) >= spec.required,
      }
    : null;
}
export function acceptsProject(o, kind) {
  const p = projectState(o);
  return !!p && !p.complete && kind === p.material;
}
export function supplyProject(w, c, o, remember, noteEvidence) {
  const p = projectState(o);
  if (!p || !acceptsProject(o, c.cargoKind)) return false;
  const used = Math.min(c.carry, p.required - p.delivered);
  o.stock = (o.stock || 0) + used;
  c.carry -= used;
  if (!c.carry) c.cargoKind = null;
  if (o.stock >= p.required) {
    remember(w, "project", p.completion, o.id);
    noteEvidence(w, "discovered", p.completion, 1, o.id);
    o.discovered = true;
  }
  return true;
}
