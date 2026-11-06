/** WorldCraft V0.2 — typed, deterministic, single-stream procedural graph. */
export const GRAPH_VERSION = 1;
export const NODE_DEFS = Object.freeze({
  seed: {name:'Seed / World',cn:'场景种子',subtitle:'世界尺寸与随机性',required:true,params:['size','seed']},
  grid: {name:'Grid',cn:'候选网格',subtitle:'20m 稳定候选单元',required:true,params:[]},
  plaza: {name:'Plaza Reserve',cn:'中央开放空间',subtitle:'排除建筑占用',params:['plazaRadius']},
  promenade: {name:'Promenade',cn:'公共廊道',subtitle:'斜向步行空间',params:['promenadeWidth']},
  density: {name:'Density',cn:'建筑分布',subtitle:'东西分区采样',required:true,params:['eastDensity','westDensity']},
  height: {name:'Height Field',cn:'高度梯度',subtitle:'中心高，外围低',params:['heightScale']},
  instances: {name:'Instances',cn:'三维实例',subtitle:'输出建筑与植被',required:true,params:[]}
});
const STAGES=Object.keys(NODE_DEFS);
const MUST=['seed','grid','density','instances'];
const clone=x=>JSON.parse(JSON.stringify(x));
const finite=n=>typeof n==='number' && Number.isFinite(n);

export function defaultGraph(){
  return {
    version:GRAPH_VERSION,
    nodes:STAGES.map((type,i)=>({id:type,type,x:32+i*184,y:i%2?69:42})),
    edges:STAGES.slice(0,-1).map((from,i)=>({from,to:STAGES[i+1]}))
  };
}
export function checkGraphShape(graph){
  if(!graph||graph.version!==GRAPH_VERSION||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))throw Error('无效的 PCG Graph 版本');
  if(graph.nodes.length>STAGES.length || graph.edges.length>STAGES.length*2)throw Error('Graph 节点或连线数量超限');
  const ids=new Set(),types=new Set();
  for(const n of graph.nodes){
    if(!n || !NODE_DEFS[n.type]||n.id!==n.type||ids.has(n.id)||types.has(n.type))throw Error('存在不支持或重复的节点');
    if(!finite(n.x)||!finite(n.y)||Math.abs(n.x)>3000||Math.abs(n.y)>2000)throw Error('节点坐标无效');
    ids.add(n.id);types.add(n.type);
  }
  for(const id of MUST)if(!ids.has(id))throw Error('缺少必需节点：'+id);
  const from=new Set(),to=new Set();
  for(const e of graph.edges){
    if(!e||!ids.has(e.from)||!ids.has(e.to)||e.from===e.to)throw Error('连线使用了不存在的节点');
    if(from.has(e.from)||to.has(e.to))throw Error('单流图每个端口只能有一条连线');
    if(STAGES.indexOf(e.from)>=STAGES.indexOf(e.to))throw Error('连线必须遵循从 Seed 到 Instances 的依赖顺序');
    from.add(e.from);to.add(e.to);
  }
  return clone(graph);
}
/** Evaluate the active stream; optional nodes outside the stream are disabled. */
export function evaluateGraph(graph){
  try{
    const g=checkGraphShape(graph);
    const links=new Map(g.edges.map(e=>[e.from,e.to]));
    const path=['seed'];let next='seed';
    while(links.has(next)){
      next=links.get(next);
      path.push(next);
      if(path.length>g.nodes.length)throw Error('检测到循环');
    }
    if(path.at(-1)!=='instances')throw Error('生成链尚未连接到 Instances 输出节点');
    for(const id of MUST)if(!path.includes(id))throw Error('生成链缺少必需模块：'+NODE_DEFS[id].cn);
    return {valid:true,path,features:{plaza:path.includes('plaza'),promenade:path.includes('promenade'),height:path.includes('height')},message:`${path.length} 个节点参与世界生成`};
  }catch(error){return {valid:false,path:[],features:null,message:error.message};}
}
export function moveGraphNode(graph,id,x,y){
  const g=checkGraphShape(graph),n=g.nodes.find(n=>n.id===id);
  if(!n)throw Error('节点不存在');
  n.x=Math.round(Math.min(2800,Math.max(-250,x)));
  n.y=Math.round(Math.min(1200,Math.max(0,y)));
  return checkGraphShape(g);
}
export function connectGraph(graph,from,to){
  const g=checkGraphShape(graph);
  if(!g.nodes.some(n=>n.id===from)||!g.nodes.some(n=>n.id===to))throw Error('未找到连线端点');
  g.edges=g.edges.filter(e=>e.from!==from&&e.to!==to);
  g.edges.push({from,to});
  return checkGraphShape(g);
}
export function removeGraphNode(graph,type){
  if(NODE_DEFS[type]?.required)throw Error('必需节点不能删除');
  const g=checkGraphShape(graph);
  const incoming=g.edges.find(e=>e.to===type)?.from;
  const outgoing=g.edges.find(e=>e.from===type)?.to;
  g.nodes=g.nodes.filter(n=>n.type!==type);
  g.edges=g.edges.filter(e=>e.from!==type&&e.to!==type);
  if(incoming&&outgoing)g.edges.push({from:incoming,to:outgoing});
  return checkGraphShape(g);
}
export function addGraphNode(graph,type){
  if(!NODE_DEFS[type]||NODE_DEFS[type].required)throw Error('只能添加可选生成模块');
  const g=checkGraphShape(graph);
  if(g.nodes.some(n=>n.type===type))throw Error('该生成模块已经存在');
  const i=STAGES.indexOf(type);
  g.nodes.push({id:type,type,x:32+i*184,y:42});
  return checkGraphShape(g);
}
/** Insert or bypass one optional node while retaining the active stream. */
export function setGraphNodeActive(graph,type,enabled){
  if(NODE_DEFS[type]?.required||!NODE_DEFS[type])throw Error('不能禁用必需节点');
  const g=checkGraphShape(graph),current=evaluateGraph(g);
  if(!current.valid)throw Error('请先修复连线，再切换模块状态');
  if(!g.nodes.some(n=>n.type===type))throw Error('节点不存在，请先添加该节点');
  const active=current.path.includes(type);
  if(active===enabled)return g;
  if(!enabled){
    const incoming=g.edges.find(e=>e.to===type)?.from;
    const outgoing=g.edges.find(e=>e.from===type)?.to;
    g.edges=g.edges.filter(e=>e.from!==type&&e.to!==type);
    g.edges.push({from:incoming,to:outgoing});
  }else{
    const rank=STAGES.indexOf(type);
    const previous=current.path.filter(n=>STAGES.indexOf(n)<rank).at(-1);
    const next=current.path.find(n=>STAGES.indexOf(n)>rank);
    if(!previous||!next)throw Error('插入位置不合法');
    g.edges=g.edges.filter(e=>e.from!==type&&e.to!==type&&!(e.from===previous&&e.to===next));
    g.edges.push({from:previous,to:type},{from:type,to:next});
  }
  const newGraph=checkGraphShape(g);
  if(!evaluateGraph(newGraph).valid)throw Error('节点切换使生成链无效');
  return newGraph;
}
export function graphFromFile(input){
  const graph=checkGraphShape(input);
  if(!evaluateGraph(graph).valid)throw Error('导入的生成图尚未连接到完整输出');
  return graph;
}
