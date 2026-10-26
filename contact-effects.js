/* 只做接触阴影：不生成地面、草木或其他环境模型。 */
(() => {
  'use strict';
  class BeaconContactEffects {
    constructor(T, scene, root, preview, kind='throw') {
      this.T = T; this.scene = scene; this.root = root; this.preview = preview; this.resources = new Set(); this.impactPulse = 0;
      this.group = new T.Group(); this.group.name = 'contact-shadows'; root.add(this.group);
      this.geometry = this.keep(new T.PlaneGeometry(2, 2));
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d'), fade = ctx.createRadialGradient(64, 64, 0, 64, 64, 63);
      fade.addColorStop(0, 'rgba(30,39,29,.55)'); fade.addColorStop(.3, 'rgba(30,39,29,.3)'); fade.addColorStop(1, 'rgba(30,39,29,0)');
      ctx.fillStyle = fade; ctx.fillRect(0, 0, 128, 128);
      this.texture = this.keep(new T.CanvasTexture(canvas)); this.texture.colorSpace = T.SRGBColorSpace;
      this.baseShadow = this.shadow(.55, .42, .35); this.baseShadow.position.set(.02, .008, -.02);
      this.ballShadow = this.shadow(.14, .12, .25); this.ballShadow.name = 'ball-contact-shadow'; this.ballShadow.visible = false;
      this.echoShadows = (kind==='echo'?[-.82, 0, .82]:[]).map(x => { const m = this.shadow(.16, .12, .25); m.position.set(x, .009, .12); return m; });
      this.swingShadows = (kind==='swing'?[-.56,0,.56]:[]).map(angle=>{const m=this.shadow(.13,.1,.24);m.position.set(Math.sin(angle)*1.15,.009,.1);return m});
      if (preview) {
        // Local preview has a quiet backdrop; camera AR keeps the actual video untouched.
        const backdrop = document.createElement('canvas'); backdrop.width = 4; backdrop.height = 256;
        const context = backdrop.getContext('2d'), gradient = context.createLinearGradient(0, 0, 0, 256);
        gradient.addColorStop(0, '#e6ebe4'); gradient.addColorStop(.55, '#eff0e7'); gradient.addColorStop(1, '#dce1d4');
        context.fillStyle = gradient; context.fillRect(0, 0, 4, 256);
        this.oldBackground = scene.object3D.background; this.backdrop = this.keep(new T.CanvasTexture(backdrop)); this.backdrop.colorSpace = T.SRGBColorSpace;
        scene.object3D.background = this.backdrop;
      }
    }
    keep(resource) { this.resources.add(resource); return resource; }
    shadow(x, z, opacity) {
      const material = this.keep(new this.T.MeshBasicMaterial({ map: this.texture, transparent: true, opacity, depthWrite: false, side: this.T.DoubleSide }));
      const mesh = new this.T.Mesh(this.geometry, material); mesh.rotation.x = -Math.PI / 2; mesh.scale.set(x, z, 1); mesh.position.y = .01; this.group.add(mesh); return mesh;
    }
    impact(point, force, reducedMotion) { if (!reducedMotion && force > .6) this.impactPulse = .22; }
    update(ballWorld, inFlight, mode, dt, reducedMotion) {
      const p = this.root.worldToLocal(ballWorld.clone()), height = Math.max(0, p.y);
      this.impactPulse = Math.max(0, this.impactPulse - dt);
      this.ballShadow.visible = (mode === 'swing' || inFlight && mode === 'throw') && height < 4;
      this.ballShadow.position.set(p.x + height * .1, .012, p.z - height * .08);
      const spread = 1 + height * .6; this.ballShadow.scale.set(.15 * spread, .12 * spread, 1);
      this.ballShadow.material.opacity = (.38 + (reducedMotion ? 0 : this.impactPulse * .35)) / (1 + height * 1.8);
      this.echoShadows.forEach(mesh => mesh.visible = mode === 'echo');
      this.swingShadows.forEach(mesh => mesh.visible = mode === 'swing');
    }
    dispose() {
      this.root.remove(this.group);
      if (this.preview && this.scene.object3D.background === this.backdrop) this.scene.object3D.background = this.oldBackground;
      this.resources.forEach(resource => resource.dispose()); this.resources.clear();
    }
  }
  window.BeaconContactEffects = BeaconContactEffects;
})();
