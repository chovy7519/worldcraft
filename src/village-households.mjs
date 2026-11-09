/** Bounded anisotropic raster conquest and terrain-responsive households. */
export const PARCEL_STEP=2.5;
const SIDE=160,COUNT=SIDE*SIDE;
const rd=v=>Math.round(v*1000)/1000;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const key=(x,z)=>`${x},${z}`;
const cellIndex=p=>Math.floor((p.z+200)/PARCEL_STEP)*SIDE+Math.floor((p.x+200)/PARCEL_STEP);
const center=i=>({x:(i%SIDE+.5)*PARCEL_STEP-200,z:(Math.floor(i/SIDE)+.5)*PARCEL_STEP-200});
function neighbors(i){const x=i%SIDE,z=Math.floor(i/SIDE);return [[1,0],[-1,0],[0,1],[0,-1]].flatMap(([dx,dz])=>x+dx>=0&&x+dx<SIDE&&z+dz>=0&&z+dz<SIDE?[(z+dz)*SIDE+x+dx]:[]);}
export function localPoint(b,u,v){const a=b.rotation??0,c=Math.cos(a),s=Math.sin(a);return {x:rd(b.x+u*c-v*s),z:rd(b.z+u*s+v*c)};}
export function buildingFootprint(b){return [[-5,-4],[5,-4],[5,4],[-5,4]].map(([u,v])=>localPoint(b,u,v));}
export function contourRotation(terrain,p,sample,entry){
  const dx=(sample(terrain,p.x+1,p.z).height-sample(terrain,p.x-1,p.z).height)/2;
  const dz=(sample(terrain,p.x,p.z+1).height-sample(terrain,p.x,p.z-1).height)/2;
  let a=Math.hypot(dx,dz)>.01?Math.atan2(dx,-dz):entry?Math.atan2(entry.z-p.z,entry.x-p.x)-Math.PI/2:0;
  if(entry&&-(entry.x-p.x)*Math.sin(a)+(entry.z-p.z)*Math.cos(a)<0)a+=Math.PI;
  return a;
}
function segdist(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l)):0;return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
class Queue{
  data=[];
  push(q){let i=this.data.length;this.data.push(q);while(i){const p=(i-1)>>1;if(this.data[p].cost<=q.cost)break;this.data[i]=this.data[p];i=p;}this.data[i]=q;}
  pop(){const q=this.data[0],v=this.data.pop();if(this.data.length){let i=0;while(i*2+1<this.data.length){let k=i*2+1;if(k+1<this.data.length&&this.data[k+1].cost<this.data[k].cost)k++;if(this.data[k].cost>=v.cost)break;this.data[i]=this.data[k];i=k;}this.data[i]=v;}return q;}
}
function cellPolygon(i){const x=(i%SIDE)*PARCEL_STEP-200,z=Math.floor(i/SIDE)*PARCEL_STEP-200;return [[x,z],[x+PARCEL_STEP,z],[x+PARCEL_STEP,z+PARCEL_STEP],[x,z+PARCEL_STEP]];}
function boundary(cellIds){
  const edges=new Map();
  for(const i of cellIds){const poly=cellPolygon(i);for(let k=0;k<4;k++){const a=poly[k],b=poly[(k+1)%4],rev=`${key(...b)}>${key(...a)}`;
    if(edges.has(rev))edges.delete(rev);else edges.set(`${key(...a)}>${key(...b)}`,{a,b});}}
  const next=new Map();for(const e of edges.values()){const k=key(...e.a);if(!next.has(k))next.set(k,[]);next.get(k).push(e);}
  const seen=new Set(),rings=[];
  for(const first of edges.values()){
    if(seen.has(first))continue;let e=first,ring=[];
    while(e&&!seen.has(e)){seen.add(e);ring.push(e.a);const options=(next.get(key(...e.b))??[]).filter(v=>!seen.has(v));
      const dx=e.b[0]-e.a[0],dz=e.b[1]-e.a[1];
      options.sort((u,v)=>Math.atan2(dx*(u.b[1]-u.a[1])-dz*(u.b[0]-u.a[0]),dx*(u.b[0]-u.a[0])+dz*(u.b[1]-u.a[1]))-Math.atan2(dx*(v.b[1]-v.a[1])-dz*(v.b[0]-v.a[0]),dx*(v.b[0]-v.a[0])+dz*(v.b[1]-v.a[1])));
      e=options[0];
    }
    if(ring.length>2)rings.push(ring);
  }
  return rings;
}
function routeWithin(ids,start,end){
  const allowed=new Set(ids),s=cellIndex(start),g=cellIndex(end),prev=new Map([[s,-1]]),queue=[s];
  for(let at=0;at<queue.length;at++){const i=queue[at];if(i===g)break;for(const j of neighbors(i))if(allowed.has(j)&&!prev.has(j)){prev.set(j,i);queue.push(j);}}
  if(!prev.has(g))return null;const path=[];for(let i=g;i!==-1;i=prev.get(i))path.push(center(i));
  return path.reverse();
}
export function parcelContains(parcel,p){
  // Include shared boundary: door/gate and footprint containment use the same raster facts.
  return parcel.cells.some(poly=>p.x>=poly[0][0]-1e-5&&p.x<=poly[2][0]+1e-5&&p.z>=poly[0][1]-1e-5&&p.z<=poly[2][1]+1e-5);
}
export function attachHouseholds(terrain,buildings,roads,config,sample){
  if(!buildings.length)return [];
  const roadMask=new Uint8Array(COUNT),blocked=new Uint8Array(COUNT),heights=new Float64Array(COUNT),fixed=new Int16Array(COUNT).fill(-1);
  const own=new Int16Array(COUNT).fill(-1),costs=new Float64Array(COUNT).fill(Infinity),heap=new Queue();
  // Rasterize only local segment bounding boxes instead of testing every cell against every road.
  for(const road of roads)for(let k=1;k<road.points.length;k++){
    const a=road.points[k-1],b=road.points[k],margin=4.5;
    const x0=Math.max(0,Math.floor((Math.min(a.x,b.x)-margin+200)/PARCEL_STEP)),x1=Math.min(SIDE-1,Math.floor((Math.max(a.x,b.x)+margin+200)/PARCEL_STEP));
    const z0=Math.max(0,Math.floor((Math.min(a.z,b.z)-margin+200)/PARCEL_STEP)),z1=Math.min(SIDE-1,Math.floor((Math.max(a.z,b.z)+margin+200)/PARCEL_STEP));
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const i=z*SIDE+x;if(segdist(center(i),a,b)<3.4)roadMask[i]=1;}
  }
  for(let i=0;i<COUNT;i++){const p=center(i),t=sample(terrain,p.x,p.z);heights[i]=t.height;
    const wet=cellPolygon(i).some(([x,z])=>sample(terrain,x,z).water);
    blocked[i]=roadMask[i]||wet||Math.abs(p.x)>190||Math.abs(p.z)>190?1:0;
  }
  for(const [owner,b] of buildings.entries()){
    b.rotation=contourRotation(terrain,b,sample,b.entry);b.footprint=buildingFootprint(b);b.parcelId=`P-${b.id}`;
    const c=Math.cos(b.rotation),s=Math.sin(b.rotation),door=localPoint(b,0,4);
    b.door={...door,height:sample(terrain,door.x,door.z).height};
    for(let i=0;i<COUNT;i++){
      const p=center(i);if(dist(p,b)>23)continue;
      const u=(p.x-b.x)*c+(p.z-b.z)*s,v=-(p.x-b.x)*s+(p.z-b.z)*c;
      const footprint=Math.abs(u)<7.1&&Math.abs(v)<6.1;
      const approach=segdist(p,b,b.entry)<2.4&&dist(p,b.entry)>3;
      if(!blocked[i]&&(footprint||approach)){
        if(fixed[i]!==-1&&fixed[i]!==owner)throw Error('宅地保留区域发生冲突');
        fixed[i]=owner;own[i]=owner;costs[i]=0;heap.push({i,owner,cost:0});
      }
    }
  }
  while(heap.data.length){const q=heap.pop();if(own[q.i]!==q.owner||costs[q.i]!==q.cost)continue;
    const b=buildings[q.owner],a=center(q.i);
    for(const j of neighbors(q.i)){
      if(blocked[j]||(fixed[j]>=0&&fixed[j]!==q.owner))continue;
      const p=center(j);if(dist(p,b)>30)continue;
      const dx=p.x-a.x,dz=p.z-a.z,along=Math.abs((dx*Math.cos(b.rotation)+dz*Math.sin(b.rotation))/PARCEL_STEP);
      const grade=Math.abs(heights[j]-heights[q.i])/PARCEL_STEP;
      const cost=q.cost+PARCEL_STEP*(1+.45*(1-along)+3*grade);
      if(cost>=costs[j]||cost>29)continue;
      costs[j]=cost;own[j]=q.owner;heap.push({i:j,owner:q.owner,cost});
    }
  }
  const parcels=[];
  for(const [owner,b] of buildings.entries()){
    // Keep only the four-connected component containing this home; no detached islands.
    const seed=cellIndex(b),visited=new Set([seed]),ids=[seed];
    for(let k=0;k<ids.length;k++)for(const j of neighbors(ids[k]))if(own[j]===owner&&!visited.has(j)){visited.add(j);ids.push(j);}
    ids.sort((a,b)=>a-b);
    const frontage=[];
    for(const i of ids){const poly=cellPolygon(i),ix=i%SIDE,iz=Math.floor(i/SIDE);
      for(const [dx,dz,edge] of [[0,-1,0],[1,0,1],[0,1,2],[-1,0,3]]){
        const nx=ix+dx,nz=iz+dz;if(nx<0||nx>=SIDE||nz<0||nz>=SIDE||!roadMask[nz*SIDE+nx])continue;
        frontage.push({a:poly[edge],b:poly[(edge+1)%4],cellId:i});
      }
    }
    if(!frontage.length)throw Error(`${b.id}: 宅地未接触道路`);
    const gateEdge=[...frontage].sort((u,v)=>dist({x:(u.a[0]+u.b[0])/2,z:(u.a[1]+u.b[1])/2},b.entry)-dist({x:(v.a[0]+v.b[0])/2,z:(v.a[1]+v.b[1])/2},b.entry))[0];
    const gate={x:(gateEdge.a[0]+gateEdge.b[0])/2,z:(gateEdge.a[1]+gateEdge.b[1])/2};
    const path=routeWithin(ids,b.door,center(gateEdge.cellId));if(!path)throw Error(`${b.id}: 入户路径不连通`);
    b.gate={...gate,height:sample(terrain,gate.x,gate.z).height};
    b.walkway=[b.door,...path.map(p=>({...p,height:sample(terrain,p.x,p.z).height})),b.gate];
    b.roadConnection=[b.gate,b.entry];
    b.foundation=[];
    const parcelCells=ids.map(cellPolygon),ownParcel={cells:parcelCells};
    // Three bands across the slope: independent heights create a stepped plinth.
    for(let k=0;k<3;k++){
      const v0=-4+k*8/3,v1=-4+(k+1)*8/3;
      let points;
      for(const halfWidth of [6,5.5,5]){
        points=[localPoint(b,-halfWidth,v0),localPoint(b,halfWidth,v0),localPoint(b,halfWidth,v1),localPoint(b,-halfWidth,v1)];
        if(points.every(p=>parcelContains(ownParcel,p)))break;
      }
      const groundHeights=points.map(p=>sample(terrain,p.x,p.z).height);
      b.foundation.push({points,groundHeights,top:rd(Math.max(...groundHeights)+.35)});
    }
    b.floorHeight=rd(Math.max(...b.foundation.map(f=>f.top))+.2);
    b.door.floorHeight=b.floorHeight;
    // Raise the first metres of the approach into explicit stair treads up to the door.
    let walkDistance=0;
    for(let k=0;k<b.walkway.length;k++){
      if(k)walkDistance+=dist(b.walkway[k-1],b.walkway[k]);
      const p=b.walkway[k],ground=sample(terrain,p.x,p.z).height;
      p.height=rd(Math.max(ground+.05,b.floorHeight-walkDistance*.55));
    }
    b.entrySteps=b.walkway.slice(1).flatMap((p,i)=>{
      const a=b.walkway[i],rise=a.height-p.height;if(rise<.12)return [];
      const n=Math.ceil(rise/.18);return Array.from({length:n},(_,k)=>{
        const t=(k+.5)/n;return {x:rd(a.x+(p.x-a.x)*t),z:rd(a.z+(p.z-a.z)*t),height:rd(a.height-rise*(k+1)/n)};
      });
    });
    parcels.push({id:b.parcelId,buildingId:b.id,born:b.born,step:PARCEL_STEP,cellIds:ids,cells:parcelCells,rings:boundary(ids),
      area:ids.length*PARCEL_STEP**2,frontage,frontageLength:rd(frontage.length*PARCEL_STEP),gate:b.gate,enclosure:{height:.7,gateWidth:2.5}});
  }
  return parcels;
}
export function validateHouseholds(scene){
  const errors=[],occupied=new Set(),parcels=scene.parcels??[];
  if(parcels.length!==scene.buildings.length)errors.push('住宅与宅地数量不一致');
  for(const p of parcels){for(const i of p.cellIds){if(occupied.has(i))errors.push(`${p.id}: 宅地单元重复`);occupied.add(i);}
    if(p.area!==p.cellIds.length*PARCEL_STEP**2)errors.push(`${p.id}: 宅地面积不一致`);
    const cells=new Set(p.cellIds),visited=new Set([p.cellIds[0]]),queue=[p.cellIds[0]];
    for(let k=0;k<queue.length;k++)for(const j of neighbors(queue[k]))if(cells.has(j)&&!visited.has(j)){visited.add(j);queue.push(j);}
    if(visited.size!==cells.size)errors.push(`${p.id}: 宅地不连通`);
    if(!p.frontage.length)errors.push(`${p.id}: 无临路边`);
    if(p.cells.length!==p.cellIds.length)errors.push(`${p.id}: 宅地几何单元不一致`);
  }
  for(const b of scene.buildings){const p=parcels.find(p=>p.id===b.parcelId&&p.buildingId===b.id);
    if(!p){errors.push(`${b.id}: 缺少所属宅地`);continue;}
    const samples=[...(b.footprint??[]),...(b.walkway??[]),...(b.foundation??[]).flatMap(f=>f.points)];
    for(const path of [b.footprint??[],b.walkway??[]])for(let i=1;i<path.length;i++){
      const a=path[i-1],q=path[i],n=Math.max(1,Math.ceil(dist(a,q)/.5));
      for(let k=1;k<n;k++)samples.push({x:a.x+(q.x-a.x)*k/n,z:a.z+(q.z-a.z)*k/n});
    }
    for(const q of samples)if(!parcelContains(p,q))errors.push(`${b.id}: 房屋或步道越出宅地`);
    if(!b.walkway?.length||dist(b.walkway[0],b.door)>.01||dist(b.walkway.at(-1),b.gate)>.01)errors.push(`${b.id}: 入户路径端点错误`);
    if(!b.foundation?.length||b.foundation.some(f=>f.top<Math.max(...f.groundHeights)))errors.push(`${b.id}: 基础埋入地形`);
  }
  return errors;
}
