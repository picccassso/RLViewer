import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

/**
 * Unreal bloom that leaves its result in its own texture instead of blending it back over
 * the scene, so the multisampled scene target is written once and never reloaded.
 */
class DetachedBloomPass extends UnrealBloomPass {
  get texture(): THREE.Texture {
    return this.renderTargetsHorizontal[0].texture;
  }

  renderBloom(renderer: THREE.WebGLRenderer, source: THREE.WebGLRenderTarget) {
    const uniforms = this.highPassUniforms as Record<string, THREE.IUniform>;
    uniforms.tDiffuse.value = source.texture;
    uniforms.luminosityThreshold.value = this.threshold;
    this.fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    this.fsQuad.render(renderer);

    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i];
      this.fsQuad.material = blur;
      blur.uniforms.colorTexture.value = input.texture;
      blur.uniforms.direction.value = BLUR_X;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      this.fsQuad.render(renderer);
      blur.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      blur.uniforms.direction.value = BLUR_Y;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      this.fsQuad.render(renderer);
      input = this.renderTargetsVertical[i];
    }

    this.fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    this.fsQuad.render(renderer);
  }
}

/**
 * Renders the scene in HDR, blooms everything brighter than white (goal frames, boost
 * pads, team trims, floodlight glints), then tone maps to the screen.
 *
 * Kept deliberately lean for tile-based GPUs: one multisampled scene target, bloom at CSS
 * resolution (it is a blur, so retina pixels buy nothing), and the bloom is added in the
 * same fullscreen pass that tone maps, instead of being blended back into the scene.
 */
export class PostProcessing {
  private sceneTarget: THREE.WebGLRenderTarget;
  private bloomPass: DetachedBloomPass;
  private outputPass: OutputPass;

  constructor(private renderer: THREE.WebGLRenderer, width: number, height: number) {
    const pixelRatio = renderer.getPixelRatio();
    // Multisampled so edges stay anti-aliased; the canvas itself only receives one fullscreen quad.
    this.sceneTarget = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.bloomPass = new DetachedBloomPass(new THREE.Vector2(width, height), 0.55, 0.45, 0.92);

    this.outputPass = new OutputPass();
    this.outputPass.renderToScreen = true;
    (this.outputPass.uniforms as Record<string, THREE.IUniform>).tBloom = { value: this.bloomPass.texture };
    const material = this.outputPass.material;
    const sample = 'gl_FragColor = texture2D( tDiffuse, vUv );';
    if (!material.fragmentShader.includes(sample)) throw new Error('OutputShader changed; update the bloom composite');
    material.fragmentShader = material.fragmentShader
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D tBloom;')
      .replace(sample, 'gl_FragColor = texture2D( tDiffuse, vUv ) + vec4( texture2D( tBloom, vUv ).rgb, 0.0 );');
  }

  public render(scene: THREE.Scene, camera: THREE.Camera) {
    const { renderer } = this;
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);
    this.bloomPass.renderBloom(renderer, this.sceneTarget);
    // Renders to the screen, so the write buffer argument is unused.
    this.outputPass.render(renderer, this.sceneTarget, this.sceneTarget, 0, false);
  }

  public setSize(width: number, height: number) {
    const pixelRatio = this.renderer.getPixelRatio();
    this.sceneTarget.setSize(width * pixelRatio, height * pixelRatio);
    this.bloomPass.setSize(width, height);
  }

  public dispose() {
    this.sceneTarget.dispose();
    this.bloomPass.dispose();
    this.outputPass.dispose();
  }
}
