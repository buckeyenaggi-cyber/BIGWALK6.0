/* 用相机画面的小尺寸亮度样本缓慢调节模型明暗。仅在本机处理，不保存画面。 */
(() => {
  'use strict';
  class BeaconAmbientMatch {
    constructor(scene, enabled) {
      this.scene = scene; this.enabled = enabled; this.amount = 1; this.target = 1; this.nextSample = 0; this.elapsed = 0; this.failed = false;
      this.hemi = scene.querySelector('#ambient-light')?.getObject3D('light');
      this.sun = scene.querySelector('#key-light')?.getObject3D('light');
      this.canvas = document.createElement('canvas'); this.canvas.width = 20; this.canvas.height = 12;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    sample(frame) {
      if (!this.ctx || this.failed) return;
      try {
        this.ctx.drawImage(frame, 0, 0, 20, 12);
        const pixels = this.ctx.getImageData(0, 0, 20, 12).data; let luminance = 0;
        for (let i = 0; i < pixels.length; i += 4) luminance += .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
        const brightness = luminance / (pixels.length / 4) / 255;
        this.target = .72 + Math.min(1, Math.max(0, (brightness - .1) / .7)) * .44;
      } catch (_) { this.failed = true; this.target = 1; }
    }
    update(dt) {
      this.elapsed += dt;
      if (this.enabled && !this.failed && this.elapsed >= this.nextSample) {
        const video = document.getElementById('arjs-video');
        if (video?.readyState >= 2 && video.videoWidth) { this.sample(video); this.nextSample = this.elapsed + .9; }
      }
      if (!this.enabled) this.target = 1;
      this.amount += (this.target - this.amount) * (1 - Math.exp(-dt * 1.6));
      if (this.hemi) this.hemi.intensity = .85 * this.amount;
      if (this.sun) this.sun.intensity = .7 * this.amount;
    }
    dispose() { this.canvas.width = this.canvas.height = 0; this.ctx = null; this.hemi = this.sun = null; }
  }
  window.BeaconAmbientMatch = BeaconAmbientMatch;
})();
