import {generateVillage,sampleTerrain,measureVillage,validateVillage} from './village.mjs';
import {localPoint} from './village-households.mjs';

const $=id=>document.getElementById(id);
let scene,step=50,layer='terrain',playing=null,busy=false,selectedId=null;
const camera={yaw:.65,zoom:1,top:false,target:{x:0,z:0,height:0}};
const canvases=[$('adaptive'),$('baseline')];
const mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
const color=a=>`rgb(${a.join(',')})`;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function projection(canvas){
  const w=canvas.clientWidth,h=canvas.clientHeight,scale=Math.min(w/620,h/(camera.top?470:380))*camera.zoom;
  const c=Math.cos(camera.yaw),s=Math.sin(camera.yaw);
  const target=camera.target;
  return {scale,depth:p=>p.x*s+p.z*c,project:p=>[w/2+((p.x-target.x)*c-(p.z-target.z)*s)*scale,h*(camera.top?.50:.64)+((p.x-target.x)*s+(p.z-target.z)*c)*scale*(camera.top?1:.47)-(camera.top?0:((p.height??0)-target.height)*scale*1.1)]};
}
function polygon(ctx,points,fill,stroke){
  if(!points.length)return;ctx.beginPath();ctx.moveTo(...points[0]);for(const p of points.slice(1))ctx.lineTo(...p);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.4;ctx.stroke();}
}
function terrainColor(x,z){
  const t=sampleTerrain(scene.terrain,x,z);
  if(t.water)return [119,159,159];
  if(layer==='slope')return mix([185,207,152],[185,103,74],clamp(t.slope/35,0,1));
  if(layer==='suitability')return mix([188,158,125],[111,155,99],clamp(1-t.slope/scene.config.maxSlope,0,1));
  const height=t.height/100;
  return height<.5?mix([167,193,139],[148,171,120],height*2):mix([148,171,120],[169,158,131],(height-.5)*2);
}
function renderMap(canvas,baseline=false){
  if(!scene||canvas.clientWidth===0)return;
  const ratio=Math.min(devicePixelRatio||1,2),w=canvas.clientWidth,h=canvas.clientHeight;
  if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
  const view=projection(canvas),project=view.project,depth=view.depth,items=[],terrainItems=[];
  const model=baseline?comparisonModel():scene;
  const buildings=model.buildings.filter(b=>b.born<=step),roads=model.roads.filter(r=>r.born<=step);
  // A neutral inset frame keeps the terrain legible while rotating.
  ctx.strokeStyle='#c8d1be';ctx.lineWidth=.7;ctx.strokeRect(12,22,w-24,h-47);
  const sample=(x,z)=>({x,z,height:sampleTerrain(scene.terrain,x,z).height});
  // Terrain and surface roads share a painter queue; a road is split at every grid step.
  for(let z=-200;z<200;z+=10)for(let x=-200;x<200;x+=10){
    const points=[sample(x,z),sample(x+10,z),sample(x+10,z+10),sample(x,z+10)];
    const h0=points[0].height,h1=points[1].height,h3=points[3].height;
    const shade=clamp(1+(h0-h1)*.018+(h0-h3)*.012,.80,1.13);
    const fill=color(terrainColor(x+5,z+5).map(v=>Math.round(clamp(v*shade,0,255))));
    terrainItems.push({d:depth({x:x+5,z:z+5}),draw:()=>polygon(ctx,points.map(project),fill,fill)});
  }
  // Base walls expose the relief rather than flattening the mountain into a map.
  if(!camera.top){for(const edge of [[[-200,-200],[200,-200]],[[200,-200],[200,200]],[[200,200],[-200,200]],[[-200,200],[-200,-200]]]){
    const a=sample(...edge[0]),b=sample(...edge[1]);
    if(depth({x:(a.x+b.x)/2,z:(a.z+b.z)/2})<0)continue;
    const pts=[];for(let i=0;i<=40;i++){const t=i/40;pts.push(project(sample(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t)));}
    pts.push(project({...b,height:-8}),project({...a,height:-8}));polygon(ctx,pts,'#a8ae95');
  }}
  terrainItems.sort((a,b)=>a.d-b.d);for(const item of terrainItems)item.draw();
  if($('show-parcels').checked){
    for(const parcel of model.parcels??[]){if(parcel.born>step)continue;
      const active=!baseline&&parcel.buildingId===selectedId;
      for(const cell of parcel.cells){const pts=cell.map(([x,z])=>project({x,z,height:sampleTerrain(scene.terrain,x,z).height+.25}));polygon(ctx,pts,active?'rgba(214,175,94,.37)':'rgba(227,219,175,.16)');}
      ctx.strokeStyle=active?'#bb8639':'rgba(99,114,73,.65)';ctx.lineWidth=active?1.6:.7;
      for(const ring of parcel.rings){ctx.beginPath();ring.forEach(([x,z],i)=>{const p=project({x,z,height:sampleTerrain(scene.terrain,x,z).height+.35});if(i)ctx.lineTo(...p);else ctx.moveTo(...p);});ctx.closePath();ctx.stroke();}
      if(active&&!camera.top)for(const ring of parcel.rings)for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length];if(Math.hypot((a[0]+b[0])/2-parcel.gate.x,(a[1]+b[1])/2-parcel.gate.z)<parcel.enclosure.gateWidth)continue;
        const p={x:a[0],z:a[1],height:sampleTerrain(scene.terrain,...a).height},q={x:b[0],z:b[1],height:sampleTerrain(scene.terrain,...b).height};
        polygon(ctx,[project(p),project(q),project({...q,height:q.height+parcel.enclosure.height}),project({...p,height:p.height+parcel.enclosure.height})],'#aeaa8d','#8c9279');
      }
      if(active)for(const edge of parcel.frontage){ctx.beginPath();ctx.moveTo(...project({x:edge.a[0],z:edge.a[1],height:sampleTerrain(scene.terrain,...edge.a).height+.5}));ctx.lineTo(...project({x:edge.b[0],z:edge.b[1],height:sampleTerrain(scene.terrain,...edge.b).height+.5}));ctx.strokeStyle='#447a79';ctx.lineWidth=2;ctx.stroke();}
    }
    for(const b of buildings){if(!b.walkway)continue;
      for(const path of [b.walkway,b.roadConnection]){ctx.beginPath();path.forEach((p,i)=>{if(i)ctx.lineTo(...project({...p,height:p.height+.4}));else ctx.moveTo(...project({...p,height:p.height+.4}));});ctx.strokeStyle=b.id===selectedId&&!baseline?'#c19244':'#c3ab7d';ctx.lineWidth=Math.max(1,view.scale*1.3);ctx.stroke();}
      const gate=project(b.gate);ctx.fillStyle='#526e62';ctx.fillRect(gate[0]-1.5,gate[1]-1.5,3,3);
      if(!camera.top)for(const stair of b.entrySteps??[]){const p=project(stair);ctx.strokeStyle='#b6aa8c';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(p[0]-view.scale,p[1]);ctx.lineTo(p[0]+view.scale,p[1]);ctx.stroke();}
    }
  }
  for(const road of roads)for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],grade=Math.abs(a.height-b.height)/Math.hypot(a.x-b.x,a.z-b.z);
    const bad=baseline&&(grade>scene.config.maxRoadGrade||sampleTerrain(scene.terrain,(a.x+b.x)/2,(a.z+b.z)/2).water);
    items.push({d:depth({x:(a.x+b.x)/2,z:(a.z+b.z)/2}),order:1,draw:()=>{
      ctx.beginPath();ctx.moveTo(...project({...a,height:a.height+.5}));ctx.lineTo(...project({...b,height:b.height+.5}));
      ctx.strokeStyle=bad?'#c07559':road.kind==='main'?'#eee4cb':'#e1d5b9';
      ctx.lineWidth=Math.max(1,view.scale*(road.kind==='main'?4:2.8));ctx.lineCap='round';ctx.stroke();
    }});
  }
  // Surface overlays are depth-sorted; this lightweight preview has no terrain z-buffer.
  for(const b of buildings)items.push({d:depth(b),order:2,draw:()=>drawHouse(ctx,b,project,view,baseline)});
  items.sort((a,b)=>a.d-b.d||a.order-b.order);for(const item of items)item.draw();
  for(const [p,label,fill] of [[scene.entrance,'入口','#3f7983'],[scene.center,'生长中心','#b27c3f']]){
    const q=project({...p,height:sampleTerrain(scene.terrain,p.x,p.z).height+1});ctx.beginPath();ctx.arc(...q,3.5,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();
    ctx.font='9px "Segoe UI","Microsoft YaHei"';ctx.fillStyle='#485d46';ctx.fillText(label,q[0]+7,q[1]+3);
  }
  // North arrow and scale are drawn in screen space.
  ctx.font='9px "Segoe UI"';ctx.fillStyle='#7b8b73';ctx.fillText('N',w-30,38);
  ctx.strokeStyle='#89987e';ctx.beginPath();ctx.moveTo(w-27,45);ctx.lineTo(w-27,62);ctx.stroke();
  const length=50*view.scale;ctx.beginPath();ctx.moveTo(w-25-length,h-20);ctx.lineTo(w-25,h-20);ctx.stroke();ctx.fillText('50 m',w-25-length,h-25);
}
function drawHouse(ctx,b,project,view,baseline){
  const ground=(b.footprint??[[-5,-4],[5,-4],[5,4],[-5,4]].map(([dx,dz])=>({x:b.x+dx,z:b.z+dz}))).map(p=>({...p,height:sampleTerrain(scene.terrain,p.x,p.z).height}));
  const foundation=b.floorHeight??Math.max(...ground.map(p=>p.height))+.5,wall=foundation+b.floors*2.8;
  const bottom=ground.map(p=>project({...p,height:b.foundation?foundation:p.height})),top=ground.map(p=>project({...p,height:wall}));
  const bad=baseline&&Math.max(...ground.map(p=>sampleTerrain(scene.terrain,p.x,p.z).slope))>scene.config.maxSlope;
  const fresh=!baseline&&(b.id===selectedId||(b.born===step&&step<scene.buildings.length));
  if(camera.top){polygon(ctx,ground.map(p=>project(p)),bad?'#b4684b':'#936747','#6e6651');return;}
  for(const slab of b.foundation??[]){
    const slabTop=slab.points.map(p=>project({...p,height:slab.top})),slabBottom=slab.points.map((p,i)=>project({...p,height:slab.groundHeights[i]}));
    for(let i=0;i<4;i++){const j=(i+1)%4;polygon(ctx,[slabBottom[i],slabBottom[j],slabTop[j],slabTop[i]],i%2?'#9d9a85':'#b1ac96','#888b77');}
    polygon(ctx,slabTop,'#c3baa0');
  }
  const faceColors=['#b9b294','#d4cdb2','#e4dbc0','#c8bea0'];
  const faces=ground.map((p,i)=>({i,d:view.depth({x:(p.x+ground[(i+1)%4].x)/2,z:(p.z+ground[(i+1)%4].z)/2})})).sort((a,b)=>a.d-b.d);
  for(const {i,d} of faces){if(d<view.depth(b))continue;const j=(i+1)%4;
    polygon(ctx,[bottom[i],bottom[j],top[j],top[i]],bad?'#d1a58c':faceColors[i],'#a59b7f');
    const x=(top[i][0]+top[j][0])/2,y=(top[i][1]+top[j][1])/2+Math.max(2,view.scale*2.3);
    ctx.fillStyle='#596658';ctx.fillRect(x-1,y,Math.max(1,view.scale*1.8),Math.max(1,view.scale*2));
  }
  const ridge=[project({...localPoint(b,-5,0),height:wall+3.2}),project({...localPoint(b,5,0),height:wall+3.2})];
  polygon(ctx,[top[0],top[1],ridge[1],ridge[0]],bad?'#b45f40':'#9b7051','#82634a');
  polygon(ctx,[ridge[0],ridge[1],top[2],top[3]],bad?'#c47954':'#b88a60','#82634a');
  if(b.door){const p=project({...b.door,height:foundation+.1}),q=project({...b.door,height:foundation+2});ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.strokeStyle='#3b5147';ctx.lineWidth=Math.max(1.3,view.scale*1.5);ctx.stroke();}
  if(fresh){const p=project({...b,height:wall+6});ctx.strokeStyle='#e5ae4f';ctx.lineWidth=2;ctx.beginPath();ctx.arc(...p,7,0,Math.PI*2);ctx.stroke();}
}
function render(){canvases.forEach((canvas,i)=>renderMap(canvas,i===1));}
function comparisonModel(){return $('baseline-mode').value==='grid'?scene.baseline:scene.slopeBaseline;}
function updateInspector(){
  const visible=scene.buildings.filter(b=>b.born<=step);
  if(!visible.some(b=>b.id===selectedId))selectedId=visible[0]?.id??null;
  $('household-select').innerHTML=visible.map(b=>`<option value="${b.id}" ${b.id===selectedId?'selected':''}>住宅 ${b.id}</option>`).join('');
  $('household-select').disabled=!visible.length;$('focus-household').disabled=!visible.length;
  const b=visible.find(b=>b.id===selectedId),p=scene.parcels.find(p=>p.buildingId===selectedId);
  if(!b||!p){$('household-detail').innerHTML='<p class="field-note">当前阶段尚无住户。向前移动时间轴查看。</p>';return;}
  const pathLength=b.walkway.slice(1).reduce((sum,q,i)=>sum+Math.hypot(q.x-b.walkway[i].x,q.z-b.walkway[i].z),0);
  const angle=((b.rotation*180/Math.PI)%180+180)%180;
  $('household-detail').innerHTML=`<div><small>宅地 ${p.id}</small><strong>${p.area.toFixed(0)} <em>m²</em></strong><span>院落余地 ${(p.area-80).toFixed(0)} m² · 临路边 ${p.frontageLength.toFixed(1)} m</span></div><div><small>朝向与入口</small><strong>${angle.toFixed(0)}<em>° 等高线方向</em></strong><span>门 → 院内步道 → 院门 → 接路点</span></div><div><small>入户步道</small><strong>${pathLength.toFixed(1)} <em>m</em></strong><span>入口 ${b.entrySteps.length} 级踏步 · 院门已定位</span></div><div><small>阶梯基础标高</small><strong>${b.foundation.map(f=>f.top.toFixed(1)).join(' / ')} <em>m</em></strong><span>三段基础 · 地形相对标高</span></div>`;
}
function visibleMetrics(model){const b=model.buildings.filter(b=>b.born<=step),r=model.roads.filter(r=>r.born<=step);return measureVillage(scene.terrain,b,r,scene.config);}
function updateStep(){
  $('timeline').value=step;$('step-label').textContent=`${step} / ${scene.buildings.length}`;
  $('phase').textContent=step===0?'初始山路':step===scene.buildings.length?'完整村落':'逐步生长';
  $('event-text').textContent=step===0?'初始山路连接场地入口与生长中心，尚未选择住宅。':scene.events[step-1]?.reason??'';
  updateInspector();
  const control=comparisonModel(),a=visibleMetrics(scene),b=visibleMetrics(control);
  const entries=[['住宅数量','buildingCount','栋'],['建筑超坡 / 涉水',null,'栋'],['道路超坡 / 涉水',null,'m'],['道路总长','roadLength','m']];
  const rows=(v,isBase,unit,bad)=>`<div class="metric-row ${isBase?'base':''}"><small>${isBase?'B':'A'}</small><strong class="${bad?'bad':''}">${v}</strong><span>${unit}</span></div>`;
  $('metrics').innerHTML=entries.map(([title,key,unit],i)=>{
    const val=m=>i===1?`${m.slopeViolations} / ${m.waterViolations}`:i===2?`${Math.round(m.steepRoadLength)} / ${Math.round(m.waterRoadLength)}`:Math.round(m[key]);
    const bad=m=>i===1?m.slopeViolations+m.waterViolations>0:i===2?m.steepRoadLength+m.waterRoadLength>0:false;
    return `<div class="metric"><div class="metric-title">${title}</div>${rows(val(a),false,unit,bad(a))}${rows(val(b),true,unit,bad(b))}</div>`;
  }).join('');
  $('comparison-scope').textContent=`阶段 ${step} · 实际数量 A ${a.buildingCount} / B ${b.buildingCount} · 坡度均值 ${a.meanSlope}° / ${b.meanSlope}°`;
  render();
}
function pause(){if(playing)clearInterval(playing);playing=null;$('play').textContent='▶ 播放';$('play').setAttribute('aria-label','播放生长过程');}
function play(){if(playing){pause();return;}if(step>=scene.buildings.length)step=0;
  $('play').textContent='Ⅱ 暂停';$('play').setAttribute('aria-label','暂停生长过程');updateStep();
  playing=setInterval(()=>{step++;updateStep();if(step>=scene.buildings.length)pause();},320);
}
async function generate(){
  if(busy)return;pause();busy=true;$('generate').disabled=true;$('status').textContent='正在分析地形与道路…';$('error').hidden=true;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  try{
    const next=generateVillage({seed:Number($('seed').value),count:Number($('count').value),maxSlope:Number($('slope').value)});
    const report=validateVillage(next);if(!report.valid)throw Error(report.errors.join('；'));
    scene=next;step=scene.buildings.length;selectedId=scene.buildings[0]?.id??null;$('timeline').max=step;
    $('status').textContent=scene.status==='complete'?`${step} 栋住宅 · 空间检查通过`:`已生成 ${step} / ${scene.config.count} 栋 · 达到当前布局预算`;
    updateStep();
  }catch(error){$('error').hidden=false;$('error').textContent=error.message;$('status').textContent='生成失败，请调整参数';}
  finally{busy=false;$('generate').disabled=false;}
}
$('config-form').addEventListener('submit',event=>{event.preventDefault();generate();});
for(const [id,target,suffix] of [['count','count-value',' 栋'],['slope','slope-value','°']])$(id).addEventListener('input',()=>{$(target).textContent=$(id).value+suffix;});
$('shuffle').addEventListener('click',()=>{if(busy)return;$('seed').value=Math.floor(Math.random()*1e6);generate();});
document.querySelectorAll('[data-layer]').forEach(button=>button.addEventListener('click',()=>{
  layer=button.dataset.layer;document.querySelectorAll('[data-layer]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
  $('legend').innerHTML=layer==='terrain'?'<span>低海拔</span><i></i><span>高海拔</span>':layer==='slope'?'<span>平缓</span><i style="background:linear-gradient(90deg,#b9cf98,#b9674a)"></i><span>陡峭</span>':'<span>低适宜</span><i style="background:linear-gradient(90deg,#bc9e7d,#6f9b63)"></i><span>高适宜</span>';
  render();
}));
$('timeline').addEventListener('input',()=>{if(!scene)return;pause();step=Number($('timeline').value);updateStep();});
$('play').addEventListener('click',()=>{if(scene)play();});$('restart').addEventListener('click',()=>{if(!scene)return;pause();step=0;updateStep();});
$('top-view').addEventListener('change',()=>{camera.top=$('top-view').checked;render();});
$('show-parcels').addEventListener('change',render);
$('household-select').addEventListener('change',()=>{selectedId=$('household-select').value;updateInspector();render();});
$('focus-household').addEventListener('click',()=>{const b=scene?.buildings.find(b=>b.id===selectedId);if(!b)return;camera.target={x:b.x,z:b.z,height:b.height-25};camera.zoom=2.5;render();});
$('baseline-mode').addEventListener('change',()=>{
  const grid=$('baseline-mode').value==='grid';
  $('baseline-title').textContent=grid?'规则网格基线':'坡度随机布局';$('baseline-subtitle').textContent=grid?'固定网格 · 未按坡度优化':'相同硬约束与寻路 · 移除兴趣评分';
  $('baseline-note').textContent=grid?'实验对照：未按坡度优化的网格布局':'坡度随机对照 · 同地形、预算与建筑规则';
  $('baseline-explanation').textContent=grid?'保留旧网格示意，用于观察固定路网的山地局限。':'共用坡度、水域、间距与寻路约束；随机选址不计中心和邻里兴趣。';
  if(scene)updateStep();
});
$('compare').addEventListener('change',()=>{$('views').classList.toggle('single',!$('compare').checked);requestAnimationFrame(render);});
$('reset-view').addEventListener('click',()=>{camera.yaw=.65;camera.zoom=1;camera.target={x:0,z:0,height:0};render();});
const zoom=amount=>{camera.zoom=clamp(camera.zoom*amount,.65,2.5);render();};
$('zoom-in').addEventListener('click',()=>zoom(1.15));$('zoom-out').addEventListener('click',()=>zoom(1/1.15));
for(const canvas of canvases){let drag=null;
  canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,yaw:camera.yaw};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;camera.yaw=drag.yaw+(e.clientX-drag.x)*.008;render();});
  canvas.addEventListener('pointerup',e=>{if(drag&&canvas===$('adaptive')&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5&&scene){
    const rect=canvas.getBoundingClientRect(),click=[e.clientX-rect.left,e.clientY-rect.top],project=projection(canvas).project;
    const near=scene.buildings.filter(b=>b.born<=step).map(b=>{const p=project({...b,height:camera.top?b.height:(b.floorHeight??b.height)+b.floors*2.8});return {b,d:Math.hypot(p[0]-click[0],p[1]-click[1])};}).sort((a,b)=>a.d-b.d)[0];
    if(near&&near.d<18){selectedId=near.b.id;updateInspector();render();}}
    drag=null;
  });
  for(const name of ['pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{drag=null;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.08:1/1.08);},{passive:false});
  new ResizeObserver(()=>render()).observe(canvas);
}
$('export').addEventListener('click',()=>{
  if(!scene)return;
  const data={...scene,playbackStep:step,references:['https://perso.liris.cnrs.fr/egalin/Articles/2012-villages.pdf','https://perso.liris.cnrs.fr/egalin/Articles/2010-roads.pdf']};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`worldcraft-mountain-${scene.config.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
generate();
