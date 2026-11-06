/* WorldCraft compact WebGL2 viewer. Dependency-free, interactive true 3D geometry. */
const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 iOffset;
layout(location=3) in vec3 iScale;
layout(location=4) in vec3 iColor;
layout(location=5) in float iRotation;
uniform mat4 uViewProjection;
out vec3 vColor;
out vec3 vNormal;
out vec3 vWorld;
void main(){
  vec3 q = aPosition*iScale;
  float c=cos(iRotation),s=sin(iRotation);
  q=vec3(c*q.x-s*q.z,q.y,s*q.x+c*q.z);
  vec3 n=vec3(c*aNormal.x-s*aNormal.z,aNormal.y,s*aNormal.x+c*aNormal.z);
  vec3 w=q+iOffset;
  gl_Position=uViewProjection*vec4(w,1.0);
  vColor=iColor;vNormal=n;vWorld=w;
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vColor;in vec3 vNormal;in vec3 vWorld;
uniform vec3 uCamera;
uniform float uIsArchitecture;
out vec4 outColor;
void main(){
  vec3 n=normalize(vNormal);
  float sun=max(dot(n,normalize(vec3(-0.65,1.35,0.55))),0.0);
  float diffuse=0.57+0.43*sun;
  float edge=0.04 * max(0.0,dot(n,normalize(vec3(0.0,1.0,0.0))));
  vec3 col=vColor*(diffuse+edge);
  if(uIsArchitecture>0.5 && abs(n.y)<0.35){
    float floors=smoothstep(0.035,0.085,fract(vWorld.y / 5.2));
    col*=mix(0.82,1.0,floors);
    float win=step(0.29,fract((abs(n.x)>0.5?vWorld.z:vWorld.x)*0.22))*step(0.25,fract(vWorld.y*0.17));
    col += win * vec3(0.038,0.048,0.045);
  }
  float d=length(vWorld.xz-uCamera.xz);
  float fog=smoothstep(380.0,940.0,d)*0.28;
  col=mix(col,vec3(0.27,0.34,0.37),fog);
  outColor=vec4(col,1.0);
}`;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function mat4Multiply(a,b) {
  const out=new Float32Array(16);
  for(let j=0;j<4;j++)for(let i=0;i<4;i++){
    let v=0;for(let k=0;k<4;k++)v+=a[k*4+i]*b[j*4+k];
    out[j*4+i]=v;
  }
  return out;
}
function perspective(fovy,aspect,near,far){
  const f=1/Math.tan(fovy/2),o=new Float32Array(16);
  o[0]=f/aspect;o[5]=f;o[10]=(far+near)/(near-far);o[11]=-1;o[14]=2*far*near/(near-far);
  return o;
}
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normal=a=>{const l=Math.hypot(...a);return a.map(v=>v/(l||1));};
function lookAt(eye,center,up){
  const z=normal(sub(eye,center)),x=normal(cross(up,z)),y=cross(z,x);
  return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);
}
// Inverse of 4x4 column-major matrix, Gauss-Jordan with row-oriented scratch buffers.
function inverse4(m){
  const a=Array.from({length:4},(_,r)=>Array.from({length:8},(_,c)=>c<4?m[c*4+r]:(c-4===r?1:0)));
  for(let p=0;p<4;p++){
    let pivot=p;for(let r=p+1;r<4;r++)if(Math.abs(a[r][p])>Math.abs(a[pivot][p]))pivot=r;
    if(Math.abs(a[pivot][p])<1e-12)return null;
    [a[p],a[pivot]]=[a[pivot],a[p]];
    const factor=a[p][p];for(let c=0;c<8;c++)a[p][c]/=factor;
    for(let r=0;r<4;r++)if(r!==p){const f=a[r][p];for(let c=0;c<8;c++)a[r][c]-=f*a[p][c];}
  }
  const out=new Float32Array(16);
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)out[c*4+r]=a[r][4+c];
  return out;
}
function transform(m,v){const a=[];for(let r=0;r<4;r++)a[r]=m[r]*v[0]+m[4+r]*v[1]+m[8+r]*v[2]+m[12+r]*v[3];return a.map((x,i)=>i<3?x/a[3]:a[3]);}

function createBox(){
  const result=[];
  const faces=[
    {n:[0,0,1],q:[[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]},
    {n:[0,0,-1],q:[[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]]},
    {n:[1,0,0],q:[[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]]},
    {n:[-1,0,0],q:[[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]},
    {n:[0,1,0],q:[[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]]},
    {n:[0,-1,0],q:[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]]}
  ];
  for(const f of faces)for(const i of [0,1,2,0,2,3])result.push(...f.q[i],...f.n);
  return new Float32Array(result);
}
function createCylinder(sides=24,cone=false){
  const result=[];
  const push=(v,n)=>result.push(...v,...n);
  for(let i=0;i<sides;i++){
    const a=i/sides*Math.PI*2,b=(i+1)/sides*Math.PI*2;
    const n1=[Math.sin(a),cone?0.38:0,Math.cos(a)],n2=[Math.sin(b),cone?0.38:0,Math.cos(b)];
    const p1=[.5*Math.sin(a),-.5,.5*Math.cos(a)],p2=[.5*Math.sin(b),-.5,.5*Math.cos(b)];
    if(cone){push(p1,n1);push(p2,n2);push([0,.5,0],normal([n1[0]+n2[0],.65,n1[2]+n2[2]]));}
    else{
      const t1=[p1[0],.5,p1[2]],t2=[p2[0],.5,p2[2]];
      push(p1,n1);push(t2,n2);push(t1,n1);push(p1,n1);push(p2,n2);push(t2,n2);
      push([0,.5,0],[0,1,0]);push(t1,[0,1,0]);push(t2,[0,1,0]);
      push([0,-.5,0],[0,-1,0]);push(p2,[0,-1,0]);push(p1,[0,-1,0]);
    }
  }
  return new Float32Array(result);
}
/** Variable convex footprint extruded into actual 3D triangles (rather than bounding rectangles). */
function polygonPrism(points,cx,cz){
  const output=[];
  const push=(v,n)=>output.push(...v,...n);
  const p=points.map(v=>[v[0]-cx,v[1]-cz]);
  for(let i=1;i<p.length-1;i++){
    push([p[0][0],.5,p[0][1]],[0,1,0]);
    push([p[i+1][0],.5,p[i+1][1]],[0,1,0]);
    push([p[i][0],.5,p[i][1]],[0,1,0]);
  }
  for(let i=0;i<p.length;i++){
    const a=p[i],b=p[(i+1)%p.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
    const n=[dz/len,0,-dx/len];
    const loA=[a[0],-.5,a[1]],loB=[b[0],-.5,b[1]],hiA=[a[0],.5,a[1]],hiB=[b[0],.5,b[1]];
    for(const v of [loA,hiA,hiB,loA,hiB,loB])push(v,n);
  }
  return new Float32Array(output);
}
function rgb(hex){const h=hex.replace('#','');return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255];}
function instance(x,y,z,w,h,d,color,rot=0){return [x,y,z,w,h,d,...(Array.isArray(color)?color:rgb(color)),rot];}
function mix(a,b,f){return a.map((x,i)=>x*(1-f)+b[i]*f);}
const PALETTE=['#6e8a93','#93a4a1','#596c7b','#879294','#768997','#9caaa6','#506979'];
export class WorldRenderer {
  constructor(canvas,{onSelect,onCameraChange}={}){
    this.canvas=canvas;this.onSelect=onSelect;this.onCameraChange=onCameraChange;
    const gl=canvas.getContext('webgl2',{alpha:true,antialias:true,depth:true,stencil:false,preserveDrawingBuffer:true});
    if(!gl)throw Error('此浏览器不支持 WebGL2，无法运行 3D 视窗。');
    this.gl=gl;this.scene=null;this.selected=null;this.meshes=[];
    this.camera={azimuth:0.68,elevation:0.64,distance:680,target:[0,14,0]};
    this.initProgram();this.initInput();this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);
    this.resize();this.running=true;this.loop();
  }
  initProgram(){
    const gl=this.gl;
    const compile=(kind,text)=>{const sh=gl.createShader(kind);gl.shaderSource(sh,text);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh;};
    const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,VS));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,FS));gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
    this.program=p;this.uniforms={vp:gl.getUniformLocation(p,'uViewProjection'),camera:gl.getUniformLocation(p,'uCamera'),architect:gl.getUniformLocation(p,'uIsArchitecture')};
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
    this.boxGeometry=createBox();this.cylinderGeometry=createCylinder();this.coneGeometry=createCylinder(7,true);
  }
  createMesh(geometry,instances,architecture=false){
    if(!instances.length)return;
    const gl=this.gl,vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const vb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,geometry,gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);
    const ib=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,ib);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(instances.flat()),gl.STATIC_DRAW);
    const stride=10*4;
    for(const [loc,count,offset] of [[2,3,0],[3,3,12],[4,3,24],[5,1,36]]){
      gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,count,gl.FLOAT,false,stride,offset);gl.vertexAttribDivisor(loc,1);
    }
    gl.bindVertexArray(null);
    this.meshes.push({vao,vb,ib,count:instances.length,vertices:geometry.length/6,architecture});
  }
  updateScene(scene){
    this.scene=scene;
    const gl=this.gl;for(const m of this.meshes){gl.deleteVertexArray(m.vao);gl.deleteBuffer(m.vb);gl.deleteBuffer(m.ib);}this.meshes=[];
    const s=scene.world.size;
    this.createMesh(this.boxGeometry,[instance(0,-2.8,0,s+45,5.6,s+45,'#293a42'),instance(0,-5.7,0,s+56,2,s+56,'#19272f')]);
    this.createMesh(this.boxGeometry,[instance(0,0.06,0,s,.12,s,'#4e5f61')]);
    // V0.3: road polygons, park parcels, and land-use boundaries are real PCG outputs.
    // Ground surfaces are drawn in separate height layers (not overlapping plan footprints).
    const parkColors={small:'#76a48d',medium:'#5e8d77',large:'#447d68'};
    if(!!scene.geometryMode){
      const draw=(p,y,h,color,architect=false)=>{for(const poly of p.cells??[p.vertices])this.createMesh(polygonPrism(poly,p.x,p.z),[instance(p.x,y,p.z,1,h,1,color)],architect);};
      for(const p of scene.parcels)draw(p,.14,.10,p.use==='residential'?'#526568':p.use==='commercial'?'#627579':p.use==='civic'?'#66716e':'#47695d');
      for(const road of scene.roads)draw(road,.25,.14,road.kind==='promenade'?'#9baba0':road.kind==='arterial'?'#9aa49b':'#26373e');
      for(const park of scene.parks)draw(park,.35,.18,parkColors[park.kind]);
    }else{
      const parcelSurfaces=scene.parcels.map(p=>instance(p.x,.14,p.z,p.width,.10,p.depth,
        p.use==='residential'?'#526568':p.use==='commercial'?'#627579':p.use==='civic'?'#66716e':'#47695d'));
      this.createMesh(this.boxGeometry,parcelSurfaces);
      this.createMesh(this.boxGeometry,scene.roads.map(r=>instance(r.x,.25,r.z,r.width,.14,r.depth,
        r.kind==='promenade'?'#9baba0':'#26373e')));
      this.createMesh(this.boxGeometry,scene.parks.map(p=>instance(p.x,.35,p.z,p.width-.3,.18,p.depth-.3,parkColors[p.kind])));
    }
    // Readable but non-intrusive central route marking (within existing road polygons).
    const markings=scene.roadLines.filter(r=>r.kind==='promenade').map(r=>{
      const x=(r.from[0]+r.to[0])/2,z=(r.from[1]+r.to[1])/2;
      return instance(x,.35,z,r.from[0]===r.to[0]?.18:Math.abs(r.to[0]-r.from[0]),.03,r.from[1]===r.to[1]?.18:Math.abs(r.to[1]-r.from[1]),'#e0e6d4');
    });
    this.createMesh(this.boxGeometry,markings);
    const bodies=[],tops=[],terraces=[],accents=[];
    for(const b of scene.buildings){
      const base=rgb(b.use==='commercial'?'#9b9d92':b.use==='civic'?'#c0a78e':PALETTE[Math.floor(b.tone*PALETTE.length)]);
      const color=b.id===this.selected?rgb('#e2bd7a'):base;
      bodies.push(instance(b.x,b.height/2+.9,b.z,b.width,b.height,b.depth,color));
      tops.push(instance(b.x,b.height+1.6,b.z,b.width+1.0,1.4,b.depth+1.0,mix(base,rgb('#e3ded0'),.22)));
      if(b.type==='terraced')terraces.push(instance(b.x,b.height+4.4,b.z,b.width*.67,5.0,b.depth*.65,mix(base,rgb('#d2d9d2'),.24)));
      if(b.type==='tower'&&b.height>43){
        accents.push(instance(b.x,b.height+4.0,b.z,b.width*.16,4.5,b.depth*.16,'#baccc3'));
      }
    }
    if(!!scene.geometryMode){
      for(const b of scene.buildings){
        const base=b.use==='commercial'?'#9b9d92':b.use==='civic'?'#c0a78e':PALETTE[Math.floor(b.tone*PALETTE.length)];
        const color=b.id===this.selected?'#e2bd7a':base;
        this.createMesh(polygonPrism(b.vertices,b.x,b.z),[instance(b.x,b.height/2+.9,b.z,1,b.height,1,color)],true);
      }
    }else{
      this.createMesh(this.boxGeometry,bodies,true);
      this.createMesh(this.boxGeometry,tops);
      this.createMesh(this.boxGeometry,terraces,true);
      this.createMesh(this.boxGeometry,accents);
    }
    const trunks=[],foliage=[];
    for(const t of scene.trees){
      trunks.push(instance(t.x,t.height*.3+.6,t.z,.66,t.height*.6,.66,'#56685c'));
      foliage.push(instance(t.x,t.height*.77+1.0,t.z,t.height*.84,t.height*.82,t.height*.84,'#618779'));
    }
    this.createMesh(this.boxGeometry,trunks);
    this.createMesh(this.coneGeometry,foliage);
  }
  setSelected(id){this.selected=id;if(this.scene)this.updateScene(this.scene);}
  eye(){const c=this.camera;return [c.target[0]+Math.sin(c.azimuth)*Math.cos(c.elevation)*c.distance,c.target[1]+Math.sin(c.elevation)*c.distance,c.target[2]+Math.cos(c.azimuth)*Math.cos(c.elevation)*c.distance];}
  matrices(){const rect=this.canvas.getBoundingClientRect(),eye=this.eye();const proj=perspective(.77,Math.max(.25,rect.width/Math.max(1,rect.height)),1,3000);const view=lookAt(eye,this.camera.target,[0,1,0]);return {eye,vp:mat4Multiply(proj,view)};}
  resize(){const dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,Math.floor(this.canvas.clientWidth*dpr)),h=Math.max(1,Math.floor(this.canvas.clientHeight*dpr));if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.gl.viewport(0,0,w,h);}
  render(){
    const gl=this.gl;this.resize();gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    if(!this.scene)return;
    const {eye,vp}=this.matrices();gl.useProgram(this.program);gl.uniformMatrix4fv(this.uniforms.vp,false,vp);gl.uniform3fv(this.uniforms.camera,eye);
    for(const m of this.meshes){gl.uniform1f(this.uniforms.architect,m.architecture?1:0);gl.bindVertexArray(m.vao);gl.drawArraysInstanced(gl.TRIANGLES,0,m.vertices,m.count);}
    gl.bindVertexArray(null);
  }
  loop(){if(!this.running)return;this.render();requestAnimationFrame(()=>this.loop());}
  zoom(delta){this.camera.distance=clamp(this.camera.distance*delta,110,1450);this.onCameraChange?.(this.camera);}
  resetCamera(){this.camera={azimuth:.68,elevation:.64,distance:680,target:[0,14,0]};this.onCameraChange?.(this.camera);}
  focus(building){if(!building)return;this.camera.target=[building.x,building.height*.35,building.z];this.camera.distance=clamp(this.camera.distance*.55,110,720);}
  pick(x,y){
    if(!this.scene)return null;
    const {vp}=this.matrices(),inv=inverse4(vp);if(!inv)return null;
    const rect=this.canvas.getBoundingClientRect(),nx=((x-rect.left)/rect.width)*2-1,ny=1-((y-rect.top)/rect.height)*2;
    const a=transform(inv,[nx,ny,-1,1]),b=transform(inv,[nx,ny,1,1]);
    const dir=normal(sub(b.slice(0,3),a.slice(0,3)));
    let best=null,near=Infinity;
    for(const building of this.scene.buildings){
      const min=[building.x-building.width/2,.5,building.z-building.depth/2];
      const max=[building.x+building.width/2,building.height+5,building.z+building.depth/2];
      let tmin=0,tmax=10000;
      for(let k=0;k<3;k++){
        if(Math.abs(dir[k])<1e-10){if(a[k]<min[k]||a[k]>max[k]){tmin=Infinity;break;}continue;}
        const t1=(min[k]-a[k])/dir[k],t2=(max[k]-a[k])/dir[k];
        tmin=Math.max(tmin,Math.min(t1,t2));tmax=Math.min(tmax,Math.max(t1,t2));
      }
      if(tmax>=tmin&&tmin<near){near=tmin;best=building;}
    }
    return best;
  }
  initInput(){
    const el=this.canvas;let start=null;
    el.addEventListener('contextmenu',e=>e.preventDefault());
    el.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false,button:e.button};el.setPointerCapture(e.pointerId);});
    el.addEventListener('pointermove',e=>{
      if(!start)return;
      const dx=e.clientX-start.lastX,dy=e.clientY-start.lastY;
      if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>4)start.moved=true;
      if(start.button===2||e.shiftKey){
        const f=this.camera.distance*.0015;
        this.camera.target[0]-=(dx*Math.cos(this.camera.azimuth)+dy*Math.sin(this.camera.azimuth))*f;
        this.camera.target[2]+=(dx*Math.sin(this.camera.azimuth)-dy*Math.cos(this.camera.azimuth))*f;
      }else{
        this.camera.azimuth-=dx*.006;
        this.camera.elevation=clamp(this.camera.elevation+dy*.005,.12,1.47);
      }
      start.lastX=e.clientX;start.lastY=e.clientY;
    });
    el.addEventListener('pointerup',e=>{if(start&&!start.moved&&start.button===0){const b=this.pick(e.clientX,e.clientY);this.onSelect?.(b?.id??null);}start=null;});
    el.addEventListener('pointercancel',()=>{start=null;});
    el.addEventListener('dblclick',e=>{const b=this.pick(e.clientX,e.clientY);if(b){this.onSelect?.(b.id);this.focus(b);}});
    el.addEventListener('wheel',e=>{e.preventDefault();this.zoom(Math.exp(Math.sign(e.deltaY)*.10));},{passive:false});
  }
  dispose(){this.running=false;this.resizeObserver?.disconnect();}
}

/** Software 3D renderer with perspective projection, used when WebGL2 is unavailable. */
export class CanvasFallbackRenderer {
  constructor(canvas,{onSelect,onCameraChange}={}){
    this.canvas=canvas;this.onSelect=onSelect;this.onCameraChange=onCameraChange;
    const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('当前浏览器无法创建 2D/3D Canvas 上下文。');
    this.ctx=ctx;this.camera={azimuth:.68,elevation:.64,distance:680,target:[0,14,0]};
    this.scene=null;this.selected=null;this.running=true;
    this.initInput();this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();this.loop();
  }
  resize(){const dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(1,Math.round(this.canvas.clientWidth*dpr)),h=Math.max(1,Math.round(this.canvas.clientHeight*dpr));if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.w=w;this.h=h;}
  updateScene(scene){this.scene=scene;}
  setSelected(id){this.selected=id;}
  project(p,vp){
    const a=transform(vp,[p[0],p[1],p[2],1]);
    if(!Number.isFinite(a[0])||!Number.isFinite(a[1]))return null;
    return [(a[0]*.5+.5)*this.w,(-a[1]*.5+.5)*this.h];
  }
  polygon(points,color,stroke=null){
    const ctx=this.ctx;if(points.some(p=>!p))return;
    ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=color;ctx.fill();
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.7;ctx.stroke();}
  }
  line(points,color,width=1){const ctx=this.ctx;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  drawBuilding(b,vp,eye){
    if(b.vertices){
      const p=(x,y,z)=>this.project([x,y,z],vp),bottom=b.vertices.map(v=>p(v[0],.7,v[1])),top=b.vertices.map(v=>p(v[0],b.height+.9,v[1]));
      const color=b.id===this.selected?'#e6bb7b':b.use==='commercial'?'#9b9d92':b.use==='civic'?'#c0a78e':PALETTE[Math.floor(b.tone*PALETTE.length)];
      for(let i=0;i<b.vertices.length;i++)this.polygon([bottom[i],bottom[(i+1)%bottom.length],top[(i+1)%top.length],top[i]],color,'#26383b70');
      this.polygon(top,color,b.id===this.selected?'#f0c980':'#c9cfc520');return;
    }
    const ctx=this.ctx;
    const x=b.x,z=b.z,w=b.width/2,d=b.depth/2,h=b.height+.9;
    const px=(X,Y,Z)=>this.project([X,Y,Z],vp);
    const A=px(x-w,.3,z-d),B=px(x+w,.3,z-d),C=px(x+w,.3,z+d),D=px(x-w,.3,z+d);
    const E=px(x-w,h,z-d),F=px(x+w,h,z-d),G=px(x+w,h,z+d),H=px(x-w,h,z+d);
    if([A,B,C,D,E,F,G,H].some(q=>!q))return;
    const base=b.use==='commercial'?'#9b9d92':b.use==='civic'?'#c0a78e':PALETTE[Math.floor(b.tone*PALETTE.length)];
    const color=b.id===this.selected?'#ddbb79':base;
    const brighten=(hex,delta)=>{
      const raw=hex.replace('#','');const cols=[0,2,4].map(p=>parseInt(raw.slice(p,p+2),16));
      return '#'+cols.map(c=>Math.max(0,Math.min(255,Math.round(c*delta))).toString(16).padStart(2,'0')).join('');
    };
    // Bottom / walls / roof. Choose visible side walls according to camera position.
    if(eye[2]<z)this.polygon([A,B,F,E],brighten(color,.79),'#1f353d65');
    if(eye[2]>=z)this.polygon([D,C,G,H],brighten(color,.87),'#1f353d65');
    if(eye[0]<x)this.polygon([A,D,H,E],brighten(color,.66),'#1f353d65');
    if(eye[0]>=x)this.polygon([B,C,G,F],brighten(color,.70),'#1f353d65');
    this.polygon([E,F,G,H],brighten(color,1.18),'#bdc9bd18');
    // Lightweight facade floor bands: only on visible faces.
    if(h>20){
      const count=Math.floor(h/8);
      ctx.lineWidth=.7;
      for(let i=1;i<count;i++){
        const ht=h*i/count;
        if(eye[2]<z)this.line([px(x-w,ht,z-d),px(x+w,ht,z-d)],'#d6e3dd24',.7);
        else this.line([px(x-w,ht,z+d),px(x+w,ht,z+d)],'#d6e3dd24',.7);
        if(eye[0]<x)this.line([px(x-w,ht,z-d),px(x-w,ht,z+d)],'#d6e3dd1e',.7);
        else this.line([px(x+w,ht,z-d),px(x+w,ht,z+d)],'#d6e3dd1e',.7);
      }
    }
    if(b.type==='terraced'){
      const w2=w*.68,d2=d*.66;
      this.polygon([px(x-w2,h+4,z-d2),px(x+w2,h+4,z-d2),px(x+w2,h+4,z+d2),px(x-w2,h+4,z+d2)],'#b7c9bc');
    }
    if(b.id===this.selected){ctx.lineWidth=2;this.polygon([E,F,G,H],'#dfbe8333','#f1ca83');}
  }
  drawTree(t,vp){
    const p=(x,y,z)=>this.project([x,y,z],vp);
    const a=p(t.x-1,t.height*.55,t.z),b=p(t.x+1,t.height*.55,t.z),c=p(t.x,t.height*1.6,t.z),d=p(t.x,t.height*.55,t.z+2);
    this.polygon([a,b,c],'#648d7b');this.polygon([b,d,c],'#446e61');
  }
  render(){
    const ctx=this.ctx;this.resize();const w=this.w,h=this.h;
    const bg=ctx.createLinearGradient(0,0,0,h);bg.addColorStop(0,'#394d55');bg.addColorStop(.6,'#273b44');bg.addColorStop(1,'#172b31');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    if(!this.scene)return;
    const {eye,vp}=this.matrices(),world=this.scene.world;
    const p=(x,y,z)=>this.project([x,y,z],vp);
    const s=world.size/2;
    this.polygon([p(-s-28,-4,-s-28),p(s+28,-4,-s-28),p(s+28,-4,s+28),p(-s-28,-4,s+28)],'#182831');
    this.polygon([p(-s,0,-s),p(s,0,-s),p(s,0,s),p(-s,0,s)],'#425759','#708382');
    // All ground geometry is drawn from one shared PCG scene schema.
    for(const parcel of this.scene.parcels){
      const b=parcel.bounds;
      const color=parcel.use==='residential'?'#4e6466':parcel.use==='commercial'?'#72847e':parcel.use==='civic'?'#7e8074':'#4d6d60';
      for(const poly of parcel.cells??[parcel.vertices??[[b.x0,b.z0],[b.x1,b.z0],[b.x1,b.z1],[b.x0,b.z1]]])this.polygon(poly.map(v=>p(v[0],.14,v[1])),color,'#9ab2a02b');
    }
    for(const road of this.scene.roads){
      const b=road.bounds;
      this.polygon(road.vertices?road.vertices.map(v=>p(v[0],.27,v[1])):[p(b.x0,.27,b.z0),p(b.x1,.27,b.z0),p(b.x1,.27,b.z1),p(b.x0,.27,b.z1)],road.kind==='promenade'?'#a1afa4':road.kind==='arterial'?'#a5b1aa':'#273942');
    }
    for(const park of this.scene.parks){
      const b=park.bounds,colors={small:'#75a48a',medium:'#55876f',large:'#3e775f'};
      for(const poly of park.cells??[park.vertices??[[b.x0,b.z0],[b.x1,b.z0],[b.x1,b.z1],[b.x0,b.z1]]])this.polygon(poly.map(v=>p(v[0],.38,v[1])),colors[park.kind]);
    }
    // Draw individual solids back to front, preserving depth cues in 2D fallback.
    const items=[...this.scene.buildings.map(q=>({kind:'building',value:q,x:q.x,z:q.z})),...this.scene.trees.map(q=>({kind:'tree',value:q,x:q.x,z:q.z}))];
    items.sort((a,b)=>Math.hypot(b.x-eye[0],b.z-eye[2])-Math.hypot(a.x-eye[0],a.z-eye[2]));
    for(const item of items){if(item.kind==='building')this.drawBuilding(item.value,vp,eye);else this.drawTree(item.value,vp);}
    const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,'#16252b00');gradient.addColorStop(1,'#15292c22');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
  }
  loop(){if(!this.running)return;this.render();requestAnimationFrame(()=>this.loop());}
  dispose(){this.running=false;this.resizeObserver?.disconnect();}
}
for(const method of ['eye','matrices','zoom','resetCamera','focus','pick','initInput']){
  CanvasFallbackRenderer.prototype[method]=WorldRenderer.prototype[method];
}
