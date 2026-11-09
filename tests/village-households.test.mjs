import test from 'node:test';
import assert from 'node:assert/strict';
import {generateVillage,validateVillage,sampleTerrain,segmentDistance} from '../src/village.mjs';
import {parcelContains} from '../src/village-households.mjs';

test('each dwelling owns a connected, road-facing parcel containing its home and entry path',()=>{
  const scene=generateVillage({seed:42,count:20});
  assert.equal(scene.parcels?.length,20);
  const occupied=new Set();
  for(const b of scene.buildings){
    const p=scene.parcels.find(p=>p.id===b.parcelId);
    assert.equal(p.buildingId,b.id);
    assert.ok(p.area>100&&p.frontageLength>0);
    assert.ok(p.rings.length&&p.cells.length);
    assert.ok(b.footprint.length===4&&b.walkway.length>=3);
    assert.ok(b.foundation.length===3);
    assert.ok(b.foundation.every(s=>s.top>=Math.max(...s.groundHeights)));
    assert.ok(-(b.entry.x-b.x)*Math.sin(b.rotation)+(b.entry.z-b.z)*Math.cos(b.rotation)>=0);
    for(const point of [...b.footprint,...b.walkway,...b.foundation.flatMap(f=>f.points)])assert.ok(parcelContains(p,point));
    for(const cell of p.cells){
      const x=(cell[0][0]+cell[2][0])/2,z=(cell[0][1]+cell[2][1])/2;
      assert.ok(cell.every(([x,z])=>!sampleTerrain(scene.terrain,x,z).water));
      for(const r of scene.roads)for(let i=1;i<r.points.length;i++)assert.ok(segmentDistance({x,z},r.points[i-1],r.points[i])>=3.399);
    }
    const signedArea=p.rings.reduce((sum,ring)=>sum+ring.reduce((s,q,i)=>{const r=ring[(i+1)%ring.length];return s+(q[0]*r[1]-r[0]*q[1])/2;},0),0);
    assert.ok(Math.abs(signedArea-p.area)<.001);
    for(const cell of p.cellIds){assert.ok(!occupied.has(cell));occupied.add(cell);}
    const cellSet=new Set(p.cellIds),visited=new Set([p.cellIds[0]]),queue=[p.cellIds[0]];
    while(queue.length){const i=queue.pop(),x=i%160,z=Math.floor(i/160);for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,j=nz*160+nx;if(nx<0||nx>=160||nz<0||nz>=160||!cellSet.has(j)||visited.has(j))continue;visited.add(j);queue.push(j);}}
    assert.equal(visited.size,p.cellIds.length);
  }
  assert.deepEqual(validateVillage(scene).errors,[]);
});

test('terrain random baseline shares constraints and deterministic household data',()=>{
  const a=generateVillage({seed:7,count:15});
  assert.equal(a.slopeBaseline?.buildings.length,15);
  assert.equal(a.slopeBaseline.parcels.length,15);
  assert.equal(a.slopeBaseline.metrics.slopeViolations,0);
  assert.equal(a.slopeBaseline.metrics.waterViolations,0);
  assert.equal(a.slopeBaseline.metrics.unconnected,0);
  assert.deepEqual(validateVillage(a.slopeBaseline).errors,[]);
  assert.notDeepEqual(a.slopeBaseline.buildings.map(b=>[b.x,b.z]),a.buildings.map(b=>[b.x,b.z]));
  assert.deepEqual(a,generateVillage({seed:7,count:15}));
});

test('household validation detects missing parcel, stolen cells and detached entry paths',()=>{
  const scene=generateVillage({count:10});
  assert.ok(scene.parcels);
  const missing=structuredClone(scene);missing.parcels.pop();assert.equal(validateVillage(missing).valid,false);
  const stolen=structuredClone(scene);stolen.parcels[1].cellIds.push(stolen.parcels[0].cellIds[0]);assert.equal(validateVillage(stolen).valid,false);
  const path=structuredClone(scene);path.buildings[0].walkway[0].x=999;assert.equal(validateVillage(path).valid,false);
});

test('dense settlement foundations stay within their own plots in both layouts',()=>{
  const scene=generateVillage({seed:42,count:70});
  assert.deepEqual(validateVillage(scene).errors,[]);
  assert.deepEqual(validateVillage(scene.slopeBaseline).errors,[]);
});
