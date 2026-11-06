import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORLD,generateCity,parseCommand,applyCommand,compareScenes,validateWorld,makeExport,readExport} from '../src/pcg.mjs';
import {STAGE_DEPENDENCIES,EXTENSION_SLOTS,validateSpatialInvariants,overlapArea} from '../src/spatial.mjs';
const get=world=>generateCity(world);
test('same seed and parameters produce byte-identical spatial artifacts',()=>{
  assert.deepEqual(get(DEFAULT_WORLD),get(DEFAULT_WORLD));
  const changed=get({...DEFAULT_WORLD,seed:43});
  assert.notDeepEqual(get(DEFAULT_WORLD).parcels,changed.parcels);
});
test('the full road → parcel → use → building/park → tree chain is materialized',()=>{
  const s=get(DEFAULT_WORLD);
  assert.deepEqual(s.pipeline.map(p=>p.stage),['roads','parcels','landuse','buildings','parks','trees']);
  assert.ok(s.roads.length>0&&s.parcels.length>0&&s.buildings.length>0&&s.parks.length>0&&s.trees.length>0);
  assert.deepEqual(new Set(s.parcels.map(p=>p.use)),new Set(['residential','commercial','civic','park']));
  assert.deepEqual(new Set(s.parks.map(p=>p.kind)),new Set(['small','medium','large']));
  assert.deepEqual(new Set(s.trees.map(t=>t.kind)),new Set(['street','park']));
  assert.equal(new Set(s.buildings.map(b=>b.id)).size,s.buildings.length);
  assert.ok(s.parcels.every(p=>p.frontageIds.length>0));
  assert.ok(s.trees.every(t=>!!t.parcelId));
});
test('all geometric invariants pass, and road + parcel footprints tile the whole site',()=>{
  const s=get(DEFAULT_WORLD),check=validateSpatialInvariants(s);
  assert.equal(check.valid,true,check.errors.slice(0,10).join('\n'));
  const sum=s.roads.reduce((v,r)=>v+r.area,0)+s.parcels.reduce((v,p)=>v+p.area,0);
  assert.ok(Math.abs(sum-s.world.size**2)<.01,`coverage gap ${sum-s.world.size**2}`);
  for(const p of s.parcels)for(const road of s.roads)assert.equal(overlapArea(p.bounds,road.bounds),0);
  assert.ok(s.buildings.every(b=>b.width>0&&b.depth>0));
});
test('parameter combinations, different seeds and world sizes maintain collision-free layouts',()=>{
  let checks=0;
  for(const size of [200,400,600])for(const seed of [0,42,97])for(const roadSpacing of [60,100,160]){
    const w={...DEFAULT_WORLD,size,seed,roadSpacing,plazaRadius:Math.min(60,size/2-20),parkShare:.16};
    const s=get(w),result=validateSpatialInvariants(s);
    assert.ok(result.valid,`${size}/${seed}/${roadSpacing}: ${result.errors.slice(0,5)}`);
    checks++;
  }
  assert.equal(checks,27);
});
test('road width, block spacing and parcel target affect downstream layout without overlaps',()=>{
  const base=get(DEFAULT_WORLD);
  const variants=[{roadSpacing:80},{roadWidth:14},{parcelTargetWidth:32},{parkShare:.38},{treeSpacing:10},{treeDensity:.3}];
  for(const patch of variants){
    const s=get({...DEFAULT_WORLD,...patch}),r=validateSpatialInvariants(s);
    assert.ok(r.valid,`${JSON.stringify(patch)}: ${r.errors.slice(0,5)}`);
    assert.notDeepEqual(s.metrics,base.metrics);
  }
});
test('east density command changes east building sampling but preserves west and street/parcel geometry',()=>{
  const before=get(DEFAULT_WORLD);
  const cmd=parseCommand('将东侧建筑密度降低30%，其他区域不变');
  assert.equal(cmd.type,'scale');
  const result=applyCommand(DEFAULT_WORLD,cmd);assert.equal(result.ok,true);
  const after=get(result.world);
  assert.deepEqual(before.roads,after.roads);
  assert.deepEqual(before.parcels,after.parcels);
  assert.deepEqual(before.buildings.filter(b=>b.region==='西侧'),after.buildings.filter(b=>b.region==='西侧'));
  assert.ok(after.metrics.east<before.metrics.east);
  assert.equal(after.metrics.west,before.metrics.west);
  assert.equal(compareScenes(before,after).added,0);
});
test('natural language parameter changes update actual road/parcel/park/tree generation',()=>{
  const phrases=[['道路间距设为 80m','roadSpacing',80],['道路宽度设为 12m','roadWidth',12],['地块目标设为 35m','parcelTargetWidth',35],['公园比例设为 35%','parkShare',.35],['行道树间距设为 12m','treeSpacing',12],['树木密度设为 50%','treeDensity',.5],['建筑退界设为 8m','buildingSetback',8]];
  for(const [phrase,key,value] of phrases){
    const cmd=parseCommand(phrase);
    assert.equal(cmd.key,key,phrase);assert.equal(cmd.value,value,phrase);
    const result=applyCommand(DEFAULT_WORLD,cmd);assert.equal(result.ok,true,phrase);
    assert.equal(result.world[key],value);
    assert.ok(validateSpatialInvariants(get(result.world)).valid,phrase);
  }
  assert.equal(parseCommand('生成一座 400×500m 的城市').type,'error');
});
test('legacy version 1 world saves migrate with default spatial params',()=>{
  const old={schemaVersion:1,size:400,seed:42,name:'Legacy World',eastDensity:.8,westDensity:.8,heightScale:1,plazaRadius:60,promenadeWidth:10.5,style:'future'};
  const migrated=validateWorld(old);
  assert.equal(migrated.schemaVersion,2);
  assert.equal(migrated.roadSpacing,DEFAULT_WORLD.roadSpacing);
  const currentDoc=makeExport(DEFAULT_WORLD);
  assert.deepEqual(readExport(JSON.parse(JSON.stringify(currentDoc))),DEFAULT_WORLD);
  assert.deepEqual(readExport({format:'WorldCraft',version:1,world:old}),migrated);
  assert.throws(()=>validateWorld({...DEFAULT_WORLD,parkShare:2}));
  assert.throws(()=>validateWorld({...DEFAULT_WORLD,roadSpacing:77}));
});
test('reserved hydrology and terrain interfaces documented without claiming simulation',()=>{
  assert.equal(EXTENSION_SLOTS.terrain.status,'reserved');
  assert.equal(EXTENSION_SLOTS.hydrology.status,'reserved');
  const order=STAGE_DEPENDENCIES.map(s=>s.id);
  for(const stage of STAGE_DEPENDENCIES)for(const dep of stage.dependsOn)if(dep!=='seed')assert.ok(order.indexOf(dep)<order.indexOf(stage.id));
});
test('100 layout combinations pass geometric conflict checks (seed × size × road spacing)',()=>{
  let verified=0;
  for(const size of [200,300,400,600,800])for(const roadSpacing of [60,80,100,140,160])for(const seed of [0,1,42,101]){
    const s=generateCity({...DEFAULT_WORLD,size,roadSpacing,seed,plazaRadius:Math.min(60,size/2-20)});
    const report=validateSpatialInvariants(s);
    assert.equal(report.valid,true,`${size}/${roadSpacing}/${seed}: ${report.errors.slice(0,4).join(',')}`);
    verified++;
  }
  assert.equal(verified,100);
});
