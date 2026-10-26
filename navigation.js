/* 声音寻路用的纯计算：米、真北角度；浏览器和 Node 测试共用。 */
(function(root) {
  'use strict';
  const RAD = Math.PI / 180, EARTH = 6371000;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const wrap = a => ((a % 360) + 360) % 360;
  const angle = a => wrap(a + 180) - 180;
  function distance(a, b) {
    const h = Math.sin((b.lat-a.lat)*RAD/2)**2 + Math.cos(a.lat*RAD)*Math.cos(b.lat*RAD)*Math.sin((b.lon-a.lon)*RAD/2)**2;
    return 2*EARTH*Math.asin(Math.sqrt(clamp(h,0,1)));
  }
  function bearing(a,b) {
    const dl=(b.lon-a.lon)*RAD, p=a.lat*RAD, q=b.lat*RAD;
    return wrap(Math.atan2(Math.sin(dl)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(dl))/RAD);
  }
  function offset(point,heading,metres) {
    const d=metres/EARTH, h=heading*RAD, p=point.lat*RAD, l=point.lon*RAD;
    const q=Math.asin(Math.sin(p)*Math.cos(d)+Math.cos(p)*Math.sin(d)*Math.cos(h));
    return {lat:q/RAD,lon:(l+Math.atan2(Math.sin(h)*Math.sin(d)*Math.cos(p),Math.cos(d)-Math.sin(p)*Math.sin(q)))/RAD};
  }
  // 本地地理坐标：x 向东、z 向南；相机和装置始终共用同一个固定 GPS 原点。
  function project(point,origin){const d=distance(origin,point),h=bearing(origin,point)*RAD;return{x:d*Math.sin(h),y:0,z:-d*Math.cos(h)};}
  function trail(start,target) {
    const d=distance(start,target), heading=bearing(start,target);
    const count=d>50?3:d>25?2:1;
    return Array.from({length:count},(_,i)=>i===count-1?{...target}:offset(start,heading,d*(i+1)/count));
  }
  function levels(metres,relativeHeading) {
    const proximity=.18+.72/(1+Math.pow(Math.max(0,metres)/18,1.2));
    return [-70,0,70].map(direction=>{
      const alignment=Math.max(0,Math.cos(angle(relativeHeading-direction)*RAD));
      return .025+proximity*(.07+.93*Math.pow(alignment,4));
    });
  }
  function reached(point,goal,accuracy,previousAt,now) {
    return accuracy<=25 && distance(point,goal)<=12 && (previousAt===null || now-previousAt>=650);
  }
  // 起点只确认在固定地点附近，绝不把打开网页时任意位置当成起点。
  class StartGate {
    constructor(point,{radius=15,maxAccuracy=20,maxAge=15000,separation=650}={}) {
      this.point=point;Object.assign(this,{radius,maxAccuracy,maxAge,separation});this.reset();
    }
    reset(){this.confirmAt=null;this.lastAt=null;this.state={status:'waiting',distance:null,accuracy:null};}
    receive({coords,timestamp=Date.now()},now=Date.now()) {
      if(!Number.isFinite(timestamp)||now-timestamp>this.maxAge||timestamp>now+2000||!Number.isFinite(coords?.latitude)||!Number.isFinite(coords?.longitude)||Math.abs(coords.latitude)>90||Math.abs(coords.longitude)>180){this.reset();return this.state;}
      if(this.lastAt!==null&&timestamp<=this.lastAt)return this.snapshot(now);
      const point={lat:coords.latitude,lon:coords.longitude},accuracy=coords.accuracy;
      const data={distance:distance(point,this.point),bearing:bearing(point,this.point),accuracy};
      this.lastAt=timestamp;
      if(!Number.isFinite(accuracy)||accuracy<0||accuracy>this.maxAccuracy){this.confirmAt=null;return this.state={...data,status:'inaccurate'};}
      if(data.distance>this.radius){this.confirmAt=null;return this.state={...data,status:'away'};}
      if(this.confirmAt===null||timestamp<this.confirmAt)this.confirmAt=timestamp;
      const status=timestamp-this.confirmAt>=this.separation?'ready':'confirming';
      return this.state={...data,status};
    }
    snapshot(now=Date.now()) {
      if(this.lastAt!==null&&now-this.lastAt>this.maxAge)this.reset();
      return this.state;
    }
    ready(now=Date.now()){return this.snapshot(now).status==='ready';}
  }
  const api={distance,bearing,offset,project,trail,levels,wrap,angle,reached,StartGate};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.BeaconNavigation=api;
})(typeof globalThis!=='undefined'?globalThis:window);
