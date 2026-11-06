import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORLD,generateCity} from '../src/pcg.mjs';
import {defaultGraph,evaluateGraph,setGraphNodeActive,connectGraph,addGraphNode,removeGraphNode,checkGraphShape,moveGraphNode,graphFromFile,ORDER} from '../src/graph.mjs';
const world={...DEFAULT_WORLD};
const render=g=>generateCity(world,evaluateGraph(g).features);
test('default graph executes every spatial dependency stage in the correct order',()=>{
  const graph=defaultGraph(),diag=evaluateGraph(graph);
  assert.equal(diag.valid,true);
  assert.deepEqual(diag.path,ORDER);
  assert.equal(diag.path.length,12);
  assert.deepEqual(render(graph).buildings,generateCity(world).buildings);
});
test('central plaza node changes land-use allocation and park count, not overlapping meshes',()=>{
  const graph=defaultGraph(),bypass=setGraphNodeActive(graph,'plaza',false);
  assert.equal(evaluateGraph(bypass).features.plaza,false);
  const before=render(graph),after=render(bypass);
  assert.equal(after.metrics.plazaArea,0);
  assert.notDeepEqual(after.parcels.map(p=>p.use),before.parcels.map(p=>p.use));
  assert.deepEqual(render(graph),before);
  assert.deepEqual(render(setGraphNodeActive(bypass,'plaza',true)),before);
});
test('optional promenade widens road strip but keeps nonoverlap and park allocations deterministic',()=>{
  const before=render(defaultGraph());
  const bypass=setGraphNodeActive(defaultGraph(),'promenade',false);
  const after=render(bypass);
  assert.notDeepEqual(before.roads,after.roads);
  assert.ok(after.roads.every(r=>r.width>=6));
  assert.deepEqual(render(setGraphNodeActive(bypass,'promenade',true)),before);
});
test('graph reconnection cannot silently skip mandatory roads/parcels/landuse/buildings/parks/trees',()=>{
  const invalid=connectGraph(defaultGraph(),'roads','density');
  const result=evaluateGraph(invalid);
  assert.equal(result.valid,false);
  assert.match(result.message,/必需/);
  assert.throws(()=>connectGraph(defaultGraph(),'trees','roads'),/依赖顺序/);
  assert.throws(()=>checkGraphShape({...defaultGraph(),edges:[{from:'seed',to:'roads'},{from:'seed',to:'landuse'}]}),/一条连线/);
  assert.throws(()=>graphFromFile(invalid),/完整输出/);
});
test('optional modules can be deleted and inserted; mandatory modules cannot',()=>{
  const removed=removeGraphNode(defaultGraph(),'plaza');
  assert.equal(removed.nodes.length,11);
  assert.equal(evaluateGraph(removed).valid,true);
  const added=addGraphNode(removed,'plaza');
  assert.equal(evaluateGraph(added).path.includes('plaza'),false);
  const enabled=setGraphNodeActive(added,'plaza',true);
  assert.deepEqual(render(enabled),render(defaultGraph()));
  assert.throws(()=>removeGraphNode(defaultGraph(),'roads'),/必需/);
});
test('graph JSON roundtrip and height bypass preserve stable transforms',()=>{
  const graph=moveGraphNode(setGraphNodeActive(defaultGraph(),'height',false),'roads',895,137);
  assert.deepEqual(graphFromFile(JSON.parse(JSON.stringify(graph))),graph);
  const scaled={...world,heightScale:1.7};
  const a=generateCity(scaled,evaluateGraph(graph).features);
  const b=generateCity(scaled,evaluateGraph(defaultGraph()).features);
  assert.ok(b.metrics.avgHeight>a.metrics.avgHeight);
});
test('east-only edits preserve western city objects with full graph active',()=>{
  const features=evaluateGraph(defaultGraph()).features;
  const before=generateCity(world,features),after=generateCity({...world,eastDensity:world.eastDensity*.7},features);
  assert.deepEqual(before.buildings.filter(b=>b.region==='西侧'),after.buildings.filter(b=>b.region==='西侧'));
});
test('v0.2 scene graph upgrades gracefully without introducing broken connections',()=>{
  const legacy={version:1,nodes:[{type:'seed'},{type:'grid'},{type:'plaza'},{type:'promenade'},{type:'density'},{type:'height'},{type:'instances'}],edges:[{from:'seed',to:'grid'},{from:'grid',to:'density'},{from:'density',to:'height'},{from:'height',to:'instances'}]};
  const migrated=graphFromFile(legacy);
  assert.equal(evaluateGraph(migrated).valid,true);
  assert.equal(evaluateGraph(migrated).features.plaza,false);
  assert.equal(evaluateGraph(migrated).features.promenade,false);
});
