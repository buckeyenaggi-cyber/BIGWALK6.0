/* 固定 GPS 点自动入场：先用定位和指南针对齐视觉空间，再锁住装置；玩家不能摆放。 */
(function(root){
  'use strict';
  const RAD=Math.PI/180,wrap=a=>((a+180)%360+360)%360-180;
  function surfaceHit(hits,camera){
    return (hits||[]).find(hit=>{
      if(!['DETECTED_SURFACE','ESTIMATED_SURFACE'].includes(hit.type))return false;
      const p=hit.position,q=hit.rotation;
      if(!p||!q||![p.x,p.y,p.z,q.x,q.y,q.z,q.w].every(Number.isFinite))return false;
      const norm=q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w;
      if(norm<.5||1-2*(q.x*q.x+q.z*q.z)/norm<.96)return false;
      const distance=Math.hypot(p.x-camera.x,p.y-camera.y,p.z-camera.z);
      return distance>=.7&&distance<=12;
    })||null;
  }
  // W3C Z-X'-Y'' rotation applied to the rear camera's optical axis.
  // Screen rotation does not change that physical axis. Relative alpha alone
  // is never used as north; iOS supplies magnetic heading separately.
  function cameraHeading(event){
    if(![event.beta,event.gamma].every(Number.isFinite))return null;
    let alpha=event.alpha;
    if(Number.isFinite(event.webkitCompassHeading)){
      if(event.webkitCompassHeading<0||event.webkitCompassHeading>=360||Number.isFinite(event.webkitCompassAccuracy)&&(event.webkitCompassAccuracy<0||event.webkitCompassAccuracy>45))return null;
      alpha=360-event.webkitCompassHeading;
    }else if(!Number.isFinite(alpha)||!event.absolute&&event.type!=='deviceorientationabsolute')return null;
    const a=alpha*RAD,b=event.beta*RAD,g=event.gamma*RAD;
    const east=-Math.cos(a)*Math.sin(g)-Math.sin(a)*Math.sin(b)*Math.cos(g);
    const north=-Math.sin(a)*Math.sin(g)+Math.cos(a)*Math.sin(b)*Math.cos(g);
    if(Math.hypot(east,north)<.3)return null;
    return (Math.atan2(east,north)/RAD+360)%360;
  }
  function alignment(samples,now){
    const fresh=samples.filter(s=>now-s.at<=1200&&s.at<=now);
    if(fresh.length<4||fresh.at(-1).at-fresh[0].at<350)return null;
    const mean=Math.atan2(fresh.reduce((n,s)=>n+Math.sin(s.yaw*RAD),0),fresh.reduce((n,s)=>n+Math.cos(s.yaw*RAD),0))/RAD;
    return fresh.every(s=>Math.abs(wrap(s.yaw-mean))<=15)?mean*RAD:null;
  }
  // Geographic offset: +x east, +z south. Map the fixed frame into SLAM.
  function worldAnchor(offset,camera,yaw,groundY=0){
    const c=Math.cos(yaw),s=Math.sin(yaw);
    return{x:camera.x+c*offset.x+s*offset.z,y:groundY,z:camera.z-s*offset.x+c*offset.z};
  }
  class GroundTracking{
    constructor({scene,field,target,onTracking,onError}){
      this.scene=scene;this.field=field;this.target=target;this.onTracking=onTracking;this.onError=onError;
      this.T=root.AFRAME.THREE;this.mode='xr8';this.placed=false;this.tracked=false;this.disposed=false;
      this.normal=false;this.elapsed=0;this.normalSince=0;this.normalAt=0;
      this.listeners=[];this.sensorListeners=[];this.geoSamples=[];this.headings=[];this.lastGeoAt=0;
      this.lastPoll=-Infinity;this.locationEpoch=0;this.pendingFix=false;this.geoDenied=false;
      this.groundY=null;this.groundStable=0;this.message='Locating objects…';field.visible=false;
      this.listen(scene,'xrtrackingstatus',event=>{
        const normal=event.detail?.status==='NORMAL';
        if(normal&&!this.normal){this.normalSince=this.elapsed;this.normalAt=Date.now();this.lastPoll=-Infinity;}
        this.normal=normal;
        if(!normal){this.geoSamples=[];this.headings=[];this.groundStable=0;this.announce(this.placed?'Move slowly to recover tracking.':'Finding the ground…');}
        if(this.placed)this.setTracking(normal);
      });
      this.listen(scene,'realityerror',event=>{
        this.normal=false;this.setTracking(false);
        this.onError?.(event.detail?.error?.message||'World tracking could not start. Allow camera access and reopen this page on your phone.');
      });
      for(const name of ['deviceorientationabsolute','deviceorientation']){
        const receive=event=>this.receiveOrientation(event);root.addEventListener(name,receive);
        this.sensorListeners.push(()=>root.removeEventListener(name,receive));
      }
      this.startLocation();
      scene.setAttribute('xrconfig','cameraDirection: back; allowedDevices: mobile; disableDefaultEnvironment: true; disableDesktopCameraControls: true; disableDesktopTouchEmulation: true; disableCameraReparenting: true');
      scene.setAttribute('xrweb','scale: absolute; disableWorldTracking: false');
    }
    listen(target,name,fn){target.addEventListener(name,fn);this.listeners.push(()=>target.removeEventListener(name,fn));}
    announce(message){if(message===this.message)return;this.message=message;if(!this.tracked)this.onTracking?.(false,this.placed);}
    setTracking(value){this.tracked=value;this.field.visible=value;this.onTracking?.(value,this.placed);}
    cameraPosition(){const camera=this.scene.camera;camera.updateWorldMatrix(true,false);return camera.getWorldPosition(new this.T.Vector3());}
    startLocation(){
      if(!root.navigator?.geolocation){this.geoDenied=true;this.announce('Location is unavailable. Open the HTTPS link on your phone.');return;}
      this.locationOptions={enableHighAccuracy:true,maximumAge:0,timeout:12000};
      this.geoWatch=root.navigator.geolocation.watchPosition(p=>this.receivePosition(p),e=>this.locationError(e),this.locationOptions);
    }
    requestFix(){
      if(this.pendingFix||this.geoDenied||!root.navigator?.geolocation?.getCurrentPosition)return;
      this.pendingFix=true;const epoch=this.locationEpoch;
      root.navigator.geolocation.getCurrentPosition(p=>{if(epoch!==this.locationEpoch)return;this.pendingFix=false;this.receivePosition(p);},e=>{if(epoch!==this.locationEpoch)return;this.pendingFix=false;this.locationError(e);},this.locationOptions);
    }
    locationError(error){
      if(this.disposed||this.placed)return;
      this.geoSamples=[];this.geoProblem=error?.code===1?'Allow location, then reopen.':'Waiting for outdoor GPS…';
      if(error?.code===1){this.geoDenied=true;this.stopLocation();}
      this.announce(this.geoProblem);
    }
    receivePosition({coords,timestamp=Date.now()}){
      if(this.disposed||this.placed||this.geoDenied||!this.normal||this.elapsed-this.normalSince<.7)return;
      const now=Date.now();
      if(Number.isFinite(timestamp)&&timestamp<=this.lastGeoAt)return;
      if(!Number.isFinite(timestamp)||now-timestamp>2500||timestamp>now+500||timestamp<this.normalAt-200||!Number.isFinite(coords?.latitude)||!Number.isFinite(coords?.longitude)||Math.abs(coords.latitude)>90||Math.abs(coords.longitude)>180||!Number.isFinite(coords?.accuracy)||coords.accuracy<0||coords.accuracy>20){
        this.geoSamples=[];this.geoProblem=Number.isFinite(coords?.accuracy)&&coords.accuracy>20?'GPS ±'+Math.round(coords.accuracy)+' m · Waiting…':'Waiting for fresh GPS…';return;
      }
      const point={lat:coords.latitude,lon:coords.longitude};
      if(!this.target||root.BeaconNavigation.distance(point,this.target)>60){this.geoSamples=[];this.geoProblem=this.target?Math.round(root.BeaconNavigation.distance(point,this.target))+' m to objects':'Project coordinates are missing.';return;}
      this.lastGeoAt=timestamp;this.geoProblem=null;
      this.geoSamples.push({point,accuracy:Math.max(1,coords.accuracy),timestamp,at:now,camera:{...this.cameraPosition()}});
      this.geoSamples=this.geoSamples.filter(s=>now-s.at<=5000).slice(-3);
    }
    receiveOrientation(event){
      if(this.disposed||this.placed||!this.normal||this.elapsed-this.normalSince<.7)return;
      const heading=cameraHeading(event);if(heading===null)return;
      const camera=this.scene.camera;camera.updateWorldMatrix(true,false);
      const forward=camera.getWorldDirection(new this.T.Vector3());
      if(Math.hypot(forward.x,forward.z)<.3)return;
      const localHeading=Math.atan2(forward.x,-forward.z)/RAD,at=Date.now();
      this.headings.push({yaw:wrap(heading-localHeading),at});
      this.headings=this.headings.filter(s=>at-s.at<=1200).slice(-256);
    }
    tick(frame,dt=1/60){
      if(this.disposed)return;this.elapsed+=Math.min(dt,.05);
      if(this.placed||!this.normal)return;
      if(this.elapsed-this.normalSince<.7){this.announce('Finding the ground…');return;}
      if(this.elapsed-this.lastPoll>=1.4){this.lastPoll=this.elapsed;this.requestFix();}
      const now=Date.now(),camera=this.cameraPosition();
      if(![camera.x,camera.y,camera.z].every(Number.isFinite)||camera.y<.35||camera.y>4){this.groundStable=0;this.announce('Move slowly over the ground.');return;}
      let hit;
      try{hit=surfaceHit(root.XR8.XrController.hitTest(.5,.62),camera);}catch(_){hit=null;}
      // Only ground height is used. Aiming at a surface never selects x/z.
      // With no hit, use absolute SLAM's estimated ground frame y=0.
      const ground=hit&&Math.abs(hit.position.y)<=.45?hit.position.y:0;
      if(this.groundY!==null&&Math.abs(this.groundY-ground)<.12)this.groundStable+=Math.min(dt,.05);else this.groundStable=0;
      this.groundY=ground;
      this.geoSamples=this.geoSamples.filter(s=>now-s.at<=5000);
      if(this.geoSamples.length<2||this.geoSamples.at(-1).timestamp-this.geoSamples[0].timestamp<650){this.announce(this.geoProblem||'Locating objects…');return;}
      const yaw=alignment(this.headings,now);
      if(yaw===null){this.announce('Lift your phone slightly and turn slowly.');return;}
      if(this.groundStable<.35){this.announce('Finding the ground…');return;}
      const candidates=this.geoSamples.map(sample=>({...worldAnchor(root.BeaconNavigation.project(this.target,sample.point),sample.camera,yaw,ground),weight:1/sample.accuracy**2}));
      const latest=candidates.at(-1),spread=Math.max(...candidates.map(p=>Math.hypot(p.x-latest.x,p.z-latest.z)));
      if(spread>Math.max(8,this.geoSamples.at(-1).accuracy)){this.geoSamples=this.geoSamples.slice(-1);this.announce('Waiting for steady GPS…');return;}
      const sum=candidates.reduce((n,p)=>n+p.weight,0);
      this.field.position.set(candidates.reduce((n,p)=>n+p.x*p.weight,0)/sum,ground,candidates.reduce((n,p)=>n+p.z*p.weight,0)/sum);
      this.field.rotation.set(0,yaw,0);this.field.updateWorldMatrix(true,true);
      this.placed=true;this.message='';this.stopLocation();this.sensorListeners.splice(0).forEach(remove=>remove());this.setTracking(true);
    }
    stopLocation(){
      this.locationEpoch++;this.pendingFix=false;
      if(this.geoWatch!==undefined){root.navigator.geolocation.clearWatch(this.geoWatch);this.geoWatch=undefined;}
    }
    dispose(){
      if(this.disposed)return;this.disposed=true;this.tracked=false;this.field.visible=false;this.stopLocation();
      this.listeners.splice(0).forEach(remove=>remove());this.sensorListeners.splice(0).forEach(remove=>remove());
      this.scene.removeAttribute('xrweb');this.scene.removeAttribute('xrconfig');
      try{Promise.resolve(root.XR8?.stop()).catch(()=>{});}catch(_){}
    }
  }
  const api={GroundTracking,surfaceHit,cameraHeading,alignment,worldAnchor};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.BeaconGroundTracking=api;
})(typeof window!=='undefined'?window:globalThis);
