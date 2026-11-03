import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORLD,generateCity,parseCommand,applyCommand,compareScenes,validateWorld,makeExport,readExport} from '../src/pcg.mjs';
const get = c=>generateCity(c);
test('generating a fixed seed gives the exact same geometry, ids and metrics',()=>{
  assert.deepEqual(get(DEFAULT_WORLD),get(DEFAULT_WORLD));
});
test('400m site, central plaza reservation and height gradient',()=>{
  const s=get(DEFAULT_WORLD);
  assert.equal(s.world.size,400);
  assert.ok(s.buildings.length>100);
  assert.ok(s.buildings.every(b=>Math.hypot(b.x,b.z)>=DEFAULT_WORLD.plazaRadius+10));
  const inner=s.buildings.filter(b=>Math.hypot(b.x,b.z)<110);
  const outer=s.buildings.filter(b=>Math.hypot(b.x,b.z)>220);
  const avg=a=>a.reduce((sum,b)=>sum+b.height,0)/a.length;
  assert.ok(avg(inner)>avg(outer));
});
test('east density command lowers east only, all western objects strictly unchanged',()=>{
  const before=get(DEFAULT_WORLD);
  const cmd=parseCommand('将东侧建筑密度降低30%，其他区域不变');
  assert.equal(cmd.type,'scale');
  assert.equal(cmd.key,'eastDensity');
  const result=applyCommand(DEFAULT_WORLD,cmd);
  assert.equal(result.ok,true);
  const after=get(result.world);
  assert.deepEqual(before.buildings.filter(b=>b.region==='西侧'),after.buildings.filter(b=>b.region==='西侧'));
  assert.deepEqual(before.trees.filter(t=>t.x<0),after.trees.filter(t=>t.x<0));
  assert.ok(after.metrics.east < before.metrics.east);
  assert.equal(after.metrics.west, before.metrics.west);
  const changes=compareScenes(before,after);
  assert.equal(changes.added,0);
  assert.ok(changes.removed>0);
});
test('natural language world generation and rule edits',()=>{
  assert.equal(parseCommand('生成一座 400m×400m 的未来城市，中心高外围低').type,'generate');
  assert.equal(parseCommand('生成一个 400×500m 城市').type,'error');
  assert.equal(parseCommand('提高西侧建筑密度 10%').key,'westDensity');
  assert.equal(parseCommand('整体建筑高度提高20%').key,'heightScale');
  assert.equal(parseCommand('中央开放空间扩大20%').key,'plazaRadius');
  assert.equal(parseCommand('把东侧改得更好看').type,'error');
});
test('serialization roundtrip and schema validation',()=>{
  const doc=makeExport(DEFAULT_WORLD);
  assert.deepEqual(readExport(JSON.parse(JSON.stringify(doc))),DEFAULT_WORLD);
  assert.throws(()=>validateWorld({...DEFAULT_WORLD,eastDensity:2}));
  assert.throws(()=>readExport({format:'RandomJSON',version:1,world:DEFAULT_WORLD}));
});
test('stable IDs and deterministic change with a seed update',()=>{
  const before=get(DEFAULT_WORLD);
  const changed=get({...DEFAULT_WORLD,seed:43});
  assert.notDeepEqual(before.buildings,changed.buildings);
  const ids=new Set(before.buildings.map(b=>b.id));
  assert.equal(ids.size,before.buildings.length);
});
