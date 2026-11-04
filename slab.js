// La scène : le Léman et les Alpes en relief (images swisstopo et Sentinel-2), le campus, et
// au milieu une maquette du Rolex Learning Center à ses vraies proportions. À l'ouverture, la
// caméra plonge depuis le ciel jusqu'au bâtiment ; ensuite le défilement promène le regard et
// l'app apparaît sur un iPhone et un ordinateur. Rien ne tourne quand rien ne bouge.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const canvas = document.getElementById("slab");
const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = matchMedia("(max-width: 760px)").matches;
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
} catch {
  root.classList.add("no-webgl", "intro-done");
  throw new Error("WebGL indisponible");
}
renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.6 : 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 140000);
scene.add(camera);

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
// Ciel et lumière
// ==========================================================================================
// Le ciel visible est un dégradé CSS derrière le canevas (il finit pile sur la couleur de la
// brume : pas de couture à l'horizon) ; le ciel physique ne sert qu'aux reflets.
const sky = new Sky();
const skyU = sky.material.uniforms;
const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene();
const skyForEnv = new Sky();
skyForEnv.scale.setScalar(1000);
skyScene.add(skyForEnv);
let envRT = null;

const sun = new THREE.DirectionalLight("#fff3e2", 3);
sun.castShadow = true;
sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 220 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight("#f3efe6", "#7d796c", 0.5);
scene.add(hemi);
const key = new THREE.DirectionalLight("#ffffff", 1.4);
key.position.set(-2, 3, 4);
camera.add(key);
const sunDir = new THREE.Vector3();
const sunAngles = { el: 26, az: 238 };

// ==========================================================================================
// Le terrain : trois couches cuites (geo/), du Léman entier au campus
// ==========================================================================================
// uStyle : 0 = photo aérienne, 1 = plan de site (désaturé, éclairci) ; uHole : la couche plus fine
// prend le relais à l'intérieur de ce rectangle ; uFade : fondu des bords.
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
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;\nvarying vec2 vUvT;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUvT = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;\nvarying vec2 vUvT;\nuniform float uStyle;\nuniform vec3 uPaper;\nuniform vec4 uHole;\nuniform float uFade;\nuniform float uGain;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        if (uHole.z > 0.0 && abs(vWorld.x - uHole.x) < uHole.z && abs(vWorld.z - uHole.y) < uHole.w) discard;`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        diffuseColor.rgb *= uGain;
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 plan = mix(vec3(lum), diffuseColor.rgb, 0.55);
        plan = mix(plan, uPaper, 0.32);
        diffuseColor.rgb = mix(diffuseColor.rgb, plan, uStyle);
        if (uFade > 0.0) {
          float edge = min(min(vUvT.x, 1.0 - vUvT.x), min(vUvT.y, 1.0 - vUvT.y));
          diffuseColor.a *= smoothstep(0.0, uFade, edge);
        }`);
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
    const u = x / size + 0.5, v = 0.5 - z / size; // v : 0 au nord (première ligne des hauteurs)
    const col = Math.round(u * (g - 1)), row = Math.round(v * (g - 1));
    let h = heights[row * g + col] / UNIT * EXAG;
    // Le lac : tout ce qui est au niveau de l'eau passe dessous (le relief fourni inclut le fond).
    if (opts.lake && h < LAKE + 0.9) h = LAKE - 2.5;
    // Les bords de la grande couche s'abaissent vers la plaine qui file jusqu'à l'horizon.
    if (opts.sink) {
      const e = Math.min(u, 1 - u, v, 1 - v);
      const f = Math.min(1, e / 0.14);
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
function loadTex(url, aniso = true) {
  return new Promise((resolve, reject) => loader.load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    if (aniso) t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    resolve(t);
  }, undefined, reject));
}
const loadBin = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); }).then((b) => new Int16Array(b));
const groundReady = (async () => {
  const meta = await (await fetch("geo/meta.json")).json();
  const L = meta.layers;
  const [farH, midH, nearH, farT, midT, nearT] = await Promise.all([
    loadBin("geo/far.bin"), loadBin("geo/mid.bin"), loadBin("geo/near.bin"),
    loadTex("geo/far.webp"), loadTex("geo/mid.webp"), loadTex("geo/near.webp"),
  ]);
  const inner = (layer, margin) => new THREE.Vector4(layer.cx / UNIT, layer.cz / UNIT, layer.size / UNIT / 2 * (1 - margin), layer.size / UNIT / 2 * (1 - margin));
  scene.add(terrainMesh(L.far, farH, farT, { fade: 0, hole: inner(L.mid, 0.36), lake: true, sink: true }));
  scene.add(terrainMesh(L.mid, midH, midT, { fade: 0.18, hole: inner(L.near, 0.3), lake: true, order: 1, lift: 0.05, gain: 0.84 }));
  const near = terrainMesh(L.near, nearH, nearT, { fade: 0.15, order: 2, lift: 0.08, gain: 0.86 });
  near.receiveShadow = true;
  scene.add(near);
  return true;
})();

// La plaine jusqu'à l'horizon, sous la grande couche : le relief s'y fond dans la brume.
const plainMat = new THREE.MeshStandardMaterial({ color: "#3f5640", roughness: 1 });
const plain = new THREE.Mesh(new THREE.CircleGeometry(125000, 96), plainMat);
plain.rotation.x = -Math.PI / 2;
plain.position.y = LAKE - 3.2;
scene.add(plain);

// Le lac : une surface qui reflète le ciel par-dessus l'image.
const water = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), new THREE.MeshPhysicalMaterial({
  color: "#4d6c80", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.78, envMapIntensity: 1.3,
}));
water.rotation.x = -Math.PI / 2;
water.position.y = LAKE;
water.renderOrder = 3;
scene.add(water);

// ==========================================================================================
// Le Rolex Learning Center : 167 × 122 m, quatorze patios relevés sur l'image aérienne
// ==========================================================================================
const HALF_X = 13.9, HALF_Z = 10.2, T = 0.78;
const HILLS = [
  { x: -0.8, z: -5.6, sx: 3.6, sz: 2.8, h: 1.75 },  // l'arche de l'entrée, au sud
  { x: -7.2, z: 2.4, sx: 2.8, sz: 3.0, h: 1.3 },
  { x: 7.4, z: 4.0, sx: 3.0, sz: 2.6, h: 0.95 },
  { x: 8.6, z: -6.4, sx: 2.4, sz: 2.2, h: 0.7 },
];
const lift = (x, z) => {
  let y = 0.04;
  for (const hl of HILLS) y += hl.h * Math.exp(-(((x - hl.x) ** 2) / (2 * hl.sx ** 2) + ((z - hl.z) ** 2) / (2 * hl.sz ** 2)));
  return y;
};
const top = (x, z) => lift(x, z) + T;
// [x, z, rx, rz, angle] en unités, mesurés sur la photo (0,0685 unité par pixel de l'aperçu).
const PX = (px, py, rx, rz, a = 0) => [(px - 491.5) * 0.0685, -(py - 481.5) * 0.0685, rx * 0.0685, rz * 0.0685, a];
const PATIOS = [
  PX(376, 386, 26, 25), PX(478, 365, 9, 9), PX(538, 389, 21, 17, 0.1), PX(621, 382, 8, 8),
  PX(355, 431, 8, 8), PX(449, 454, 48, 30, -0.06), PX(566, 460, 32, 23, 0.3), PX(629, 443, 9, 9),
  PX(383, 516, 29, 22, -0.15), PX(510, 517, 11, 10), PX(314, 538, 12, 12), PX(409, 589, 19, 20),
  PX(489, 591, 13, 11), PX(517, 590, 13, 11), PX(625, 555, 53, 50),
];
const patioU = { value: PATIOS.map(([x, z, rx, rz, a]) => new THREE.Vector4(x, z, rx, rz)) };
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
}
const concrete = new THREE.MeshStandardMaterial({ color: "#f2f1ed", roughness: 0.82, side: THREE.DoubleSide });
carve(concrete);
const concreteDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
carve(concreteDepth);

// La façade : un bandeau vitré entre le sol et le toit, montants fins tous les 3,7 m.
function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: "#f2f1ed", roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  m.userData.glass = { value: new THREE.Color("#5d7180") };
  m.userData.frame = { value: new THREE.Color("#e9e8e3") };
  m.userData.glow = { value: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlass = m.userData.glass;
    shader.uniforms.uFrame = m.userData.frame;
    shader.uniforms.uGlow = m.userData.glow;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aBand;\nattribute float aRun;\nvarying float vBand;\nvarying float vRun;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBand = aBand;\nvRun = aRun;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vBand;\nvarying float vRun;\nuniform vec3 uGlass;\nuniform vec3 uFrame;\nuniform float uGlow;\nfloat gGlass = 0.0;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float inBand = smoothstep(0.14, 0.16, vBand) * (1.0 - smoothstep(0.88, 0.9, vBand));
        float mullion = 1.0 - smoothstep(0.012, 0.03, fract(vRun / 0.62));
        gGlass = inBand * (1.0 - mullion);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(uGlass, uFrame, mullion), inBand);`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.04, gGlass);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.9, gGlass);")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlass * gGlass * uGlow;");
  };
  return m;
}
const facade = facadeMaterial();

const NX = small ? 140 : 220, NZ = small ? 100 : 160;
function surface(fy, flip) {
  const geo = new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2, NX, NZ);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, fy(p.getX(i), p.getZ(i)));
  if (flip) { const idx = geo.index.array; for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; }
  geo.computeVertexNormals();
  return geo;
}
function wall(points) {
  const pos = [], band = [], run = [];
  let dist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const d = Math.hypot(x1 - x0, z1 - z0);
    for (const [x, z, r, b] of [[x0, z0, dist, 0], [x1, z1, dist + d, 0], [x1, z1, dist + d, 1], [x0, z0, dist, 0], [x1, z1, dist + d, 1], [x0, z0, dist, 1]]) {
      pos.push(x, b ? top(x, z) : lift(x, z) - 0.02, z);
      band.push(b); run.push(r);
    }
    dist += d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aBand", new THREE.Float32BufferAttribute(band, 1));
  geo.setAttribute("aRun", new THREE.Float32BufferAttribute(run, 1));
  geo.computeVertexNormals();
  return geo;
}
const edge = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
const building = new THREE.Group();
for (const geo of [surface(top, false), surface(lift, true)]) {
  const mesh = new THREE.Mesh(geo, concrete);
  mesh.customDepthMaterial = concreteDepth;
  mesh.castShadow = mesh.receiveShadow = true;
  building.add(mesh);
}
{
  const perimeter = [
    ...edge([-HALF_X, HALF_Z], [HALF_X, HALF_Z], NX), ...edge([HALF_X, HALF_Z], [HALF_X, -HALF_Z], NZ).slice(1),
    ...edge([HALF_X, -HALF_Z], [-HALF_X, -HALF_Z], NX).slice(1), ...edge([-HALF_X, -HALF_Z], [-HALF_X, HALF_Z], NZ).slice(1),
  ];
  const mesh = new THREE.Mesh(wall(perimeter), facade);
  mesh.castShadow = mesh.receiveShadow = true;
  building.add(mesh);
}
const lawnMat = new THREE.MeshStandardMaterial({ color: "#a9b896", roughness: 1, emissive: "#ffd39a", emissiveIntensity: 0 });
const treeMat = new THREE.MeshStandardMaterial({ color: "#f4f3ef", roughness: 0.9 });
for (const [px, pz, rx, rz, a] of PATIOS) {
  const ring = Array.from({ length: 81 }, (_, i) => {
    const t = i / 80 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const lx = rx * Math.cos(t), lz = rz * Math.sin(t);
    return [px + c * lx - s * lz, pz + s * lx + c * lz];
  });
  const mesh = new THREE.Mesh(wall(ring), facade);
  mesh.receiveShadow = true;
  building.add(mesh);
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(1, 64), lawnMat);
  lawn.scale.set(rx, rz, 1);
  lawn.rotation.set(-Math.PI / 2, 0, a);
  lawn.position.set(px, Math.max(0.12, lift(px, pz) + 0.01), pz);
  lawn.receiveShadow = true;
  building.add(lawn);
}
scene.add(building);

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
const coverGlass = new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.03, metalness: 0, transparent: true, opacity: 0.07, clearcoat: 1, envMapIntensity: 2.5 });
function screenPair(w, h, r, z, parent) {
  const geo = planeUV(new THREE.ShapeGeometry(roundedRect(w, h, r), 24));
  const a = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }));
  const b = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0 }));
  const glass = new THREE.Mesh(geo, coverGlass);
  a.position.z = z; b.position.z = z + 0.0004; glass.position.z = z + 0.0012;
  parent.add(a, b, glass);
  return { a, b, glass, current: null, fade: 1 };
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

// L'iPhone : titane, verre noir, Dynamic Island, bloc photo, boutons.
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
camera.add(phone);

// L'ordinateur : coque aluminium, clavier touche par touche, pavé tactile en verre, charnière,
// écran 16:10 avec encoche, la version Windows de l'app.
const aluminium = new THREE.MeshPhysicalMaterial({ color: "#c9cbcf", metalness: 1, roughness: 0.3, clearcoat: 0.25, envMapIntensity: 1.6 });
const darkAlu = new THREE.MeshPhysicalMaterial({ color: "#8d9095", metalness: 1, roughness: 0.4, envMapIntensity: 1.2 });
const keyMat = new THREE.MeshStandardMaterial({ color: "#1d1e21", roughness: 0.55, metalness: 0.1 });
const wellMat = new THREE.MeshStandardMaterial({ color: "#2b2d31", roughness: 0.7 });
const padMat = new THREE.MeshPhysicalMaterial({ color: "#bfc1c5", metalness: 0.4, roughness: 0.18, clearcoat: 1, envMapIntensity: 1.6 });
const laptop = new THREE.Group();
const LW = 2.3, LD = 1.58, SW = LW - 0.12, SH = SW * 0.625;
const lid = new THREE.Group();
{
  const base = new THREE.Mesh(new RoundedBoxGeometry(LW, 0.06, LD, 5, 0.028), aluminium);
  base.position.y = 0.03;
  laptop.add(base);
  const well = new THREE.Mesh(new THREE.PlaneGeometry(LW * 0.88, LD * 0.47), wellMat);
  well.rotation.x = -Math.PI / 2; well.position.set(0, 0.0605, -LD * 0.13);
  laptop.add(well);
  // Les touches : six rangées, la barre d'espace et les flèches.
  const rows = [[14, 0.62], [14, 1], [14, 1], [13, 1], [12, 1]];
  const pitch = LW * 0.86 / 14, kd = pitch * 0.84;
  const keyGeo = new RoundedBoxGeometry(1, 0.016, 1, 2, 0.004);
  const keys = [];
  rows.forEach(([n, hScale], r) => {
    const z = -LD * 0.13 - LD * 0.2 + r * pitch * (r === 0 ? 0.8 : 1) + (r > 0 ? -pitch * 0.2 : 0);
    const wide = (LW * 0.86 - (n - 1) * pitch * 0.16) / n;
    for (let i = 0; i < n; i++) keys.push({ x: -LW * 0.43 + wide / 2 + i * (wide + pitch * 0.16), z, w: wide, d: kd * hScale });
  });
  const lastZ = keys[keys.length - 1].z + pitch;
  [[-0.38, 0.8], [0, 1.6], [0.38, 0.8]].forEach(([fx, wScale], i) => {
    if (i === 1) keys.push({ x: -0.08, z: lastZ, w: pitch * 5.6, d: kd });
    else for (let k = 0; k < 3; k++) keys.push({ x: (fx < 0 ? -LW * 0.43 + pitch * 0.5 : LW * 0.43 - pitch * 2.5) + k * pitch, z: lastZ, w: pitch * 0.84, d: kd });
  });
  const keyMesh = new THREE.InstancedMesh(keyGeo, keyMat, keys.length);
  const m4 = new THREE.Matrix4();
  keys.forEach((kk, i) => keyMesh.setMatrixAt(i, m4.compose(new THREE.Vector3(kk.x, 0.068, kk.z), new THREE.Quaternion(), new THREE.Vector3(kk.w, 1, kk.d))));
  laptop.add(keyMesh);
  const pad = new THREE.Mesh(new RoundedBoxGeometry(LW * 0.36, 0.004, LD * 0.27, 3, 0.002), padMat);
  pad.position.set(0, 0.061, LD * 0.29);
  laptop.add(pad);
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, LW * 0.78, 24), darkAlu);
  hinge.rotation.z = Math.PI / 2; hinge.position.set(0, 0.06, -LD / 2 + 0.01);
  laptop.add(hinge);
  const lidH = SH + 0.14;
  const shell = new THREE.Mesh(new RoundedBoxGeometry(LW, lidH, 0.03, 5, 0.012), aluminium);
  shell.position.set(0, lidH / 2, -0.015);
  const bezel = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(LW - 0.024, lidH - 0.024, 0.05), 16), blackGlass);
  bezel.position.set(0, lidH / 2, 0.0008);
  const notch = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(0.2, 0.05, 0.016), 12), blackGlass);
  notch.position.set(0, lidH / 2 + SH / 2 + 0.002, 0.004);
  lid.add(shell, bezel, notch);
  lid.position.set(0, 0.06, -LD / 2 + 0.01);
  lid.rotation.x = -0.28;
  laptop.add(lid);
  laptop.userData.lidH = lidH;
}
const laptopScreen = screenPair(SW, SH, 0.012, 0.0022, lid);
for (const m of [laptopScreen.a, laptopScreen.b, laptopScreen.glass]) m.position.y = laptop.userData.lidH / 2 - 0.02;
camera.add(laptop);

// ==========================================================================================
// Thème : le jour, ou l'heure bleue sur le lac
// ==========================================================================================
function applyTheme() {
  const dark = darkQuery.matches;
  sunAngles.el = dark ? -1.2 : 26;
  skyU.turbidity.value = dark ? 2 : 3.2;
  skyU.rayleigh.value = dark ? 2.6 : 2.1;
  skyU.mieCoefficient.value = dark ? 0.004 : 0.004;
  skyU.mieDirectionalG.value = 0.82;
  for (const u of [skyForEnv.material.uniforms]) {
    u.turbidity.value = skyU.turbidity.value; u.rayleigh.value = skyU.rayleigh.value;
    u.mieCoefficient.value = skyU.mieCoefficient.value; u.mieDirectionalG.value = skyU.mieDirectionalG.value;
  }
  renderer.toneMappingExposure = dark ? 0.55 : 0.62;
  scene.fog = new THREE.FogExp2(dark ? "#1b2433" : "#a8bac3", 0.00005);
  plainMat.color.set(dark ? "#10161c" : "#3f5640");
  paper.value.set(dark ? "#20252c" : "#e3e3df");
  concrete.color.set(dark ? "#6a7079" : "#f2f1ed");
  facade.color.set(dark ? "#6a7079" : "#f2f1ed");
  facade.userData.glass.value.set(dark ? "#ffb066" : "#5d7180");
  facade.userData.frame.value.set(dark ? "#2a2d32" : "#e9e8e3");
  facade.userData.glow.value = dark ? 1.1 : 0;
  lawnMat.emissiveIntensity = dark ? 0.35 : 0;
  treeMat.color.set(dark ? "#4a4e54" : "#f4f3ef");
  water.material.color.set(dark ? "#1d2c3c" : "#5f7f92");
  sun.color.set(dark ? "#8fa8d0" : "#fff3e2");
  sun.intensity = dark ? 1.6 : 3.2;
  hemi.intensity = dark ? 0.55 : 0.5;
  key.intensity = dark ? 1.0 : 1.4;
  updateSky();
}
function updateSky() {
  const phi = THREE.MathUtils.degToRad(90 - sunAngles.el), theta = THREE.MathUtils.degToRad(sunAngles.az);
  sunDir.setFromSphericalCoords(1, phi, theta);
  skyU.sunPosition.value.copy(sunDir);
  skyForEnv.material.uniforms.sunPosition.value.copy(sunDir);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(skyScene);
  scene.environment = envRT.texture;
  scene.environmentIntensity = darkQuery.matches ? 0.6 : 0.9;
}

// ==========================================================================================
// Le parcours : un arrêt par section
// ==========================================================================================
const D = (x, y, d, ry, rx, screen, on = 1) => ({ x, y, d, ry, rx, screen, on });
const OFF_PHONE = D(0.45, -1.6, 5.4, -0.3, 0.2, null, 0);
const OFF_LAPTOP = D(0.4, -1.8, 7.5, -0.3, 0.3, null, 0);
const STOPS = [
  { pos: [-18, 19, 40], look: [2, 0.5, -4], shift: 0.24, phone: D(0.66, -0.1, 5.8, -0.5, 0.06, "iphone-today"), laptop: OFF_LAPTOP },
  { pos: [-27, 7, 19], look: [-8, 1, -1], shift: 0, phone: D(0.46, -0.02, 5.0, -0.26, 0.02, "iphone-courses"), laptop: OFF_LAPTOP },
  { pos: [-7, 10, 26], look: [2, 1.6, -3], shift: 0, phone: { ...OFF_PHONE, x: -0.45 }, laptop: D(-0.42, -0.1, 7.2, 0.42, 0.36, "windows-stats") },
  { pos: [9, 9.5, 22], look: [3, 0.6, -3], shift: 0, phone: D(0.46, -0.02, 5.0, -0.3, 0.02, "iphone-tutor"), laptop: OFF_LAPTOP },
  { pos: [24, 11, 18], look: [8, 0.8, -1], shift: 0, phone: D(-0.46, -0.02, 5.0, 0.32, 0.02, "iphone-groups"), laptop: OFF_LAPTOP },
  { pos: [31, 7, -6], look: [6, 1.4, -6], shift: 0, phone: D(0.68, -0.18, 4.6, -0.36, 0.04, "iphone-today"), laptop: D(0.38, 0.02, 8.2, -0.3, 0.32, "windows-today") },
  { pos: [0.01, 58, 9], look: [0, 0, -1], shift: 0, phone: OFF_PHONE, laptop: OFF_LAPTOP },
];
const sections = [...document.querySelectorAll("[data-cam]")];
const camPos = new THREE.Vector3(...STOPS[0].pos), camLook = new THREE.Vector3(...STOPS[0].look);
const wantPos = camPos.clone(), wantLook = camLook.clone();
let shiftNow = STOPS[0].shift, shiftWant = shiftNow, liftNow = 0, liftWant = 0;
const devState = { phone: { ...STOPS[0].phone }, laptop: { ...STOPS[0].laptop } };
const devWant = { phone: { ...STOPS[0].phone }, laptop: { ...STOPS[0].laptop } };
const ease = (t) => t * t * (3 - 2 * t);
const portrait = () => camera.aspect < 1.05;

function scrollTarget() {
  const mid = scrollY + innerHeight * 0.5;
  const centers = sections.map((s) => s.offsetTop + s.offsetHeight * 0.5);
  let i = 0;
  while (i < centers.length - 1 && mid > centers[i + 1]) i++;
  const j = Math.min(i + 1, sections.length - 1);
  const ia = +sections[i].dataset.cam, ib = +sections[j].dataset.cam;
  const A = STOPS[ia], B = STOPS[ib];
  const t = i === j ? 0 : ease(Math.min(1, Math.max(0, (mid - centers[i]) / (centers[j] - centers[i]))));
  const lerp = (a, b) => a + (b - a) * t;
  wantPos.set(lerp(A.pos[0], B.pos[0]), lerp(A.pos[1], B.pos[1]), lerp(A.pos[2], B.pos[2]));
  wantLook.set(lerp(A.look[0], B.look[0]), lerp(A.look[1], B.look[1]), lerp(A.look[2], B.look[2]));
  wantPos.sub(wantLook).multiplyScalar(portrait() ? 1.5 : 1).add(wantLook);
  shiftWant = portrait() ? 0 : lerp(A.shift, B.shift);
  liftWant = portrait() ? 0.2 : 0;
  const heroWeight = (ia === 0 ? 1 - t : 0) + (ib === 0 ? t : 0);
  for (const name of ["phone", "laptop"]) {
    const a = A[name], b = B[name], w = devWant[name];
    for (const k of ["x", "y", "d", "ry", "rx", "on"]) w[k] = lerp(a[k], b[k]);
    w.screen = (t < 0.5 ? a.screen : b.screen) ?? a.screen ?? b.screen;
    if (portrait()) {
      if (name === "phone") Object.assign(w, { x: 0.22, y: 0.5, d: 10.5, ry: -0.36, rx: 0.08, on: heroWeight, screen: "iphone-today" });
      else w.on = 0;
    }
  }
}

// ==========================================================================================
// L'intro : du ciel au-dessus du Léman jusqu'au bâtiment
// ==========================================================================================
const INTRO = {
  pos: [[2600, 6800, 11000], [900, 2100, 4300], [180, 520, 1150], [10, 120, 230], [-14, 34, 74]],
  look: [[300, 0, -3600], [120, 0, -1100], [20, 0, -200], [0, 0, -16], [2, 0, -9]],
  duration: 6.2,
};
const introPos = new THREE.CatmullRomCurve3(INTRO.pos.map((p) => new THREE.Vector3(...p)), false, "centripetal");
const introLook = new THREE.CatmullRomCurve3(INTRO.look.map((p) => new THREE.Vector3(...p)), false, "centripetal");
const intro = { active: !reduced, t: 0, speed: 1, started: false };
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const band = (u, a, b) => Math.min(1, Math.max(0, (u - a) / (b - a)));
function skipIntro() {
  if (intro.active && intro.started) intro.speed = Math.max(intro.speed, (INTRO.duration * (1 - intro.t)) / 0.7);
}
for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) addEventListener(type, skipIntro, { passive: true });
document.querySelector("[data-skip-intro]")?.addEventListener("click", skipIntro);

function introFrame(dt) {
  intro.t = Math.min(1, intro.t + (dt * intro.speed) / INTRO.duration);
  const u = easeInOut(intro.t);
  const p = introPos.getPoint(u), l = introLook.getPoint(u);
  // Le dernier tronçon rejoint l'arrêt d'accueil (qui dépend de la largeur de l'écran).
  const tail = band(u, 0.82, 1);
  camPos.copy(p).lerp(wantPos, ease(tail));
  camLook.copy(l).lerp(wantLook, ease(tail));
  shiftNow = shiftWant * ease(band(u, 0.85, 1));
  liftNow = liftWant * ease(band(u, 0.85, 1));
  style.value = ease(band(u, 0.62, 0.92));
  building.scale.y = Math.max(0.02, ease(band(u, 0.7, 0.9)));
  devState.phone.on = ease(band(u, 0.9, 1)) * devWant.phone.on;
  if (u > 0.86) root.classList.add("intro-done");
  if (intro.t >= 1) {
    intro.active = false;
    root.classList.add("intro-done");
    root.classList.remove("intro");
  }
}

// ==========================================================================================
// Pointeur : le soleil glisse, l'appareil suit un peu le regard
// ==========================================================================================
const tilt = { x: 0, y: 0 }, tiltNow = { x: 0, y: 0 };
let sunPush = 0, sunPushNow = 0;
if (!reduced) {
  addEventListener("pointermove", (e) => {
    const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5;
    tilt.x = nx * 0.16; tilt.y = ny * 0.1;
    sunPush = nx * 40;
    wake();
  }, { passive: true });
}
function placeSun() {
  const az = THREE.MathUtils.degToRad(sunAngles.az + sunPushNow);
  const el = THREE.MathUtils.degToRad(Math.max(sunAngles.el, 14));
  const d = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - el, az);
  sun.position.copy(camLook).addScaledVector(d, 110);
  sun.target.position.copy(camLook);
}
function placeDevice(group, s) {
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * s.d;
  const halfW = halfH * camera.aspect;
  const x = (s.x - 2 * shiftNow) * halfW, y = (s.y - 2 * liftNow) * halfH - (1 - s.on) * halfH * 1.6;
  group.position.set(x, y, -s.d);
  group.rotation.set(s.rx + tiltNow.y, s.ry + tiltNow.x, 0);
  group.visible = s.on > 0.01;
}

// ==========================================================================================
// Boucle
// ==========================================================================================
const clock = new THREE.Clock();
let visible = true;
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
  const k = reduced ? 1 : 1 - Math.exp(-dt * 4.5);
  let moving = false;

  if (intro.active && intro.started) {
    introFrame(dt);
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
  if (!intro.active || !intro.started) {
    if (approach(devState.laptop, devWant.laptop, k)) moving = true;
  }
  if (Math.abs(tiltNow.x - tilt.x) + Math.abs(tiltNow.y - tilt.y) + Math.abs(sunPushNow - sunPush) > 1e-4) {
    tiltNow.x += (tilt.x - tiltNow.x) * k * 0.6; tiltNow.y += (tilt.y - tiltNow.y) * k * 0.6;
    sunPushNow += (sunPush - sunPushNow) * k * 0.5;
    moving = true;
  }
  camera.setViewOffset(innerWidth, innerHeight, -shiftNow * innerWidth, liftNow * innerHeight, innerWidth, innerHeight);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  placeSun();

  if (devWant.phone.screen) showScreen(phoneScreen, devWant.phone.screen);
  if (devWant.laptop.screen) showScreen(laptopScreen, devWant.laptop.screen);
  if (stepScreen(phoneScreen, k)) moving = true;
  if (stepScreen(laptopScreen, k)) moving = true;
  placeDevice(phone, devState.phone);
  placeDevice(laptop, devState.laptop);

  renderer.render(scene, camera);
  if (moving) wake();
}

function snap() {
  camPos.copy(wantPos); camLook.copy(wantLook); shiftNow = shiftWant; liftNow = liftWant;
  for (const n of ["phone", "laptop"]) Object.assign(devState[n], devWant[n]);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  scrollTarget();
  if (reduced) snap();
  wake();
}

const cover = document.querySelector("[data-covers-slab]");
const coverCheck = () => { visible = !cover || cover.getBoundingClientRect().top > 0; };
addEventListener("scroll", () => { coverCheck(); scrollTarget(); if (scrollY > 40) skipIntro(); wake(); }, { passive: true });
addEventListener("resize", resize);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { clock.getDelta(); wake(); } });
darkQuery.addEventListener("change", () => { applyTheme(); wake(); });

applyTheme();
coverCheck();
camera.aspect = innerWidth / innerHeight;
scrollTarget();
snap();
resize();

// En portrait, l'intro commence en regardant plus bas : moins de ciel, plus de lac.
if (portrait()) {
  INTRO.look[0] = [300, 0, -1400];
  INTRO.look[1] = [120, 0, -500];
  introLook.points.forEach((p, i) => p.set(...INTRO.look[i]));
}

// L'intro ne part qu'avec le décor chargé, et seulement en haut de page ; sinon, l'accueil direct.
if (intro.active && scrollY < 40) {
  root.classList.add("intro");
  const p0 = introPos.getPoint(0), l0 = introLook.getPoint(0);
  camPos.copy(p0); camLook.copy(l0); shiftNow = 0; liftNow = 0;
  style.value = 0; building.scale.y = 0.02; devState.phone.on = 0;
  const giveUp = setTimeout(() => { intro.active = false; finishInstantly(); }, 9000);
  groundReady.then(() => {
    clearTimeout(giveUp);
    if (!intro.active) return;
    renderer.compile(scene, camera);
    intro.started = true;
    clock.getDelta();
    wake();
  }).catch(() => { clearTimeout(giveUp); intro.active = false; finishInstantly(); });
} else {
  intro.active = false;
  finishInstantly();
  groundReady.then(() => wake()).catch(() => {});
}
function finishInstantly() {
  style.value = 1; building.scale.y = 1;
  root.classList.add("intro-done");
  root.classList.remove("intro");
  snap();
  wake();
}
