// 두 해상도 합치기: 사무실(레이어 0)은 저해상도 타깃(굵은 점)에 깊이와 함께 그리고, 화면에 최근접으로 키워 깔면서 깊이도 옮겨 적는다.
// 그 위에 사람(FIGURE_LAYER)을 기기 해상도로 그리면 가는 점 사람과 굵은 점 가구가 서로 가리는 순서가 맞는다.
import * as THREE from 'three';
import { FIGURE_LAYER } from './sprites/figure.ts';

export class PixelPass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** 바탕색: 타깃을 지울 때마다 다시 지정한다(지정을 빼면 타깃 바탕만 두 번 밝아졌다) */
  private readonly bg: THREE.Color;

  constructor(bg: string) {
    this.bg = new THREE.Color(bg);
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType, // 어두운 장면이라 선형 색을 8비트에 담으면 띠가 생긴다
      depthBuffer: true,
    });
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.target.texture }, tDepth: { value: this.target.depthTexture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(tColor, vUv);
          gl_FragDepth = texture2D(tDepth, vUv).x;
          #include <colorspace_fragment>
        }`,
      depthTest: true,
      depthFunc: THREE.AlwaysDepth, // 늘 쓰되 깊이는 기록(깊이 검사를 끄면 기록도 안 된다)
      depthWrite: true,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** 사무실 타깃 크기(굵은 점 칸 수) */
  setSize(w: number, h: number): void {
    this.target.setSize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    renderer.autoClear = false;
    renderer.shadowMap.needsUpdate = true; // 그림자는 사무실 그릴 때 한 번만
    camera.layers.set(0);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(this.bg);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(this.bg);
    renderer.clear();
    renderer.render(this.quadScene, this.quadCamera);
    camera.layers.set(FIGURE_LAYER);
    renderer.render(scene, camera);
    camera.layers.set(0);
    camera.layers.enable(FIGURE_LAYER);
  }

  dispose(): void {
    this.target.dispose();
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
  }
}
