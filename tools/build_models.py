"""Original procedural mesh models. Python 3 stdlib only; units: metres, Y up.
Run from any folder. The GLB files can be imported and edited in Blender.
Named nodes are animation/picking anchors; keep their names when re-exporting.
"""
from pathlib import Path
import array, base64, json, math, struct

OUT=Path(__file__).resolve().parents[1]/'models'

def grid(rows,cols,vertex):
    positions=[];normals=[];indices=[]
    for i in range(rows+1):
        for j in range(cols+1):
            p,n=vertex(i/rows,j/cols);positions.extend(p);normals.extend(n)
    for i in range(rows):
        for j in range(cols):
            a=i*(cols+1)+j;b=a+cols+1
            indices.extend([a,b,a+1,a+1,b,b+1])
    return positions,normals,indices

def sphere(radius,rows=12,cols=24):
    def point(u,v):
        t=u*math.pi;p=v*2*math.pi;n=(math.sin(t)*math.cos(p),math.cos(t),math.sin(t)*math.sin(p))
        return tuple(radius*x for x in n),n
    return grid(rows,cols,point)

def torus(radius,tube,rows=12,cols=48):
    def point(u,v):
        t=u*2*math.pi;p=v*2*math.pi
        return ((radius+tube*math.cos(t))*math.cos(p),(radius+tube*math.cos(t))*math.sin(p),tube*math.sin(t)),(math.cos(t)*math.cos(p),math.cos(t)*math.sin(p),math.sin(t))
    return grid(rows,cols,point)

def cylinder(radius,height,segments=24):
    p,n,ind=grid(1,segments,lambda u,v:((radius*math.cos(v*2*math.pi),(u-.5)*height,radius*math.sin(v*2*math.pi)),(math.cos(v*2*math.pi),0,math.sin(v*2*math.pi))))
    for sign in [-1,1]:
        center=len(p)//3;p.extend([0,sign*height/2,0]);n.extend([0,sign,0])
        for j in range(segments+1):
            a=j/segments*2*math.pi;p.extend([radius*math.cos(a),sign*height/2,radius*math.sin(a)]);n.extend([0,sign,0])
        for j in range(segments):ind.extend([center,center+j+1,center+j+2])
    return p,n,ind

class Model:
    def __init__(self,name):
        self.name=name;self.data=bytearray();self.views=[];self.accessors=[];self.meshes=[];self.materials=[];self.nodes=[];self.roots=[];self.cache={}
    def accessor(self,values,kind,components,component_type,target,bounds=False):
        while len(self.data)%4:self.data.append(0)
        raw=array.array(kind,values).tobytes();view=len(self.views)
        self.views.append(dict(buffer=0,byteOffset=len(self.data),byteLength=len(raw),target=target));self.data.extend(raw)
        a=dict(bufferView=view,componentType=component_type,count=len(values)//components,type='VEC3' if components==3 else 'SCALAR')
        if bounds:
            a['min']=[min(values[i::3]) for i in range(3)];a['max']=[max(values[i::3]) for i in range(3)]
        self.accessors.append(a);return len(self.accessors)-1
    def material(self,color,roughness=.88):
        key=(color,roughness)
        if key in self.cache:return self.cache[key]
        srgb=[int(color[i:i+2],16)/255 for i in (1,3,5)]
        rgb=[c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in srgb]
        i=len(self.materials);self.materials.append(dict(name=color,pbrMetallicRoughness=dict(baseColorFactor=rgb+[1],metallicFactor=0,roughnessFactor=roughness)));self.cache[key]=i;return i
    def node(self,name,geometry=None,color='#81917d',position=(0,0,0),parent=None,rotation=None,roughness=.88):
        node=dict(name=name,translation=list(position))
        if rotation:node['rotation']=rotation
        if geometry:
            p,n,indices=geometry
            # Face winding follows the explicit outward normals, including cylinder caps.
            for k in range(0,len(indices),3):
                a,b,c=indices[k:k+3];v=[p[j*3:j*3+3] for j in (a,b,c)];u=[v[1][i]-v[0][i] for i in range(3)];w=[v[2][i]-v[0][i] for i in range(3)]
                cross=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]]
                if sum(cross[i]*(n[a*3+i]+n[b*3+i]+n[c*3+i]) for i in range(3))<0:indices[k+1],indices[k+2]=indices[k+2],indices[k+1]
            primitive=dict(attributes=dict(POSITION=self.accessor(p,'f',3,5126,34962,True),NORMAL=self.accessor(n,'f',3,5126,34962)),indices=self.accessor(indices,'H',1,5123,34963),material=self.material(color,roughness))
            node['mesh']=len(self.meshes);self.meshes.append(dict(name=name,primitives=[primitive]))
        idx=len(self.nodes);self.nodes.append(node)
        if parent is None:self.roots.append(idx)
        else:self.nodes[parent].setdefault('children',[]).append(idx)
        return idx
    def base(self,mode):
        self.node('base-'+mode,cylinder(.36,.1,32),position=(0,.05,0),roughness=.95)
        for i,x in enumerate([-.17,0,.17]):self.node(('pip-' if mode=='throw' else 'pip-'+mode+'-')+str(i),sphere(.035,8,16),'#7e9077',(x,.13,.28))
    def save(self,filename):
        while len(self.data)%4:self.data.append(0)
        gltf=dict(asset=dict(version='2.0',generator='Bounce & Echo original procedural modelling / build_models.py',copyright='Generated for Bounce & Echo'),scene=0,scenes=[dict(name=self.name,nodes=self.roots)],nodes=self.nodes,meshes=self.meshes,materials=self.materials,accessors=self.accessors,bufferViews=self.views,buffers=[dict(byteLength=len(self.data))])
        text=json.dumps(gltf,separators=(',',':')).encode();text+=b' '*((-len(text))%4)
        data=struct.pack('<III',0x46546c67,2,28+len(text)+len(self.data))+struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(self.data),0x004e4942)+self.data
        (OUT/filename).write_bytes(data);print(filename,len(data),'bytes',len(self.meshes),'meshes')

def build():
    OUT.mkdir(exist_ok=True)
    m=Model('Toss — ring and ball tray');m.base('throw')
    stem=m.node('stem',cylinder(.035,1),'#718d78',(0,.3825,0));m.nodes[stem]['scale']=[1,.615,1]
    g=m.node('goal',position=(0,1.35,0));m.node('ring',torus(.61,.065),'#9ab29a',parent=g)
    m.node('display-ball',sphere(.115),'#e39567',(.23,.22,.18));m.save('toss-station.glb')
    m=Model('Swing — pull and ring');m.base('swing');g=m.node('swing-group')
    m.node('swing-support',cylinder(.028,2.1),'#718d78',(0,1.05,-.18),g)
    m.node('swing-hanger',cylinder(.04,.36),'#9ab29a',(0,2.1,0),g,[math.sin(math.pi/4),0,0,math.cos(math.pi/4)])
    pivot=m.node('pendulum',position=(0,2.1,.18),parent=g)
    m.node('swing-rope',cylinder(.014,1.15),'#577461',(0,-.575,0),pivot);m.node('swing-ball',sphere(.14),'#e39567',(0,-1.15,0),pivot)
    for i,angle in enumerate([-.56,0,.56]):
        h=2.1-math.cos(angle)*1.15;b=m.node('bell-'+str(i),position=(math.sin(angle)*1.15,h,.18),parent=g)
        m.node('bell-post-'+str(i),cylinder(.018,h),'#7f9670',(0,-h/2,-.08),b)
        m.node('bell-foot-'+str(i),cylinder(.09,.03),'#81917d',(0,-h+.015,-.08),b)
        m.node('bell-rim-'+str(i),torus(.16,.034,10,32),['#c6c28e','#b8acbf','#96afb7'][i],parent=b)
        m.node('bell-face-'+str(i),sphere(.085),'#79917b',(0,0,-.07),b)
    m.save('swing-station.glb')
    m=Model('Echo — three listening notes');m.base('echo');g=m.node('echo-group')
    for i,x in enumerate([-.82,0,.82]):
        h=1.35 if i==1 else .98;s=m.node('note-stand-'+str(i),position=(x,h,.12),parent=g)
        m.node('note-post-'+str(i),cylinder(.025,h-.1),'#7f9670',(0,-h/2,0),s)
        m.node('note-foot-'+str(i),cylinder(.11,.045),'#667d58',(0,-h+.024,0),s)
        speaker=m.node('speaker-'+str(i),sphere(.17),['#c6c28e','#b8acbf','#96afb7'][i],parent=s)
        m.node('speaker-face-'+str(i),torus(.065,.012,8,24),'#405d4c',(0,0,.158),speaker)
        m.node('speaker-eye-'+str(i),sphere(.018,8,12),'#405d4c',(0,0,.174),speaker)
    m.save('echo-station.glb')
    m=Model('Throwable orange ball');m.node('ball-mesh',sphere(.115),'#e39567');m.save('throw-ball.glb')
    payload={p.name:'data:model/gltf-binary;base64,'+base64.b64encode(p.read_bytes()).decode() for p in sorted(OUT.glob('*.glb'))}
    (OUT/'model-data.js').write_text('/* File-preview copies of the exact GLB bytes. Hosted pages load the .glb files. */\nwindow.BEACON_MODEL_DATA='+json.dumps(payload,separators=(',',':'))+';\n')

if __name__=='__main__':build()
