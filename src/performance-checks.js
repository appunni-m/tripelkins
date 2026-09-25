import { scaleFixture, groundFixture } from "./game/scale-fixture.js";
import { stepWorld } from "./game/simulation.js";
import { migrateWorld } from "./game/state.js";
import { buildContext } from "./game/context.js";
import { navigationMemory } from "./game/navigation.js";
import { WorldView } from "./world.js";
import { ColonyLife } from "./colony-life.js";
const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise(requestAnimationFrame);
const size = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
function assert(value, message) { if (!value) throw new Error(message); }
$("run").onclick = async () => {
  $("run").disabled = true;
  $("results").replaceChildren();
  let failures = 0;
  const workloads = [[300,groundFixture],[600,groundFixture],[48,scaleFixture],[1e6,scaleFixture],[1e9,scaleFixture]];
  for (const [population, fixture] of workloads) {
    $("status").textContent = `Measuring ${population.toLocaleString()} lives…`;
    await nextFrame();
    let view, life;
    const report = { population };
    try {
      const w = fixture(population), before = w.metrics.completed;
      life = new ColonyLife();
      view = new WorldView($("world"), () => w, () => {}, () => {}, life);
      let renderMs = 0, simulationMs = 0;
      const stepTimes = [], frameTimes = [];
      for (let i = 0; i < 120; i++) {
        await nextFrame();
        const frameAt = performance.now();
        let at = performance.now(); stepWorld(w, 0.1);
        const stepMs = performance.now() - at;
        simulationMs += stepMs; stepTimes.push(stepMs);
        life.update(w, w.time * 1000, { paused: false, listening: false, view });
        at = performance.now(); view.render(w.time * 1000);
        renderMs += performance.now() - at;
        frameTimes.push(performance.now()-frameAt);
      }
      w.ui.paused = true;
      life.update(w, w.time * 1000, { paused: true, listening: false, view });
      view.render(w.time * 1000, { paused: true });
      const draws = view.frameStats.drawn;
      for (let i = 0; i < 100; i++) view.render(w.time * 1000, { paused: true });
      assert(view.frameStats.drawn === draws, "Paused scene was redrawn");
      w.ui.x += 2;
      view.render(w.time * 1000, { paused: true });
      assert(view.frameStats.drawn === draws + 1, "Paused camera did not redraw");
      const contextStart = performance.now(), context = buildContext(w);
      report.contextMs = performance.now() - contextStart;
      report.contextBytes = size(context.context);
      report.saveBytes = size(migrateWorld(w));
      report.bodies = w.creatures.length;
      report.completed = w.metrics.completed - before;
      report.navigation = navigationMemory(w);
      report.meanRenderCpuMs = renderMs / 120;
      report.simulationCpuMs = simulationMs;
      stepTimes.sort((a,b)=>a-b); frameTimes.sort((a,b)=>a-b);
      report.p95SimulationMs = stepTimes[Math.floor(stepTimes.length*.95)];
      report.maxSimulationMs = stepTimes.at(-1);
      report.p95FrameCpuMs = frameTimes[Math.floor(frameTimes.length*.95)];
      report.pausedRedraws = 0;
      report.rendererTextures = view.renderer.info.memory.textures;
      report.rendererGeometries = view.renderer.info.memory.geometries;
      report.spriteMaterials = view.materials.size;
      report.jsHeapBytes = performance.memory?.usedJSHeapSize ?? "unavailable";
      assert(report.completed > 0, "Fixture did no useful work");
      assert(fixture===groundFixture ? report.bodies===population : report.bodies<=192,
        "Fixture no longer has the requested individual-body count");
      assert(report.navigation.bytes < 5e6, "Navigation exceeded its typed-array budget");
      assert(report.saveBytes < 2e6, "Save grew beyond the fixture budget");
      report.status = "pass";
    } catch (error) { report.status = "fail"; report.error = error.message; failures++; }
    finally { life?.dispose(); view?.dispose(); $("world").replaceChildren(); }
    const row = document.createElement("article"), pre = document.createElement("pre");
    pre.textContent = JSON.stringify(report, null, 2); row.append(pre); $("results").append(row);
  }
  $("status").textContent = `Finished: ${workloads.length - failures} passed, ${failures} failed. JS heap excludes GPU memory; timings include browser overhead and are device-specific.`;
  $("run").disabled = false;
};
