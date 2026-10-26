// 두 해상도 합치기. 사무실은 굵은 점(저해상도), 사람은 가는 점(기기 해상도)인데, 서로 가리는 순서와 유리 비침이 맞아야 한다.
// 1) 불투명한 사무실(레이어 0) → 저해상도 타깃(색+깊이)
// 2) 반투명 표면 → 저해상도 타깃 둘(사무실 깊이를 먼저 옮겨 와 뒤에 숨은 것은 빠짐): 유리판(GLASS_LAYER)+윤곽선(LINE_LAYER) 전부,
//    윤곽선만(사람 깊이도 굵은 점으로 먼저 깔아, 사람 뒤 선이 앞 선과 한 칸에 겹쳐 같이 덮이는 일을 줄임)
// 3) 기기 해상도 타깃: 사무실 색+깊이를 최근접으로 깔고 → 사람(FIGURE_LAYER, 그린 점에 스텐실 표시)
//    → 사람 없는 점: 2의 유리+선을 그대로 덮음(굵은 점 모양 유지)
//    → 사람 점: 사람 앞 윤곽선만 덮고, 유리판은 기기 해상도로 한 장씩 사람 깊이와 비교해 그림
//       (유리를 미리 합쳐 두면 깊이는 맨 앞 한 장만 남아, 두 유리 사이에 선 사람에게 뒤 유리까지 덮였다)
// 4) 화면으로 옮기며 색 공간 변환. 섞기는 모두 선형 색(HalfFloat)에서 한다.
import * as THREE from 'three';
import { FIGURE_LAYER, FIGURE_STENCIL } from './sprites/figure.ts';

export const GLASS_LAYER = 2;
export const LINE_LAYER = 3;

/** 투명 재질 물체를 나눈다: 면(유리벽·칸막이 등)은 GLASS_LAYER, 반투명 윤곽선은 LINE_LAYER. 깊이를 쓰게 해 맨 앞 것이 남게 한다 */
export function splitTransparent(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m || Array.isArray(m) || !m.transparent) return;
    m.depthWrite = true;
    n++;
    if ((o as THREE.Line).isLine) {
      o.layers.set(LINE_LAYER);
      return;
    }
    o.layers.set(GLASS_LAYER);
    // 기기 해상도로 다시 그릴 땐 사람 점에만. 스텐실이 없는 저해상도 타깃에선 이 검사가 늘 통과한다
    m.stencilWrite = true;
    m.stencilRef = FIGURE_STENCIL;
    m.stencilFunc = THREE.EqualStencilFunc;
  });
  return n;
}

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

function quadMaterial(fragmentShader: string, extra: Partial<THREE.ShaderMaterialParameters>, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, ...extra });
}

export class PixelPass {
  private readonly office: THREE.WebGLRenderTarget;
  private readonly glass: THREE.WebGLRenderTarget;
  private readonly lines: THREE.WebGLRenderTarget;
  private readonly frame: THREE.WebGLRenderTarget;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly copyColorDepth: THREE.ShaderMaterial;
  private readonly copyDepthOnly: THREE.ShaderMaterial;
  private readonly overGlass: THREE.ShaderMaterial;
  private readonly overLines: THREE.ShaderMaterial;
  private readonly toScreen: THREE.ShaderMaterial;
  /** 바탕색: 타깃을 지울 때마다 다시 지정한다(지정을 빼면 타깃 바탕만 두 번 밝아졌다) */
  private readonly bg: THREE.Color;

  constructor(bg: string) {
    this.bg = new THREE.Color(bg);
    const low = (): THREE.WebGLRenderTarget => {
      const t = new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        type: THREE.HalfFloatType, // 어두운 장면이라 선형 색을 8비트에 담으면 띠가 생긴다
        depthBuffer: true,
      });
      t.depthTexture = new THREE.DepthTexture(1, 1);
      return t;
    };
    this.office = low();
    this.glass = low();
    this.lines = low();
    this.frame = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true });

    const writeAlways = { depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true }; // 늘 쓰되 깊이는 기록(깊이 검사를 끄면 기록도 안 된다)
    this.copyColorDepth = quadMaterial(
      `uniform sampler2D tColor; uniform sampler2D tDepth; varying vec2 vUv;
       void main() { gl_FragColor = texture2D(tColor, vUv); gl_FragDepth = texture2D(tDepth, vUv).x; }`,
      writeAlways,
      { tColor: { value: this.office.texture }, tDepth: { value: this.office.depthTexture } },
    );
    this.copyDepthOnly = quadMaterial(
      `uniform sampler2D tDepth; varying vec2 vUv;
       void main() { gl_FragColor = vec4(0.0); gl_FragDepth = texture2D(tDepth, vUv).x; }`,
      { ...writeAlways, colorWrite: false },
      { tDepth: { value: this.office.depthTexture } },
    );
    // 유리·선 타깃엔 투명한 검정 위에 보통 섞기로 그려 '미리 곱한 알파' 색이 들어 있다 → ONE, ONE_MINUS_SRC_ALPHA로 덮는다
    const over = (target: THREE.WebGLRenderTarget, stencilFunc: THREE.StencilFunc): THREE.ShaderMaterial =>
      quadMaterial(
        `uniform sampler2D tColor; uniform sampler2D tDepth; varying vec2 vUv;
         void main() { vec4 c = texture2D(tColor, vUv); if (c.a <= 0.0) discard; gl_FragColor = c; gl_FragDepth = texture2D(tDepth, vUv).x; }`,
        {
          depthTest: true,
          depthFunc: THREE.LessEqualDepth,
          depthWrite: false,
          transparent: true,
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneMinusSrcAlphaFactor,
          blendSrcAlpha: THREE.OneFactor,
          blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
          stencilWrite: true, // 스텐실 검사를 켜는 스위치(값은 바꾸지 않음)
          stencilRef: FIGURE_STENCIL,
          stencilFunc,
        },
        { tColor: { value: target.texture }, tDepth: { value: target.depthTexture } },
      );
    this.overGlass = over(this.glass, THREE.NotEqualStencilFunc);
    this.overLines = over(this.lines, THREE.EqualStencilFunc);
    this.toScreen = quadMaterial(
      `uniform sampler2D tColor; varying vec2 vUv;
       void main() { gl_FragColor = texture2D(tColor, vUv);
       #include <colorspace_fragment>
       }`,
      { depthTest: false, depthWrite: false },
      { tColor: { value: this.frame.texture } },
    );
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyColorDepth);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** low = 사무실 굵은 점 칸 수, device = 화면 기기 점 수 */
  setSize(lowW: number, lowH: number, deviceW: number, deviceH: number): void {
    const lw = Math.max(1, Math.round(lowW));
    const lh = Math.max(1, Math.round(lowH));
    this.office.setSize(lw, lh);
    this.glass.setSize(lw, lh);
    this.lines.setSize(lw, lh);
    this.frame.setSize(Math.max(1, Math.round(deviceW)), Math.max(1, Math.round(deviceH)));
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    renderer.autoClear = false;
    const quad = (m: THREE.ShaderMaterial) => {
      this.quad.material = m;
      renderer.render(this.quadScene, this.quadCamera);
    };
    // 1) 불투명 사무실
    renderer.shadowMap.needsUpdate = true; // 그림자는 사무실 그릴 때 한 번만
    camera.layers.set(0);
    renderer.setRenderTarget(this.office);
    renderer.setClearColor(this.bg, 1);
    renderer.clear();
    renderer.render(scene, camera);
    // 2) 유리+선, 선만: 사무실 깊이를 먼저 옮겨 와 가구 뒤 것은 빠지게
    const lowTransparent = (target: THREE.WebGLRenderTarget, forFigures: boolean) => {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      quad(this.copyDepthOnly);
      if (forFigures) {
        camera.layers.set(FIGURE_LAYER);
        renderer.render(scene, camera);
        renderer.clear(true, false, false); // 사람 색은 지우고 깊이만 남김
      }
      camera.layers.set(LINE_LAYER);
      if (!forFigures) camera.layers.enable(GLASS_LAYER);
      renderer.render(scene, camera);
    };
    lowTransparent(this.glass, false);
    lowTransparent(this.lines, true);
    // 3) 기기 해상도: 사무실 → 사람 → (사람 없는 점) 유리+선 / (사람 점) 선 → 유리판
    renderer.setRenderTarget(this.frame);
    renderer.setClearColor(this.bg, 1);
    renderer.clear();
    quad(this.copyColorDepth);
    camera.layers.set(FIGURE_LAYER);
    renderer.render(scene, camera);
    quad(this.overGlass);
    quad(this.overLines);
    camera.layers.set(GLASS_LAYER);
    renderer.render(scene, camera);
    // 4) 화면
    renderer.setRenderTarget(null);
    renderer.clear();
    quad(this.toScreen);
    camera.layers.set(0);
    camera.layers.enable(FIGURE_LAYER);
  }

  dispose(): void {
    this.office.dispose();
    this.glass.dispose();
    this.lines.dispose();
    this.frame.dispose();
    this.quad.geometry.dispose();
    for (const m of [this.copyColorDepth, this.copyDepthOnly, this.overGlass, this.overLines, this.toScreen]) m.dispose();
  }
}
