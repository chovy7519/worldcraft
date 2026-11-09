import {readFileSync} from 'node:fs';
import {generateVillage,validateVillage} from '../src/village.mjs';
const input=process.argv[2]??'examples/mountain-households-seed42.json';
const saved=JSON.parse(readFileSync(input,'utf8'));
const fresh=generateVillage(saved.config),errors=[];
function compare(a,b,path){
  if(typeof a==='number'&&typeof b==='number'){if(Math.abs(a-b)>1e-10)errors.push(path);return;}
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){if(a!==b)errors.push(path);return;}
  if(JSON.stringify(Object.keys(a))!==JSON.stringify(Object.keys(b))){errors.push(path+' keys');return;}
  for(const key of Object.keys(a))compare(a[key],b[key],path+'.'+key);
}
for(const key of ['buildings','parcels','roads','metrics','slopeBaseline'])compare(saved[key],fresh[key],key);
if(saved.version!==2)errors.push('version');
errors.push(...validateVillage(saved).errors,...validateVillage(saved.slopeBaseline).errors);
if(errors.length)throw Error(JSON.stringify(errors.slice(0,10)));
console.log(JSON.stringify({input,verified:true,numericTolerance:1e-10,houses:saved.buildings.length,parcels:saved.parcels.length,areaRange:[Math.min(...saved.parcels.map(p=>p.area)),Math.max(...saved.parcels.map(p=>p.area))],adaptive:saved.metrics,control:saved.slopeBaseline.metrics},null,2));
