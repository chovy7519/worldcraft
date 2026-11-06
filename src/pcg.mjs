/** WorldCraft V0.1 — deterministic, dependency-free scene schema and PCG logic. */
export const SCHEMA_VERSION = 1;
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
  if (input.schemaVersion !== SCHEMA_VERSION) throw new Error('不支持此世界文件版本');
  const world = {};
  for (const key of Object.keys(DEFAULT_WORLD)) {
    world[key] = input[key] ?? DEFAULT_WORLD[key];
  }
  const nums = ['size','seed','eastDensity','westDensity','heightScale','plazaRadius','promenadeWidth'];
  for (const key of nums) if (typeof world[key] !== 'number' || !Number.isFinite(world[key])) throw new Error(`参数 ${key} 必须为有限数字`);
  if (!Number.isInteger(world.seed) || world.seed < 0 || world.seed > 1000000000) throw new Error('随机种子必须是 0–1,000,000,000 的整数');
  if (!Number.isInteger(world.size) || world.size < 200 || world.size > 800 || world.size % 20 !== 0) throw new Error('世界尺寸应为 200–800m 且为 20 的倍数');
  if (world.eastDensity < 0 || world.eastDensity > 1 || world.westDensity < 0 || world.westDensity > 1) throw new Error('建筑密度须在 0%–100% 之间');
  if (world.heightScale < 0.2 || world.heightScale > 3) throw new Error('高度倍率应为 0.2–3');
  if (world.promenadeWidth < 4 || world.promenadeWidth > 28) throw new Error('公共廊道宽度应为 4–28m');
  if (world.plazaRadius < 20 || world.plazaRadius > Math.min(world.size/2-15,160)) throw new Error('中央开放空间半径不在允许范围内');
  if (typeof world.name !== 'string' || world.name.length > 120) throw new Error('世界名称无效');
  if (world.style !== 'future') throw new Error('当前版本仅支持 future 风格');
  return world;
}

export function generateCity(worldInput, features = {}) {
  const world = validateWorld(worldInput);
  const active={plaza:features.plaza!==false,promenade:features.promenade!==false,height:features.height!==false};
  const buildings = [], trees = [];
  const cols = world.size / 20;
  let eastEligible = 0, westEligible = 0;
  for (let row=0;row<cols;row++) {
    for (let col=0;col<cols;col++) {
      const bx = -world.size/2 + (col+0.5)*20;
      const bz = -world.size/2 + (row+0.5)*20;
      const jitterX = (randomFor(world.seed,col,row,1)-0.5)*4.8;
      const jitterZ = (randomFor(world.seed,col,row,2)-0.5)*4.8;
      const x = bx + jitterX, z = bz+jitterZ;
      const dist = Math.hypot(x,z);
      const inPlaza = active.plaza && dist < world.plazaRadius + 10;
      // A gentle, rotated public-space promenade on the south-west axis.
      const inPromenade = active.promenade && z > -world.size*0.35 && z < world.size*0.10 && Math.abs(x-0.34*z+42)<world.promenadeWidth;
      const east = bx >= 0;
      const probability = east ? world.eastDensity : world.westDensity;
      const eligible = !inPlaza && !inPromenade;
      if (eligible) east ? eastEligible++ : westEligible++;
      const occupancy = randomFor(world.seed,col,row,3);
      if (eligible && occupancy < probability) {
        const centerWeight = Math.pow(Math.max(0,1-dist/(world.size*0.76)),1.55);
        const hNoise = randomFor(world.seed,col,row,4);
        const height = (12 + 98*centerWeight*(0.65+hNoise*0.67))*(active.height?world.heightScale:1);
        const width = 11.0 + randomFor(world.seed,col,row,5)*4.8;
        const depth = 11.0 + randomFor(world.seed,col,row,6)*4.8;
        const typ = randomFor(world.seed,col,row,7);
        buildings.push({
          id: `B-${String(row).padStart(2,'0')}-${String(col).padStart(2,'0')}`,
          row, col, region: east ? '东侧' : '西侧', x, z,
          width, depth, height, type: typ>0.85?'terraced':typ>0.56?'tower':'slab',
          tone: randomFor(world.seed,col,row,8),
          footprint: width*depth
        });
      } else if (!inPlaza && randomFor(world.seed,col,row,9) < (eligible ? 0.63 : 0.36)) {
        const n = 1 + (randomFor(world.seed,col,row,10)>0.66?1:0);
        for (let t=0;t<n;t++) trees.push({
          id:`T-${row}-${col}-${t}`,
          x:bx+(randomFor(world.seed,col,row,11+t)*2-1)*6,
          z:bz+(randomFor(world.seed,col,row,13+t)*2-1)*6,
          height:3.2+randomFor(world.seed,col,row,15+t)*3.5
        });
      }
    }
  }
  // Plaza landscape: deterministic trees around the perimeter, outside the inner clearing.
  for (let i=0;i<(active.plaza?52:0);i++) {
    const theta = 2*Math.PI*(i/52)+(randomFor(world.seed,i,1,16)-.5)*0.10;
    const r = world.plazaRadius * (0.86+randomFor(world.seed,i,2,16)*0.24);
    const x=Math.cos(theta)*r,z=Math.sin(theta)*r;
    if (Math.abs(x-0.34*z+42)>12) trees.push({id:`P-${i}`,x,z,height:3.4+randomFor(world.seed,i,3,16)*3.3});
  }
  const eastBuildings = buildings.filter(b=>b.region==='东侧');
  const westBuildings = buildings.filter(b=>b.region==='西侧');
  const footprint = buildings.reduce((sum,b)=>sum+b.footprint,0);
  const totalHeight = buildings.reduce((sum,b)=>sum+b.height,0);
  const maxHeight = buildings.reduce((m,b)=>Math.max(m,b.height),0);
  return {
    world, buildings, trees, features:active,
    metrics: {
      total: buildings.length,
      east: eastBuildings.length,
      west: westBuildings.length,
      eastEligible, westEligible,
      coverage: footprint / (world.size*world.size),
      avgHeight: buildings.length ? totalHeight/buildings.length : 0,
      maxHeight,
      plazaArea: active.plaza ? Math.PI*world.plazaRadius*world.plazaRadius : 0
    }
  };
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
  if(!doc||doc.format!=='WorldCraft'||doc.version!==SCHEMA_VERSION) throw new Error('不是兼容的 WorldCraft 场景文件');
  return validateWorld(doc.world);
}
