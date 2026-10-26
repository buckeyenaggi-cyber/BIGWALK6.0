/* 地点发现前的声音寻路。三个屏幕触发点负责比较方向，GPS 决定距离和到达。 */
(() => {
  'use strict';
  const N=window.BeaconNavigation,$=id=>document.getElementById(id);
  class SoundTrail {
    constructor({start=null,target,audio,onFound,onExit,reducedMotion}) {
      this.start=start;this.startGate=start?new N.StartGate(start):null;
      this.target=target;this.audio=audio;this.onFound=onFound;this.onExit=onExit;this.reducedMotion=reducedMotion;
      this.active=false;this.watch=null;this.timers=new Set();this.tickTimer=null;this.motionGranted=false;
      this.orientation=e=>this.onOrientation(e);this.keys=e=>this.onKey(e);this.keyRelease=e=>{if(this.listening?.key===e.key.toLowerCase())this.endListen()};
      ['left','ahead','right'].forEach((name,i)=>{
        const button=$('probe-'+name);
        button.addEventListener('pointerdown',event=>{if(event.button!==0||this.listening)return;event.preventDefault();button.focus({preventScroll:true});this.beginListen(i,{pointerId:event.pointerId});try{button.setPointerCapture(event.pointerId)}catch(_){}});
        button.addEventListener('click',event=>{if(event.detail===0&&!this.listening)this.probe(i)});
      });
      this.listenMove=event=>{
        if(this.listening?.pointerId!==event.pointerId)return;
        const button=document.elementFromPoint(event.clientX,event.clientY)?.closest('.probe');
        const index=['probe-left','probe-ahead','probe-right'].indexOf(button?.id);
        if(index>=0&&index!==this.listening.index){this.listening.index=index;this.audio.stopAll();this.probe(index);this.listening.nextAt=performance.now()+720;this.render()}
      };
      this.listenUp=event=>{if(this.listening?.pointerId===event.pointerId)this.endListen()};
      this.visibility=()=>{if(document.visibilityState==='hidden'){this.endListen();this.scanning=false;this.scanToken++;this.audio.stopAll();this.render()}};
      this.blur=()=>{this.endListen();this.scanning=false;this.scanToken++;this.audio.stopAll();this.render()};
      $('trail-exit').addEventListener('click',()=>{this.stop();$('trail-screen').hidden=true;this.onExit()});
      $('trail-enter').addEventListener('click',()=>{if(!this.found)return;const demo=this.demo;this.stop();$('trail-screen').hidden=true;this.onFound({demo})});
      $('trail-retry').addEventListener('click',()=>this.begin(this.demo,{startConfirmed:this.startConfirmed}));
      $('demo-left').addEventListener('click',()=>this.turn(-30));$('demo-right').addEventListener('click',()=>this.turn(30));$('demo-step').addEventListener('click',()=>this.step());
    }
    begin(demo=false,{startConfirmed=false}={}) {
      this.stop();const generation=this.generation;this.active=true;this.demo=demo;this.found=false;this.route=null;this.index=0;this.position=null;this.accuracy=null;this.heading=demo?300:null;this.headingKind=demo?'demo':null;
      this.startConfirmed=demo||!this.start||startConfirmed;this.startGate?.reset();
      this.rawHeading=null;this.calibration=null;this.awaitingNorth=false;this.relative=undefined;this.currentDistance=Infinity;this.locationFailed=null;this.scanning=false;this.scanToken=0;this.clue=false;this.nextScan=0;this.levels=[.06,.06,.06];this.confirmAt=null;this.candidate=null;this.messageUntil=0;this.notice=null;this.stopsKey=null;this.hasListened=false;
      $('trail-screen').hidden=false;$('trail-found').hidden=true;$('trail-field').hidden=false;$('trail-retry').hidden=true;
      $('demo-controls').hidden=!demo;$('trail-demo-tag').hidden=!demo;
      this.audio.unlock();window.addEventListener('keydown',this.keys);window.addEventListener('keyup',this.keyRelease);
      window.addEventListener('pointermove',this.listenMove);window.addEventListener('pointerup',this.listenUp);window.addEventListener('pointercancel',this.listenUp);
      window.addEventListener('blur',this.blur);document.addEventListener('visibilitychange',this.visibility);
      if(demo) {this.demoPosition=this.start?{...this.start}:N.offset(this.target,180,72);this.readDemo();this.demoTimer=setInterval(()=>this.readDemo(),800)}
      else {
        window.addEventListener('deviceorientationabsolute',this.orientation);window.addEventListener('deviceorientation',this.orientation);
        if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function') {
          // 必须在开始按钮的点击事件中请求，不能等定位返回后再请求。
          DeviceOrientationEvent.requestPermission().then(permission=>{this.motionGranted=permission==='granted';if(this.active)this.render()}).catch(()=>{});
        }
        if(navigator.geolocation) this.watch=navigator.geolocation.watchPosition(p=>{if(this.active&&this.generation===generation)this.receive(p)},e=>{if(this.active&&this.generation===generation)this.locationError(e)},{enableHighAccuracy:true,maximumAge:1000,timeout:20000});
        else this.locationError({code:2});
      }
      this.tickTimer=setInterval(()=>this.update(),180);this.render();
    }
    onOrientation(event) {
      if(!this.active||this.demo||this.found)return;
      const orient=screen.orientation?.angle||window.orientation||0;
      if(Number.isFinite(event.webkitCompassHeading)&&(!Number.isFinite(event.webkitCompassAccuracy)||event.webkitCompassAccuracy>=0&&event.webkitCompassAccuracy<50)) {
        this.heading=N.wrap(event.webkitCompassHeading+orient);this.headingKind='compass';return;
      }
      if(!Number.isFinite(event.alpha))return;
      this.rawHeading=N.wrap(360-event.alpha+orient);
      if(this.awaitingNorth){this.calibration=-this.rawHeading;this.awaitingNorth=false}
      if(event.absolute||event.type==='deviceorientationabsolute'){this.heading=this.rawHeading;this.headingKind='compass'}
      else if(this.calibration!==null){this.heading=N.wrap(this.rawHeading+this.calibration);this.headingKind='calibrated'}
    }
    receive({coords,timestamp=Date.now()}) {
      if(!this.active||this.found||!Number.isFinite(coords.latitude)||!Number.isFinite(coords.longitude))return;
      const point={lat:coords.latitude,lon:coords.longitude},accuracy=Number.isFinite(coords.accuracy)?coords.accuracy:999;
      if(!this.demo&&this.headingKind!=='compass'&&this.headingKind!=='calibrated') {
        if(Number.isFinite(coords.heading)){this.heading=coords.heading;this.headingKind='walk'}
        else if(this.position&&accuracy<=20&&this.accuracy<=20&&N.distance(this.position,point)>5){this.heading=N.bearing(this.position,point);this.headingKind='walk'}
      }
      this.locationFailed=null;this.position=point;this.accuracy=accuracy;$('trail-retry').hidden=true;
      if(!this.startConfirmed){
        const state=this.startGate.receive({coords,timestamp});
        if(state.status!=='ready'){this.render();return;}
        this.startConfirmed=true;this.notice={text:'Start ✓',until:performance.now()+2400};this.audio.win();
      }
      if(!this.route&&accuracy<=25)this.route=N.trail(this.start||point,this.target);
      this.goalDistance=N.distance(point,this.target);
      if(!this.route||accuracy>25||Date.now()-timestamp>15000){this.candidate=null;this.confirmAt=null;this.render();return}
      let candidate=null;
      if(N.reached(point,this.target,accuracy,null,timestamp)) candidate='landmark';
      else if(this.index<this.route.length-1) {
        const waypoint=this.route[this.index],remaining=N.distance(waypoint,this.target);
        if(N.distance(point,waypoint)<=10||this.goalDistance<=remaining+5)candidate='waypoint-'+this.index;
      }
      if(candidate===null){this.candidate=null;this.confirmAt=null}
      else if(candidate!==this.candidate){this.candidate=candidate;this.confirmAt=timestamp}
      else if(timestamp-this.confirmAt>=650) {
        this.candidate=null;this.confirmAt=null;
        if(candidate==='landmark'){this.discover();return}
        this.index++;this.scanToken++;this.nextScan=performance.now()+1200;if(this.listening)this.listening.nextAt=this.nextScan;
        this.audio.stopAll();this.audio.win();this.messageUntil=performance.now()+2400;
      }
      this.update();
    }
    update() {
      if(!this.active||this.found)return;
      if(this.position&&this.route&&this.heading!==null){
        this.currentDistance=N.distance(this.position,this.route[this.index]);this.relative=N.angle(N.bearing(this.position,this.route[this.index])-this.heading);
        const wanted=N.levels(this.currentDistance,this.relative);this.levels=this.levels.map((v,i)=>v+(wanted[i]-v)*.45);
      }
      if(this.listening&&performance.now()>=this.listening.nextAt&&document.visibilityState!=='hidden'){
        this.probe(this.listening.index,true);this.listening.nextAt=performance.now()+720;
      }
      this.render();
    }
    beginListen(index,input) {
      if(!this.active||this.found||this.listening||!this.startConfirmed)return;
      this.audio.unlock();this.audio.stopAll();this.scanning=false;this.scanToken++;
      this.listening={index,...input,started:performance.now(),nextAt:performance.now()+720};this.probe(index,true);this.render();
    }
    endListen() {
      const listening=this.listening;if(!listening)return;this.listening=null;if(performance.now()-listening.started>200)this.audio.stopAll();
      if(listening.pointerId!==undefined)['probe-left','probe-ahead','probe-right'].forEach(id=>{try{$(id).releasePointerCapture(listening.pointerId)}catch(_){}});
      ['probe-left','probe-ahead','probe-right'].forEach(id=>$(id).classList.remove('is-held','is-playing'));
      this.render();
    }
    tell(text) {this.notice={text,until:performance.now()+2600};this.render()}
    later(fn,ms) {const timer=setTimeout(()=>{this.timers.delete(timer);if(this.active&&!this.found)fn()},ms);this.timers.add(timer)}
    probe(index,automatic=false) {
      if(!this.active||this.found||!this.startConfirmed)return;
      if(!automatic)this.audio.unlock();
      if(!this.position||!this.route){this.tell('Waiting for GPS…');return}
      if(this.heading===null){this.tell('Walk a few steps.');return}
      if(this.accuracy>25){this.tell('Waiting for a steadier position.');return}
      if(!automatic)this.audio.stopAll();
      this.hasListened=true;const gain=this.levels[index];this.audio.navigation(gain,[-.85,0,.85][index]);
      const button=$(['probe-left','probe-ahead','probe-right'][index]);button.classList.add('is-playing');this.later(()=>button.classList.remove('is-playing'),550);
    }
    turn(degrees) {if(!this.demo||!this.active||this.found)return;this.heading=N.wrap(this.heading+degrees);this.update()}
    step() {if(!this.demo||!this.active||this.found)return;this.demoPosition=N.offset(this.demoPosition,this.heading,7);this.readDemo()}
    readDemo() {if(this.active)this.receive({coords:{latitude:this.demoPosition.lat,longitude:this.demoPosition.lon,accuracy:4,heading:this.heading},timestamp:Date.now()})}
    onKey(event) {
      if(!this.active||this.found||/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))return;
      if(event.altKey||event.ctrlKey||event.metaKey)return;
      let index={a:0,w:1,d:2}[event.key.toLowerCase()];
      if(index===undefined&&[' ','Enter'].includes(event.key))index=['probe-left','probe-ahead','probe-right'].indexOf(event.target.id);
      if(index!==undefined&&index>=0){event.preventDefault();if(!event.repeat)this.beginListen(index,{key:event.key.toLowerCase()});return}
      if(!this.demo)return;
      if(event.key==='ArrowLeft'){event.preventDefault();this.turn(-30)}else if(event.key==='ArrowRight'){event.preventDefault();this.turn(30)}else if(event.key==='ArrowUp'){event.preventDefault();this.step()}
    }
    render() {
      if(!this.active)return;
      $('trail-stage').textContent=this.found?'':this.startConfirmed?'Listen':'Start';
      $('trail-status').hidden=!this.locationFailed;
      if(this.locationFailed){$('trail-status').textContent=this.locationFailed;$('trail-caption').textContent='';return;}
      if(this.found)return;
      $('trail-field').hidden=!this.startConfirmed;$('trail-stops').hidden=!this.startConfirmed;
      if(!this.startConfirmed){
        const state=this.startGate.snapshot();
        $('trail-signal').textContent='Find the start';
        $('trail-caption').textContent=state.status==='away'?`${Math.round(state.distance)} m to start`:state.status==='confirming'?'Confirming start…':'Waiting for GPS…';return;
      }
      $('trail-signal').textContent=!this.route?'Listen':this.currentDistance>40?'Faint':this.currentDistance>18?'Closer':'Nearby';
      $('trail-caption').textContent=performance.now()<this.messageUntil?'Keep going.':this.notice&&performance.now()<this.notice.until?this.notice.text:this.accuracy!==null&&this.accuracy>25?'Waiting for GPS…':this.heading===null?'Walk a few steps.':this.relative!==undefined&&Math.abs(this.relative)>135?'Behind you.':this.hasListened?'':'Follow the sound.';
      const stopsKey=`${this.route?.length||3}:${this.index}`;
      if(this.stopsKey!==stopsKey){this.stopsKey=stopsKey;$('trail-stops').replaceChildren(...Array.from({length:this.route?.length||3},(_,i)=>{const dot=document.createElement('span');dot.className=i<this.index?'done':i===this.index?'current':'';return dot;}));}
      ['probe-left','probe-ahead','probe-right'].forEach((id,i)=>{const button=$(id);button.classList.toggle('is-held',this.listening?.index===i);button.classList.toggle('still',this.reducedMotion());});
    }

    discover() {
      this.found=true;this.stopTracking();this.audio.stopAll();if(document.visibilityState!=='hidden')this.audio.win(true);
      $('trail-field').hidden=true;$('demo-controls').hidden=true;$('trail-found').hidden=false;
      $('trail-signal').textContent='Found';$('trail-caption').textContent='';
      $('trail-stops').querySelectorAll('span').forEach(dot=>dot.className='done');this.render();
    }
    locationError(error) {this.locationFailed=error.code===1?'Allow location to continue.':'GPS unavailable.';$('trail-status').textContent=this.locationFailed;$('trail-caption').textContent='';$('trail-retry').hidden=false}
    stopTracking() {
      this.endListen();
      if(this.watch!==null){navigator.geolocation?.clearWatch(this.watch);this.watch=null}
      clearInterval(this.tickTimer);clearInterval(this.demoTimer);this.tickTimer=this.demoTimer=null;
      this.timers.forEach(clearTimeout);this.timers.clear();window.removeEventListener('deviceorientationabsolute',this.orientation);window.removeEventListener('deviceorientation',this.orientation);
      window.removeEventListener('keydown',this.keys);window.removeEventListener('keyup',this.keyRelease);
      window.removeEventListener('pointermove',this.listenMove);window.removeEventListener('pointerup',this.listenUp);window.removeEventListener('pointercancel',this.listenUp);window.removeEventListener('blur',this.blur);document.removeEventListener('visibilitychange',this.visibility);
      ['probe-left','probe-ahead','probe-right'].forEach(id=>$(id).classList.remove('is-playing','is-held'));
    }
    stop() {this.generation=(this.generation||0)+1;this.active=false;this.stopTracking();this.audio.stopAll()}
  }
  window.SoundTrail=SoundTrail;
})();
