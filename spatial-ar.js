/* 正式 AR 按地理坐标自动对齐视觉世界追踪。旧定位实现仅保留作源码参考。 */
(function (root) {
  'use strict';
  const choose = ({ practice = false, marker = false, immersive = false } = {}) =>
    practice ? 'practice' : marker ? 'marker' : immersive ? 'webxr' : 'xr8';
  class SpatialAR {
    constructor({ scene, field, mode, origin, target, onTracking, onError, onEnd }) {
      if(mode==='xr8')return new root.BeaconGroundTracking.GroundTracking({scene,field,target,onTracking,onError});
      this.scene = scene; this.field = field; this.mode = mode;
      this.onTracking = onTracking; this.onError = onError; this.onEnd = onEnd;
      this.T = root.AFRAME.THREE; this.listeners = []; this.disposed = false;
      this.placed = mode === 'practice'; this.tracked = this.placed; this.pose = null;
      if (mode === 'practice') return;
      field.visible = false;
      if(mode==='gps'){
        this.setupGPS(origin,target);
      } else if (mode === 'marker') {
        this.marker = scene.querySelector('#world-marker');
        this.listen(this.marker, 'markerFound', () => this.setTracking(true));
        this.listen(this.marker, 'markerLost', () => this.setTracking(false));
      } else {
        const T = this.T;
        this.reticle = new T.Mesh(new T.RingGeometry(.12, .15, 40).rotateX(-Math.PI / 2),
          new T.MeshBasicMaterial({ color: 0xf3d7a3, side: T.DoubleSide, depthTest: false }));
        this.reticle.visible = false; this.reticle.renderOrder = 8; scene.object3D.add(this.reticle);
        this.listen(scene.renderer.xr, 'sessionstart', () => this.setupSession());
      }
    }
    listen(target, event, fn) { target.addEventListener(event, fn); this.listeners.push(() => target.removeEventListener(event, fn)); }
    setupGPS(origin,target){
      this.geoOrigin=origin;this.geoStatus='Waiting for GPS…';this.geoAccuracy=Infinity;this.geoAt=0;this.geoHasFix=false;this.orientationAt=0;
      this.cameraRig=this.scene.querySelector('#camera').object3D;this.geoPosition=new this.T.Vector3();
      const p=root.BeaconNavigation.project(target,origin);this.field.position.set(p.x,0,p.z);
      this.field.rotation.set(0,Math.atan2(-p.x,-p.z),0);this.field.updateWorldMatrix(true,true);
      this.listen(root,'deviceorientationabsolute',event=>this.receiveOrientation(event));
      this.listen(root,'deviceorientation',event=>this.receiveOrientation(event));
      this.geoReceive=({coords,timestamp=Date.now()})=>{
        if(this.disposed)return;
        const age=Date.now()-timestamp;
        if(!Number.isFinite(coords?.latitude)||!Number.isFinite(coords?.longitude)||Math.abs(coords.latitude)>90||Math.abs(coords.longitude)>180||!Number.isFinite(coords?.accuracy)||coords.accuracy<0||coords.accuracy>15||age>15000||age< -2000){this.geoHasFix=false;this.geoAccuracy=Number.isFinite(coords?.accuracy)?coords.accuracy:Infinity;this.geoStatus=Number.isFinite(this.geoAccuracy)?`GPS ±${Math.round(this.geoAccuracy)} m · Waiting…`:'Waiting for GPS…';this.setTracking(false);return;}
        const next=root.BeaconNavigation.project({lat:coords.latitude,lon:coords.longitude},origin);
        this.geoPosition.set(next.x,this.cameraRig.position.y,next.z);this.geoAt=timestamp;this.geoAccuracy=coords.accuracy;
        if(!this.geoHasFix)this.cameraRig.position.copy(this.geoPosition);
        this.geoHasFix=true;this.geoStatus='Turn your phone to find the objects.';
        this.updateGPSReady();
      };
      this.geoError=()=>{if(this.disposed)return;this.geoHasFix=false;this.geoStatus='Allow location and try outside.';this.setTracking(false);};
      if(!root.navigator?.geolocation){this.geoError();return;}
      const options={enableHighAccuracy:true,maximumAge:0,timeout:20000};
      this.geoWatch=root.navigator.geolocation.watchPosition(this.geoReceive,this.geoError,options);
      // 某些手机静止时 watchPosition 不持续刷新；定期获取新读数而非沿用过期坐标。
      this.geoTimer=root.setInterval(()=>{
        if(this.disposed||this.geoPending||!root.navigator.geolocation.getCurrentPosition)return;
        this.geoPending=true;root.navigator.geolocation.getCurrentPosition(p=>{this.geoPending=false;this.geoReceive(p)},e=>{this.geoPending=false;if(Date.now()-this.geoAt>15000)this.geoError(e)},options);
      },6000);
    }
    receiveOrientation(event){
      if(!Number.isFinite(event.alpha)||!Number.isFinite(event.beta)||!Number.isFinite(event.gamma))return;
      const webkit=Number.isFinite(event.webkitCompassHeading)&&(!Number.isFinite(event.webkitCompassAccuracy)||event.webkitCompassAccuracy>=0&&event.webkitCompassAccuracy<=50);
      if(!webkit&&!event.absolute&&event.type!=='deviceorientationabsolute')return;
      const controls=this.scene.querySelector('#camera').components?.['arjs-device-orientation-controls']?._orientationControls;
      if(controls){
        controls.deviceOrientation=event;controls.screenOrientation=root.screen?.orientation?.angle||root.orientation||0;
        controls.alphaOffset=webkit?root.BeaconNavigation.angle(360-event.webkitCompassHeading-event.alpha)*Math.PI/180:0;
        controls.enabled=true;
      }
      this.orientationAt=Date.now();this.updateGPSReady();
    }
    updateGPSReady(){
      const ready=this.geoHasFix&&Date.now()-this.geoAt<=15000&&this.orientationAt>0;
      if(!this.orientationAt&&this.geoHasFix)this.geoStatus='Allow motion access, then turn your phone.';
      if(ready!==this.tracked||!ready&&this.lastGeoStatus!==this.geoStatus){this.lastGeoStatus=this.geoStatus;this.setTracking(ready);}
    }
    setTracking(tracked) {
      this.tracked = tracked; if (tracked) this.placed = true;
      this.field.visible = tracked; this.onTracking?.(tracked, this.placed);
    }
    async setupSession() {
      const session = this.scene.renderer.xr.getSession(); this.session = session;
      this.listen(session, 'end', () => { this.hitSource?.cancel(); this.hitSource = null; if (!this.disposed) this.onEnd?.(); });
      this.listen(session, 'visibilitychange', () => { if (session.visibilityState !== 'visible') this.setTracking(false); });
      // DOM overlay carries the real touchscreen gestures; never substitute a noninteractive model viewer.
      if (!session.domOverlayState) { this.onError?.('This browser cannot show touch controls in this optional mode. Reopen the ordinary link to use world tracking.'); await session.end(); return; }
      try {
        const viewer = await session.requestReferenceSpace('viewer');
        const source = await session.requestHitTestSource({ space: viewer });
        if (this.disposed || session !== this.session) { source.cancel(); return; }
        this.hitSource = source;
      } catch (_) { if (!this.disposed) this.onError?.('Ground tracking could not start. Reopen the ordinary link to use world tracking.'); }
    }
    tick(frame,dt=1/60) {
      if(this.disposed)return;
      if(this.mode==='gps'){
        if(Date.now()-this.geoAt>15000){this.geoHasFix=false;this.geoStatus='Waiting for GPS…';}
        this.updateGPSReady();
        if(this.tracked){const p=this.cameraRig.position,t=this.geoPosition,a=1-Math.exp(-Math.min(dt,.05)*2);p.x+=(t.x-p.x)*a;p.z+=(t.z-p.z)*a;}
        return;
      }
      if(this.mode==='marker'){if(this.marker.object3D.visible!==this.tracked)this.setTracking(this.marker.object3D.visible);return;}
      if (this.mode !== 'webxr' || !frame) return;
      const space = this.scene.renderer.xr.getReferenceSpace(); if (!space) return;
      const viewer = frame.getViewerPose(space);
      if (this.placed) {
        if (!!viewer !== this.tracked) this.setTracking(!!viewer);
        return;
      }
      this.pose = null; this.reticle.visible = false;
      if (!viewer || !this.hitSource) return;
      for (const hit of frame.getHitTestResults(this.hitSource)) {
        const pose = hit.getPose(space); if (!pose) continue;
        const matrix = new this.T.Matrix4().fromArray(pose.transform.matrix);
        // Reject walls: the hit's local up vector must point approximately upwards.
        if (new this.T.Vector3(0, 1, 0).transformDirection(matrix).y < .9) continue;
        this.pose = pose; this.reticle.position.setFromMatrixPosition(matrix); this.reticle.visible = true; break;
      }
    }
    place(camera) {
      if (this.mode !== 'webxr' || this.placed || !this.pose) return false;
      const matrix = new this.T.Matrix4().fromArray(this.pose.transform.matrix);
      this.field.position.setFromMatrixPosition(matrix);
      const c = camera.getWorldPosition(new this.T.Vector3());
      this.field.rotation.set(0, Math.atan2(c.x - this.field.position.x, c.z - this.field.position.z), 0);
      this.field.updateWorldMatrix(true, true); this.reticle.visible = false;
      this.hitSource?.cancel(); this.hitSource = null;
      this.setTracking(true); return true;
    }
    dispose() {
      if (this.disposed) return; this.disposed = true;
      if(this.geoWatch!==undefined)root.navigator.geolocation.clearWatch(this.geoWatch);
      if(this.geoTimer!==undefined)root.clearInterval(this.geoTimer);
      this.listeners.splice(0).forEach(remove => remove()); this.hitSource?.cancel(); this.hitSource = null;
      if (this.reticle) { this.scene.object3D.remove(this.reticle); this.reticle.geometry.dispose(); this.reticle.material.dispose(); }
      this.session?.end().catch(() => {}); this.session = null;
    }
  }
  const api = { choose, SpatialAR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BeaconSpatialAR = api;
})(typeof window !== 'undefined' ? window : globalThis);
