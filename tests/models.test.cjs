const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const names={
 'toss-station.glb':['base-throw','stem','goal','ring','display-ball','pip-0','pip-1','pip-2'],
 'swing-station.glb':['base-swing','pendulum','swing-ball','bell-0','bell-1','bell-2'],
 'echo-station.glb':['base-echo','echo-group','speaker-0','speaker-1','speaker-2'],
 'throw-ball.glb':['ball-mesh']
};
for(const [name,required] of Object.entries(names))test(`${name} contains real mesh buffers and the required interactive parts`,()=>{
 const data=fs.readFileSync(path.join(__dirname,'../models',name));assert.equal(data.readUInt32LE(0),0x46546c67);assert.equal(data.readUInt32LE(4),2);assert.equal(data.readUInt32LE(8),data.length);
 const jsonSize=data.readUInt32LE(12),gltf=JSON.parse(data.subarray(20,20+jsonSize).toString());assert.ok(gltf.meshes.length>0);assert.ok(gltf.buffers[0].byteLength>0);
 for(const node of required)assert.ok(gltf.nodes.some(n=>n.name===node),node);
 for(const mesh of gltf.meshes)for(const primitive of mesh.primitives){assert.ok(gltf.accessors[primitive.attributes.POSITION].count>=20);assert.ok(gltf.accessors[primitive.indices].count>=30);}
 const start=28+jsonSize;for(const view of gltf.bufferViews)assert.ok(start+view.byteOffset+view.byteLength<=data.length);
});
