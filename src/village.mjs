/** Mountain settlement experiment; see docs/MOUNTAIN_VILLAGE.md. */
import {attachHouseholds,validateHouseholds,buildingFootprint,contourRotation} from './village-households.mjs';
const SIZE=400, STEP=5, N=81, HOUSE_RADIUS=7, ROAD_HALF=1.5;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=v=>Math.round(v*1000)/1000;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function random(seed){let s=seed>>>0;return ()=>{s+=0x6D2B79F5;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
function elevation(x,z,seed){
  const phase=(seed%101)/101;
  return 9+87*Math.exp(-1*((x-100-phase*20)/100)**2-((z+100)/145)**2)
    +58*Math.exp(-1*((x+165)/105)**2-((z+130+phase*25)/105)**2)
    +19*Math.exp(-1*((x-130)/130)**2-((z-145)/80)**2)
    +3*Math.sin(x/59+phase)*Math.cos(z/67);
}
const index=(x,z)=>clamp(Math.round((z+200)/STEP),0,N-1)*N+clamp(Math.round((x+200)/STEP),0,N-1);
function point(terrain,i){return {x:(i%N)*STEP-200,z:Math.floor(i/N)*STEP-200,height:terrain.heights[i]};}
const inWater=(x,z,margin=0)=>((x+133)/(27+margin))**2+((z-66)/(48+margin))**2<1;
export function sampleTerrain(terrain,x,z){
  const h=elevation(x,z,terrain.seed),dx=(elevation(x+1,z,terrain.seed)-elevation(x-1,z,terrain.seed))/2;
  const dz=(elevation(x,z+1,terrain.seed)-elevation(x,z-1,terrain.seed))/2;
  const slope=Math.atan(Math.hypot(dx,dz))*180/Math.PI;
  const water=inWater(x,z);
  return {height:round(h),slope:round(slope),water,suitability:water?0:clamp(1-slope/32,0,1)};
}
export function makeTerrain(seed=42){
  const terrain={seed,size:SIZE,step:STEP,side:N,heights:[]};
  for(let z=-200;z<=200;z+=STEP)for(let x=-200;x<=200;x+=STEP)terrain.heights.push(round(elevation(x,z,seed)));
  return terrain;
}
export function segmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz;
  const t=l?clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/l,0,1):0;
  return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);
}
function footprintSamples(b){return [{x:b.x,z:b.z},...buildingFootprint(b)];}
function plotValid(terrain,b,maxSlope){return Math.abs(b.x)<184&&Math.abs(b.z)<184&&footprintSamples(b).every(p=>{
  const s=sampleTerrain(terrain,p.x,p.z);return !inWater(p.x,p.z,3)&&s.slope<=maxSlope;
});}
function nearestRoad(p,roads){let result={distance:Infinity,point:null};
  for(const road of roads)for(const q of road.points){const d=distance(p,q);if(d<result.distance)result={distance:d,point:q};}
  return result;
}
function roadClear(p,roads,r=HOUSE_RADIUS+ROAD_HALF+1){return roads.every(road=>road.points.slice(1).every((q,i)=>segmentDistance(p,road.points[i],q)>=r));}
class Heap{
  items=[];
  push(item){let i=this.items.length;this.items.push(item);while(i){const p=(i-1)>>1;if(this.items[p].f<=item.f)break;this.items[i]=this.items[p];i=p;}this.items[i]=item;}
  pop(){const root=this.items[0],last=this.items.pop();if(this.items.length){let i=0;while(i*2+1<this.items.length){let c=i*2+1;if(c+1<this.items.length&&this.items[c+1].f<this.items[c].f)c++;if(this.items[c].f>=last.f)break;this.items[i]=this.items[c];i=c;}this.items[i]=last;}return root;}
}
// A*: directional longitudinal grade cost. No history-dependent turn penalty.
function findPath(terrain,start,goal,buildings,maxGrade){
  const s=index(start.x,start.z),g=index(goal.x,goal.z),blocked=new Uint8Array(N*N);
  for(let i=0;i<blocked.length;i++){const p=point(terrain,i);blocked[i]=inWater(p.x,p.z,ROAD_HALF+1)||buildings.some(b=>distance(p,b)<11)?1:0;}
  if(blocked[s]||blocked[g])return null;
  const costs=new Float64Array(N*N).fill(Infinity),prev=new Int32Array(N*N).fill(-1),heap=new Heap();
  costs[s]=0;heap.push({i:s,f:distance(start,goal),cost:0});
  const dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  while(heap.items.length){
    const item=heap.pop(),i=item.i;if(item.cost!==costs[i])continue;
    if(i===g){const path=[];for(let k=g;k!==-1;k=prev[k])path.push(point(terrain,k));return path.reverse();}
    const a=point(terrain,i),ix=i%N,iz=Math.floor(i/N);
    for(const [dx,dz] of dirs){const nx=ix+dx,nz=iz+dz;if(nx<1||nx>=N-1||nz<1||nz>=N-1)continue;
      const j=nz*N+nx;if(blocked[j])continue;
      const b=point(terrain,j),len=distance(a,b),grade=Math.abs(a.height-b.height)/len;
      if(grade>maxGrade||inWater((a.x+b.x)/2,(a.z+b.z)/2,ROAD_HALF+1))continue;
      const cost=costs[i]+len*(1+20*grade*grade);
      if(cost>=costs[j])continue;
      costs[j]=cost;prev[j]=i;heap.push({i:j,cost,f:cost+distance(b,point(terrain,g))});
    }
  }
  return null;
}
export function measureVillage(terrain,buildings,roads,config){
  let totalLength=0,maxGrade=0,waterRoadLength=0,steepRoadLength=0;
  const seen=new Set();
  for(const road of roads)for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],length=distance(a,b),grade=Math.abs(a.height-b.height)/length;
    const ids=[`${a.x},${a.z}`,`${b.x},${b.z}`].sort().join('|');
    if(seen.has(ids))continue;seen.add(ids);
    totalLength+=length;maxGrade=Math.max(maxGrade,grade);
    if(grade>config.maxRoadGrade+1e-6)steepRoadLength+=length;
    if(inWater(a.x,a.z,ROAD_HALF)||inWater(b.x,b.z,ROAD_HALF)||inWater((a.x+b.x)/2,(a.z+b.z)/2,ROAD_HALF))waterRoadLength+=length;
  }
  const slopes=buildings.map(b=>Math.max(...footprintSamples(b).map(p=>sampleTerrain(terrain,p.x,p.z).slope)));
  return {buildingCount:buildings.length,meanSlope:round(slopes.reduce((a,b)=>a+b,0)/(slopes.length||1)),
    slopeViolations:slopes.filter(v=>v>config.maxSlope).length,
    waterViolations:buildings.filter(b=>footprintSamples(b).some(p=>inWater(p.x,p.z,3))).length,
    unconnected:buildings.filter(b=>!roads.some(r=>r.points.some(p=>distance(p,b.entry)<.01))).length,
    roadLength:round(totalLength),maxRoadGrade:round(maxGrade*100),steepRoadLength:round(steepRoadLength),waterRoadLength:round(waterRoadLength),
    meanNeighborDistance:buildings.length<2?0:round(buildings.reduce((sum,b)=>sum+Math.min(...buildings.filter(c=>c!==b).map(c=>distance(b,c))),0)/buildings.length)};
}
function makeBaseline(terrain,config){
  const buildings=[],roads=[];
  // Explicit experimental grid baseline: same terrain and budget; no slope optimization.
  for(const x of [-150,-100,-50,0,50,100,150]){
    const points=[];for(let z=175;z>=-175;z-=STEP)points.push({...sampleTerrain(terrain,x,z),x,z});
    roads.push({id:`G-${roads.length}`,kind:'grid',born:0,points});
  }
  const spine=[];for(let x=-150;x<=150;x+=STEP)spine.push({...sampleTerrain(terrain,x,175),x,z:175});
  roads.push({id:'G-spine',kind:'grid',born:0,points:spine});
  const plots=[];for(let z=145;z>=-155;z-=30)for(const x of [-135,-85,-35,15,65,115,165])plots.push({x,z});
  // Fill near the entrance first, a regular row at a time.
  for(const p of plots){if(buildings.length>=config.count)break;if(footprintSamples(p).some(q=>inWater(q.x,q.z,3)))continue;
    const entry={x:p.x-10,z:p.z},near=nearestRoad({x:p.x-15,z:p.z},roads).point;
    const points=[];for(let x=near.x;x<=entry.x;x+=STEP)points.push({x,z:entry.z,...sampleTerrain(terrain,x,entry.z)});
    const b={id:`GB-${buildings.length+1}`,...p,height:sampleTerrain(terrain,p.x,p.z).height,entry:{...entry,height:sampleTerrain(terrain,entry.x,entry.z).height},width:10,depth:8,floors:2,born:buildings.length+1};
    buildings.push(b);roads.push({id:`G-access-${b.born}`,kind:'access',born:b.born,points});
  }
  return {buildings,roads,metrics:measureVillage(terrain,buildings,roads,config)};
}
function generateLayout(options={},mode='adaptive'){
  const config={seed:42,count:50,maxSlope:22,maxRoadGrade:.32,...options};
  if(!Number.isInteger(config.seed)||config.seed<0||config.seed>1e9)throw Error('种子须为 0–1000000000 的整数');
  if(!Number.isInteger(config.count)||config.count<10||config.count>70)throw Error('建筑数量须为 10–70');
  if(!Number.isFinite(config.maxSlope)||config.maxSlope<10||config.maxSlope>30)throw Error('坡度上限须为 10–30°');
  if(!Number.isFinite(config.maxRoadGrade)||config.maxRoadGrade<.15||config.maxRoadGrade>.45)throw Error('道路纵坡上限须为 0.15–0.45');
  const terrain=makeTerrain(config.seed),rng=random(config.seed+(mode==='slope-random'?1337:0)),buildings=[],roads=[],events=[];
  const entrance={x:0,z:180},center={x:0,z:0};
  const trunk=findPath(terrain,entrance,center,[],config.maxRoadGrade);
  if(!trunk)throw Error('当前约束下无法建立初始山路');
  roads.push({id:'V-main',kind:'main',born:0,points:trunk});
  let attempts=0;
  while(buildings.length<config.count&&attempts<config.count*12){
    attempts++;
    const candidates=[];
    for(let trial=0;trial<180;trial++){
      const p={x:Math.round((rng()*350-175)/STEP)*STEP,z:Math.round((rng()*350-175)/STEP)*STEP};
      p.rotation=contourRotation(terrain,p,sampleTerrain);
      if(!plotValid(terrain,p,config.maxSlope)||buildings.some(b=>distance(p,b)<22)||!roadClear(p,roads,13))continue;
      const nearest=nearestRoad(p,roads),s=sampleTerrain(terrain,p.x,p.z);
      if(mode==='adaptive'&&nearest.distance>95)continue;
      const neighbor=buildings.length?Math.min(...buildings.map(b=>distance(p,b))):35;
      const score=mode==='slope-random'?rng():.38*(1-s.slope/config.maxSlope)+.28*Math.exp(-nearest.distance/50)
        +.20*Math.exp(-distance(p,center)/140)+.14*Math.exp(-1*((neighbor-30)/32)**2)+rng()*.06;
      candidates.push({p,nearest,score});
    }
    candidates.sort((a,b)=>b.score-a.score);
    for(const candidate of candidates.slice(0,14)){
      const {p,nearest,score}=candidate;
      // Entry sits 15m towards the nearest network vertex, outside the building exclusion disk.
      const angle=Math.atan2(nearest.point.z-p.z,nearest.point.x-p.x);
      const entry={x:Math.round((p.x+15*Math.cos(angle))/STEP)*STEP,z:Math.round((p.z+15*Math.sin(angle))/STEP)*STEP};
      const path=findPath(terrain,nearest.point,entry,[...buildings,p],config.maxRoadGrade);
      if(!path||path.length<2)continue;
      // Continuous clearance check after grid search (not just node occupancy).
      if([...buildings,p].some(b=>path.slice(1).some((q,i)=>segmentDistance(b,path[i],q)<HOUSE_RADIUS+ROAD_HALF+1)))continue;
      const born=buildings.length+1,id=`V-${born}`;
      const building={id,...p,height:sampleTerrain(terrain,p.x,p.z).height,width:10,depth:8,floors:rng()>.65?3:2,
        entry:point(terrain,index(entry.x,entry.z)),born,score:round(score),siteSlope:sampleTerrain(terrain,p.x,p.z).slope};
      const road={id:`V-access-${born}`,kind:'access',born,points:path};
      buildings.push(building);roads.push(road);
      events.push({step:born,buildingId:id,roadId:road.id,reason:`坡度 ${building.siteSlope}°，兴趣评分 ${round(score)}，新增接路 ${round(path.slice(1).reduce((s,q,i)=>s+distance(q,path[i]),0))}m`});
      break;
    }
  }
  const parcels=attachHouseholds(terrain,buildings,roads,config,sampleTerrain);
  return {version:2,model:mode==='adaptive'?'mountain-households-v2':'slope-random-households-v2',config,terrain,entrance,center,buildings,roads,events,parcels,
    metrics:measureVillage(terrain,buildings,roads,config),
    status:buildings.length===config.count?'complete':'capacity-limited'};
}
export function generateVillage(options={}){
  const scene=generateLayout(options);
  scene.baseline=makeBaseline(scene.terrain,scene.config);
  scene.slopeBaseline=generateLayout(options,'slope-random');
  return scene;
}
export function validateVillage(scene){
  const errors=validateHouseholds(scene),{terrain,buildings,roads,config}=scene;
  for(const b of buildings){
    if(!plotValid(terrain,b,config.maxSlope))errors.push(`${b.id}: 地块越界、水域或坡度超限`);
    if(!roadClear(b,roads))errors.push(`${b.id}: 道路侵入建筑`);
  }
  for(let i=0;i<buildings.length;i++)for(let j=i+1;j<buildings.length;j++)if(distance(buildings[i],buildings[j])<22-1e-6)errors.push('建筑间距不足');
  const connected=new Set([index(scene.entrance.x,scene.entrance.z)]);
  // Roads are chronological: each new path must begin at an existing network node.
  for(const road of roads){
    if(!connected.has(index(road.points[0].x,road.points[0].z)))errors.push(`${road.id}: 未接入入口网络`);
    for(const p of road.points){if(inWater(p.x,p.z,ROAD_HALF))errors.push(`${road.id}: 进入水域`);connected.add(index(p.x,p.z));}
  }
  const m=measureVillage(terrain,buildings,roads,config);
  if(m.unconnected)errors.push('建筑入口未接路');if(m.steepRoadLength>.001)errors.push('道路纵坡超限');
  if(m.waterRoadLength>.001)errors.push('道路穿越水域');
  return {valid:errors.length===0,errors};
}
