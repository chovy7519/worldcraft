import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORLD,generateCity} from '../src/pcg.mjs';
import {defaultGraph,evaluateGraph,setGraphNodeActive,connectGraph,addGraphNode,removeGraphNode,checkGraphShape,moveGraphNode,graphFromFile} from '../src/graph.mjs';

const world={...DEFAULT_WORLD};
const render=g=>generateCity(world,evaluateGraph(g).features);
test('default PCG graph evaluates deterministically to the V0.1 city',()=>{
  const graph=defaultGraph();
  assert.equal(evaluateGraph(graph).valid,true);
  assert.deepEqual(render(graph),generateCity(world));
  assert.equal(evaluateGraph(graph).path.length,7);
});
test('bypassing central plaza actually builds in the former reserved area',()=>{
  const graph=defaultGraph();
  const bypass=setGraphNodeActive(graph,'plaza',false);
  assert.equal(evaluateGraph(bypass).features.plaza,false);
  const before=render(graph),after=render(bypass);
  assert.equal(after.metrics.plazaArea,0);
  assert.ok(after.buildings.length>before.buildings.length);
  assert.deepEqual(render(graph),before,'original graph immutable');
  const restored=setGraphNodeActive(bypass,'plaza',true);
  assert.deepEqual(render(restored),before);
});
test('removing promenade changes the corridor and restored world is deterministic',()=>{
  const before=render(defaultGraph());
  const noCorridor=setGraphNodeActive(defaultGraph(),'promenade',false);
  const after=render(noCorridor);
  assert.equal(evaluateGraph(noCorridor).features.promenade,false);
  assert.ok(after.metrics.total>before.metrics.total);
  assert.deepEqual(render(setGraphNodeActive(noCorridor,'promenade',true)),before);
});
test('graph port reconnection can bypass several modules with geometric effect',()=>{
  const graph=connectGraph(defaultGraph(),'grid','density');
  const e=evaluateGraph(graph);
  assert.deepEqual(e.path,['seed','grid','density','height','instances']);
  assert.equal(e.features.plaza,false);
  assert.equal(e.features.promenade,false);
  assert.equal(render(graph).metrics.plazaArea,0);
});
test('graph detects broken dependency paths and impossible wiring',()=>{
  const invalid=connectGraph(defaultGraph(),'grid','instances');
  assert.equal(evaluateGraph(invalid).valid,false);
  assert.match(evaluateGraph(invalid).message,/必需/);
  assert.throws(()=>connectGraph(defaultGraph(),'height','grid'),/依赖顺序/);
  assert.throws(()=>checkGraphShape({...defaultGraph(),edges:[{from:'seed',to:'grid'},{from:'seed',to:'density'}]}),/一条连线/);
  assert.throws(()=>graphFromFile(invalid),/生成图/);
});
test('optional nodes are removable and can be added and spliced back into the stream',()=>{
  const removed=removeGraphNode(defaultGraph(),'plaza');
  assert.equal(removed.nodes.length,6);
  assert.equal(evaluateGraph(removed).valid,true);
  const added=addGraphNode(removed,'plaza');
  assert.equal(evaluateGraph(added).path.includes('plaza'),false);
  const restored=setGraphNodeActive(added,'plaza',true);
  assert.equal(evaluateGraph(restored).path.includes('plaza'),true);
  assert.deepEqual(render(restored),render(defaultGraph()));
  assert.throws(()=>removeGraphNode(defaultGraph(),'density'),/必需/);
});
test('graph is serializable with positions and stage state',()=>{
  const graph=moveGraphNode(setGraphNodeActive(defaultGraph(),'height',false),'density',895,137);
  const parsed=graphFromFile(JSON.parse(JSON.stringify(graph)));
  assert.deepEqual(parsed,graph);
  assert.equal(render(parsed).metrics.avgHeight,render(defaultGraph()).metrics.avgHeight);
  const scaledWorld={...world,heightScale:1.7};
  const a=generateCity(scaledWorld,evaluateGraph(parsed).features);
  const b=generateCity(scaledWorld,evaluateGraph(defaultGraph()).features);
  assert.ok(b.metrics.avgHeight>a.metrics.avgHeight);
});
test('east-only edits preserve western generated objects with the graph active',()=>{
  const e=evaluateGraph(defaultGraph()).features;
  const before=generateCity(world,e);
  const after=generateCity({...world,eastDensity:world.eastDensity*.7},e);
  assert.deepEqual(before.buildings.filter(b=>b.region==='西侧'),after.buildings.filter(b=>b.region==='西侧'));
});
