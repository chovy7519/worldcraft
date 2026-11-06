import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORLD,generateCity,parseCommand,applyCommand,validateWorld,readExport,makeExport} from '../src/pcg.mjs';
import {validateSpatialInvariants} from '../src/spatial.mjs';
import {makeRoadAxes,polygonArea,polygonIntersection,polygonsOverlap,createRoadTopology,containsPoint,insetPolygon} from '../src/polygonal.mjs';

const create=patch=>generateCity({...DEFAULT_WORLD,...patch});
test('hybrid road and diagonal centerline form a connected editable road network',()=>{
  const s=create({diagonalAngle:35});
  assert.equal(s.geometryMode,'convex-polygons-v1');
  assert.ok(s.roadGraph.nodes.length>10);
  assert.ok(s.roadGraph.edges.some(e=>e.axisId==='axis-oblique'));
  assert.equal(validateSpatialInvariants(s).valid,true);
  assert.ok(s.parcels.some(p=>p.vertices.length!==4||p.vertices.some((v,i)=>{const b=p.vertices[(i+1)%p.vertices.length];return Math.abs(v[0]-b[0])>1e-5&&Math.abs(v[1]-b[1])>1e-5;})),'non-orthogonal parcel edge');
});
test('polygon footprints are exact and site is tiled without gaps or positive-area overlaps',()=>{
  const s=create({diagonalAngle:60,diagonalOffset:15});
  const sum=s.roads.reduce((a,r)=>a+r.area,0)+s.parcels.reduce((a,r)=>a+r.area,0);
  assert.ok(Math.abs(sum-s.world.size*s.world.size)<.05);
  assert.ok(s.buildings.every(b=>polygonArea(b.vertices)>0));
  assert.ok(s.parcels.every(p=>p.frontageIds.length>0));
  const report=validateSpatialInvariants(s);assert.equal(report.valid,true,report.errors.slice(0,10).join(' | '));
});
test('modified road angle updates all downstream spatial stages deterministically',()=>{
  const s=create({});
  const other=create({diagonalAngle:55});
  assert.notDeepEqual(s.roadGraph,other.roadGraph);
  assert.notDeepEqual(s.parcels,other.parcels);
  assert.notDeepEqual(s.buildings,other.buildings);
  assert.deepEqual(s,create({}));
});
test('removing diagonal road restores legacy rectangular geometry without changing user seed',()=>{
  const s=create({diagonalWidth:0});
  assert.equal(s.geometryMode,undefined);
  assert.ok(validateSpatialInvariants(s).valid);
  const old={...DEFAULT_WORLD,schemaVersion:2};delete old.diagonalAngle;delete old.diagonalWidth;delete old.diagonalOffset;
  const converted=validateWorld(old);
  assert.equal(converted.schemaVersion,4);
  assert.equal(converted.diagonalWidth,0);
  assert.equal(readExport({format:'WorldCraft',version:2,world:old}).diagonalWidth,0);
});
test('rule parser supports diagonal add/remove, angle and offset and JSON export',()=>{
  for(const [sentence,key,value] of [['斜路角度设为 45 度','diagonalAngle',45],['斜路偏移设为 -20m','diagonalOffset',-20],['斜路宽度设为 16m','diagonalWidth',16],['关闭斜路','diagonalWidth',0]]){
    const cmd=parseCommand(sentence);assert.equal(cmd.key,key,sentence);assert.equal(cmd.value,value,sentence);
    const change=applyCommand(DEFAULT_WORLD,cmd);assert.ok(change.ok);assert.equal(change.world[key],value);
  }
  const state={...DEFAULT_WORLD,diagonalAngle:45,diagonalOffset:30};
  const roundtrip=readExport(JSON.parse(JSON.stringify(makeExport(state))));
  assert.equal(roundtrip.diagonalAngle,45);assert.equal(roundtrip.diagonalOffset,30);
});
test('invalid diagonal road parameters are rejected instead of creating invalid layout',()=>{
  assert.throws(()=>validateWorld({...DEFAULT_WORLD,diagonalAngle:90}));
  assert.throws(()=>validateWorld({...DEFAULT_WORLD,diagonalWidth:3}));
  assert.throws(()=>validateWorld({...DEFAULT_WORLD,diagonalOffset:999}));
});
test('polygonal road → parcel → landuse → building / park → trees: geometric constraints at multiple sizes and seeds',()=>{
  let n=0;
  for(const size of [200,400,600])for(const seed of [0,42,99])for(const angle of [20,35,65]){
    const s=create({size,seed,diagonalAngle:angle,plazaRadius:Math.min(60,size/2-20)});
    const check=validateSpatialInvariants(s);
    assert.equal(check.valid,true,`${size}/${seed}/${angle} ${check.errors.slice(0,10).join(' | ')}`);
    assert.ok(s.roads.length>0&&s.parcels.length>0&&s.parks.length>0);
    n++;
  }
  assert.equal(n,27);
});
