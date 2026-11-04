// La scène : le Léman et les Alpes en relief (images swisstopo et Sentinel-2), le campus avec
// ses arbres relevés sur la photo, et une maquette détaillée du Rolex Learning Center (vitrée,
// meublée, ses quatorze patios). À l'ouverture, la caméra descend du ciel jusqu'au bâtiment et
// en fait le tour ; ensuite le défilement la promène, jusqu'à l'intérieur pour le mode étude.
//
// Sobriété : on ne dessine que quand quelque chose bouge ; pendant un mouvement l'image est
// calculée en définition réduite, puis une image nette à l'arrêt. Les ombres sont figées
// (le soleil ne bouge pas), recalculées seulement quand le bâtiment change.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
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
  sun.target.position.set(0, 0, 0);
}

// ==========================================================================================
// Le terrain : trois couches cuites (geo/), du Léman entier au campus
// ==========================================================================================
const style = { value: 0 };
const paper = { value: new THREE.Color("#e3e3df") };
function terrainMaterial(tex, opts) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, transparent: opts.fade > 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uStyle = style;
    shader.uniforms.uPaper = paper;
    shader.uniforms.uHole = { value: opts.hole ?? new THREE.Vector4(0, 0, 0, 0) };
    shader.uniforms.uFade = { value: opts.fade };
    shader.uniforms.uGain = { value: opts.gain ?? 1 };
    shader.uniforms.uWater = water;
    shader.uniforms.uWaterModel = waterModel;
    shader.uniforms.uLake = { value: opts.lakeMask ?? null };
    shader.uniforms.uHasLake = { value: opts.lakeMask ? 1 : 0 };
    shader.uniforms.uLakeY = { value: LAKE + 0.05 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;\nvarying vec2 vUvT;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUvT = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;\nvarying vec2 vUvT;\nuniform float uStyle;\nuniform vec3 uPaper;\nuniform vec4 uHole;\nuniform float uFade;\nuniform float uGain;\nuniform vec3 uWater;\nuniform float uLakeY;\nuniform sampler2D uLake;\nuniform float uHasLake;\nuniform vec3 uWaterModel;\nfloat gWet = 0.0;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        if (uHole.z > 0.0 && abs(vWorld.x - uHole.x) < uHole.z && abs(vWorld.z - uHole.y) < uHole.w) discard;`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        diffuseColor.rgb *= uGain;
        // Le lac : là où l'image est au niveau de l'eau, sa couleur (le rivage suit la photo).
        // Le lac : là où le relief est au niveau de l'eau. Une teinte unie, de longues rides
        // douces, plus claire vers la rive.
        float wet = uHasLake > 0.5 ? smoothstep(0.3, 0.7, texture2D(uLake, vUvT).r) : 0.0;
        float ripple = sin(vWorld.x * 0.011 + vWorld.z * 0.004) * sin(vWorld.z * 0.013 - vWorld.x * 0.003);
        vec3 lake = uWater * (1.0 + 0.05 * ripple);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(lake, uWaterModel, uStyle), wet);
        gWet = wet;
        // Maquette : une argile claire ; la photo n'y laisse qu'une trace (routes, champs), la
        // végétation un vert sauge très doux.
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float green = smoothstep(0.0, 0.08, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
        vec3 clay = uPaper * (0.9 + 0.22 * lum);
        clay = mix(clay, uPaper * vec3(0.86, 0.93, 0.8), green * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, clay, uStyle);
        if (uFade > 0.0) {
          float edge = min(min(vUvT.x, 1.0 - vUvT.x), min(vUvT.y, 1.0 - vUvT.y));
          diffuseColor.a *= smoothstep(0.0, uFade, edge);
        }`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.32, gWet);");
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
const waterModel = { value: new THREE.Color("#a9bfcc") };
const plainMat = new THREE.MeshStandardMaterial({ color: "#3f5640", roughness: 1 });
const plain = new THREE.Mesh(new THREE.CircleGeometry(125000, 96), plainMat);
plain.rotation.x = -Math.PI / 2;
plain.position.y = LAKE - 3.2;
scene.add(plain);


// ==========================================================================================
// Le Rolex Learning Center : 167 × 122 m, un sol et un toit qui ondulent ensemble, un bandeau
// vitré entre les deux, quatorze patios relevés sur la photo aérienne
// ==========================================================================================
const HALF_X = 13.9, HALF_Z = 10.2, T = 0.78, ROOF_T = 0.13, FLOOR_T = 0.09;
const HILLS = [
  { x: -0.8, z: -5.6, sx: 3.6, sz: 2.8, h: 1.75 },
  { x: -7.2, z: 2.4, sx: 2.8, sz: 3.0, h: 1.3 },
  { x: 7.4, z: 4.0, sx: 3.0, sz: 2.6, h: 0.95 },
  { x: 8.6, z: -6.4, sx: 2.4, sz: 2.2, h: 0.7 },
];
const lift = (x, z) => {
  let y = 0.04;
  for (const hl of HILLS) y += hl.h * Math.exp(-(((x - hl.x) ** 2) / (2 * hl.sx ** 2) + ((z - hl.z) ** 2) / (2 * hl.sz ** 2)));
  return y;
};
const roofTop = (x, z) => lift(x, z) + T;
const roofUnder = (x, z) => lift(x, z) + T - ROOF_T;
const floorTop = (x, z) => lift(x, z) + FLOOR_T;
const PX = (px, py, rx, rz, a = 0) => [(px - 491.5) * 0.0685, -(py - 481.5) * 0.0685, rx * 0.0685, rz * 0.0685, a];
const PATIOS = [
  PX(376, 386, 26, 25), PX(478, 365, 9, 9), PX(538, 389, 21, 17, 0.1), PX(621, 382, 8, 8),
  PX(355, 431, 8, 8), PX(449, 454, 48, 30, -0.06), PX(566, 460, 32, 23, 0.3), PX(629, 443, 9, 9),
  PX(383, 516, 29, 22, -0.15), PX(510, 517, 11, 10), PX(314, 538, 12, 12), PX(409, 589, 19, 20),
  PX(489, 591, 13, 11), PX(517, 590, 13, 11), PX(625, 555, 53, 50),
];
function inPatio(x, z, margin = 0) {
  return PATIOS.some(([px, pz, rx, rz, a]) => {
    const dx = x - px, dz = z - pz, c = Math.cos(a), s = Math.sin(a);
    const u = (c * dx + s * dz) / (rx + margin), v = (-s * dx + c * dz) / (rz + margin);
    return u * u + v * v < 1;
  });
}
const patioU = { value: PATIOS.map(([x, z, rx, rz]) => new THREE.Vector4(x, z, rx, rz)) };
const patioA = { value: PATIOS.map((p) => p[4]) };
function carve(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPatios = patioU;
    shader.uniforms.uAngles = patioA;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vWorld;
        uniform vec4 uPatios[${PATIOS.length}];
        uniform float uAngles[${PATIOS.length}];`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        for (int i = 0; i < ${PATIOS.length}; i++) {
          vec2 d = vWorld.xz - uPatios[i].xy;
          float c = cos(uAngles[i]), s = sin(uAngles[i]);
          vec2 r = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / uPatios[i].zw;
          if (dot(r, r) < 1.0) discard;
        }`);
  };
  return material;
}
// Les textures du béton et de la toiture, dessinées une fois : grain fin et joints de membrane
// (la toiture du bâtiment est faite de longues bandes).
function surfaceTexture(base, seam, grain, stripes) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * grain;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = seam; g.lineWidth = 1.2;
  for (let k = 0; k < stripes; k++) { const y = (k + 0.5) * 256 / stripes; g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const roofTex = surfaceTexture("#f3f2ee", "rgba(160,158,150,0.35)", 10, 4);
roofTex.repeat.set(8, 6);
const floorTex = surfaceTexture("#e2dbcd", "rgba(150,140,125,0.0)", 14, 0);
floorTex.repeat.set(24, 18);
const concrete = carve(new THREE.MeshStandardMaterial({ color: "#f4f3ef", map: roofTex, roughness: 0.78, side: THREE.DoubleSide }));
const roofMat = carve(new THREE.MeshStandardMaterial({ color: "#f6f5f1", map: roofTex, roughness: 0.8 }));
// Coordonnées de la photo pour un point du plan (le nord en haut de l'image).
const photoUV = (x, z) => [(x + HALF_X) / (2 * HALF_X), (z + HALF_Z) / (2 * HALF_Z)];
const concreteDepth = carve(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
// Le sol intérieur et le plafond : clairs, un peu éclairés par les lampes du bâtiment.
const interiorFloor = carve(new THREE.MeshStandardMaterial({ color: "#ffffff", map: floorTex, roughness: 0.6, emissive: "#ffe2b8", emissiveIntensity: 0.12 }));
const ceiling = carve(new THREE.MeshStandardMaterial({ color: "#f6f4ef", roughness: 0.9, emissive: "#fff3df", emissiveIntensity: 0.18, side: THREE.DoubleSide }));

// Le verre : transparent, montants opaques tous les 3,7 m, une lueur chaude le soir.
const glassUniforms = { frame: { value: new THREE.Color("#e9e8e3") }, glow: { value: 0 } };
const glass = new THREE.MeshStandardMaterial({
  color: "#a9bfcc", roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.28, envMapIntensity: 1.8,
  side: THREE.DoubleSide, depthWrite: false,
});
glass.onBeforeCompile = (shader) => {
  shader.uniforms.uFrame = glassUniforms.frame;
  shader.uniforms.uGlow = glassUniforms.glow;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float aRun;\nvarying float vRun;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRun = aRun;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vRun;\nuniform vec3 uFrame;\nuniform float uGlow;\nfloat gFrame = 0.0;")
    .replace("#include <color_fragment>", `#include <color_fragment>
      gFrame = 1.0 - smoothstep(0.006, 0.016, fract(vRun / 0.62));
      diffuseColor.rgb = mix(diffuseColor.rgb, uFrame, gFrame);
      diffuseColor.a = mix(diffuseColor.a, 1.0, gFrame);`)
    .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * uGlow * (1.0 - gFrame);")
    // Le verre reflète davantage quand on le regarde de biais.
    .replace("#include <opaque_fragment>", `float fres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.5);
      diffuseColor.a = clamp(diffuseColor.a + fres * 0.55, 0.0, 1.0);
      #include <opaque_fragment>`);
};

const NX = small ? 120 : 200, NZ = small ? 88 : 150;
function surface(fy, flip) {
  const geo = new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2, NX, NZ);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, fy(p.getX(i), p.getZ(i)));
  if (flip) { const idx = geo.index.array; for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; }
  geo.computeVertexNormals();
  return geo;
}
function band(points, lower, upper) {
  const pos = [], run = [];
  let dist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const d = Math.hypot(x1 - x0, z1 - z0);
    for (const [x, z, r, top] of [[x0, z0, dist, 0], [x1, z1, dist + d, 0], [x1, z1, dist + d, 1], [x0, z0, dist, 0], [x1, z1, dist + d, 1], [x0, z0, dist, 1]]) {
      pos.push(x, top ? upper(x, z) : lower(x, z), z);
      run.push(r);
    }
    dist += d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aRun", new THREE.Float32BufferAttribute(run, 1));
  geo.computeVertexNormals();
  return geo;
}
const edge = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
const building = new THREE.Group();
function addMesh(geo, mat, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = true;
  if (cast) m.customDepthMaterial = concreteDepth;
  building.add(m);
  return m;
}
{
  const geo = surface(roofTop, false);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, ...photoUV(p.getX(i), p.getZ(i)));
  addMesh(geo, roofMat);
}
addMesh(surface(roofUnder, true), ceiling, false);
addMesh(surface(floorTop, false), interiorFloor, false);
addMesh(surface(lift, true), concrete);
function walls(points) {
  addMesh(band(points, roofUnder, roofTop), concrete);
  addMesh(band(points, lift, floorTop), concrete);
  const g = addMesh(band(points, floorTop, roofUnder), glass, false);
  g.renderOrder = 4;
}
walls([
  ...edge([-HALF_X, HALF_Z], [HALF_X, HALF_Z], NX), ...edge([HALF_X, HALF_Z], [HALF_X, -HALF_Z], NZ).slice(1),
  ...edge([HALF_X, -HALF_Z], [-HALF_X, -HALF_Z], NX).slice(1), ...edge([-HALF_X, -HALF_Z], [-HALF_X, HALF_Z], NZ).slice(1),
]);
const lawnMat = new THREE.MeshStandardMaterial({ color: "#dedad1", roughness: 0.95, emissive: "#ffd39a", emissiveIntensity: 0 });
for (const [px, pz, rx, rz, a] of PATIOS) {
  const ring = Array.from({ length: 81 }, (_, i) => {
    const t = i / 80 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const lx = rx * Math.cos(t), lz = rz * Math.sin(t);
    return [px + c * lx - s * lz, pz + s * lx + c * lz];
  });
  walls(ring);
  const lawnGeo = new THREE.CircleGeometry(1, 64);
  lawnGeo.applyMatrix4(new THREE.Matrix4().makeScale(rx, rz, 1));
  lawnGeo.applyMatrix4(new THREE.Matrix4().makeRotationZ(a));
  lawnGeo.rotateX(-Math.PI / 2);
  lawnGeo.translate(px, Math.max(0.12, lift(px, pz) + 0.01), pz);
  {
    const p = lawnGeo.attributes.position, uv = lawnGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, ...photoUV(p.getX(i), p.getZ(i)));
  }
  const lawn = new THREE.Mesh(lawnGeo, lawnMat);
  lawn.receiveShadow = true;
  building.add(lawn);
}

// L'intérieur : tables de travail et leurs chaises, rayonnages, poteaux fins ; sur le toit, les
// lanterneaux.
let seed = 17;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
function instanced(geo, mat, list, cast = false) {
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((it, i) => {
    q.setFromAxisAngle(up, it.yaw ?? 0);
    mesh.setMatrixAt(i, m4.compose(v3.set(it.x, it.y, it.z), q, s3.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1)));
  });
  mesh.castShadow = cast; mesh.receiveShadow = true;
  building.add(mesh);
  return mesh;
}
const desks = [], shelves = [], chairs = [], columns = [], skylights = [];
for (let x = -HALF_X + 1; x < HALF_X - 0.8; x += 1.25) {
  for (let z = -HALF_Z + 1; z < HALF_Z - 0.8; z += 1.1) {
    const jx = x + (rand() - 0.5) * 0.3, jz = z + (rand() - 0.5) * 0.3;
    if (inPatio(jx, jz, 0.55)) continue;
    const library = jx > 1.5 && jz > -1 && jz < 7;
    if (library && rand() < 0.75) {
      shelves.push({ x: jx, y: floorTop(jx, jz) + 0.11, z: jz, yaw: Math.PI / 2 });
    } else if (rand() < 0.62) {
      const yaw = rand() < 0.5 ? 0 : Math.PI / 2;
      desks.push({ x: jx, y: floorTop(jx, jz) + 0.12, z: jz, yaw });
      for (const side of [-1, 1]) if (rand() < 0.7) {
        const ox = yaw ? side * 0.22 : 0, oz = yaw ? 0 : side * 0.22;
        chairs.push({ x: jx + ox, y: floorTop(jx + ox, jz + oz) + 0.06, z: jz + oz });
      }
    }
  }
}
for (let x = -HALF_X + 1.8; x < HALF_X - 1; x += 2.6) {
  for (let z = -HALF_Z + 1.8; z < HALF_Z - 1; z += 2.6) {
    if (inPatio(x, z, 0.3)) continue;
    const y0 = floorTop(x, z), y1 = roofUnder(x, z);
    columns.push({ x, y: (y0 + y1) / 2, z, sy: y1 - y0 });
  }
}
for (let x = -HALF_X + 0.9; x < HALF_X - 0.6; x += 1.05) {
  for (let z = -HALF_Z + 0.9; z < HALF_Z - 0.6; z += 1.05) {
    const jx = x + (rand() - 0.5) * 0.35, jz = z + (rand() - 0.5) * 0.35;
    if (inPatio(jx, jz, 0.35) || rand() < 0.55) continue;
    skylights.push({ x: jx, y: roofTop(jx, jz) + 0.012, z: jz });
  }
}
instanced(new RoundedBoxGeometry(0.62, 0.035, 0.3, 2, 0.01), new THREE.MeshStandardMaterial({ color: "#efe9dd", roughness: 0.6 }), desks);
instanced(new THREE.BoxGeometry(0.11, 0.11, 0.11), new THREE.MeshStandardMaterial({ color: "#d4573b", roughness: 0.7 }), chairs);
instanced(new THREE.BoxGeometry(0.95, 0.2, 0.08), new THREE.MeshStandardMaterial({ color: "#d9cdb6", roughness: 0.8 }), shelves);
instanced(new THREE.CylinderGeometry(0.028, 0.028, 1, 10), new THREE.MeshStandardMaterial({ color: "#f4f3ef", roughness: 0.6 }), columns, true);
scene.add(building);

// Les arbres du campus, là où la photo en montre (geo/trees.bin : x, z, sol, rayon).
const treeGroup = new THREE.Group();
scene.add(treeGroup);
const crownMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95 });
const trunkMat = new THREE.MeshStandardMaterial({ color: "#cfc8bb", roughness: 0.9 });
const treesReady = loadBin("geo/trees.bin", Float32Array).then((a) => {
  const n = a.length / 4;
  // Une couronne faite de quatre boules bosselées, comme un vrai feuillage.
  const lobes = [];
  for (const [x, y, z, r] of [[0, 0.1, 0, 0.82], [0.42, -0.08, 0.15, 0.6], [-0.36, -0.05, 0.28, 0.62], [0.05, 0.05, -0.42, 0.6], [-0.1, 0.42, -0.05, 0.55]]) {
    const g = new THREE.IcosahedronGeometry(r, 2);
    g.translate(x, y, z);
    lobes.push(g);
  }
  const crownGeo = mergeVertices(mergeGeometries(lobes));
  {
    const p = crownGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v3.fromBufferAttribute(p, i);
      const k = 1 + 0.12 * Math.sin(v3.x * 5.1 + v3.y * 3.7) + 0.08 * Math.cos(v3.z * 6.3);
      p.setXYZ(i, v3.x * k, v3.y * k * 0.85, v3.z * k);
    }
    crownGeo.computeVertexNormals();
  }
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, n);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.07, 1, 6), trunkMat, n);
  const color = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = a[i * 4], z = a[i * 4 + 1], base = a[i * 4 + 2], r = a[i * 4 + 3];
    q.setFromAxisAngle(up, rand() * 6.28);
    crowns.setMatrixAt(i, m4.compose(v3.set(x, base + r * 1.55, z), q, s3.set(r, r * (0.9 + rand() * 0.3), r)));
    trunks.setMatrixAt(i, m4.compose(v3.set(x, base + r * 0.45, z), q, s3.set(1, r * 0.9, 1)));
    color.setHSL(0.25 + rand() * 0.04, 0.2 + rand() * 0.08, 0.6 + rand() * 0.08);
    crowns.setColorAt(i, color);
  }
  crowns.castShadow = trunks.castShadow = true;
  crowns.receiveShadow = true;
  treeGroup.add(crowns, trunks);
  shadowsDirty();
  wake();
});

// Les bâtiments du campus et des environs (OpenStreetMap) : des volumes blancs de maquette.
// Les volumes s'assombrissent un peu vers le pied, comme une maquette éclairée d'en haut.
const massing = new THREE.MeshStandardMaterial({ color: "#eeede8", roughness: 0.85 });
massing.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying float vH;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvH = position.y;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vH;")
    .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 0.86 + 0.14 * smoothstep(-0.6, 1.4, vH);");
};
const buildingsReady = loadBin("geo/buildings.bin", Float32Array).then((a) => {
  const geos = [];
  for (let i = 0; i < a.length;) {
    const n = a[i], h = a[i + 1], base = a[i + 2];
    const pts = [];
    for (let k = 0; k < n; k++) pts.push(new THREE.Vector2(a[i + 3 + 2 * k], -a[i + 4 + 2 * k]));
    i += 3 + 2 * n;
    if (THREE.ShapeUtils.area(pts) === 0) continue;
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: Math.max(h, 0.4) + 0.4, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, base - 0.4, 0);
    g.deleteAttribute("uv");
    geos.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), massing);
  mesh.castShadow = mesh.receiveShadow = true;
  treeGroup.add(mesh);
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
  const inner = (layer, margin) => new THREE.Vector4(layer.cx / UNIT, layer.cz / UNIT, layer.size / UNIT / 2 * (1 - margin), layer.size / UNIT / 2 * (1 - margin));
  scene.add(terrainMesh(L.far, farH, farT, { fade: 0, hole: inner(L.mid, 0.36), lake: true, sink: true, lakeMask: farLake }));
  scene.add(terrainMesh(L.mid, midH, midT, { fade: 0.18, hole: inner(L.near, 0.3), lake: true, order: 1, lift: 0.05, gain: 0.84, lakeMask: midLake }));
  const near = terrainMesh(L.near, nearH, nearT, { fade: 0.15, order: 2, lift: 0.08, gain: 0.86 });
  near.receiveShadow = true;
  scene.add(near);
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
  plainMat.color.set(dark ? "#10161c" : "#3f5640");
  paper.value.set(dark ? "#2a2f36" : "#cdc6b8");
  waterModel.value.set(dark ? "#1c2734" : "#aac0cc");
  concrete.color.set(dark ? "#6a7079" : "#f4f3ef");
  roofMat.color.set(dark ? "#7a8088" : "#ffffff");
  massing.color.set(dark ? "#5b616a" : "#f3f2ee");
  interiorFloor.emissiveIntensity = dark ? 0.9 : 0.12;
  ceiling.emissiveIntensity = dark ? 0.7 : 0.18;
  glassUniforms.glow.value = dark ? 0.55 : 0;
  glassUniforms.frame.value.set(dark ? "#2a2d32" : "#e9e8e3");
  lawnMat.emissiveIntensity = dark ? 0.35 : 0;
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
  hero: { pos: [-18, 19, 40], look: [2, 0.5, -4], shift: 0.24, phone: D(0.66, -0.1, 5.8, -0.5, 0.06, "iphone-today") },
  today: { pos: [-34, 16, 26], look: [-2, 0.4, -2], shift: 0, phone: OFF_PHONE },
  import: { pos: [28, 10, 24], look: [2, 0.6, 0], shift: 0, phone: OFF_PHONE },
  etude: { pos: [-5, 2.4, 16.5], look: [3, 1.1, 4], shift: 0, phone: OFF_PHONE },
  exercise: { pos: [8, 30, 26], look: [0, 0, -2], shift: 0, phone: OFF_PHONE },
  claude: { pos: [32, 6, -6], look: [6, 1, -4], shift: 0, phone: OFF_PHONE },
  calc: { pos: [-30, 5.5, -10], look: [-6, 1, -2], shift: 0, phone: OFF_PHONE },
  hours: { pos: [-20, 34, 34], look: [0, 0, -8], shift: 0, phone: OFF_PHONE },
  groups: { pos: [28, 12, 20], look: [4, 0.6, -2], shift: 0, phone: OFF_PHONE },
  everywhere: { pos: [6, 7, 30], look: [0, 1, -4], shift: -0.2, phone: D(-0.62, -0.08, 5.6, 0.48, 0.06, "iphone-today") },
  plan: { pos: [0.01, 58, 9], look: [0, 0, -1], shift: 0, phone: OFF_PHONE },
};
const INSIDE = new Set([]);
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
  pos: [[-2600, 9800, -1740], [-6400, 3100, 1700], [-2300, 640, 760], [-260, 150, 230], [64, 24, 44], [52, 13, -50], [-58, 15, -32], [-30, 17, 28]],
  look: [[-2600, 0, -1800], [-1800, 0, -2300], [200, 0, -480], [0, 0, -5], [0, 0.6, -2], [0, 0.8, 0], [0, 0.8, 0], [0, 0.6, -2]],
  duration: 14,
  beats: [
    { at: 0, coords: "46,43° N · 6,52° E", place: "Lac Léman" },
    { at: 0.3, coords: "46,52° N · 6,57° E", place: "Ecublens" },
    { at: 0.47, coords: "46,5184° N · 6,5681° E", place: "Rolex Learning Center" },
  ],
};
const introPos = new THREE.CatmullRomCurve3(INTRO.pos.map((p) => new THREE.Vector3(...p)), false, "centripetal");
const introLook = new THREE.CatmullRomCurve3(INTRO.look.map((p) => new THREE.Vector3(...p)), false, "centripetal");
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
  style.value = ease(band01(u, 0.5, 0.78));
  const rise = Math.max(0.02, ease(band01(u, 0.4, 0.56)));
  if (Math.abs(building.scale.y - rise) > 1e-4) { building.scale.y = rise; treeGroup.scale.y = rise; shadowsDirty(); }
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
  style.value = 0; building.scale.y = 0.02; treeGroup.scale.y = 0.02; devState.phone.on = 0;
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
  style.value = 1; building.scale.y = 1; treeGroup.scale.y = 1;
  shadowsDirty();
  root.classList.add("intro-done");
  root.classList.remove("intro", "intro-wait");
  snap();
  wake();
}
