const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const N=require('../navigation.js');
const {surfaceHit,cameraHeading,alignment,worldAnchor}=require('../ground-tracking.js');
const TARGET={lat:40.000126,lon:-83.013214},RAD=Math.PI/180;
const floor=(x=0,z=-3,y=0)=>({type:'DETECTED_SURFACE',position:{x,y,z},rotation:{x:0,y:0,z:0,w:1}});
const near=(actual,expected,tolerance=.002)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const compass=heading=>({alpha:123,beta:65,gamma:0,webkitCompassHeading:heading,webkitCompassAccuracy:5});
test('ground height accepts horizontal surfaces and rejects feature points, walls and invalid ranges',()=>{
 const camera={x:0,y:1.6,z:0},good=floor(),wall={...floor(),rotation:{x:Math.SQRT1_2,y:0,z:0,w:Math.SQRT1_2}};
 assert.equal(surfaceHit([{...floor(),type:'FEATURE_POINT'},wall,floor(0,-50),{...floor(),rotation:null},good],camera),good);
 assert.equal(surfaceHit([floor(0,0,1.5)],camera),null);
});
test('camera compass heading handles north/east/south/west, tilt and landscape optical axes',()=>{
 for(const heading of [0,90,180,270])near(cameraHeading(compass(heading)),heading);
 near(cameraHeading({alpha:270,beta:45,gamma:0,absolute:true}),90);
 near(cameraHeading({alpha:0,beta:0,gamma:-90,absolute:true}),90);
 near(cameraHeading({alpha:0,beta:0,gamma:90,absolute:true}),270);
 assert.equal(cameraHeading({alpha:30,beta:65,gamma:0,absolute:false}),null);
 assert.equal(cameraHeading({...compass(10),webkitCompassAccuracy:-1}),null);
 assert.equal(cameraHeading({...compass(10),webkitCompassAccuracy:70}),null);
 assert.equal(cameraHeading({...compass(10),beta:0}),null);
});
test('north alignment averages across the wrap and refuses unstable, stale or too brief data',()=>{
 const samples=[179,-179,180,179,-179].map((yaw,i)=>({yaw,at:1000+i*100}));
 near(Math.abs(alignment(samples,1400)),Math.PI,.02);
 assert.equal(alignment(samples,5000),null);
 assert.equal(alignment(samples.slice(-3),1400),null);
 assert.equal(alignment([0,5,40,10,0].map((yaw,i)=>({yaw,at:i*100})),400),null);
});
test('geographic east/south transforms into the tracked frame without using camera aim as a position',()=>{
 const p=worldAnchor({x:10,z:-2},{x:3,y:1.6,z:4},Math.PI/2,.1);
 near(p.x,1);near(p.z,-6);near(p.y,.1);
});
class Events{
 constructor(){this.events=new Map()}
 addEventListener(n,f){if(!this.events.has(n))this.events.set(n,new Set());this.events.get(n).add(f)}
 removeEventListener(n,f){this.events.get(n)?.delete(f)}emit(n,detail){this.events.get(n)?.forEach(f=>f({type:n,...detail,detail}))}
}
class V{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z})}set(x,y,z){Object.assign(this,{x,y,z});return this}copy(p){return this.set(p.x,p.y,p.z)}}
function setup({heading=0,localHeading=0,point=N.offset(TARGET,180,8)}={}){
 const root=new Events(),scene=new Events(),objects=new Set(),attributes={},camera=new V(0,1.6,0),forward=new V(Math.sin(localHeading*RAD)*.9,-.4,-Math.cos(localHeading*RAD)*.9);
 const watches=[],cleared=[],fresh=[];let hit=floor(),calls=0,stops=0,now=1000000;
 scene.object3D={add:o=>objects.add(o),remove:o=>objects.delete(o)};
 scene.camera={updateWorldMatrix(){},getWorldPosition:v=>v.copy(camera),getWorldDirection:v=>v.copy(forward)};
 scene.setAttribute=(n,v)=>attributes[n]=v;scene.removeAttribute=n=>delete attributes[n];
 const field={visible:true,position:new V(),rotation:{set(x,y,z){Object.assign(this,{x,y,z})}},updateWorldMatrix(){}};
 root.AFRAME={THREE:{Vector3:V}};root.BeaconNavigation=N;
 root.XR8={XrController:{hitTest(){calls++;return hit?[hit]:[]}},stop(){stops++}};
 root.navigator={geolocation:{watchPosition:(ok,error)=>{watches.push({ok,error});return watches.length},clearWatch:id=>cleared.push(id),getCurrentPosition:(ok,error)=>fresh.push({ok,error})}};
 const context={window:root,module:{exports:{}},Date:class extends Date{static now(){return now}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../ground-tracking.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(require.resolve('../spatial-ar.js'),'utf8'),context);
 const updates=[],controller=new context.module.exports.SpatialAR({scene,field,mode:'xr8',target:TARGET,onTracking:v=>updates.push(v)});
 const frames=(n,withHeading=true)=>{for(let i=0;i<n;i++){now+=50;root.emit('deviceorientation',withHeading?compass(heading):{alpha:123,beta:65,gamma:0,absolute:false});controller.tick(null,.05)}};
 const fix=(p=point,accuracy=5,timestamp=now)=>({coords:{latitude:p.lat,longitude:p.lon,accuracy},timestamp});
 const ready=(p=point,withHeading=true)=>{scene.emit('xrtrackingstatus',{status:'NORMAL'});frames(25,withHeading);watches[0].ok(fix(p));frames(16,withHeading);watches[0].ok(fix(p));frames(1,withHeading)};
 return{root,scene,attributes,camera,forward,field,objects,controller,updates,frames,fix,ready,watches,cleared,fresh,setHit:h=>hit=h,get now(){return now},get calls(){return calls},get stops(){return stops}};
}
test('startup requests actual absolute SLAM, hides models and exposes no manual placement or ground reticle',()=>{
 const e=setup();assert.equal(e.field.visible,false);assert.match(e.attributes.xrweb,/scale: absolute/);assert.match(e.attributes.xrweb,/disableWorldTracking: false/);assert.match(e.attributes.xrconfig,/disableDefaultEnvironment: true/);assert.equal(e.objects.size,0);assert.equal(e.controller.place,undefined);e.controller.dispose();
});
test('models appear automatically at the project coordinate, independently of surface-hit x/z',()=>{
 const e=setup();e.setHit(floor(4,-2,.08));e.ready();assert.equal(e.controller.placed,true);assert.equal(e.field.visible,true);
 near(e.field.position.x,0);near(e.field.position.z,-8);near(e.field.position.y,.08);assert.ok(e.cleared.includes(1));assert.equal(e.root.events.get('deviceorientation').size,0);e.controller.dispose();
});
test('looking east maps an eastward GPS target forward; it does not relocate the target in front of every viewer',()=>{
 const e=setup({heading:90,point:N.offset(TARGET,270,10)});e.ready();near(e.field.position.x,0);near(e.field.position.z,-10);near(e.field.rotation.y,Math.PI/2);e.controller.dispose();
 const other=setup({heading:0,point:N.offset(TARGET,90,10)});other.ready();near(other.field.position.x,-10);near(other.field.position.z,0);near(other.field.rotation.y,0);other.controller.dispose();
});
test('walking during initial GPS sampling resolves the same target in the tracked frame',()=>{
 const e=setup();e.scene.emit('xrtrackingstatus',{status:'NORMAL'});e.frames(25);e.watches[0].ok(e.fix());
 e.camera.set(0,1.6,-2);e.frames(16);e.watches[0].ok(e.fix(N.offset(TARGET,180,6)));e.frames(1);
 near(e.field.position.z,-8);assert.equal(e.field.visible,true);e.controller.dispose();
});
test('phone translation, rotation, later GPS and new surface hits cannot move or rotate the locked installation',()=>{
 const e=setup();e.ready();const initial={...e.field.position},yaw=e.field.rotation.y,calls=e.calls;
 e.camera.set(2,1.6,-3);e.forward.set(1,0,0);e.setHit(floor(50,-50));e.watches[0].ok(e.fix(N.offset(TARGET,270,30)));
 e.root.emit('deviceorientation',compass(270));e.frames(30);assert.deepEqual({...e.field.position},initial);assert.equal(e.field.rotation.y,yaw);assert.equal(e.calls,calls);
 for(const request of e.fresh)request.ok(e.fix(N.offset(TARGET,0,25)));
 e.frames(1);assert.deepEqual({...e.field.position},initial);e.controller.dispose();
});
test('limited tracking hides all models; recovery restores the existing coordinate without re-anchoring',()=>{
 const e=setup();e.ready();const original={...e.field.position};e.scene.emit('xrtrackingstatus',{status:'LIMITED'});assert.equal(e.field.visible,false);assert.equal(e.controller.tracked,false);
 e.camera.set(-4,1.6,2);e.setHit(floor(-8,4));e.scene.emit('xrtrackingstatus',{status:'NORMAL'});e.frames(20);assert.equal(e.field.visible,true);assert.deepEqual({...e.field.position},original);e.controller.dispose();
});
test('unusable GPS, duplicates and distant coordinates never spawn an installation near the camera',()=>{
 const e=setup();e.scene.emit('xrtrackingstatus',{status:'NORMAL'});e.frames(25);
 for(const fix of [e.fix(undefined,50),e.fix(undefined,5,e.now-10000),e.fix(undefined,5,e.now+5000),e.fix(N.offset(TARGET,0,100))]){e.watches[0].ok(fix);e.frames(2);assert.equal(e.field.visible,false)}
 e.watches[0].ok(e.fix());const same=e.fix();e.frames(20);e.watches[0].ok(same);e.frames(1);assert.equal(e.field.visible,false);e.controller.dispose();
});
test('relative phone yaw cannot be mistaken for a compass and cannot produce automatic placement',()=>{
 const e=setup();e.ready(undefined,false);assert.equal(e.field.visible,false);assert.match(e.controller.message,/Lift your phone/);e.controller.dispose();
});
test('high-frequency compass events retain enough time history to finish alignment',()=>{
 const e=setup();e.scene.emit('xrtrackingstatus',{status:'NORMAL'});e.frames(25,false);e.watches[0].ok(e.fix());
 for(let i=0;i<16;i++){e.frames(1,false);for(let j=0;j<12;j++)e.root.emit('deviceorientation',compass(0))}
 e.watches[0].ok(e.fix());e.frames(1,false);assert.equal(e.field.visible,true);e.controller.dispose();
});
test('an older failing GPS callback cannot discard a newer accepted position',()=>{
 const e=setup();e.scene.emit('xrtrackingstatus',{status:'NORMAL'});e.frames(25);e.watches[0].ok(e.fix());
 e.watches[0].ok(e.fix(undefined,100,e.now-3000));e.frames(16);e.watches[0].ok(e.fix());e.frames(1);assert.equal(e.field.visible,true);e.controller.dispose();
});
test('absolute SLAM ground height supports automatic appearance without choosing a visible surface',()=>{
 const e=setup();e.setHit(null);e.ready();assert.equal(e.field.visible,true);near(e.field.position.y,0);near(e.field.position.z,-8);e.controller.dispose();
});
test('a tabletop cannot replace the estimated ground plane',()=>{
 const e=setup();e.setHit(floor(0,-3,.9));e.ready();near(e.field.position.y,0);e.controller.dispose();
});
test('permission denial stops retries; closing stops the engine and sensors once and ignores late callbacks',()=>{
 const e=setup();e.scene.emit('xrtrackingstatus',{status:'NORMAL'});e.frames(20);e.watches[0].error({code:1});assert.match(e.controller.message,/Allow location/);const requests=e.fresh.length;e.frames(100);assert.equal(e.fresh.length,requests);
 e.controller.dispose();e.controller.dispose();assert.equal(e.stops,1);assert.equal(e.objects.size,0);assert.equal(e.scene.events.get('xrtrackingstatus').size,0);assert.equal(e.root.events.get('deviceorientation').size,0);assert.equal(e.attributes.xrweb,undefined);
 e.watches[0].ok(e.fix());for(const request of e.fresh)request.ok(e.fix());assert.equal(e.field.visible,false);
});
