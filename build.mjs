import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname);
const read=p=>readFileSync(join(root,p),'utf8');
const raw=read('index.html');
const css=read('styles.css');
const stripExport=s=>s.replace(/^export\s+/gm,'');
const pcg=stripExport(read('src/pcg.mjs'));
const renderer=stripExport(read('src/renderer.js'));
const app=read('src/app.js').replace(/^import[^\n]+;\s*$/gm,'');
const bundle=`'use strict';\nconst __pcg = (()=>{\n${pcg}\nreturn { DEFAULT_WORLD, generateCity, parseCommand, applyCommand, compareScenes, validateWorld, makeExport, readExport };\n})();\nconst __renderer = (()=>{\n${renderer}\nreturn { WorldRenderer, CanvasFallbackRenderer };\n})();\n(()=>{\nconst {DEFAULT_WORLD, generateCity, parseCommand, applyCommand, compareScenes, validateWorld, makeExport, readExport} = __pcg;\nconst {WorldRenderer,CanvasFallbackRenderer} = __renderer;\n${app}\n})();`;
// External assets and package installs are not required. Keep all content in one HTML file.
const html=raw.replace('<link rel="stylesheet" href="./styles.css" />',`<style>\n${css}\n</style>`).replace('<script type="module" src="./src/app.js"></script>',`<script>\n${bundle}\n</script>`);
writeFileSync(join(root,'worldcraft.html'),html);
console.log(`Built worldcraft.html (${Math.ceil(Buffer.byteLength(html)/1024)} KB, offline, standalone).`);
