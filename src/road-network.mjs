/** WorldCraft V0.5 — editable, deterministic road centerline graph.
 * Graph IDs identify authored nodes/segments, unlike derived junctions and rendered road polygons.
 */
export const ROAD_NETWORK_VERSION = 2;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=n=>Math.round(n*1e5)/1e5;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const difference=(a,b)=>[b.x-a.x,b.z-a.z];
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const clone=x=>JSON.parse(JSON.stringify(x));

export function normalizeRoadNetwork(input,size){
  if(input==null)return null;
  if(!input||![1,ROAD_NETWORK_VERSION].includes(input.version)||!Array.isArray(input.nodes)||!Array.isArray(input.edges))throw Error('无效的道路编辑图版本');
  if(input.nodes.length<2||input.nodes.length>180||input.edges.length<1||input.edges.length>240)throw Error('道路网络规模应在 2–180 个节点和 1–240 条道路内');
  const h=size/2, ids=new Set(),nodes=[];
  for(const n of input.nodes){
    if(!n||typeof n.id!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(n.id)||ids.has(n.id)||!finite(n.x)||!finite(n.z))throw Error('道路节点 ID 或坐标无效');
    if(Math.abs(n.x)>h+1e-4||Math.abs(n.z)>h+1e-4)throw Error(`节点 ${n.id} 超出场地`);
    nodes.push({id:n.id,x:round(n.x),z:round(n.z)});ids.add(n.id);
  }
  const positions=new Map(nodes.map(n=>[n.id,n]));
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)if(dist(nodes[i],nodes[j])<.25)throw Error(`道路节点距离过近 ${nodes[i].id}/${nodes[j].id}`);
  const eid=new Set(),pairs=new Set(),edges=[];let curves=0;
  for(const e of input.edges){
    if(!e||typeof e.id!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(e.id)||eid.has(e.id)||!ids.has(e.from)||!ids.has(e.to)||e.from===e.to)throw Error('道路边 ID 或引用无效');
    const pair=[e.from,e.to].sort().join('|');if(pairs.has(pair))throw Error(`重复的道路段 ${pair}`);
    if(dist(positions.get(e.from),positions.get(e.to))<Math.max(3,e.width/2))throw Error(`道路段 ${e.id} 长度太短`);
    if(!finite(e.width)||e.width<6||e.width>22)throw Error(`道路段 ${e.id} 宽度必须在 6–22m`);
    if(!['local','arterial','promenade'].includes(e.kind))throw Error(`道路段 ${e.id} 类型不受支持`);
    const bend=e.bend??0;
    if(!finite(bend)||Math.abs(bend)>30)throw Error(`道路 ${e.id} 曲率偏移必须在 -30 至 30m`);
    if(Math.abs(bend)>1e-6&&++curves>12)throw Error('V0.6 最多允许 12 条曲线路段，以确保本地可用性能');
    pairs.add(pair);eid.add(e.id);edges.push({id:e.id,from:e.from,to:e.to,width:round(e.width),kind:e.kind,bend:round(bend)});
  }
  const seen=new Set([nodes[0].id]),stack=[nodes[0].id];
  while(stack.length){const id=stack.pop();for(const e of edges)if(e.from===id||e.to===id){const other=e.from===id?e.to:e.from;if(!seen.has(other)){seen.add(other);stack.push(other);}}}
  if(seen.size!==nodes.length)throw Error('道路编辑图必须保持连通，孤立节点或道路不可保存');
  // Self-intersections and crossings are physically connected by automatic noding downstream.
  // Collinear overlapping segments are rejected: their exact geometry is ambiguous for parcel frontage.
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
    const a=edges[i],b=edges[j],p=positions.get(a.from),q=positions.get(a.to),r=positions.get(b.from),s=positions.get(b.to);
    const pq=difference(p,q),rs=difference(r,s);
    const scale=Math.hypot(...pq)*Math.hypot(...rs);
    if(Math.abs(cross(pq,rs))>1e-6*scale||Math.abs(cross(pq,difference(p,r)))>1e-6*scale)continue;
    const len=pq[0]**2+pq[1]**2,t=v=>( (v.x-p.x)*pq[0]+(v.z-p.z)*pq[1] )/len;
    if(Math.min(1,Math.max(t(r),t(s)))-Math.max(0,Math.min(t(r),t(s)))>1e-5)throw Error(`道路 ${a.id} 与 ${b.id} 沿同一直线重叠`);
  }
  // Reject control points and curve chords outside the local site before committing a road edit.
  for(const e of edges){
    if(!e.bend)continue;
    const a=positions.get(e.from),b=positions.get(e.to);
    for(const p of sampleRoadCurve(a,b,e.bend)){
      if(Math.abs(p[0])>h+1e-4||Math.abs(p[1])>h+1e-4)throw Error(`曲线道路 ${e.id} 超出场地`);
    }
  }
  return {version:ROAD_NETWORK_VERSION,nodes,edges};
}
export function networkFromTopology(topology,size){
  const ids=new Map(topology.nodes.map((n,i)=>[n.id,`N-${i}`]));
  const nodes=topology.nodes.map((n,i)=>({id:ids.get(n.id),x:n.x,z:n.z}));
  const edges=topology.edges.map((e,i)=>({id:`E-${i}`,from:ids.get(e.from),to:ids.get(e.to),width:e.width,kind:topology.axes.find(a=>a.id===e.axisId)?.kind??'local'}));
  return normalizeRoadNetwork({version:ROAD_NETWORK_VERSION,nodes,edges},size);
}
/** Quadratic Bézier bends use the MID-POINT offset, not the handle offset. */
export function roadCurveControl(a,b,bend=0){
  const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
  return {x:round((a.x+b.x)/2-2*bend*dz/len),z:round((a.z+b.z)/2+2*bend*dx/len)};
}
export function sampleRoadCurve(a,b,bend=0){
  if(!bend)return [[a.x,a.z],[b.x,b.z]];
  const c=roadCurveControl(a,b,bend),length=Math.hypot(b.x-a.x,b.z-a.z);
  const segments=Math.max(4,Math.min(24,Math.ceil(length/24),Math.ceil(Math.sqrt(Math.abs(bend)*2))));
  const result=[];
  for(let i=0;i<=segments;i++){
    const t=i/segments,one=1-t;
    result.push([round(one*one*a.x+2*one*t*c.x+t*t*b.x),round(one*one*a.z+2*one*t*c.z+t*t*b.z)]);
  }
  return result;
}
export function networkSegments(network){
  const nodes=new Map(network.nodes.map(n=>[n.id,n]));
  const result=[];
  for(const e of network.edges){
    const pts=sampleRoadCurve(nodes.get(e.from),nodes.get(e.to),e.bend??0);
    for(let i=0;i<pts.length-1;i++){
      result.push({...e,id:pts.length===2?e.id:`${e.id}~${i}`,axisId:e.id,curveSegmentIndex:i,fromPoint:pts[i],toPoint:pts[i+1]});
    }
  }
  return result;
}
export function curveRoadEdge(network,id,bend,size){
  const next=clone(network),edge=next.edges.find(e=>e.id===id);
  if(!edge)throw Error('道路段不存在');edge.bend=round(bend);
  return normalizeRoadNetwork(next,size);
}
export function moveRoadNode(network,id,x,z,size){
  const next=clone(network),node=next.nodes.find(n=>n.id===id);
  if(!node)throw Error('道路节点不存在');node.x=round(x);node.z=round(z);
  return normalizeRoadNetwork(next,size);
}
export function resizeRoadEdge(network,id,width,size){
  const next=clone(network),edge=next.edges.find(e=>e.id===id);
  if(!edge)throw Error('道路段不存在');edge.width=round(width);
  return normalizeRoadNetwork(next,size);
}
function nextId(values,prefix){let n=1;const known=new Set(values.map(v=>v.id));while(known.has(`${prefix}${n}`))n++;return `${prefix}${n}`;}
export function splitRoadEdge(network,edgeId,size){
  const next=clone(network),index=next.edges.findIndex(e=>e.id===edgeId);
  if(index<0)throw Error('道路段不存在');const old=next.edges[index],nodes=new Map(next.nodes.map(n=>[n.id,n]));
  if(old.bend)throw Error('曲线路段暂不能直接拆分：请先将弯曲偏移设为 0，避免改变原曲线几何');
  const a=nodes.get(old.from),b=nodes.get(old.to),id=nextId(next.nodes,'N-edit-');
  next.nodes.push({id,x:round((a.x+b.x)/2),z:round((a.z+b.z)/2)});
  next.edges.splice(index,1,{...old,to:id,bend:old.bend/2},{...old,id:nextId(next.edges,'E-edit-'),from:id,bend:old.bend/2});
  return {network:normalizeRoadNetwork(next,size),nodeId:id};
}
export function addRoadBranch(network,from,x,z,size,width=10){
  const next=clone(network),n=next.nodes.find(n=>n.id===from);if(!n)throw Error('请选择一处已有道路节点');
  const id=nextId(next.nodes,'N-edit-'),edgeId=nextId(next.edges,'E-edit-');
  next.nodes.push({id,x:round(x),z:round(z)});next.edges.push({id:edgeId,from,to:id,width,kind:'local',bend:0});
  return {network:normalizeRoadNetwork(next,size),nodeId:id,edgeId};
}
export function removeRoadNode(network,id,size){
  const next=clone(network),links=next.edges.filter(e=>e.from===id||e.to===id);
  if(links.length===1){
    next.nodes=next.nodes.filter(n=>n.id!==id);next.edges=next.edges.filter(e=>e!==links[0]);
    return normalizeRoadNetwork(next,size);
  }
  if(links.length!==2)throw Error('只允许删除道路终端或两条连接的中间节点，不能删除复杂交叉口');
  const first=links[0],second=links[1];
  if(first.bend||second.bend)throw Error('曲线连接点暂不能合并，请先将相邻路段调直');
  const a=first.from===id?first.to:first.from,b=second.from===id?second.to:second.from;
  if(a===b)throw Error('不能合并为自环道路');
  next.nodes=next.nodes.filter(n=>n.id!==id);next.edges=next.edges.filter(e=>!links.includes(e));
  next.edges.push({id:first.id,from:a,to:b,width:first.width,kind:first.kind,bend:0});
  return normalizeRoadNetwork(next,size);
}
/** Auditable road-specific natural language (not a free-form LLM agent). */
export function parseRoadEditInstruction(source){
  const s=String(source||'').trim();
  const move=s.match(/(?:路口|道路节点|节点)\s*([A-Za-z0-9_.-]+)\s*向(东|西|南|北)\s*移动\s*(\d+(?:\.\d+)?)\s*(?:米|m)?/i);
  if(move){
    const metres=Number(move[3]);
    if(!Number.isFinite(metres)||metres<=0||metres>100)return {type:'error',message:'道路节点单次移动范围为 0–100m'};
    const dir={东:[1,0],西:[-1,0],南:[0,1],北:[0,-1]}[move[2]];
    return {type:'move-node',nodeId:move[1],dx:metres*dir[0],dz:metres*dir[1]};
  }
  const width=s.match(/(?:道路|路段)\s*([A-Za-z0-9_.-]+)\s*(?:宽度|路幅)?\s*(?:改为|设为|调整为|调整到)\s*(\d+(?:\.\d+)?)\s*(?:米|m)?/i);
  if(width)return {type:'resize-edge',edgeId:width[1],width:Number(width[2])};
  const bend=s.match(/(?:道路|路段)\s*([A-Za-z0-9_.-]+)\s*(?:弯曲|弯度|曲线偏移)\s*(?:设为|调整为|改为|到)?\s*(-?\d+(?:\.\d+)?)\s*(?:米|m)?/i);
  if(bend)return {type:'bend-edge',edgeId:bend[1],bend:Number(bend[2])};
  return null;
}
