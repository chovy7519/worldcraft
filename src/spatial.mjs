/** WorldCraft V0.3: pure deterministic, axis-aligned spatial PCG pipeline.
 * Local metric X/Z plane. All stages consume upstream artifacts, not rendered meshes.
 */
export const STAGE_DEPENDENCIES = Object.freeze([
  {id:'roads',dependsOn:['seed'],produces:['roads','roadLines'],extensionInputs:['terrain.heightField','hydrology.exclusionZones']},
  {id:'parcels',dependsOn:['roads'],produces:['blocks','parcels']},
  {id:'landuse',dependsOn:['parcels'],produces:['assignedParcels']},
  {id:'buildings',dependsOn:['landuse'],produces:['buildings']},
  {id:'parks',dependsOn:['landuse','buildings'],produces:['parks']},
  {id:'trees',dependsOn:['roads','parcels','buildings','parks'],produces:['trees']},
  {id:'instances',dependsOn:['roads','parcels','landuse','buildings','parks','trees'],produces:['scene']}
]);
export const EXTENSION_SLOTS = Object.freeze({
  terrain:{status:'reserved',stage:'before-roads',interface:'heightField(x,z) => height in meters'},
  hydrology:{status:'reserved',stage:'before-roads',interface:'protectedPolygons[] + waterSurfaceElevation'}
});
const EPS=1e-7;
const round=n=>Number(n.toFixed(5));
const rect=(x0,z0,x1,z1)=>({x0:round(x0),z0:round(z0),x1:round(x1),z1:round(z1)});
const area=b=>(b.x1-b.x0)*(b.z1-b.z0);
const center=b=>({x:round((b.x0+b.x1)/2),z:round((b.z0+b.z1)/2)});
export function overlapArea(a,b){return Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.z1,b.z1)-Math.max(a.z0,b.z0));}
export function diskIntersectsRect(x,z,r,b){
  const dx=x-Math.max(b.x0,Math.min(x,b.x1));const dz=z-Math.max(b.z0,Math.min(z,b.z1));
  return dx*dx+dz*dz < (r-EPS)*(r-EPS);
}
function within(point,b,margin=0){return point.x>=b.x0+margin-EPS && point.x<=b.x1-margin+EPS && point.z>=b.z0+margin-EPS && point.z<=b.z1-margin+EPS;}
function stableFloat(seed,part,row,channel,rng){return rng(seed,part,row,channel);}
function parkClass(a,world){return a<world.parkSmallMaxArea?'small':a<world.parkLargeMinArea?'medium':'large';}
function frontage(parcel,roads){
  return roads.filter(r=>{
    const b=r.bounds, p=parcel.bounds;
    const xOverlap=Math.min(p.x1,b.x1)-Math.max(p.x0,b.x0);
    const zOverlap=Math.min(p.z1,b.z1)-Math.max(p.z0,b.z0);
    return ((Math.abs(p.x0-b.x1)<EPS||Math.abs(p.x1-b.x0)<EPS)&&zOverlap>EPS) ||
      ((Math.abs(p.z0-b.z1)<EPS||Math.abs(p.z1-b.z0)<EPS)&&xOverlap>EPS);
  }).map(r=>r.id);
}
/** Build non-overlapping rectilinear carriageway strips, one connected crossing system. */
function makeRoads(world,features){
  const s=world.size,half=s/2,spacing=world.roadSpacing,width=world.roadWidth;
  const centers=[];
  for(let v=-half+spacing/2;v<half-EPS;v+=spacing)centers.push(round(v));
  const lanes=centers.map((coordinate,i)=>({coordinate,width:(features.promenade!==false && Math.abs(coordinate)===Math.min(...centers.map(v=>Math.abs(v))))?Math.max(width,world.promenadeWidth):width,id:i}));
  const roads=[],roadLines=[];
  // Vertical corridors own all intersection pixels. Horizontal roads are clipped at vertical boundaries.
  for(const v of lanes){
    const bounds=rect(v.coordinate-v.width/2,-half,v.coordinate+v.width/2,half);
    roads.push({id:`R-V-${v.id}`,orientation:'NS',kind:v.width>width?'promenade':'street',bounds,...center(bounds),width:v.width,depth:s,area:area(bounds)});
    roadLines.push({id:`RL-V-${v.id}`,from:[v.coordinate,-half],to:[v.coordinate,half],kind:v.width>width?'promenade':'street'});
  }
  const xs=[-half,...lanes.flatMap(v=>[v.coordinate-v.width/2,v.coordinate+v.width/2]),half];
  const gaps=[];for(let i=0;i<xs.length-1;i+=2)if(xs[i+1]-xs[i]>EPS)gaps.push([xs[i],xs[i+1]]);
  for(const h of lanes){
    roadLines.push({id:`RL-H-${h.id}`,from:[-half,h.coordinate],to:[half,h.coordinate],kind:h.width>width?'promenade':'street'});
    for(let i=0;i<gaps.length;i++){
      const [x0,x1]=gaps[i],b=rect(x0,h.coordinate-h.width/2,x1,h.coordinate+h.width/2);
      roads.push({id:`R-H-${h.id}-${i}`,orientation:'EW',kind:h.width>width?'promenade':'street',bounds:b,...center(b),width:x1-x0,depth:h.width,area:area(b)});
    }
  }
  return {roads,roadLines,lanes};
}
function makeParcels(world,roadsStage,rng){
  const half=world.size/2;
  const roads=roadsStage.roads;
  const vertical=roads.filter(r=>r.orientation==='NS').map(r=>r.bounds).sort((a,b)=>a.x0-b.x0);
  const horizontal=roads.filter(r=>r.orientation==='EW').map(r=>r.bounds).sort((a,b)=>a.z0-b.z0);
  const xRange=[],zRange=[];
  let cursor=-half;
  for(const b of vertical){if(b.x0-cursor>EPS)xRange.push([cursor,b.x0]);cursor=b.x1;}
  if(half-cursor>EPS)xRange.push([cursor,half]);
  cursor=-half;
  const zStrips=[...new Map(horizontal.map(b=>[`${b.z0},${b.z1}`,b])).values()].sort((a,b)=>a.z0-b.z0);
  for(const b of zStrips){if(b.z0-cursor>EPS)zRange.push([cursor,b.z0]);cursor=b.z1;}
  if(half-cursor>EPS)zRange.push([cursor,half]);
  const blocks=[],parcels=[];
  for(let iz=0;iz<zRange.length;iz++)for(let ix=0;ix<xRange.length;ix++){
    const bounds=rect(xRange[ix][0],zRange[iz][0],xRange[ix][1],zRange[iz][1]);
    const blockId=`BL-${iz}-${ix}`,w=bounds.x1-bounds.x0,d=bounds.z1-bounds.z0;
    blocks.push({id:blockId,bounds,area:area(bounds)});
    // Alternate stripe direction by block; every parcel keeps road frontage on a block edge.
    const splitX=w>=d;
    const maxSize=splitX?w:d;
    const target=world.parcelTargetWidth;
    const nominal=Math.max(1,Math.round(maxSize/target));
    const variation=rng(world.seed,ix,iz,51)>.70?1:rng(world.seed,ix,iz,52)<.20?-1:0;
    const count=Math.max(1,Math.min(5,nominal+variation,Math.floor(maxSize/Math.max(16,world.buildingSetback*3))));
    for(let j=0;j<count;j++){
      const start=j/count,end=(j+1)/count;
      const p=splitX?rect(bounds.x0+w*start,bounds.z0,bounds.x0+w*end,bounds.z1):rect(bounds.x0,bounds.z0+d*start,bounds.x1,bounds.z0+d*end);
      if(area(p)<EPS)continue;
      const id=`L-${iz}-${ix}-${j}`,c=center(p);
      const record={id,blockId,bounds:p,...c,width:p.x1-p.x0,depth:p.z1-p.z0,area:area(p),frontageIds:[]};
      record.frontageIds=frontage(record,roads);
      parcels.push(record);
    }
  }
  return {blocks,parcels};
}
function assignLanduse(world,parcels,features,rng){
  const assigned=parcels.map((p,i)=>{
    const distance=Math.hypot(p.x,p.z);
    const cRank=(p.id.match(/\d+/g)||[]).map(Number);
    const r=rng(world.seed,cRank[1],cRank[0]*7+cRank[2],71);
    let use='residential';
    if(features.plaza!==false && distance<world.plazaRadius && p.area>450)use='park';
    else if(r<world.parkShare)use='park';
    else if(distance<world.size*.29 && r<world.parkShare+.28)use='commercial';
    else if(r>0.91)use='civic';
    return {...p,use,parkClass:use==='park'?parkClass(p.area,world):null};
  });
  // Guarantee a representative size range where possible without converting every lot to park.
  // Promoted lots are deterministically chosen and keep their stable parcel IDs.
  if(world.parkShare>0){
    const classes=['small','medium','large'];
    for(const cls of classes){
      if(assigned.some(p=>p.use==='park'&&p.parkClass===cls))continue;
      const options=assigned.filter(p=>p.use!=='park'&&parkClass(p.area,world)===cls);
      if(options.length){
        const selected=options.map(p=>({p,r:rng(world.seed,p.x|0,p.z|0,72)})).sort((a,b)=>a.r-b.r||a.p.id.localeCompare(b.p.id))[0].p;
        selected.use='park';selected.parkClass=cls;
      }
    }
  }
  return assigned;
}
function makeBuildings(world,assigned,features,rng){
  const buildings=[];
  for(const p of assigned){
    if(p.use==='park')continue;
    const east=p.x>=0;
    const probability=east?world.eastDensity:world.westDensity;
    const [r,c,j]=(p.id.match(/\d+/g)||[]).map(Number);
    if(rng(world.seed,c,j+r*13,81)>=probability)continue;
    const setback=world.buildingSetback;
    const availableW=p.width-2*setback,availableD=p.depth-2*setback;
    if(availableW<7||availableD<7)continue;
    const width=round(Math.min(availableW,9+availableW*(.48+rng(world.seed,c,r*17+j,82)*.22)));
    const depth=round(Math.min(availableD,9+availableD*(.48+rng(world.seed,c,r*17+j,83)*.22)));
    const distance=Math.hypot(p.x,p.z);
    const centerFactor=Math.max(0,1-distance/(world.size*.75));
    const hNoise=rng(world.seed,c,r*17+j,84);
    const type=p.use==='commercial'?'commercial':p.use==='civic'?'civic':hNoise>.70?'tower':hNoise>.40?'terraced':'slab';
    const rawHeight=p.use==='civic'?9+10*hNoise:p.use==='commercial'?22+65*centerFactor+22*hNoise:12+82*centerFactor*(.7+hNoise*.6);
    const height=round(rawHeight*(features.height===false?1:world.heightScale));
    const bounds=rect(p.x-width/2,p.z-depth/2,p.x+width/2,p.z+depth/2);
    buildings.push({id:`B-${p.id}`,parcelId:p.id,blockId:p.blockId,region:east?'东侧':'西侧',use:p.use,type,
      x:p.x,z:p.z,width,depth,height,footprint:round(width*depth),bounds,tone:rng(world.seed,c,r*17+j,85)});
  }
  return buildings;
}
function makeParks(assigned){return assigned.filter(p=>p.use==='park').map(p=>({
  id:`P-${p.id}`,parcelId:p.id,kind:p.parkClass,bounds:p.bounds,x:p.x,z:p.z,width:p.width,depth:p.depth,area:p.area
}));}
function makeTrees(world,assigned,roads,buildings,parks,rng){
  const trees=[],occupied=[];
  const radius=world.treeCrownRadius;
  const allBuildings=buildings.map(b=>b.bounds);
  const add=(id,x,z,kind,parcel)=>{
    const point={x:round(x),z:round(z)};
    if(!within(point,parcel.bounds,radius+.3))return;
    if(roads.some(r=>diskIntersectsRect(point.x,point.z,radius,r.bounds)))return;
    if(allBuildings.some(b=>diskIntersectsRect(point.x,point.z,radius+world.treeBuildingClearance,b)))return;
    if(occupied.some(t=>Math.hypot(point.x-t.x,point.z-t.z)<2*radius+.3))return;
    trees.push({id,x:point.x,z:point.z,kind,parcelId:parcel.id,height:round(3.5+rng(world.seed,point.x|0,point.z|0,94)*3.5),crownRadius:radius});
    occupied.push(point);
  };
  for(const p of assigned){
    // Street trees are only placed along verified road-facing parcel boundaries.
    const edges=[];
    if(p.frontageIds.length){
      const b=p.bounds,setback=world.treeRoadSetback;
      for(const road of roads.filter(r=>p.frontageIds.includes(r.id))){
        const q=road.bounds;
        if(Math.abs(b.z0-q.z1)<EPS||Math.abs(b.z1-q.z0)<EPS){
          const z=Math.abs(b.z0-q.z1)<EPS?b.z0+setback:b.z1-setback;
          edges.push({axis:'x',constant:z,min:Math.max(b.x0,q.x0),max:Math.min(b.x1,q.x1)});
        }
        if(Math.abs(b.x0-q.x1)<EPS||Math.abs(b.x1-q.x0)<EPS){
          const x=Math.abs(b.x0-q.x1)<EPS?b.x0+setback:b.x1-setback;
          edges.push({axis:'z',constant:x,min:Math.max(b.z0,q.z0),max:Math.min(b.z1,q.z1)});
        }
      }
    }
    for(const [idx,e] of edges.entries()){
      const length=e.max-e.min,n=Math.floor(length/world.treeSpacing);
      for(let k=0;k<n;k++){
        if(rng(world.seed,idx+k,p.x|0,95)>world.treeDensity)continue;
        const along=e.min+(k+.5)*length/n;
        add(`TS-${p.id}-${idx}-${k}`,e.axis==='x'?along:e.constant,e.axis==='z'?along:e.constant,'street',p);
      }
    }
    if(p.use!=='park')continue;
    // Park interior uses stable jittered grid, never the street strips or building geometry.
    const step=world.parkTreeSpacing;
    for(let zi=0;zi<Math.floor(p.depth/step);zi++)for(let xi=0;xi<Math.floor(p.width/step);xi++){
      if(rng(world.seed,xi+Math.round(p.x),zi+Math.round(p.z),96)>world.treeDensity*.83)continue;
      const x=p.bounds.x0+(xi+.5)*step+(rng(world.seed,xi,zi+Math.round(p.z),97)-.5)*step*.25;
      const z=p.bounds.z0+(zi+.5)*step+(rng(world.seed,xi+Math.round(p.x),zi,98)-.5)*step*.25;
      add(`TP-${p.id}-${xi}-${zi}`,x,z,'park',p);
    }
  }
  return trees;
}
export function generateSpatialCity(world,features,rng){
  const pipeline=[];
  const roadsStage=makeRoads(world,features);pipeline.push({stage:'roads',count:roadsStage.roads.length});
  const parcelStage=makeParcels(world,roadsStage,rng);pipeline.push({stage:'parcels',count:parcelStage.parcels.length});
  const parcels=assignLanduse(world,parcelStage.parcels,features,rng);pipeline.push({stage:'landuse',count:parcels.length});
  const buildings=makeBuildings(world,parcels,features,rng);pipeline.push({stage:'buildings',count:buildings.length});
  const parks=makeParks(parcels);pipeline.push({stage:'parks',count:parks.length});
  const trees=makeTrees(world,parcels,roadsStage.roads,buildings,parks,rng);pipeline.push({stage:'trees',count:trees.length});
  const footprint=buildings.reduce((sum,b)=>sum+b.footprint,0);
  const metrics={total:buildings.length,east:buildings.filter(b=>b.region==='东侧').length,west:buildings.filter(b=>b.region==='西侧').length,
    eastEligible:parcels.filter(p=>p.use!=='park'&&p.x>=0).length,westEligible:parcels.filter(p=>p.use!=='park'&&p.x<0).length,
    coverage:footprint/(world.size*world.size),avgHeight:buildings.length?buildings.reduce((s,b)=>s+b.height,0)/buildings.length:0,
    maxHeight:Math.max(0,...buildings.map(b=>b.height)),plazaArea:features.plaza===false?0:Math.PI*world.plazaRadius**2,
    roadSegments:roadsStage.roads.length,roadArea:roadsStage.roads.reduce((s,r)=>s+r.area,0),parcelCount:parcels.length,
    parkCount:parks.length,parkArea:parks.reduce((s,p)=>s+p.area,0),parkSizes:{small:parks.filter(p=>p.kind==='small').length,medium:parks.filter(p=>p.kind==='medium').length,large:parks.filter(p=>p.kind==='large').length},
    treeCount:trees.length,streetTrees:trees.filter(t=>t.kind==='street').length,parkTrees:trees.filter(t=>t.kind==='park').length,
    buildingUses:{residential:buildings.filter(b=>b.use==='residential').length,commercial:buildings.filter(b=>b.use==='commercial').length,civic:buildings.filter(b=>b.use==='civic').length}
  };
  return {world,features,roads:roadsStage.roads,roadLines:roadsStage.roadLines,blocks:parcelStage.blocks,parcels,buildings,parks,trees,pipeline,metrics,extensions:EXTENSION_SLOTS};
}
export function validateSpatialInvariants(scene){
  const errors=[],withinWorld=b=>b.x0>=-scene.world.size/2-EPS&&b.x1<=scene.world.size/2+EPS&&b.z0>=-scene.world.size/2-EPS&&b.z1<=scene.world.size/2+EPS;
  const checkExclusive=(a,b,label)=>{for(const x of a)for(const y of b)if(overlapArea(x.bounds,y.bounds)>EPS)errors.push(`${label}: ${x.id} / ${y.id}`);};
  for(const name of ['roads','parcels','buildings','parks'])for(const item of scene[name])if(!withinWorld(item.bounds))errors.push(`${name} ${item.id} 超出场地`);
  for(const name of ['roads','parcels','buildings','parks']){
    const items=scene[name];for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)if(overlapArea(items[i].bounds,items[j].bounds)>EPS)errors.push(`${name} 重叠 ${items[i].id}/${items[j].id}`);
  }
  // The carriageway network is connected by shared positive-length edges.
  const adjacent=(a,b)=>{
    const x=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0);
    const z=Math.min(a.z1,b.z1)-Math.max(a.z0,b.z0);
    return (x>EPS&&(Math.abs(a.z1-b.z0)<EPS||Math.abs(b.z1-a.z0)<EPS)) ||
      (z>EPS&&(Math.abs(a.x1-b.x0)<EPS||Math.abs(b.x1-a.x0)<EPS));
  };
  if(scene.roads.length){
    const visited=new Set([0]),stack=[0];
    while(stack.length){const i=stack.pop();for(let j=0;j<scene.roads.length;j++)if(!visited.has(j)&&adjacent(scene.roads[i].bounds,scene.roads[j].bounds)){visited.add(j);stack.push(j);}}
    if(visited.size!==scene.roads.length)errors.push(`道路网络不连通：${visited.size}/${scene.roads.length} 段`);
  }
  const assigned=new Map(scene.parcels.map(p=>[p.id,p]));
  for(const p of scene.parcels){if(!['residential','commercial','civic','park'].includes(p.use))errors.push(`地块功能未分配 ${p.id}`);}
  for(const b of scene.buildings)if(!assigned.has(b.parcelId)||assigned.get(b.parcelId).use!==b.use||b.use==='park')errors.push(`建筑功能引用无效 ${b.id}`);
  const parkIDs=new Set(scene.parks.map(p=>p.parcelId));
  for(const p of scene.parcels)if((p.use==='park')!==parkIDs.has(p.id))errors.push(`公园功能或实体不一致 ${p.id}`);
  const tiledArea=scene.roads.reduce((sum,r)=>sum+r.area,0)+scene.parcels.reduce((sum,p)=>sum+p.area,0);
  if(Math.abs(tiledArea-scene.world.size**2)>.01)errors.push(`道路和地块未覆盖整个场地：${tiledArea}`);
  checkExclusive(scene.roads,scene.parcels,'道路与地块重叠');checkExclusive(scene.roads,scene.buildings,'道路与建筑重叠');checkExclusive(scene.roads,scene.parks,'道路与公园重叠');
  checkExclusive(scene.buildings,scene.parks,'建筑与公园重叠');
  for(const b of scene.buildings){const p=scene.parcels.find(p=>p.id===b.parcelId);if(!p||!within({x:b.bounds.x0,z:b.bounds.z0},p.bounds)||!within({x:b.bounds.x1,z:b.bounds.z1},p.bounds))errors.push(`建筑不在地块内 ${b.id}`);}
  for(const p of scene.parcels)if(!p.frontageIds.length)errors.push(`地块缺少道路接入 ${p.id}`);
  for(const t of scene.trees){
    const parcel=scene.parcels.find(p=>p.id===t.parcelId);
    if(!parcel||!within(t,parcel.bounds,t.crownRadius))errors.push(`树木超出地块 ${t.id}`);
    if(scene.roads.some(r=>diskIntersectsRect(t.x,t.z,t.crownRadius,r.bounds)))errors.push(`树冠与道路冲突 ${t.id}`);
    if(scene.buildings.some(b=>diskIntersectsRect(t.x,t.z,t.crownRadius+scene.world.treeBuildingClearance,b.bounds)))errors.push(`树冠与建筑冲突 ${t.id}`);
  }
  for(let i=0;i<scene.trees.length;i++)for(let j=i+1;j<scene.trees.length;j++){
    const a=scene.trees[i],b=scene.trees[j];if(Math.hypot(a.x-b.x,a.z-b.z)<a.crownRadius+b.crownRadius-EPS)errors.push(`树冠交叠 ${a.id}/${b.id}`);
  }
  return {valid:errors.length===0,errors,checks:{roads:scene.roads.length,parcels:scene.parcels.length,buildings:scene.buildings.length,parks:scene.parks.length,trees:scene.trees.length}};
}
