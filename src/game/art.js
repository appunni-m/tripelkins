// Small deterministic material flecks are generated only when a texture is cached.
function finishTexture(canvas, seed) {
  const ctx=canvas.getContext('2d'),image=ctx.getImageData(0,0,canvas.width,canvas.height),d=image.data;
  for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;const n=((Math.imul(i/4+seed,1103515245)>>>16)%9)-4;
    const grey=d[i]*.30+d[i+1]*.59+d[i+2]*.11;
    for(let channel=0;channel<3;channel++)d[i+channel]=Math.min(255,d[i+channel]*.82+grey*.18+n);
  }
  ctx.putImageData(image,0,0);
}
// Procedural pixel artwork and terrain textures.
const palette = {
  outline: "#493f31",
  gold: "#f4d15f",
  goldDark: "#dca741",
  cream: "#fff0ad",
  blue: "#77b2bc",
  leaf: "#5f914b",
  leafLight: "#82aa5b",
  leafDark: "#426e3d",
};
const cache = new Map();
export function sprite(type, variant = 0, frame = "idle", direction = 2) {
  const key = `${type}:${variant}:${frame}:${direction}`;
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 80;
  const c = canvas.getContext("2d");
  c.imageSmoothingEnabled = false;
  const rect = (x, y, w, h, color) => {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  };
  const poly = (points, color) => {
    c.fillStyle = color;
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
  };
  const ellipse = (x, y, rx, ry, color) => {
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
  };
  const outline = palette.outline;
  if (type !== "creature" && type !== "expression")
    ellipse(32, 73, type === "shadow" ? 13 : 22, 4, "#253d2b44");
  if (type === "shadow") {
    // Kept on the ground while the creature hops above it.
  } else if (type === "expression") {
    if (frame === "notes") {
      rect(21, 24, 3, 14, "#fff2b1");
      rect(24, 24, 7, 3, "#fff2b1");
      ellipse(18, 38, 5, 3, "#fff2b1");
      rect(43, 14, 3, 13, "#e4eed2");
      rect(46, 14, 6, 3, "#e4eed2");
      ellipse(40, 27, 5, 3, "#e4eed2");
    } else if (frame === "bubbles") {
      for (const [x, y, r] of [
        [18, 48, 6],
        [43, 31, 7],
        [24, 19, 4],
      ]) {
        ellipse(x, y, r, r, "#83c6d5c0");
        ellipse(x - 1, y - 2, r * 0.65, r * 0.55, "#ecf6e7dc");
      }
    } else if (["sparkles", "crumbs", "dust"].includes(frame)) {
      const color =
        frame === "sparkles"
          ? "#fff1aa"
          : frame === "crumbs"
            ? "#db9b56"
            : "#d3c19a";
      for (const [x, y] of [
        [17, 29],
        [44, 21],
        [26, 44],
      ]) {
        rect(x, y, 4, 4, color);
        if (frame === "sparkles") {
          rect(x - 3, y + 1, 10, 2, color);
          rect(x + 1, y - 3, 2, 10, color);
        }
      }
    } else {
      ellipse(32, 31, 14, 13, "#f1e6bbdd");
      if (frame === "hunger") {
        ellipse(32, 33, 7, 6, "#b86047");
        rect(32, 22, 2, 6, outline);
        rect(35, 23, 5, 3, palette.leaf);
      } else if (frame === "dirty") {
        poly(
          [
            [32, 21],
            [25, 34],
            [26, 39],
            [38, 39],
            [39, 34],
          ],
          "#6e9dad",
        );
      } else {
        poly(
          [
            [23, 29],
            [27, 25],
            [32, 28],
            [37, 25],
            [41, 29],
            [32, 39],
          ],
          "#bd7d75",
        );
      }
    }
  } else if (type === "pollution") {
    for (const [x, y, rx, ry] of [
      [18, 61, 15, 7],
      [35, 65, 25, 8],
      [43, 57, 16, 8],
      [25, 52, 17, 6],
    ])
      ellipse(x, y, rx, ry, "#79548699");
    rect(23, 58, 6, 2, "#b18cbb99");
  } else if (type === "creature") {
    // Soft toy proportions with folded ears, round paws and a stitched tummy.
    // All existing direction, work, care and hop frames retain their timing.
    const back=[5,6,7].includes(direction),side=[0,4].includes(direction),left=direction>=3&&direction<=5;
    const dx=side?(left?-5:5):[1,3,5,7].includes(direction)?(left?-2:2):0;
    const step=/walk|play/.test(frame)?(frame.endsWith("0")?-2:2):0;
    const raised=/sing|play|wash|work0|replicate/.test(frame);
    const fur=variant===1?"#ad9cbf":"#b79bdd",shade="#8d78b4",light="#d8c3ee",paw="#f4c5c9";
    ellipse(32,55,18,17,shade);
    ellipse(22-step,69,9,6,shade);ellipse(42+step,69,9,6,shade);
    ellipse(22-step,68,8,5,paw);ellipse(42+step,68,8,5,paw);
    ellipse(16+dx*.3,24,10,13,shade);ellipse(48+dx*.3,24,10,13,shade);
    ellipse(17+dx*.3,24,7,10,paw);ellipse(47+dx*.3,24,7,10,paw);
    ellipse(32,42,21,23,shade);ellipse(32,41,19,22,fur);
    ellipse(27,30,10,6,light);ellipse(32,58,13,11,back?fur:"#f6e2d5");
    ellipse(raised?12:15,raised?43:56,6,8,fur);ellipse(raised?52:49,raised?43:56,6,8,fur);
    if(!back){
      ellipse(32+dx,46,14,12,"#fff0e3");
      const eyes=side?[32+dx]:[24+dx,39+dx];
      for(const x of eyes){if(frame==='blink'||frame==='wash'){rect(x-3,40,6,2,"#493e59");}else{ellipse(x,39,3.5,5,"#493e59");ellipse(x-1,37,1.2,1.6,"#ffffff");}}
      ellipse(21+dx,47,3.5,2,"#e9a7b8");ellipse(43+dx,47,3.5,2,"#e9a7b8");
      ellipse(32+dx,46,2.8,2,"#9a687f");rect(31+dx,48,2,3,"#9a687f");
      if(/sing|need|eat0/.test(frame))ellipse(32+dx,53,3,4,"#83576f");else{rect(28+dx,52,3,1,"#946577");rect(33+dx,52,3,1,"#946577");}
      rect(31,58,1,7,"#d0a6b6");for(const y of [59,62,65])rect(29,y,5,1,"#d0a6b6");
    }else {ellipse(32,58,7,6,light);for(const y of [33,37,41])rect(30,y,4,1,shade);}
    if(frame.startsWith('eat')){poly([[24+dx,55],[27+dx,62],[34+dx,64],[42+dx,56],[38+dx,66],[29+dx,69],[23+dx,64]],"#cdbd78");}
    if(frame.startsWith('work')){rect(left?10:51,frame==='work0'?35:48,3,18,"#a2836c");rect(left?7:47,frame==='work0'?32:45,10,6,"#84a8b7");}
    if(frame==='replicate')for(const x of [8,54]){rect(x,29,2,9,"#fff3bd");rect(x-3,32,8,2,"#fff3bd");}
  } else if (type === "tree") {
    // Timber oak: an exposed forked trunk, spreading roots and an uneven crown.
    // All variants share the same ground footprint for harvesting/navigation.
    const lean = (variant % 3 - 1) * 3;
    poly([[21,73],[28,62],[28,37],[33+lean,27],[38,39],[37,61],[45,72],[35,69],[29,72]],"#65513f");
    poly([[28,69],[31,57],[31,39],[34+lean,30],[35,47],[33,66]],"#947654");
    poly([[30,49],[17,37],[14,26],[20,29],[24,38],[33,42]],"#715b42");
    poly([[34,43],[42,34],[48,21],[49,32],[43,43],[35,50]],"#705a43");
    poly([[32,35],[28,25],[30,16],[34,23],[36,34]],"#7b674a");
    // Bark furrows follow the trunk rather than forming regular square tiles.
    for(const [x,y,h] of [[29,51,13],[34,46,15],[32,62,8],[37,59,7]])rect(x,y,1,h,"#594d3e");
    ellipse(35,56,2,3,"#65503f");ellipse(35,55,1,2,"#ac8a60");
    const crowns = [
      [14+lean,30,12,10],[48,27,12,11],[26,18,15,12],
      [41+lean,15,13,11],[17,18,11,10],[34,29,16,12],
    ];
    for(const [i,[x,y,rx,ry]] of crowns.entries()){
      ellipse(x,y+3,rx,ry,"#526852");
      ellipse(x-1,y,rx,ry,variant===1?"#788565":"#6a8060");
      ellipse(x-4,y-4,rx*.65,ry*.53,"#8a9973");
      // Small scallops read as clusters of leaves, with gaps between branches.
      for(let n=0;n<5;n++){
        const a=n*2.3+i,px=x+Math.cos(a)*rx*.77,py=y+Math.sin(a)*ry*.7;
        ellipse(px,py,3.5,3,n%2?"#73865f":"#617655");
      }
      for(const [dx,dy] of [[-5,-2],[2,-5],[6,2],[-2,4]]){
        c.strokeStyle="#99a17b";c.lineWidth=1;c.beginPath();
        c.moveTo(x+dx-1,y+dy+1);c.lineTo(x+dx+2,y+dy-1);c.stroke();
      }
    }
    poly([[20,73],[23,69],[25,73],[25,68],[29,73]],"#7f8e66");
  } else if (type === "orchard") {
    // Banana plants have layered leaf sheaths, arching paddle leaves, and a
    // hanging bunch; they do not share the timber tree's trunk or canopy.
    poly([[25,72],[28,30],[35,26],[39,71]],"#727b50");
    poly([[29,70],[31,31],[35,30],[35,71]],"#a5a174");
    poly([[25,72],[24,64],[29,56],[28,71]],"#897b5b");
    const leaves = [
      [[32,30],[24,17],[10,17],[2,26],[15,24],[27,30]],
      [[31,28],[28,12],[36,3],[39,15],[35,28]],
      [[34,29],[45,13],[56,15],[62,26],[51,23],[39,29]],
      [[30,31],[16,28],[5,36],[3,48],[13,40],[28,35]],
      [[35,31],[50,29],[61,40],[60,50],[49,39],[37,35]],
    ];
    leaves.forEach((points,i)=>{
      poly(points,i%2?"#718762":"#627957");
      const tip=points[3];c.strokeStyle="#98a078";c.lineWidth=1;
      c.beginPath();c.moveTo(33,30);c.lineTo(tip[0],tip[1]-2);c.stroke();
    });
    // A second shoot growing from the same root mat.
    rect(17,55,4,17,"#849267");
    poly([[19,58],[10,49],[5,51],[8,58],[18,61]],"#748b65");
    poly([[19,58],[23,46],[28,44],[27,52],[21,60]],"#889b72");
    c.strokeStyle="#7c8258";c.lineWidth=3;c.beginPath();c.moveTo(35,30);c.quadraticCurveTo(47,29,46,42);c.stroke();
    for(let row=0;row<3;row++)for(let n=0;n<3;n++){
      const x=40+n*4+row%2,y=39+row*6;
      poly([[x,y],[x+1,y+5],[x+4,y+6],[x+6,y+2],[x+4,y+3],[x+3,y]],row===0?"#a5aa68":"#c1b36c");
    }
    poly([[45,57],[42,60],[46,65],[49,60]],"#917483");
  } else if (type === "rock" || type === "node" || type === "ore") {
    poly(
      [
        [12, 65],
        [10, 52],
        [20, 42],
        [39, 40],
        [51, 51],
        [49, 65],
        [36, 72],
        [20, 70],
      ],
      "#5f6662",
    );
    poly(
      [
        [13, 52],
        [22, 44],
        [39, 43],
        [45, 53],
        [32, 61],
        [21, 59],
      ],
      "#969b89",
    );
    poly(
      [
        [32, 61],
        [45, 53],
        [48, 64],
        [35, 70],
      ],
      "#757d71",
    );
    rect(19, 50, 8, 3, "#aeb19c");
    if (type !== "rock") {
      rect(25, 51, 5, 9, "#92d6d6");
      rect(23, 54, 9, 3, "#ccf3dd");
      rect(40, 61, 4, 4, "#88ced1");
    }
  } else if(type==='bath'){
    // Open rain shower on a tiled base; collision and the service slot are unchanged.
    poly([[7,60],[35,45],[58,58],[30,74]],"#afcad8");
    poly([[10,60],[35,48],[54,58],[30,71]],"#dfedf0");
    rect(44,22,4,35,"#7998ad");rect(28,20,19,4,"#a8c9d4");
    ellipse(29,25,10,4,"#738da2");ellipse(29,23,10,3,"#bfdce3");
    for(let n=0;n<5;n++){rect(20+n*4,31+n%2*5,2,6,"#88cbe2");rect(21+n*4,43+n%3*3,2,5,"#a2d7e8");}
    rect(42,47,7,3,"#e3b88f");ellipse(19,62,6,2,"#aacddc");
  } else if(type==='roundabout'){
    // A soft bounce garden with spring pads instead of a rotating platform.
    ellipse(32,60,27,12,"#77a893");ellipse(32,57,26,11,"#c4dfb4");
    for(const [x,y]of [[17,53],[35,47],[46,59],[28,64]]){rect(x-2,y,4,6,"#7d859b");ellipse(x,y,9,4,"#d497b5");ellipse(x,y-2,9,4,"#edb7cf");rect(x-3,y-4,4,1,"#ffe6ef");}
  } else if(type==='cricketball'){
    ellipse(32,59,12,12,"#874d63");ellipse(31,57,10,10,"#bd607a");ellipse(27,53,3,2,"#e995a5");
    c.strokeStyle="#fff0d4";c.lineWidth=1.2;c.beginPath();c.arc(24,59,12,-1.18,1.1);c.stroke();c.beginPath();c.arc(27,59,12,-1.18,1.1);c.stroke();
    for(let y=49;y<68;y+=3)rect(33+Math.round(Math.sin((y-49)/19*Math.PI)*4),y,3,1,"#f3dbc8");
  } else if(type==='banana'){
    poly([[14,47],[20,53],[29,57],[38,56],[48,48],[44,61],[35,68],[25,68],[17,61]],"#c99e53");
    poly([[16,48],[22,55],[30,60],[39,59],[46,52],[41,62],[33,66],[25,65],[19,59]],"#cdbd78");
    poly([[18,52],[24,59],[32,62],[40,59],[35,64],[26,62]],"#ded1a0");rect(13,45,4,4,"#80704f");rect(46,46,4,4,"#80704f");
  } else if(type==='stone'){
    for(const [x,y]of [[13,60],[29,57],[22,45]]){poly([[x,y],[x+14,y-4],[x+21,y+1],[x+21,y+9],[x+7,y+13],[x,y+8]],"#889aaf");poly([[x+1,y],[x+14,y-3],[x+20,y+1],[x+7,y+5]],"#bccbd7");rect(x+4,y+1,5,1,"#e2e7ea");}
  } else if(type==='lander'){
    // A small, friendly landing pod with a mint canopy and three stubby feet.
    for(const x of [14,44]){rect(x,59,6,11,"#8a8bad");ellipse(x+3,70,7,3,"#657c91");}
    ellipse(32,48,28,15,"#9f82ba");ellipse(32,44,27,13,"#d2b5e5");
    ellipse(32,40,19,15,"#829cbf");ellipse(32,38,17,14,"#b5e3db");
    ellipse(26,32,7,5,"#e5fcf1");
    poly([[5,45],[14,41],[18,46],[46,46],[51,41],[59,45],[53,56],[13,56]],"#ecc7dc");
    for(const x of [16,27,38,49])ellipse(x,51,2.5,2,"#fff0a4");
    rect(29,18,4,8,"#a893bc");ellipse(31,18,4,3,"#f4b4c8");
    rect(26,57,12,8,"#839eb2");rect(23,65,18,4,"#adcbd1");
  } else if (
    type === "log" ||
    type === "bone" ||
    type === "stump" ||
    type === "corpse"
  ) {
    if (type === "bone") {
      poly(
        [
          [11, 54],
          [17, 51],
          [21, 56],
          [42, 61],
          [48, 57],
          [54, 62],
          [51, 68],
          [44, 67],
          [22, 62],
          [16, 65],
          [10, 61],
        ],
        "#eee7bc",
      );
    } else if (type === "corpse") {
      rect(19, 63, 29, 8, "#bca151");
      rect(28, 65, 14, 6, "#7aa1a3");
      rect(23, 62, 3, 3, outline);
    } else {
      poly(
        [
          [12, 57],
          [43, 48],
          [54, 54],
          [50, 66],
          [20, 73],
          [12, 67],
        ],
        "#765236",
      );
      poly(
        [
          [15, 58],
          [44, 51],
          [49, 54],
          [21, 63],
        ],
        "#ac7c48",
      );
      ellipse(18, 65, 6, 7, "#ceb16e");
      rect(17, 61, 2, 7, "#987640");
    }
  } else if (type === "sculpture") {
    poly(
      [
        [10, 67],
        [32, 54],
        [54, 66],
        [32, 78],
      ],
      "#707d81",
    );
    poly(
      [
        [24, 25],
        [37, 19],
        [42, 55],
        [29, 63],
      ],
      "#b7b69f",
    );
    poly(
      [
        [37, 19],
        [45, 25],
        [48, 58],
        [42, 55],
      ],
      "#7b8990",
    );
    rect(28, 31, 8, 3, "#ecbc69");
    rect(31, 39, 3, 11, "#ecbc69");
  } else if(type==='monolith'){
    ellipse(32,68,19,6,"#8d9fae");rect(26,32,12,33,"#b9b3c9");
    poly([[16,34],[32,20],[48,34],[43,52],[21,52]],"#879db9");
    poly([[21,35],[32,26],[43,35],[39,47],[25,47]],"#a1dfd5");
    ellipse(32,37,6,8,"#e4fff0");poly([[13,27],[32,15],[51,27],[48,31],[32,22],[16,31]],"#c492b6");
  } else if (type === "mountain") {
    poly(
      [
        [0, 71],
        [7, 41],
        [20, 35],
        [30, 10],
        [42, 26],
        [48, 20],
        [62, 52],
        [64, 73],
      ],
      "#596c63",
    );
    poly(
      [
        [8, 48],
        [20, 39],
        [30, 13],
        [33, 41],
        [25, 61],
      ],
      "#98a397",
    );
    poly(
      [
        [35, 44],
        [48, 25],
        [57, 48],
        [49, 58],
      ],
      "#7c8c80",
    );
    poly(
      [
        [22, 70],
        [32, 55],
        [43, 58],
        [50, 72],
      ],
      "#4a605b",
    );
  } else if (type === "flowers") {
    for (let i = 0; i < 5; i++) {
      const x = 13 + i * 8,
        y = 64 - (i % 2) * 6;
      rect(x, y, 2, 8, "#527e46");
      rect(x - 3, y - 3, 7, 4, i % 2 ? "#eadfa5" : "#e1a5a2");
      rect(x - 1, y - 4, 3, 7, i % 2 ? "#eadfa5" : "#e1a5a2");
      rect(x, y - 2, 2, 2, "#d6b96e");
    }
  } else if (type === "bridge") {
    for (let i = 0; i < 8; i++) {
      rect(2 + i * 8, 48, 7, 20, "#8f7048");
      rect(2 + i * 8, 49, 7, 3, "#c5a779");
    }
    rect(0, 45, 64, 3, "#6d593e");
    rect(0, 68, 64, 3, "#6d593e");
  } else if (["dwelling", "theatre", "factory", "mine"].includes(type)) {
    poly(
      [
        [7, 41],
        [35, 29],
        [59, 40],
        [59, 65],
        [31, 77],
        [7, 65],
      ],
      "#675842",
    );
    poly(
      [
        [9, 42],
        [33, 51],
        [33, 73],
        [9, 63],
      ],
      type === "dwelling" ? "#e5d9b5" : "#c2b68a",
    );
    poly(
      [
        [35, 51],
        [57, 42],
        [57, 64],
        [35, 74],
      ],
      "#9e9872",
    );
    if (type === "mine") {
      poly(
        [
          [6, 44],
          [28, 22],
          [38, 25],
          [58, 40],
          [33, 54],
        ],
        "#777e73",
      );
      poly(
        [
          [13, 58],
          [21, 51],
          [29, 55],
          [29, 69],
          [13, 65],
        ],
        "#394d48",
      );
      rect(13, 51, 3, 15, "#9c8357");
      rect(14, 50, 16, 4, "#a38e68");
      rect(34, 65, 18, 3, "#777464");
    } else {
      poly(
        [
          [3, 41],
          [31, 18],
          [40, 20],
          [63, 39],
          [34, 53],
        ],
        type === "dwelling"
          ? "#9c594c"
          : type === "theatre"
            ? "#ae6958"
            : "#657773",
      );
      poly(
        [
          [7, 40],
          [31, 22],
          [36, 24],
          [33, 48],
        ],
        type === "dwelling" ? "#d08266" : "#be9062",
      );
      rect(17, 51, 8, 10, "#526e72");
      rect(40, 53, 8, 10, "#405b5a");
      rect(25, 60, 7, 12, "#645543");
    }
    if (type === "factory") {
      rect(43, 10, 8, 28, "#8b7663");
      rect(42, 8, 10, 4, "#baa383");
      rect(45, 2, 10, 3, "#b8bba799");
      rect(50, 0, 9, 3, "#c3c5b777");
    }
    if (type === "theatre") {
      rect(22, 43, 23, 4, "#e3cd80");
      rect(25, 51, 7, 16, "#9f554c");
      rect(37, 49, 6, 15, "#9f554c");
    }
  } else if (type === "tnt") {
    rect(16, 47, 32, 22, "#ac5448");
    rect(18, 49, 28, 5, "#d27b5e");
    rect(27, 51, 12, 15, "#e4d89e");
    rect(30, 44, 3, 5, outline);
  } else if (type === "cannon") {
    rect(19, 62, 30, 9, "#596e68");
    poly(
      [
        [25, 57],
        [43, 32],
        [54, 37],
        [36, 63],
      ],
      "#657e7d",
    );
    poly(
      [
        [42, 31],
        [48, 27],
        [58, 32],
        [55, 39],
      ],
      "#3b504f",
    );
    rect(20, 58, 7, 8, "#c2b879");
  } else if (type === "hole") {
    ellipse(32, 50, 28, 22, "#96cbb599");
    ellipse(32, 50, 22, 18, "#668fa7");
    ellipse(32, 50, 15, 14, "#293c51");
    ellipse(32, 50, 8, 10, "#141d32");
  } else {
    // Pixel tool icons share the game palette.
    if(type==='cloth'){
      poly([[10,44],[44,35],[53,58],[19,70]],"#718cae");
      poly([[13,44],[43,38],[49,57],[21,66]],"#aac7e2");
      poly([[13,44],[27,45],[32,60],[21,66]],"#d3e4ef");
      for(let i=0;i<4;i++){rect(25+i*5,43+i,2,15,"#88abc7");rect(21+i*5,59+i,2,3,"#eef4f4");}
    } else if (type === "hand") {
      poly(
        [
          [23, 63],
          [14, 48],
          [18, 45],
          [26, 51],
          [24, 31],
          [29, 29],
          [32, 46],
          [33, 28],
          [38, 29],
          [38, 46],
          [43, 33],
          [47, 35],
          [44, 53],
          [49, 45],
          [53, 48],
          [47, 64],
          [40, 70],
          [28, 69],
        ],
        "#efd7a4",
      );
    } else if (type === "meteor") {
      poly([[49,15],[48,38],[38,55],[16,65],[18,43],[31,30]], "#bf7049");
      poly([[43,27],[39,45],[25,57],[22,46]], "#f0c66c");
      poly([[20,45],[35,44],[43,55],[35,68],[20,69],[13,57]], outline);
      poly([[21,47],[33,47],[39,55],[33,65],[22,64],[17,57]], "#8b8170");
      rect(21,51,7,4,"#c5bca2");
      rect(30,58,6,4,"#635a4f");
    } else if (type === "impact") {
      ellipse(32,65,28,9,"#71574088");
      for (let i=0;i<6;i++) {
        const a=i*Math.PI/3;
        rect(30+Math.cos(a)*22,56+Math.sin(a)*12,5,5,"#c69b68");
      }
      ellipse(32,62,15,6,"#ce995a");
      ellipse(32,60,9,4,"#f0d899");
    } else if (type === "bug") {
      ellipse(32, 53, 11, 14, "#ba6453");
      rect(30, 41, 4, 25, outline);
      for (const y of [45, 54, 62]) {
        rect(16, y, 8, 3, outline);
        rect(42, y, 8, 3, outline);
      }
      rect(26, 45, 4, 4, outline);
      rect(36, 55, 4, 4, outline);
    } else {
      poly(
        [
          [17, 70],
          [12, 67],
          [40, 33],
          [45, 36],
        ],
        "#ac8051",
      );
      poly(
        [
          [29, 31],
          [37, 22],
          [51, 31],
          [52, 42],
          [44, 48],
          [34, 40],
        ],
        "#7c9190",
      );
      rect(36, 25, 12, 5, "#b1c5b9");
    }
  }
  if (variant >= 3 && ["factory", "mine", "dwelling"].includes(type)) {
    rect(9, 61, 5, 3, "#83bbce");
    rect(46, 61, 7, 3, "#83bbce");
    rect(29, 25, 12, 3, "#eee5b9");
    if (type === "factory") {
      rect(12, 14, 7, 27, "#837a6e");
      rect(11, 12, 9, 4, "#c1b597");
    }
  }
  if (
    frame === "occupied" &&
    ["factory", "mine", "dwelling", "theatre"].includes(type)
  ) {
    rect(18, 54, 5, 6, "#ffdd73");
    rect(41, 56, 5, 5, "#ffdd73");
  }
  finishTexture(canvas, type.length * 73 + variant);
  cache.set(key, canvas);
  return canvas;
}
const icons = new Map();
export function iconUrl(type) {
  if (!icons.has(type)) icons.set(type, sprite(type).toDataURL());
  return icons.get(type);
}
export function terrain() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 576;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#91b986";
  ctx.fillRect(0, 0, c.width, c.height);
  let seed = 1489;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 15000; i++) {
    const x = rnd() * 1024,
      y = rnd() * 576;
    ctx.fillStyle = ["#9bc48c", "#89ad7b", "#b0cd99", "#7fa878"][i % 4];
    ctx.fillRect(
      Math.floor(x / 2) * 2,
      Math.floor(y / 2) * 2,
      2 + (i % 3) * 2,
      2,
    );
  }
  ctx.fillStyle = "#d4c4a1";
  ctx.fillRect(624, 0, 112, 576);
  ctx.fillStyle = "#75b8cb";
  ctx.fillRect(640, 0, 80, 576);
  for (let y = 0; y < 576; y += 7)
    for (let x = 640; x < 718; x += 6) {
      ctx.fillStyle = rnd() > 0.6 ? "#b5dedc" : "#82c3d2";
      ctx.fillRect(x, y, 2 + Math.floor(rnd() * 5), 1);
    }
  for (let i = 0; i < 140; i++) {
    const x = 180 + rnd() * 420,
      y = 140 + rnd() * 320;
    ctx.fillStyle = "#b8d89d";
    ctx.fillRect(x, y, 2, 3);
    ctx.fillRect(x - 2, y + 1, 6, 1);
  }
  finishTexture(c, 537);
  return c;
}

// Dedicated bridge layers use the exact logical deck polygon, not a scaled icon.
export function bridgeArt(geometry, project, front = false, phase = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 160;
  const c = canvas.getContext("2d");
  c.imageSmoothingEnabled = false;
  const { a, b, width } = geometry,
    dx = b.x - a.x,
    dy = b.y - a.y,
    len = Math.hypot(dx, dy),
    nx = -dy / len,
    ny = dx / len;
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const point = (t, side, h = 0) => {
    const p = project(
      a.x + dx * t + ((nx * width) / 2) * side - center.x,
      a.y + dy * t + ((ny * width) / 2) * side - center.y,
    );
    return [128 + p.x * 2, 100 - p.y * 2 - h];
  };
  const poly = (points, fill) => {
    c.fillStyle = fill;
    c.beginPath();
    points.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
    c.closePath();
    c.fill();
  };
  const count = Math.max(1, Math.ceil(len * 2));
  if (!front) {
    for (let i = 0; i < Math.ceil(count * phase); i++)
      poly(
        [
          point(i / count, -1),
          point((i + 0.85) / count, -1),
          point((i + 0.85) / count, 1),
          point(i / count, 1),
        ],
        i % 2 ? "#b88a52" : "#d2a469",
      );
    if (phase < 1)
      for (const t of [0, 1])
        poly(
          [point(t, -1), point(t, 1), point(t, 1, -8), point(t, -1, -8)],
          "#68503b",
        );
  }
  const side = front ? 1 : -1;
  for (let i = 0; i <= Math.ceil(count * phase); i += 2) {
    const [x, y] = point(i / count, side);
    c.fillStyle = "#67503a";
    c.fillRect(Math.round(x) - 2, Math.round(y) - 15, 4, 18);
  }
  if (phase > 0)
    poly(
      [
        point(0, side, 12),
        point(phase, side, 12),
        point(phase, side, 8),
        point(0, side, 8),
      ],
      "#98794d",
    );
  finishTexture(canvas, 871);
  return canvas;
}
