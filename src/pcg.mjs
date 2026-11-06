/** WorldCraft V0.3 — stable city rules, deterministic spatial pipeline. */
import {generateSpatialCity} from './spatial.mjs';
export const SCHEMA_VERSION = 2;
export const DEFAULT_WORLD = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  name: 'Coastal Future City',
  size: 400,
  seed: 42,
  eastDensity: 0.78,
  westDensity: 0.84,
  heightScale: 1,
  plazaRadius: 60,
  promenadeWidth: 10.5,
  roadSpacing: 100,
  roadWidth: 10,
  parcelTargetWidth: 42,
  parkShare: 0.20,
  parkSmallMaxArea: 1500,
  parkLargeMinArea: 3400,
  buildingSetback: 7,
  treeSpacing: 15,
  treeRoadSetback: 4,
  treeDensity: 0.72,
  parkTreeSpacing: 15,
  treeCrownRadius: 1.5,
  treeBuildingClearance: 1.3,
  extensions: Object.freeze({terrain:null,hydrology:null}),
  style: 'future'
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const approx = (a,b) => Math.abs(a-b)<1e-8;

/** Stable per-cell pseudorandom source. Results do not depend on iteration or occupancy. */
export function randomFor(seed, x, z, channel = 0) {
  let n = (Math.imul(seed|0, 374761393) ^ Math.imul(x+4096, 668265263) ^ Math.imul(z+4096, 2246822519) ^ Math.imul(channel+17, 3266489917)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

export function validateWorld(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的世界文件');
  if (![1,SCHEMA_VERSION].includes(input.schemaVersion)) throw new Error('不支持此世界文件版本');
  const world = {};
  for (const key of Object.keys(DEFAULT_WORLD)) {
    world[key] = key==='schemaVersion' ? SCHEMA_VERSION : (input[key] ?? DEFAULT_WORLD[key]);
  }
  const nums = ['size','seed','eastDensity','westDensity','heightScale','plazaRadius','promenadeWidth','roadSpacing','roadWidth','parcelTargetWidth','parkShare','parkSmallMaxArea','parkLargeMinArea','buildingSetback','treeSpacing','treeRoadSetback','treeDensity','parkTreeSpacing','treeCrownRadius','treeBuildingClearance'];
  for (const key of nums) if (typeof world[key] !== 'number' || !Number.isFinite(world[key])) throw new Error(`参数 ${key} 必须为有限数字`);
  if (!Number.isInteger(world.seed) || world.seed < 0 || world.seed > 1000000000) throw new Error('随机种子必须是 0–1,000,000,000 的整数');
  if (!Number.isInteger(world.size) || world.size < 200 || world.size > 800 || world.size % 20 !== 0) throw new Error('世界尺寸应为 200–800m 且为 20 的倍数');
  if (world.eastDensity < 0 || world.eastDensity > 1 || world.westDensity < 0 || world.westDensity > 1) throw new Error('建筑密度须在 0%–100% 之间');
  if (world.heightScale < 0.2 || world.heightScale > 3) throw new Error('高度倍率应为 0.2–3');
  if (world.promenadeWidth < 4 || world.promenadeWidth > 28) throw new Error('公共廊道宽度应为 4–28m');
  if (world.plazaRadius < 20 || world.plazaRadius > Math.min(world.size/2-15,160)) throw new Error('中央开放空间半径不在允许范围内');
  if(!world.extensions||typeof world.extensions!=='object'||Array.isArray(world.extensions)||Object.keys(world.extensions).some(k=>!['terrain','hydrology'].includes(k))||world.extensions.terrain!=null||world.extensions.hydrology!=null)throw Error('地形 / 水系扩展接口已预留，但本版本尚不接受扩展数据');
  world.extensions={terrain:null,hydrology:null};
  if (typeof world.name !== 'string' || world.name.length > 120) throw new Error('世界名称无效');
  if(!Number.isInteger(world.roadSpacing)||world.roadSpacing<60||world.roadSpacing>160||world.roadSpacing%20!==0)throw Error('道路间距须在 60–160m，且为 20m 的倍数');
  if(world.roadWidth<6||world.roadWidth>22||world.roadWidth>=world.roadSpacing/3)throw Error('道路宽度须为 6–22m 且小于道路间距的三分之一');
  if(world.parcelTargetWidth<25||world.parcelTargetWidth>90)throw Error('地块目标尺度须为 25–90m');
  if(world.parkShare<0||world.parkShare>0.65)throw Error('公园地块比例须为 0–65%');
  if(world.parkSmallMaxArea<200||world.parkSmallMaxArea>=world.parkLargeMinArea||world.parkLargeMinArea>18000)throw Error('公园面积分级无效');
  if(world.buildingSetback<3||world.buildingSetback>10)throw Error('建筑退界须为 3–10m');
  if(world.treeSpacing<8||world.treeSpacing>35||world.parkTreeSpacing<8||world.parkTreeSpacing>35)throw Error('树木间距须为 8–35m');
  if(world.treeRoadSetback<2.5||world.treeRoadSetback>8)throw Error('行道树距道路边界应为 2.5–8m');
  if(world.treeDensity<0||world.treeDensity>1)throw Error('树木覆盖概率须为 0–1');
  if(world.treeCrownRadius<.8||world.treeCrownRadius>2.5||world.treeBuildingClearance<0||world.treeBuildingClearance>5)throw Error('树冠或树木净距参数无效');
  if(world.style !== 'future') throw new Error('当前版本仅支持 future 风格');
  return world;
}

export function generateCity(worldInput, features = {}) {
  return generateSpatialCity(validateWorld(worldInput),features,randomFor);
}

const cnNumeral = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
function parseNumber(text) {
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text==='十') return 10;
  if (text.includes('十')) { const [a,b]=text.split('十'); return (a?cnNumeral[a]??0:1)*10+(b?cnNumeral[b]??0:0); }
  return cnNumeral[text];
}
function parsePercent(text) {
  const match = text.match(/(?:百分之\s*([\d.]+|[一二三四五六七八九十]+))|(?:([\d.]+)\s*%)/);
  if (!match) return null;
  const num = parseNumber(match[1]||match[2]);
  return Number.isFinite(num) ? num/100 : null;
}
const has = (text, expressions) => expressions.some(s=>text.includes(s));

/** Lightweight, auditable offline intent parser; NOT a language model. */
export function parseCommand(text) {
  const source = String(text??'').trim();
  if (!source) return {type:'error',message:'请先输入一条生成或编辑指令。'};
  const s=source.toLowerCase().replace(/\s+/g,' ');
  const region = has(s,['东侧','东边','东部','东区','eastern','east side',' east ']) ? 'east' :
    has(s,['西侧','西边','西部','西区','western','west side',' west ']) ? 'west' : 'global';
  const increase = has(s,['增加','提高','提升','扩大','增大','升高','增高','更密','more','increase','raise','higher','expand']);
  const decrease = has(s,['降低','减少','减小','缩小','削减','稀疏','更低','decrease','reduce','lower','less']);
  const pct=parsePercent(s);
  const numMatch=s.match(/(?:为|至|到|设为|设置为|半径)\s*(\d+(?:\.\d+)?)\s*(?:米|m)?/);
  const sizeMatch=s.match(/(\d{3})\s*(?:m|米)?\s*[×x*]\s*(\d{3})\s*(?:m|米)?/);
  if (has(s,['生成','创建','新建','搭建','重新生成','create','generate','new world']) && has(s,['城市','世界','city','world','建筑群'])) {
    if (sizeMatch && sizeMatch[1]!==sizeMatch[2]) return {type:'error',message:'V0.1 只支持正方形世界，请输入 400×400m 等尺寸。'};
    let size=sizeMatch?Number(sizeMatch[1]):400;
    if(size<200 || size>800 || size%20!==0) return {type:'error',message:'世界尺寸须在 200–800m 之间，且为 20m 的倍数。'};
    return {type:'generate',size,description:`生成 ${size}×${size}m 程序化未来城市`};
  }
  const spatialParamRules=[
    {terms:['道路间距','路网间距','road spacing'],key:'roadSpacing',unit:'m'},
    {terms:['道路宽度','路幅宽度','road width'],key:'roadWidth',unit:'m'},
    {terms:['地块宽度','地块尺度','地块目标','parcel size'],key:'parcelTargetWidth',unit:'m'},
    {terms:['公园比例','公园占比','公园地块比例','park share'],key:'parkShare',unit:'%'},
    {terms:['行道树间距','街道树间距','street tree spacing'],key:'treeSpacing',unit:'m'},
    {terms:['公园树间距','公园树木间距','park tree spacing'],key:'parkTreeSpacing',unit:'m'},
    {terms:['树木密度','树木覆盖概率','tree density'],key:'treeDensity',unit:'%'},
    {terms:['建筑退界','建筑退让','building setback'],key:'buildingSetback',unit:'m'}
  ];
  for(const rule of spatialParamRules){
    if(!has(s,rule.terms))continue;
    const number=rule.unit==='%'?pct:(numMatch?Number(numMatch[1]):Number((s.match(/(\d+(?:\.\d+)?)\s*(?:米|m)/)||[])[1]));
    if(!Number.isFinite(number))return {type:'error',message:`请指定${rule.terms[0]}的数值，例如「${rule.terms[0]}设为 ${rule.unit==='%'?'30%':'80m'}」。`};
    return {type:'set',key:rule.key,value:number,description:`${rule.terms[0]}设为 ${rule.unit==='%'?Math.round(number*100)+'%':number+'m'}`};
  }
  if (has(s,['随机种子','seed'])) {
    const seed=(s.match(/(?:种子|seed)[^\d]*(\d+)/)||[])[1];
    return seed ? {type:'set',key:'seed',value:Math.floor(Number(seed)),description:`随机种子设为 ${seed}`} : {type:'error',message:'请指定种子整数，例如「随机种子设为 72」。'};
  }
  if (has(s,['密度','稀疏','疏密','density'])) {
    if(region==='global') return {type:'error',message:'首版请指定“东侧”或“西侧”建筑密度，避免误改整个城市。'};
    const key=region==='east'?'eastDensity':'westDensity';
    if (pct===null) return {type:'error',message:'请指定百分比，例如「将东侧建筑密度降低 30%」。'};
    if (!increase && !decrease && has(s,['设为','设置为','调整到','变成','set to'])) return {type:'set',key,value:pct,description:`${region==='east'?'东侧':'西侧'}建筑密度设为 ${Math.round(pct*100)}%`};
    if(increase===decrease) return {type:'error',message:'请说明是“提高”还是“降低”密度。'};
    return {type:'scale',key,factor:decrease?1-pct:1+pct,description:`${region==='east'?'东侧':'西侧'}建筑密度${decrease?'降低':'提高'} ${Math.round(pct*100)}%`};
  }
  if(has(s,['廊道','步行通道','通道宽度','promenade'])) {
    const width=numMatch?Number(numMatch[1]):null;
    if(width!==null) return {type:'set',key:'promenadeWidth',value:width,description:`公共廊道宽度设为 ${width}m`};
    return {type:'error',message:'请尝试「公共廊道宽度设为 16m」。'};
  }
  if(has(s,['开放空间','广场','plaza','open space'])) {
    if(pct!==null && (increase!==decrease)) return {type:'scale',key:'plazaRadius',factor:decrease?1-pct:1+pct,description:`中央开放空间半径${decrease?'缩小':'扩大'} ${Math.round(pct*100)}%`};
    const rad = numMatch? Number(numMatch[1]):null;
    if(rad!==null && has(s,['半径','设为','设置为','调整到'])) return {type:'set',key:'plazaRadius',value:rad,description:`中央开放空间半径设为 ${rad}m`};
    return {type:'error',message:'可尝试「扩大中央开放空间 20%」或「广场半径设为 70m」。'};
  }
  if (has(s,['高度','建筑高','高楼','height'])) {
    if(region!=='global') return {type:'error',message:'首版高度规则作用于全城；分区高度控制将在后续加入。'};
    if(pct===null || increase===decrease) return {type:'error',message:'请尝试「整体建筑高度提高 20%」。'};
    return {type:'scale',key:'heightScale',factor:decrease?1-pct:1+pct,description:`全城建筑高度${decrease?'降低':'提高'} ${Math.round(pct*100)}%`};
  }
  return {type:'error',message:'暂未识别此指令。可尝试生成城市、调整东/西侧建筑密度、整体高度或中央开放空间。'};
}

export function applyCommand(worldInput, command) {
  const w=validateWorld(worldInput);
  if(command.type==='error') return {ok:false,error:command.message};
  if(command.type==='generate') return {ok:true,world:validateWorld({...DEFAULT_WORLD,size:command.size}),description:command.description};
  if(!['scale','set'].includes(command.type)||!Object.hasOwn(w,command.key)) return {ok:false,error:'未授权的规则操作。'};
  const value=command.type==='set'?command.value:Number((w[command.key]*command.factor).toFixed(5));
  try {
    const next=validateWorld({...w,[command.key]:value});
    if(approx(w[command.key],next[command.key])) return {ok:false,error:'生成规则没有变化。'};
    return {ok:true,world:next,description:command.description};
  } catch (e) { return {ok:false,error:e.message}; }
}

export function compareScenes(previous,current) {
  const past=new Map(previous.buildings.map(b=>[b.id,b]));
  const currentIds=new Set(current.buildings.map(b=>b.id));
  const added=current.buildings.filter(b=>!past.has(b.id)).length;
  const removed=previous.buildings.filter(b=>!currentIds.has(b.id)).length;
  let modified=0, unchanged=0;
  for (const b of current.buildings) {
    if(!past.has(b.id)) continue;
    const p=past.get(b.id);
    if(b.height!==p.height || b.width!==p.width || b.depth!==p.depth || b.x!==p.x || b.z!==p.z) modified++;
    else unchanged++;
  }
  return {added,removed,modified,unchanged};
}

export function makeExport(world,history=[]) {
  return {
    format:'WorldCraft',version:SCHEMA_VERSION,
    exportedAt:new Date().toISOString(),
    world:validateWorld(world),
    history:history.slice(-100).map(i=>({time:String(i.time||''),description:String(i.description||'')}))
  };
}

export function readExport(doc) {
  if(!doc||doc.format!=='WorldCraft'||![1,SCHEMA_VERSION].includes(doc.version)) throw new Error('不是兼容的 WorldCraft 场景文件');
  return validateWorld(doc.world);
}
