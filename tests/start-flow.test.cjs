const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const N=require('../navigation.js');
const START={lat:40.000211,lon:-83.011224},TARGET={lat:40.000126,lon:-83.013214};
class Element{
 constructor(){this.hidden=false;this.disabled=false;this.textContent='';this.style={};this.events={};this.children=[];const classes=new Set();this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)};}
 addEventListener(n,f){(this.events[n]??=[]).push(f)}removeEventListener(){}trigger(n,e={}){this.events[n]?.forEach(f=>f(e))}
 replaceChildren(...v){this.children=v}appendChild(v){this.children.push(v)}querySelectorAll(){return this.children}querySelector(){return null}remove(){}play(){return Promise.resolve()}
}
function environment(){
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
 const watches=[],cleared=[],fresh=[],intervals=new Map(),timeouts=new Map();let next=0;
 const windowEvents=new Element(),documentEvents=new Element(),body=new Element();
 const document={getElementById:$,createElement:()=>new Element(),querySelector:()=>new Element(),querySelectorAll:()=>[],body,visibilityState:'visible',addEventListener:(...a)=>documentEvents.addEventListener(...a),removeEventListener(){}};
 const context={URLSearchParams,location:{search:'',protocol:'https:'},document,isSecureContext:true,Date,performance:{now:()=>Date.now()},screen:{orientation:{angle:0}},matchMedia:()=>({matches:false}),setTimeout:(f)=>{const id=++next;timeouts.set(id,f);return id},clearTimeout:id=>timeouts.delete(id),setInterval:(f)=>{const id=++next;intervals.set(id,f);return id},clearInterval:id=>intervals.delete(id),navigator:{geolocation:{watchPosition:(ok,error)=>{watches.push({ok,error});return watches.length},clearWatch:id=>cleared.push(id),getCurrentPosition:(ok,error)=>fresh.push({ok,error})},mediaDevices:{getUserMedia:()=>Promise.resolve({getTracks:()=>[{stop(){}}]})}}};
 context.window={BeaconNavigation:N,addEventListener:(...a)=>windowEvents.addEventListener(...a),removeEventListener(){}};
 return{context,$,watches,cleared,fresh,intervals,timeouts,windowEvents,documentEvents};
}
function app(search=''){
 const e=environment();e.context.location.search=search;
 class Trail {constructor(options){this.options=options;e.trail=this}begin(...args){this.args=args;this.active=true}stop(){this.active=false}}
 e.context.window.SoundTrail=Trail;
 vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),e.context);return e;
}
const fix=(point,timestamp,accuracy=5)=>({coords:{latitude:point.lat,longitude:point.lon,accuracy,heading:270},timestamp});
test('ordinary website opening requests GPS immediately and never marks a distant launch as the start',()=>{
 const e=app();assert.equal(e.watches.length,1);assert.equal(e.$('start').disabled,true);
 e.watches[0].ok(fix(TARGET,Date.now()));assert.match(e.$('status').textContent,/170 m to start/);assert.equal(e.$('start').disabled,true);assert.equal(e.trail.args,undefined);
});
test('nearby confirmations enable Start, then hand off to the sound quest and release the landing watch',async()=>{
 const e=app(),at=Date.now()-2000;e.watches[0].ok(fix(START,at));assert.equal(e.$('start').disabled,true);
 e.watches[0].ok(fix(N.offset(START,0,6),at+900));assert.equal(e.$('status').textContent,'Start ✓');assert.equal(e.$('start').disabled,false);
 e.$('start').trigger('click');assert.equal(e.$('start-screen').hidden,true);assert.equal(e.trail.args[0],false);assert.equal(e.trail.args[1].startConfirmed,true);
 assert.deepEqual({...e.trail.options.start},START);assert.deepEqual({...e.trail.options.target},TARGET);assert.ok(e.cleared.includes(1));
 e.watches[0].ok(fix(TARGET,Date.now()));assert.equal(e.$('start-screen').hidden,true);await Promise.resolve();
});
test('location denial offers a deliberate retry and does not keep retrying permission in the background',()=>{
 const e=app();e.watches[0].error({code:1});assert.match(e.$('status').textContent,/Allow location/);assert.equal(e.$('start').textContent,'Retry location');
 for(const fn of e.intervals.values())fn();assert.equal(e.fresh.length,0);
 e.$('start').trigger('click');assert.equal(e.watches.length,2);assert.equal(e.trail.args,undefined);
});
test('explicit practice skips real GPS, and leaving the page stops landing watches and timers',()=>{
 const practice=app('?preview');assert.equal(practice.watches.length,0);practice.$('start').trigger('click');assert.equal(practice.trail.args[0],true);
 const e=app();e.windowEvents.trigger('pagehide');assert.ok(e.cleared.includes(1));assert.equal(e.intervals.size,0);assert.equal(e.timeouts.size,0);
});
function realTrail(){
 const e=environment(),notes=[];e.context.window.BeaconNavigation=N;
 vm.runInNewContext(fs.readFileSync(require.resolve('../sound-trail.js'),'utf8'),e.context);
 e.trail=new e.context.window.SoundTrail({start:START,target:TARGET,reducedMotion:()=>false,audio:{unlock(){},stopAll(){},win(){notes.push('win')},navigation(){notes.push('note')}},onFound(){notes.push('entered')},onExit(){}});
 return{...e,notes};
}
test('the actual quest cannot start at the activities; its route is seeded from the fixed teacher start',()=>{
 const e=realTrail(),t=Date.now()-6000;e.trail.begin(false);
 e.trail.receive(fix(TARGET,t));e.trail.receive(fix(TARGET,t+800));assert.equal(e.trail.startConfirmed,false);assert.equal(e.trail.route,null);assert.equal(e.$('trail-field').hidden,true);
 e.trail.receive(fix(N.offset(START,90,7),t+1600));e.trail.receive(fix(START,t+2400));assert.equal(e.trail.startConfirmed,true);assert.equal(e.$('trail-field').hidden,false);
 assert.ok(N.distance(e.trail.route[0],N.trail(START,TARGET)[0])<.001);assert.deepEqual({...e.trail.route.at(-1)},TARGET);
 e.trail.receive(fix(TARGET,t+3200));e.trail.receive(fix(TARGET,t+4000));assert.equal(e.trail.found,true);assert.equal(e.$('trail-found').hidden,false);e.trail.stop();
});
test('retrying GPS halfway through an accepted quest does not force a return to the start',()=>{
 const e=realTrail(),t=Date.now()-2000;e.trail.begin(false,{startConfirmed:true});e.trail.receive(fix(N.offset(START,270,50),t));
 e.$('trail-retry').trigger('click');assert.equal(e.trail.startConfirmed,true);e.trail.receive(fix(N.offset(START,270,70),t+1000));assert.equal(e.trail.route.length,3);e.trail.stop();
});
