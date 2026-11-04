// La scène : le Léman et les Alpes en relief (images swisstopo et Sentinel-2), et le campus tel
// qu'il est : les bâtiments de swissBUILDINGS3D, le Rolex Learning Center avec son vrai toit et
// ses patios, les arbres de la végétation 3D de swisstopo. À l'ouverture, la caméra descend du
// ciel jusqu'au bâtiment et en fait le tour ; ensuite le défilement la promène.
//
// Sobriété : on ne dessine que quand quelque chose bouge ; pendant un mouvement l'image est
// calculée en définition réduite, puis une image nette à l'arrêt. Les ombres sont figées
// (le soleil ne bouge pas), recalculées seulement quand le bâtiment change.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeVertices, mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const canvas = document.getElementById("slab");
const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = matchMedia("(max-width: 760px)").matches;
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
} catch {
  root.classList.add("no-webgl", "intro-done");
  throw new Error("WebGL indisponible");
}
const DPR_HI = Math.min(devicePixelRatio, 2);
let DPR_LO = Math.min(devicePixelRatio, small ? 1 : 1.25);
let dprNow = DPR_HI;
renderer.setPixelRatio(dprNow);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const shadowsDirty = () => { renderer.shadowMap.needsUpdate = true; };

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400000);
// Les appareils ont leur propre scène, dessinée par-dessus : un mur ou un arbre ne les cache jamais.
const deviceScene = new THREE.Scene();
const devCam = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
deviceScene.add(devCam);

let running = false;
function wake() {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
}

// Une unité = 6 m. Le relief est un peu exagéré pour que les Alpes se lisent de loin.
const UNIT = 6, EXAG = 1.3;
const LAKE = (372 - 394.2) / UNIT * EXAG;

// ==========================================================================================
// Ciel (pour les reflets ; le ciel visible est le dégradé CSS derrière le canevas) et lumière
// ==========================================================================================
const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene();
const sky = new Sky();
sky.scale.setScalar(1000);
skyScene.add(sky);
const skyU = sky.material.uniforms;
let envRT = null;

const sun = new THREE.DirectionalLight("#fff3e2", 3);
sun.castShadow = true;
sun.shadow.mapSize.set(small ? 2048 : 4096, small ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 62, bottom: -62, near: 1, far: 300 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight("#fbf4e8", "#8a8272", 0.5);
scene.add(hemi);
const key = new THREE.DirectionalLight("#ffffff", 1.4);
key.position.set(-2, 3, 4);
devCam.add(key);
const devFill = new THREE.HemisphereLight("#ffffff", "#8a877f", 0.9);
deviceScene.add(devFill);
const SUN = { el: 31, az: 222 };
{
  const d = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN.el), THREE.MathUtils.degToRad(SUN.az));
  sun.position.copy(d).multiplyScalar(150);
  sun.position.z *= -1;
  sun.target.position.set(0, 0, 0);
}

// ==========================================================================================
// Le terrain : trois couches cuites (geo/), du Léman entier au campus
// ==========================================================================================
// La photo du campus à 0,2 m par pixel (geo/campus-photo), posée sur le sol quand elle arrive.
const hiPhoto = { value: null }, hiBox = { value: new THREE.Vector4(0, 0, 1, 1) }, hasHi = { value: 0 };
function terrainMaterial(tex, opts) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, transparent: opts.fade > 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHole = { value: opts.hole ?? new THREE.Vector4(0, 0, 0, 0) };
    shader.uniforms.uFade = { value: opts.fade };
    shader.uniforms.uGain = { value: opts.gain ?? 1 };
    shader.uniforms.uWater = water;
    shader.uniforms.uHi = hiPhoto;
    shader.uniforms.uHiBox = hiBox;
    shader.uniforms.uHasHi = opts.hi ? hasHi : { value: 0 };
    shader.uniforms.uLake = { value: opts.lakeMask ?? null };
    shader.uniforms.uHasLake = { value: opts.lakeMask ? 1 : 0 };
    shader.uniforms.uLakeY = { value: LAKE + 0.05 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;\nvarying vec2 vUvT;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUvT = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;\nvarying vec2 vUvT;\nuniform vec4 uHole;\nuniform float uFade;\nuniform float uGain;\nuniform vec3 uWater;\nuniform float uLakeY;\nuniform sampler2D uLake;\nuniform float uHasLake;\nuniform sampler2D uHi;\nuniform vec4 uHiBox;\nuniform float uHasHi;\nfloat gWet = 0.0;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        if (uHole.z > 0.0 && abs(vWorld.x - uHole.x) < uHole.z && abs(vWorld.z - uHole.y) < uHole.w) discard;`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        if (uHasHi > 0.5) {
          vec2 hu = (vec2(vWorld.x, -vWorld.z) - uHiBox.xy) / (uHiBox.zw - uHiBox.xy);
          float he = min(min(hu.x, 1.0 - hu.x), min(hu.y, 1.0 - hu.y));
          if (he > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uHi, hu).rgb, smoothstep(0.0, 0.05, he));
        }
        diffuseColor.rgb *= uGain;
        // Le lac : là où le relief est au niveau de l'eau. Une teinte unie, de longues rides douces.
        float wet = uHasLake > 0.5 ? smoothstep(0.3, 0.7, texture2D(uLake, vUvT).r) : 0.0;
        float ripple = sin(vWorld.x * 0.011 + vWorld.z * 0.004) * sin(vWorld.z * 0.013 - vWorld.x * 0.003);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWater * (1.0 + 0.05 * ripple), wet);
        gWet = wet;
        if (uFade > 0.0) {
          float edge = min(min(vUvT.x, 1.0 - vUvT.x), min(vUvT.y, 1.0 - vUvT.y));
          diffuseColor.a *= smoothstep(0.0, uFade, edge);
        }`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, gWet);");
  };
  return m;
}
function terrainMesh(layer, heights, tex, opts) {
  const size = layer.size / UNIT, g = layer.grid;
  const geo = new THREE.PlaneGeometry(size, size, g - 1, g - 1);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const u = x / size + 0.5, v = 0.5 - z / size;
    const col = Math.round(u * (g - 1)), row = Math.round(v * (g - 1));
    let h = heights[row * g + col] / UNIT * EXAG;
    if (opts.lake) h = Math.max(h, LAKE);
    if (opts.sink) {
      const e = Math.min(u, 1 - u, v, 1 - v), f = Math.min(1, e / 0.14);
      h = THREE.MathUtils.lerp(LAKE - 3, h, f * f * (3 - 2 * f));
    }
    p.setY(i, h + (opts.lift ?? 0));
    uv.setXY(i, u, 1 - v);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, terrainMaterial(tex, opts));
  mesh.position.set(layer.cx / UNIT, 0, layer.cz / UNIT);
  mesh.renderOrder = opts.order ?? 0;
  return mesh;
}
const loader = new THREE.TextureLoader();
function loadTex(url) {
  return new Promise((resolve, reject) => loader.load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    resolve(t);
  }, undefined, reject));
}
const loadBin = (url, Type) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); }).then((b) => new Type(b));

const water = { value: new THREE.Color("#4f6f84") };
const plainMat = new THREE.MeshBasicMaterial({ color: "#93a7b0" });
const plain = new THREE.Mesh(new THREE.CircleGeometry(125000, 96), plainMat);
plain.rotation.x = -Math.PI / 2;
plain.position.y = LAKE - 3.2;
scene.add(plain);


// ==========================================================================================
// Le campus : la géométrie réelle de swissBUILDINGS3D (swisstopo). Chaque sommet porte le haut et
// le pied de sa verticale, ce qui permet de dessiner les façades dans le shader :
//  · le Rolex Learning Center a sa vraie coupe, du toit vers le bas : rive blanche, verre et
//    montants, dalle de béton, puis le vide sous les arches ;
//  · les autres bâtiments, un enduit et des fenêtres d'étage en étage, qui s'effacent au loin ;
//  · leurs toits portent la photo aérienne à 0,2 m par pixel.
// Les arbres : positions et hauteurs réelles (végétation 3D de swisstopo).
// ==========================================================================================
// Le repère des données a le nord en +z ; la scène three.js veut le sud en +z : tout le décor vit
// dans ce groupe retourné (sinon la carte serait vue en miroir).
const world = new THREE.Group();
world.scale.z = -1;
scene.add(world);
const flipZ = (p) => [p[0], p[1], -p[2]];

const campus = new THREE.Group();
world.add(campus);
const RLC = { x0: -12.3, x1: 17.5, z0: -11.2, z1: 11.4 };
const night = { value: 0 };
const nearPhoto = { value: null }, nearBox = { value: new THREE.Vector4(0, 0, 1, 0) };
const wallTone = { value: new THREE.Color("#e7e3da") };
const roofTone = { value: new THREE.Color("#d8d6d0") };
const campusMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, side: THREE.DoubleSide });
campusMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, { uNight: night, uNear: nearPhoto, uNearBox: nearBox, uHi: hiPhoto, uHiBox: hiBox, uHasHi: hasHi, uWall: wallTone, uRoof: roofTone });
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vLocal;\nvarying vec3 vUp;\nvarying vec2 vSpan;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;\nvUp = normal;\nvSpan = uv;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
      varying vec3 vLocal;
      varying vec3 vUp;
      varying vec2 vSpan;
      uniform float uNight, uHasHi;
      uniform sampler2D uNear, uHi;
      uniform vec4 uNearBox, uHiBox;
      uniform vec3 uWall, uRoof;
      float gGlass = 0.0, gGloss = 0.0, gLit = 0.0;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float band(float t, float a, float b, float w) { return smoothstep(a - w, a + w, t) * (1.0 - smoothstep(b - w, b + w, t)); }`)
    .replace("#include <color_fragment>", `#include <color_fragment>
      vec3 up = normalize(vUp);
      float roof = smoothstep(0.42, 0.62, abs(up.y));
      bool inRlc = vLocal.x > ${RLC.x0.toFixed(1)} && vLocal.x < ${RLC.x1.toFixed(1)} && vLocal.z > ${RLC.z0.toFixed(1)} && vLocal.z < ${RLC.z1.toFixed(1)};
      float below = vSpan.x - vLocal.y, above = vLocal.y - vSpan.y;
      float run = abs(up.x) > abs(up.z) ? vLocal.z : vLocal.x;
      float wr = fwidth(run), wy = fwidth(vLocal.y);
      vec3 wall;
      vec3 top;
      if (inRlc) {
        // Le toit : une membrane claire, posée en lés ; seuls le relief et les ombres le dessinent.
        vec2 p = mat2(0.94, -0.34, 0.34, 0.94) * vLocal.xz;
        float wp = fwidth(p.x) + fwidth(p.y);
        float seam = 1.0 - smoothstep(0.0, 0.012 + wp, abs(fract(p.x / 0.5) - 0.5) * 0.5);
        seam *= 1.0 - smoothstep(0.04, 0.12, wp);
        float lay = hash(vec2(floor(p.x / 0.5), floor(p.y / 2.4)));
        top = uRoof * (0.975 + 0.05 * lay) * (1.0 - 0.1 * seam);
        // La façade, du toit vers le bas.
        float mull = 1.0 - smoothstep(0.016, 0.016 + wr, abs(fract(run / 0.25) - 0.5) * 0.25);
        mull *= 1.0 - smoothstep(0.05, 0.14, wr);
        float isGlass = band(below, 0.06, 0.62, wy);
        float isSlab = band(below, 0.62, 0.8, wy);
        vec3 glass = mix(vec3(0.15, 0.2, 0.24), vec3(0.3, 0.33, 0.33), smoothstep(0.62, 0.1, below));
        wall = uRoof * 0.98;
        wall = mix(wall, mix(glass, vec3(0.8), mull), isGlass);
        wall = mix(wall, uRoof * 0.8, isSlab);
        wall = mix(wall, vec3(0.1, 0.105, 0.11), step(0.8, below));
        gGlass = isGlass * (1.0 - mull);
        gGloss = gGlass;
        gLit = gGlass * uNight;
      } else {
        vec2 hu = (vec2(vLocal.x, vLocal.z) - uHiBox.xy) / (uHiBox.zw - uHiBox.xy);
        bool hi = uHasHi > 0.5 && min(min(hu.x, 1.0 - hu.x), min(hu.y, 1.0 - hu.y)) > 0.0;
        vec2 nu = (vLocal.xz - uNearBox.xy) / uNearBox.z + 0.5;
        top = hi ? texture2D(uHi, hu).rgb : texture2D(uNear, nu).rgb;
        top = mix(top, vec3(dot(top, vec3(0.333))), 0.12);
        // Une teinte par bâtiment, tirée de son pied.
        float tint = hash(vec2(floor(vSpan.y * 40.0), 3.0));
        vec3 skin = uWall * mix(vec3(0.86, 0.85, 0.83), vec3(1.0, 0.985, 0.95), tint);
        vec3 pane = vec3(0.2, 0.25, 0.29);
        float lvl = above / 0.55;
        float col = run / 0.42;
        float win = band(fract(lvl), 0.3, 0.82, fwidth(lvl)) * band(fract(col), 0.14, 0.86, fwidth(col));
        float detail = 1.0 - smoothstep(0.035, 0.1, max(wr, wy));
        win *= detail * step(0.35, above);
        vec3 far = mix(skin, pane, 0.2);
        wall = mix(mix(far, skin, detail), pane, win);
        gGlass = win;
        gGloss = win * 0.7;
        gLit = win * step(0.55, hash(vec2(floor(col), floor(lvl)) + floor(vSpan.y * 40.0))) * uNight;
      }
      diffuseColor.rgb = mix(wall, top, roof);
      gGlass *= 1.0 - roof; gGloss *= 1.0 - roof; gLit *= 1.0 - roof;`)
    .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, gGloss);")
    .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.75, gGloss);")
    .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * gLit * 1.3;");
};
const draco = new DRACOLoader().setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/");
const buildingsReady = new Promise((resolve, reject) => draco.load("geo/campus.drc", (geo) => {
  const mesh = new THREE.Mesh(geo, campusMat);
  mesh.castShadow = mesh.receiveShadow = true;
  campus.add(mesh);
  draco.dispose();
  shadowsDirty();
  wake();
  resolve(true);
}, undefined, reject));

// Les arbres : un tronc et une couronne de plusieurs masses, à la taille réelle de chacun. Trois
// niveaux de détail : le feuillage complet près du bâtiment, une boule irrégulière au loin.
const crownMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 });
crownMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vLeaf;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLeaf = position;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
      varying vec3 vLeaf;
      float leaves(vec3 p) { return sin(p.x + sin(p.y * 0.83) * 1.7) * sin(p.y + sin(p.z * 0.77) * 1.9) * sin(p.z + sin(p.x * 0.71) * 1.3); }`)
    .replace("#include <color_fragment>", `#include <color_fragment>
      float clump = leaves(vLeaf * 9.0) * 0.6 + leaves(vLeaf * 23.0) * 0.4;
      diffuseColor.rgb *= (0.8 + 0.42 * clump) * mix(0.42, 1.18, smoothstep(-0.75, 0.85, vLeaf.y));`);
};
const trunkMat = new THREE.MeshStandardMaterial({ color: "#4f4034", roughness: 0.95 });
let seed = 17;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
function crownGeometry(detail, lobes) {
  const parts = lobes.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v3.fromBufferAttribute(p, i);
      const k = 1 + 0.1 * Math.sin(v3.x * 11 + z * 9) * Math.cos(v3.z * 9 + x * 7) + 0.06 * Math.sin(v3.y * 19 + x * 5);
      p.setXYZ(i, v3.x * k + x, v3.y * k + y, v3.z * k + z);
    }
    return g;
  });
  const geo = mergeVertices(mergeGeometries(parts), 1e-4);
  geo.computeVertexNormals();
  return geo;
}
const LOBES = [[0, 0.12, 0, 0.72], [0.46, -0.08, 0.16, 0.52], [-0.42, -0.04, 0.3, 0.54], [0.08, -0.06, -0.48, 0.54], [-0.3, 0.1, -0.34, 0.46], [0.34, 0.2, -0.26, 0.44], [-0.1, 0.52, 0.02, 0.46], [0.2, 0.42, 0.28, 0.4]];
const treesReady = loadBin("geo/trees.bin", Float32Array).then((a) => {
  const n = a.length / 4;
  const tiers = [
    { within: 46, geo: crownGeometry(small ? 1 : 2, LOBES), list: [] },
    { within: 80, geo: crownGeometry(1, LOBES), list: [] },
    { within: Infinity, geo: crownGeometry(1, [[0, 0, 0, 0.98]]), list: [] },
  ];
  for (let i = 0; i < n; i++) tiers.find((t) => Math.hypot(a[i * 4], a[i * 4 + 1]) < t.within).list.push(i);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.06, 1, 6), trunkMat, tiers[0].list.length + tiers[1].list.length);
  const color = new THREE.Color();
  let t = 0;
  for (const [level, tier] of tiers.entries()) {
    const crowns = new THREE.InstancedMesh(tier.geo, crownMat, tier.list.length);
    tier.list.forEach((i, k) => {
      const x = a[i * 4], z = a[i * 4 + 1], base = a[i * 4 + 2], h = Math.max(0.7, a[i * 4 + 3]);
      const r = h * (0.33 + rand() * 0.08), squash = 0.92 + rand() * 0.22;
      q.setFromAxisAngle(up, rand() * 6.28);
      crowns.setMatrixAt(k, m4.compose(v3.set(x, base + h - r * squash * 0.86, z), q, s3.set(r, r * squash, r)));
      color.setHSL(0.235 + rand() * 0.06, 0.3 + rand() * 0.14, 0.19 + rand() * 0.08);
      crowns.setColorAt(k, color);
      if (level < 2) trunks.setMatrixAt(t++, m4.compose(v3.set(x, base + h * 0.3, z), q, s3.set(h * 0.8, h * 0.6, h * 0.8)));
    });
    crowns.castShadow = true;
    crowns.receiveShadow = level < 2;
    campus.add(crowns);
  }
  trunks.castShadow = true;
  campus.add(trunks);
  shadowsDirty();
  wake();
});

const groundReady = (async () => {
  const meta = await (await fetch("geo/meta.json")).json();
  const L = meta.layers;
  const [farH, midH, nearH, farT, midT, nearT] = await Promise.all([
    loadBin("geo/far.bin", Int16Array), loadBin("geo/mid.bin", Int16Array), loadBin("geo/near.bin", Int16Array),
    loadTex("geo/far.webp"), loadTex("geo/mid.webp"), loadTex("geo/near.webp"),
  ]);
  const [farLake, midLake] = await Promise.all([loadTex("geo/far-lake.png"), loadTex("geo/mid-lake.png")]);
  for (const t of [farLake, midLake]) t.colorSpace = THREE.NoColorSpace;
  const inner = (layer, margin) => new THREE.Vector4(layer.cx / UNIT, -layer.cz / UNIT, layer.size / UNIT / 2 * (1 - margin), layer.size / UNIT / 2 * (1 - margin));
  nearPhoto.value = nearT;
  nearBox.value.set(L.near.cx / UNIT, L.near.cz / UNIT, L.near.size / UNIT, 0);
  if (!small) Promise.all([loadTex("geo/campus-photo.webp"), fetch("geo/campus-photo.json").then((r) => r.json())]).then(([t, b]) => {
    hiPhoto.value = t;
    hiBox.value.set(b.x0, b.z0, b.x1, b.z1);
    hasHi.value = 1;
    wake();
  }).catch(() => {});
  world.add(terrainMesh(L.far, farH, farT, { fade: 0.16, hole: inner(L.mid, 0.36), lake: true, sink: true, lakeMask: farLake }));
  world.add(terrainMesh(L.mid, midH, midT, { fade: 0.18, hole: inner(L.near, 0.3), lake: true, order: 1, lift: 0.05, gain: 0.84, lakeMask: midLake }));
  const near = terrainMesh(L.near, nearH, nearT, { fade: 0.15, order: 2, lift: 0.08, gain: 0.86, hi: true });
  near.receiveShadow = true;
  world.add(near);
  shadowsDirty();
  return true;
})();

// ==========================================================================================
// Les appareils : l'app telle qu'elle est (captures avec des données d'exemple)
// ==========================================================================================
const shots = {};
function shot(name) {
  if (shots[name]) return shots[name];
  const t = loader.load(`shots/${name}.webp`, () => wake());
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return (shots[name] = t);
}
function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  return s;
}
function planeUV(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox, p = geo.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) uv.push((p.getX(i) - b.min.x) / (b.max.x - b.min.x), (p.getY(i) - b.min.y) / (b.max.y - b.min.y));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}
const coverGlass = new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.03, metalness: 0, transparent: true, opacity: 0.06, clearcoat: 1, envMapIntensity: 2.5 });
function screenPair(w, h, r, z, parent) {
  const geo = planeUV(new THREE.ShapeGeometry(roundedRect(w, h, r), 24));
  const a = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }));
  const b = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0 }));
  const g = new THREE.Mesh(geo, coverGlass);
  a.position.z = z; b.position.z = z + 0.0004; g.position.z = z + 0.0012;
  parent.add(a, b, g);
  return { a, b, g, current: null, fade: 1 };
}
function showScreen(pair, name) {
  if (pair.current === name) return;
  if (pair.current === null) { pair.a.material.map = shot(name); pair.a.material.needsUpdate = true; pair.current = name; return; }
  pair.b.material.map = shot(name); pair.b.material.needsUpdate = true; pair.b.material.opacity = 0;
  pair.current = name; pair.fade = 0;
}
function stepScreen(pair, k) {
  if (pair.fade >= 1) return false;
  pair.fade = Math.min(1, pair.fade + k * 1.6 + 0.02);
  pair.b.material.opacity = pair.fade;
  if (pair.fade >= 1) { pair.a.material.map = pair.b.material.map; pair.a.material.needsUpdate = true; pair.b.material.opacity = 0; }
  return true;
}

const titanium = new THREE.MeshPhysicalMaterial({ color: "#a8a196", metalness: 1, roughness: 0.26, clearcoat: 0.5, envMapIntensity: 1.8 });
const blackGlass = new THREE.MeshPhysicalMaterial({ color: "#050506", roughness: 0.06, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.4 });
const backGlass = new THREE.MeshPhysicalMaterial({ color: "#bdb6aa", roughness: 0.42, metalness: 0.1, clearcoat: 0.8, envMapIntensity: 1.2 });
const lensMat = new THREE.MeshPhysicalMaterial({ color: "#0a0b0f", roughness: 0.04, metalness: 0.6, clearcoat: 1, envMapIntensity: 2 });
const phone = new THREE.Group();
const PW = 0.716, PH = 1.47, PR = 0.112, PD = 0.05, BEV = 0.012;
{
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(PW - 2 * BEV, PH - 2 * BEV, PR - BEV), {
    depth: PD, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 6, curveSegments: 28,
  }), titanium);
  body.position.z = -PD / 2;
  phone.add(body);
  const face = (mat, zz, flip) => {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(PW - 0.004, PH - 0.004, PR - 0.002), 28), mat);
    m.position.z = zz; if (flip) m.rotation.y = Math.PI;
    return m;
  };
  phone.add(face(blackGlass, PD / 2 + BEV + 0.0006), face(backGlass, -PD / 2 - BEV - 0.0006, true));
  const island = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(0.205, 0.06, 0.03), 16), blackGlass);
  island.position.set(0, PH / 2 - 0.066, PD / 2 + BEV + 0.0035);
  phone.add(island);
  const plateau = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(0.3, 0.3, 0.07), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 16 }), backGlass);
  plateau.position.set(-(PW / 2 - 0.2), PH / 2 - 0.2, -PD / 2 - BEV - 0.012);
  phone.add(plateau);
  for (const [dx, dy] of [[-0.065, 0.065], [-0.065, -0.065], [0.065, 0]]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.018, 40), titanium);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(-(PW / 2 - 0.2) + dx, PH / 2 - 0.2 + dy, -PD / 2 - BEV - 0.022);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.02, 40), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(ring.position.x, ring.position.y, ring.position.z - 0.002);
    phone.add(ring, lens);
  }
  for (const [y, h, side] of [[0.3, 0.07, -1], [0.17, 0.12, -1], [0.02, 0.12, -1], [0.18, 0.22, 1], [-0.2, 0.13, 1]]) {
    const btn = new THREE.Mesh(new RoundedBoxGeometry(0.014, h, 0.026, 2, 0.006), titanium);
    btn.position.set(side * (PW / 2 + 0.004), y, 0);
    phone.add(btn);
  }
}
const phoneScreen = screenPair(PW - 0.05, PH - 0.05, PR - 0.022, PD / 2 + BEV + 0.0012, phone);
devCam.add(phone);


// ==========================================================================================
// Thème : le jour, ou l'heure bleue (le bâtiment éclairé de l'intérieur)
// ==========================================================================================
function applyTheme() {
  const dark = darkQuery.matches;
  skyU.turbidity.value = dark ? 2 : 3.2;
  skyU.rayleigh.value = dark ? 2.6 : 2.1;
  skyU.mieCoefficient.value = 0.004;
  skyU.mieDirectionalG.value = 0.82;
  const d = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - (dark ? -1.2 : SUN.el)), THREE.MathUtils.degToRad(SUN.az));
  skyU.sunPosition.value.copy(d);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(skyScene);
  scene.environment = envRT.texture;
  deviceScene.environment = envRT.texture;
  scene.environmentIntensity = dark ? 0.45 : 0.32;
  renderer.toneMappingExposure = dark ? 0.8 : 0.62;
  scene.fog = new THREE.FogExp2(dark ? "#1b2433" : "#a8bac3", 0.00005);
  plainMat.color.set(dark ? "#10161c" : "#93a7b0");
  night.value = dark ? 1 : 0;
  wallTone.value.set(dark ? "#8a8d92" : "#e7e3da");
  roofTone.value.set(dark ? "#8f9298" : "#d8d6d0");
  water.value.set(dark ? "#16222f" : "#4f6f84");
  sun.color.set(dark ? "#8fa8d0" : "#fff3e2");
  sun.intensity = dark ? 1.6 : 3.8;
  hemi.intensity = dark ? 1.1 : 0.55;
  key.intensity = dark ? 1.0 : 1.4;
  shadowsDirty();
}

// ==========================================================================================
// Le parcours : un arrêt par section (data-cam)
// ==========================================================================================
const D = (x, y, d, ry, rx, screen, on = 1) => ({ x, y, d, ry, rx, screen, on });
const OFF_PHONE = D(0.45, -1.6, 5.4, -0.3, 0.2, null, 0);
const STOPS = {
  hero: { pos: [-20, 6.5, 21], look: [10, 10.8, -13], shift: 0.1, phone: D(0.66, -0.1, 5.8, -0.5, 0.06, "iphone-today") },
  today: { pos: [-30, 9, 26], look: [4, 2, 0], shift: -0.14, phone: OFF_PHONE },
  import: { pos: [32, 8, 22], look: [2, 2, 0], shift: 0.14, phone: OFF_PHONE },
  etude: { pos: [-27, 5, 15], look: [6, 2.4, 0], shift: -0.14, phone: OFF_PHONE },
  hours: { pos: [-20, 30, 34], look: [2, 0, -6], shift: 0.14, phone: OFF_PHONE },
  groups: { pos: [30, 9, -24], look: [2, 2, 0], shift: -0.14, phone: OFF_PHONE },
  everywhere: { pos: [-26, 13, -30], look: [4, 3, 2], shift: 0.14, phone: D(-0.62, -0.08, 5.6, 0.48, 0.06, "iphone-today") },
  plan: { pos: [0.01, 58, 9], look: [2.6, 0, -1], shift: 0, phone: OFF_PHONE },
};
for (const s of Object.values(STOPS)) { s.pos = flipZ(s.pos); s.look = flipZ(s.look); }
const INSIDE = new Set(["hero"]);
const sections = [...document.querySelectorAll("[data-cam]")];
let centers = [];
const measure = () => { centers = sections.map((s) => { const r = s.getBoundingClientRect(); return r.top + scrollY + r.height / 2; }); };
const camPos = new THREE.Vector3(...STOPS.hero.pos), camLook = new THREE.Vector3(...STOPS.hero.look);
const wantPos = camPos.clone(), wantLook = camLook.clone();
let shiftNow = STOPS.hero.shift, shiftWant = shiftNow, liftNow = 0, liftWant = 0;
const devState = { phone: { ...STOPS.hero.phone } };
const devWant = { phone: { ...STOPS.hero.phone } };
const ease = (t) => t * t * (3 - 2 * t);
const portrait = () => camera.aspect < 1.05;

function scrollTarget() {
  if (!centers.length) measure();
  const mid = scrollY + innerHeight * 0.5;
  let i = 0;
  while (i < centers.length - 1 && mid > centers[i + 1]) i++;
  const j = Math.min(i + 1, sections.length - 1);
  const ia = sections[i].dataset.cam, ib = sections[j].dataset.cam;
  const A = STOPS[ia], B = STOPS[ib];
  const t = i === j ? 0 : ease(Math.min(1, Math.max(0, (mid - centers[i]) / (centers[j] - centers[i]))));
  const lerp = (a, b) => a + (b - a) * t;
  wantPos.set(lerp(A.pos[0], B.pos[0]), lerp(A.pos[1], B.pos[1]), lerp(A.pos[2], B.pos[2]));
  wantLook.set(lerp(A.look[0], B.look[0]), lerp(A.look[1], B.look[1]), lerp(A.look[2], B.look[2]));
  // En portrait, reculer (sauf à l'intérieur, où l'on finirait dans le mur).
  if (portrait() && !INSIDE.has(ia) && !INSIDE.has(ib)) wantPos.sub(wantLook).multiplyScalar(1.5).add(wantLook);
  shiftWant = portrait() ? 0 : lerp(A.shift, B.shift);
  liftWant = portrait() ? 0.2 : 0;
  const heroWeight = (ia === "hero" ? 1 - t : 0) + (ib === "hero" ? t : 0);
  {
    const a = A.phone, b = B.phone, w = devWant.phone;
    for (const k of ["x", "y", "d", "ry", "rx", "on"]) w[k] = lerp(a[k], b[k]);
    w.screen = (t < 0.5 ? a.screen : b.screen) ?? a.screen ?? b.screen;
    if (portrait()) Object.assign(w, { x: 0.3, y: 0.64, d: 13.5, ry: -0.36, rx: 0.08, on: heroWeight, screen: "iphone-today" });
  }
}

// ==========================================================================================
// L'intro : le Léman vu d'en haut, la rive, le campus, le bâtiment qui se lève, le tour
// ==========================================================================================
const INTRO = {
  pos: [[-2600, 8000, -1740], [-6400, 3100, 1700], [-2300, 640, 760], [-260, 150, 230], [36, 22, 34], [31, 12, -42], [-52, 15, -34], [-30, 17, 26]],
  look: [[-2600, 0, -1800], [-1800, 0, -2300], [200, 0, -480], [0, 0, -5], [0, 0.6, -2], [0, 0.8, 0], [0, 0.8, 0], [0, 0.6, -2]],
  duration: 14,
  beats: [
    { at: 0, coords: "46,43° N · 6,52° E", place: "Lac Léman" },
    { at: 0.3, coords: "46,52° N · 6,57° E", place: "Ecublens" },
    { at: 0.47, coords: "46,5184° N · 6,5681° E", place: "Rolex Learning Center" },
  ],
};
const introPos = new THREE.CatmullRomCurve3(INTRO.pos.map((p) => new THREE.Vector3(...flipZ(p))), false, "centripetal");
const introLook = new THREE.CatmullRomCurve3(INTRO.look.map((p) => new THREE.Vector3(...flipZ(p))), false, "centripetal");
const intro = { active: !reduced, t: 0, speed: 1, started: false, beat: -1 };
const band01 = (u, a, b) => Math.min(1, Math.max(0, (u - a) / (b - a)));
// Un temps qui tient d'abord la vue d'en haut, accélère, puis ralentit autour du bâtiment.
const introEase = (t) => {
  const h = band01(t, 0.06, 1);
  return h < 0.5 ? 2 * h * h : 1 - (-2 * h + 2) ** 2 / 2;
};
function skipIntro() {
  if (intro.active && intro.started) intro.speed = Math.max(intro.speed, (INTRO.duration * (1 - intro.t)) / 0.8);
  // Défiler avant que l'intro ait commencé : on s'en passe.
  else if (intro.active && !intro.started && scrollY > 40) { intro.active = false; finishInstantly(); }
}
for (const type of ["wheel", "touchstart", "keydown"]) addEventListener(type, skipIntro, { passive: true });
document.querySelector("[data-skip-intro]")?.addEventListener("click", skipIntro);
const card = document.querySelector(".intro-card");
const cardCoords = card?.querySelector(".coords"), cardPlace = card?.querySelector(".place");

function introFrame(dt) {
  intro.t = Math.min(1, intro.t + (dt * intro.speed) / INTRO.duration);
  const u = introEase(intro.t);
  const p = introPos.getPoint(u), l = introLook.getPoint(u);
  const tail = band01(u, 0.88, 1);
  camPos.copy(p).lerp(wantPos, ease(tail));
  camLook.copy(l).lerp(wantLook, ease(tail));
  shiftNow = shiftWant * ease(band01(u, 0.9, 1));
  liftNow = liftWant * ease(band01(u, 0.9, 1));
  const rise = Math.max(0.02, ease(band01(u, 0.4, 0.58)));
  if (Math.abs(campus.scale.y - rise) > 1e-4) { campus.scale.y = rise; shadowsDirty(); }
  devState.phone.on = ease(band01(u, 0.93, 1)) * devWant.phone.on;
  const beat = INTRO.beats.reduce((acc, b, i) => (u >= b.at ? i : acc), 0);
  if (beat !== intro.beat && card) {
    const first = intro.beat === -1;
    intro.beat = beat;
    card.classList.remove("show");
    setTimeout(() => {
      cardCoords.textContent = INTRO.beats[beat].coords;
      cardPlace.textContent = INTRO.beats[beat].place;
      card.classList.add("show");
    }, first ? 0 : 380);
  }
  if (u > 0.9) root.classList.add("intro-done");
  if (intro.t >= 1) {
    intro.active = false;
    root.classList.add("intro-done");
    root.classList.remove("intro");
  }
}

// ==========================================================================================
// Pointeur : l'appareil suit un peu le regard
// ==========================================================================================
const tilt = { x: 0, y: 0 }, tiltNow = { x: 0, y: 0 };
if (!reduced && !small) {
  addEventListener("pointermove", (e) => {
    tilt.x = (e.clientX / innerWidth - 0.5) * 0.16;
    tilt.y = (e.clientY / innerHeight - 0.5) * 0.1;
    wake();
  }, { passive: true });
}
function placeDevice(group, s) {
  const halfH = Math.tan(THREE.MathUtils.degToRad(devCam.fov / 2)) * s.d;
  const halfW = halfH * camera.aspect;
  const x = (s.x - 2 * shiftNow) * halfW, y = (s.y - 2 * liftNow) * halfH - (1 - s.on) * halfH * 1.6;
  group.position.set(x, y, -s.d);
  group.rotation.set(s.rx + tiltNow.y, s.ry + tiltNow.x, 0);
  group.visible = s.on > 0.01;
}

// ==========================================================================================
// Boucle : en mouvement, une définition réduite ; à l'arrêt, une image nette
// ==========================================================================================
// L'image nette à l'arrêt : avec une occlusion ambiante douce (N8AO), chargée à part pour ne
// rien retarder ; en mouvement, un rendu simple.
let composer = null, aoPass = null;
import("n8ao").then(({ N8AOPass }) => {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  aoPass = new N8AOPass(scene, camera, innerWidth, innerHeight);
  aoPass.configuration.aoRadius = 1.6;
  aoPass.configuration.distanceFalloff = 0.6;
  aoPass.configuration.intensity = 3.2;
  aoPass.configuration.halfRes = true;
  aoPass.configuration.gammaCorrection = false;
  aoPass.setQualityMode(small ? "Low" : "Medium");
  composer.addPass(aoPass);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(DPR_HI);
  composer.setSize(innerWidth, innerHeight);
  wake();
}).catch(() => {});
const clock = new THREE.Clock();
const introClock = new THREE.Clock(false);
let visible = true, slowFrames = 0;
function setDpr(d) {
  if (d === dprNow) return;
  dprNow = d;
  renderer.setPixelRatio(d);
  renderer.setSize(innerWidth, innerHeight, false);
}
function approach(state, want, k) {
  let moving = false;
  for (const n of ["x", "y", "d", "ry", "rx", "on"]) {
    const diff = want[n] - state[n];
    if (Math.abs(diff) > 1e-4) { state[n] += diff * k; moving = true; }
  }
  return moving;
}
function frame() {
  running = false;
  if (!visible || document.hidden) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const k = reduced ? 1 : 1 - Math.exp(-dt * 7.5);
  let moving = false;

  if (intro.active && intro.started) {
    introFrame(Math.min(introClock.getDelta(), 0.25));
    moving = true;
  } else if (!intro.active) {
    if (camPos.distanceToSquared(wantPos) > 1e-6 || camLook.distanceToSquared(wantLook) > 1e-6) {
      camPos.lerp(wantPos, k); camLook.lerp(wantLook, k); moving = true;
    }
    if (Math.abs(shiftNow - shiftWant) + Math.abs(liftNow - liftWant) > 1e-4) {
      shiftNow += (shiftWant - shiftNow) * k; liftNow += (liftWant - liftNow) * k; moving = true;
    }
    if (approach(devState.phone, devWant.phone, k)) moving = true;
  }
  if (Math.abs(tiltNow.x - tilt.x) + Math.abs(tiltNow.y - tilt.y) > 1e-4) {
    tiltNow.x += (tilt.x - tiltNow.x) * k * 0.6; tiltNow.y += (tilt.y - tiltNow.y) * k * 0.6;
    moving = true;
  }
  // La profondeur suit la hauteur de vue : précise près du sol, sans limite vue du ciel.
  const dist = camPos.distanceTo(camLook);
  camera.near = THREE.MathUtils.clamp(Math.min(dist, camPos.y) * 0.004, 0.03, 40);
  camera.far = Math.max(3000, camPos.y * 45 + dist * 4);
  camera.updateProjectionMatrix();
  camera.setViewOffset(innerWidth, innerHeight, -shiftNow * innerWidth, liftNow * innerHeight, innerWidth, innerHeight);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  if (devWant.phone.screen) showScreen(phoneScreen, devWant.phone.screen);
  if (stepScreen(phoneScreen, k)) moving = true;
  placeDevice(phone, devState.phone);

  devCam.aspect = camera.aspect;
  devCam.setViewOffset(innerWidth, innerHeight, -shiftNow * innerWidth, liftNow * innerHeight, innerWidth, innerHeight);
  devCam.updateProjectionMatrix();
  setDpr(moving ? DPR_LO : DPR_HI);
  const t0 = performance.now();
  renderer.autoClear = true;
  if (composer && !moving && !(intro.active && intro.started)) composer.render();
  else renderer.render(scene, camera);
  if (phone.visible) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(deviceScene, devCam);
  }
  if (moving) {
    // Une machine qui peine : on baisse encore la définition en mouvement.
    slowFrames = performance.now() - t0 > 24 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 8 && DPR_LO > 0.75) { DPR_LO = Math.max(0.75, DPR_LO - 0.25); slowFrames = 0; }
    wake();
  } else if (dprNow !== DPR_HI) {
    wake();
  }
}

function snap() {
  camPos.copy(wantPos); camLook.copy(wantLook); shiftNow = shiftWant; liftNow = liftWant;
  Object.assign(devState.phone, devWant.phone);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  composer?.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  measure();
  scrollTarget();
  if (reduced) snap();
  wake();
}

const cover = document.querySelector("[data-covers-slab]");
const coverCheck = () => { visible = !cover || cover.getBoundingClientRect().top > 0; };
addEventListener("scroll", () => { coverCheck(); scrollTarget(); if (scrollY > 40) skipIntro(); wake(); }, { passive: true });
addEventListener("resize", resize);
addEventListener("load", () => { measure(); scrollTarget(); wake(); });
document.fonts?.ready.then(() => { measure(); scrollTarget(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { clock.getDelta(); wake(); } });
darkQuery.addEventListener("change", () => { applyTheme(); wake(); });

applyTheme();
coverCheck();
camera.aspect = innerWidth / innerHeight;
measure();
scrollTarget();
snap();
resize();

// L'intro ne part qu'avec le décor chargé, et seulement en haut de page.
if (intro.active && scrollY < 40 && !location.hash) {
  root.classList.add("intro", "intro-wait");
  camPos.copy(introPos.getPoint(0)); camLook.copy(introLook.getPoint(0)); shiftNow = 0; liftNow = 0;
  campus.scale.y = 0.02; devState.phone.on = 0;
  const giveUp = setTimeout(() => { intro.active = false; finishInstantly(); }, 10000);
  Promise.all([groundReady, treesReady.catch(() => {}), buildingsReady.catch(() => {})]).then(() => {
    clearTimeout(giveUp);
    if (!intro.active) return;
    renderer.compile(scene, camera);
    shadowsDirty();
    intro.started = true;
    root.classList.remove("intro-wait");
    clock.getDelta();
    introClock.start();
    wake();
  }).catch(() => { clearTimeout(giveUp); intro.active = false; finishInstantly(); });
} else {
  intro.active = false;
  finishInstantly();
  groundReady.then(() => wake()).catch(() => {});
}
function finishInstantly() {
  campus.scale.y = 1;
  shadowsDirty();
  root.classList.add("intro-done");
  root.classList.remove("intro", "intro-wait");
  snap();
  wake();
}
