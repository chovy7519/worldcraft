import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORLD,generateCity,validateWorld,makeExport,readExport} from '../src/pcg.mjs';
import {validateSpatialInvariants} from '../src/spatial.mjs';
import {networkFromTopology,normalizeRoadNetwork,moveRoadNode,resizeRoadEdge,splitRoadEdge,addRoadBranch,removeRoadNode,parseRoadEditInstruction} from '../src/road-network.mjs';
import {polygonArea} from '../src/polygonal.mjs';
const base=()=>generateCity(DEFAULT_WORLD);
const initial=()=>networkFromTopology(base().roadGraph,DEFAULT_WORLD.size);
const generated=net=>generateCity({...DEFAULT_WORLD,roadNetwork:net});
const valid=s=>{const result=validateSpatialInvariants(s);assert.equal(result.valid,true,result.errors.slice(0,12).join(' | '));};

test('convert automatic centerlines to stable authored node/edge graph; preserve original geometry',()=>{
  const network=initial();
  assert.equal(network.version,1);
  assert.ok(network.nodes.length>25&&network.edges.length>35);
  assert.equal(new Set(network.nodes.map(n=>n.id)).size,network.nodes.length);
  assert.equal(new Set(network.edges.map(e=>e.id)).size,network.edges.length);
  assert.deepEqual(normalizeRoadNetwork(network,400),network);
  const scene=generated(network);valid(scene);
  assert.equal(scene.geometryMode,'editable-road-polygons-v1');
  assert.equal(scene.metrics.roadSegments,base().metrics.roadSegments);
  assert.equal(scene.metrics.parkCount,base().metrics.parkCount);
  assert.deepEqual(scene,generated(network),'same input always creates identical scene');
});

test('road node movement updates downstream chain and preserves unaffected land IDs',()=>{
  const network=initial(),before=generated(network),node=network.nodes.find(n=>n.id==='N-0');
  const moved=moveRoadNode(network,node.id,node.x,node.z+5,400),after=generated(moved);
  valid(after);
  assert.deepEqual(initial(),network,'original authored graph not mutated');
  assert.equal(moved.nodes.find(n=>n.id===node.id).z,node.z+5);
  assert.notDeepEqual(after.roads,before.roads);
  const stableIds=new Set(before.parcels.map(p=>p.id));
  assert.ok(after.parcels.filter(p=>stableIds.has(p.id)).length>=40,'geometrically unchanged parcels retain IDs');
  assert.deepEqual(after,generated(moved));
  assert.ok(after.parcels.every(p=>p.frontageIds.length>0));
  const total=after.roads.reduce((s,p)=>s+p.area,0)+after.parcels.reduce((s,p)=>s+p.area,0);
  assert.ok(Math.abs(total-160000)<.25);
});

test('splitting a road and joining it back preserves geometry and no conflicts',()=>{
  const network=initial(),before=generated(network);
  const split=splitRoadEdge(network,network.edges[0].id,400);
  assert.equal(split.network.nodes.length,network.nodes.length+1);
  assert.equal(split.network.edges.length,network.edges.length+1);
  valid(generated(split.network));
  assert.deepEqual(generated(split.network).parcels.map(p=>p.id),before.parcels.map(p=>p.id));
  const restored=removeRoadNode(split.network,split.nodeId,400);
  valid(generated(restored));
  assert.equal(restored.nodes.length,network.nodes.length);
});

test('new cul-de-sac branch and road width changes recalculate downstream without overlaps',()=>{
  const network=initial(),n=network.nodes.find(n=>n.id==='N-0');
  const branch=addRoadBranch(network,n.id,n.x+18,n.z+6,400);
  const branchScene=generated(branch.network);valid(branchScene);
  assert.ok(branchScene.roads.length>0&&branchScene.trees.length>0);
  assert.notDeepEqual(branchScene.parcels,generated(network).parcels);
  const resized=resizeRoadEdge(network,'E-0',12,400);
  valid(generated(resized));
  assert.equal(resized.edges.find(e=>e.id==='E-0').width,12);
});

test('invalid graph edits never silently disconnect, leave site, or form duplicate roads',()=>{
  const network=initial(),node=network.nodes[0];
  assert.throws(()=>moveRoadNode(network,node.id,999,0,400),/超出/);
  assert.throws(()=>resizeRoadEdge(network,'E-0',30,400),/宽度/);
  assert.throws(()=>removeRoadNode(network,'N-18',400),/复杂交叉口|只允许/);
  const duplicate={...network,edges:[...network.edges,{...network.edges[0],id:'duplicate'}]};
  assert.throws(()=>normalizeRoadNetwork(duplicate,400),/重复/);
  const ghost={...network,nodes:[...network.nodes,{id:'ghost',x:11,z:11}]};
  assert.throws(()=>normalizeRoadNetwork(ghost,400),/连通/);
  assert.equal(network.nodes[0].x,node.x);
});

test('road-specific offline language grammar and JSON migration preserve authored road topology',()=>{
  assert.deepEqual(parseRoadEditInstruction('将路口 N-0 向东移动 5m'),{type:'move-node',nodeId:'N-0',dx:5,dz:0});
  assert.deepEqual(parseRoadEditInstruction('路段 E-0 宽度设为 12m'),{type:'resize-edge',edgeId:'E-0',width:12});
  assert.equal(parseRoadEditInstruction('生成未来城市'),null);
  const network=initial(),world={...DEFAULT_WORLD,roadNetwork:network};
  const read=readExport(JSON.parse(JSON.stringify(makeExport(world))));
  assert.deepEqual(read.roadNetwork,network);valid(generateCity(read));
  assert.equal(validateWorld({...DEFAULT_WORLD,schemaVersion:3}).roadNetwork,null);
  assert.equal(validateWorld({...DEFAULT_WORLD,schemaVersion:1}).diagonalWidth,0);
  assert.equal(validateWorld(world).schemaVersion,4);
});

test('edited corridors have positive polygon area, road & parcel tile site, and model extension slots remain empty',()=>{
  let count=0;
  for(const size of [200,400])for(const angle of [25,40,60])for(const seed of [3,42]){
    const world={...DEFAULT_WORLD,size,seed,diagonalAngle:angle,plazaRadius:Math.min(60,size/2-20)};
    const raw=generateCity(world),network=networkFromTopology(raw.roadGraph,size),scene=generateCity({...world,roadNetwork:network});
    valid(scene);
    assert.ok(scene.roads.every(p=>polygonArea(p.vertices)>1e-4));
    assert.ok(scene.parcels.every(p=>p.frontageIds.length));
    assert.ok(scene.parks.every(p=>p.vertices.length>=3));
    assert.ok(scene.trees.every(t=>scene.parcels.some(p=>p.id===t.parcelId)));
    assert.equal(scene.world.extensions.hydrology,null);
    count++;
  }
  assert.equal(count,12);
});

test('interior junction movement produces connected topology and polygon-sound angled corridors',()=>{
  const net=initial(),node=net.nodes.find(n=>n.id==='N-23');
  const edited=moveRoadNode(net,node.id,node.x,node.z+3,400);
  const scene=generated(edited);valid(scene);
  assert.equal(scene.roadGraph.nodes.length>=net.nodes.length,true);
  assert.ok(scene.parcels.some(p=>p.vertices.some((v,i)=>{
    const to=p.vertices[(i+1)%p.vertices.length];return Math.abs(v[0]-to[0])>1e-5&&Math.abs(v[1]-to[1])>1e-5;
  })),'angled roads must produce non-rectangular parcel edges');
  assert.ok(scene.roads.every(r=>r.vertices.length>=3));
});

test('authored node identities survive modification and serialized results remain deterministic',()=>{
  const net=initial(),edited=moveRoadNode(net,'N-23',net.nodes.find(n=>n.id==='N-23').x,net.nodes.find(n=>n.id==='N-23').z+3,400);
  assert.deepEqual(edited.nodes.map(n=>n.id),net.nodes.map(n=>n.id));
  const file=JSON.parse(JSON.stringify(makeExport({...DEFAULT_WORLD,roadNetwork:edited})));
  assert.deepEqual(generated(edited),generateCity(readExport(file)));
});
