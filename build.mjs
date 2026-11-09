import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname);
const read=p=>readFileSync(join(root,p),'utf8');
const raw=read('index.html');
const css=read('styles.css');
const stripExport=s=>s.replace(/^export\s+/gm,'');
const roadNetwork=stripExport(read('src/road-network.mjs'));
const region=stripExport(read('src/region.mjs'));
const polygonal=stripExport(read('src/polygonal.mjs')).replace(/^import[^\n]+;\s*$/gm,'');
const spatial=stripExport(read('src/spatial.mjs')).replace(/^import[^\n]+;\s*$/gm,'');
const pcg=stripExport(read('src/pcg.mjs')).replace(/^import[^\n]+;\s*$/gm,'');
const renderer=stripExport(read('src/renderer.js'));
const graph=stripExport(read('src/graph.mjs'));
const app=read('src/app.js').replace(/^import[^\n]+;\s*$/gm,'');
const bundle=`'use strict';\nconst __roadNetwork=(()=>{\n${roadNetwork}\nreturn {normalizeRoadNetwork,networkFromTopology,networkSegments,moveRoadNode,resizeRoadEdge,curveRoadEdge,roadCurveControl,splitRoadEdge,addRoadBranch,removeRoadNode,parseRoadEditInstruction};\n})();\nconst {normalizeRoadNetwork,networkFromTopology,networkSegments,moveRoadNode,resizeRoadEdge,curveRoadEdge,roadCurveControl,splitRoadEdge,addRoadBranch,removeRoadNode,parseRoadEditInstruction}=__roadNetwork;\nconst __region=(()=>{\n${region}\nreturn {mergeConvexCells,regionContains,regionArea};\n})();\nconst {mergeConvexCells,regionContains,regionArea}=__region;\nconst __polygonal=(()=>{\n${polygonal}\nreturn {generatePolygonCity,validatePolygonCity,makeRoadAxes,createRoadTopology};\n})();\nconst {generatePolygonCity,validatePolygonCity,makeRoadAxes,createRoadTopology}=__polygonal;\n${spatial}\nconst __pcg = (()=>{\n${pcg}\nreturn { DEFAULT_WORLD, generateCity, parseCommand, applyCommand, compareScenes, validateWorld, makeExport, readExport };\n})();\nconst __graph = (()=>{
${graph}
return { NODE_DEFS, defaultGraph, checkGraphShape, evaluateGraph, moveGraphNode, connectGraph, removeGraphNode, addGraphNode, setGraphNodeActive, graphFromFile };
})();
const __renderer = (()=>{\n${renderer}\nreturn { WorldRenderer, CanvasFallbackRenderer };\n})();\n(()=>{\nconst {DEFAULT_WORLD, generateCity, parseCommand, applyCommand, compareScenes, validateWorld, makeExport, readExport} = __pcg;\nconst {WorldRenderer,CanvasFallbackRenderer} = __renderer;
const {NODE_DEFS,defaultGraph,checkGraphShape,evaluateGraph,moveGraphNode,connectGraph,removeGraphNode,addGraphNode,setGraphNodeActive,graphFromFile} = __graph;\n${app}\n})();`;
// External assets and package installs are not required. Keep all content in one HTML file.
const html=raw.replace('<link rel="stylesheet" href="./styles.css" />',`<style>\n${css}\n</style>`).replace('<script type="module" src="./src/app.js"></script>',`<script>\n${bundle}\n</script>`);
writeFileSync(join(root,'worldcraft.html'),html);
console.log(`Built worldcraft.html (${Math.ceil(Buffer.byteLength(html)/1024)} KB, offline, standalone).`);
const households=stripExport(read('src/village-households.mjs'));
const villageBundle=`const __households=(()=>{\n${households}\nreturn {attachHouseholds,validateHouseholds,buildingFootprint,contourRotation,localPoint};\n})();\nconst {attachHouseholds,validateHouseholds,buildingFootprint,contourRotation,localPoint}=__households;\nconst __village=(()=>{\n${stripExport(read('src/village.mjs')).replace(/^import[^\n]+;\s*$/gm,'')}\nreturn {generateVillage,sampleTerrain,measureVillage,validateVillage};\n})();\nconst {generateVillage,sampleTerrain,measureVillage,validateVillage}=__village;\n(()=>{\n${read('src/village-app.js').replace(/^import[^\n]+;\s*$/gm,'')}\n})();`;
const villageHTML=read('village.html').replace('<link rel="stylesheet" href="./village.css">',`<style>\n${read('village.css')}\n</style>`)
  .replace('<script type="module" src="./src/village-app.js"></script>',`<script>\n(()=>{\n${villageBundle}\n})();\n</script>`);
writeFileSync(join(root,'mountain-village.html'),villageHTML);
console.log(`Built mountain-village.html (${Math.ceil(Buffer.byteLength(villageHTML)/1024)} KB, offline, standalone).`);
