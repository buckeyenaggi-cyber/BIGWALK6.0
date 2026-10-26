const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){
  const requests=[],messages=[],prototype={remove(){this.disposed=true}};
  const context={window:{},navigator:{mediaDevices:{getUserMedia:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../camera-lifecycle.js'),'utf8'),context);
  context.window.installBeaconCameraLifecycle({components:{'arjs-webcam-texture':{Component:{prototype}}}});
  const camera=Object.create(prototype);camera.el={isConnected:true,sceneEl:{systems:{arjs:{_displayErrorPopup:x=>messages.push(x)}}}};
  camera.video={srcObject:null,play:()=>Promise.resolve(),remove(){this.removed=true}};
  const stream=()=>{const track={stops:0,stop(){this.stops++}};return{track,getTracks:()=>[track]}};
  return{camera,requests,messages,stream};
}
test('closing before camera permission resolves stops the late stream',async()=>{
  const {camera,requests,stream}=setup(),late=stream();camera.play();camera.pause();camera.el.isConnected=false;requests[0].resolve(late);await Promise.resolve();
  assert.equal(late.track.stops,1);assert.equal(camera.video.srcObject,null);camera.remove();assert.equal(camera.disposed,true);assert.equal(camera.video.removed,true);
});
test('reopening ignores the previous camera request and pause safely releases the new one',async()=>{
  const {camera,requests,stream}=setup(),old=stream(),fresh=stream();camera.play();camera.pause();camera.play();requests[0].resolve(old);requests[1].resolve(fresh);await Promise.resolve();
  assert.equal(old.track.stops,1);assert.equal(camera.video.srcObject,fresh);camera.pause();camera.pause();assert.equal(fresh.track.stops,1);assert.equal(camera.video.srcObject,null);
});
test('a camera denial after leaving does not create a stale error popup',async()=>{
  const {camera,requests,messages}=setup();camera.play();camera.pause();requests[0].reject(new Error('permission denied'));await Promise.resolve();await Promise.resolve();assert.deepEqual(messages,[]);
});

function markerSetup(){
  const requests=[],events=[],children=[];
  const video={readyState:1,srcObject:null,play:()=>Promise.resolve()};
  function Source(){}Source.prototype.dispose=function(){this.disposed=true;this.domElement=null};
  const context={window:{BeaconArToolkitSource:Source,dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},document:{createElement:()=>video,getElementById:()=>({appendChild:e=>children.push(e)})},navigator:{mediaDevices:{getUserMedia:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../camera-lifecycle.js'),'utf8'),context);
  context.window.installBeaconCameraLifecycle({components:{}});
  const source=new Source();let ready=0;source.domElement=source._initSourceWebcam(()=>ready++);
  const track={stops:0,stop(){this.stops++}},stream={getTracks:()=>[track]};
  return{source,video,requests,events,children,track,stream,get ready(){return ready}};
}
test('marker camera stops a stream granted after closing before attaching a video',async()=>{
  const m=markerSetup();m.source.dispose();m.requests[0].resolve(m.stream);await new Promise(setImmediate);
  assert.equal(m.track.stops,1);assert.equal(m.ready,0);assert.equal(m.children.length,0);assert.equal(m.video.srcObject,null);
});
test('marker camera is attached below the transparent scene and is released on exit',async()=>{
  const m=markerSetup();m.requests[0].resolve(m.stream);await new Promise(setImmediate);
  assert.equal(m.ready,1);assert.equal(m.children[0],m.video);assert.equal(m.video.srcObject,m.stream);
  m.source.dispose();assert.equal(m.track.stops,1);assert.equal(m.video.srcObject,null);
});
test('marker camera denial after exit does not show a stale error',async()=>{
  const m=markerSetup();m.source.dispose();m.requests[0].reject(new Error('denied'));await new Promise(setImmediate);assert.equal(m.events.length,0);
});
test('GPS camera feed keeps aspect ratio below a transparent scene instead of a stretched video quad',()=>{
 const layer=[],prototype={init(){this.scene={renderer:{autoClear:false},object3D:{background:'opaque'}};this.video={style:{}}},remove(){}};
 const context={window:{},document:{getElementById:()=>({appendChild:v=>layer.push(v)})},navigator:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../camera-lifecycle.js'),'utf8'),context);context.window.installBeaconCameraLifecycle({components:{'arjs-webcam-texture':{Component:{prototype}}}});
 const camera=Object.create(prototype);camera.init();assert.equal(layer[0],camera.video);assert.equal(camera.video.id,'arjs-video');assert.equal(camera.video.muted,true);assert.match(camera.video.style.cssText,/object-fit:cover/);assert.equal(camera.scene.object3D.background,null);assert.equal(camera.scene.renderer.autoClear,true);
});
