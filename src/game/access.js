import { BODY_RADIUS, footprint, hitsFootprint, nearbyObstacles, walkableSurface, serviceSlots } from "./geometry.js";
import { routeCost, JOB_RADIUS } from "./navigation.js";
import { isExplored } from "./discovery.js";
import { naturalObject } from "./map.js";
import { materializeObject, remember } from "./state.js";
import { activity, postMessage } from "./community.js";
import { workOrder, working, recordWork } from "./work-balance.js";
import { BUILDINGS, displayName, TASK_NAMES } from "./catalog.js";

export const ACCESS_LIMIT = 8;
const objectAt = (w,id) => w.objects.find(o=>o.id===id) || naturalObject(w,id);
const capable = (w,c) => !c.carry && c.sickness<50 && Math.min(c.fed,c.clean,c.amused)>=45 &&
  (!w.directives.members.length || w.directives.members.includes(c.id));
export const clearanceEnabled = w => w.community.consent==="accepted" && w.settings.autonomy!==false &&
  w.runtime?.intelligenceAvailable===true && !w.directives.pauseWork && w.stage<3;
const inRegion = (w,p) => !w.directives.region || (p.x>42)===(w.directives.region.x>42);

export function accessPoint(o,c) {
  const f=footprint(o)||[.3,.3], dx=c.x-o.x, dy=c.y-o.y;
  return Math.abs(dx)>Math.abs(dy) ? {x:o.x+Math.sign(dx||1)*(f[0]+.6),y:o.y} :
    {x:o.x,y:o.y+Math.sign(dy||1)*(f[1]+.6)};
}
// Called only after a schedule is applied (never while scoring hypothetical plans).
export function requestAccess(w,{target=null,point,unit,task,project=null,reason="No clear path"}) {
  if (!point || !isExplored(w,point) || !inRegion(w,point)) return;
  const c=w.creatures.find(c=>c.id===unit);
  if (!c) return;
  // Gathering/hauling assignments do not always carry a construction job ID.
  // Preserve their parent project when its own crew encounters an obstruction.
  if (!project && ["gather","quarry","construct","refine","haul"].includes(task) && w.community.project?.crew.includes(unit))
    project=w.community.project.id;
  const destination=target && objectAt(w,target);
  // Another entrance may be reserved by a worker. That is a capacity queue,
  // not terrain to clear; check every entrance without the reservation filter.
  if ((destination ? serviceSlots(w,destination,c) : [point])
      .some(p=>Number.isFinite(routeCost(w,c,p)))) return;
  const key=target || (project ? `project:${project}` : `ground:${Math.round(point.x)}:${Math.round(point.y)}`);
  let r=w.community.access.find(r=>r.key===key);
  if (r) {
    r.lastSeen=w.time;
    if (!r.project && project) { r.project=project;r.task=task;r.unit=unit;w.revision++; }
    return r;
  }
  if (w.community.access.length>=ACCESS_LIMIT) return;
  r={id:w.community.nextAccess++,key,target,point:{x:point.x,y:point.y},unit,task,project,
    label:target ? displayName(objectAt(w,target)?.type).toLowerCase() : project ? "building site" : "new ground",
    reason,created:w.time,lastSeen:w.time,checked:-10,status:"waiting",blocker:null,crew:[],source:"",notified:false};
  w.community.access.push(r);
  activity(w,"blocked",`${c.name} needs a route to the ${r.label}.`,"Instincts",reason);
  remember(w,"blocked",`${c.name} cannot reach the ${r.label}; looking for a way through.`,unit);
  w.revision++;
  return r;
}
function removeRequest(w,r,resolved) {
  w.community.access=w.community.access.filter(a=>a!==r);
  if (resolved) {
    activity(w,"unblocked",`The path to the ${r.label} is open again.`,r.source||"Instincts");
    remember(w,"unblocked",`The colony can reach the ${r.label} again.`);
    if (r.notified) postMessage(w,{key:`access-open:${r.id}`,category:"work",title:"There is a way through now",
      text:`The path to the ${r.label} near ${Math.round(r.point.x)}, ${Math.round(r.point.y)} is open. We can try ${accessPurpose(w,r)} again. We will check the route before sending the next worker.`});
  }
  w.revision++;
}
function askForHelp(w,r,text) {
  if (r.status==="help") r.reason=text;
  if (r.notified || w.time-r.created<12) return;
  postMessage(w,{key:`access:${r.id}`,title:"Could you help us get through?",
    category:"help",text:`${w.creatures.find(c=>c.id===r.unit)?.name || "One of our workers"} is trying to ${accessPurpose(w,r)}, but cannot reach the ${r.label} near ${Math.round(r.point.x)}, ${Math.round(r.point.y)}. ${text}`});
  r.notified=true;
}

// One bounded search per six simulation seconds, regardless of population.
// Dijkstra prices removing a tree/rock above walking; buildings, water, the
// mountain and unexplored terrain remain impassable. Only the first reachable
// obstruction is proposed. The next step is recomputed after real removal.
function clearingStep(w,c,to) {
  if (Math.hypot(c.x-to.x,c.y-to.y)>JOB_RADIUS) return null;
  const cell=.75, pad=5, ox=Math.floor((Math.min(c.x,to.x)-pad)/cell)*cell,
    oy=Math.floor((Math.min(c.y,to.y)-pad)/cell)*cell,
    width=Math.min(104,Math.ceil((Math.max(c.x,to.x)+pad-ox)/cell)+1),
    height=Math.min(104,Math.ceil((Math.max(c.y,to.y)+pad-oy)/cell)+1), count=width*height;
  const at=p=>Math.round((p.y-oy)/cell)*width+Math.round((p.x-ox)/cell), start=at(c), end=at(to);
  if (start<0 || end<0 || start>=count || end>=count) return null;
  const cost=new Uint8Array(count).fill(1), labels=new Map(),
    objects=nearbyObstacles(w,ox+width*cell/2,oy+height*cell/2,Math.hypot(width,height)*cell/2+4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const p={x:ox+x*cell,y:oy+y*cell};
    if (!walkableSurface(w,p.x,p.y) || !isExplored(w,p) || !inRegion(w,p)) cost[y*width+x]=255;
  }
  for(const o of objects) {
    const f=footprint(o); if(!f) continue;
    const removable=["tree","rock"].includes(o.type) && isExplored(w,o);
    const x0=Math.max(0,Math.floor((o.x-f[0]-BODY_RADIUS-ox)/cell)),x1=Math.min(width-1,Math.ceil((o.x+f[0]+BODY_RADIUS-ox)/cell)),
      y0=Math.max(0,Math.floor((o.y-f[1]-BODY_RADIUS-oy)/cell)),y1=Math.min(height-1,Math.ceil((o.y+f[1]+BODY_RADIUS-oy)/cell));
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) {
      const i=y*width+x;
      if (!hitsFootprint(ox+x*cell,oy+y*cell,BODY_RADIUS+.08,o)) continue;
      if (!removable) cost[i]=255;
      else if(cost[i]!==255) {cost[i]=24; if(!labels.has(i))labels.set(i,[]);labels.get(i).push(o);}
    }
  }
  if(cost[start]===255 || cost[end]===255) return null;
  const distances=new Float64Array(count).fill(Infinity), previous=new Int32Array(count).fill(-1), heap=[];
  const push=(i,d)=>{let k=heap.length;heap.push({i,d});while(k){const p=(k-1)>>1;if(heap[p].d<=d)break;heap[k]=heap[p];k=p;}heap[k]={i,d};};
  const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){let k=0;while(k*2+1<heap.length){let j=k*2+1;if(j+1<heap.length&&heap[j+1].d<heap[j].d)j++;if(heap[j].d>=last.d)break;heap[k]=heap[j];k=j;}heap[k]=last;}return top;};
  distances[start]=0;push(start,0);
  while(heap.length) {
    const {i,d}=pop(); if(d!==distances[i])continue;if(i===end)break;
    const x=i%width,y=Math.floor(i/width);
    for(const next of [x?i-1:-1,x<width-1?i+1:-1,y?i-width:-1,y<height-1?i+width:-1]) {
      if(next<0 || cost[next]===255)continue;
      const score=d+cost[next];if(score>=distances[next])continue;
      distances[next]=score;previous[next]=i;push(next,score);
    }
  }
  if(!Number.isFinite(distances[end]))return null;
  const path=[];for(let i=end;i!==start&&i>=0;i=previous[i])path.push(i);
  for(const i of path.reverse()) for(const o of labels.get(i)||[]) {
    if(serviceSlots(w,o,c).some(p=>Number.isFinite(routeCost(w,c,p))))return o;
  }
  return null;
}
export function reviewAccess(w) {
  if (!w.community.access.length || w.time<(w.runtime?.nextAccessReview||0)) return;
  w.runtime={...(w.runtime||{}),nextAccessReview:w.time+6};
  const r=[...w.community.access].sort((a,b)=>a.checked-b.checked)[0];
  r.checked=w.time;
  const target=r.target && objectAt(w,r.target);
  if ((r.target&&!target) || (r.project&&w.community.project?.id!==r.project) ||
      w.time-r.lastSeen>180 || !inRegion(w,r.point)) { removeRequest(w,r,false);return; }
  const requester=w.creatures.find(c=>c.id===r.unit);
  const workers=w.creatures.filter(c=>capable(w,c) && Math.hypot(c.x-r.point.x,c.y-r.point.y)<=JOB_RADIUS &&
      (!requester || c===requester || Math.hypot(c.x-requester.x,c.y-requester.y)<12))
    .sort((a,b)=>Math.hypot(a.x-r.point.x,a.y-r.point.y)-Math.hypot(b.x-r.point.x,b.y-r.point.y)).slice(0,4);
  const points=target ? serviceSlots(w,target,workers[0]||r.point) : [r.point];
  if(workers.some(c=>points.some(p=>Number.isFinite(routeCost(w,c,p))))) {removeRequest(w,r,true);return;}
  if(!workers.length) {r.status="help";askForHelp(w,r,"We need rested workers nearby and care on this side of the river.");return;}
  const current=r.blocker&&objectAt(w,r.blocker);
  if(r.status==="clearing" && clearanceEnabled(w) && current && ["tree","rock"].includes(current.type) &&
      r.crew.some(id=>w.creatures.some(c=>c.id===id && capable(w,c) &&
        serviceSlots(w,current,c).some(p=>Number.isFinite(routeCost(w,c,p)))))) {r.lastSeen=w.time;return;}
  r.crew=[];r.blocker=null;
  const p=points[0] || (target ? accessPoint(target,workers[0]) : r.point);
  const blocker=clearingStep(w,workers[0],p);
  if(blocker) {
    r.blocker=blocker.id;r.status="ready";
    r.reason=`Clear a ${blocker.type} at ${Math.round(blocker.x)}, ${Math.round(blocker.y)} to reach the ${r.label}.`;
    if(!clearanceEnabled(w)) askForHelp(w,r,"Trees or rocks block our route. Allow independence and enable intelligence in Options so we can clear a path, or use the axe or hammer to help us.");
    else askForHelp(w,r,"Trees or rocks block our route. We are asking the colony to choose a clearing crew so we can continue.");
  } else {
    r.status="help";
    askForHelp(w,r,!w.progress.bridge && workers[0].x<42 && r.point.x>42
      ? "We need the river bridge completed before we can reach the other bank."
      : "We cannot find a safe clearing route. Please open space around the destination with the axe or hammer, or move a building blocking its entrance.");
  }
}
export function clearanceChoices(w) {
  if(!clearanceEnabled(w))return [];
  return w.community.access.filter(r=>r.status==="ready" && r.blocker)
    .sort((a,b)=>accessPriority(b)-accessPriority(a) || a.created-b.created).slice(0,2).map(r=>({
    id:"clearance",key:`clearance_${r.id}`,request:r.id,blocker:r.blocker,x:r.point.x,y:r.point.y,
    priority:accessPriority(r),subgoal:`access:${r.id}`,description:`${r.reason} This unblocks ${accessPurpose(w,r)}.`,
    task:r.task,project:r.project,obstacle:objectAt(w,r.blocker)?.type,resume:accessPurpose(w,r)}));
}
export function startClearance(w,choice,source) {
  if(!clearanceEnabled(w))return false;
  const r=w.community.access.find(r=>r.id===choice.request && r.blocker===choice.blocker && r.status==="ready"),
    o=r && objectAt(w,r.blocker);
  if(!o || !["tree","rock"].includes(o.type) || !inRegion(w,o))return false;
  const c=w.creatures.filter(c=>capable(w,c) && !working(c) &&
      (!w.community.project?.crew.includes(c.id) || r.project===w.community.project?.id))
    .filter(c=>!w.community.access.some(a=>a!==r && a.status==="clearing" && a.crew.includes(c.id)))
    .sort(workOrder).find(c=>serviceSlots(w,o,c).some(p=>Number.isFinite(routeCost(w,c,p))));
  if(!c)return false;
  const saved=materializeObject(w,o);if(!saved)return false;
  r.blocker=saved.id;r.status="clearing";r.crew=[c.id];r.source=source;r.lastSeen=w.time;
  recordWork(w,c);
  w.commandRevision++;w.revision++;
  activity(w,"clearance",`${c.name} will open the path to the ${r.label}.`,source,r.reason);
  remember(w,"clearance",`${source} assigned ${c.name} to ${r.reason.toLowerCase()}`,c.id);
  return true;
}
export function clearanceTask(w,c) {
  if(!clearanceEnabled(w) || !capable(w,c))return null;
  const r=w.community.access.find(r=>r.status==="clearing" && r.crew.includes(c.id)),o=r&&objectAt(w,r.blocker);
  return o && inRegion(w,o) && ["tree","rock"].includes(o.type) ?
    {target:o.id,task:o.type==="tree"?"gather":"quarry"} : null;
}
const accessPriority = r => ["eat","wash","play","home"].includes(r.task) ? 110 : r.project ? 100 : 90;
export function accessPurpose(w,r) {
  const task=({gather:"gather timber",quarry:"collect ore",mine:"mine ore",work:"make blocks",haul:"deliver materials",
    eat:"get food",wash:"wash",play:"play",home:"rest",construct:"build",explore:"explore"})[r.task] || TASK_NAMES[r.task]?.toLowerCase() || "continue work";
  const p=w.community.project?.id===r.project ? w.community.project : null;
  return p ? `${task} for ${BUILDINGS[p.type]?.name || ({timber:"the wood reserve",quarry:"the ore reserve",refine:"the block reserve",crossing:"the river bridge"})[p.type] || "our project"}` : task;
}
export function accessBrief(w) {
  const requests=[...w.community.access].sort((a,b)=>accessPriority(b)-accessPriority(a) || a.created-b.created);
  const r=requests.find(r=>r.status==="ready") || requests[0];
  if(!r)return "";
  const o=r.blocker && objectAt(w,r.blocker);
  return `Blocked ${r.task}${r.project && w.community.project?.id===r.project ? ` for ${w.community.project.type}` : ""}: ${r.status}. ${o ? `${r.status==="clearing" ? "Crew clearing" : "Clear"} ${o.type}; then resume ${r.task}.` : "Needs a safe route or rested crew; do not repeat the blocked journey."}`;
}
export const accessContext = w => [...w.community.access].sort((a,b)=>accessPriority(b)-accessPriority(a) || a.created-b.created).slice(0,ACCESS_LIMIT).map(r=>{
  const o=r.blocker && objectAt(w,r.blocker);
  return {id:r.id,target:r.label,at:[Math.round(r.point.x),Math.round(r.point.y)],status:r.status,
    task:r.task,project:r.project,purpose:accessPurpose(w,r),reason:r.reason,blocker:r.blocker,crew:r.crew.length,
    prerequisite:o ? {action:o.type==="tree"?"gather":"quarry",object:o.id,type:o.type,at:[Math.round(o.x),Math.round(o.y)]} : null,
    nextStep:r.status==="clearing" ? "Finish the assigned clearing step, then check the route again." : r.status==="ready" ?
      (clearanceEnabled(w) ? "Choose the matching clearance option. Keep the parent project; replan its route after removal." : "Ask for independence, intelligence or work permission before assigning clearance.") : r.reason,
    resume:{task:r.task,target:r.target,project:r.project}};
});
