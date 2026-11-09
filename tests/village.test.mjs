import test from 'node:test';
import assert from 'node:assert/strict';
import * as village from '../src/village.mjs';

test('mountain village exposes a deterministic generation contract',()=>{
  assert.equal(typeof village.generateVillage,'function');
  const a=village.generateVillage({seed:42,count:50});
  assert.deepEqual(a,village.generateVillage({seed:42,count:50}));
  assert.equal(a.buildings.length,50);
  assert.equal(a.baseline.buildings.length,50);
  assert.equal(a.events.length,50);
  assert.deepEqual(JSON.parse(JSON.stringify(a)),a);
});

test('adaptive buildings and connected roads satisfy mountain constraints across seeds',()=>{
  for(const seed of [7,42,81]){
    const scene=village.generateVillage({seed,count:50});
    assert.equal(scene.buildings.length,50,`seed ${seed}`);
    const report=village.validateVillage(scene);
    assert.deepEqual(report.errors,[],`seed ${seed}: ${report.errors}`);
    assert.equal(scene.metrics.slopeViolations,0);
    assert.equal(scene.metrics.waterViolations,0);
    assert.equal(scene.metrics.unconnected,0);
    assert.ok(scene.roads.length>1);
    assert.equal(scene.events.at(-1).buildingId,scene.buildings.at(-1).id);
  }
});

test('terrain varies in elevation and measures directional grade and suitability',()=>{
  const terrain=village.makeTerrain(42);
  assert.ok(Math.max(...terrain.heights)-Math.min(...terrain.heights)>60);
  const p=village.sampleTerrain(terrain,0,0);
  assert.ok(Number.isFinite(p.height)&&Number.isFinite(p.slope));
  assert.ok(p.suitability>=0&&p.suitability<=1);
});

test('parameter bounds are explicit and the baseline uses the same terrain and budget',()=>{
  assert.throws(()=>village.generateVillage({seed:NaN}),/种子/);
  assert.throws(()=>village.generateVillage({count:999}),/数量/);
  assert.throws(()=>village.generateVillage({maxSlope:0}),/坡度/);
  const scene=village.generateVillage({seed:19,count:20,maxSlope:18});
  assert.equal(scene.buildings.length,20);
  assert.equal(scene.baseline.buildings.length,20);
  assert.equal(scene.config.maxSlope,18);
  assert.equal(scene.metrics.buildingCount,20);
  assert.ok(scene.baseline.metrics.slopeViolations>=0);
  const changed=structuredClone(scene);
  changed.buildings[0].x=999;
  assert.equal(village.validateVillage(changed).valid,false);
});

test('network metrics count reused road segments once and handle a lone dwelling',()=>{
  const terrain=village.makeTerrain(42),a={x:0,z:0,height:10},b={x:5,z:0,height:10};
  const roads=[{points:[a,b]},{points:[b,a]}],config={maxSlope:22,maxRoadGrade:.32};
  const metrics=village.measureVillage(terrain,[{x:20,z:0,entry:a}],roads,config);
  assert.equal(metrics.roadLength,5);
  assert.equal(metrics.meanNeighborDistance,0);
});

test('strict terrain limits report capacity without silently breaking constraints',()=>{
  const scene=village.generateVillage({seed:0,count:70,maxSlope:10});
  assert.equal(scene.status,'capacity-limited');
  assert.ok(scene.buildings.length>0&&scene.buildings.length<70);
  assert.equal(village.validateVillage(scene).valid,true);
});
