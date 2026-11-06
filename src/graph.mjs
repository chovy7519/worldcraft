/** WorldCraft V0.3 — ordered, typed spatial pipeline graph with optional routing. */
export const GRAPH_VERSION=2;
export const NODE_DEFS=Object.freeze({
  seed:{name:'World Input',cn:'世界输入',subtitle:'场地范围 / 确定性种子',required:true,params:['size','seed']},
  promenade:{name:'Promenade Rule',cn:'主街规则',subtitle:'设置主街路幅',params:['promenadeWidth']},
  roads:{name:'Road Network',cn:'道路网络',subtitle:'正交街网 / 可编辑斜向主路 · 道路拓扑',required:true,params:['roadSpacing','roadWidth','diagonalWidth','diagonalAngle','diagonalOffset']},
  parcels:{name:'Parcel Subdivision',cn:'地块划分',subtitle:'道路围合区块 → 有路权的地块',required:true,params:['parcelTargetWidth']},
  plaza:{name:'Civic Open Space',cn:'中心绿心',subtitle:'将中心地块预留为公园',params:['plazaRadius']},
  landuse:{name:'Land-use Allocation',cn:'功能分配',subtitle:'住宅 / 商业 / 公服 / 公园',required:true,params:['parkShare','parkSmallMaxArea','parkLargeMinArea']},
  density:{name:'Occupancy Field',cn:'建筑密度',subtitle:'东西侧独立采样',required:true,params:['eastDensity','westDensity']},
  height:{name:'Height Field',cn:'高度梯度',subtitle:'中心高、边缘低',params:['heightScale']},
  buildings:{name:'Building Typology',cn:'多类型建筑',subtitle:'居住、商业、公服建筑',required:true,params:['buildingSetback']},
  parks:{name:'Park Generation',cn:'多尺度公园',subtitle:'按地块尺寸生成大小公园',required:true,params:[]},
  trees:{name:'Tree Distribution',cn:'树木分布',subtitle:'沿街与园内布置，避让道路建筑',required:true,params:['treeSpacing','treeRoadSetback','treeDensity','parkTreeSpacing','treeCrownRadius','treeBuildingClearance']},
  instances:{name:'World Instances',cn:'三维场景',subtitle:'统一实例化道路、建筑、公园与树木',required:true,params:[]}
});
export const ORDER=Object.freeze(Object.keys(NODE_DEFS));
const MUST=ORDER.filter(id=>NODE_DEFS[id].required);
const clone=x=>JSON.parse(JSON.stringify(x));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function defaultGraph(){return {version:GRAPH_VERSION,nodes:ORDER.map((type,i)=>({id:type,type,x:32+i*184,y:i%2?69:42})),edges:ORDER.slice(0,-1).map((from,i)=>({from,to:ORDER[i+1]}))};}
export function checkGraphShape(graph){
  if(!graph||graph.version!==GRAPH_VERSION||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))throw Error('无效的 PCG Graph 版本');
  if(graph.nodes.length>ORDER.length||graph.edges.length>ORDER.length*2)throw Error('Graph 节点或连线数量超限');
  const ids=new Set();
  for(const n of graph.nodes){
    if(!n||!NODE_DEFS[n.type]||n.id!==n.type||ids.has(n.id))throw Error('存在不支持或重复的节点');
    if(!finite(n.x)||!finite(n.y)||Math.abs(n.x)>4000||Math.abs(n.y)>2000)throw Error('节点坐标无效');
    ids.add(n.id);
  }
  for(const id of MUST)if(!ids.has(id))throw Error('缺少必需节点：'+id);
  const from=new Set(),to=new Set();
  for(const e of graph.edges){
    if(!e||!ids.has(e.from)||!ids.has(e.to)||e.from===e.to)throw Error('连线使用了不存在的节点');
    if(from.has(e.from)||to.has(e.to))throw Error('单流图每个端口只能有一条连线');
    if(ORDER.indexOf(e.from)>=ORDER.indexOf(e.to))throw Error('连线必须遵循空间阶段依赖顺序');
    from.add(e.from);to.add(e.to);
  }
  return clone(graph);
}
export function evaluateGraph(graph){
  try{
    const g=checkGraphShape(graph),links=new Map(g.edges.map(e=>[e.from,e.to]));
    const path=['seed'];let next='seed';
    while(links.has(next)){
      next=links.get(next);path.push(next);
      if(path.length>g.nodes.length)throw Error('检测到循环');
    }
    if(path.at(-1)!=='instances')throw Error('生成链尚未连接到三维输出节点');
    for(const id of MUST)if(!path.includes(id))throw Error('生成链缺少必需阶段：'+NODE_DEFS[id].cn);
    return {valid:true,path,features:{plaza:path.includes('plaza'),promenade:path.includes('promenade'),height:path.includes('height')},message:`${path.length} 个模块参与空间生成`};
  }catch(e){return {valid:false,path:[],features:null,message:e.message};}
}
export function moveGraphNode(graph,id,x,y){const g=checkGraphShape(graph),n=g.nodes.find(n=>n.id===id);if(!n)throw Error('节点不存在');n.x=Math.round(Math.min(3700,Math.max(-250,x)));n.y=Math.round(Math.min(1200,Math.max(0,y)));return checkGraphShape(g);}
export function connectGraph(graph,from,to){const g=checkGraphShape(graph);if(!g.nodes.some(n=>n.id===from)||!g.nodes.some(n=>n.id===to))throw Error('未找到连线端点');g.edges=g.edges.filter(e=>e.from!==from&&e.to!==to);g.edges.push({from,to});return checkGraphShape(g);}
export function removeGraphNode(graph,type){if(NODE_DEFS[type]?.required)throw Error('必需阶段不能删除');const g=checkGraphShape(graph),incoming=g.edges.find(e=>e.to===type)?.from,outgoing=g.edges.find(e=>e.from===type)?.to;g.nodes=g.nodes.filter(n=>n.type!==type);g.edges=g.edges.filter(e=>e.from!==type&&e.to!==type);if(incoming&&outgoing)g.edges.push({from:incoming,to:outgoing});return checkGraphShape(g);}
export function addGraphNode(graph,type){if(!NODE_DEFS[type]||NODE_DEFS[type].required)throw Error('只能添加可选生成模块');const g=checkGraphShape(graph);if(g.nodes.some(n=>n.type===type))throw Error('模块已经存在');const i=ORDER.indexOf(type);g.nodes.push({id:type,type,x:32+i*184,y:42});return checkGraphShape(g);}
export function setGraphNodeActive(graph,type,enabled){
  if(!NODE_DEFS[type]||NODE_DEFS[type].required)throw Error('必需阶段不能禁用');
  const g=checkGraphShape(graph),current=evaluateGraph(g);
  if(!current.valid)throw Error('请先修复连线，再切换模块状态');
  if(!g.nodes.some(n=>n.type===type))throw Error('模块不存在，请先添加');
  const active=current.path.includes(type);if(active===enabled)return g;
  if(!enabled){const incoming=g.edges.find(e=>e.to===type)?.from,outgoing=g.edges.find(e=>e.from===type)?.to;g.edges=g.edges.filter(e=>e.from!==type&&e.to!==type);g.edges.push({from:incoming,to:outgoing});}
  else{
    const rank=ORDER.indexOf(type),previous=current.path.filter(n=>ORDER.indexOf(n)<rank).at(-1),next=current.path.find(n=>ORDER.indexOf(n)>rank);
    if(!previous||!next)throw Error('插入位置不合法');
    g.edges=g.edges.filter(e=>e.from!==type&&e.to!==type&&!(e.from===previous&&e.to===next));
    g.edges.push({from:previous,to:type},{from:type,to:next});
  }
  const next=checkGraphShape(g);if(!evaluateGraph(next).valid)throw Error('节点切换导致生成链无效');return next;
}
export function graphFromFile(input){
  // V0.2 projects can reopen using the new fixed stage chain. Preserve their three optional stage toggles.
  if(input?.version===1&&Array.isArray(input.edges)&&Array.isArray(input.nodes)){
    const edges=new Map(input.edges.map(e=>[e.from,e.to])),path=['seed'];let n='seed';
    while(edges.has(n)&&path.length<=input.nodes.length){n=edges.get(n);path.push(n);}
    if(n!=='instances')throw Error('旧场景节点连线不完整');
    let result=defaultGraph();for(const opt of ['promenade','plaza','height'])if(!path.includes(opt))result=setGraphNodeActive(result,opt,false);
    return result;
  }
  const g=checkGraphShape(input);if(!evaluateGraph(g).valid)throw Error('导入的生成图尚未连接到完整输出');return g;
}
