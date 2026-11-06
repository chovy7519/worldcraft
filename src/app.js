import {DEFAULT_WORLD,generateCity,parseCommand,applyCommand,compareScenes,validateWorld,makeExport,readExport} from './pcg.mjs';
import {WorldRenderer,CanvasFallbackRenderer} from './renderer.js';
import {NODE_DEFS,defaultGraph,checkGraphShape,evaluateGraph,moveGraphNode,connectGraph,removeGraphNode,addGraphNode,setGraphNodeActive,graphFromFile} from './graph.mjs';
import {makeRoadAxes,createRoadTopology} from './polygonal.mjs';
import {networkFromTopology,moveRoadNode,resizeRoadEdge,splitRoadEdge,addRoadBranch,removeRoadNode,parseRoadEditInstruction} from './road-network.mjs';
import {validateSpatialInvariants} from './spatial.mjs';

const $=id=>document.getElementById(id);
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=n=>`${Math.round(n*100)}%`;
const fmt=(n,d=0)=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d});
const shortTime=()=>new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
const storeKey='worldcraft-v0.5-session';
const demoPrompts=[
  '生成一座 400×400m 的未来城市，中心高外围低，保留中央开放空间',
  '将东侧建筑密度降低 30%，其他区域不变',
  '整体建筑高度提高 20%',
  '斜路角度设为 50 度'
];
const pipelineNames=Object.entries(NODE_DEFS).map(([key,n])=>({key,name:n.cn}));
let persisted;
try{persisted=JSON.parse(localStorage.getItem(storeKey)||localStorage.getItem('worldcraft-v0.4-session')||localStorage.getItem('worldcraft-v0.2-session')||localStorage.getItem('worldcraft-v0.1-session')||'null');}catch(_){persisted=null;}
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
  roadSelection:{node:null,edge:null},
  roadBranchMode:false,
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
  $('world-caption').textContent+=state.scene.geometryMode?' / POLYGON PCG':'';
  renderMetrics();renderTree();renderRules();renderSelection();renderComparison();renderHistory();renderButtons();renderGraph();renderGraphInspector();renderPipeline();renderRoadEditor();persist();
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
  if(state.world.roadNetwork&&['roadSpacing','roadWidth','diagonalWidth','diagonalAngle','diagonalOffset','promenadeWidth'].includes(key)){
    feedback('当前使用可编辑道路图。请在「道路编辑器」中更改道路；或先还原自动路网。',true);toast('可编辑道路网络已覆盖自动路网规则');return;
  }
  const result=applyCommand(state.world,{type:'set',key,value,description:label});
  if(!result.ok){feedback(result.error,true);return;}
  commit(label,result.world);
}
function runInstruction(text){
  const roadCmd=parseRoadEditInstruction(text);
  if(roadCmd){
    try{
      if(roadCmd.type==='error')throw Error(roadCmd.message);
      const net=editorNetwork();
      let next,label;
      if(roadCmd.type==='move-node'){
        const node=net.nodes.find(n=>n.id===roadCmd.nodeId);
        if(!node)throw Error('找不到道路节点 '+roadCmd.nodeId);
        next=moveRoadNode(net,node.id,node.x+roadCmd.dx,node.z+roadCmd.dz,state.world.size);
        label=`自然语言移动节点 ${node.id} (${roadCmd.dx},${roadCmd.dz})m`;
      }else{
        next=resizeRoadEdge(net,roadCmd.edgeId,roadCmd.width,state.world.size);
        label=`自然语言修改路段 ${roadCmd.edgeId} 宽度 ${roadCmd.width}m`;
      }
      if(roadEdit(label,next))$('command-input').value='';
    }catch(error){feedback(error.message,true);toast(error.message);}
    return;
  }
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
    ['BUILDINGS',fmt(m.total),'栋'],['ROADS',fmt(m.roadSegments),'段'],['PARKS',fmt(m.parkCount),'块'],['TREES',fmt(m.treeCount),'棵'],['PARCELS',fmt(m.parcelCount),'块'],['PARK AREA',fmt(m.parkArea),'m²']
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
    <div class="tree-heading">SPATIAL LAYERS</div>
    <div class="tree-item indent"><span class="node-icon">═</span>道路网络 <span class="node-count">${m.roadSegments} 段${state.scene.roadGraph?' / '+state.scene.roadGraph.nodes.length+' 交点':''}</span></div>
    <div class="tree-item indent"><span class="node-icon">▦</span>地块划分 <span class="node-count">${m.parcelCount} 块</span></div>
    <div class="tree-item indent"><span class="node-icon">▤</span>多尺度公园 <span class="node-count">${m.parkCount} 块</span></div>
    <div class="tree-item indent"><span class="node-icon">♣</span>沿街 / 园内树木 <span class="node-count">${m.treeCount} 棵</span></div>
    <div class="tree-heading">BUILDINGS <span class="small-label">${m.total}</span></div>
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
  const suffix=unit==='%'?pct(value):unit==='m'?`${fmt(value)}m`:unit==='°'?`${fmt(value)}°`:unit==='×'?`${fmt(value,2)}×`:fmt(value);
  const bar=Math.max(0,Math.min(100,(value+(name==='diagonalOffset'?80:0))/(name==='diagonalOffset'?160:track)*100));
  return `<div class="setting"><div><div class="setting-label">${label}</div>${description?`<span class="detail">${description}</span>`:''}</div><div class="setting-control"><button class="increment" type="button" data-rule="${name}" data-diff="-${step}" aria-label="降低${label}">−</button><span class="setting-value">${suffix}</span><button class="increment" type="button" data-rule="${name}" data-diff="${step}" aria-label="提高${label}">+</button></div></div><div class="rule-track"><span style="width:${bar}%"></span></div>`;
}
const quickSpecs={
  eastDensity:{min:0,max:1,step:.05,label:'东侧建筑密度',unit:'%'},westDensity:{min:0,max:1,step:.05,label:'西侧建筑密度',unit:'%'},
  heightScale:{min:.2,max:3,step:.1,label:'高度倍率',unit:'×'},plazaRadius:{min:20,max:160,step:10,label:'中心绿心半径',unit:'m'},
  roadSpacing:{min:60,max:160,step:20,label:'道路中心距',unit:'m'},roadWidth:{min:6,max:22,step:2,label:'道路宽度',unit:'m'},
  diagonalWidth:{min:0,max:22,step:2,label:'斜向道路宽度',unit:'m'},diagonalAngle:{min:15,max:75,step:5,label:'斜向道路角度',unit:'°'},diagonalOffset:{min:-80,max:80,step:10,label:'斜向道路偏移',unit:'m'},
  parcelTargetWidth:{min:25,max:90,step:5,label:'地块目标宽度',unit:'m'},parkShare:{min:0,max:.65,step:.05,label:'公园地块比例',unit:'%'},
  treeSpacing:{min:8,max:35,step:1,label:'行道树间距',unit:'m'},treeDensity:{min:0,max:1,step:.1,label:'树木生成概率',unit:'%'}
};
function bindRules(){
  document.querySelectorAll('[data-rule]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.rule,spec=quickSpecs[key];if(!spec)return;
    let value=Math.round(Math.max(spec.min,Math.min(spec.max,state.world[key]+Number(button.dataset.diff)))*1000)/1000;
    if(key==='diagonalWidth' && value>0 && value<6)value=Number(button.dataset.diff)>0?6:0;
    if(key==='diagonalOffset')value=Math.max(-state.world.size/3,Math.min(state.world.size/3,value));
    const suffix=spec.unit==='%'?pct(value):spec.unit==='×'?fmt(value,2)+'×':spec.unit==='°'?value+'°':value+'m';
    setParameter(key,value,`${spec.label}调整为 ${suffix}`);
  }));
}
function renderRules(){
  const w=state.world;
  $('global-rules').innerHTML=`<div class="setting inline"><span class="setting-label">场景范围</span><span class="pill">${w.size} × ${w.size}m</span></div>
    <div class="setting inline"><span class="setting-label">随机种子</span><div class="setting-control"><span class="setting-value">#${w.seed}</span><button class="increment" id="reroll-seed" title="重新抽取布局随机种子">↻</button></div></div>
    ${ruleControl('roadSpacing','路网中心距',w.roadSpacing,20,60,160,'m',160)}
    ${ruleControl('roadWidth','道路宽度',w.roadWidth,2,6,22,'m',22)}
    ${ruleControl('diagonalWidth','斜路宽度 (0 为关闭)',w.diagonalWidth,2,0,22,'m',22)}
    ${ruleControl('diagonalAngle','斜路角度',w.diagonalAngle,5,15,75,'°',75)}
    ${ruleControl('diagonalOffset','斜路偏移',w.diagonalOffset,10,-80,80,'m',80)}
    ${ruleControl('parcelTargetWidth','地块目标宽度',w.parcelTargetWidth,5,25,90,'m',90)}
    ${ruleControl('parkShare','公园地块比例',w.parkShare,.05,0,.65,'%',.65)}
    ${ruleControl('treeSpacing','行道树间距',w.treeSpacing,1,8,35,'m',35)}
    ${ruleControl('treeDensity','树木生成概率',w.treeDensity,.1,0,1,'%',1)}`;
  $('district-rules').innerHTML=`${ruleControl('eastDensity','东侧建筑密度',w.eastDensity,.05,0,1,'%',1,'地块独立采样')}
    ${ruleControl('westDensity','西侧建筑密度',w.westDensity,.05,0,1,'%',1,'东侧改动不影响西侧')}
    ${ruleControl('heightScale','高度倍率',w.heightScale,.1,.2,3,'×',3)}
    ${ruleControl('plazaRadius','中心绿心半径',w.plazaRadius,10,20,160,'m',160)}`;
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
    <div class="delta-row"><span>道路段数</span><span>${fmt(b.roadSegments)} → ${fmt(c.roadSegments)}</span></div>
    <div class="delta-row"><span>公园地块</span><span>${fmt(b.parkCount)} → ${fmt(c.parkCount)} (${fmt(c.parkArea)}㎡)</span></div>
    <div class="delta-row"><span>树木数量</span><span>${fmt(b.treeCount)} → ${fmt(c.treeCount)}</span></div>
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
  $('prompt-examples').innerHTML=demoPrompts.map((p,i)=>`<button class="prompt-chip" type="button" data-example="${i}">${['生成示例城市','东侧密度 −30%','整体高度 +20%','道路间距 80m'][i]}</button>`).join('');
  $('prompt-examples').querySelectorAll('[data-example]').forEach(btn=>btn.addEventListener('click',()=>{const value=demoPrompts[Number(btn.dataset.example)];$('command-input').value=value;runInstruction(value);}));
  $('undo-btn').addEventListener('click',undo);$('redo-btn').addEventListener('click',redo);
  $('camera-reset').addEventListener('click',()=>renderer?.resetCamera());
  $('zoom-in').addEventListener('click',()=>renderer?.zoom(.8));$('zoom-out').addEventListener('click',()=>renderer?.zoom(1.25));
  $('export-btn').addEventListener('click',downloadScene);
  $('import-btn').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async e=>{await importScene(e.target.files?.[0]);e.target.value='';});
  $('set-baseline').addEventListener('click',()=>{if(!evaluateGraph(state.graph).valid){toast('先修复生成链再设置基线');return;}state.baseline=structuredClone(state.world);state.baselineGraph=structuredClone(state.graph);state.baselineScene=generateCity(state.baseline,evaluateGraph(state.baselineGraph).features);persist();renderComparison();toast('已将当前世界设为新的比较基线');});
  window.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){
      e.preventDefault();if(e.shiftKey)redo();else undo();
    }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}
    if(e.key==='Escape'&&document.activeElement!==$('command-input'))selectBuilding(null);
  });
}
const graphParams={
  roadSpacing:{name:'道路中心距',min:60,max:160,step:20,unit:'m'},
  roadWidth:{name:'道路宽度',min:6,max:22,step:1,unit:'m'},
  diagonalWidth:{name:'斜路宽度',min:0,max:22,step:2,unit:'m'},
  diagonalAngle:{name:'斜路角度',min:15,max:75,step:5,unit:'°'},
  diagonalOffset:{name:'斜路偏移',min:-80,max:80,step:10,unit:'m'},
  parcelTargetWidth:{name:'地块目标宽度',min:25,max:90,step:5,unit:'m'},
  parkShare:{name:'公园地块比例',min:0,max:.65,step:.05,unit:'%'},
  parkSmallMaxArea:{name:'小公园面积上限㎡',min:200,max:3000,step:100,unit:'㎡'},
  parkLargeMinArea:{name:'大型公园面积下限㎡',min:3000,max:12000,step:100,unit:'㎡'},
  buildingSetback:{name:'建筑退界',min:3,max:10,step:1,unit:'m'},
  treeSpacing:{name:'行道树间距',min:8,max:35,step:1,unit:'m'},
  treeRoadSetback:{name:'树木距道路边界',min:2.5,max:8,step:.5,unit:'m'},
  treeDensity:{name:'树木采样概率',min:0,max:1,step:.05,unit:'%'},
  parkTreeSpacing:{name:'园内树木间距',min:8,max:35,step:1,unit:'m'},
  treeCrownRadius:{name:'树冠半径',min:.8,max:2.5,step:.1,unit:'m'},
  treeBuildingClearance:{name:'树冠距建筑净距',min:0,max:5,step:.2,unit:'m'},
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
  const graphWidth=Math.max(1500,...state.graph.nodes.map(n=>n.x+190));
  $('graph-board').style.width=graphWidth+'px';$('graph-wires').setAttribute('width',graphWidth);$('graph-wires').setAttribute('viewBox',`0 0 ${graphWidth} 280`);
  const badge=$('graph-status');badge.textContent=evaluation.valid?'● '+evaluation.message:'⚠ '+evaluation.message;badge.classList.toggle('invalid',!evaluation.valid);
  $('graph-count').textContent=`${state.graph.nodes.length} MODULES / ${evaluation.path.length} ACTIVE`;
  $('graph-hint').textContent=state.graphPending?`已选择 ${NODE_DEFS[state.graphPending].cn} 输出端口，请点击目标节点左侧输入端口`:'选择节点 → 编辑参数 / 点击输出圆点 → 再点击输入圆点建立连接';
  $('graph-nodes').innerHTML=state.graph.nodes.map(n=>{
    const def=NODE_DEFS[n.type],inPath=active.has(n.id);
    const value={seed:`#${state.world.seed} · ${state.world.size}m`,promenade:`主街 ${state.world.promenadeWidth}m`,roads:`${state.scene.metrics.roadSegments} 段 · 间距 ${state.world.roadSpacing}m`,parcels:`${state.scene.metrics.parcelCount} 块 · 目标 ${state.world.parcelTargetWidth}m`,plaza:`半径 ${state.world.plazaRadius}m`,landuse:`${state.scene.metrics.parkCount} 公园地块`,density:`东 ${pct(state.world.eastDensity)} / 西 ${pct(state.world.westDensity)}`,height:`高度 ×${fmt(state.world.heightScale,2)}`,buildings:`${state.scene.metrics.total} 栋 · 3 种功能`,parks:`${state.scene.metrics.parkSizes.small}/${state.scene.metrics.parkSizes.medium}/${state.scene.metrics.parkSizes.large} 小/中/大`,trees:`${state.scene.metrics.treeCount} 棵 · 避让检查`,instances:`道路 + 地块 + 建筑 + 公园 + 树`}[n.type];
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
  if(!selected){selected=state.graph.nodes.find(n=>n.type==='roads');state.selectedNode=selected?.id??null;}
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
    $('graph-pane').hidden=state.dock!=='graph';$('command-pane').hidden=state.dock!=='command';$('road-pane').hidden=state.dock!=='roads';
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
    if(state.world.roadNetwork&&['roadSpacing','roadWidth','diagonalWidth','diagonalAngle','diagonalOffset','promenadeWidth'].includes(key)){feedback('可编辑道路网络已覆盖自动道路参数。请在道路编辑器中修改。',true);renderGraphInspector();return;}
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
  const type=/开放空间|中心绿心|广场|plaza/.test(s)?'plaza':/主街|廊道|promenade/.test(s)?'promenade':/高度梯度|高度场|heightfield/.test(s)?'height':null;
  return type?{type,enabled}:null;
}


/** V0.5: road topology editor; 2D site coordinates are identical to the 3D X/Z plane. */
function editorNetwork(){
  if(state.world.roadNetwork)return state.world.roadNetwork;
  const roadGraph=state.scene.roadGraph??createRoadTopology(makeRoadAxes(state.world,evaluateGraph(state.graph).features),state.world.size);
  return networkFromTopology(roadGraph,state.world.size);
}
function roadEdit(label,roadNetwork){
  try{
    const world=validateWorld({...state.world,roadNetwork});
    const features=evaluateGraph(state.graph);
    if(!features.valid)throw Error('请先修复 PCG Graph 的生成链');
    const candidate=generateCity(world,features.features);
    const report=validateSpatialInvariants(candidate);
    if(!report.valid)throw Error('空间检查未通过：'+report.errors[0]+`（共 ${report.errors.length} 项）`);
    commit(label,world);
    return true;
  }catch(err){
    feedback('道路操作被拒绝：'+err.message,true);toast('几何冲突或地块无临路关系，已保留原场景');
    return false;
  }
}
function roadMarkup(network){
  const half=state.world.size/2, m=new Map(network.nodes.map(n=>[n.id,n])), selected=state.roadSelection;
  const verts=p=>p.map(([x,z])=>`${x},${z}`).join(' ');
  const parcels=state.scene.parcels.map(p=>{
    const poly=p.vertices??[[p.bounds.x0,p.bounds.z0],[p.bounds.x1,p.bounds.z0],[p.bounds.x1,p.bounds.z1],[p.bounds.x0,p.bounds.z1]];
    const fill=p.use==='park'?'#466f57':p.use==='commercial'?'#4f6367':p.use==='civic'?'#69685c':'#344e55';
    return `<polygon points="${verts(poly)}" fill="${fill}" stroke="#6c8380" stroke-width=".7"/>`;
  }).join('');
  const roads=network.edges.map(e=>{
    const a=m.get(e.from),b=m.get(e.to);
    return `<line class="road-segment ${selected.edge===e.id?'selected':''}" data-road-edge="${e.id}" x1="${a.x}" y1="${a.z}" x2="${b.x}" y2="${b.z}" stroke-width="${e.width}"/><line data-road-edge="${e.id}" x1="${a.x}" y1="${a.z}" x2="${b.x}" y2="${b.z}" stroke="transparent" stroke-width="${Math.max(e.width+5,15)}"/>`;
  }).join('');
  const nodes=network.nodes.map(n=>`<circle class="road-junction ${selected.node===n.id?'selected':''}" data-road-node="${n.id}" cx="${n.x}" cy="${n.z}" r="${selected.node===n.id?5:3.6}"/>`).join('');
  return `<rect x="${-half}" y="${-half}" width="${state.world.size}" height="${state.world.size}" fill="#203238"/>${parcels}${roads}${nodes}<circle id="road-drag-ghost" class="road-editor-ghost" cx="0" cy="0" r="5" visibility="hidden"/>`;
}
function renderRoadEditor(){
  const net=editorNetwork(),editing=!!state.world.roadNetwork;
  $('road-editor-badge').textContent=`${editing?'EDITABLE':'AUTO'} · ${net.nodes.length} NODES / ${net.edges.length} EDGES`;
  $('road-enable').disabled=editing;$('road-reset').disabled=!editing;
  $('road-split').disabled=!editing||!state.roadSelection.edge;
  $('road-branch').disabled=!editing||!state.roadSelection.node;
  $('road-delete').disabled=!editing||!state.roadSelection.node;
  $('road-branch').classList.toggle('active',state.roadBranchMode);
  const svg=$('road-map'),half=state.world.size/2;
  svg.setAttribute('viewBox',`${-half} ${-half} ${state.world.size} ${state.world.size}`);
  svg.innerHTML=roadMarkup(net);
  const n=net.nodes.find(n=>n.id===state.roadSelection.node),e=net.edges.find(e=>e.id===state.roadSelection.edge);
  if(n){$('road-info').innerHTML=`<strong>路口 ${escapeHTML(n.id)}</strong>坐标：X ${fmt(n.x,1)}m / Z ${fmt(n.z,1)}m<br/>连接道路：${net.edges.filter(e=>e.from===n.id||e.to===n.id).length} 条<br/><span class="road-note">${editing?'拖拽圆点修改空间拓扑。点击「新建支路」后，在平面空白处点击终点。':'点击「转为可编辑道路网络」以启用拖拽。'}</span>`;}
  else if(e){$('road-info').innerHTML=`<strong>道路 ${escapeHTML(e.id)}</strong>${escapeHTML(e.kind)} · ${escapeHTML(e.from)} → ${escapeHTML(e.to)}<br/>路幅：<input id="road-width-input" type="number" min="6" max="22" step="1" value="${e.width}" ${editing?'':'disabled'}/> m<span class="road-note">修改宽度会重算地块、建筑、公园与树木。</span>`;}
  else $('road-info').innerHTML=`<strong>${editing?'道路拓扑编辑':'道路网络预览'}</strong>选择道路查看宽度，选择节点查看坐标。<span class="road-note">${editing?'拖拽路口、拆分路段或添加分支。所有提交都经过空间碰撞与临路校验。':'点击「转为可编辑道路网络」，将当前生成结果转换为可保存的节点与道路段。'}</span>`;
}
function svgToWorld(svg,e){
  const rect=svg.getBoundingClientRect(),h=state.world.size/2;
  // Default preserveAspectRatio=xMidYMid meet: compensate for letterboxing.
  const scale=Math.min(rect.width/state.world.size,rect.height/state.world.size);
  const padX=(rect.width-scale*state.world.size)/2,padY=(rect.height-scale*state.world.size)/2;
  return {x:Math.round(Math.max(-h,Math.min(h,(e.clientX-rect.left-padX)/scale-h))*10)/10,
    z:Math.round(Math.max(-h,Math.min(h,(e.clientY-rect.top-padY)/scale-h))*10)/10};
}
function wireRoadEditor(){
  $('road-enable').addEventListener('click',()=>{
    if(roadEdit('转换为可编辑道路网络',editorNetwork())){state.roadSelection={node:null,edge:null};renderRoadEditor();}
  });
  $('road-reset').addEventListener('click',()=>{
    if(roadEdit('恢复参数化自动道路',null)){state.roadSelection={node:null,edge:null};state.roadBranchMode=false;renderRoadEditor();}
  });
  $('road-split').addEventListener('click',()=>{
    try{const item=splitRoadEdge(editorNetwork(),state.roadSelection.edge,state.world.size);
      if(roadEdit(`拆分道路 ${state.roadSelection.edge}`,item.network)){state.roadSelection={node:item.nodeId,edge:null};renderRoadEditor();}}
    catch(error){feedback(error.message,true);}
  });
  $('road-delete').addEventListener('click',()=>{
    try{const net=removeRoadNode(editorNetwork(),state.roadSelection.node,state.world.size);
      if(roadEdit(`删除道路节点 ${state.roadSelection.node}`,net)){state.roadSelection={node:null,edge:null};renderRoadEditor();}}
    catch(error){feedback(error.message,true);}
  });
  $('road-branch').addEventListener('click',()=>{state.roadBranchMode=!state.roadBranchMode;renderRoadEditor();toast(state.roadBranchMode?'在道路平面空白处点击，添加与选中节点连接的支路':'已退出添加支路模式');});
  $('road-info').addEventListener('change',e=>{
    if(e.target.id!=='road-width-input'||!state.roadSelection.edge)return;
    try{roadEdit(`调整道路 ${state.roadSelection.edge} 宽度`,resizeRoadEdge(editorNetwork(),state.roadSelection.edge,Number(e.target.value),state.world.size));}
    catch(error){feedback(error.message,true);renderRoadEditor();}
  });
  const svg=$('road-map');let dragging=null;
  svg.addEventListener('pointerdown',e=>{
    const node=e.target.closest('[data-road-node]'),edge=e.target.closest('[data-road-edge]');
    if(node){
      const id=node.dataset.roadNode;state.roadSelection={node:id,edge:null};renderRoadEditor();
      if(state.world.roadNetwork){const original=editorNetwork().nodes.find(n=>n.id===id);
        dragging={id,original,point:svgToWorld(svg,e),pointerId:e.pointerId};svg.setPointerCapture(e.pointerId);
      }return;
    }
    if(edge){state.roadSelection={node:null,edge:edge.dataset.roadEdge};state.roadBranchMode=false;renderRoadEditor();return;}
    if(state.roadBranchMode&&state.world.roadNetwork&&state.roadSelection.node){
      try{const p=svgToWorld(svg,e),result=addRoadBranch(editorNetwork(),state.roadSelection.node,p.x,p.z,state.world.size);
        if(roadEdit(`增加支路 ${result.edgeId}`,result.network)){state.roadSelection={node:result.nodeId,edge:null};state.roadBranchMode=false;renderRoadEditor();}}
      catch(err){feedback(err.message,true);toast(err.message);}
    }
  });
  svg.addEventListener('pointermove',e=>{
    if(!dragging||e.pointerId!==dragging.pointerId)return;
    const p=svgToWorld(svg,e),ghost=svg.querySelector('#road-drag-ghost');
    if(ghost){ghost.setAttribute('cx',p.x);ghost.setAttribute('cy',p.z);ghost.setAttribute('visibility','visible');}
    dragging.current=p;
  });
  const finish=e=>{
    if(!dragging||e.pointerId!==dragging.pointerId)return;
    const item=dragging;dragging=null;
    if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);
    if(e.type==='pointercancel'){renderRoadEditor();return;}
    const p=item.current??item.original;
    if(Math.hypot(p.x-item.original.x,p.z-item.original.z)>0.25){
      try{roadEdit(`移动路口 ${item.id} 至 ${p.x}, ${p.z}`,moveRoadNode(editorNetwork(),item.id,p.x,p.z,state.world.size));}
      catch(err){feedback(err.message,true);toast(err.message);}
    }
    renderRoadEditor();
  };
  svg.addEventListener('pointerup',finish);svg.addEventListener('pointercancel',finish);
}

function initialize(){
  wireEvents();wireGraphEvents();wireRoadEditor();
  try{
    renderer=new WorldRenderer($('world-canvas'),{onSelect:id=>selectBuilding(id)});
  }catch(err){try{renderer=new CanvasFallbackRenderer($('world-canvas'),{onSelect:id=>selectBuilding(id)});feedback('此环境禁用 WebGL2，已自动切换到软件三维预览。');}catch(fallbackError){$('viewer-error').hidden=false;$('viewer-error').textContent=`3D 视窗启动失败：${fallbackError.message}`;feedback(`浏览器图形接口不可用：${fallbackError.message}`,true);}}
  refreshAll();
}
initialize();
