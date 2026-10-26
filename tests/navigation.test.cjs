const test=require('node:test'),assert=require('node:assert/strict'),N=require('../navigation.js');
const origin={lat:40,lon:-83};
test('navigation uses true north bearings and metre distances',()=>{
 for(const heading of [0,90,180,270]){const point=N.offset(origin,heading,70);assert.ok(Math.abs(N.distance(origin,point)-70)<.001);assert.ok(Math.abs(N.angle(N.bearing(origin,point)-heading))<.001)}
});
test('GPS projection uses metres, east-positive x and south-positive z from one shared origin',()=>{
 for(const [heading,x,z] of [[0,0,-70],[90,70,0],[180,0,70],[270,-70,0]]){
  const point=N.project(N.offset(origin,heading,70),origin);assert.ok(Math.abs(point.x-x)<.001);assert.ok(Math.abs(point.z-z)<.001);
 }
 const same=N.project(origin,origin);assert.ok(Math.abs(same.x)<Number.EPSILON);assert.ok(Math.abs(same.z)<Number.EPSILON);
});
test('sound gets louder as the same direction gets closer',()=>{
 for(const direction of [-70,0,70]){const far=N.levels(80,direction),near=N.levels(9,direction);near.forEach((v,i)=>assert.ok(v>far[i]));assert.ok(Math.max(...near)<=1)}
});
test('left, ahead and right probes give different directional clues',()=>{
 for(const [bearing,index] of [[-70,0],[0,1],[70,2]]){const levels=N.levels(30,bearing);assert.equal(levels.indexOf(Math.max(...levels)),index)}
 const behind=N.levels(30,180);assert.ok(behind[1]<N.levels(30,0)[1]);assert.equal(N.angle(350),-10);
});
test('a trail ends at the landmark without forcing detours near it',()=>{
 const target=N.offset(origin,0,72),route=N.trail(origin,target);assert.equal(route.length,3);assert.deepEqual(route.at(-1),target);assert.ok(Math.abs(N.distance(origin,route[0])-24)<.001);assert.equal(N.trail(N.offset(target,180,10),target).length,1);
});
test('discovery rejects noisy or too-rapid GPS confirmations',()=>{
 const target=N.offset(origin,0,4);assert.equal(N.reached(origin,target,45,null,1000),false);assert.equal(N.reached(origin,target,5,900,1000),false);assert.equal(N.reached(origin,target,5,1000,1800),true);assert.equal(N.reached(origin,N.offset(origin,0,50),5,null,1000),false);
});
test('a fixed start requires two accurate recent readings inside the teacher’s 15 m area',()=>{
 const gate=new N.StartGate(origin),fix=(p,t,accuracy=5)=>({coords:{latitude:p.lat,longitude:p.lon,accuracy},timestamp:t});
 assert.equal(gate.receive(fix(N.offset(origin,90,70),1000),1000).status,'away');
 assert.equal(gate.receive(fix(origin,2000,50),2000).status,'inaccurate');
 assert.equal(gate.receive(fix(N.offset(origin,0,8),3000),3000).status,'confirming');
 assert.equal(gate.receive(fix(origin,3300),3300).status,'confirming');
 assert.equal(gate.receive(fix(origin,3800),3800).status,'ready');
 assert.equal(gate.ready(3800),true);
 assert.equal(gate.receive(fix(N.offset(origin,0,17),5000),5000).status,'away');
 assert.equal(gate.ready(5000),false);
});
test('a distant launch, stale readings and an expired start cannot begin the actual quest',()=>{
 const gate=new N.StartGate(origin),fix=(p,t)=>({coords:{latitude:p.lat,longitude:p.lon,accuracy:5},timestamp:t});
 gate.receive(fix(N.offset(origin,0,200),1000),1000);assert.equal(gate.ready(1000),false);
 assert.equal(gate.receive(fix(origin,1000),20000).status,'waiting');
 gate.receive(fix(origin,21000),21000);gate.receive(fix(origin,22000),22000);assert.equal(gate.ready(22000),true);
 assert.equal(gate.ready(38000),false);
});
test('a cached duplicate cannot confirm a start and an old reading cannot replace a newer one',()=>{
 const gate=new N.StartGate(origin),fix=t=>({coords:{latitude:origin.lat,longitude:origin.lon,accuracy:5},timestamp:t});
 gate.receive(fix(1000),1000);gate.receive(fix(1000),2000);assert.equal(gate.ready(2000),false);
 gate.receive(fix(2200),2200);assert.equal(gate.ready(2200),true);
 gate.receive(fix(1500),2300);assert.equal(gate.ready(2300),true);
});
test('poor accuracy or a departure interrupts start confirmation; malformed fixes never unlock it',()=>{
 const gate=new N.StartGate(origin),fix=(t,accuracy=5)=>({coords:{latitude:origin.lat,longitude:origin.lon,accuracy},timestamp:t});
 gate.receive(fix(1000),1000);gate.receive(fix(2000,100),2000);assert.equal(gate.receive(fix(3000),3000).status,'confirming');
 assert.equal(gate.receive({coords:{latitude:NaN,longitude:0,accuracy:1},timestamp:4000},4000).status,'waiting');
 assert.equal(gate.receive(fix(6000),5000).status,'confirming');
 assert.equal(gate.receive(fix(9000),5000).status,'waiting');
});
