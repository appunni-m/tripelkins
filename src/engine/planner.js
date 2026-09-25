export function rustPlanner(engine) {
  const query=(w,operation,input={})=>engine.query(operation,input,w===engine.world?{}:{snapshot:w});
  return {
    activity:(w,kind,text,source,detail)=>w===engine.world?engine.command('community.activity',{kind,text,source,detail}):Promise.resolve(null),
    buildContext:(w,{includePlans=true}={})=>query(w,'planning.buildContext',{includePlans}),
    makePlan:(w,policy)=>query(w,'planning.makePlan',{policy}),
    selectPlan:async(w,policy,source,model='',initial=null)=>{
      // Refresh after inference without holding up authoritative simulation.
      const revision=w.commandRevision;
      const plans=initial??await query(w,'planning.feasiblePlans');
      if(revision!==w.commandRevision)throw new Error('The colony changed while planning.');
      return query(w,'planning.selectPlan',{policy,source,model,initial:plans,expectedCommandRevision:revision});
    },
    settlementDecisionChoices:w=>query(w,'settlement.decisionChoices'),
    settlementDecisionInput:(w,choices)=>query(w,'settlement.decisionInput',{choices}),
    settlementContext:(w,choices)=>query(w,'settlement.context',{choices}),
    currentSettlementChoice:(w,choice)=>query(w,'settlement.currentChoice',{choice}),
    parseConstraints:(w,text,listener)=>query(w,'commands.parseConstraints',{text,listener}),
    commandInput:text=>engine.query('commands.input',{text}),
    commandOptions:text=>engine.query('commands.options',{text}),
    informationReply:(w,text,listener)=>query(w,'conversation.informationReply',{text,listener}),
    localReply:(w,intent,listener)=>query(w,'conversation.localReply',{intent,listener}),
    simpleIntent:text=>engine.query('conversation.simpleIntent',{text}),
    numberFromCommand:(text,kind)=>engine.query('goals.numberFromCommand',{text,kind}),
    packHostedContext:(context,budget)=>engine.query('planning.packContext',{context,budget}),
  };
}
