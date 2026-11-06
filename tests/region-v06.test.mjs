import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeConvexCells,regionArea,regionContains,regionId} from '../src/region.mjs';
import {DEFAULT_WORLD,generateCity,makeExport,readExport,randomFor} from '../src/pcg.mjs';
import {polygonsOverlap} from '../src/polygonal.mjs';
import {networkFromTopology,ROAD_NETWORK_VERSION,curveRoadEdge,sampleRoadCurve,roadCurveControl,splitRoadEdge,normalizeRoadNetwork,parseRoadEditInstruction} from '../src/road-network.mjs';
import {validateSpatialInvariants} from '../src/spatial.mjs';
const rect=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const valid=scene=>{const report=validateSpatialInvariants(scene);assert.ok(report.valid,report.errors.slice(0,7).join(' / '));};
const baseNetwork=()=>networkFromTopology(generateCity(DEFAULT_WORLD).roadGraph,400);

test('union of edge-adjacent convex cells is one true concave region',()=>{
  const region=mergeConvexCells([rect(0,0,4,1),rect(0,1,1,4)])[0];
  assert.equal(region.cells.length,2);
  assert.equal(region.holes.length,0);
  assert.ok(region.outer.length>=6);
  assert.equal(regionArea(region),7);
  assert.equal(regionContains(region,[.5,3]),true);
  assert.equal(regionContains(region,[2,2]),false);
});

test('polygon union yields one exterior ring and a correctly subtracted internal hole',()=>{
  const cells=[rect(0,0,6,1),rect(0,1,1,5),rect(5,1,6,5),rect(0,5,6,6)];
  const [region]=mergeConvexCells(cells);
  assert.equal(region.holes.length,1);
  assert.equal(regionArea(region),20);
  assert.equal(region.area,20);
  assert.ok(regionContains(region,[.5,3],.1));
  assert.equal(regionContains(region,[3,3]),false);
  assert.equal(regionContains(region,[1.15,3],.2),false,'hole-side clearance is respected');
  assert.equal(regionId([...region.outer].reverse(),[[...region.holes[0]].reverse()]),region.id);
});

test('diagonal straight boundaries and concave polygons use actual footprints, not bounding box',()=>{
  const l=mergeConvexCells([rect(0,0,4,1),rect(0,1,1,4)])[0];
  assert.equal(polygonsOverlap(l.outer,rect(2,2,3,3)),false);
  assert.equal(polygonsOverlap(l.outer,rect(.2,.2,.7,.7)),true);
});

test('road geometry v2 stores editable quadratic midpoint offset, renders identical endpoints',()=>{
  const net=baseNetwork(),edge=net.edges.find(e=>e.id==='E-10');
  const p=new Map(net.nodes.map(n=>[n.id,n])),a=p.get(edge.from),b=p.get(edge.to);
  const updated=curveRoadEdge(net,edge.id,8,400);
  assert.equal(updated.version,ROAD_NETWORK_VERSION);
  assert.equal(updated.edges.find(e=>e.id===edge.id).bend,8);
  assert.equal(net.edges.find(e=>e.id===edge.id).bend,0,'original input is never mutated');
  const sampled=sampleRoadCurve(a,b,8);
  assert.deepEqual(sampled[0],[a.x,a.z]);assert.deepEqual(sampled.at(-1),[b.x,b.z]);
  const middle=sampled[Math.floor(sampled.length/2)];
  const control=roadCurveControl(a,b,8);
  assert.ok(Number.isFinite(control.x)&&Number.isFinite(control.z));
  assert.ok(Math.hypot(middle[0]-(a.x+b.x)/2,middle[1]-(a.z+b.z)/2)>1);
});

test('curved roads recalculate road/parcel/park/tree chain and maintain area, clearance, and deterministic output',()=>{
  const network=baseNetwork(),edge='E-10';
  const straight=generateCity({...DEFAULT_WORLD,roadNetwork:network});
  const curved=curveRoadEdge(network,edge,8,400);
  const world={...DEFAULT_WORLD,roadNetwork:curved};
  const scene=generateCity(world);
  valid(scene);
  assert.notDeepEqual(scene.roads,straight.roads);
  assert.notDeepEqual(scene.parcels,straight.parcels);
  assert.ok(scene.roads.length>straight.roads.length);
  assert.equal(scene.metrics.roadSegments,scene.roads.length);
  assert.ok(scene.parcels.some(p=>p.cells?.length>=2||p.outer?.length>4));
  assert.deepEqual(scene,generateCity(world));
  assert.deepEqual(scene,generateCity(readExport(JSON.parse(JSON.stringify(makeExport(world))))));
});

test('curved road validation rejects out-of-bounds bends, illegal bends, and dishonest curved splitting',()=>{
  const net=baseNetwork();
  assert.throws(()=>curveRoadEdge(net,'E-0',40,400),/偏移/);
  assert.throws(()=>curveRoadEdge(net,'E-500',9,400),/不存在/);
  const withBend=curveRoadEdge(net,'E-10',7,400);
  assert.throws(()=>splitRoadEdge(withBend,'E-10',400),/曲线路段/);
  const migrated=normalizeRoadNetwork({...net,version:1,edges:net.edges.map(({bend,...e})=>e)},400);
  assert.equal(migrated.version,2);
  assert.ok(migrated.edges.every(e=>e.bend===0));
  assert.deepEqual(parseRoadEditInstruction('路段 E-10 弯曲设为 -8m'),{type:'bend-edge',edgeId:'E-10',bend:-8});
});

test('curve sweep: deterministic collision-free geometry over multiple seeds and bends',()=>{
  const net=baseNetwork();let n=0;
  for(const bend of [-12,-6,4,8,14])for(const seed of [0,42,99]){
    const curved=curveRoadEdge(net,'E-10',bend,400);
    const scene=generateCity({...DEFAULT_WORLD,roadNetwork:curved,seed});
    valid(scene);
    assert.ok(Math.abs(scene.roads.reduce((x,r)=>x+r.area,0)+scene.parcels.reduce((x,p)=>x+p.area,0)-400**2)<.25);
    n++;
  }
  assert.equal(n,15);
});
