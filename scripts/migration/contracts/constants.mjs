import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {discoverInventory,oracleDirectory,ROOT} from './inventory.mjs';
const literal=value=>value instanceof Set?[...value].map(literal):Array.isArray(value)?value.map(literal):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,literal(v)])):value;
const result={};for(const surface of (await discoverInventory()).surfaces){const source=await import(pathToFileURL(join(oracleDirectory(),surface.source_path)));for(const o of surface.operations)if(o.kind==='constant')result[`${surface.id}.${o.id}`]=literal(source[o.id]);}
writeFileSync(join(ROOT,'engine/data/public-constants.json'),JSON.stringify(result)+'\n');console.log(JSON.stringify({constants:Object.keys(result).length}));
