import * as THREE from "three";
import { METEOR_RADIUS } from "./game/destruction.js";

const FALL_MS = 650;
const LIFETIME_MS = 5500;
const LIMIT = 8;
const clamp = v => Math.max(0,Math.min(1,v));
const fraction = (n, salt) => {
  const x = Math.sin(n*127.1+salt*311.7)*43758.5453;
  return x-Math.floor(x);
};

// Small original textures shared by every strike. Effect materials are owned
// individually so overlapping meteors never change each other's opacity.
function texture(kind) {
  const canvas=document.createElement("canvas");
  canvas.width=canvas.height=96;
  const c=canvas.getContext("2d");
  const ellipse=(x,y,rx,ry,color)=>{
    c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();
  };
  const poly=(points,color)=>{
    c.fillStyle=color;c.beginPath();
    points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();
  };
  if(kind==="rock") {
    poly([[23,22],[53,14],[75,34],[78,62],[54,81],[24,72],[13,47]],"#443e37");
    poly([[25,25],[51,19],[70,35],[69,58],[51,71],[29,64],[20,46]],"#8e7360");
    poly([[25,25],[51,19],[61,35],[42,39],[21,47]],"#cbb28a");
    poly([[42,42],[67,36],[65,58],[50,69],[48,53]],"#66564a");
    c.strokeStyle="#f3b65e";c.lineWidth=4;c.beginPath();c.moveTo(23,50);c.lineTo(40,52);c.lineTo(48,68);c.stroke();
  } else if(kind==="flame") {
    poly([[47,1],[53,33],[67,21],[63,53],[77,64],[64,86],[36,93],[21,71],[35,43],[35,19],[43,34]],"#b8552cbb");
    poly([[47,23],[55,54],[66,64],[59,82],[37,87],[30,69],[42,48]],"#ed943d");
    poly([[46,48],[55,65],[54,79],[40,83],[36,69]],"#f9d17b");
  } else if(kind==="ring") {
    c.strokeStyle="#e5bd80";c.lineWidth=3;c.beginPath();c.ellipse(48,48,42,42,0,0,Math.PI*2);c.stroke();
  } else if(kind==="dust") {
    for(let i=0;i<6;i++) ellipse(29+fraction(i,1)*37,33+fraction(i,2)*32,16+fraction(i,3)*9,14+fraction(i,4)*8,["#bda885aa","#9b896e99","#c7b38e88"][i%3]);
  } else if(kind==="crater") {
    ellipse(48,48,42,37,"#38393155");
    poly([[10,43],[24,20],[43,11],[67,18],[85,42],[77,66],[57,80],[28,76],[13,62]],"#77664c99");
    ellipse(47,48,29,24,"#403e35b0");
    ellipse(48,46,21,17,"#2e322dcc");
    c.strokeStyle="#4e4538aa";c.lineWidth=3;
    for(let i=0;i<7;i++) {
      const a=i*Math.PI*2/7;c.beginPath();c.moveTo(48+Math.cos(a)*19,48+Math.sin(a)*19);
      c.lineTo(48+Math.cos(a+.1)*32,48+Math.sin(a+.1)*32);
      c.lineTo(48+Math.cos(a)*44,48+Math.sin(a)*44);c.stroke();
    }
  } else if(kind==="fragment") {
    poly([[25,22],[65,19],[78,56],[46,76],[18,55]],"#75614e");
    poly([[25,22],[65,19],[49,43],[18,55]],"#b19772");
  } else {
    const gradient=c.createRadialGradient(48,48,2,48,48,44);
    gradient.addColorStop(0,kind==="shadow"?"#1f251baa":"#ffe1aacc");
    gradient.addColorStop(.4,kind==="shadow"?"#1f251b66":"#eca45288");
    gradient.addColorStop(1,"#00000000");
    ellipse(48,48,44,44,gradient);
  }
  const map=new THREE.CanvasTexture(canvas);
  map.colorSpace=THREE.SRGBColorSpace;
  map.magFilter=map.minFilter=["glow","shadow","dust"].includes(kind)?THREE.LinearFilter:THREE.NearestFilter;
  map.generateMipmaps=false;
  return map;
}

export class MeteorEffects {
  constructor(scene) { this.scene=scene;this.effects=[];this.textures=new Map();this.nextId=1; }
  launch(point,time,height,onStrike) {
    if(this.effects.length>=LIMIT) {
      const spent=this.effects.find(e=>e.struck);
      if(!spent) return false;
      this.remove(spent);
    }
    const group=new THREE.Group(),nodes=[];
    const node=(kind,order)=>{
      if(!this.textures.has(kind))this.textures.set(kind,texture(kind));
      const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:this.textures.get(kind),transparent:true,depthTest:false,depthWrite:false}));
      sprite.renderOrder=order;group.add(sprite);nodes.push(sprite);return sprite;
    };
    const e={...point,id:this.nextId++,start:time,height:Math.max(180,Math.min(350,height)),onStrike,struck:false,group,nodes,
      shadow:node("shadow",4),marker:node("ring",90003),rock:node("rock",90023),flame:node("flame",90022),
      glow:node("glow",90021),ring:node("ring",90004),crater:node("crater",4),
      embers:Array.from({length:7},()=>node("glow",90021)),
      dust:Array.from({length:7},()=>node("dust",90005)),
      fragments:Array.from({length:7},()=>node("fragment",90006))};
    e.flame.center.set(.5,.07);
    this.scene.add(group);this.effects.push(e);
    return true;
  }
  advance(time,paused) {
    if(paused)return;
    for(const e of this.effects) if(!e.struck && time-e.start>=FALL_MS) {
      e.struck=true;
      const strike=e.onStrike;e.onStrike=null;strike?.();
    }
  }
  render(time,local,reducedMotion=false) {
    const diameter=METEOR_RADIUS*Math.SQRT2*24;
    const pose=(sprite,x,y,sx,sy,alpha,rotation=0)=>{
      sprite.visible=alpha>.005;
      if(!sprite.visible)return;
      sprite.position.set(x,y,0);sprite.scale.set(sx,sy,1);
      sprite.material.opacity=clamp(alpha);sprite.material.rotation=rotation;
    };
    for(const e of [...this.effects]) {
      const age=Math.max(0,time-e.start);
      if(age>LIFETIME_MS) { this.remove(e);continue; }
      const p=local(e);e.group.position.set(p.x,p.y,0);
      const t=clamp(age/FALL_MS),falling=!e.struck;
      const fall=q=>1-(.15*q+.85*q*q),remaining=fall(t);
      const x=e.height*.44*remaining,y=e.height*remaining;
      for(const n of e.nodes)n.visible=false;
      if(falling) {
        pose(e.marker,0,0,diameter,diameter/2,reducedMotion ? .3 : .2+.14*Math.sin(t*Math.PI));
        pose(e.shadow,0,0,18+36*t,9+18*t,.3+.4*t);
        if(!reducedMotion) {
          pose(e.flame,x,y,29+5*t,78+18*Math.sin(t*25)**2,.9,-.415);
          pose(e.rock,x,y,34,34,1,t*1.2);
          pose(e.glow,x,y,58,58,.4);
          for(let i=0;i<e.embers.length;i++) {
            const past=Math.max(0,t-(i+1)*.028),trail=fall(past);
            pose(e.embers[i],e.height*.44*trail+Math.sin(i*4+t*8)*3,e.height*trail,
              10-i,14-i,.55*(1-i/8)*clamp(t*6));
          }
        }
        continue;
      }
      const after=(age-FALL_MS)/1000;
      pose(e.crater,0,0,diameter,diameter/2,clamp((LIFETIME_MS-age)/1700)*.8);
      // Only a warm glow at the impact point; no screen-wide white flash.
      pose(e.glow,0,3,diameter*(.55+after),diameter*(.4+after*.5),clamp(1-after/.35)*.7);
      if(reducedMotion)continue;
      pose(e.ring,0,0,diameter*(.2+after*2),diameter*(.1+after),clamp(1-after/.55)*.55);
      for(let i=0;i<e.dust.length;i++) {
        const a=i*Math.PI*2/7,drift=11+after*(12+fraction(i,e.id)*13);
        const size=20+after*20;
        pose(e.dust[i],Math.cos(a)*drift,Math.sin(a)*drift*.45+after*10,size,size*.7,
          clamp(after*12)*clamp(1-after/(1.2+fraction(i,4)*.8))*.7);
        const v=22+fraction(i,e.id+2)*23;
        pose(e.fragments[i],Math.cos(a)*v*after,Math.sin(a)*v*.45*after+after*55-after*after*78,
          5+fraction(i,5)*5,5+fraction(i,5)*5,clamp(1-after/.85),a+after*(i%2?4:-4));
      }
    }
  }
  remove(e) {
    this.scene.remove(e.group);
    for(const node of e.nodes)node.material.dispose();
    e.onStrike=null;
    this.effects=this.effects.filter(item=>item!==e);
  }
  clear() { for(const e of [...this.effects])this.remove(e); }
  dispose() { this.clear();for(const map of this.textures.values())map.dispose();this.textures.clear(); }
}
