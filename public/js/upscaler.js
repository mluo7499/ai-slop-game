// Adaptive temporal-style upscaler. Browsers cannot call NVIDIA DLSS (it lives in
// the driver and needs a native swapchain), so this reproduces the same idea:
// render at a lower internal resolution, then upscale with an edge-aware filter
// plus CAS contrast sharpening, optionally adapting resolution to hold frame time.
import * as THREE from 'three';

export const UPSCALE_PRESETS = {
  native: { label: 'NATIVE (NO UPSCALE)', scale: 1.0, sharpen: 0.0, aa: 0.0 },
  quality: { label: 'QUALITY (DLSS-STYLE)', scale: 0.88, sharpen: 0.32, aa: 1.0 },
  balanced: { label: 'BALANCED', scale: 0.78, sharpen: 0.42, aa: 1.0 },
  performance: { label: 'PERFORMANCE', scale: 0.66, sharpen: 0.55, aa: 1.2 },
  ultra: { label: 'ULTRA PERFORMANCE', scale: 0.53, sharpen: 0.7, aa: 1.3 },
};

export class Upscaler {
  constructor(renderer) {
    this.renderer = renderer;
    // We composite manually; auto-clearing after the first scene pass would wipe
    // the world when the first-person weapon overlay is drawn.
    renderer.autoClear = false;
    this.preset = 'quality';
    this.dynamic = true;
    this.scale = UPSCALE_PRESETS.quality.scale;
    this.minScale = 0.5;
    this.maxScale = 1.0;
    this.targetMs = 1000 / 62;
    this.frameTimes = [];
    this.enabled = true;

    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    // Keep the target linear; the composite applies the display encode. Using an
    // sRGB target makes WebGL decode on sample, which double-darkens the image.
    this.rt.texture.colorSpace = THREE.NoColorSpace;

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = {
      tDiffuse: { value: this.rt.texture },
      texel: { value: new THREE.Vector2(1 / 2, 1 / 2) },
      sharpen: { value: 0.32 },
      aa: { value: 1.0 },
      exposure: { value: 1.0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 texel;
        uniform float sharpen;
        uniform float aa;
        uniform float exposure;
        varying vec2 vUv;

        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
          vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
          vec3 e = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
          vec3 w = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;

          vec3 blur = (n + s + e + w) * 0.25;
          float lc = luma(c);
          float contrast = max(
            max(abs(lc - luma(n)), abs(lc - luma(s))),
            max(abs(lc - luma(e)), abs(lc - luma(w)))
          );

          // edge-aware soften: only blend where neighbouring luma jumps (FXAA-lite)
          float smoothAmount = clamp(contrast * 3.2 * aa, 0.0, 0.6);
          vec3 edges = mix(c, blur, smoothAmount * 0.75);

          // contrast adaptive sharpening
          vec3 sharp = edges + (edges - blur) * sharpen;
          sharp = max(sharp, vec3(0.0)) * exposure;

          gl_FragColor = vec4(pow(sharp, vec3(1.0 / 2.2)), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  setPreset(name, dynamic) {
    this.preset = UPSCALE_PRESETS[name] ? name : 'quality';
    const p = UPSCALE_PRESETS[this.preset];
    this.baseScale = p.scale;
    this.scale = p.scale;
    this.minScale = Math.max(0.42, p.scale * 0.72);
    this.maxScale = p.scale;
    this.dynamic = dynamic !== false && name !== 'native';
    this.uniforms.sharpen.value = p.sharpen;
    this.uniforms.aa.value = p.aa;
    this.enabled = name !== 'native';
    if (!this.dynamic) this.scale = p.scale;
    this.resize();
  }

  resize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.floor(size.x * (this.enabled ? this.scale : 1)));
    const h = Math.max(2, Math.floor(size.y * (this.enabled ? this.scale : 1)));
    if (this.rt.width !== w || this.rt.height !== h) {
      this.rt.setSize(w, h);
      this.uniforms.texel.value.set(1 / w, 1 / h);
    }
  }

  adapt(dtMs) {
    if (!this.dynamic || !this.enabled) return;
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > 40) this.frameTimes.shift();
    if (this.frameTimes.length < 30) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    let next = this.scale;
    if (avg > this.targetMs * 1.18) next = Math.max(this.minScale, this.scale - 0.035);
    else if (avg < this.targetMs * 0.82) next = Math.min(this.maxScale, this.scale + 0.02);
    if (Math.abs(next - this.scale) > 0.001) {
      this.scale = next;
      this.resize();
    }
  }

  render(scene, camera, overlayScene = null, overlayCamera = null) {
    const renderer = this.renderer;
    const draw = () => {
      renderer.render(scene, camera);
      if (overlayScene && overlayCamera) {
        renderer.clearDepth();
        renderer.render(overlayScene, overlayCamera);
      }
    };
    if (!this.enabled) {
      renderer.setRenderTarget(null);
      renderer.clear();
      draw();
      return;
    }
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    draw();
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(this.postScene, this.postCamera);
  }

  getStatus() {
    return {
      preset: this.preset,
      scale: this.enabled ? this.scale : 1,
      label: this.enabled ? `${Math.round(this.scale * 100)}% · ${UPSCALE_PRESETS[this.preset].label}` : UPSCALE_PRESETS.native.label,
    };
  }
}
