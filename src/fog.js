import * as THREE from "three";
import { CHUNK_SIZE } from "./game/map.js";
import { isExplored } from "./game/discovery.js";

// One tiny filtered texture per visible terrain chunk, disposed with that chunk.
// The surrounding pixel keeps neighboring edges continuous when zooming.
export function fogMesh(geometry) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CHUNK_SIZE + 2;
  const map = new THREE.CanvasTexture(canvas);
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.generateMipmaps = false;
  map.colorSpace = THREE.SRGBColorSpace;
  map.offset.set(1/canvas.width,1/canvas.height);
  map.repeat.set(CHUNK_SIZE/canvas.width,CHUNK_SIZE/canvas.height);
  const mesh = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({
    map,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,
  }));
  mesh.renderOrder = 90010;
  return mesh;
}
export function updateFog(mesh,w,cx,cy) {
  mesh.visible = w.stage < 3;
  if (!mesh.visible || mesh.userData.revision === w.discovery.revision) return;
  const canvas = mesh.material.map.image, ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = "#26332f";
  for (let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++)
    if (!isExplored(w,{x:cx*CHUNK_SIZE+x-.5,y:cy*CHUNK_SIZE+y-.5})) ctx.fillRect(x,y,1,1);
  mesh.material.map.needsUpdate = true;
  mesh.userData.revision = w.discovery.revision;
}
