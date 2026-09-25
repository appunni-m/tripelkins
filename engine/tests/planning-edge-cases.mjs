// Source and target receive identical input worlds; no expected game output is stored.
export async function planningEdgeCases(m, check) {
  const copy = structuredClone;
  const colony = () => {
    const w = m['scale-fixture'].groundFixture(25);
    w.time = 20;
    return w;
  };
  const observe = async (w, operation, input, fn, name) =>
    check(w, operation, input, fn, `edge-${name}`);
  const goalWorld = colony();
  for (const spec of [{kind:'wood',target:300},{kind:'ore',target:200},{kind:'grow',target:100}]) {
    await observe(goalWorld,'goals.add',{spec,command:'Save resources together',source:'Laya'},
      w => m.goals.addGoal(w,spec,'Save resources together','Laya'),`goal-add-${spec.kind}`);
  }
  await observe(goalWorld,'goals.add',{spec:{kind:'wood',target:300},command:'Again',source:'Laya'},
    w => m.goals.addGoal(w,{kind:'wood',target:300},'Again','Laya'),'goal-duplicate');
  for (const [index,action] of [[0,'pause'],[2,'focus'],[2,'cancel'],[1,'pause'],[0,'focus']]) {
    const id=goalWorld.memory.goals[index].id;
    await observe(goalWorld,'goals.change',{id,action},w=>m.goals.changeGoal(w,id,action),`goal-${action}-${index}`);
  }
  goalWorld.inventory.wood=350;
  await observe(goalWorld,'goals.advance',{},w=>m.goals.advanceGoals(w),'goal-complete-and-promote');
  const savedGoals=Array.from({length:44},(_,i)=>({id:`old-${i}`,kind:i%2?'wood':'blocks',target:100,
    status:i<36?'completed':i===36?'active':'queued',command:'A saved request',source:'Jev',createdAt:i,
    completedAt:i<36?i+5:null,reviews:[{tick:i,policy:'balanced',reason:'Keep real materials ready',source:'Laya'}]}));
  await observe(colony(),'goals.normalize',{goals:savedGoals},()=>m.goals.normalizeGoals(savedGoals),'goal-history-and-reviews');
  const full=colony();
  for(let i=0;i<8;i++)m.goals.addGoal(full,{kind:'wood',target:100+i},'Store wood','Laya');
  await observe(full,'goals.add',{spec:{kind:'ore',target:300},command:'Store ore',source:'Jev'},
    w=>m.goals.addGoal(w,{kind:'ore',target:300},'Store ore','Jev'),'goal-queue-limit');

  for(const kind of ['care','grow','bridge','wood','ore','blocks']) {
    for(const mode of ['blocked-project','no-workers','urgent','held','unbridged','ending']) {
      const w=colony();
      const goal=m.goals.addGoal(w,{kind,target:300},'A colony objective','Laya');
      if(mode==='blocked-project')w.community.project={id:1,type:'refine',x:18,y:20,crew:[w.creatures[0].id],target:300,required:32,progress:0,blocked:'A tree blocks the entrance',source:'Laya'};
      if(mode==='no-workers'){w.creatures=[];w.population=0;}
      if(mode==='urgent')w.creatures[0].fed=15;
      if(mode==='held'){w.directives.pauseWork=true;w.directives.avoidPollution=true;w.runtime.intelligenceAvailable=false;}
      if(mode==='unbridged'){w.progress.bridge=false;w.stage=1;m.state.addObject(w,'bridge',40,24,{stock:12});}
      if(mode==='ending')w.stage=4;
      await observe(w,'goals.inspect',{goal},w=>m.goals.inspectGoal(w,goal),`goal-inspect-${kind}-${mode}`);
    }
  }
  const healthy=colony();healthy.memory.lastPlan={policy:'care',goalId:null};
  await observe(healthy,'goals.policy',{},w=>m.goals.goalPolicy(w),'care-policy-expires');

  // One request is deliberately enclosed; a second has no river crossing.
  for(const mode of ['tree-ring','river','unrested','stale-project']) {
    const w=m.state.createWorld({empty:true});w.progress.hatched=true;w.time=20;
    w.runtime={intelligenceAvailable:true,growth:{held:true}};w.community.consent='accepted';
    const c=m.state.addCreature(w,15,24);c.fed=c.clean=c.amused=95;
    if(mode==='tree-ring') {
      for(const [x,y] of [[14,22],[14,26]]) {const other=m.state.addCreature(w,x,y);other.fed=other.clean=other.amused=95;}
      w.community.project={id:1,type:'refine',x:15,y:24,crew:[c.id],target:300,required:32,progress:0,started:10,source:'Laya',blocked:'The mine entrance is closed'};
    }
    const target=m.state.addObject(w,'mine',mode==='river'?60:24,24,{stock:1000});
    if(mode!=='river')for(let i=0;i<24;i++){const a=i*Math.PI/12;m.state.addObject(w,'tree',24+Math.cos(a)*4,24+Math.sin(a)*4);}
    m.discovery.reveal(w,target,12);
    if(mode==='unrested')c.fed=10;
    const details={target:target.id,unit:c.id,task:'mine',point:m.geometry.serviceSlots(w,target,c)[0]||{x:target.x-3,y:target.y},project:mode==='stale-project'?99:mode==='tree-ring'?1:null};
    await observe(w,'access.request',details,w=>{m.access.requestAccess(w,details);return null;},`access-request-${mode}`);
    await observe(w,'access.review',{},w=>{m.access.reviewAccess(w);return null;},`access-review-${mode}`);
    if(mode==='tree-ring') {
      const food=m.state.addObject(w,'banana',24,25,{stock:3});
      const second={target:food.id,unit:w.creatures[1].id,task:'eat',point:m.geometry.serviceSlots(w,food,w.creatures[1])[0]};
      await observe(w,'access.request',second,w=>{m.access.requestAccess(w,second);return null;},'access-second-care-request');
    }
    await observe(copy(w),'access.brief',{},w=>m.access.accessBrief(w),`access-brief-${mode}`);
    await observe(copy(w),'access.context',{},w=>m.access.accessContext(w),`access-context-${mode}`);
    const choices=m.access.clearanceChoices(w);
    await observe(copy(w),'access.choices',{},w=>m.access.clearanceChoices(w),`clearance-choices-${mode}`);
    if(choices.length){
      const choice=choices[0];
      await observe(w,'access.start',{choice,source:'Laya'},w=>m.access.startClearance(w,choice,'Laya'),`clearance-start-${mode}`);
      await observe(copy(w),'settlement.currentChoice',{choice},w=>m.settlement.currentSettlementChoice(w,choice),`clearance-current-${mode}`);
      await observe(copy(w),'access.task',{creature:w.creatures[0]},w=>m.access.clearanceTask(w,w.creatures[0]),`clearance-task-${mode}`);
      w.time+=7;
      await observe(w,'access.review',{},w=>{m.access.reviewAccess(w);return null;},`clearing-review-${mode}`);
      await observe(copy(w),'planning.context',{includePlans:false},w=>m.context.buildContext(w,{includePlans:false}),`clearing-context-${mode}`);
    }
  }

  // Resource and construction crews exercise current-choice validation,
  // reservations, material accounting, completion and blocked-site recovery.
  for(const kind of ['timber','quarry','refine','crossing','orchard','bath','mine','factory']) {
    const w=colony();w.inventory={wood:400,ore:400,blocks:1000,bones:0,corpses:0};
    const c=w.creatures[0];
    const project={id:1,type:kind,x:c.x+6,y:c.y+2,crew:w.creatures.slice(0,4).map(c=>c.id),target:300,required:32,progress:33,blocked:'',started:10,source:'Laya'};
    w.community.project=project;w.community.nextProject=2;
    const ore=m.state.addObject(w,'ore',c.x+2,c.y,{stock:9});
    const workshop=m.state.addObject(w,'factory',c.x+5,c.y+8,{inputOre:0});
    c.carry=3;c.cargoKind='ore';c.target=workshop.id;
    for(const [op,fn] of [['settlement.localOre',()=>m.settlement.localOre(w,project)],['settlement.refiningShortage',()=>m.settlement.refiningShortage(w,project)],['settlement.refiningOreReserve',()=>m.settlement.refiningOreReserve(w)]]) {
      await observe(copy(w),op,{project},()=>fn(),`${op}-${kind}`);
    }
    for(const object of [ore,workshop]){
      const carrier={...c,carry:0,cargoKind:null};
      await observe(copy(w),'settlement.storedSupply',{creature:carrier,object},w=>m.settlement.storedSupply(w,carrier,object),`supply-${kind}-${object.type}`);
    }
    await observe(copy(w),'settlement.prepareTimber',{},w=>{m.settlement.prepareTimber(w);return null;},`prepare-${kind}`);
    await observe(copy(w),'settlement.finish',{},w=>m.settlement.finishSettlement(w,m.simulation.placeBuilding),`finish-${kind}`);
    const parallel=copy(w);parallel.community.projects=[{...project,id:2,type:'mine',x:c.x,y:c.y,crew:w.creatures.slice(4,8).map(c=>c.id)}];
    await observe(parallel,'settlement.finish',{},w=>m.settlement.finishSettlement(w,m.simulation.placeBuilding),`finish-parallel-${kind}`);
    await observe(copy(w),'settlement.projectTasks',{creature:c},w=>m.settlement.projectTasks(w,c),`project-tasks-${kind}`);
    const choices=m.settlement.settlementDecisionChoices(w);
    await observe(copy(w),'settlement.decisionInput',{choices},w=>m.settlement.settlementDecisionInput(w,choices),`settlement-input-${kind}`);
    await observe(copy(w),'settlement.context',{choices},w=>m.settlement.settlementContext(w,choices),`settlement-context-${kind}`);
    for(const choice of choices.slice(0,2))await observe(copy(w),'settlement.currentChoice',{choice},w=>m.settlement.currentSettlementChoice(w,choice),`current-choice-${kind}-${choice.id}`);
  }
  const context=colony();
  context.creatures[0].fed=12;context.ui.x=110;context.ui.y=80;
  context.memory.commands=[{id:'command-1',text:'Please store wood',status:'completed',reply:'We will gather a reserve',goalId:null}];
  m.goals.addGoal(context,{kind:'wood',target:300},'Please store wood','Laya');
  m.goals.addGoal(context,{kind:'grow',target:100},'Then grow steadily','Jev');
  await observe(context,'planning.context',{includePlans:false},w=>m.context.buildContext(w,{includePlans:false}),'commands-goal-context');

  // Revalidate every resource and care proposal, including multiple outposts and
  // a newer urgent care need discovered while a model was choosing a project.
  for(const mode of ['materials','food','wash','play']){
    const w=colony();w.community.project=null;w.community.projects=[];
    w.inventory={wood:0,ore:0,blocks:0,bones:0,corpses:0};
    if(mode!=='materials')for(const c of w.creatures)c[{food:'fed',wash:'clean',play:'amused'}[mode]]=20;
    const choices=m.settlement.settlementDecisionChoices(w);
    for(const choice of choices){
      const candidate={...choice,camps:[{x:w.creatures[0].x,y:w.creatures[0].y},{x:120,y:80}]};
      await observe(copy(w),'settlement.currentChoice',{choice:candidate},
        w=>m.settlement.currentSettlementChoice(w,candidate),`revalidate-${mode}-${choice.key}`);
    }
    for(const policy of ['care','balanced']){
      const plan=m.jobs.makePlan(w,policy);
      await observe(copy(w),'planning.judgePlan',{plan},w=>m.decisions.judgePlan(w,plan),`judge-${mode}-${policy}`);
      await observe(copy(w),'planning.planReward',{plan},w=>m.decisions.planReward(w,plan),`reward-${mode}-${policy}`);
      await observe(copy(w),'planning.selectPlan',{policy,source:'Laya',initial:[plan]},
        w=>m.decisions.selectPlan(w,policy,'Laya','',[plan]),`select-${mode}-${policy}`);
    }
  }
}
