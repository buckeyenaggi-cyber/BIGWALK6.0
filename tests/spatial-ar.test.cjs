const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
// Sensor/session fakes, not a claim of hardware tracking validation.
class Events{constructor(){this.events={}}addEventListener(n,f){(this.events[n]??=new Set()).add(f)}removeEventListener(n,f){this.events[n]?.delete(f)}emit(n,e={}){this.events[n]?.forEach(f=>f(e))}}
class Vector3{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z})}set(x,y,z){Object.assign(this,{x,y,z});return this}copy(p){return this.set(p.x,p.y,p.z)}setFromMatrixPosition(m){return this.set(m.e[12],m.e[13],m.e[14])}transformDirection(m){const a=m.e;return this.set(a[4],a[5],a[6])}}
class Matrix4{fromArray(e){this.e=e;return this}}
class Resource{rotateX(){return this}dispose(){this.disposed=true}}
class Mesh{constructor(geometry,material){Object.assign(this,{geometry,material,position:new Vector3()})}}
function setup(mode='webxr'){
 const context={window:{AFRAME:{THREE:{Vector3,Matrix4,Mesh,RingGeometry:Resource,MeshBasicMaterial:Resource,DoubleSide:2}}},module:{exports:{}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../spatial-ar.js'),'utf8'),context);
 const marker=new Events();marker.object3D={visible:false};
 const xr=new Events(),session=new Events(),tracking=[],errors=[];
 session.domOverlayState={type:'screen'};session.visibilityState='visible';session.requestReferenceSpace=async()=>({});session.end=async()=>{session.ended=true};
 const source={cancels:0,cancel(){this.cancels++}};session.requestHitTestSource=async()=>source;
 xr.getSession=()=>session;xr.getReferenceSpace=()=>({});
 const objects=new Set(),scene={renderer:{xr},querySelector:()=>marker,object3D:{add:o=>objects.add(o),remove:o=>objects.delete(o)}};
 const field={visible:true,position:new Vector3(),rotation:{set(x,y,z){Object.assign(this,{x,y,z})}},updateWorldMatrix(){}};
 const controller=new context.module.exports.SpatialAR({scene,field,mode,onTracking:(...v)=>tracking.push(v),onError:e=>errors.push(e)});
 const matrix=(x=0,y=0,z=0,up=1)=>[1,0,0,0,0,up,0,0,0,0,1,0,x,y,z,1];
 const hit=m=>({getPose:()=>({transform:{matrix:m}})});
 return{api:context.module.exports,controller,field,marker,xr,session,tracking,errors,source,objects,matrix,hit};
}
test('real world tracking is the default and never silently falls back to GPS or practice',()=>{
 const {api}=setup();assert.equal(api.choose(),'xr8');assert.equal(api.choose({immersive:true}),'webxr');assert.equal(api.choose({immersive:true,marker:true}),'marker');assert.equal(api.choose({practice:true,immersive:true}),'practice');
});
test('marker loss hides objects and reacquisition never moves the field origin',()=>{
 const {controller:c,marker,field,tracking}=setup('marker');assert.equal(field.visible,false);
 field.position.set(1,0,2);marker.object3D.visible=true;c.tick();assert.equal(field.visible,true);assert.equal(c.placed,true);
 marker.object3D.visible=false;c.tick();assert.equal(field.visible,false);assert.equal(c.tracked,false);
 marker.object3D.visible=true;c.tick();assert.equal(c.tracked,true);assert.deepEqual({...field.position},{x:1,y:0,z:2});assert.equal(tracking.length,3);
 c.dispose();marker.emit('markerLost');assert.equal(tracking.length,3);
});
test('floor placement rejects walls and stale hits, then stays fixed while the viewer moves',async()=>{
 const {controller:c,field,session,hit,matrix,source}=setup();await c.setupSession();
 const frame={getViewerPose:()=>({}),getHitTestResults:()=>[hit(matrix(8,0,9,0))]};c.tick(frame);assert.equal(c.pose,null);assert.equal(c.place({}),false);
 frame.getHitTestResults=()=>[hit(matrix(1,.2,-3))];c.tick(frame);assert.equal(c.reticle.visible,true);
 frame.getHitTestResults=()=>[];c.tick(frame);assert.equal(c.pose,null);assert.equal(c.reticle.visible,false);
 frame.getHitTestResults=()=>[hit(matrix(1,.2,-3))];c.tick(frame);
 assert.equal(c.place({getWorldPosition:v=>v.set(1,1.6,0)}),true);assert.equal(field.visible,true);assert.equal(source.cancels,1);
 frame.getHitTestResults=()=>[hit(matrix(100,100,100))];c.tick(frame);assert.deepEqual({...field.position},{x:1,y:.2,z:-3});assert.equal(c.place({}),false);
 frame.getViewerPose=()=>null;c.tick(frame);assert.equal(field.visible,false);frame.getViewerPose=()=>({});c.tick(frame);assert.equal(field.visible,true);
 c.dispose();assert.equal(session.ended,true);
});
test('closing while hit-test permission is pending cancels the late source',async()=>{
 const {controller:c,session,source}=setup();let resolve,requested;const started=new Promise(r=>requested=r);
 session.requestHitTestSource=()=>{requested();return new Promise(r=>resolve=r)};const opening=c.setupSession();await started;c.dispose();resolve(source);await opening;
 assert.equal(source.cancels,1);assert.equal(c.hitSource,null);
});
test('an AR session without touchscreen overlay does not become a noninteractive viewer',async()=>{
 const {controller:c,session,errors}=setup();session.domOverlayState=null;await c.setupSession();assert.equal(session.ended,true);assert.equal(errors.length,1);assert.equal(c.tracked,false);
});

function gpsSetup(){
 const N=require('../navigation.js'),root=new Events(),watches=[],cleared=[],timers=new Set(),orientation={};
 root.AFRAME={THREE:{Vector3}};root.BeaconNavigation=N;root.navigator={geolocation:{watchPosition:(ok,error)=>{watches.push({ok,error});return watches.length},clearWatch:id=>cleared.push(id)}};root.setInterval=f=>{timers.add(f);return f};root.clearInterval=f=>timers.delete(f);
 const context={window:root,module:{exports:{}}};vm.runInNewContext(fs.readFileSync(require.resolve('../spatial-ar.js'),'utf8'),context);
 const camera={object3D:{position:new Vector3(0,1.5,0)},components:{'arjs-device-orientation-controls':{_orientationControls:orientation}}};
 const field={visible:true,position:new Vector3(),rotation:{set(x,y,z){Object.assign(this,{x,y,z})}},updateWorldMatrix(){}};
 const origin={lat:40.000211,lon:-83.011224},target={lat:40.000126,lon:-83.013214};
 const tracking=[],controller=new context.module.exports.SpatialAR({scene:{querySelector:()=>camera},field,mode:'gps',origin,target,onTracking:v=>tracking.push(v)});
 const fix=(point=target,accuracy=5,timestamp=Date.now())=>({coords:{latitude:point.lat,longitude:point.lon,accuracy},timestamp});
 const heading={alpha:35,beta:90,gamma:0,webkitCompassHeading:90,webkitCompassAccuracy:5};
 return{N,root,watches,cleared,timers,camera,field,origin,target,tracking,controller,fix,heading,orientation};
}
test('GPS and compass place the field at the fixed project coordinate without any physical marker',()=>{
 const e=gpsSetup(),expected=e.N.project(e.target,e.origin),original={...e.field.position};
 assert.ok(Math.abs(original.x-expected.x)<.001);assert.equal(e.field.visible,false);
 e.watches[0].ok(e.fix());assert.equal(e.field.visible,false);e.root.emit('deviceorientation',e.heading);assert.equal(e.field.visible,true);
 assert.ok(Math.abs(e.camera.object3D.position.x-expected.x)<.001);
 const moved=e.N.offset(e.target,0,5);e.watches[0].ok(e.fix(moved));e.controller.tick(null,.05);
 assert.ok(e.camera.object3D.position.z<expected.z);assert.deepEqual({...e.field.position},original);
 e.controller.dispose();
});
test('relative orientation alone cannot pretend to be north; iPhone compass corrects the yaw reference',()=>{
 const e=gpsSetup();e.watches[0].ok(e.fix());e.root.emit('deviceorientation',{alpha:10,beta:90,gamma:0,absolute:false});assert.equal(e.field.visible,false);
 e.root.emit('deviceorientation',e.heading);assert.equal(e.field.visible,true);
 assert.ok(Math.abs(e.N.angle(e.heading.alpha+e.orientation.alphaOffset*180/Math.PI-(360-e.heading.webkitCompassHeading)))<.001);
 e.controller.dispose();
});
test('noisy and stale fixes hide GPS objects, and exit clears location, timer and orientation listeners',()=>{
 const e=gpsSetup();e.root.emit('deviceorientation',e.heading);e.watches[0].ok(e.fix());assert.equal(e.field.visible,true);
 e.watches[0].ok(e.fix(e.target,50));assert.equal(e.field.visible,false);
 e.watches[0].ok(e.fix(e.target,5,Date.now()-30000));assert.equal(e.field.visible,false);
 e.watches[0].ok(e.fix());assert.equal(e.field.visible,true);e.controller.geoAt=Date.now()-20000;e.controller.tick();assert.equal(e.field.visible,false);
 e.controller.dispose();assert.ok(e.cleared.includes(1));assert.equal(e.timers.size,0);assert.equal(e.root.events.deviceorientation.size,0);
 e.watches[0].ok(e.fix());assert.equal(e.field.visible,false);
});
