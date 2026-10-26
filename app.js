/* Bounce & Echo — 中文注释标出定位、投掷、进球和彩带的关键位置。 */
(() => {
  'use strict';
  const modelRefs=new Map();
  const P = window.BeaconPhysics, L=window.BeaconFieldLayout, $ = id => document.getElementById(id)||modelRefs.get(id);
  const CAMERA_HEIGHT=1.5; // 相机离地高度：课堂现场需要调整时在这里改，界面不加设置菜单。
  const START_POINT = { lat: 40.000211, lon: -83.011224 }; // 最初发来的 starter 坐标：在这个固定起点附近确认后开始。
  const TARGET = { lat: 40.000126, lon: -83.013214 }; // 用户保存的 ant 点；三个活动共用这个 GPS 目标，照片采样精度约 ±5 m。
  const query = new URLSearchParams(location.search), SCOUT = query.has('scout');
  let previewMode = query.has('fake')||query.has('preview')||query.has('toy'), unlocked = false, watchId = null, lastFix = null;
  let arMode='xr8',trailFeed=null,trailFeedToken=0;
  const startGate=new window.BeaconNavigation.StartGate(START_POINT);
  let startWatch=null,startRefresh=null,startUiTimer=null,startEpoch=0,startRequestPending=false,startError=null;
  let session = 0, opening = false, currentMode = null, game = null, lastQuestDemo = null,cameraTest=false;
  const progress = { walk: false, toss: 0, shots: 0, bells: 0, echo: 0 };
  const ECHO_PATTERNS = [[0, 2], [1, 0, 2], [2, 0, 1, 2]], BELL_ANGLES = [-.56, 0, .56];
  const tasksDone = () => [progress.toss >= 3, progress.bells === 7, progress.echo >= 3];
  const scriptLoads = new Map();
  let reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;



  class ToyAudio {
    constructor() { this.ctx = null; this.muted = false; this.active = new Set(); }
    unlock() {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!this.ctx) { this.ctx = new AudioContext(); this.master = this.ctx.createGain(); this.master.gain.value = .18; this.master.connect(this.ctx.destination); }
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      } catch (_) { /* 没有音频时仍可使用视觉提示完成。 */ }
    }
    note(frequency, start, duration, pan = 0, volume = 1, type = 'sine', source = null) {
      if (!this.ctx || this.ctx.state !== 'running' || this.muted) return;
      const osc = this.ctx.createOscillator(), envelope = this.ctx.createGain();
      const panner = source ? this.ctx.createPanner() : (this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain());
      if (source) {
        // Three.js PositionalAudio uses this HRTF model; keep source coordinates relative to the listener.
        panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 2; panner.rolloffFactor = 1; panner.maxDistance = 30;
      } else if (panner.pan) panner.pan.value = P.clamp(pan, -.95, .95);
      const voice = { osc, panner, source }; this.active.add(voice); this.positionVoice(voice);
      osc.type = type; osc.frequency.value = frequency;
      envelope.gain.setValueAtTime(0, start); envelope.gain.linearRampToValueAtTime(volume, start + .015);
      envelope.gain.exponentialRampToValueAtTime(.001, start + duration);
      osc.connect(envelope); envelope.connect(panner); panner.connect(this.master);
      osc.start(start); osc.stop(start + duration + .025);
      osc.onended = () => { this.active.delete(voice); osc.disconnect(); envelope.disconnect(); panner.disconnect(); };
    }
    navigation(gain, pan) {
      if (!this.ctx) return;
      const at=this.ctx.currentTime+.015;
      [392,493.88,587.33].forEach((frequency,i)=>this.note(frequency,at+i*.13,.17,pan,gain,'triangle'));
    }
    positionVoice(voice) {
      if (!voice.source || !this.ctx) return;
      const p = voice.source(), node = voice.panner;
      if (node.positionX) { node.positionX.value = p.x; node.positionY.value = p.y; node.positionZ.value = p.z; }
      else node.setPosition(p.x, p.y, p.z);
    }
    update() { this.active.forEach(v => this.positionVoice(v)); }
    stopAll() { this.active.forEach(v => { try { v.osc.stop(); } catch (_) {} }); }
    win(final = false, source = null) {
      if (!this.ctx) return;
      const at = this.ctx.currentTime + .01;
      (final ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 783.99]).forEach((f, i) => this.note(f, at + i * .09, .28, 0, .55, 'sine', source));
    }
    impact(speed, kind, source) {
      if (!this.ctx) return;
      const strength = P.clamp(speed / 5, .15, 1), frequency = kind === 'rim' ? 290 + strength * 190 : 105 + strength * 55;
      this.note(frequency, this.ctx.currentTime + .005, kind === 'rim' ? .17 : .1, 0, .12 + strength * strength * .4, kind === 'rim' ? 'sine' : 'triangle', source);
    }
    audition(index, source) {
      if (this.ctx) this.note([392, 493.88, 587.33][index], this.ctx.currentTime + .01, .2, 0, .5, 'sine', source);
    }
    toggle() { this.unlock(); this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : .18; return this.muted; }
  }
  const audio = new ToyAudio();

  const trail = new window.SoundTrail({
    start: START_POINT, target: TARGET, audio, reducedMotion: () => reducedMotion,
    onFound({ demo }) { stopTrailCamera(); lastQuestDemo = demo; previewMode = demo; if (!demo) unlocked = true; progress.walk = true; currentMode = null; openBeacon(); },
    onExit() { stopTrailCamera(); $('start-screen').hidden = false; startLandingGPS(); }
  });
  window.beaconTrail = trail;
  if (SCOUT) {
    document.querySelector('h1').textContent = 'Scout the Oval';
    $('howto').hidden=false;$('howto').textContent = 'Save this location.';
    $('start').textContent = 'Start GPS';
  }
  const directCamera=()=>query.has('camera')||query.has('marker')&&!query.has('trail');
  function stopLandingGPS(){
    ++startEpoch;if(startWatch!==null)navigator.geolocation?.clearWatch(startWatch);startWatch=null;
    clearTimeout(startRefresh);clearInterval(startUiTimer);startRefresh=startUiTimer=null;startRequestPending=false;
  }
  function renderLandingGPS(){
    if($('start-screen').hidden||SCOUT||previewMode||directCamera()||progress.walk)return;
    const state=startGate.snapshot();$('start').disabled=!startError&&state.status!=='ready';$('start').textContent=startError?'Retry location':'Start';
    if(startError){$('status').textContent=startError;return;}
    $('status').textContent=state.status==='ready'?'Start ✓':state.status==='away'?`${Math.round(state.distance)} m to start · ${['N','NE','E','SE','S','SW','W','NW'][Math.round(state.bearing/45)%8]}`:state.status==='inaccurate'&&Number.isFinite(state.accuracy)?`GPS ±${Math.round(state.accuracy)} m · Waiting…`:state.status==='confirming'?'Confirming start…':'Locating start…';
  }
  function startLandingGPS(){
    stopLandingGPS();
    if(SCOUT||previewMode||directCamera()||progress.walk){$('start').disabled=false;return;}
    startGate.reset();startError=null;const token=startEpoch;
    const fail=error=>{if(token!==startEpoch)return;startGate.reset();startError=error.code===1?'Allow location, then retry.':'GPS unavailable. Try outside.';renderLandingGPS();};
    if(!isSecureContext||!navigator.geolocation){startError='Open the HTTPS website to locate the start.';renderLandingGPS();return;}
    const options={enableHighAccuracy:true,maximumAge:0,timeout:20000};
    const freshFix=()=>{
      if(token!==startEpoch||startGate.ready()||startRequestPending||!navigator.geolocation.getCurrentPosition)return;
      startRequestPending=true;navigator.geolocation.getCurrentPosition(position=>{if(token!==startEpoch)return;startRequestPending=false;receive(position);},error=>{if(token!==startEpoch)return;startRequestPending=false;if(!startGate.ready())fail(error);},options);
    };
    const receive=position=>{
      if(token!==startEpoch||$('start-screen').hidden)return;
      startError=null;const state=startGate.receive(position);renderLandingGPS();
      if(state.status==='confirming'&&startRefresh===null)startRefresh=setTimeout(()=>{startRefresh=null;freshFix();},800);
    };
    renderLandingGPS();startWatch=navigator.geolocation.watchPosition(receive,fail,options);
    startUiTimer=setInterval(()=>{if(token!==startEpoch)return;renderLandingGPS();if(!startError&&startGate.snapshot().status==='waiting')freshFix();},1500);
  }
  function beginTrail(demo,startConfirmed=false) {
    stopLandingGPS();$('start').disabled=false;
    cameraTest=false;
    if (watchId !== null) navigator.geolocation?.clearWatch(watchId); watchId = null;
    progress.walk = false; progress.toss = 0; progress.shots = 0; progress.bells = 0; progress.echo = 0; currentMode = null;
    $('start-screen').hidden = true; trail.begin(demo,{startConfirmed});if(!demo)startTrailCamera();
  }
  $('start').addEventListener('click',()=>{
    if(SCOUT)return startScout();
    if(!previewMode&&directCamera()){cameraTest=true;return openBeacon();}
    if(progress.walk)return openBeacon();
    if(!previewMode&&!startGate.ready()){startLandingGPS();return;}
    cameraTest=false;beginTrail(previewMode,!previewMode);
  });
  async function startTrailCamera(){
    const token=++trailFeedToken;
    try{
      if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Open the HTTPS site to use the camera.');
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
      if(token!==trailFeedToken||!trail.active){stream.getTracks().forEach(t=>t.stop());return;}
      const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.srcObject=stream;
      video.style.cssText='width:100%;height:100%;object-fit:cover';trailFeed=video;$('camera-layer').appendChild(video);await video.play();document.body.classList.add('camera-on');
    }catch(e){if(token===trailFeedToken){stopTrailCamera();trail.stop();$('trail-screen').hidden=true;$('start-screen').hidden=false;startLandingGPS();$('status').textContent=e.message;}}
  }
  function stopTrailCamera(){++trailFeedToken;trailFeed?.srcObject?.getTracks().forEach(t=>t.stop());trailFeed?.remove();trailFeed=null;document.body.classList.remove('camera-on');}
  function startScout() {
    if (!navigator.geolocation) return locationError({ code: 2 });
    $('start').hidden = true; $('scout-tools').hidden = false; $('status').textContent = 'Waiting for GPS…';
    watchId = navigator.geolocation.watchPosition(({ coords }) => {
      lastFix = coords; $('status').textContent = `GPS ±${Math.round(coords.accuracy)} m${coords.accuracy <= 10 ? ' · ready to mark' : ' · keep waiting'}`;
      $('coords').textContent = `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
    }, locationError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }
  $('mark').addEventListener('click', () => {
    if (!lastFix || lastFix.accuracy > 10) { $('marked').textContent = 'Wait for GPS accuracy of ±10 m or better.'; return; }
    $('marked').textContent = `const TARGET = { lat: ${lastFix.latitude.toFixed(6)}, lon: ${lastFix.longitude.toFixed(6)} };`;
  });
  function locationError(error) {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId); watchId = null;
    $('status').textContent = error.code === 1 ? 'Allow location access, then try again.' : 'Could not get a steady GPS fix. Try outside.';
    $('start').hidden = false;
  }
  async function loadScript(src,attributes={}) {
    if (scriptLoads.has(src)) return scriptLoads.get(src);
    const promise = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src;Object.entries(attributes).forEach(([key,value])=>s.setAttribute(key,value));
      s.onload = resolve; s.onerror = () => { s.remove(); scriptLoads.delete(src); reject(new Error(`Cannot load ${src}`)); };
      document.head.appendChild(s);
    });
    scriptLoads.set(src, promise); return promise;
  }
  async function openBeacon() {
    if (opening || game) return;
    opening = true; const token = ++session; audio.unlock();
    $('error-note').classList.remove('on'); $('start-screen').hidden = true; $('hud').classList.add('on'); $('ar-host').classList.add('on');
    $('hud-title').textContent = 'Loading…'; $('hud-status').textContent = '';
    try {
      if(!previewMode&&(!isSecureContext||!navigator.mediaDevices?.getUserMedia))throw new Error('Open the published HTTPS link in your phone browser and allow camera access.');
      if(!previewMode&&!trail.motionGranted&&typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
        const permission=await DeviceOrientationEvent.requestPermission();trail.motionGranted=permission==='granted';
        if(!trail.motionGranted)throw new Error('Allow motion and orientation access to view the objects at their GPS location.');
      }
      arMode=window.BeaconSpatialAR.choose({practice:previewMode});
      await loadScript(arMode==='xr8'?'vendor/8frame-1.5.0.min.js':'vendor/aframe-1.6.0.min.js');
      if(arMode==='xr8'){
        await loadScript('vendor/8thwall-engine/xr.js',{'data-preload-chunks':'slam',crossorigin:'anonymous'});
        if(!window.XR8)await new Promise((resolve,reject)=>{
          const loaded=()=>{clearTimeout(timeout);resolve();};
          const timeout=setTimeout(()=>{window.removeEventListener('xrloaded',loaded);reject(new Error('World tracking did not initialize. Upload the complete vendor folder and refresh.'));},45000);
          window.addEventListener('xrloaded',loaded,{once:true});
        });
        await XR8.loadChunk('slam');
        if(!AFRAME.components.xrconfig)AFRAME.registerComponent('xrconfig',XR8.AFrame.xrconfigComponent());
        if(!AFRAME.components.xrweb)AFRAME.registerComponent('xrweb',XR8.AFrame.xrwebComponent());
      }
      if (token !== session) return;
      if (!AFRAME.components['field-toy']) AFRAME.registerComponent('field-toy', {
        init() { this.toy = new FieldToy(this.el); game = this.toy; window.beaconGame = game; },
        tick(time, delta) { if (this.toy) this.toy.tick(time / 1000, Math.min(delta / 1000, .05)); },
        remove() { if (this.toy) this.toy.dispose(); }
      });
      await createScene(token);
    } catch (e) { if (token === session) showError(e.message || 'Could not open the game. Close this view and retry.'); }
    finally { if (token === session) opening = false; }
  }
  async function createScene(token) {
    modelRefs.clear();
    const scene=document.createElement('a-scene');
    scene.setAttribute('embedded','');scene.setAttribute('xr-mode-ui','enabled: false');scene.setAttribute('vr-mode-ui','enabled: false');scene.setAttribute('loading-screen','enabled: false');
    scene.setAttribute('renderer','antialias: true; alpha: true; colorManagement: true');
    scene.setAttribute('device-orientation-permission-ui','enabled: false');
    if(previewMode)scene.setAttribute('background','color: #e1eadd');
    const root=previewMode?`position="0 0 -${L.overviewDistance}"`:'';
    const modelSource=name=>location.protocol==='file:'?window.BEACON_MODEL_DATA[name]:`url(models/${name})`;
    scene.innerHTML=`
      <a-light id="ambient-light" type="hemisphere" color="#f6f3df" ground-color="#7b907a" intensity=".85"></a-light>
      <a-light id="key-light" type="directional" color="#fff9ea" intensity=".7" position="-2 4 3"></a-light>
      <a-camera id="camera" position="0 ${previewMode?CAMERA_HEIGHT:2} 0" look-controls="enabled: false" wasd-controls="enabled: false"></a-camera>
      <a-entity id="beacon" ${root}>
        ${L.stations.map(s=>`<a-entity id="station-${s.id}" position="${s.x} 0 ${s.z}"><a-entity id="model-${s.id}" gltf-model="${modelSource(({throw:'toss-station.glb',swing:'swing-station.glb',echo:'echo-station.glb'})[s.id])}"></a-entity></a-entity>`).join('')}
      </a-entity>
      <a-entity id="ball" gltf-model="${modelSource('throw-ball.glb')}"></a-entity>`;
    const rendered=new Promise(resolve=>scene.addEventListener('renderstart',resolve,{once:true}));
    const modelEntities=[...scene.querySelectorAll('[gltf-model]')];
    const loaded=modelEntities.map(el=>new Promise((resolve,reject)=>{
      el.addEventListener('model-loaded',resolve,{once:true});
      el.addEventListener('model-error',()=>reject(new Error('A model could not load. Keep the models folder beside index.html, then reopen the page.')),{once:true});
    }));
    $('ar-host').appendChild(scene);
    await Promise.all([rendered,...loaded]);
    if(token!==session)return;
    modelEntities.forEach(el=>el.getObject3D('mesh').traverse(object=>{if(object.name)modelRefs.set(object.name,{object3D:object,getObject3D:()=>object});}));
    const required=['stem','goal','ring','display-ball','swing-group','pendulum','swing-ball','echo-group','ball-mesh',...Array.from({length:3},(_,i)=>`speaker-${i}`)];
    if(required.some(name=>!modelRefs.has(name)))throw new Error('A model is missing a named animation part. Restore the supplied GLB files or keep their node names when exporting.');
    scene.setAttribute('field-toy','');
  }

  class FieldToy {
    constructor(scene) {
      this.scene = scene; this.T = AFRAME.THREE; this.camera = scene.camera; this.canvas = scene.canvas;
      this.fieldEl=$('beacon');this.field=this.fieldEl.object3D;this.cameraRig=$('camera').object3D;
      this.worldScale=1;this.field.scale.setScalar(this.worldScale);this.ballScale=this.worldScale;
      this.stations=Object.fromEntries(L.stations.map(s=>[s.id,$('station-'+s.id).object3D]));
      this.rootEl = $('station-throw'); this.root = this.rootEl.object3D; this.goal = $('goal').object3D; this.ball = $('ball').object3D;
      this.travel=null;this.nearCandidate=null;this.accuracy=Infinity;this.fixAt=0;this.finishRevealAt=0;
      this.stem = $('stem').object3D; this.echoGroup = $('echo-group').object3D;
      this.swingGroup = $('swing-group').object3D; this.pendulum = $('pendulum').object3D; this.swingBall = $('swing-ball').object3D;
      this.swing = { angle: 0, v: 0 }; this.swingReleased = false; this.bellUntil = [0, 0, 0];
      this.echoPhase = 'idle'; this.echoInput = []; this.echoIndex = 0; this.echoDue = 0; this.rewardUntil = 0;this.statusUntil=0;this.seenModes=new Set();
      this.speakers = [0, 1, 2].map(i => $('speaker-' + i));
      this.ballRadius = .115; this.tube = .065; this.radius = .61; this.elapsed = 0; this.round = Math.min(progress.toss, 2);
      this.shot = null; this.returning = null; this.drag = null; this.pulseUntil = 0;
      this.echoTapUntil = [0, 0, 0]; this.confetti = []; this.mode = currentMode;
      this.oriented = true; this.disposed = false; this.trailHistory = []; this.paused = false;
      this.look = null; this.hasLooked = false; this.viewYaw = 0; this.viewPitch = 0; this.groundOffset = 0;
      this.placed=false;
      if (scene.renderer) scene.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.ringSpringX = { x: 0, v: 0 }; this.ringSpringY = { x: 0, v: 0 };
      this.raycaster = new this.T.Raycaster(); this.ring = this.ringAt(this.elapsed); this.freezeRing = null;
      this.aimGroup = new this.T.Group(); this.trailGroup = new this.T.Group(); this.confettiGroup = new this.T.Group();
      this.scene.object3D.add(this.aimGroup, this.trailGroup, this.confettiGroup);
      this.reticleGeometry = new this.T.RingGeometry(.12, .155, 32);
      this.reticleMaterial = new this.T.MeshBasicMaterial({ color: 0xf4c685, side: this.T.DoubleSide, depthTest: false, transparent: true, opacity: .95 });
      this.reticle = new this.T.Mesh(this.reticleGeometry, this.reticleMaterial); this.reticle.scale.setScalar(this.worldScale);this.reticle.renderOrder = 4; this.reticle.visible = false; this.aimGroup.add(this.reticle);
      this.dotGeometry = new this.T.SphereGeometry(.014*this.worldScale, 6, 4);
      this.aimMaterial = new this.T.MeshBasicMaterial({ color: 0xf9f2c9, transparent: true, opacity: .7 });
      this.trailMaterial = new this.T.MeshBasicMaterial({ color: 0xffb384, transparent: true, opacity: .4 });
      this.aimDots = this.makeDots(22, this.aimGroup, this.aimMaterial); this.trailDots = this.makeDots(9, this.trailGroup, this.trailMaterial);
      this.confettiGeometry = new this.T.PlaneGeometry(.025*this.worldScale, .08*this.worldScale); this.confettiPool = [];
      this.confettiMaterials = [0xd99872, 0xd4d49e, 0x9db99e, 0xb9a9c3, 0xe0c295].map(color => new this.T.MeshBasicMaterial({ color, side: this.T.DoubleSide }));
      this.key = this.keyDown.bind(this); window.addEventListener('keydown', this.key);
      this.down = this.pointerDown.bind(this); this.move = this.pointerMove.bind(this); this.up = this.pointerUp.bind(this); this.cancel = this.cancelDrag.bind(this);
      this.input=previewMode?this.canvas:$('ar-input');this.input.classList.add('on');
      this.canvas.style.touchAction = 'none'; this.input.addEventListener('pointerdown', this.down);
      window.addEventListener('pointermove', this.move, { passive: false }); window.addEventListener('pointerup', this.up); window.addEventListener('pointercancel', this.cancel);
      this.contacts=Object.fromEntries(L.stations.map(s=>[s.id,new window.BeaconContactEffects(this.T,scene,this.stations[s.id],false,s.id)]));
      this.contactEffects=this.contacts.throw;
      this.previewBackdrop=previewMode?new window.BeaconContactEffects(this.T,scene,new this.T.Group(),true,'backdrop'):null;
      this.ambientMatch = new window.BeaconAmbientMatch(scene, !previewMode);
      this.setMode(null); this.updateProgress();
      this.ball.scale.setScalar(this.ballScale);
      this.spatial=new window.BeaconSpatialAR.SpatialAR({scene,field:this.field,mode:arMode,origin:START_POINT,target:TARGET,onTracking:(tracked)=>this.trackingChanged(tracked),onError:showError,onEnd:()=>{if(!this.disposed)closeBeacon();}});
      if(!previewMode)this.trackingChanged(false);
      $('error-note').classList.remove('on');
    }
    trackingChanged(tracked){
      if(!tracked){this.cancelDrag();this.shot=null;this.returning=null;this.hideDots();$('direction-hint').hidden=true;$('reward-pop').hidden=true;}
      this.ball.visible=tracked&&this.mode==='throw'&&progress.toss<3;
      this.aimGroup.visible=this.trailGroup.visible=this.confettiGroup.visible=tracked;
      if(tracked&&this.mode==='throw')this.resetBall();
      $('tracking-note').hidden=tracked;
      $('tracking-text').textContent=this.spatial?.message||'Locating objects…';
      if(!tracked)L.stations.forEach(s=>$('station-label-'+s.id).hidden=true);
    }
    makeDots(count, group, material) {
      return Array.from({ length: count }, () => { const mesh = new this.T.Mesh(this.dotGeometry, material); mesh.visible = false; group.add(mesh); return mesh; });
    }
    vector(p) { return new this.T.Vector3(p.x, p.y, p.z); }
    world(p) { return this.root.localToWorld(this.vector(p)); }
    local(p) { return this.root.worldToLocal(p.clone()); }
    ringAt(time) {
      let base;
      if (this.freezeRing) base = this.freezeRing;
      else if (this.round === 0) base = { x: 0, y: 1.35 };
      else if (this.round === 1) base = { x: -.42, y: 1.53 };
      else if (reducedMotion) base = { x: .28, y: 1.44 };
      else base = { x: Math.sin(time * 1.05) * .48, y: 1.44 + Math.sin(time * .65) * .04 };
      const ahead = Math.max(0, time - this.elapsed), x = reducedMotion ? 0 : P.spring(this.ringSpringX, ahead).x, y = reducedMotion ? 0 : P.spring(this.ringSpringY, ahead).x;
      return { x: base.x + x, y: base.y + y, z: 0 };
    }
    kickRing(dx = .3, dy = .7, strength = 1) {
      if (reducedMotion) return;
      const length = Math.hypot(dx, dy) || 1, impulse = P.clamp(strength, .2, 1.2);
      this.ringSpringX.v = P.clamp(this.ringSpringX.v + dx / length * impulse, -1.4, 1.4);
      this.ringSpringY.v = P.clamp(this.ringSpringY.v + dy / length * impulse, -1.4, 1.4);
    }
    sourceAt(world) { const point = world.clone(); return () => { this.camera.updateWorldMatrix(true, false); return this.camera.worldToLocal(point.clone()); }; }
    sourceFor(el) { return () => { this.camera.updateWorldMatrix(true, false); return this.camera.worldToLocal(el.object3D.getWorldPosition(new this.T.Vector3())); }; }
    updateProgress() {
      const done = tasksDone(), count = done.filter(Boolean).length;
      const value=!this.mode?count:this.mode==='throw'?progress.toss:this.mode==='swing'?[0,1,2].filter(i=>progress.bells&(1<<i)).length:progress.echo;
      $('progress').textContent=`${value} / 3`;
      $('quest-stage').textContent=(previewMode?'Practice':'Ground AR')+` · ${count} / 3 complete`;
      L.stations.forEach((station,i)=>{
        const stamp=$('stamp-'+station.id);stamp.classList.toggle('done',done[i]);stamp.textContent='';stamp.setAttribute('aria-label',station.name+(done[i]?' complete':' incomplete'));stamp.title=station.name;
        const label=$('station-label-'+station.id);label.classList.toggle('done',done[i]);label.classList.toggle('active',this.mode===station.id);label.firstChild.textContent=(done[i]?'✓ ':'')+station.name;label.querySelector('span').textContent='';label.setAttribute('aria-label',station.name+(done[i]?', complete':'')+'. Play');
      });
    }

    title(text) { $('hud-title').textContent = text; }
    status(text,persistent=false) { $('hud-status').textContent=text;$('hud-status').hidden=!text;this.statusUntil=text?(persistent?Infinity:this.elapsed+3.5):0; }
    setMode(mode) {
      if(mode&&!this.stations[mode])return;
      this.mode = currentMode = mode; this.pendingFinish = null; audio.stopAll(); this.cancelDrag(); this.shot = null; this.returning = null; this.hideDots();
      this.finishRevealAt=0;this.rootEl=$('station-'+(mode||'throw'));this.root=this.rootEl.object3D;
      this.rewardUntil=0;$('reward-pop').hidden=true;
      if (mode === 'throw') this.resetBall();
      this.ball.visible = mode === 'throw'&&progress.toss<3;$('display-ball').object3D.visible=!this.ball.visible;
      $('field-overview').hidden=!mode;
      this.title(({throw:'Toss',swing:'Swing',echo:'Echo'})[mode]||'Bounce & Echo');
      this.status('');
      if(mode==='echo'){this.echoPhase=progress.echo>=3?'free':'waiting';this.echoInput=[];this.echoDue=this.elapsed+.5;}
      this.updateProgress();
      if (mode === 'echo' && progress.echo >= 3 && audio.ctx) {
        const at = audio.ctx.currentTime + .04;
        [392,493.88,587.33].forEach((f,i) => audio.note(f,at+i*.23,.2,0,.45,'sine',this.sourceFor(this.speakers[i])));
      }
    }
    enterStation(mode) {
      if(this.disposed||this.paused||this.travel||!this.stations[mode]||!previewMode&&!this.spatial?.tracked)return;
      audio.unlock();this.setMode(mode);
      if(previewMode){const station=this.stations[mode];station.updateWorldMatrix(true,false);const destination=station.localToWorld(new this.T.Vector3(0,CAMERA_HEIGHT,3.2)),target=station.localToWorld(new this.T.Vector3(0,1.28,0));this.moveCamera(destination,target);}
    }
    showOverview() {
      this.setMode(null);this.nearCandidate=null;
      if(previewMode){this.field.updateWorldMatrix(true,false);this.moveCamera(this.field.localToWorld(new this.T.Vector3(0,CAMERA_HEIGHT,L.overviewDistance)),this.field.localToWorld(new this.T.Vector3(0,1.05,-.8)));}
    }
    moveCamera(destination,target) {
      const rotation=new this.T.Quaternion().setFromRotationMatrix(new this.T.Matrix4().lookAt(destination,target,new this.T.Vector3(0,1,0)));
      this.travel={from:this.cameraRig.position.clone(),to:destination,rotationFrom:this.camera.quaternion.clone(),rotationTo:rotation,age:0,duration:reducedMotion ? .12 : .8};this.hasLooked=true;
    }
    travelTick(dt) {
      if(!this.travel)return;
      const t=this.travel;t.age+=dt;const p=P.clamp(t.age/t.duration,0,1),ease=p*p*(3-2*p);
      this.cameraRig.position.copy(t.from).lerp(t.to,ease);this.camera.quaternion.copy(t.rotationFrom).slerp(t.rotationTo,ease);this.camera.updateWorldMatrix(true,false);
      if(p>=1){this.travel=null;this.camera.rotation.reorder('YXZ');this.viewYaw=this.camera.rotation.y;this.viewPitch=this.camera.rotation.x;this.hasLooked=false;if(this.mode==='echo'&&this.echoPhase!=='free')this.echoDue=this.elapsed+.5;}
    }
    pickStation(point) {
      this.field.updateWorldMatrix(true,true);this.setRay(point);let picked=null,distance=Infinity;
      L.stations.forEach(s=>{const hits=this.raycaster.intersectObject(this.stations[s.id],true);if(hits.length&&hits[0].distance<distance){distance=hits[0].distance;picked=s.id;}});
      if(picked)return picked;
      let nearest=Infinity;
      L.stations.forEach(s=>{const box=new this.T.Box3().setFromObject(this.stations[s.id]),center=this.screen(box.getCenter(new this.T.Vector3()));if(center.z< -1||center.z>1)return;const projected=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])projected.push(this.screen(new this.T.Vector3(x,y,z)));const halfX=Math.max(26,(Math.max(...projected.map(p=>p.x))-Math.min(...projected.map(p=>p.x)))/2+10),halfY=Math.max(26,(Math.max(...projected.map(p=>p.y))-Math.min(...projected.map(p=>p.y)))/2+16),dx=Math.abs(point.x-center.x),dy=Math.abs(point.y-center.y);if(dx<=halfX&&dy<=halfY&&Math.hypot(dx,dy)<nearest){nearest=Math.hypot(dx,dy);picked=s.id;}});
      return picked;
    }
    updateStations(dt) {
      this.field.updateWorldMatrix(true,true);const done=tasksDone(),camera=this.camera.getWorldPosition(new this.T.Vector3()),rect=this.canvas.getBoundingClientRect(),labels=[];
      L.stations.forEach((s,i)=>{
        const root=this.stations[s.id],anchor=root.localToWorld(new this.T.Vector3(0,-.16,.45)),screen=this.screen(anchor),label=$('station-label-'+s.id);
        const shown=!this.travel&&this.mode!==s.id&&screen.z>=-1&&screen.z<=1&&screen.x>=45&&screen.x<=rect.width-45&&screen.y>Math.min(190,rect.height*.4)&&screen.y<rect.height-110;
        label.hidden=!shown;label.style.transform=`translate(${(screen.x+rect.left).toFixed(1)}px,${(screen.y+rect.top).toFixed(1)}px) translate(-50%,-10%)`;
        if(shown)labels.push({label,x:screen.x,y:screen.y});
        const mesh=$('base-'+s.id).getObject3D('mesh');if(mesh){mesh.material.color.set(done[i]?'#a8b77e':'#81917d');if(mesh.material.emissive)mesh.material.emissive.set(done[i]?'#15200b':'#000000');}
      });
      labels.sort((a,b)=>a.x-b.x);
      if(labels.some((p,i)=>i&&p.x-labels[i-1].x<92&&Math.abs(p.y-labels[i-1].y)<58)){
        const center=P.clamp((labels[0].x+labels[labels.length-1].x)/2,48+46*(labels.length-1),rect.width-48-46*(labels.length-1));
        labels.forEach((p,i)=>{p.label.style.transform=`translate(${(rect.left+center+(i-(labels.length-1)/2)*92).toFixed(1)}px,${(p.y+rect.top).toFixed(1)}px) translate(-50%,-10%)`;});
      }
      if(!['webxr','xr8'].includes(arMode)||this.mode||this.travel||!this.spatial?.tracked)return;
      const positions=L.stations.map(s=>({id:s.id,...this.stations[s.id].getWorldPosition(new this.T.Vector3())}));
      const nearby=L.nearby(positions,camera,0,0);
      if(!nearby)this.nearCandidate=null;
      else if(this.nearCandidate?.id!==nearby)this.nearCandidate={id:nearby,since:this.elapsed};
      else if(this.elapsed-this.nearCandidate.since>1)this.enterStation(nearby);
    }
    hideDots() { this.aimDots.forEach(d => d.visible = false); this.trailDots.forEach(d => d.visible = false); this.trailHistory = []; }
    holdWorld(point = null) {
      this.camera.updateWorldMatrix(true, false);
      if (point) {
        this.setRay(point);
        const forward = new this.T.Vector3(0, 0, -1).transformDirection(this.camera.matrixWorld);
        const center = this.camera.getWorldPosition(new this.T.Vector3()).addScaledVector(forward, .9*this.worldScale);
        const plane = new this.T.Plane().setFromNormalAndCoplanarPoint(forward, center);
        return this.raycaster.ray.intersectPlane(plane, new this.T.Vector3());
      }
      const y = this.canvas.getBoundingClientRect().height < 500 ? -.12 : -.34;
      return new this.T.Vector3(.13, y + (reducedMotion ? 0 : Math.sin(this.elapsed * 1.7) * .012), -.9).multiplyScalar(this.worldScale).applyMatrix4(this.camera.matrixWorld);
    }
    point(event) { const r = this.canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top, width: r.width, height: r.height }; }
    setRay(point) { this.camera.updateWorldMatrix(true, false); this.raycaster.setFromCamera({ x: point.x / point.width * 2 - 1, y: 1 - point.y / point.height * 2 }, this.camera); }
    screen(world) {
      this.camera.updateWorldMatrix(true, false);
      const r = this.canvas.getBoundingClientRect(), p = world.clone().project(this.camera);
      return { x: (p.x + 1) * .5 * r.width, y: (1 - p.y) * .5 * r.height, z: p.z };
    }
    pointerDown(event) {
      if(!previewMode&&!this.spatial?.tracked)return;
      if (this.paused || this.travel || (event.button !== undefined && event.button !== 0) || this.stationPointer || this.drag || this.swingDrag || this.echoPointer || this.toyPointer || this.look) return;
      audio.unlock(); const point = this.point(event);
      const ballScreen=this.screen(this.ball.position),onBall=this.mode==='throw'&&this.ball.visible&&Math.hypot(point.x-ballScreen.x,point.y-ballScreen.y)<45;
      if(!onBall){const picked=this.pickStation(point);if(picked&&picked!==this.mode){this.stationPointer={id:event.pointerId,mode:picked,point,yaw:this.viewYaw,pitch:this.viewPitch};this.capture(event.pointerId);return;}}
      if(!this.mode){if(previewMode){this.look={id:event.pointerId,point,yaw:this.viewYaw,pitch:this.viewPitch};this.capture(event.pointerId)}return;}
      if(this.mode==='swing') {
        const projected=this.screen(this.swingBall.getWorldPosition(new this.T.Vector3()));
        if(projected.z<=1&&Math.hypot(point.x-projected.x,point.y-projected.y)<40){event.preventDefault();this.swingDrag={id:event.pointerId,start:point};this.swingReleased=false;this.swing.v=0;this.capture(event.pointerId);this.swingBall.scale.setScalar(1.1);this.status('Pull sideways.');}
        else if(previewMode){this.look={id:event.pointerId,point,yaw:this.viewYaw,pitch:this.viewPitch};this.capture(event.pointerId)}
        return;
      }
      if (this.mode === 'echo') {
        const picked = this.pickSpeaker(point);
        if (picked >= 0) { event.preventDefault(); this.echoPointer = { id: event.pointerId, last: picked }; this.capture(event.pointerId); this.chooseEcho(picked); }
        else if (previewMode) { this.look = { id: event.pointerId, point, yaw: this.viewYaw, pitch: this.viewPitch }; this.capture(event.pointerId); }
        return;
      }
      if (!this.shot && !this.returning && progress.toss < 3) {
        const pos = this.ball.getWorldPosition(new this.T.Vector3()), projected = this.screen(pos);
        const cameraPos = this.camera.getWorldPosition(new this.T.Vector3());
        const pixels = point.height * this.ballRadius / (2 * Math.tan(this.camera.fov * Math.PI / 360) * pos.distanceTo(cameraPos));
        if (projected.z <= 1 && Math.hypot(point.x - projected.x, point.y - projected.y) <= Math.max(32, pixels * 1.6)) {
          event.preventDefault();
          const underFinger = this.holdWorld(point); if (!underFinger) return;
          this.drag = { id: event.pointerId, start: point, point, samples: [{ ...point, t: performance.now() }], bias: pos.clone().sub(underFinger) };
          this.grabFeedback(true); this.capture(event.pointerId); return;
        }
      }
      this.setRay(point);
      if (this.raycaster.intersectObject(this.goal, true).length) { this.toyPointer = { id: event.pointerId, point, yaw: this.viewYaw, pitch: this.viewPitch }; this.capture(event.pointerId); return; }
      if (previewMode) { this.look = { id: event.pointerId, point, yaw: this.viewYaw, pitch: this.viewPitch }; this.capture(event.pointerId); }
    }
    capture(id) { try { this.input.setPointerCapture(id); } catch (_) {} }
    grabFeedback(grabbed) {
      this.ball.scale.setScalar(this.ballScale*(grabbed ? 1.08 : 1));
      const mesh = modelRefs.get('ball-mesh')?.object3D; if (mesh?.material.emissive) mesh.material.emissive.set(grabbed ? '#44200a' : '#000000');
      $('aim-hint').style.opacity = grabbed ? '1' : '0';

    }
    turnView(point, gesture) {
      if (!previewMode) return;
      this.hasLooked = true;
      this.viewYaw = P.clamp(gesture.yaw + (point.x - gesture.point.x) / point.width * 1.7, -.85, .85);
      this.viewPitch = P.clamp(gesture.pitch + (point.y - gesture.point.y) / point.height * 1.1, -.28, .28);
      this.camera.rotation.set(this.viewPitch, this.viewYaw, 0, 'YXZ'); this.camera.updateWorldMatrix(true, false);
    }
    pointerMove(event) {
      if (this.paused) return;
      const point = this.point(event);
      if(this.stationPointer?.id===event.pointerId){if(Math.hypot(point.x-this.stationPointer.point.x,point.y-this.stationPointer.point.y)>12){this.stationPointer.moved=true;event.preventDefault();this.turnView(point,this.stationPointer)}return;}
      if(this.swingDrag?.id===event.pointerId){event.preventDefault();this.setRay(point);const origin=this.local(this.raycaster.ray.origin),end=this.local(this.raycaster.ray.origin.clone().add(this.raycaster.ray.direction)),direction=end.sub(origin);if(Math.abs(direction.z)>.01){const t=(.18-origin.z)/direction.z;if(t>0){origin.addScaledVector(direction,t);this.swing.angle=P.clamp(Math.atan2(origin.x,2.1-origin.y),-1.05,1.05);this.swing.v=0;this.pendulum.rotation.z=this.swing.angle;this.status(Math.abs(this.swing.angle)>.65?'Release.':'Pull farther.');}}return;}
      if (this.toyPointer?.id === event.pointerId) {
        if (Math.hypot(point.x - this.toyPointer.point.x, point.y - this.toyPointer.point.y) > 12) { this.toyPointer.moved = true; event.preventDefault(); this.turnView(point, this.toyPointer); } return;
      }
      if (this.look?.id === event.pointerId) { event.preventDefault(); this.turnView(point, this.look); return; }
      if (this.echoPointer?.id === event.pointerId) {
        event.preventDefault();const picked = this.pickSpeaker(point);
        if (picked !== this.echoPointer.last) { this.echoPointer.last = picked; if (picked >= 0) this.chooseEcho(picked); }
        return;
      }
      if (!this.drag || event.pointerId !== this.drag.id) return;
      event.preventDefault(); this.drag.point = point; this.sampleGesture(point);
      const position = this.holdWorld(point); if (position) this.ball.position.copy(position.add(this.drag.bias));
    }
    sampleGesture(point) {
      if (!this.drag || this.drag.id === 'keyboard') return;
      const now = performance.now(), samples = this.drag.samples;
      samples.push({ x: point.x, y: point.y, t: now });
      while (samples.length > 2 && samples[1].t < now - 160) samples.shift();
    }
    aim(point) {
      this.root.updateWorldMatrix(true, false); this.setRay(point);
      const origin = this.local(this.raycaster.ray.origin), rayEnd = this.local(this.raycaster.ray.origin.clone().add(this.raycaster.ray.direction));
      const direction = rayEnd.sub(origin);
      if (Math.abs(direction.z) < .03) return null;
      const t = -origin.z / direction.z; if (t <= 0) return null;
      const endpoint = origin.addScaledVector(direction, t);
      endpoint.x = P.clamp(endpoint.x, -4, 4); endpoint.y = P.clamp(endpoint.y, -.7, 5); endpoint.z = 0;
      const start = this.local(this.ball.position);
      const gesture = this.drag;
      const speed = gesture && gesture.id !== 'keyboard' ? P.gestureSpeed(gesture.samples, performance.now(), point.height) : .65;
      const duration = P.clamp(start.distanceTo(endpoint) / 4.2 * P.clamp(1.15 - speed * .23, .72, 1.15), .48, 1.65);
      return { body: P.launch(start, endpoint, duration), duration, endpoint };
    }
    pointerUp(event) {
      if(this.stationPointer?.id===event.pointerId){const selected=this.stationPointer;this.cancelDrag();if(!selected.moved)this.enterStation(selected.mode);return;}
      if (this.look?.id === event.pointerId) { this.look = null; return; }
      if (this.paused) return;
      if(this.swingDrag?.id===event.pointerId){const state={...this.swing},pulled=Math.abs(state.angle)>.12;this.cancelDrag();this.swing=state;this.swingReleased=pulled;this.pendulum.rotation.z=state.angle;this.status(pulled?'':'Pull sideways first.');return;}
      if (this.toyPointer?.id === event.pointerId) {
        const tap = this.toyPointer; this.toyPointer = null;
        if (!tap.moved && Math.hypot(event.clientX - tap.point.x - this.canvas.getBoundingClientRect().left, event.clientY - tap.point.y - this.canvas.getBoundingClientRect().top) < 14) {
          this.kickRing(.6, .4, .65); audio.audition(1, this.sourceAt(this.world(this.ring))); this.status('');
        } return;
      }
      if (this.mode === 'echo') {
        if (this.echoPointer?.id === event.pointerId) this.cancelDrag();
        return;
      }
      if (!this.drag || event.pointerId !== this.drag.id) return;
      const d = this.drag, point = this.point(event);
      if (d.id !== 'keyboard') { this.sampleGesture(point); const position = this.holdWorld(point); if (position) this.ball.position.copy(position.add(d.bias)); }
      const aim = this.aim(point); this.cancelDrag();
      if (d.id !== 'keyboard' && Math.hypot(point.x - d.start.x, point.y - d.start.y) < 14) { this.status('Drag, then release.'); return; }
      if (!aim) { this.status('Face the ring.'); return; }
      this.shot = { body: aim.body, age: 0, scored: false, passed: false, rimAt: -1 };
      progress.shots++; this.updateProgress(); this.status('');
    }
    pickSpeaker(point) {
      this.setRay(point); let picked = -1, nearest = Infinity;
      this.speakers.forEach((el, i) => { const hits = this.raycaster.intersectObject(el.object3D, true); if (hits.length && hits[0].distance < nearest) { nearest = hits[0].distance; picked = i; } });
      if (picked >= 0) return picked;
      let best = Infinity; const camera = this.camera.getWorldPosition(new this.T.Vector3());
      this.speakers.forEach((el, i) => {
        const world = el.object3D.getWorldPosition(new this.T.Vector3()), projected = this.screen(world);
        if (projected.z < -1 || projected.z > 1) return;
        const radius = Math.max(24, point.height * .17 / (2 * Math.tan(this.camera.fov * Math.PI / 360) * world.distanceTo(camera)) + 6);
        const distance = Math.hypot(point.x - projected.x, point.y - projected.y) / radius;
        if (distance < 1 && distance < best) { best = distance; picked = i; }
      });
      return picked;
    }
    cancelDrag() {
      const id = this.stationPointer?.id ?? this.drag?.id ?? this.swingDrag?.id ?? this.look?.id ?? this.echoPointer?.id ?? this.toyPointer?.id;
      if (typeof id === 'number') { try { this.input.releasePointerCapture(id); } catch (_) {} }
      this.placing=null;
      if(this.swingDrag){this.swing={angle:0,v:0};this.swingReleased=false;this.pendulum.rotation.z=0;this.swingBall.scale.setScalar(1);}
      this.stationPointer=null;this.drag = null; this.swingDrag = null; this.echoPointer = null; this.toyPointer = null; this.look = null; this.grabFeedback(false);
      if (this.reticle) this.reticle.visible = false;
      if (this.aimDots) this.aimDots.forEach(d => d.visible = false);
    }
    keyDown(event) {
      if (this.paused || this.travel || !previewMode&&!this.spatial?.tracked || event.altKey || event.ctrlKey || event.metaKey || /^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      const key = event.key;
      if (key.toLowerCase() === 'r') { event.preventDefault(); this.recenter(); return; }
      if(key==='Escape'){event.preventDefault();this.showOverview();return;}
      if(!this.mode){if(/^[123]$/.test(key)){event.preventDefault();this.enterStation(L.stations[+key-1].id)}return;}
      if(this.mode==='swing'){
        if(['ArrowLeft','ArrowRight'].includes(key)){event.preventDefault();audio.unlock();this.swingReleased=false;this.swing.angle=P.clamp(this.swing.angle+(key==='ArrowLeft'?-.15:.15),-1.05,1.05);this.swing.v=0;}
        else if(['Enter',' '].includes(key)){event.preventDefault();audio.unlock();this.swingReleased=true;}
        return;
      }
      if (this.mode === 'echo') {
        if (/^[123]$/.test(key)) { event.preventDefault(); this.chooseEcho(+key - 1); }
        else if (key === ' ') { event.preventDefault(); this.chooseEcho(1); }
        return;
      }
      if (this.shot || this.returning || progress.toss >= 3 || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(key)) return;
      event.preventDefault(); audio.unlock();
      if (!this.drag) {
        const r = this.canvas.getBoundingClientRect(), target = this.screen(this.world(this.ring));
        const point = { x: target.x, y: target.y, width: r.width, height: r.height };
        this.drag = { id: 'keyboard', point, start: point, at: performance.now(), bias: new this.T.Vector3() }; this.grabFeedback(true);
      }
      if (this.drag.id !== 'keyboard') return;
      const point = this.drag.point;
      if (key.startsWith('Arrow')) {
        point.x = P.clamp(point.x + (key === 'ArrowLeft' ? -10 : key === 'ArrowRight' ? 10 : 0), 0, point.width);
        point.y = P.clamp(point.y + (key === 'ArrowUp' ? -10 : key === 'ArrowDown' ? 10 : 0), 0, point.height);
      } else this.pointerUp({ pointerId: 'keyboard', clientX: point.x + this.canvas.getBoundingClientRect().left, clientY: point.y + this.canvas.getBoundingClientRect().top });
    }
    showFinish(completedMode=this.mode) {
      this.showOverview();
      if(!tasksDone().every(Boolean)){this.reward('✓ '+({throw:'Toss',swing:'Swing',echo:'Echo'})[completedMode]);return;}
      L.stations.forEach((station,i)=>{
        const point=this.stations[station.id].localToWorld(new this.T.Vector3(0,1.3,.15));this.spawnConfetti(point,24);
        if(audio.ctx)audio.note([392,493.88,587.33][i],audio.ctx.currentTime+.2*i,.5,0,.65,'sine',this.sourceAt(point));
      });
      this.reward('Done');
    }

    resetBall(keepFeedback = false) {
      this.cancelDrag(); this.shot = null; this.returning = null; this.hideDots(); this.round = Math.min(progress.toss, 2);
      this.ball.position.copy(this.holdWorld()); this.ball.rotation.set(0, 0, 0);
      if (progress.toss < 3) this.freezeRing = null;
      this.radius = [.61, .55, .52][this.round]; $('ring').object3D.scale.setScalar(this.radius/.61);this.tube=.065*this.radius/.61;
      this.ring = this.ringAt(this.elapsed); this.goal.position.set(this.ring.x, this.ring.y, 0);
      if (progress.toss < 3 && this.mode === 'throw' && !keepFeedback) { this.title('Toss'); this.status(['Drag and release.', 'To the left.', 'Aim ahead.'][this.round]); }
    }
    returnBall(manual = false) {
      if (this.returning || progress.toss >= 3) return;
      if (!this.shot) { this.resetBall(); return; }
      this.returning = { from: this.ball.position.clone(), age: 0, duration: reducedMotion ? .12 : .38 };
      this.shot = null; this.hideDots(); this.title('Toss');
      if (manual) this.status('');
    }
    recenter() {
      this.showOverview();
    }
    adjustGround(value) {
      if (!previewMode) return;
      const next = P.clamp(Number(value) || 0, -.8, .8);
      this.field.position.y += next - this.groundOffset; this.groundOffset = next;
      this.cancelDrag();this.shot=null;this.returning=null;this.hideDots();if(this.mode==='throw')this.resetBall();
      this.confetti.forEach(c => { c.mesh.visible = false; this.confettiPool.push(c.mesh); }); this.confetti = [];
    }
    replay() { progress.toss = 0; progress.shots = 0; progress.bells=0;progress.echo=0;this.swing={angle:0,v:0};this.swingReleased=false;this.echoTapUntil = [0, 0, 0];this.round=0;this.freezeRing=null;this.radius=.61;$('ring').object3D.scale.setScalar(1);this.tube=.065;this.showOverview(); }
    reward(text) { $('reward-pop').textContent=text;this.rewardUntil=this.elapsed+1.6;if(navigator.vibrate)navigator.vibrate(18); }
    score(point) {
      this.shot.scored = true; this.shot.finishAt = this.elapsed + 1.05; progress.toss = Math.min(3, progress.toss + 1);
      this.pulseUntil = this.elapsed + .9; this.spawnConfetti(this.world(point), progress.toss === 3 ? 36 : 24); this.kickRing(point.x - this.ring.x + .15, .5, .7); audio.win(progress.toss === 3, this.sourceAt(this.world(point)));
      this.reward(progress.toss===3?'✓ Toss':`${progress.toss} / 3`);
      this.updateProgress();
      if (progress.toss >= 3) {
        this.freezeRing = { x: this.ring.x - this.ringSpringX.x, y: this.ring.y - this.ringSpringY.x, z: 0 }; this.title('Toss'); this.status(''); this.pendingFinish = {at:this.elapsed+.85,mode:'throw'};
      } else { this.title('Toss'); this.status(progress.toss === 1 ? 'To the left.' : 'Aim ahead.'); }
    }
    throwTick(dt, oldRing) {
      if (this.returning) {
        const back = this.returning; back.age += dt;
        const t = P.clamp(back.age / back.duration, 0, 1), eased = t * t * (3 - 2 * t);
        this.ball.position.copy(back.from).lerp(this.holdWorld(), eased);
        if (!reducedMotion) this.ball.position.y += Math.sin(t * Math.PI) * .12;
        if (t >= 1) this.resetBall(true);
        return;
      }
      if (!this.shot) { if (!this.drag) this.ball.position.copy(this.holdWorld()); return; }
      const shot = this.shot; shot.age += dt;
      const steps = Math.max(1, Math.ceil(dt / .012)), sub = dt / steps;
      for (let i = 0; i < steps; i++) {
        const previous = { x: shot.body.x, y: shot.body.y, z: shot.body.z }; P.step(shot.body, sub);
        const ring0 = {x:oldRing.x+(this.ring.x-oldRing.x)*i/steps,y:oldRing.y+(this.ring.y-oldRing.y)*i/steps};
        const ring1 = {x:oldRing.x+(this.ring.x-oldRing.x)*(i+1)/steps,y:oldRing.y+(this.ring.y-oldRing.y)*(i+1)/steps};
        const contact = P.crossing(previous, shot.body, ring0, ring1, this.radius, this.tube, this.ballRadius);
        if (contact && !shot.scored && !shot.passed) {
          shot.passed = true;
          if (contact.hit) this.score(contact);
          else { shot.retryAt = this.elapsed + .65; this.status(Math.abs(contact.dx) > Math.abs(contact.dy) ? (contact.dx < 0 ? 'Too far left.' : 'Too far right.') : (contact.dy < 0 ? 'A little higher.' : 'A little lower.')); }
        }
        if (!shot.scored && P.collideRim(shot.body, this.ring, this.radius, this.tube, this.ballRadius) && this.elapsed - shot.rimAt > .12) {
          shot.rimAt = this.elapsed; const speed = Math.hypot(shot.body.vx, shot.body.vy, shot.body.vz);
          this.kickRing(shot.body.x - this.ring.x, shot.body.y - this.ring.y, speed * .25);
          audio.impact(speed, 'rim', this.sourceAt(this.world(shot.body))); this.status('Caught the rim.');
          shot.retryAt ??= this.elapsed + .8;
        }
        if (shot.body.y < this.ballRadius && shot.body.vy < 0) {
          const impactSpeed = -shot.body.vy;
          shot.body.y = this.ballRadius; shot.body.vy *= -.38; shot.body.vx *= .7; shot.body.vz *= .7;
          this.contactEffects.impact(shot.body, impactSpeed, reducedMotion);
          if (!shot.scored) shot.retryAt = Math.min(shot.retryAt ?? Infinity, this.elapsed + .45);
          if (!shot.scored && impactSpeed > 1.2 && (!shot.lastFloorAt || this.elapsed - shot.lastFloorAt > .2)) { audio.impact(impactSpeed, 'floor', this.sourceAt(this.world(shot.body))); shot.lastFloorAt = this.elapsed; }
        }
      }
      this.ball.position.copy(this.world(shot.body)); this.ball.rotation.x += shot.body.vz * dt * 4; this.ball.rotation.z -= shot.body.vx * dt * 4;
      this.trailHistory.unshift(this.ball.position.clone()); this.trailHistory.length = Math.min(9, this.trailHistory.length);
      this.trailDots.forEach((d, i) => { d.visible = i < this.trailHistory.length; if (d.visible) { d.position.copy(this.trailHistory[i]); d.scale.setScalar(1 - i * .075); } });
      if (shot.scored && this.elapsed >= shot.finishAt) this.resetBall();
      else if (!shot.scored && (this.elapsed >= shot.retryAt || shot.age > 3.1 || Math.abs(shot.body.z) > 12)) this.returnBall();
    }
    showAim() {
      if (!this.drag) return;
      const aim = this.aim(this.drag.point);
      this.reticle.visible = !!aim;
      if (aim) {
        const future = this.ringAt(this.elapsed + aim.duration);
        const fits = Math.hypot(aim.endpoint.x - future.x, aim.endpoint.y - future.y) + this.ballRadius <= this.radius - this.tube;
        this.reticle.position.copy(this.world({ ...aim.endpoint, z: .018 })); this.root.getWorldQuaternion(this.reticle.quaternion);
        const color = fits ? '#466d38' : '#ad602f'; this.reticleMaterial.color.set(color); this.aimMaterial.color.set(fits ? '#c3e373' : '#f5d3a2');
        $('aim-hint').textContent = fits ? 'Release' : this.round === 2 && !reducedMotion ? 'Aim ahead' : aim.endpoint.y < future.y - .3 ? 'Higher' : 'Aim';
      }
      this.aimDots.forEach((dot, i) => { dot.visible = !!aim; if (aim) dot.position.copy(this.world(P.arc(aim.body, (i + 1) / this.aimDots.length * aim.duration))); });
    }
    chooseEcho(index) {
      if(this.mode!=='echo')return;
      if(this.echoPhase!=='answer'&&this.echoPhase!=='free'){this.status('Listen first.');return;}
      audio.unlock(); this.echoTapUntil[index] = this.elapsed + .45;
      this.speakers[index].object3D.scale.setScalar(reducedMotion ? 1 : 1.12);
      audio.audition(index, this.sourceFor(this.speakers[index]));
      if(this.echoPhase==='free')return;
      const pattern=ECHO_PATTERNS[progress.echo];
      if(index!==pattern[this.echoInput.length]){this.echoPhase='waiting';this.echoDue=this.elapsed+1;this.echoInput=[];this.title('Echo');this.status('Try again.');this.updateProgress();return;}
      this.echoInput.push(index);this.updateProgress();
      if(this.echoInput.length===pattern.length){progress.echo++;this.echoPhase=progress.echo>=3?'free':'waiting';this.echoDue=this.elapsed+1.25;this.reward(progress.echo>=3?'✓ Echo':`${progress.echo} / 3`);this.spawnConfetti(this.speakers[index].object3D.getWorldPosition(new this.T.Vector3()),12);audio.win(false,this.sourceFor(this.speakers[index]));this.title(progress.echo>=3?'Echo':'Echo');this.status(progress.echo>=3?'':'');this.updateProgress();if(progress.echo>=3)this.pendingFinish={at:this.elapsed+.9,mode:'echo'};}
      else this.status(`${pattern.length-this.echoInput.length} left.`,true);
    }
    listenAgain() {
      if(this.mode!=='echo'||progress.echo>=3)return;
      audio.unlock();audio.stopAll();this.echoInput=[];this.echoPhase='waiting';this.echoDue=this.elapsed+.15;this.updateProgress();
    }
    echoTick() {
      if(this.echoPhase==='free'||this.echoPhase==='answer'||this.elapsed<this.echoDue)return;
      if(this.echoPhase==='waiting'){this.echoPhase='listening';this.echoIndex=0;this.echoInput=[];this.title('Echo');this.status('Listen.',true);}
      const pattern=ECHO_PATTERNS[progress.echo];
      if(this.echoIndex<pattern.length){const index=pattern[this.echoIndex++];this.echoTapUntil[index]=this.elapsed+.4;audio.audition(index,this.sourceFor(this.speakers[index]));this.echoDue=this.elapsed+.6;}
      else{this.echoPhase='answer';this.title('Echo');this.status('Your turn.',true);this.updateProgress();}
    }
    swingTick(dt) {
      const previous=this.swing.angle;
      if(!this.swingDrag&&this.swingReleased)this.swing=P.pendulum(this.swing,dt);
      this.pendulum.rotation.z=this.swing.angle;
      if(this.swingReleased&&!this.swingDrag&&Math.abs(this.swing.v)>.18){BELL_ANGLES.forEach((angle,i)=>{
        if((previous-angle)*(this.swing.angle-angle)>0||this.elapsed<(this.bellUntil[i]||0))return;
        this.bellUntil[i]=this.elapsed+.35;const bell=$('bell-'+i);audio.audition(i,this.sourceFor(bell));
        if(!(progress.bells&(1<<i))){progress.bells|=1<<i;const count=[0,1,2].filter(j=>progress.bells&(1<<j)).length;this.reward(count===3?'✓ Swing':`${count} / 3`);this.spawnConfetti(bell.object3D.getWorldPosition(new this.T.Vector3()),count===3?24:8);this.status(count===3?'':'');this.updateProgress();if(count===3){this.pendingFinish={at:this.elapsed+.85,mode:'swing'};if(this.mode==='swing')this.title('Swing');}}
      });}
      [0,1,2].forEach(i=>{const bell=$('bell-'+i),mesh=$('bell-face-'+i).getObject3D('mesh');if(mesh)mesh.material.color.set(progress.bells&(1<<i)?'#ecd68d':'#79917b');bell.object3D.scale.setScalar(!reducedMotion&&this.elapsed<this.bellUntil[i]?1+.09*Math.sin((this.bellUntil[i]-this.elapsed)/.35*Math.PI):1);});
    }
    spawnConfetti(point, count) {
      // 彩带在命中的三维位置喷出，随后受重力下落；不是全屏遮挡的贴图。
      if (reducedMotion) count = Math.min(count, 10);
      for (let i = 0; i < count; i++) {
        if (this.confetti.length >= 120) { const old = this.confetti.shift(); old.mesh.visible = false; this.confettiPool.push(old.mesh); }
        const mesh = this.confettiPool.pop() || new this.T.Mesh(this.confettiGeometry, this.confettiMaterials[i % this.confettiMaterials.length]);
        mesh.visible = true; mesh.scale.setScalar(1);
        mesh.position.copy(point); mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); this.confettiGroup.add(mesh);
        this.confetti.push({ mesh, age: 0, life: 2.3 + Math.random() * .5, settled: false, vx: (Math.random() - .5) * 1.8*this.worldScale, vy: (.8 + Math.random() * 1.35)*this.worldScale, vz: (Math.random() - .5) * 1.6*this.worldScale, spin: (Math.random() - .5) * 9 });
      }
    }
    confettiTick(dt) {
      this.confetti = this.confetti.filter(c => {
        c.age += dt; if (c.age > c.life) { c.mesh.visible = false; this.confettiPool.push(c.mesh); return false; }
        if (!c.settled) {
          c.vy -= 3.8*this.worldScale * dt; c.mesh.position.x += c.vx * dt; c.mesh.position.y += c.vy * dt; c.mesh.position.z += c.vz * dt;
          c.mesh.rotation.x += c.spin * dt; c.mesh.rotation.z += c.spin * .6 * dt;
          // 彩带接触与底座相同的地面后铺平，避免穿地消失。
          const local = this.local(c.mesh.position);
          if (local.y <= .015 && c.vy < 0) {
            local.y = .015; c.mesh.position.copy(this.world(local)); c.settled = true;
            c.mesh.rotation.set(-Math.PI / 2, 0, c.mesh.rotation.z); c.life = Math.max(c.life, c.age + .8);
          }
        }
        c.mesh.scale.setScalar(Math.min(1, (c.life - c.age) * 3)); return true;
      });
    }
    tick(time, dt) {
      if (this.disposed || this.paused || document.visibilityState === 'hidden' || !this.camera) return;
      if(arMode==='xr8')this.camera=this.scene.camera;
      this.spatial?.tick(this.scene.frame,dt);
      if(!previewMode&&!this.spatial?.tracked)return;
      this.elapsed += dt;this.travelTick(dt); this.camera.updateWorldMatrix(true, false); this.field.updateWorldMatrix(true, true);
      if(previewMode){const rect=this.canvas.getBoundingClientRect(),fov=rect.height<500&&rect.width>rect.height?50:80;if(this.camera.fov!==fov){this.camera.fov=fov;this.camera.updateProjectionMatrix();}}
      if (reducedMotion) { this.ringSpringX = { x: 0, v: 0 }; this.ringSpringY = { x: 0, v: 0 }; }
      else { this.ringSpringX = P.spring(this.ringSpringX, dt); this.ringSpringY = P.spring(this.ringSpringY, dt); }
      const oldRing = this.ring; this.ring = this.ringAt(this.elapsed); this.goal.position.set(this.ring.x, this.ring.y, 0);
      const top = this.vector(this.ring).add(new this.T.Vector3(0, -this.radius-this.tube+.015, 0)), bottom = new this.T.Vector3(0, .075, 0), diff = top.clone().sub(bottom);
      this.stem.position.copy(top.add(bottom).multiplyScalar(.5)); this.stem.scale.y = diff.length(); this.stem.quaternion.setFromUnitVectors(new this.T.Vector3(0, 1, 0), diff.normalize());
      const pulse = !reducedMotion && this.elapsed < this.pulseUntil ? 1 + .045 * Math.sin((this.pulseUntil - this.elapsed) * 15) : 1; this.goal.scale.setScalar(pulse);
      const ringMesh = $('ring').getObject3D('mesh'); if (ringMesh) ringMesh.material.color.set(this.elapsed < this.pulseUntil || progress.toss === 3 ? '#e3d7aa' : '#9ab29a');
      const counts={throw:progress.toss,swing:[0,1,2].filter(i=>progress.bells&(1<<i)).length,echo:progress.echo};
      L.stations.forEach(s=>[0,1,2].forEach(i=>{const mesh=$(s.id==='throw'?'pip-'+i:`pip-${s.id}-${i}`).getObject3D('mesh');if(mesh)mesh.material.color.set(i<counts[s.id]?'#e4d4a1':'#7e9077');}));
      if (this.mode === 'throw') { this.throwTick(dt, oldRing); this.showAim(); }
      this.swingTick(dt);
      {
        if(this.mode==='echo'&&!this.travel)this.echoTick();
        this.speakers.forEach((el, i) => {
          el.object3D.scale.lerp(new this.T.Vector3(1, 1, 1), 1 - Math.exp(-dt * 14));
          const remaining = Math.max(0, this.echoTapUntil[i] - this.elapsed);
          el.object3D.position.y = reducedMotion ? 0 : Math.sin(remaining / .45 * Math.PI) * .035;
          const face = $('speaker-face-'+i).getObject3D('mesh'); if (face) face.material.color.set(remaining > 0 ? '#f7e2a1' : '#405d4c');
        });
      }
      this.confettiTick(dt);
      this.contacts.throw.update(this.ball.position,!!this.shot,'throw',dt,reducedMotion);
      this.contacts.swing.update(this.swingBall.getWorldPosition(new this.T.Vector3()),false,'swing',dt,reducedMotion);
      this.contacts.echo.update(this.stations.echo.getWorldPosition(new this.T.Vector3()),false,'echo',dt,reducedMotion);
      this.ambientMatch.update(dt); audio.update();this.updateStations(dt);
      if (this.pendingFinish && this.elapsed >= this.pendingFinish.at) { const completed=this.pendingFinish.mode;this.pendingFinish = null;if(this.mode===completed||tasksDone().every(Boolean))this.showFinish(completed); }
      $('reward-pop').hidden=this.elapsed>=this.rewardUntil;
      $('hud-status').hidden=!$('hud-status').textContent||this.elapsed>=this.statusUntil;
      const target = !this.mode&&!previewMode?this.field.localToWorld(new this.T.Vector3(0,1.15,-.8)):this.mode === 'throw' ? this.world(this.ring) : this.world({ x: 0, y: 1.18, z: .12 });
      const projected = this.screen(target), rect = this.canvas.getBoundingClientRect();
      const outside = projected.z > 1 || projected.x < 20 || projected.x > rect.width - 20 || projected.y < 30 || projected.y > rect.height - 20;
      $('direction-hint').hidden = !this.mode&&previewMode || !outside || !!this.drag || !!this.travel;
      if (outside) {
        const relative = this.camera.worldToLocal(target.clone());
        const arrow=relative.z<0&&projected.y<30?'↑':relative.z<0&&projected.y>rect.height-20?'↓':relative.x<0?'←':'→';
        $('direction-hint').textContent = arrow+(!previewMode&&!this.mode?` · ${Math.round(target.distanceTo(this.camera.getWorldPosition(new this.T.Vector3())))} m`:'');
      }
    }
    dispose() {
      if (this.disposed) return; this.disposed = true; this.cancelDrag(); audio.stopAll(); window.removeEventListener('keydown', this.key);
      this.input.removeEventListener('pointerdown', this.down);this.input.classList.remove('on'); window.removeEventListener('pointermove', this.move); window.removeEventListener('pointerup', this.up); window.removeEventListener('pointercancel', this.cancel);
      this.spatial?.dispose();
      [this.aimGroup, this.trailGroup, this.confettiGroup].forEach(g => this.scene.object3D.remove(g));
      Object.values(this.contacts).forEach(c=>c.dispose());this.previewBackdrop?.dispose();this.ambientMatch.dispose();
      L.stations.forEach(s=>$('station-label-'+s.id).hidden=true);this.travel=null;
      this.reticleGeometry.dispose(); this.reticleMaterial.dispose(); this.dotGeometry.dispose(); this.aimMaterial.dispose(); this.trailMaterial.dispose(); this.confettiGeometry.dispose(); this.confettiMaterials.forEach(m => m.dispose());
    }
  }

  $('field-overview').addEventListener('click',()=>game?.showOverview());
  $('xr-overlay').addEventListener('beforexrselect',event=>event.preventDefault());
  $('exit-ar').addEventListener('click', closeBeacon);
  window.addEventListener('beacon-camera-error',event=>{if($('ar-host').classList.contains('on'))showError(event.detail.message);});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { game?.cancelDrag(); audio.stopAll(); } });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')stopLandingGPS();else if(!$('start-screen').hidden)startLandingGPS();});
  window.addEventListener('pagehide',stopLandingGPS);
  function closeBeacon() {

    ++session; opening = false; if (game) game.dispose(); game = null; window.beaconGame = null;
    const scene = $('ar-host').querySelector('a-scene'); if (scene) {scene.pause();scene.systems.arjs?._arSession?.arSource?.dispose();}
    document.querySelectorAll('video').forEach(video => { video.srcObject?.getTracks().forEach(track => track.stop()); if (video.id === 'arjs-video') video.remove(); });
    $('ar-host').replaceChildren();modelRefs.clear(); $('ar-host').classList.remove('on'); $('hud').classList.remove('on'); $('error-note').classList.remove('on'); $('start-screen').hidden = false;
    $('tracking-note').hidden=true;$('ar-input').classList.remove('on');document.body.style.width='';document.body.style.height='';
    $('start').textContent=progress.walk?'Continue':'Start';
    startLandingGPS();
  }
  if (query.has('toy')) { previewMode = true; openBeacon(); }
  else startLandingGPS();
  function showError(message) { $('error-note').textContent = message; $('error-note').classList.add('on'); }
})();
