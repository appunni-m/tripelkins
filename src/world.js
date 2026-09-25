import { fogMesh, updateFog } from "./fog.js";
import { workProjects } from "./game/work-projects.js";
import { RenderGpuTimer } from "./growth-budget.js";
import { MeteorEffects } from "./meteor-effects.js";
import { isExplored } from "./game/discovery.js";
import * as THREE from "three";
import { sprite, terrain, bridgeArt } from "./game/art.js";
import { clamp } from "./game/state.js";
import { bindWorldInput, cameraViewport, cameraPoint, panCamera, zoomCamera } from "./camera-controls.js";
import { isConstruction } from "./game/development.js";
import { METEOR_RADIUS } from "./game/destruction.js";
import { buildingPreview } from "./building-preview.js";
import {
  CHUNK_SIZE,
  naturalObjects,
  nearbyObjects,
  terrainChunk,
} from "./game/map.js";
import {
  ASSETS,
  project,
  bridgeGeometry,
  canPlace,
} from "./game/geometry.js";
export class WorldView {
  constructor(container, getWorld, onTap, onDrag, life) {
    Object.assign(this, {
      container,
      getWorld,
      onTap,
      onDrag,
      life,
      origin: { x: 0, y: 0 },
      meshes: new Map(),
      materials: new Map(),
      chunks: new Map(),
      natural: [],
      frameStats: { drawn: 0, skipped: 0 },
    });
    this.clearingCanvas = terrain();
    this.scene = new THREE.Scene();
    this.meteors = new MeteorEffects(this.scene);
    this.scene.background = new THREE.Color("#202a24");
    this.camera = new THREE.OrthographicCamera(-400, 400, 240, -240, 0.1, 2000);
    this.camera.position.z = 1000;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(1);
    this.gpuTimer = new RenderGpuTimer(this.renderer.getContext());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(6, 7, 24),
      new THREE.MeshBasicMaterial({
        color: "#fff1a0",
        depthTest: false,
        transparent: true,
      }),
    );
    this.ring.scale.y = 0.5;
    this.ring.renderOrder = 90000;
    this.scene.add(this.ring);
    this.ghost = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: "#e8eeb0",
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    this.ghost.renderOrder = 90001;
    this.ghost.geometry.setAttribute(
      "position", new THREE.BufferAttribute(new Float32Array(32 * 3), 3),
    );
    this.scene.add(this.ghost);
    this.ghost.visible = false;
    const corners = [
      [0, 0],
      [CHUNK_SIZE, 0],
      [0, CHUNK_SIZE],
      [CHUNK_SIZE, CHUNK_SIZE],
    ].map(([x, y]) => project(x - CHUNK_SIZE / 2, y - CHUNK_SIZE / 2));
    this.chunkGeometry = new THREE.BufferGeometry();
    this.chunkGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        corners.flatMap((p) => [p.x, p.y, 0]),
        3,
      ),
    );
    this.chunkGeometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2),
    );
    this.chunkGeometry.setIndex([0, 1, 2, 2, 1, 3]);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = "none";
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.contextLost = true;
      getWorld().ui.paused = true;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
      this.gpuTimer = new RenderGpuTimer(this.renderer.getContext());
      this.render(this.time || 0);
    });
    this.disposeInput = bindWorldInput(canvas, {
      point: (e) => this.point(e),
      hit: (p) => this.hit(p),
      pan: (dx, dy) => this.pan(dx, dy),
      zoom: (factor, anchor) => this.zoom(factor, anchor),
      canDrag: (entity) => {
        const w = getWorld();
        return (w.stage === 3 && entity?.id?.startsWith("c")) ||
          (w.ui.tool === "inspect" && entity?.type === "rock");
      },
      hover: (p) => {
        this.ghostPoint = p;
        this.hover = this.hit(p);
        canvas.title = this.hover?.name || "";
      },
      drag: (entity, p) => { this.dragging = entity; this.dragPoint = p; },
      tap: onTap,
      drop: onDrag,
    });
  }
  resize() {
    const width = this.container.clientWidth,
      height = this.container.clientHeight;
    if (!width || !height || (width === this.width && height === this.height))
      return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height);
    this.render(this.time || 0);
  }
  local(p) {
    return project(p.x - this.origin.x, p.y - this.origin.y);
  }
  viewport() {
    return cameraViewport(this.width, this.height, this.getWorld().ui.zoom);
  }
  pan(dx, dy) {
    panCamera(this.getWorld().ui, this.viewport(), dx, dy);
  }
  zoom(factor, anchor) {
    const r = this.renderer.domElement.getBoundingClientRect();
    zoomCamera(this.getWorld().ui, this.width, this.height, factor,
      anchor ? anchor.x - r.left : this.width / 2,
      anchor ? anchor.y - r.top : this.height / 2);
  }
  point(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return cameraPoint(this.getWorld().ui, this.viewport(),
      e.clientX - r.left, e.clientY - r.top);
  }
  hit(p) {
    const w = this.getWorld(),
      screen = project(p.x, p.y);
    return (
      [...nearbyObjects(w, p.x, p.y, 15), ...w.creatures]
        .filter((o) => {
          if (!isExplored(w,o)) return false;
          const pos = project(o.x, o.y),
            [width, height] = ASSETS[o.type || "creature"]?.size || [44, 55];
          if (o.type === "bridge") {
            const g = bridgeGeometry(o);
            return (
              p.x >= Math.min(g.a.x, g.b.x) &&
              p.x <= Math.max(g.a.x, g.b.x) &&
              Math.abs(p.y - o.y) < g.width / 2
            );
          }
          return (
            Math.abs(pos.x - screen.x) < width * 0.35 &&
            screen.y - pos.y > -height * 0.1 &&
            screen.y - pos.y < height * 0.85
          );
        })
        .sort((a, b) => b.x + b.y - (a.x + a.y))[0] || null
    );
  }
  material(type, variant = 0, frame = "idle", direction = 2) {
    const key = `${type}:${variant}:${frame}:${direction}`;
    if (this.materials.has(key)) return this.materials.get(key);
    const m = this.fromCanvas(sprite(type, variant, frame, direction));
    this.materials.set(key, m);
    return m;
  }
  fromCanvas(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    });
  }
  draw(id, material, p, size, present, order, center = [0.5, 0.09], lift = 0) {
    present.add(id);
    let mesh = this.meshes.get(id);
    if (!mesh) {
      mesh = new THREE.Sprite(material);
      this.scene.add(mesh);
      this.meshes.set(id, mesh);
    }
    mesh.material = material;
    material.userData.lastDraw = this.frameStats.drawn;
    mesh.scale.set(size[0], size[1], 1);
    mesh.center.set(...center);
    const q = this.local(p);
    mesh.position.set(Math.round(q.x), Math.round(q.y + lift), 0);
    mesh.renderOrder = order;
    return mesh;
  }
  audibility(c) {
    const w = this.getWorld(),
      p = project(c.x - w.ui.x, c.y - w.ui.y),
      x = p.x / Math.max(1, this.viewWidth / 2),
      y = p.y / Math.max(1, this.viewHeight / 2),
      edge = Math.max(Math.abs(x), Math.abs(y));
    return {
      pan: clamp(x, -0.85, 0.85),
      volume: edge > 1.1 ? 0 : Math.max(0.2, 1 - edge * 0.65),
    };
  }
  render(time, { paused = false } = {}) {
    if (this.disposed || this.contextLost || !this.width || !this.height)
      return;
    this.time = time;
    const w = this.getWorld();
    const signature = [time, w.time, w.revision, w.navRevision, w.map.revision,
      w.discovery.revision, w.stage, w.ui.x, w.ui.y, w.ui.zoom, w.ui.tool, w.ui.selected,
      this.width, this.height, this.ghostPoint?.x, this.ghostPoint?.y,
      this.dragging?.id, this.dragPoint?.x, this.dragPoint?.y,
      this.life?.quiet].join(":");
    if (paused && this.renderWorld === w && this.renderSignature === signature) {
      this.frameStats.skipped++;
      return false;
    }
    if (this.renderWorld && this.renderWorld !== w) {
      this.meteors.clear();
      for (const mesh of this.meshes.values()) this.scene.remove(mesh);
      this.meshes.clear();
      for (const m of this.materials.values()) { m.map.dispose(); m.dispose(); }
      this.materials.clear();
    }
    this.renderWorld = w;
    this.renderSignature = signature;
    if(w.stage>=3)this.meteors.clear();
    this.meteors.advance(time,paused);
    this.frameStats.drawn++;
    const { viewHeight, viewWidth, pixelScale } = this.viewport();
    Object.assign(this, { viewHeight, viewWidth, pixelScale });
    Object.assign(this.camera, {
      left: -this.viewWidth / 2,
      right: this.viewWidth / 2,
      top: this.viewHeight / 2,
      bottom: -this.viewHeight / 2,
    });
    this.origin = {
      x: Math.floor(w.ui.x / CHUNK_SIZE) * CHUNK_SIZE,
      y: Math.floor(w.ui.y / CHUNK_SIZE) * CHUNK_SIZE,
    };
    const cam = this.local(w.ui);
    this.camera.position.x = cam.x;
    this.camera.position.y = cam.y;
    this.camera.updateProjectionMatrix();
    const extent = this.viewWidth / 24 + this.viewHeight / 12,
      bounds = {
        minX: w.ui.x - extent / 2 - 8,
        maxX: w.ui.x + extent / 2 + 8,
        minY: w.ui.y - extent / 2 - 8,
        maxY: w.ui.y + extent / 2 + 8,
      };
    this.streamTerrain(w, bounds);
    const visible = (o) => {
      const p = project(o.x - w.ui.x, o.y - w.ui.y);
      return (
        Math.abs(p.x) < this.viewWidth / 2 + 120 &&
        Math.abs(p.y) < this.viewHeight / 2 + 180
      );
    };
    const present = new Set(),
      occupied = new Set(
        w.creatures
          .filter((c) => c.job?.state === "working")
          .map((c) => c.target),
      );
    let selected;
    for (const o of [
      ...w.objects,
      ...(w.stage < 3 ? this.natural : []),
      ...w.creatures,
    ]) {
      if (!visible(o) || (!o.id.startsWith("c") && !isExplored(w,o))) continue;
      const creature = o.id.startsWith("c"),
        type = creature ? "creature" : o.type,
        p = this.dragging?.id === o.id ? this.dragPoint : o;
      const order =
        10000 + Math.round((o.x - this.origin.x + o.y - this.origin.y) * 100);
      if (type === "bridge") {
        const g = bridgeGeometry(o),
          phase = Math.floor(Math.min(1, o.stock / g.required) * 8) / 8;
        for (const front of [false, true]) {
          const key = `bridge:${g.b.x - g.a.x}:${g.b.y - g.a.y}:${g.width}:${phase}:${front}`;
          let material = this.materials.get(key);
          if (!material) {
            material = this.fromCanvas(bridgeArt(g, project, front, phase));
            this.materials.set(key, material);
          }
          this.draw(
            `${o.id}:${front}`,
            material,
            o,
            [128, 80],
            present,
            front ? order + Math.round(g.width * 100) : 2,
            [0.5, 0.375],
          );
        }
        continue;
      }
      const pose = creature ? this.life?.pose(o, time) : null;
      const velocity = project(
          Math.cos(o.heading || 0),
          Math.sin(o.heading || 0),
        ),
        direction =
          (Math.round(Math.atan2(-velocity.y, velocity.x) / (Math.PI / 4)) +
            8) %
          8;
      let frame = pose?.frame || "idle";
      if (creature && o.carry > 0) frame = "carry";
      if (creature && o.growth > 46) frame = "replicate";
      const variant = creature
          ? o.sickness > 25 || o.clean < 40
            ? 1
            : 0
          : o.level > 1
            ? 3
            : o.variant || 0,
        size = ASSETS[type]?.size || [45, 56];
      const material = this.material(
        type,
        variant,
        creature ? frame : occupied.has(o.id) ? "occupied" : "idle",
        creature ? direction : 2,
      );
      this.draw(
        o.id,
        material,
        p,
        [size[0] * (pose?.sx || 1), size[1] * (pose?.sy || 1)],
        present,
        order,
        [0.5, 0.09],
        pose?.lift || 0,
      );
      if (creature) {
        this.draw(
          `shadow:${o.id}`,
          this.material("shadow"),
          o,
          [19, 25],
          present,
          3,
        );
        if (pose?.effect)
          this.draw(
            `expression:${o.id}`,
            this.material("expression", 0, pose.effect),
            o,
            [24, 30],
            present,
            order + 4,
            [0.5, 0.09],
            23 + (pose.effectLift || 0),
          );
        if (o.carry > 0)
          this.draw(
            `carry:${o.id}`,
            this.material(
              o.cargoKind === "bones"
                ? "bone"
                : o.cargoKind === "ore"
                  ? "ore"
                  : "log",
            ),
            o,
            [17, 20],
            present,
            order + 5,
            [0.5, 0.09],
            9,
          );
      }
      if (o.id === w.ui.selected) selected = o;
    }
    this.meteors.render(time,p=>this.local(p),this.life?.reducedMotion.matches);
    for (const building of workProjects(w)) if (isConstruction(building) && visible(building)) {
      const key = `construction:${building.type}`;
      if (!this.materials.has(key)) {
        const material = this.material(building.type).clone();
        material.transparent = true;
        material.opacity = 0.45;
        this.materials.set(key,material);
      }
      this.draw(`colony-construction:${building.id}`,this.materials.get(key),building,
        ASSETS[building.type].size,present,
        10000+Math.round((building.x-this.origin.x+building.y-this.origin.y)*100),[0.5,0.09]);
    }
    for (const cannon of w.objects.filter(
      (o) => o.type === "cannon" && o.phase > 0 && w.time - o.phase < 1.7,
    )) {
      const t = w.time - cannon.phase;
      this.draw(
        `launch:${cannon.id}`,
        this.material("creature", 0, "replicate", 6),
        cannon,
        [19, 25],
        present,
        9000,
        [0.5, 0.09],
        24 + t * 90,
      );
    }
    for (const zone of w.pollution)
      if (zone.amount > 0 && visible(zone)) {
        const m = this.draw(
          `pollution:${zone.source}`,
          this.material("pollution"),
          zone,
          [zone.radius * 25, zone.radius * 16],
          present,
          1,
          [0.5, 0.35],
        );
        m.material.opacity = Math.min(0.8, 0.25 + zone.amount / 200);
      }
    for (const [id, mesh] of this.meshes)
      if (!present.has(id)) {
        this.scene.remove(mesh);
        this.meshes.delete(id);
      }
    this.ring.visible = !!selected;
    if (selected) {
      const q = this.local(selected);
      this.ring.position.set(q.x, q.y, 0);
    }
    const type = w.ui.tool.startsWith("build:")
      ? w.ui.tool.slice(6)
      : this.dragging?.type || (w.ui.tool === "grabber" ? w.ui.held?.type : null);
    const area = w.ui.tool === "meteor" ? METEOR_RADIUS : ["swarm", "chainsaw", "pickaxe", "mop"].includes(w.ui.tool)
      ? 3
      : ["hammer", "bug"].includes(w.ui.tool)
        ? 0.6
        : 0;
    this.ghost.visible = !!this.ghostPoint && isExplored(w,this.dragPoint || this.ghostPoint) && !!(type || area);
    if (this.ghost.visible) {
      const rawPoint = this.dragPoint || this.ghostPoint,
        placement = !area && w.ui.tool.startsWith("build:")
          ? buildingPreview(w, type, rawPoint)
          : null,
        p = placement?.point || rawPoint,
        f = ASSETS[type]?.footprint || [0.6, 0.6],
        outline = area
          ? Array.from({ length: 32 }, (_, i) => [
              Math.cos((i * Math.PI) / 16) * area,
              Math.sin((i * Math.PI) / 16) * area,
            ])
          : [
              [-f[0], -f[1]],
              [f[0], -f[1]],
              [f[0], f[1]],
              [-f[0], f[1]],
            ],
        verts = outline.flatMap(([x, y]) => {
          const q = this.local({ x: p.x + x, y: p.y + y });
          return [q.x, q.y, 0];
        });
      const position = this.ghost.geometry.getAttribute("position");
      position.array.set(verts);
      position.needsUpdate = true;
      this.ghost.geometry.setDrawRange(0, verts.length / 3);
      this.ghost.geometry.computeBoundingSphere();
      this.ghost.material.color.set(
        area
          ? w.ui.tool === "mop"
            ? "#a9d7eb"
            : "#e69a74"
          : (placement ? placement.valid : canPlace(w, type, p, this.dragging?.id))
            ? "#d6ef9c"
            : "#d36d54",
      );
    }
    // Imported bridge shapes and rarely used poses must not accumulate forever.
    if (this.materials.size > 256) {
      for (const [key, material] of this.materials) {
        if (this.materials.size <= 256) break;
        if (material.userData.lastDraw === this.frameStats.drawn) continue;
        material.map.dispose(); material.dispose(); this.materials.delete(key);
      }
    }
    if (!paused) this.gpuTimer.begin();
    try { this.renderer.render(this.scene, this.camera); }
    finally { if (!paused) this.gpuTimer.end(); }
    return true;
  }
  streamTerrain(w, bounds) {
    if (this.mapWorld !== w || this.mapStage !== w.stage) {
      for (const c of this.chunks.values()) this.dropChunk(c);
      this.chunks.clear();
      this.mapWorld = w;
      this.mapStage = w.stage;
      this.chunkSignature = "";
    }
    const minX = Math.floor(bounds.minX / CHUNK_SIZE),
      maxX = Math.floor(bounds.maxX / CHUNK_SIZE),
      minY = Math.floor(bounds.minY / CHUNK_SIZE),
      maxY = Math.floor(bounds.maxY / CHUNK_SIZE),
      wanted = new Set();
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const key = `${x}:${y}`;
        wanted.add(key);
        let chunk = this.chunks.get(key);
        if (!chunk) {
          const canvas = terrainChunk(w, x, y, this.clearingCanvas);
          if (w.stage >= 3) {
            const c = canvas.getContext("2d");
            c.fillStyle = "#363c3dcc";
            c.fillRect(0, 0, canvas.width, canvas.height);
          }
          const texture = new THREE.CanvasTexture(canvas);
          texture.magFilter = texture.minFilter = THREE.NearestFilter;
          texture.generateMipmaps = false;
          texture.colorSpace = THREE.SRGBColorSpace;
          chunk = new THREE.Mesh(
            this.chunkGeometry,
            new THREE.MeshBasicMaterial({
              map: texture,
              side: THREE.DoubleSide,
              depthTest: false,
            }),
          );
          chunk.renderOrder = -10;
          this.chunks.set(key, chunk);
          this.scene.add(chunk);
          chunk.userData.fog = fogMesh(this.chunkGeometry);
          this.scene.add(chunk.userData.fog);
        }
        const p = this.local({
          x: (x + 0.5) * CHUNK_SIZE,
          y: (y + 0.5) * CHUNK_SIZE,
        });
        chunk.position.set(p.x, p.y, -10);
        chunk.userData.fog.position.set(p.x,p.y,0);
        updateFog(chunk.userData.fog,w,x,y);
      }
    for (const [key, c] of this.chunks)
      if (!wanted.has(key)) {
        this.dropChunk(c);
        this.chunks.delete(key);
      }
    const signature = `${minX}:${maxX}:${minY}:${maxY}:${w.map.revision}`;
    if (signature !== this.chunkSignature) {
      this.natural = naturalObjects(
        w,
        minX * CHUNK_SIZE,
        minY * CHUNK_SIZE,
        (maxX + 1) * CHUNK_SIZE - 1,
        (maxY + 1) * CHUNK_SIZE - 1,
      );
      this.chunkSignature = signature;
    }
  }
  dropChunk(chunk) {
    const fog = chunk.userData.fog;
    if (fog) { this.scene.remove(fog); fog.material.map.dispose(); fog.material.dispose(); }
    this.scene.remove(chunk);
    chunk.material.map.dispose();
    chunk.material.dispose();
  }
  focus(x = 24, y = 24) {
    Object.assign(this.getWorld().ui, { x, y });
  }
  launchMeteor(point,time,onStrike) {
    return this.meteors.launch(point,time,this.viewHeight*.75,onStrike);
  }
  dispose() {
    this.disposed = true;
    this.gpuTimer.clear();
    this.resizeObserver.disconnect();
    this.disposeInput();
    this.meteors.dispose();
    for (const m of this.materials.values()) {
      m.map.dispose();
      m.dispose();
    }
    for (const c of this.chunks.values()) this.dropChunk(c);
    this.chunkGeometry.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.ghost.geometry.dispose();
    this.ghost.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
