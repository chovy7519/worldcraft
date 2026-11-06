import {DEFAULT_WORLD,generateCity,parseCommand,applyCommand,compareScenes,validateWorld,makeExport,readExport} from './pcg.mjs';
import {WorldRenderer,CanvasFallbackRenderer} from './renderer.js';
import {NODE_DEFS,defaultGraph,checkGraphShape,evaluateGraph,moveGraphNode,connectGraph,removeGraphNode,addGraphNode,setGraphNodeActive,graphFromFile} from './graph.mjs';

const $=id=>document.getElementById(id);
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=n=>`${Math.round(n*100)}%`;
const fmt=(n,d=0)=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d});
const shortTime=()=>new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
const storeKey='worldcraft-v0.2-session';
const demoPrompts=[
  '生成一座 400×400m 的未来城市，中心高外围低，保留中央开放空间',
  '将东侧建筑密度降低 30%，其他区域不变',
  '整体建筑高度提高 20%',
  '扩大中央开放空间 20%'
];
const pipelineNames=Object.entries(NODE_DEFS).map(([key,n])=>({key,name:n.cn}));
let persisted;
try{persisted=JSON.parse(localStorage.getItem(storeKey)||localStorage.getItem('worldcraft-v0.1-session')||'null');}catch(_){persisted=null;}
let initialWorld;
try{initialWorld=validateWorld(persisted?.world ?? {...DEFAULT_WORLD});}catch(_){initialWorld={...DEFAULT_WORLD};}
let initialBaseline;
try{initialBaseline=validateWorld(persisted?.baseline ?? {...DEFAULT_WORLD});}catch(_){initialBaseline={...DEFAULT_WORLD};}
let initialGraph;
try{initialGraph=graphFromFile(persisted?.graph ?? defaultGraph());}catch(_){initialGraph=defaultGraph();}
let initialBaselineGraph;
try{initialBaselineGraph=graphFromFile(persisted?.baselineGraph ?? defaultGraph());}catch(_){initialBaselineGraph=defaultGraph();}
const state={
  world:initialWorld,
  graph:initialGraph,
  baseline:initialBaseline,
  baselineGraph:initialBaselineGraph,
  scene:generateCity(initialWorld,evaluateGraph(initialGraph).features),
  baselineScene:generateCity(initialBaseline,evaluateGraph(initialBaselineGraph).features),
  selectedNode:'density',
  graphPending:null,
  dock:'graph',
  past:[],future:[],
  selectedId:null,
  allBuildings:false,
  logs:[{description:'载入程序化城市场景',time:shortTime()}]
};
let renderer;
let toastHandle;
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastHandle);toastHandle=setTimeout(()=>el.classList.remove('show'),2700);}
function feedback(message,error=false){const area=$('command-feedback');area.classList.toggle('error',!!error);area.querySelector('.feedback-icon').textContent=error?'!':'✓';area.querySelector('span:last-child').textContent=message;}
function log(description){state.logs.unshift({description,time:shortTime()});state.logs=state.logs.slice(0,25);}
function persist(){try{localStorage.setItem(storeKey,JSON.stringify({world:state.world,graph:state.graph,baseline:state.baseline,baselineGraph:state.baselineGraph}));}catch(_){}}
function refreshAll(rebuild=true){
  const diagnosis=evaluateGraph(state.graph);
  if(diagnosis.valid)state.scene=generateCity(state.world,diagnosis.features);
  if(state.selectedId&&!state.scene.buildings.find(b=>b.id===state.selectedId))state.selectedId=null;
  if(rebuild&&renderer){renderer.selected=state.selectedId;renderer.updateScene(state.scene);}
  $('project-name').textContent=state.world.name;
  $('world-caption').textContent=`${state.world.size} × ${state.world.size} M / FUTURE CITY`;
  $('seed-footnote').textContent=`SEED #${state.world.seed}`;
  $('mesh-count').textContent=fmt(state.scene.metrics.total);
  renderMetrics();renderTree();renderRules();renderSelection();renderComparison();renderHistory();renderButtons();renderGraph();renderGraphInspector();renderPipeline();persist();
}
function commit(description,world,{resetBaseline=false,graph=state.graph}={}){
  const next=validateWorld(world);
  const nextGraph=checkGraphShape(graph);
  if(JSON.stringify(next)===JSON.stringify(state.world)&&JSON.stringify(nextGraph)===JSON.stringify(state.graph)){
    feedback('世界规则没有变化。',true);return false;
  }
  state.past.push({world:{...state.world},graph:structuredClone(state.graph),description});
  state.past=state.past.slice(-50);state.future=[];
  state.world=next;state.graph=nextGraph;
  if(resetBaseline){state.baseline={...next};state.baselineGraph=structuredClone(nextGraph);state.baselineScene=generateCity(next,evaluateGraph(nextGraph).features);}
  log(description);refreshAll();const diagnostic=evaluateGraph(state.graph);feedback(diagnostic.valid?`已执行：${description}。场景已按规则重新计算。`:`已保存连线修改，但生成链未完成：${diagnostic.message}`,!diagnostic.valid);
  return true;
}
function setParameter(key,value,label){
  const result=applyCommand(state.world,{type:'set',key,value,description:label});
  if(!result.ok){feedback(result.error,true);return;}
  commit(label,result.world);
}
function runInstruction(text){
  const graphCmd=parseGraphLanguage(text);
  if(graphCmd){
    try{
      const node=graphNode(graphCmd.type);
      const next=node?state.graph:addGraphNode(state.graph,graphCmd.type);
      const graph=setGraphNodeActive(next,graphCmd.type,graphCmd.enabled);
      if(commit(`${graphCmd.enabled?'接入':'绕过'} ${NODE_DEFS[graphCmd.type].cn}`,state.world,{graph})){$('command-input').value='';}
    }catch(error){feedback(error.message,true);}return;
  }
  const command=parseCommand(text);
  const result=applyCommand(state.world,command);
  if(!result.ok){feedback(result.error,true);toast('无法执行：请调整指令');return;}
  commit(result.description,result.world,{resetBaseline:command.type==='generate',graph:command.type==='generate'?defaultGraph():state.graph});
  $('command-input').value='';
}
function undo(){
  if(!state.past.length)return;
  const item=state.past.pop();state.future.push({world:{...state.world},graph:structuredClone(state.graph),description:item.description});
  state.world=item.world;state.graph=item.graph;log(`撤销：${item.description}`);refreshAll();feedback(`已撤销：${item.description}`);
}
function redo(){
  if(!state.future.length)return;
  const item=state.future.pop();state.past.push({world:{...state.world},graph:structuredClone(state.graph),description:item.description});
  state.world=item.world;state.graph=item.graph;log(`重做：${item.description}`);refreshAll();feedback(`已重做：${item.description}`);
}
function renderButtons(){ $('undo-btn').disabled=state.past.length===0;$('redo-btn').disabled=state.future.length===0; }
function renderMetrics(){
  const m=state.scene.metrics;
  const content=[
    ['BUILDINGS',fmt(m.total),'栋'],['AVG. HEIGHT',fmt(m.avgHeight,1),'m'],['SITE COVERAGE',pct(m.coverage),''],['PUBLIC PLAZA',fmt(m.plazaArea),'m²']
  ];
  $('metric-strip').innerHTML=content.map(([label,v,unit])=>`<div class="metric"><label>${label}</label><div class="metric-value">${v} <small>${unit}</small></div></div>`).join('');
}
function renderTree(){
  const m=state.scene.metrics;
  let buildings=state.scene.buildings;
  if(!state.allBuildings){buildings=buildings.slice(0,10);const picked=state.scene.buildings.find(b=>b.id===state.selectedId);if(picked&&!buildings.includes(picked))buildings.unshift(picked);}
  $('scene-tree').innerHTML=`
    <div class="tree-heading">WORLD <span class="small-label">LIVE</span></div>
    <button class="tree-item selected" data-action="reset-camera"><span class="node-icon">◈</span><span>${escapeHTML(state.world.name)}</span></button>
    <button class="tree-item indent" data-action="reset-camera"><span class="node-icon gray">▱</span><span>Terrain / ${state.world.size}m</span></button>
    <div class="tree-heading">DISTRICTS <span class="small-label">02</span></div>
    <button class="tree-item indent" data-action="focus-region" data-region="east"><span class="node-icon">▥</span>East District <span class="node-count">${m.east}</span></button>
    <button class="tree-item indent" data-action="focus-region" data-region="west"><span class="node-icon">▥</span>West District <span class="node-count">${m.west}</span></button>
    <div class="tree-heading">SCENE OBJECTS <span class="small-label">${m.total}</span></div>
    ${buildings.map(b=>`<button class="tree-item small-indent bld ${b.id===state.selectedId?'selected':''}" data-select="${b.id}"><span class="node-icon gray">▣</span><span>${b.id}</span><span class="secondary">${fmt(b.height)}m</span></button>`).join('')}
    <button class="tree-more" id="expand-buildings">${state.allBuildings?'收起对象列表':'查看全部 '+m.total+' 个建筑对象'} ${state.allBuildings?'↑':'↓'}</button>
  `;
  $('scene-tree').querySelectorAll('[data-select]').forEach(btn=>btn.addEventListener('click',()=>selectBuilding(btn.dataset.select,true)));
  $('scene-tree').querySelectorAll('[data-action="reset-camera"]').forEach(btn=>btn.addEventListener('click',()=>renderer?.resetCamera()));
  $('scene-tree').querySelectorAll('[data-action="focus-region"]').forEach(btn=>btn.addEventListener('click',()=>{
    if(!renderer)return;
    renderer.camera.target=[btn.dataset.region==='east'?state.world.size*.23:-state.world.size*.23,15,0];renderer.camera.distance=Math.max(190,state.world.size*.8);
  }));
  $('expand-buildings').addEventListener('click',()=>{state.allBuildings=!state.allBuildings;renderTree();});
}
function renderPipeline(){
  const active=new Set(evaluateGraph(state.graph).path);
  $('pipeline').innerHTML=pipelineNames.map((n,i)=>`<div class="pipeline-step" style="opacity:${active.has(n.key)?1:.35}"><span class="num">${String(i+1).padStart(2,'0')}</span><span>${n.name}</span><span class="line"></span></div>`).join('');
}
function ruleControl(name,label,value,step,min,max,unit,track=1,description=''){
  const suffix=unit==='%'?pct(value):unit==='m'?`${fmt(value)}m`:unit==='×'?`${fmt(value,2)}×`:fmt(value);
  const bar=Math.max(0,Math.min(100,value/track*100));
  return `<div class="setting"><div><div class="setting-label">${label}</div>${description?`<span class="detail">${description}</span>`:''}</div><div class="setting-control"><button class="increment" type="button" data-rule="${name}" data-diff="-${step}" aria-label="降低${label}">−</button><span class="setting-value">${suffix}</span><button class="increment" type="button" data-rule="${name}" data-diff="${step}" aria-label="提高${label}">+</button></div></div><div class="rule-track"><span style="width:${bar}%"></span></div>`;
}
function bindRules(){
  document.querySelectorAll('[data-rule]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.rule,step=Number(button.dataset.diff);
    const min=key.endsWith('Density')?0:key==='heightScale'?.2:20;
    const max=key.endsWith('Density')?1:key==='heightScale'?3:Math.min(state.world.size/2-15,160);
    const value=Math.round(Math.max(min,Math.min(max,state.world[key]+step))*1000)/1000;
    const names={eastDensity:'东侧建筑密度',westDensity:'西侧建筑密度',heightScale:'整体建筑高度倍率',plazaRadius:'中央开放空间半径'};
    setParameter(key,value,`${names[key]}调整为 ${key.endsWith('Density')?pct(value):key==='heightScale'?fmt(value,2)+'×':value+'m'}`);
  }));
}
function renderRules(){
  const w=state.world;
  $('global-rules').innerHTML=`<div class="setting inline"><span class="setting-label">场景面积</span><span class="pill">${w.size} × ${w.size}m</span></div><div class="setting inline"><span class="setting-label">随机种子</span><div class="setting-control"><span class="setting-value">#${w.seed}</span><button class="increment" id="reroll-seed" title="重新抽取布局随机种子">↻</button></div></div>${ruleControl('heightScale','高度倍率',w.heightScale,.1,.2,3,'×',3,'全城高度梯度')}${ruleControl('plazaRadius','中央开放空间半径',w.plazaRadius,10,20,160,'m',160)}`;
  $('district-rules').innerHTML=`${ruleControl('eastDensity','东侧建筑密度',w.eastDensity,.05,0,1,'%',1,'基于确定性候选网格')}${ruleControl('westDensity','西侧建筑密度',w.westDensity,.05,0,1,'%',1,'不受东侧编辑影响')}`;
  $('reroll-seed').addEventListener('click',()=>setParameter('seed',state.world.seed+1,`重新抽取随机种子 #${state.world.seed+1}`));
  bindRules();
}
function selectBuilding(id,focus=false){
  state.selectedId=id;
  if(renderer){renderer.setSelected(id);if(focus&&id){const b=state.scene.buildings.find(q=>q.id===id);renderer.focus(b);}}
  renderTree();renderSelection();
}
function renderSelection(){
  const b=state.scene.buildings.find(b=>b.id===state.selectedId);
  if(!b){ $('object-inspector').innerHTML='<p class="muted-text">点击三维视窗中的任意建筑，查看它的稳定 ID、位置、高度和所属分区。</p>';$('selection-callout').hidden=true;return; }
  $('object-inspector').innerHTML=`<div class="object-card"><div class="object-title">▣ ${b.id}</div><div class="object-data"><div><span>分区</span><strong>${b.region}</strong></div><div><span>结构类型</span><strong>${b.type}</strong></div><div><span>高度</span><strong>${fmt(b.height,1)} m</strong></div><div><span>基底面积</span><strong>${fmt(b.footprint,1)} m²</strong></div><div><span>X / Z</span><strong>${fmt(b.x,1)} / ${fmt(b.z,1)}</strong></div><div><span>实例 ID</span><strong>${b.id}</strong></div></div></div>`;
  $('selection-callout').hidden=false;
  $('selection-callout').innerHTML=`<strong>${b.id}</strong>${b.region} · ${fmt(b.height,1)}m<br>点击其他建筑切换选择`;
}
function renderComparison(){
  const b=state.baselineScene.metrics,c=state.scene.metrics;
  const d=(value,after,unit='')=>{const diff=after-value,sign=diff>0?'+':'';return `<strong class="${diff<0?'negative':diff>0?'positive':''}">${sign}${fmt(diff,unit==='%'?1:0)}${unit}</strong>`;};
  const pctChange=(before,after)=>before===0?0:(after-before)/before*100;
  $('comparison').innerHTML=`
    <div class="delta-row"><span>总建筑数量</span><span>${fmt(b.total)} → ${fmt(c.total)} &nbsp; ${d(b.total,c.total)}</span></div>
    <div class="tiny-progress"><span style="width:${Math.min(c.total/Math.max(1,b.total)*75,100)}%"></span></div>
    <div class="delta-row"><span>东侧建筑数量</span><span>${fmt(b.east)} → ${fmt(c.east)} &nbsp; ${d(b.east,c.east)}</span></div>
    <div class="tiny-progress"><span style="width:${Math.min(c.east/Math.max(1,b.east)*75,100)}%"></span></div>
    <div class="delta-row"><span>平均建筑高度</span><span>${fmt(b.avgHeight,1)} → ${fmt(c.avgHeight,1)}m</span></div>
    <div class="delta-row"><span>平均高度变化</span><strong class="${pctChange(b.avgHeight,c.avgHeight)<0?'negative':'positive'}">${pctChange(b.avgHeight,c.avgHeight)>=0?'+':''}${fmt(pctChange(b.avgHeight,c.avgHeight),1)}%</strong></div>
    <div class="delta-row"><span>建筑变化</span><strong>${compareScenes(state.baselineScene,state.scene).removed} 删除 · ${compareScenes(state.baselineScene,state.scene).modified} 修改</strong></div>
    <p class="muted-text">对照基线: ${escapeHTML(state.baseline.name)} · Seed #${state.baseline.seed}</p>`;
}
function renderHistory(){
  $('history-list').innerHTML=state.logs.slice(0,5).map(l=>`<div class="history-row"><span>${escapeHTML(l.time)}</span><strong>${escapeHTML(l.description)}</strong></div>`).join('');
}
function downloadScene(){
  const data=JSON.stringify({...makeExport(state.world,state.logs),graph:state.graph},null,2);
  const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`worldcraft-scene-seed-${state.world.seed}.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出结构化场景 JSON');
}
async function importScene(file){
  if(!file)return;
  try{
    if(file.size>2_000_000)throw new Error('场景文件过大');
    const doc=JSON.parse(await file.text());
    const world=readExport(doc);
    const graph=doc.graph?graphFromFile(doc.graph):defaultGraph();
    if(JSON.stringify(world)===JSON.stringify(state.world)&&JSON.stringify(graph)===JSON.stringify(state.graph)){
      toast('场景已是当前版本');return;
    }
    commit('导入场景 '+file.name,world,{resetBaseline:true,graph});
    toast('场景导入成功');
  }catch(error){feedback(`导入失败：${error.message}`,true);toast('场景文件无效');}
}
function wireEvents(){
  $('command-form').addEventListener('submit',e=>{e.preventDefault();runInstruction($('command-input').value);});
  $('command-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('command-form').requestSubmit();}});
  $('prompt-examples').innerHTML=demoPrompts.map((p,i)=>`<button class="prompt-chip" type="button" data-example="${i}">${['生成示例城市','东侧密度 −30%','整体高度 +20%','开放空间 +20%'][i]}</button>`).join('');
  $('prompt-examples').querySelectorAll('[data-example]').forEach(btn=>btn.addEventListener('click',()=>{const value=demoPrompts[Number(btn.dataset.example)];$('command-input').value=value;runInstruction(value);}));
  $('undo-btn').addEventListener('click',undo);$('redo-btn').addEventListener('click',redo);
  $('camera-reset').addEventListener('click',()=>renderer?.resetCamera());
  $('zoom-in').addEventListener('click',()=>renderer?.zoom(.8));$('zoom-out').addEventListener('click',()=>renderer?.zoom(1.25));
  $('export-btn').addEventListener('click',downloadScene);
  $('import-btn').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async e=>{await importScene(e.target.files?.[0]);e.target.value='';});
  $('set-baseline').addEventListener('click',()=>{if(!evaluateGraph(state.graph).valid){toast('先修复生成链再设置基线');return;}state.baseline={...state.world};state.baselineGraph=structuredClone(state.graph);state.baselineScene=generateCity(state.baseline,evaluateGraph(state.baselineGraph).features);persist();renderComparison();toast('已将当前世界设为新的比较基线');});
  window.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){
      e.preventDefault();if(e.shiftKey)redo();else undo();
    }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}
    if(e.key==='Escape'&&document.activeElement!==$('command-input'))selectBuilding(null);
  });
}
const graphParams={
  size:{name:'世界尺寸',min:200,max:800,step:20,unit:'m'},
  seed:{name:'随机种子',min:0,max:1000000000,step:1,unit:''},
  plazaRadius:{name:'开放空间半径',min:20,max:160,step:5,unit:'m'},
  promenadeWidth:{name:'公共廊道宽度',min:4,max:28,step:1,unit:'m'},
  eastDensity:{name:'东侧分布概率',min:0,max:1,step:.05,unit:'ratio'},
  westDensity:{name:'西侧分布概率',min:0,max:1,step:.05,unit:'ratio'},
  heightScale:{name:'高度倍率',min:.2,max:3,step:.1,unit:'×'}
};
const GRAPH_NODE_W=154;
function graphNode(id){return state.graph.nodes.find(n=>n.id===id);}
function renderGraph(){
  const evaluation=evaluateGraph(state.graph),active=new Set(evaluation.path);
  const badge=$('graph-status');badge.textContent=evaluation.valid?'● '+evaluation.message:'⚠ '+evaluation.message;badge.classList.toggle('invalid',!evaluation.valid);
  $('graph-count').textContent=`${state.graph.nodes.length} MODULES / ${evaluation.path.length} ACTIVE`;
  $('graph-hint').textContent=state.graphPending?`已选择 ${NODE_DEFS[state.graphPending].cn} 输出端口，请点击目标节点左侧输入端口`:'选择节点 → 编辑参数 / 点击输出圆点 → 再点击输入圆点建立连接';
  $('graph-nodes').innerHTML=state.graph.nodes.map(n=>{
    const def=NODE_DEFS[n.type],inPath=active.has(n.id);
    const value={seed:`#${state.world.seed} · ${state.world.size}m`,grid:'20m × 20m',plaza:`半径 ${state.world.plazaRadius}m`,promenade:`宽度 ${state.world.promenadeWidth}m`,density:`东 ${pct(state.world.eastDensity)} / 西 ${pct(state.world.westDensity)}`,height:`高度 ×${fmt(state.world.heightScale,2)}`,instances:`${fmt(state.scene.metrics.total)} 栋 · 3D`}[n.type];
    return `<div class="graph-node ${inPath?'active':'dormant'} ${state.selectedNode===n.id?'selected':''}" data-node="${n.id}" style="left:${n.x}px;top:${n.y}px">
      ${n.type!=='seed'?`<button type="button" class="graph-port input" data-port="in" data-node-id="${n.id}" aria-label="${def.cn} 输入端口"></button>`:''}
      ${n.type!=='instances'?`<button type="button" class="graph-port output ${state.graphPending===n.id?'pending':''}" data-port="out" data-node-id="${n.id}" aria-label="${def.cn} 输出端口"></button>`:''}
      <div class="graph-node-head" data-drag="${n.id}"><span class="graph-name">${escapeHTML(def.name)}</span><strong>${escapeHTML(def.cn)}</strong></div><div class="graph-node-body">${escapeHTML(value)}<br><span>${escapeHTML(def.subtitle)}</span></div><span class="graph-node-chip">${def.required?'◆':''}</span>
    </div>`;
  }).join('');
  renderGraphWires(active);
  const select=$('graph-add-type'),prev=select.value;
  select.innerHTML='<option value="">添加模块…</option>'+Object.entries(NODE_DEFS).filter(([type,def])=>!def.required&&!graphNode(type)).map(([type,def])=>`<option value="${type}">${escapeHTML(def.cn)}</option>`).join('');
  if([...select.options].some(o=>o.value===prev))select.value=prev;
}
function renderGraphWires(active=new Set(evaluateGraph(state.graph).path)){
  $('graph-wires').innerHTML=state.graph.edges.map(e=>{
    const a=graphNode(e.from),b=graphNode(e.to);
    if(!a||!b)return '';
    const x1=a.x+GRAPH_NODE_W,y1=a.y+59,x2=b.x,y2=b.y+59;
    const bend=Math.max(50,Math.abs(x2-x1)*.48);
    const on=active.has(a.id)&&active.has(b.id);
    return `<path class="graph-edge ${on?'':'dormant'}" d="M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}"/>`;
  }).join('');
}
function renderGraphInspector(){
  let selected=graphNode(state.selectedNode);
  if(!selected){selected=state.graph.nodes.find(n=>n.type==='density');state.selectedNode=selected?.id??null;}
  if(!selected)return;
  const def=NODE_DEFS[selected.type],diagnosis=evaluateGraph(state.graph),active=diagnosis.path.includes(selected.id);
  const controls=def.params.map(key=>{
    const spec=graphParams[key],value=state.world[key];
    return `<label class="graph-param"><span>${spec.name}</span><input type="number" data-graph-param="${key}" min="${spec.min}" max="${key==='plazaRadius'?Math.min(spec.max,state.world.size/2-15):spec.max}" step="${spec.step}" value="${value}" aria-label="${spec.name}"></label>`;
  }).join('');
  $('graph-node-inspector').innerHTML=`<div class="graph-node-headline">${escapeHTML(def.cn)}</div><div class="graph-node-help">${escapeHTML(def.subtitle)}。${def.required?'必需模块不可删除。':'可绕过或重新接入生成链。'}</div>
    ${controls||'<p class="muted-text">这个模块暂时没有可调参数，可通过连接关系控制是否参与生成。</p>'}
    ${!active?'<div class="graph-inspector-flag">⚠ 该模块未连接到主生成链，修改参数不会影响世界。</div>':''}
    <div class="graph-node-actions">${!def.required?`<button type="button" data-graph-toggle="${selected.type}">${active?'绕过模块':'接入生成链'}</button><button class="danger" type="button" data-graph-delete="${selected.type}">删除模块</button>`:''}<button type="button" id="graph-focus-node">在图中定位</button></div>`;
}
function updateGraphChange(label,graph){
  const ok=commit(label,state.world,{graph});
  if(ok){state.graphPending=null;renderGraph();renderGraphInspector();}
}
function wireGraphEvents(){
  document.querySelectorAll('[data-dock]').forEach(btn=>btn.addEventListener('click',()=>{
    state.dock=btn.dataset.dock;
    document.querySelectorAll('[data-dock]').forEach(x=>x.classList.toggle('active',x===btn));
    $('graph-pane').hidden=state.dock!=='graph';$('command-pane').hidden=state.dock!=='command';
  }));
  $('graph-add-btn').addEventListener('click',()=>{
    const type=$('graph-add-type').value;
    if(!type){toast('先选择可添加的模块');return;}
    try{const next=addGraphNode(state.graph,type);state.selectedNode=type;updateGraphChange(`添加 ${NODE_DEFS[type].cn} 模块`,next);}catch(e){feedback(e.message,true);}
  });
  $('graph-reset-btn').addEventListener('click',()=>{
    state.graphPending=null;
    updateGraphChange('恢复默认 PCG Graph',defaultGraph());
  });
  $('graph-node-inspector').addEventListener('change',e=>{
    const input=e.target.closest('[data-graph-param]');if(!input)return;
    const key=input.dataset.graphParam,value=Number(input.value),spec=graphParams[key];
    if(!Number.isFinite(value)||value<spec.min||value>spec.max){feedback(`${spec.name}超出允许范围`,true);renderGraphInspector();return;}
    const r=applyCommand(state.world,{type:'set',key,value,description:`调整 ${spec.name}`});
    if(!r.ok){feedback(r.error,true);renderGraphInspector();return;}
    commit(`节点 ${NODE_DEFS[state.selectedNode].cn}：${spec.name} → ${value}`,r.world);
  });
  $('graph-node-inspector').addEventListener('click',e=>{
    const toggle=e.target.closest('[data-graph-toggle]'),del=e.target.closest('[data-graph-delete]');
    if(toggle){const type=toggle.dataset.graphToggle;
      try{const active=evaluateGraph(state.graph).path.includes(type);updateGraphChange(`${active?'绕过':'启用'} ${NODE_DEFS[type].cn}`,setGraphNodeActive(state.graph,type,!active));}
      catch(error){feedback(error.message,true);toast(error.message);}return;
    }
    if(del){const type=del.dataset.graphDelete;
      try{state.selectedNode='density';updateGraphChange(`删除 ${NODE_DEFS[type].cn}`,removeGraphNode(state.graph,type));}
      catch(error){feedback(error.message,true);}return;
    }
    if(e.target.closest('#graph-focus-node')){
      const node=graphNode(state.selectedNode);if(node){state.dock='graph';document.querySelector('[data-dock="graph"]').click();$('graph-scroll').scrollLeft=Math.max(0,node.x-160);}
    }
  });
  $('graph-nodes').addEventListener('click',e=>{
    const port=e.target.closest('[data-port]');
    if(port){
      const id=port.dataset.nodeId;
      if(port.dataset.port==='out'){
        state.graphPending=state.graphPending===id?null:id;
        renderGraph();return;
      }
      if(!state.graphPending){toast('先点击源节点右侧的输出圆点');return;}
      try{const from=state.graphPending,to=id;const next=connectGraph(state.graph,from,to);state.graphPending=null;updateGraphChange(`重连 ${NODE_DEFS[from].cn} → ${NODE_DEFS[to].cn}`,next);}
      catch(error){feedback('连线失败：'+error.message,true);toast(error.message);}
      return;
    }
    const node=e.target.closest('[data-node]');
    if(node){state.selectedNode=node.dataset.node;renderGraph();renderGraphInspector();}
  });
  $('graph-nodes').addEventListener('pointerdown',e=>{
    if(e.target.closest('[data-port]'))return;
    const head=e.target.closest('[data-drag]');if(!head)return;
    const id=head.dataset.drag,node=graphNode(id);if(!node)return;
    state.selectedNode=id;renderGraphInspector();
    const startX=e.clientX,startY=e.clientY,oldX=node.x,oldY=node.y;
    const dom=head.closest('.graph-node');if(!dom)return;
    e.preventDefault();head.setPointerCapture(e.pointerId);
    const move=event=>{
      const x=Math.round(Math.max(0,Math.min(2700,oldX+event.clientX-startX))),y=Math.round(Math.max(0,Math.min(1100,oldY+event.clientY-startY)));
      dom.style.left=x+'px';dom.style.top=y+'px';
      node.x=x;node.y=y;renderGraphWires();
    };
    const done=event=>{
      head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',done);head.removeEventListener('pointercancel',done);
      const x=node.x,y=node.y;node.x=oldX;node.y=oldY;
      if(Math.abs(x-oldX)+Math.abs(y-oldY)>3){updateGraphChange(`移动节点 ${NODE_DEFS[id].cn}`,moveGraphNode(state.graph,id,x,y));}
      else{renderGraph();}
    };
    head.addEventListener('pointermove',move);head.addEventListener('pointerup',done);head.addEventListener('pointercancel',done);
  });
}
function parseGraphLanguage(text){
  const s=String(text).toLowerCase().replace(/\s/g,'');
  const enabled=/开启|启用|恢复|添加|接入|enable|activate/.test(s),disabled=/关闭|禁用|取消|移除|去掉|删除|绕过|disable|bypass/.test(s);
  if(enabled===disabled)return null;
  const type=/开放空间|广场|plaza/.test(s)?'plaza':/廊道|通道|promenade/.test(s)?'promenade':/高度梯度|高度场|heightfield/.test(s)?'height':null;
  return type?{type,enabled}:null;
}

function initialize(){
  wireEvents();wireGraphEvents();
  try{
    renderer=new WorldRenderer($('world-canvas'),{onSelect:id=>selectBuilding(id)});
  }catch(err){try{renderer=new CanvasFallbackRenderer($('world-canvas'),{onSelect:id=>selectBuilding(id)});feedback('此环境禁用 WebGL2，已自动切换到软件三维预览。');}catch(fallbackError){$('viewer-error').hidden=false;$('viewer-error').textContent=`3D 视窗启动失败：${fallbackError.message}`;feedback(`浏览器图形接口不可用：${fallbackError.message}`,true);}}
  refreshAll();
}
initialize();
