/* 三组装置共用一个原点；位置单位为米，不把每个装置分别绑定到有误差的 GPS。 */
(function(root){
  const stations=Object.freeze([
    Object.freeze({id:'throw',name:'Toss',x:-2.05,z:0}),
    Object.freeze({id:'swing',name:'Swing',x:2.05,z:0}),
    Object.freeze({id:'echo',name:'Echo',x:0,z:-2.9})
  ]);
  function nearby(positions,camera,accuracy,age=0){
    if(!Number.isFinite(accuracy)||accuracy>2.5||age>5000)return null;
    const sorted=positions.map(p=>({id:p.id,d:Math.hypot(camera.x-p.x,camera.z-p.z)})).sort((a,b)=>a.d-b.d);
    if(!sorted.length||sorted[0].d>2.7||(sorted[1]&&sorted[1].d-sorted[0].d<.8))return null;
    return sorted[0].id;
  }
  const api={stations,overviewDistance:8.8,nearby};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.BeaconFieldLayout=api;
})(typeof globalThis!=='undefined'?globalThis:window);
