import { createWorld, addCreature, addObject } from './state.js';
import { setIndependence } from './community.js';
// Independent fixtures: each has a concrete shortage and two feasible choices,
// including waiting. Production context/options are built by settlement.js.
export function settlementWorld(missing) {
  const w=createWorld({empty:true});w.progress.hatched=true;w.inventory.wood=0;
  for(let i=0;i<24;i++) { const c=addCreature(w,20+(i%6)*1.1,20+Math.floor(i/6)*1.1);c.fed=c.clean=c.amused=85; }
  for(const [type,points] of Object.entries({orchard:[[16,20],[16,25]],bath:[[20,16],[24,16],[28,16]],roundabout:[[29,21],[29,27]]})) {
    if(type===missing)continue;
    for(const [x,y]of points)addObject(w,type,x,y,{stock:12});
  }
  for(const [x,y]of [[12,18],[12,23],[12,28]])addObject(w,'tree',x,y);
  setIndependence(w,true);w.runtime={intelligenceAvailable:true};return w;
}

export function developmentWorld(kind = "refine") {
  const w = settlementWorld("none");
  for (let i=0;i<12;i++) addObject(w,"rock",10+(i%4)*4,32+Math.floor(i/4)*4);
  addObject(w,"tree",10,12);
  if (kind === "crossing") addObject(w,"bridge",42,25);
  else { w.stage=2;w.progress.bridge=true; }
  if (kind === "timber" || kind === "quarry")
    w.memory.goals=[{id:"fixture-goal",kind:kind==="timber"?"wood":"ore",target:12,status:"active",command:"Gather twelve",createdAt:0,reviews:[]}];
  return w;
}

export function carePressureWorld(type) {
  const w=settlementWorld("none");
  const services=w.objects.filter(o=>o.type===type);
  w.objects=w.objects.filter(o=>o.type!==type || o.id===services[0].id);
  for(const c of w.creatures)c[type==="orchard"?"fed":"clean"]=40;
  w.stage=2;w.progress.bridge=true;
  w.inventory.blocks=w.progress.peakBlocks=600;
  w.inventory.wood=24;
  addObject(w,"node",33,16,{stock:10000});
  return w;
}
