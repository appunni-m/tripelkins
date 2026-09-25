import { serviceSlots } from "./geometry.js";
import { routeCost, withRouteCosts } from "./navigation.js";

export const CARE_TYPES = { food:"orchard", wash:"bath", play:"roundabout" };
export const careServices = type => ({orchard:["food"],bath:["wash"],roundabout:["play"],dwelling:["food","wash"],theatre:["play"]}[type] || []);
const NEEDS = { food:"fed", wash:"clean", play:"amused" };
const SUPPORT = { orchard:14, bath:10, roundabout:20, dwelling:18, theatre:48 };
const cache = new WeakMap();
// Sustainable service estimates, separate from simultaneous job slots. Count
// only nearby entrances reachable by actual residents; a home across the river
// cannot cancel this camp's need for a bath.
export function careContext(w) {
  const facilities = w.objects.filter(o=>Object.hasOwn(SUPPORT,o.type));
  const signature = JSON.stringify([w.navRevision,w.map.revision,w.progress.bridge,
    facilities.map(o=>[o.id,o.type,o.x,o.y,o.level,Math.floor(o.stock||0)]),
    w.creatures.map(c=>[c.id,Math.floor(c.x),Math.floor(c.y),Math.floor(c.fed/5),Math.floor(c.clean/5),Math.floor(c.amused/5),c.task,c.job?.state])]);
  const hit=cache.get(w);
  if(hit?.signature===signature) return hit.value;
  const demands={};
  const value = withRouteCosts(w,()=>{
    const result={};
    for (const [kind,key] of Object.entries(NEEDS)) {
      const providers = facilities.filter(o=>kind==="play" ? ["roundabout","theatre"].includes(o.type) : [CARE_TYPES[kind],"dwelling"].includes(o.type));
      const slots = new Map(providers.map(o=>[o.id,serviceSlots(w,o)]));
      const reachable = w.creatures.map(c=>providers.filter(o=>Math.hypot(c.x-o.x,c.y-o.y)<=24)
        .sort((a,b)=>Math.hypot(c.x-a.x,c.y-a.y)-Math.hypot(c.x-b.x,c.y-b.y)).slice(0,4)
        .filter(o=>slots.get(o.id).some(p=>Number.isFinite(routeCost(w,c,p)))));
      const demand = new Map();
      for(const places of reachable) for(const o of places) demand.set(o.id,(demand.get(o.id)||0)+1);
      const coverage = reachable.map(places=>Math.min(1,places.reduce((sum,o)=>sum+SUPPORT[o.type]*(o.level||1)/demand.get(o.id),0)));
      const futureCoverage = reachable.map(places=>Math.min(1,places.reduce((sum,o)=>sum+SUPPORT[o.type]*(o.level||1)/(demand.get(o.id)*1.2),0)));
      demands[kind]=w.creatures.map((c,i)=>({id:c.id,weight:(1-coverage[i]) + Math.max(0,(60-c[key])/60)}));
      const n=w.creatures.length;
      result[kind]={ facilities:providers.length,
        low:w.creatures.filter(c=>c[key]<50).length,
        urgent:w.creatures.filter(c=>c[key]<35).length,
        min:n?Math.round(Math.min(...w.creatures.map(c=>c[key]))):100,
        unserved:reachable.filter(a=>!a.length).length,
        short:Math.max(0,Math.ceil(n-coverage.reduce((a,b)=>a+b,0)-1e-6)),
        growthShort:Math.max(0,Math.ceil(n-futureCoverage.reduce((a,b)=>a+b,0)-1e-6)),
        stock:kind==="food"?providers.filter(o=>o.type==="orchard").reduce((n,o)=>n+Math.floor(o.stock||0),0):null,
      };
    }
    return result;
  });
  cache.set(w,{signature,value,demands});
  return value;
}
export function careSummary(care) {
  return Object.entries(care).map(([kind,c])=>`${kind}: ${c.low} low, ${c.urgent} urgent, ${c.short} lack capacity, ${c.unserved} out of reach`).join("; ");
}

export function careDemand(w,type) {
  careContext(w);
  return cache.get(w).demands[Object.keys(CARE_TYPES).find(k=>CARE_TYPES[k]===type)] || [];
}
