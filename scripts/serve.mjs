import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const allowed=new Set(['mountain-village.html','worldcraft.html','index.html','village.html','village.css','styles.css',
  'docs/MOUNTAIN_VILLAGE.md','docs/PROCEDURAL_SETTLEMENT_RESEARCH.md']);
const source=new Set(['app.js','renderer.js','graph.mjs','pcg.mjs','spatial.mjs','road-network.mjs','region.mjs','polygonal.mjs','village.mjs','village-app.js','village-households.mjs']);
for(const file of source)allowed.add(`src/${file}`);
createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname.slice(1)||'mountain-village.html';
  if(!allowed.has(path)){res.writeHead(404);res.end('Not found');return;}
  try{const data=await readFile(resolve(root,path));res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.md':'text/plain; charset=utf-8'})[extname(path)],'Cache-Control':'no-store'});res.end(data);}
  catch{res.writeHead(404);res.end('Not found');}
}).listen(5190,'127.0.0.1',()=>console.log('WorldCraft preview: http://127.0.0.1:5190/mountain-village.html'));
