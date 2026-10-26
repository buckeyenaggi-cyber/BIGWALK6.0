const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../physics.js');
const ring = { x: 0, y: 1.35 };

test('a throw reaches its aimed point under gravity at different frame rates', () => {
  for (const frames of [12, 30, 60, 144]) {
    const target = { x: -.3, y: 1.35, z: 0 };
    const body = P.launch({ x: .15, y: 1, z: 2.3 }, target, .85);
    for (let i = 0; i < frames; i++) P.step(body, .85 / frames);
    assert.ok(Math.abs(body.x - target.x) < 1e-9);
    assert.ok(Math.abs(body.y - target.y) < 1e-9);
    assert.ok(Math.abs(body.z) < 1e-9);
  }
});
test('a ball passing through the middle scores even when a frame skips the plane', () => {
  const result = P.crossing({ x: 0, y: 1.35, z: .8 }, { x: 0, y: 1.35, z: -1.2 }, ring, ring, .61, .065, .115);
  assert.equal(result.hit, true);
});
test('the full ball must fit inside the opening', () => {
  const result = P.crossing({ x: .5, y: 1.35, z: .3 }, { x: .5, y: 1.35, z: -.3 }, ring, ring, .61, .065, .115);
  assert.equal(result.hit, false);
});
test('a near miss and a throw staying on the same side cannot score', () => {
  assert.equal(P.crossing({ x: 0, y: 1.35, z: .8 }, { x: 0, y: 1.35, z: .2 }, ring, ring, .61, .065, .115), null);
  assert.equal(P.crossing({ x: 0, y: 2.2, z: .3 }, { x: 0, y: 2.2, z: -.3 }, ring, ring, .61, .065, .115).hit, false);
});
test('moving rings are checked where they were when the ball crossed', () => {
  const result = P.crossing({ x: 0, y: 1.35, z: .5 }, { x: 0, y: 1.35, z: -.5 }, { x: -.4, y: 1.35 }, { x: .4, y: 1.35 }, .52, .065, .115);
  assert.equal(result.hit, true);
  assert.equal(result.dx, 0);
});
test('rim contact pushes the ball out of the solid edge and reflects it', () => {
  const body = { x: .64, y: 1.35, z: .02, vx: -1, vy: 0, vz: -2 };
  assert.equal(P.collideRim(body, ring, .61, .065, .115), true);
  const nx = body.x - .61, nz = body.z;
  assert.ok(Math.hypot(nx, nz) >= .18 - 1e-9);
  assert.ok(body.vx * nx + body.vz * nz > 0);
});

test('a kicked spring has the same future position across frame rates', () => {
  const initial = { x: .025, v: 1.1 }, future = P.spring(initial, .7);
  for (const frames of [12, 30, 60, 144]) {
    let state = { ...initial };
    for (let i = 0; i < frames; i++) state = P.spring(state, .7 / frames);
    assert.ok(Math.abs(state.x - future.x) < 1e-11);
    assert.ok(Math.abs(state.v - future.v) < 1e-11);
  }
  assert.deepEqual(initial, { x: .025, v: 1.1 });
});
test('spring contact gives a small response and settles instead of growing', () => {
  let state = { x: 0, v: 1.2 }, max = 0;
  for (let i = 0; i < 180; i++) { state = P.spring(state, 1/60); max = Math.max(max, Math.abs(state.x)); }
  assert.ok(max > .01 && max < .06);
  assert.ok(Math.abs(state.x) < 1e-8 && Math.abs(state.v) < 1e-8);
});

test('a final flick is independent of how long the ball was held', () => {
  const flick=[{x:0,y:0,t:1000},{x:0,y:0,t:1900},{x:50,y:-80,t:2000}];
  const short=[{x:0,y:0,t:1900},{x:50,y:-80,t:2000}];
  assert.ok(P.gestureSpeed(flick,2000,800)>.7);
  assert.equal(P.gestureSpeed(flick,2000,800),P.gestureSpeed(short,2000,800));
  assert.equal(P.gestureSpeed(flick,2200,800),0);
  assert.equal(P.gestureSpeed([{x:0,y:0,t:0}],100,800),0);
});
test('recent flick estimates are stable with extra samples and stop when held still', () => {
  const coarse=[{x:0,y:0,t:0},{x:160,y:0,t:160}],fine=Array.from({length:17},(_,i)=>({x:i*10,y:0,t:i*10}));
  assert.ok(Math.abs(P.gestureSpeed(coarse,160,800)-P.gestureSpeed(fine,160,800))<1e-9);
  assert.equal(P.gestureSpeed([...coarse,{x:160,y:0,t:400}],400,800),0);
});
test('a wide released pendulum crosses every bell angle and damping reduces its energy', () => {
  for(const frames of [20,30,60,120]){
    let state={angle:.95,v:0},min=.95,max=.95,energy=0;
    for(let i=0;i<frames*4;i++){state=P.pendulum(state,1/frames);min=Math.min(min,state.angle);max=Math.max(max,state.angle);energy=Math.max(energy,.5*state.v**2+5.4/1.15*(1-Math.cos(state.angle)));}
    assert.ok(min<-.56&&max>.56);
    assert.ok(energy<5.4/1.15*(1-Math.cos(.95))*1.03);
    assert.ok(Math.abs(state.angle)<.95);
  }
});
