import { BUILDINGS } from "./catalog.js";
import { serviceSlots, clearPosition } from "./geometry.js";
import { routeCost, withRouteCosts } from "./navigation.js";
import { careServices } from "./care-context.js";
import { workProjects, workerProject } from "./work-projects.js";
import { NEED_DECAY, CARE_START, working } from "./work-balance.js";

export const OUTPOST = Object.freeze({ horizon:300, speed:1.65, minimumResidents:4,
  maxCamps:16, capacity:{orchard:14,bath:10,roundabout:20,dwelling:18,theatre:48} });
const needKey={food:"fed",wash:"clean",play:"amused"};
const worlds=new WeakMap();
const deliveryRoutes=new WeakMap();
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const round=n=>Math.round(n*10)/10;
// Worker-seconds: a round trip per expected need cycle, compared with the
// labor spent building. This is an estimate, not currency or an AI reward.
export function outpostEconomics({workers,oldDistance,newDistance,kind,wood=0,blocks=0,builderDistance=0}) {
  const visits=OUTPOST.horizon*NEED_DECAY[needKey[kind]]/(98-CARE_START);
  const savedSeconds=workers*visits*2*Math.max(0,oldDistance-newDistance)/OUTPOST.speed;
  // Six wood / six seconds, ten blocks / three seconds, 32 construction
  // worker-seconds. Include sourcing overhead instead of treating stock as free.
  const buildSeconds=32+wood*2+blocks*.6+builderDistance/OUTPOST.speed;
  return {savedSeconds:round(savedSeconds),buildSeconds:round(buildSeconds),
    netSeconds:round(savedSeconds-buildSeconds),
    paybackSeconds:savedSeconds>0?Math.ceil(OUTPOST.horizon*buildSeconds/savedSeconds):null};
}
export function workshopEconomics({miners,stock,oldDistance,newDistance,builderDistance=0}) {
  // One mining cycle yields three ore. Each carrier makes an outward and a
  // return journey. Never justify a new works using more ore than remains.
  const trips=Math.min(stock/3,miners*OUTPOST.horizon/(3+2*oldDistance/OUTPOST.speed));
  const savedSeconds=trips*2*Math.max(0,oldDistance-newDistance)/OUTPOST.speed;
  const spec=BUILDINGS.factory,buildSeconds=32+spec.wood*2+spec.cost*.6+builderDistance/OUTPOST.speed;
  return {savedSeconds:round(savedSeconds),buildSeconds:round(buildSeconds),netSeconds:round(savedSeconds-buildSeconds),
    paybackSeconds:savedSeconds>0?Math.ceil(OUTPOST.horizon*buildSeconds/savedSeconds):null};
}
function nearest(w,p,kind,providers) {
  let best=Infinity;
  for(const o of providers.filter(o=>careServices(o.type).includes(kind))
    .sort((a,b)=>distance(a,p)-distance(b,p)).slice(0,4)) {
    if(distance(o,p)>64) continue;
    for(const s of serviceSlots(w,o).slice(0,3)) best=Math.min(best,routeCost(w,p,s));
  }
  return best;
}
export function outpostCamps(w) {
  // Reuse a bounded view; movement/needs are refreshed within five seconds.
  const stamp=`${Math.floor(w.time/5)}:${w.navRevision}:${w.map.revision}:${w.discovery.revision}:${w.creatures.length}:${w.commandRevision}`;
  const hit=worlds.get(w);if(hit?.stamp===stamp)return hit.camps;
  const bins=[];
  for(const c of w.creatures) {
    if(c.task==="explore" || c.sickness>=50 || (w.directives.members.length&&!w.directives.members.includes(c.id))) continue;
    const project=workerProject(w,c);
    const p=project || (working(c) && c.job?.point ? c.job.point : c);
    if(w.directives.region && (p.x>42)!==(w.directives.region.x>42))continue;
    let bin=bins.find(b=>distance(b,p)<14);
    if(!bin){bin={x:p.x,y:p.y,type:p.type,members:[],workers:0};bins.push(bin);}
    bin.members.push(c.id);if(project||working(c))bin.workers++;
  }
  const providers=[...w.objects.filter(o=>careServices(o.type).length),
    ...workProjects(w).filter(p=>careServices(p.type).length)];
  const camps=withRouteCosts(w,()=>bins.filter(b=>b.members.length>=OUTPOST.minimumResidents)
    .sort((a,b)=>b.workers-a.workers||b.members.length-a.members.length).slice(0,OUTPOST.maxCamps)
    .map(b=>{
      const representative=w.creatures.find(c=>b.members.includes(c.id) && clearPosition(w,c));
      const point=clearPosition(w,b)?b:serviceSlots(w,b).find(p=>clearPosition(w,p))||representative||b;
      return {...b,x:point.x,y:point.y,distances:Object.fromEntries(Object.keys(needKey).map(kind=>[kind,nearest(w,point,kind,providers)]))};
    }));
  worlds.set(w,{stamp,camps});return camps;
}
export function assessOutpost(w,type,p,builderDistance=0,{routed=false}={}) {
  if(type==="factory")return assessWorkshop(w,p,builderDistance,routed);
  const kinds=careServices(type),spec=BUILDINGS[type];
  if(!kinds.length || !spec)return null;
  const camps=outpostCamps(w).filter(c=>distance(c,p)<=24);
  let remaining=OUTPOST.capacity[type]||0, saved=0, workers=0,unserved=0,roundTrip=0;
  for(const c of camps.sort((a,b)=>distance(a,p)-distance(b,p))) {
    const n=Math.min(remaining,c.members.length);if(!n)break;
    const local=routed ? Math.min(...serviceSlots(w,{...p,type,level:1}).map(s=>routeCost(w,c,s))) : distance(c,p);
    if(!Number.isFinite(local))continue;
    for(const kind of kinds) {
      const old=c.distances[kind];
      // An unreachable service is a support gap, never a fictitious route.
      if(!Number.isFinite(old)){unserved+=n;continue;}
      const result=outpostEconomics({workers:n,oldDistance:old,newDistance:local,kind});
      saved+=result.savedSeconds;roundTrip=Math.max(roundTrip,2*old/OUTPOST.speed);
    }
    workers+=n;remaining-=n;
  }
  const build=outpostEconomics({workers:0,oldDistance:0,newDistance:0,kind:"food",wood:spec.wood||0,
    blocks:spec.cost||0,builderDistance}).buildSeconds;
  const worthwhile=workers>=OUTPOST.minimumResidents && (unserved>0 || saved>=build*1.25);
  return {workers,unserved,savedSeconds:round(saved),buildSeconds:build,netSeconds:round(saved-build),
    paybackSeconds:saved>0?Math.ceil(OUTPOST.horizon*build/saved):null,
    roundTripSeconds:Math.ceil(roundTrip),worthwhile};
}
function assessWorkshop(w,p,builderDistance,routed) {
  const mines=w.objects.filter(o=>o.type==="mine"&&o.stock>0&&distance(o,p)<=28);
  const factories=[...w.objects,...workProjects(w)].filter(o=>o.type==="factory");
  const stamp=`${w.navRevision}:${w.map.revision}:${w.objects.length}`;
  let routes=deliveryRoutes.get(w);
  if(routes?.stamp!==stamp){routes={stamp,costs:new Map()};deliveryRoutes.set(w,routes);}
  let workers=0,saved=0,unserved=0,roundTrip=0;
  const assigned=new Set();
  for(const mine of mines.slice(0,4)) {
    const crew=w.creatures.filter(c=>!assigned.has(c.id)&&distance(c,mine)<=28).slice(0,4);
    const miners=crew.length;
    if(!miners)continue;
    const origin=serviceSlots(w,mine)[0];if(!origin)continue;
    if(!routes.costs.has(mine.id))routes.costs.set(mine.id,Math.min(Infinity,...factories.filter(f=>distance(f,mine)<=64)
      .sort((a,b)=>distance(a,mine)-distance(b,mine)).slice(0,4).flatMap(f=>
        serviceSlots(w,f).slice(0,3).map(s=>routeCost(w,origin,s)))));
    const old=routes.costs.get(mine.id);
    const local=routed?Math.min(...serviceSlots(w,{...p,type:"factory",level:1}).map(s=>routeCost(w,origin,s))):distance(origin,p);
    if(!Number.isFinite(local))continue;
    crew.forEach(c=>assigned.add(c.id));
    workers+=miners;
    if(!Number.isFinite(old)){if(mine.stock>=12)unserved+=miners;continue;}
    saved+=workshopEconomics({miners,stock:mine.stock,oldDistance:old,newDistance:local}).savedSeconds;
    roundTrip=Math.max(roundTrip,2*old/OUTPOST.speed);
  }
  const build=workshopEconomics({miners:0,stock:0,oldDistance:0,newDistance:0,builderDistance}).buildSeconds;
  return {purpose:"ore-delivery",workers,unserved,savedSeconds:round(saved),buildSeconds:build,netSeconds:round(saved-build),
    paybackSeconds:saved>0?Math.ceil(OUTPOST.horizon*build/saved):null,roundTripSeconds:Math.ceil(roundTrip),
    worthwhile:workers>0&&(unserved>0||saved>=build*1.25)};
}
export function outpostContext(w) {
  return outpostCamps(w).flatMap(c=>Object.entries(c.distances).filter(([,d])=>!Number.isFinite(d)||d>18)
    .map(([kind,d])=>({at:[Math.round(c.x),Math.round(c.y)],residents:c.members.length,workers:c.workers,kind,
      roundTripSeconds:Number.isFinite(d)?Math.ceil(2*d/OUTPOST.speed):null,unserved:!Number.isFinite(d)})))
    .sort((a,b)=>Number(b.unserved)-Number(a.unserved)||(b.roundTripSeconds||0)-(a.roundTripSeconds||0)).slice(0,6);
}
