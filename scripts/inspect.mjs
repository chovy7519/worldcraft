import {DEFAULT_WORLD,generateCity} from '../src/pcg.mjs';
import {STAGE_DEPENDENCIES,validateSpatialInvariants} from '../src/spatial.mjs';
const scene=generateCity(DEFAULT_WORLD);
const result=validateSpatialInvariants(scene);
const summary={version:'0.3.0',seed:scene.world.seed,worldSizeM:scene.world.size,
  pipeline:STAGE_DEPENDENCIES.map(({id,dependsOn})=>({stage:id,dependsOn})),
  metrics:scene.metrics,checks:{...result.checks,conflicts:result.errors.length}};
console.log(JSON.stringify(summary,null,2));
if(!result.valid){console.error(result.errors.join('\n'));process.exitCode=1;}
