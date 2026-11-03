import {DEFAULT_WORLD,generateCity,parseCommand,applyCommand,compareScenes,validateWorld,makeExport,readExport} from './pcg.mjs';
import {WorldRenderer,CanvasFallbackRenderer} from './renderer.js';

const $=id=>document.getElementById(id);
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=n=>`${Math.round(n*100)}%`;
const fmt=(n,d=0)=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d});
const shortTime=()=>new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
const storeKey='worldcraft-v0.1-session';
const demoPrompts=[
  '生成一座 400×400m 的未来城市，中心高外围低，保留中央开放空间',
  '将东侧建筑密度降低 30%，其他区域不变',
  '整体建筑高度提高 20%',
  '扩大中央开放空间 20%'
];
const pipelineNames=['Seed / 随机种子','Grid / 基础地块','Reserve / 开放空间','Density / 分布规则','Height / 高度场','Instances / 三维实例'];
let persisted;
try{persisted=JSON.parse(localStorage.getItem(storeKey)||'null');}catch(_){persisted=null;}
let initialWorld;
try{initialWorld=validateWorld(persisted?.world ?? {...DEFAULT_WORLD});}catch(_){initialWorld={...DEFAULT_WORLD};}
let initialBaseline;
try{initialBaseline=validateWorld(persisted?.baseline ?? {...DEFAULT_WORLD});}catch(_){initialBaseline={...DEFAULT_WORLD};}
const state={
  world:initialWorld,
  baseline:initialBaseline,
  scene:generateCity(initialWorld),
  baselineScene:generateCity(initialBaseline),
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
function persist(){try{localStorage.setItem(storeKey,JSON.stringify({world:state.world,baseline:state.baseline}));}catch(_){}}
function refreshAll(rebuild=true){
  state.scene=generateCity(state.world);
  if(state.selectedId&&!state.scene.buildings.find(b=>b.id===state.selectedId))state.selectedId=null;
  if(rebuild&&renderer){renderer.selected=state.selectedId;renderer.updateScene(state.scene);}
  $('project-name').textContent=state.world.name;
  $('world-caption').textContent=`${state.world.size} × ${state.world.size} M / FUTURE CITY`;
  $('seed-footnote').textContent=`SEED #${state.world.seed}`;
  $('mesh-count').textContent=fmt(state.scene.metrics.total);
  renderMetrics();renderTree();renderRules();renderSelection();renderComparison();renderHistory();renderButtons();persist();
}
function commit(description,world,{resetBaseline=false}={}){
  const next=validateWorld(world);
  if(JSON.stringify(next)===JSON.stringify(state.world)){
    feedback('世界规则没有变化。',true);return false;
  }
  state.past.push({world:{...state.world},description});
  state.past=state.past.slice(-50);state.future=[];
  state.world=next;
  if(resetBaseline){state.baseline={...next};state.baselineScene=generateCity(next);}
  log(description);refreshAll();feedback(`已执行：${description}。场景已按规则重新计算。`);
  return true;
}
function setParameter(key,value,label){
  const result=applyCommand(state.world,{type:'set',key,value,description:label});
  if(!result.ok){feedback(result.error,true);return;}
  commit(label,result.world);
}
function runInstruction(text){
  const command=parseCommand(text);
  const result=applyCommand(state.world,command);
  if(!result.ok){feedback(result.error,true);toast('无法执行：请调整指令');return;}
  commit(result.description,result.world,{resetBaseline:command.type==='generate'});
  $('command-input').value='';
}
function undo(){
  if(!state.past.length)return;
  const item=state.past.pop();state.future.push({world:{...state.world},description:item.description});
  state.world=item.world;log(`撤销：${item.description}`);refreshAll();feedback(`已撤销：${item.description}`);
}
function redo(){
  if(!state.future.length)return;
  const item=state.future.pop();state.past.push({world:{...state.world},description:item.description});
  state.world=item.world;log(`重做：${item.description}`);refreshAll();feedback(`已重做：${item.description}`);
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
  $('pipeline').innerHTML=pipelineNames.map((n,i)=>`<div class="pipeline-step"><span class="num">${String(i+1).padStart(2,'0')}</span><span>${n}</span><span class="line"></span></div>`).join('');
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
  const data=JSON.stringify(makeExport(state.world,state.logs),null,2);
  const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`worldcraft-scene-seed-${state.world.seed}.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出结构化场景 JSON');
}
async function importScene(file){
  if(!file)return;
  try{
    if(file.size>2_000_000)throw new Error('场景文件过大');
    const doc=JSON.parse(await file.text());
    const world=readExport(doc);
    if(JSON.stringify(world)===JSON.stringify(state.world)){
      toast('场景已是当前版本');return;
    }
    commit('导入场景 '+file.name,world,{resetBaseline:true});
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
  $('set-baseline').addEventListener('click',()=>{state.baseline={...state.world};state.baselineScene=generateCity(state.baseline);persist();renderComparison();toast('已将当前世界设为新的比较基线');});
  window.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){
      e.preventDefault();if(e.shiftKey)redo();else undo();
    }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}
    if(e.key==='Escape'&&document.activeElement!==$('command-input'))selectBuilding(null);
  });
}
function initialize(){
  renderPipeline();wireEvents();
  try{
    renderer=new WorldRenderer($('world-canvas'),{onSelect:id=>selectBuilding(id)});
  }catch(err){try{renderer=new CanvasFallbackRenderer($('world-canvas'),{onSelect:id=>selectBuilding(id)});feedback('此环境禁用 WebGL2，已自动切换到软件三维预览。');}catch(fallbackError){$('viewer-error').hidden=false;$('viewer-error').textContent=`3D 视窗启动失败：${fallbackError.message}`;feedback(`浏览器图形接口不可用：${fallbackError.message}`,true);}}
  refreshAll();
}
initialize();
