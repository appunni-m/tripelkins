import {EngineClient} from './engine/client.js';
import {groundFixture} from './game/scale-fixture.js';
import {WorldView} from './world.js';
import {ColonyLife} from './colony-life.js';
const $=id=>document.getElementById(id),frame=()=>new Promise(requestAnimationFrame),delay=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(value,message)=>{if(!value)throw new Error(message);};
const percentile=(values,p)=>values.toSorted((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]||0;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
$('run').onclick=async()=>{
  $('run').disabled=true;$('results').replaceChildren();let failures=0;
  for(const population of [25,300,600]){
    $('status').textContent=`Running ${population} walking residents in the Rust worker…`;
    let engine,view,life;const report={population};
    try{
      const input=groundFixture(population);input.ui.muted=true;
      const updateGaps=[];let measuring=false,lastUpdate=0,lastTick=-Infinity;
      engine=new EngineClient({onState:state=>{
        if(measuring && state.time>lastTick){const now=performance.now();if(lastUpdate)updateGaps.push(now-lastUpdate);lastUpdate=now;lastTick=state.time;}
      }});const w=await engine.initialize({world:input,preview:true});
      assert((await engine.query('identity')).protocol===1,'Worker protocol version');
      life=new ColonyLife();view=new WorldView($('world'),()=>w,()=>{},()=>{},life);
      const before=w.metrics.completed, initial=w.time;
      engine.updatePresentation({paused:false,ui:w.ui,settings:w.settings,intelligenceAvailable:true,growth:{held:true}});
      const renderTimes=[],frameTimes=[],gaps=[],longTasks=[],contextTimes=[];
      let observer;try{observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask'});}catch{}
      let last=performance.now(),lastDraw=last,contextAt=last,contextBusy=false,contextError=null;const started=last;measuring=true;
      while(w.time-initial<12){
        await frame();const now=performance.now();gaps.push(now-last);last=now;
        assert(now-started<90000,'Worker could not advance twelve seconds before the deadline');
        if(now-lastDraw>=1000/30-1){
          const at=performance.now();life.update(w,(now-started),{paused:false,listening:false,view});
          const renderAt=performance.now();view.render(now-started);renderTimes.push(performance.now()-renderAt);frameTimes.push(performance.now()-at);lastDraw=now;
        }
        if(!contextBusy&&now-contextAt>3000){contextBusy=true;contextAt=now;
          engine.query('planning.buildContext',{includePlans:true}).then(c=>{contextTimes.push(performance.now()-now);report.contextBytes=bytes(c.context);}).catch(e=>{contextError=e;}).finally(()=>{contextBusy=false;});
        }
      }
      measuring=false;const measuredUntil=performance.now();const navigation=await engine.query('navigation.memory');
      w.ui.paused=true;engine.updatePresentation({paused:true,ui:w.ui,settings:w.settings});
      await engine.command('presentation',{ui:w.ui});
      const pausedAt=(await engine.query('snapshot')).time;await delay(350);
      assert((await engine.query('snapshot')).time===pausedAt,'Paused worker advanced simulation');
      while(contextBusy)await delay(20);if(contextError)throw contextError;
      life.update(w,12000,{paused:true,listening:false,view});view.render(12000,{paused:true});const draws=view.frameStats.drawn;
      for(let i=0;i<100;i++)view.render(12000,{paused:true});assert(view.frameStats.drawn===draws,'Paused renderer redrew');
      w.ui.x+=2;view.render(12000,{paused:true});assert(view.frameStats.drawn===draws+1,'Paused camera did not redraw');
      const saved=await engine.storage('export');const prior=w;const opened=await engine.replace(saved);
      assert(opened!==prior,'Restoring did not invalidate the old world identity');
      assert(opened.creatures.length===population,'Restore changed resident count');
      assert(opened.metrics.completed===saved.metrics.completed,'Restore lost completed work');
      assert(opened.ui.paused,'Restored world did not open paused');
      const restoredAt=opened.time;await delay(250);assert((await engine.query('snapshot')).time===restoredAt,'Restore resumed unexpectedly');
      observer?.disconnect();
      const measuredLongTasks=longTasks.filter(e=>e.start>=started&&e.start<measuredUntil).map(e=>e.duration);
      Object.assign(report,{status:'pass',simulatedSeconds:pausedAt-initial,simulationWallMs:measuredUntil-started,elapsedMs:performance.now()-started,
        bodies:saved.creatures.length,completed:saved.metrics.completed-before,saveBytes:bytes(saved),
        meanRenderCpuMs:renderTimes.reduce((a,b)=>a+b,0)/renderTimes.length,p95FrameCpuMs:percentile(frameTimes,.95),
        p95FrameGapMs:percentile(gaps,.95),maxFrameGapMs:Math.max(...gaps),longTasks:measuredLongTasks.length,maxLongTaskMs:Math.max(0,...measuredLongTasks),
        p95SimulationUpdateGapMs:percentile(updateGaps,.95),maxSimulationUpdateGapMs:Math.max(0,...updateGaps),
        simulationUpdatesOver150ms:updateGaps.filter(ms=>ms>150).length,
        contextRoundTripMs:contextTimes,workerMeanStepMs:w.runtime?.workerMs,navigation});
      assert(report.completed>0,'Residents completed no useful work');
      assert(report.bodies===population,'Wrong actual resident count');
      assert(report.saveBytes<2e6,'Save grew beyond fixture budget');
    }catch(error){report.status='fail';report.error=error.message;failures++;}
    finally{engine?.dispose();life?.dispose();view?.dispose();$('world').replaceChildren();}
    const article=document.createElement('article'),pre=document.createElement('pre');pre.textContent=JSON.stringify(report,null,2);article.append(pre);$('results').append(article);
  }
  $('status').textContent=`Finished: ${3-failures} passed, ${failures} failed. Frame gaps include browser scheduling; worker time is separate from rendering.`;$('run').disabled=false;
};
