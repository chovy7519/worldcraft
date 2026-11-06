/** V0.6 exact planar union representation for a tiled set of disjoint convex cells.
 * Topology is reconstructed from subdivided, opposed edges; no bounding-box booleans.
 * A region exposes outer/hole rings AND its original convex cells for conservative meshing.
 */
const EPS = 2e-4;
const round = n => Math.round(n * 1e5) / 1e5;
const cross = (a,b) => a[0]*b[1]-a[1]*b[0];
const sub = (a,b) => [a[0]-b[0],a[1]-b[1]];
const areaSigned = ring => ring.reduce((s,p,i)=>s+cross(p,ring[(i+1)%ring.length]),0)/2;
export const areaOfRing = ring => Math.abs(areaSigned(ring));
const key = p => `${Math.round(p[0]*1e4)},${Math.round(p[1]*1e4)}`;
const len2 = v => v[0]**2+v[1]**2;
const interp = (a,b,t) => [round(a[0]+(b[0]-a[0])*t),round(a[1]+(b[1]-a[1])*t)];
const near = (a,b) => Math.abs(a[0]-b[0])<=EPS && Math.abs(a[1]-b[1])<=EPS;
function simpleRing(ring){
  let r=ring.filter((p,i)=>i===0||!near(p,ring[i-1]));
  if(r.length>1&&near(r[0],r.at(-1)))r=r.slice(0,-1);
  for(let change=true;change&&r.length>=3;){
    change=false;
    for(let i=0;i<r.length;i++){
      const a=r[(i-1+r.length)%r.length],b=r[i],c=r[(i+1)%r.length],u=sub(b,a),v=sub(c,b);
      if(Math.abs(cross(u,v)) <= EPS*Math.max(1,Math.hypot(...u)*Math.hypot(...v)) && u[0]*v[0]+u[1]*v[1]>=-EPS){r.splice(i,1);change=true;break;}
    }
  }
  return r.map(p=>[round(p[0]),round(p[1])]);
}
function ringFingerprint(ring){
  const pts=simpleRing(ring).map(key);
  const rotations=[];
  for(const pts0 of [pts,[...pts].reverse()])for(let i=0;i<pts0.length;i++)rotations.push([...pts0.slice(i),...pts0.slice(0,i)].join('|'));
  return rotations.sort()[0]||'';
}
export function regionId(outer,holes=[]){
  const s=[ringFingerprint(outer),...holes.map(ringFingerprint).sort()].join('::');
  let hash=2166136261;
  for(let i=0;i<s.length;i++)hash=Math.imul(hash^s.charCodeAt(i),16777619)>>>0;
  return `REG-${hash.toString(36)}`;
}
export function pointInRing(ring,p){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i];
    if(((a[1]>p[1])!==(b[1]>p[1])) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function segmentDistance(p,a,b){
  const d=sub(b,a),l=len2(d),t=l?Math.max(0,Math.min(1,((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/l)):0;
  return Math.hypot(p[0]-a[0]-t*d[0],p[1]-a[1]-t*d[1]);
}
export function regionContains(region,p,clearance=0){
  if(!pointInRing(region.outer,p)||region.holes.some(r=>pointInRing(r,p)))return false;
  if(clearance>0){
    for(const ring of [region.outer,...region.holes])for(let i=0;i<ring.length;i++)if(segmentDistance(p,ring[i],ring[(i+1)%ring.length])<clearance-EPS)return false;
  }
  return true;
}
export function regionArea(region){return areaOfRing(region.outer)-region.holes.reduce((n,h)=>n+areaOfRing(h),0);}
/** Merge convex nonoverlapping cells. Returns one record per EDGE-connected region;
 * contacts at a single point are not treated as continuity.
 */
export function mergeConvexCells(cells){
  if(!cells.length)return [];
  const original=cells.map(c=>Array.isArray(c)?c:c.vertices);
  const verts=original.flat();
  const segments=[];
  const bucket=new Map();let keySeq=0;
  function pointKey(p){
    const x=Math.floor(p[0]/EPS),y=Math.floor(p[1]/EPS);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      for(const c of bucket.get(`${x+dx}/${y+dy}`)??[])if(near(c.point,p))return c.id;
    }
    const id=`P${keySeq++}`,where=`${x}/${y}`;
    if(!bucket.has(where))bucket.set(where,[]);bucket.get(where).push({id,point:p});return id;
  }
  for(let ci=0;ci<original.length;ci++){
    let ring=original[ci];
    if(areaSigned(ring)<0)ring=[...ring].reverse();
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],d=sub(b,a),d2=len2(d);
      if(d2<1e-10)continue;
      const breaks=[0,1];
      for(const p of verts){
        const v=sub(p,a),t=(v[0]*d[0]+v[1]*d[1])/d2;
        if(t<=1e-6||t>=1-1e-6)continue;
        if(Math.abs(cross(v,d))<=EPS*Math.sqrt(d2) && Math.hypot(v[0]-t*d[0],v[1]-t*d[1])<=EPS)breaks.push(t);
      }
      breaks.sort((x,y)=>x-y);
      for(let j=0;j<breaks.length-1;j++){
        if(breaks[j+1]-breaks[j]<1e-7)continue;
        const p=interp(a,b,breaks[j]),q=interp(a,b,breaks[j+1]);
        const ka=pointKey(p),kb=pointKey(q);
        if(ka!==kb)segments.push({a:p,b:q,ci,ka,kb});
      }
    }
  }
  const parent=original.map((_,i)=>i);
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);};
  const byEdge=new Map();
  for(const edge of segments){
    const undirected=[edge.ka,edge.kb].sort().join('=>');
    if(!byEdge.has(undirected))byEdge.set(undirected,[]);
    byEdge.get(undirected).push(edge);
  }
  const boundary=[];
  for(const list of byEdge.values()){
    if(list.length===1){boundary.push(list[0]);continue;}
    if(list.length!==2||list[0].ka!==list[1].kb||list[0].kb!==list[1].ka)throw Error('多边形网格存在重叠或不一致的共边');
    join(list[0].ci,list[1].ci);
  }
  const components=new Map();
  for(let i=0;i<original.length;i++){
    const id=root(i);if(!components.has(id))components.set(id,{cellIds:[],boundary:[]});components.get(id).cellIds.push(i);
  }
  for(const e of boundary)components.get(root(e.ci)).boundary.push(e);
  const result=[];
  for(const component of components.values()){
    const next=new Map();for(const e of component.boundary){if(!next.has(e.ka))next.set(e.ka,[]);next.get(e.ka).push(e);}
    const seen=new Set(),rings=[];
    for(const edge of component.boundary){
      if(seen.has(edge))continue;
      let cur=edge,ring=[],guard=0;
      while(cur&&!seen.has(cur)&&guard++<=component.boundary.length+1){
        seen.add(cur);ring.push(cur.a);
        if(cur.kb===edge.ka)break;
        const options=(next.get(cur.kb)||[]).filter(e=>!seen.has(e));
        // At a point-touch, take the sharpest clockwise boundary continuation.
        if(options.length>1){
          const d=sub(cur.b,cur.a);
          options.sort((a,b)=>{
            const va=sub(a.b,a.a),vb=sub(b.b,b.a);
            return Math.atan2(cross(d,va),d[0]*va[0]+d[1]*va[1])-Math.atan2(cross(d,vb),d[0]*vb[0]+d[1]*vb[1]);
          });
        }
        cur=options[0];
      }
      if(ring.length>=3){ring=simpleRing(ring);if(areaOfRing(ring)>1e-4)rings.push(ring);}
    }
    rings.sort((a,b)=>areaOfRing(b)-areaOfRing(a));
    if(!rings.length)throw Error('区域合并失败：没有封闭环');
    const outer=areaSigned(rings[0])>0?rings[0]:[...rings[0]].reverse();
    const holes=[];
    for(const ring of rings.slice(1)){
      if(!pointInRing(outer,ring[0]))throw Error('区域合并失败：复合对象包含非连续外环');
      holes.push(areaSigned(ring)<0?ring:[...ring].reverse());
    }
    const originals=component.cellIds.map(i=>original[i]);
    const expected=originals.reduce((s,p)=>s+Math.abs(areaSigned(p)),0),actual=regionArea({outer,holes});
    if(Math.abs(actual-expected)>Math.max(.03,expected*2e-5))throw Error(`区域面积不守恒 ${expected}/${actual}`);
    result.push({id:regionId(outer,holes),outer,holes,cells:originals,area:expected,vertices:outer});
  }
  return result.sort((a,b)=>a.id.localeCompare(b.id));
}
