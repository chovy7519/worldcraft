/** WorldCraft V0.4 experimental convex-polygon PCG for connected grid + oblique through-road.
 * Geometry is kept in local metric X/Z coordinates; all clipping is on convex polygons.
 * Deliberate scope: straight through-corridors, not arbitrary clipped cul-de-sacs or GIS routing.
 */
import {networkSegments} from './road-network.mjs';
export const GEOMETRY_MODEL = 'convex-polygons-v1';
export const EDITABLE_GEOMETRY_MODEL = 'editable-road-polygons-v1';
const EPS=1e-7;
const rn=n=>Math.round(n*1e6)/1e6;
const dot=(p,n)=>p[0]*n[0]+p[1]*n[1];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const lerp=(a,b,t)=>[rn(a[0]+(b[0]-a[0])*t),rn(a[1]+(b[1]-a[1])*t)];
export const polygonArea=p=>Math.abs(p.reduce((s,a,i)=>s+cross(a,p[(i+1)%p.length]),0)/2);
export function polygonCentroid(p){let sx=0,sz=0,w=0;for(let i=0;i<p.length;i++){let a=p[i],b=p[(i+1)%p.length],d=cross(a,b);sx+=(a[0]+b[0])*d;sz+=(a[1]+b[1])*d;w+=d;}return Math.abs(w)>EPS?[rn(sx/(3*w)),rn(sz/(3*w))]:[rn(p.reduce((a,v)=>a+v[0],0)/p.length),rn(p.reduce((a,v)=>a+v[1],0)/p.length)];}
export function polygonBounds(p){return {x0:Math.min(...p.map(v=>v[0])),x1:Math.max(...p.map(v=>v[0])),z0:Math.min(...p.map(v=>v[1])),z1:Math.max(...p.map(v=>v[1]))};}
const clean=p=>{
  let out=[];for(const v of p){const q=[rn(v[0]),rn(v[1])];if(!out.length||dist(out.at(-1),q)>1e-6)out.push(q);}
  if(out.length>1&&dist(out[0],out.at(-1))<1e-6)out.pop();
  if(out.length<3||polygonArea(out)<1e-6)return [];
  return out.filter((v,i)=>Math.abs(cross(sub(out[(i+1)%out.length],v),sub(out[(i+out.length-1)%out.length],v)))>1e-7);
};
/** Clip a convex polygon against n·point <= threshold. */
export function clipHalfPlane(poly,n,threshold){
  if(!poly?.length)return [];
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],va=dot(a,n)-threshold,vb=dot(b,n)-threshold;
    if(va<=EPS)out.push(a);
    if((va < -EPS&&vb>EPS)||(va>EPS&&vb < -EPS))out.push(lerp(a,b,va/(va-vb)));
  }
  return clean(out);
}
export function clipStrip(poly,n,c0,c1){return clipHalfPlane(clipHalfPlane(poly,n,c1),[-n[0],-n[1]],-c0);}
export function polygonIntersection(a,b){
  if(!a?.length||!b?.length)return [];
  let out=a;
  const sign=b.reduce((s,p,i)=>s+cross(p,b[(i+1)%b.length]),0)>=0?1:-1;
  for(let i=0;i<b.length;i++){
    let v=b[i],w=b[(i+1)%b.length],d=sub(w,v),n=[sign*d[1],-sign*d[0]];
    out=clipHalfPlane(out,n,dot(v,n));if(!out.length)return [];
  }
  return out;
}
export function containsPoint(poly,p,margin=0){
  if(!poly?.length)return false;
  const sign=poly.reduce((s,v,i)=>s+cross(v,poly[(i+1)%poly.length]),0)>=0?1:-1;
  return poly.every((v,i)=>{const w=poly[(i+1)%poly.length],d=sub(w,v),len=Math.hypot(...d);return sign*cross(d,sub(p,v))>=margin*len-EPS;});
}
export function insetPolygon(poly,margin){
  if(!poly.length)return [];
  let out=poly;
  const sign=poly.reduce((s,v,i)=>s+cross(v,poly[(i+1)%poly.length]),0)>=0?1:-1;
  for(let i=0;i<poly.length;i++){
    let a=poly[i],b=poly[(i+1)%poly.length],d=sub(b,a),len=Math.hypot(...d);if(len<EPS)continue;
    const n=[sign*d[1]/len,-sign*d[0]/len];
    out=clipHalfPlane(out,n,dot(a,n)-margin);
    if(!out.length)return [];
  }
  return out;
}
function segmentDistance(p,a,b){const d=sub(b,a),len=dot(d,d);const t=len===0?0:Math.max(0,Math.min(1,dot(sub(p,a),d)/len));return dist(p,lerp(a,b,t));}
export function circlePolygonConflict(p,r,poly){return containsPoint(poly,p)||poly.some((a,i)=>segmentDistance(p,a,poly[(i+1)%poly.length]) < r-EPS);}
export function polygonsOverlap(a,b){return polygonArea(polygonIntersection(a,b))>1e-4;}
function commonEdge(a,b){
  const result=[];
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length],u=sub(q,p),v=sub(s,r),uLen=Math.hypot(...u);
    if(uLen<EPS||Math.abs(cross(u,v))>1e-4*uLen*Math.hypot(...v)||Math.abs(cross(u,sub(r,p)))>1e-4*uLen)continue;
    const ux=u[0]/uLen,uz=u[1]/uLen;
    const r0=(r[0]-p[0])*ux+(r[1]-p[1])*uz,r1=(s[0]-p[0])*ux+(s[1]-p[1])*uz;
    const lo=Math.max(0,Math.min(r0,r1)),hi=Math.min(uLen,Math.max(r0,r1));
    if(hi-lo>0.15)result.push({from:[rn(p[0]+ux*lo),rn(p[1]+uz*lo)],to:[rn(p[0]+ux*hi),rn(p[1]+uz*hi)],length:hi-lo});
  }
  return result;
}
export function frontageEdges(poly,roadPolys){
  const found=[];
  for(const road of roadPolys)for(const e of commonEdge(poly,road.vertices))found.push({...e,roadId:road.axisId||road.id});
  return found;
}
function spatial(id,vertices){const c=polygonCentroid(vertices),bounds=polygonBounds(vertices);return {id,vertices,...{x:c[0],z:c[1],bounds,area:rn(polygonArea(vertices)),width:rn(bounds.x1-bounds.x0),depth:rn(bounds.z1-bounds.z0)}};}
function square(size){let h=size/2;return [[-h,-h],[h,-h],[h,h],[-h,h]];}
function randomCell(rng,seed,p,channel){return rng(seed,Math.round(p.x*5),Math.round(p.z*5),channel);}
/** Straight road axes: full-length orthogonal roads and one configurable oblique through-road. */
export function makeRoadAxes(world,features={}){
  const s=world.size,h=s/2,axes=[];
  const centers=[];for(let v=-h+world.roadSpacing/2;v<h-1e-6;v+=world.roadSpacing)centers.push(rn(v));
  for(let i=0;i<centers.length;i++)for(const orientation of ['NS','EW']){
    const c=centers[i],special=features.promenade!==false&&Math.abs(c)===Math.min(...centers.map(Math.abs));
    const width=special?Math.max(world.roadWidth,world.promenadeWidth):world.roadWidth;
    axes.push({id:`axis-${orientation}-${i}`,from:orientation==='NS'?[c,-h]:[-h,c],to:orientation==='NS'?[c,h]:[h,c],width,kind:special?'promenade':'local'});
  }
  if(world.diagonalWidth>0){
    const angle=world.diagonalAngle*Math.PI/180,d=[Math.cos(angle),Math.sin(angle)],n=[-d[1],d[0]],offset=world.diagonalOffset;
    const center=[n[0]*offset,n[1]*offset],reach=s*1.5;
    axes.push({id:'axis-oblique',from:[rn(center[0]-reach*d[0]),rn(center[1]-reach*d[1])],to:[rn(center[0]+reach*d[0]),rn(center[1]+reach*d[1])],width:world.diagonalWidth,kind:'arterial'});
  }
  return axes;
}
function segmentIntersection(a,b,c,d){
  const r=sub(b,a),s=sub(d,c),den=cross(r,s);if(Math.abs(den)<1e-8)return null;
  const t=cross(sub(c,a),s)/den,u=cross(sub(c,a),r)/den;
  if(t<-EPS||t>1+EPS||u<-EPS||u>1+EPS)return null;
  return {p:lerp(a,b,t),t,u};
}
function clipLineToSquare(a,b,size){
  const h=size/2,d=sub(b,a);let t0=0,t1=1;
  for(let k=0;k<2;k++)for(const [p,q] of [[-d[k],a[k]+h],[d[k],h-a[k]]]){
    if(Math.abs(p)<1e-10){if(q<0)return null;}else{const t=q/p;if(p<0)t0=Math.max(t0,t);else t1=Math.min(t1,t);}
  }
  return t1-t0>1e-6?[lerp(a,b,t0),lerp(a,b,t1)]:null;
}
export function createRoadTopology(axes,worldSize){
  const lines=axes.map(a=>({...a,clipped:clipLineToSquare(a.from,a.to,worldSize)})).filter(a=>a.clipped);
  const points=new Map();const perLine=new Map(lines.map(a=>[a.id,[]]));
  const add=(p,id)=>{let key=p.map(v=>rn(v).toFixed(4)).join('/');if(!points.has(key))points.set(key,{id:`J-${key}`,x:rn(p[0]),z:rn(p[1])});perLine.get(id).push({key,p});};
  for(const line of lines){add(line.clipped[0],line.id);add(line.clipped[1],line.id);}
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    const hit=segmentIntersection(...lines[i].clipped,...lines[j].clipped);
    if(hit){add(hit.p,lines[i].id);add(hit.p,lines[j].id);}
  }
  const edges=[];
  for(const line of lines){let p=perLine.get(line.id),a=line.clipped[0],d=sub(line.clipped[1],a);
    p.sort((x,y)=>dot(sub(x.p,a),d)-dot(sub(y.p,a),d));
    for(let i=0;i<p.length-1;i++)if(dist(p[i].p,p[i+1].p)>1e-5)edges.push({id:`E-${line.id}-${i}`,from:points.get(p[i].key).id,to:points.get(p[i+1].key).id,axisId:line.id,width:line.width});
  }
  return {nodes:[...points.values()],edges,axes:lines.map(({clipped,...axis})=>({...axis,clipped}))};
}
function carveRoads(world,axes){
  let land=[square(world.size)],roads=[],i=0;
  for(const axis of axes){
    const dir=sub(axis.to,axis.from),len=Math.hypot(...dir),n=[-dir[1]/len,dir[0]/len];
    const t=dot(axis.from,n),lo=t-axis.width/2,hi=t+axis.width/2,next=[];
    for(const cell of land){
      const mid=clipStrip(cell,n,lo,hi);
      if(mid.length)roads.push({...spatial(`R-${i++}`,mid),axisId:axis.id,kind:axis.kind});
      const left=clipHalfPlane(cell,n,lo),right=clipHalfPlane(cell,[-n[0],-n[1]],-hi);
      if(left.length)next.push(left);if(right.length)next.push(right);
    }
    land=next;
  }
  return {roads,blocks:land.map((p,i)=>spatial(`BL-${i}`,p))};
}
/** Clip each finite road footprint into mutually exclusive convex cells.
 * This preserves exact set-difference and site tiling without an external polygon boolean library.
 * Land fragments remain convex, with no fake bounding-box geometry.
 */
function subtractConvex(source,cutter){
  let inside=source,outer=[];
  const signed=cutter.reduce((s,p,i)=>s+cross(p,cutter[(i+1)%cutter.length]),0);
  const sign=signed>=0?1:-1;
  for(let i=0;i<cutter.length&&inside.length;i++){
    const a=cutter[i],b=cutter[(i+1)%cutter.length],d=sub(b,a),n=[sign*d[1],-sign*d[0]],t=dot(a,n);
    const outside=clipHalfPlane(inside,[-n[0],-n[1]],-t);
    if(outside.length)outer.push(outside);
    inside=clipHalfPlane(inside,n,t);
  }
  return {outside:outer,inside};
}
function stablePolygonId(prefix,poly){
  const points=poly.map(p=>p.map(v=>Math.round(v*1000))).map(p=>p.join(':'));
  const candidates=[];
  for(let i=0;i<points.length;i++){
    candidates.push([...points.slice(i),...points.slice(0,i)].join('|'));
  }
  const reverse=points.slice().reverse();
  for(let i=0;i<reverse.length;i++)candidates.push([...reverse.slice(i),...reverse.slice(0,i)].join('|'));
  const canon=candidates.sort()[0]||'';
  let hash=2166136261;
  for(let i=0;i<canon.length;i++)hash=Math.imul(hash^canon.charCodeAt(i),16777619)>>>0;
  return `${prefix}-${hash.toString(36)}`;
}
function corridorPolygon(a,b,width){
  const d=sub(b,a),len=Math.hypot(...d);
  if(len<1e-6)return [];
  const nx=-d[1]*width/(2*len),nz=d[0]*width/(2*len);
  return [[rn(a[0]+nx),rn(a[1]+nz)],[rn(b[0]+nx),rn(b[1]+nz)],[rn(b[0]-nx),rn(b[1]-nz)],[rn(a[0]-nx),rn(a[1]-nz)]];
}
function mergedRoadSegments(network){
  const parts=networkSegments(network),groups=[];
  for(const e of parts){
    const a=e.fromPoint,b=e.toPoint,d=sub(b,a),len=Math.hypot(...d),u=[d[0]/len,d[1]/len];
    if(u[0]<-EPS||(Math.abs(u[0])<EPS&&u[1]<0)){u[0]*=-1;u[1]*=-1;}
    const n=[-u[1],u[0]],off=dot(a,n);
    let group=groups.find(g=>Math.abs(cross(g.u,u))<1e-5&&Math.abs(g.offset-off)<.002&&g.width===e.width&&g.kind===e.kind);
    if(!group){group={u,n,offset:off,width:e.width,kind:e.kind,intervals:[]};groups.push(group);}
    group.intervals.push({from:Math.min(dot(a,u),dot(b,u)),to:Math.max(dot(a,u),dot(b,u)),id:e.id});
  }
  const output=[];
  for(const g of groups){
    g.intervals.sort((a,b)=>a.from-b.from);
    let current=null;
    const flush=()=>{if(!current)return;const p=t=>[rn(g.u[0]*t+g.n[0]*g.offset),rn(g.u[1]*t+g.n[1]*g.offset)];
      output.push({id:current.ids.sort().join('+'),kind:g.kind,width:g.width,from:p(current.from),to:p(current.to)});};
    for(const interval of g.intervals){
      if(!current){current={from:interval.from,to:interval.to,ids:[interval.id]};continue;}
      if(interval.from<=current.to+1e-3){current.to=Math.max(current.to,interval.to);current.ids.push(interval.id);}
      else{flush();current={from:interval.from,to:interval.to,ids:[interval.id]};}
    }
    flush();
  }
  return output;
}
function carveFiniteRoads(world,network){
  const axes=mergedRoadSegments(network);
  let remaining=[square(world.size)],roads=[];
  for(const axis of axes){
    const footprint=corridorPolygon(axis.from,axis.to,axis.width),next=[];
    for(const poly of remaining){
      const {outside,inside}=subtractConvex(poly,footprint);
      next.push(...outside);
      if(inside.length&&polygonArea(inside)>1e-4)roads.push({...spatial(stablePolygonId('R',inside),inside),axisId:axis.id,kind:axis.kind});
    }
    remaining=next.filter(p=>polygonArea(p)>1e-4);
  }
  const blocks=remaining.map(poly=>spatial(stablePolygonId('BL',poly),poly));
  return {roads,blocks,axes};
}

function assignParcels(world,blocks,roads){
  const parcels=[];
  for(const block of blocks){
    const shape=block.vertices,box=block.bounds;
    const target=world.parcelTargetWidth;
    const variants=[];
    for(const axis of [0,1]){
      const spread=axis===0?box.x1-box.x0:box.z1-box.z0;
      const count=Math.max(1,Math.min(4,Math.round(spread/target)));
      let lots=[];
      for(let i=0;i<count;i++){
        const lo=(axis===0?box.x0:box.z0)+spread*i/count,hi=(axis===0?box.x0:box.z0)+spread*(i+1)/count;
        const n=axis===0?[1,0]:[0,1];const p=clipStrip(shape,n,lo,hi);
        if(!p.length||polygonArea(p)<30)continue;
        const lot=spatial(`${block.id}-P${i}`,p);
        lot.blockId=block.id;lot.frontageEdges=frontageEdges(p,roads);
        lot.frontageIds=[...new Set(lot.frontageEdges.map(f=>f.roadId))];
        lots.push(lot);
      }
      if(lots.length&&lots.every(p=>p.frontageIds.length))variants.push(lots);
    }
    // Splitting is conservative: if any resulting lot would be landlocked, keep the parent block.
    const best=variants.sort((a,b)=>b.length-a.length)[0];
    let chosen=best??[];
    if(!chosen.length){const lot={...block,id:`${block.id}-P0`,blockId:block.id,frontageEdges:frontageEdges(shape,roads)};lot.frontageIds=[...new Set(lot.frontageEdges.map(e=>e.roadId))];chosen=[lot];}
    // Marginal sliver blocks are held as public reserve if frontage is absent (site edge artifacts).
    for(const p of chosen)parcels.push(p);
  }
  return parcels;
}
function distributeUse(world,parcels,features,rng){
  const useList=['residential','commercial','civic','park'];
  return parcels.map(p=>{
    const chance=randomCell(rng,world.seed,p,217),distance=Math.hypot(p.x,p.z);
    const use=(features.plaza!==false&&distance<world.plazaRadius)?'park':chance<world.parkShare?'park':(distance<world.size*.27&&chance<world.parkShare+.25)?'commercial':chance>.91?'civic':'residential';
    const parkClass=use==='park'?(p.area<world.parkSmallMaxArea?'small':p.area<world.parkLargeMinArea?'medium':'large'):null;
    return {...p,use,parkClass};
  });
}
function createBuildings(world,parcels,features,rng){
  const buildings=[];
  for(const p of parcels){
    if(p.use==='park'||p.area<80)continue;
    if(randomCell(rng,world.seed,p,219)>=(p.x>=0?world.eastDensity:world.westDensity))continue;
    const usable=insetPolygon(p.vertices,world.buildingSetback);
    if(!usable.length||polygonArea(usable)<45)continue;
    const c=polygonCentroid(usable),tone=randomCell(rng,world.seed,p,220),factor=.72;
    const footprint=usable.map(v=>[rn(c[0]+(v[0]-c[0])*factor),rn(c[1]+(v[1]-c[1])*factor)]);
    const shape=spatial(`B-${p.id}`,footprint),heightWeight=Math.max(0,1-Math.hypot(p.x,p.z)/(world.size*.75));
    const type=p.use==='commercial'?'commercial':p.use==='civic'?'civic':tone>.7?'tower':tone>.38?'terraced':'slab';
    buildings.push({...shape,parcelId:p.id,blockId:p.blockId,region:p.x>=0?'东侧':'西侧',use:p.use,type,tone,height:rn(((p.use==='civic'?10:p.use==='commercial'?25:12)+heightWeight*(40+tone*50))*(features.height===false?1:world.heightScale)),footprint:shape.area});
  }
  return buildings;
}
function createTrees(world,parcels,buildings,roads,rng){
  const trees=[],occupied=[],R=world.treeCrownRadius;
  const add=(id,x,z,kind,p)=>{
    const point=[rn(x),rn(z)];
    if(!containsPoint(p.vertices,point,R+.3))return;
    if(roads.some(road=>circlePolygonConflict(point,R,road.vertices)))return;
    if(buildings.some(b=>circlePolygonConflict(point,R+world.treeBuildingClearance,b.vertices)))return;
    if(occupied.some(t=>dist(t,point)<R*2+.3))return;
    occupied.push(point);trees.push({id,x:point[0],z:point[1],kind,parcelId:p.id,height:rn(3.5+randomCell(rng,world.seed,p,284)*3.6),crownRadius:R});
  };
  for(const parcel of parcels){
    for(const [j,e] of parcel.frontageEdges.entries()){
      const len=dist(e.from,e.to),n=Math.floor(len/world.treeSpacing),middle=polygonCentroid(parcel.vertices);
      for(let k=0;k<n;k++){
        if(rng(world.seed,Math.round(parcel.x)+j,Math.round(parcel.z)+k,260)>world.treeDensity)continue;
        const t=(k+.5)/n,side=lerp(e.from,e.to,t),dir=sub(middle,side),lenDir=Math.hypot(...dir);
        if(lenDir<EPS)continue;
        add(`TS-${parcel.id}-${j}-${k}`,side[0]+dir[0]/lenDir*world.treeRoadSetback,side[1]+dir[1]/lenDir*world.treeRoadSetback,'street',parcel);
      }
    }
    if(parcel.use!=='park')continue;
    const b=parcel.bounds,step=world.parkTreeSpacing;
    for(let zi=0;zi<Math.ceil((b.z1-b.z0)/step);zi++)for(let xi=0;xi<Math.ceil((b.x1-b.x0)/step);xi++){
      if(rng(world.seed,Math.round(parcel.x)+xi,Math.round(parcel.z)+zi,276)>world.treeDensity*.8)continue;
      const dx=(rng(world.seed,xi,zi,277)-.5)*step*.25,dz=(rng(world.seed,xi,zi,278)-.5)*step*.25;
      add(`TP-${parcel.id}-${xi}-${zi}`,b.x0+(xi+.5)*step+dx,b.z0+(zi+.5)*step+dz,'park',parcel);
    }
  }
  return trees;
}
/** Replaces rectangle-based downstream stages when a diagonal road is enabled. */
export function generatePolygonCity(world,features,rng){
  const editing=!!world.roadNetwork;
  const axes=editing?networkSegments(world.roadNetwork).map(e=>({id:e.id,from:e.fromPoint,to:e.toPoint,kind:e.kind,width:e.width})):makeRoadAxes(world,features);
  const roadGraph=editing?createRoadTopology(axes,world.size):createRoadTopology(axes,world.size);
  const carved=editing?carveFiniteRoads(world,world.roadNetwork):carveRoads(world,axes);
  const parcels=distributeUse(world,assignParcels(world,carved.blocks,carved.roads),features,rng);
  const buildings=createBuildings(world,parcels,features,rng);
  const parks=parcels.filter(p=>p.use==='park').map(p=>({...p,id:`P-${p.id}`,parcelId:p.id,kind:p.parkClass}));
  const trees=createTrees(world,parcels,buildings,carved.roads,rng);
  const footprint=buildings.reduce((s,b)=>s+b.area,0),roadArea=carved.roads.reduce((s,r)=>s+r.area,0);
  const metrics={total:buildings.length,east:buildings.filter(b=>b.region==='东侧').length,west:buildings.filter(b=>b.region==='西侧').length,
    eastEligible:parcels.filter(p=>p.use!=='park'&&p.x>=0).length,westEligible:parcels.filter(p=>p.use!=='park'&&p.x<0).length,
    coverage:footprint/(world.size*world.size),avgHeight:buildings.length?buildings.reduce((s,b)=>s+b.height,0)/buildings.length:0,
    maxHeight:Math.max(0,...buildings.map(b=>b.height)),plazaArea:features.plaza===false?0:Math.PI*world.plazaRadius**2,
    roadSegments:carved.roads.length,roadArea,parcelCount:parcels.length,parkCount:parks.length,parkArea:parks.reduce((s,p)=>s+p.area,0),
    parkSizes:{small:parks.filter(p=>p.kind==='small').length,medium:parks.filter(p=>p.kind==='medium').length,large:parks.filter(p=>p.kind==='large').length},
    treeCount:trees.length,streetTrees:trees.filter(t=>t.kind==='street').length,parkTrees:trees.filter(t=>t.kind==='park').length,
    buildingUses:{residential:buildings.filter(b=>b.use==='residential').length,commercial:buildings.filter(b=>b.use==='commercial').length,civic:buildings.filter(b=>b.use==='civic').length}};
  return {geometryMode:editing?EDITABLE_GEOMETRY_MODEL:GEOMETRY_MODEL,world,features,roads:carved.roads,roadLines:axes.map(a=>({id:`RL-${a.id}`,from:a.from,to:a.to,kind:a.kind})),roadGraph,
    blocks:carved.blocks,parcels,buildings,parks,trees,metrics,
    pipeline:[{stage:'roads',count:carved.roads.length},{stage:'parcels',count:parcels.length},{stage:'landuse',count:parcels.length},{stage:'buildings',count:buildings.length},{stage:'parks',count:parks.length},{stage:'trees',count:trees.length}]};
}
/** Polygon-accurate checks; bounding boxes alone are never used for collision decisions. */
export function validatePolygonCity(scene){
  const errors=[],h=scene.world.size/2;
  const collections=['roads','parcels','buildings','parks'];
  const insideWorld=p=>p.vertices.every(v=>Math.abs(v[0])<=h+1e-5&&Math.abs(v[1])<=h+1e-5);
  for(const key of collections)for(const p of scene[key]){
    if(!insideWorld(p))errors.push(`${key} out of site ${p.id}`);
    if(p.area<1e-4||Math.abs(p.area-polygonArea(p.vertices))>1e-3)errors.push(`${key} invalid area ${p.id}`);
  }
  const noOverlap=(a,b,label,same=false)=>{
    for(let i=0;i<a.length;i++)for(let j=same?i+1:0;j<b.length;j++)if(polygonsOverlap(a[i].vertices,b[j].vertices))errors.push(`${label} ${a[i].id}/${b[j].id}`);
  };
  for(const key of collections)noOverlap(scene[key],scene[key],`${key} overlap`,true);
  noOverlap(scene.roads,scene.parcels,'road/parcel');noOverlap(scene.roads,scene.buildings,'road/building');noOverlap(scene.roads,scene.parks,'road/park');noOverlap(scene.buildings,scene.parks,'building/park');
  const total=scene.roads.reduce((s,p)=>s+p.area,0)+scene.parcels.reduce((s,p)=>s+p.area,0);
  if(Math.abs(total-scene.world.size**2)>0.25)errors.push(`coverage area mismatch ${total}`);
  const parcelMap=new Map(scene.parcels.map(p=>[p.id,p]));
  for(const p of scene.parcels){if(!p.frontageIds.length)errors.push(`landlocked parcel ${p.id}`);if(!['park','residential','commercial','civic'].includes(p.use))errors.push(`unknown use ${p.id}`);}
  for(const b of scene.buildings){const p=parcelMap.get(b.parcelId);if(!p||!b.vertices.every(v=>containsPoint(p.vertices,v,scene.world.buildingSetback-0.001)))errors.push(`setback violated ${b.id}`);}
  const parks=new Set(scene.parks.map(p=>p.parcelId));
  for(const p of scene.parcels)if((p.use==='park')!==parks.has(p.id))errors.push(`park mismatch ${p.id}`);
  for(const t of scene.trees){
    const p=parcelMap.get(t.parcelId),pos=[t.x,t.z],r=t.crownRadius;
    if(!p||!containsPoint(p.vertices,pos,r))errors.push(`tree outside parcel ${t.id}`);
    if(scene.roads.some(rd=>circlePolygonConflict(pos,r,rd.vertices)))errors.push(`tree road collision ${t.id}`);
    if(scene.buildings.some(b=>circlePolygonConflict(pos,r+scene.world.treeBuildingClearance,b.vertices)))errors.push(`tree building collision ${t.id}`);
  }
  for(let i=0;i<scene.trees.length;i++)for(let j=i+1;j<scene.trees.length;j++)if(Math.hypot(scene.trees[i].x-scene.trees[j].x,scene.trees[i].z-scene.trees[j].z)<scene.trees[i].crownRadius+scene.trees[j].crownRadius-EPS)errors.push(`tree collision ${i}/${j}`);
  const {nodes,edges}=scene.roadGraph,seen=new Set([nodes[0]?.id]),stack=[nodes[0]?.id];
  while(stack.length){const node=stack.pop();for(const e of edges)if(e.from===node||e.to===node){const adjacent=e.from===node?e.to:e.from;if(!seen.has(adjacent)){seen.add(adjacent);stack.push(adjacent);}}}
  if(seen.size!==nodes.length)errors.push(`disconnected road topology ${seen.size}/${nodes.length}`);
  return {valid:errors.length===0,errors,checks:{roads:scene.roads.length,parcels:scene.parcels.length,buildings:scene.buildings.length,parks:scene.parks.length,trees:scene.trees.length}};
}
