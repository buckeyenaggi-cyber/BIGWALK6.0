"""Apply the documented lifecycle seams to the pinned AR.js 3.4.8 build, once."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / 'vendor/aframe-ar-3.4.8.js'
s = p.read_text()
patches = [
    ('const p=m,f=function', 'const p=m;window.BeaconArToolkitSource=m;const f=function'),
    ('f.prototype.onResize=function(){this.arSource.onResize(', 'f.prototype.onResize=function(){if(!this.arSource.domElement)return;this.arSource.onResize('),
    ('"tango"!==g.contextParameters.trackingBackend&&I.copyElementSizeTo(document.body)', 'I.domElement&&"tango"!==g.contextParameters.trackingBackend&&I.copyElementSizeTo(document.body)'),
    ('B.onResize(C,g.parameters.renderer,g.parameters.camera)', 'B.domElement&&B.onResize(C,g.parameters.renderer,g.parameters.camera)'),
    ('A(),(I==1/0||Date.now()-C<I)&&Q()', '!1!==A()&&(I==1/0||Date.now()-C<I)&&Q()'),
    ('()=>{window.dispatchEvent(new Event("resize"))}', '()=>{if(!A.el.isConnected)return false;window.dispatchEvent(new Event("resize"))}'),
    ('if(!1!==I.isReady){clearInterval(g);var B=I._arProfile;', 'if(!A.el.isConnected){clearInterval(g);return}if(!1!==I.isReady){clearInterval(g);var B=I._arProfile;'),
]
for before, after in patches:
    if after in s:
        continue
    if before not in s:
        raise RuntimeError('Pinned AR.js build changed: ' + before)
    s = s.replace(before, after)
p.write_text(s)
print('AR.js lifecycle seams applied')
