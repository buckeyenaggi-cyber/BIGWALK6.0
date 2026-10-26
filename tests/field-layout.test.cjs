const test=require('node:test'),assert=require('node:assert/strict'),L=require('../field-layout.js');
test('three independent stations form a triangle with room between their objects',()=>{
  assert.deepEqual(L.stations.map(s=>s.id),['throw','swing','echo']);
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert.ok(Math.hypot(L.stations[i].x-L.stations[j].x,L.stations[i].z-L.stations[j].z)>3.5);
  assert.ok(L.stations[2].z<L.stations[0].z);
});
test('coarse, stale and ambiguous positions cannot auto-select a nearby station',()=>{
  const points=L.stations.map(s=>({...s}));
  assert.equal(L.nearby(points,{x:-2.05,z:1.8},10),null);
  assert.equal(L.nearby(points,{x:-2.05,z:1.8},2,5100),null);
  assert.equal(L.nearby(points,{x:0,z:0},2),null);
  assert.equal(L.nearby(points,{x:0,z:8},2),null);
  assert.equal(L.nearby(points,{x:-2.05,z:1.8},2),'throw');
  assert.equal(L.nearby(points,{x:2.05,z:1.8},2),'swing');
  assert.equal(L.nearby(points,{x:0,z:-2.3},2),'echo');
});
