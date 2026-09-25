// Accept earlier world exports after item and construction-material renaming.
// This does not replay events, alter amounts, or touch another browser database.
const keys = {gems:'blocks',peakGems:'peakBlocks',apple:'banana',sponge:'cloth',ball:'cricketball',egg:'lander'};
const values = {gems:'blocks',apple:'banana',sponge:'cloth',ball:'cricketball',egg:'lander'};
export function themeCompatibleWorld(raw) {
  if(!raw||typeof raw!=='object')return raw;
  const text=JSON.stringify(raw);
  if(!/"(?:gems|peakGems|apple|sponge|ball|egg)"/.test(text))return raw;
  if(text.length>8*1024*1024)throw new Error('The saved world exceeds the import budget.');
  // Depth guard also rejects malformed nested imports before traversing them.
  const visit=(value,depth=0,field='')=>{
    if(depth>50)throw new Error('The saved world contains excessively nested data.');
    if(Array.isArray(value))return value.map(item=>visit(item,depth+1,field));
    if(value&&typeof value==='object'){
      const next={};
      for(const [key,item]of Object.entries(value)){
        if(['__proto__','constructor','prototype'].includes(key))continue;
        const renamed=keys[key]||key;
        if(renamed!==key&&Object.hasOwn(value,renamed))continue;
        next[renamed]=visit(item,depth+1,key);
      }
      return next;
    }
    // Free-form names, conversations and past journal text remain verbatim.
    if(typeof value==='string'&&['type','tool','kind','material','resource','resources'].includes(field))return values[value]||value;
    return value;
  };
  return visit(raw);
}
