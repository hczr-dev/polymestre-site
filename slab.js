// La scène : une maquette du Rolex Learning Center au bord du lac, et devant elle l'app
// elle-même, sur un iPhone puis un ordinateur. Le défilement change l'écran et le point de
// vue ; le pointeur déplace le soleil et incline doucement l'appareil. Rien ne tourne quand
// rien ne bouge.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const canvas = document.getElementById("slab");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = matchMedia("(max-width: 760px)").matches;
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
} catch {
  document.documentElement.classList.add("no-webgl");
  throw new Error("WebGL indisponible");
}
renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.6 : 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 260);
scene.add(camera);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;

let running = false;
function wake() {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
}

// ==========================================================================================
// La maquette
// ==========================================================================================
const HALF_X = 14, HALF_Z = 5.6, T = 0.6;
const HILLS = [
  { x: -6.6, z: -1.2, sx: 2.3, sz: 2.6, h: 1.05 },
  { x: 0.2, z: 1.4, sx: 2.6, sz: 3.0, h: 1.6 },
  { x: 10.6, z: -0.6, sx: 2.4, sz: 3.4, h: 1.95 },
];
const lift = (x, z) => {
  let y = 0.05 * Math.sin(x * 0.55) * Math.cos(z * 0.7) + 0.05;
  for (const hill of HILLS) {
    y += hill.h * Math.exp(-(((x - hill.x) ** 2) / (2 * hill.sx ** 2) + ((z - hill.z) ** 2) / (2 * hill.sz ** 2)));
  }
  return Math.max(0, y);
};
const top = (x, z) => lift(x, z) + T;
const PATIOS = [[-9, 2.1, 1.0], [-2.6, -2.6, 1.25], [3.9, 2.3, 1.05], [8.2, -2.4, 0.9], [12.6, 2.6, 0.75]];

// Le béton : les patios percent la dalle.
const patioUniform = { value: PATIOS.map(([x, z, r]) => new THREE.Vector4(x, z, r, 0)) };
function carve(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPatios = patioUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;\nuniform vec4 uPatios[5];")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        for (int i = 0; i < 5; i++) { if (distance(vWorld.xz, uPatios[i].xy) < uPatios[i].z) discard; }`);
  };
}
const concrete = new THREE.MeshStandardMaterial({ color: "#f1f0ec", roughness: 0.86, side: THREE.DoubleSide });
carve(concrete);
const concreteDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
carve(concreteDepth);

// La façade : un bandeau vitré entre le sol et le toit, des montants tous les 36 cm.
// Attributs : aBand (0 en bas, 1 en haut), aRun (distance le long de la façade).
function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: "#f1f0ec", roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  m.userData.glass = { value: new THREE.Color("#6d7f8a") };
  m.userData.frame = { value: new THREE.Color("#e7e6e1") };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlass = m.userData.glass;
    shader.uniforms.uFrame = m.userData.frame;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aBand;\nattribute float aRun;\nvarying float vBand;\nvarying float vRun;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBand = aBand;\nvRun = aRun;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vBand;\nvarying float vRun;\nuniform vec3 uGlass;\nuniform vec3 uFrame;\nfloat gGlass = 0.0;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float inBand = step(0.18, vBand) * step(vBand, 0.86);
        float mullion = 1.0 - step(0.022, fract(vRun / 0.62));
        gGlass = inBand * (1.0 - mullion);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(uGlass, uFrame, mullion), inBand);`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.06, gGlass);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.85, gGlass);");
  };
  return m;
}
const facade = facadeMaterial();
const patioFacade = facadeMaterial();

const NX = small ? 150 : 240, NZ = small ? 60 : 96;
function surface(fy, flip) {
  const geo = new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2, NX, NZ);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, fy(p.getX(i), p.getZ(i)));
  if (flip) { const idx = geo.index.array; for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; }
  geo.computeVertexNormals();
  return geo;
}
// Une bande verticale du bas au haut le long d'un chemin (façade extérieure, mur de patio).
function wall(points, bottom, roof) {
  const pos = [], band = [], run = [];
  let dist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const d = Math.hypot(x1 - x0, z1 - z0);
    const quad = [[x0, z0, dist, 0], [x1, z1, dist + d, 0], [x1, z1, dist + d, 1], [x0, z0, dist, 0], [x1, z1, dist + d, 1], [x0, z0, dist, 1]];
    for (const [x, z, r, b] of quad) {
      pos.push(x, b ? roof(x, z) : bottom(x, z), z);
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
const edge = (from, to, n) => Array.from({ length: n + 1 }, (_, i) => [from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n]);

// Les arbres de maquette : une boule blanche sur une tige.
const treeMat = new THREE.MeshStandardMaterial({ color: "#f3f2ee", roughness: 0.9 });
const trunkMat = new THREE.MeshStandardMaterial({ color: "#d9d7d0", roughness: 0.9 });
const crownGeo = new THREE.IcosahedronGeometry(1, 2), trunkGeo = new THREE.CylinderGeometry(0.03, 0.04, 1, 6);
function tree(x, z, size, base = 0) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.scale.y = size * 1.4; trunk.position.y = size * 0.7;
  const crown = new THREE.Mesh(crownGeo, treeMat);
  crown.scale.setScalar(size); crown.position.y = size * 1.4 + size * 0.7;
  trunk.castShadow = crown.castShadow = true;
  crown.receiveShadow = true;
  g.add(trunk, crown);
  g.position.set(x, base, z);
  return g;
}

const building = new THREE.Group();
for (const geo of [surface(top, false), surface(lift, true)]) {
  const mesh = new THREE.Mesh(geo, concrete);
  mesh.customDepthMaterial = concreteDepth;
  mesh.castShadow = mesh.receiveShadow = true;
  building.add(mesh);
}
const perimeter = [
  ...edge([-HALF_X, HALF_Z], [HALF_X, HALF_Z], NX), ...edge([HALF_X, HALF_Z], [HALF_X, -HALF_Z], NZ).slice(1),
  ...edge([HALF_X, -HALF_Z], [-HALF_X, -HALF_Z], NX).slice(1), ...edge([-HALF_X, -HALF_Z], [-HALF_X, HALF_Z], NZ).slice(1),
];
{
  const mesh = new THREE.Mesh(wall(perimeter, lift, top), facade);
  mesh.castShadow = mesh.receiveShadow = true;
  building.add(mesh);
}
// Les patios : un mur vitré circulaire et un jardin au fond.
const lawnMat = new THREE.MeshStandardMaterial({ color: "#b4c0a6", roughness: 1, emissive: "#9fb37c", emissiveIntensity: 0 });
for (const [px, pz, r] of PATIOS) {
  const ring = Array.from({ length: 73 }, (_, i) => [px + r * Math.cos(i / 72 * Math.PI * 2), pz + r * Math.sin(i / 72 * Math.PI * 2)]);
  const mesh = new THREE.Mesh(wall(ring, lift, top), patioFacade);
  mesh.receiveShadow = true;
  building.add(mesh);
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(r * 0.998, 72), lawnMat);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(px, Math.max(0.004, lift(px, pz) - 0.002), pz);
  lawn.receiveShadow = true;
  building.add(lawn);
  if (r > 0.95) building.add(tree(px + r * 0.2, pz - r * 0.1, 0.17, lift(px, pz)));
}
scene.add(building);

// Le terrain, le lac et les Alpes au loin.
const groundMat = new THREE.MeshStandardMaterial({ color: "#d3d4d0", roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 120), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.z = 20;
ground.receiveShadow = true;
scene.add(ground);
const lakeMat = new THREE.MeshStandardMaterial({ color: "#a9bcc7", roughness: 0.12, metalness: 0.35 });
const lake = new THREE.Mesh(new THREE.PlaneGeometry(260, 160), lakeMat);
lake.rotation.x = -Math.PI / 2;
lake.position.set(0, -0.02, -120);
scene.add(lake);
const shoreMat = new THREE.MeshStandardMaterial({ color: "#c9cbc5", roughness: 1 });
const shore = new THREE.Mesh(new THREE.PlaneGeometry(260, 2.2), shoreMat);
shore.rotation.x = -Math.PI / 2;
shore.position.set(0, -0.005, -40.6);
scene.add(shore);
const alpsMat = new THREE.MeshStandardMaterial({ color: "#c3cbd1", roughness: 1, flatShading: true });
{
  const geo = new THREE.PlaneGeometry(320, 26, 240, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      const x = p.getX(i);
      p.setY(i, 9 + 5 * Math.sin(x * 0.045 + 1.3) + 3.2 * Math.sin(x * 0.13 + 0.4) + 1.6 * Math.sin(x * 0.37) + 0.8 * Math.sin(x * 0.91 + 2));
    } else p.setY(i, -2);
  }
  geo.computeVertexNormals();
  const alps = new THREE.Mesh(geo, alpsMat);
  alps.position.set(0, 0, -150);
  scene.add(alps);
}
{
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Des bosquets plutôt qu'un semis régulier : quelques groupes autour du bâtiment et vers le lac.
  const groves = [[-20, 9], [-17, -10], [-4, -12], [6, -13], [19, -9], [22, 7], [4, 11], [-10, 12], [12, 12], [-26, -2], [27, -1]];
  for (const [gx, gz] of groves) {
    const n = 4 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) {
      const x = gx + (rand() - 0.5) * 5, z = gz + (rand() - 0.5) * 4;
      if (Math.abs(x) < HALF_X + 1.2 && Math.abs(z) < HALF_Z + 1.2) continue;
      scene.add(tree(x, z, 0.16 + rand() * 0.16));
    }
  }
}

// ==========================================================================================
// Les appareils : l'app, telle qu'elle est (captures avec des données d'exemple)
// ==========================================================================================
const loader = new THREE.TextureLoader();
const textures = {};
function shot(name) {
  if (textures[name]) return textures[name];
  const tex = loader.load(`shots/${name}.webp`, () => wake());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  textures[name] = tex;
  return tex;
}
function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
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
// Deux couches d'écran : la nouvelle capture apparaît par-dessus l'ancienne.
function screenPair(w, h, r, z, parent) {
  const geo = planeUV(new THREE.ShapeGeometry(roundedRect(w, h, r), 24));
  const a = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }));
  const b = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0 }));
  a.position.z = z; b.position.z = z + 0.0004;
  parent.add(a, b);
  return { a, b, current: null, fade: 1 };
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
  if (pair.fade >= 1) {
    pair.a.material.map = pair.b.material.map; pair.a.material.needsUpdate = true; pair.b.material.opacity = 0;
  }
  return true;
}

// L'iPhone : cadre en titane, verre noir, écran aux coins arrondis, Dynamic Island, bloc photo.
const titanium = new THREE.MeshPhysicalMaterial({ color: "#a39d93", metalness: 1, roughness: 0.28, clearcoat: 0.6, envMapIntensity: 2.4 });
const blackGlass = new THREE.MeshPhysicalMaterial({ color: "#060607", roughness: 0.08, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.6 });
const backGlass = new THREE.MeshPhysicalMaterial({ color: "#b9b3a8", roughness: 0.45, metalness: 0.1, clearcoat: 0.8, envMapIntensity: 1.4 });
const lensMat = new THREE.MeshPhysicalMaterial({ color: "#0b0c10", roughness: 0.05, metalness: 0.5, clearcoat: 1, envMapIntensity: 2 });
const phone = new THREE.Group();
const PW = 0.716, PH = 1.47, PR = 0.112, PD = 0.05, BEV = 0.012;
{
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(PW - 2 * BEV, PH - 2 * BEV, PR - BEV), {
    depth: PD, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 6, curveSegments: 28,
  }), titanium);
  body.position.z = -PD / 2;
  phone.add(body);
  const front = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(PW - 0.004, PH - 0.004, PR - 0.002), 28), blackGlass);
  front.position.z = PD / 2 + BEV + 0.0006;
  const back = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(PW - 0.004, PH - 0.004, PR - 0.002), 28), backGlass);
  back.position.z = -PD / 2 - BEV - 0.0006; back.rotation.y = Math.PI;
  phone.add(front, back);
  const island = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(0.205, 0.06, 0.03), 16), blackGlass);
  island.position.set(0, PH / 2 - 0.066, PD / 2 + BEV + 0.003);
  phone.add(island);
  const plateau = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(0.3, 0.3, 0.07), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 16 }), backGlass);
  plateau.position.set(-(PW / 2 - 0.2), PH / 2 - 0.2, -PD / 2 - BEV - 0.012);
  phone.add(plateau);
  for (const [dx, dy] of [[-0.065, 0.065], [-0.065, -0.065], [0.065, 0]]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.022, 32), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(-(PW / 2 - 0.2) + dx, PH / 2 - 0.2 + dy, -PD / 2 - BEV - 0.026);
    phone.add(lens);
  }
  for (const [y, h, side] of [[0.28, 0.16, -1], [0.1, 0.1, -1], [-0.02, 0.1, -1], [0.18, 0.22, 1]]) {
    const btn = new THREE.Mesh(new THREE.BoxGeometry(0.012, h, 0.03), titanium);
    btn.position.set(side * (PW / 2 + 0.003), y, 0);
    phone.add(btn);
  }
}
const phoneScreen = screenPair(PW - 0.05, PH - 0.05, PR - 0.022, PD / 2 + BEV + 0.0012, phone);
camera.add(phone);

// L'ordinateur portable : aluminium, écran 16:10 avec la version Windows.
const aluminium = new THREE.MeshPhysicalMaterial({ color: "#c7c9cd", metalness: 1, roughness: 0.34, clearcoat: 0.3, envMapIntensity: 2 });
const keysMat = new THREE.MeshStandardMaterial({ color: "#2a2c30", roughness: 0.7 });
const laptop = new THREE.Group();
const LW = 2.3, LD = 1.55, SH = (LW - 0.14) * 0.625;
const lid = new THREE.Group();
{
  const base = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(LW, LD, 0.08), { depth: 0.045, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 4, curveSegments: 16 }), aluminium);
  base.rotation.x = -Math.PI / 2;
  laptop.add(base);
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(LW * 0.86, LD * 0.42), keysMat);
  keys.rotation.x = -Math.PI / 2; keys.position.set(0, 0.0565, -LD * 0.12);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(LW * 0.34, LD * 0.26), new THREE.MeshStandardMaterial({ color: "#b9bbbf", roughness: 0.5, metalness: 0.6 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.0566, LD * 0.28);
  laptop.add(keys, pad);
  const lidH = SH + 0.16;
  const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(LW, lidH, 0.07), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 4, curveSegments: 16 }), aluminium);
  shell.position.set(0, lidH / 2, -0.03);
  const bezel = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(LW - 0.02, lidH - 0.02, 0.06), 16), blackGlass);
  bezel.position.set(0, lidH / 2, 0.0105);
  lid.add(shell, bezel);
  lid.position.set(0, 0.06, -LD / 2 + 0.02);
  lid.rotation.x = -0.26;
  laptop.add(lid);
  laptop.userData.lidH = lidH;
}
const laptopScreen = screenPair(LW - 0.14, SH, 0.01, 0.012, lid);
laptopScreen.a.position.y = laptopScreen.b.position.y = laptop.userData.lidH / 2 + 0.01;
camera.add(laptop);

// ==========================================================================================
// Lumière et thème
// ==========================================================================================
const hemi = new THREE.HemisphereLight("#ffffff", "#c9c9c4", 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff4e6", 3.3);
sun.castShadow = true;
sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
// Une lumière douce sur les appareils, attachée à la caméra.
const key = new THREE.DirectionalLight("#ffffff", 1.6);
key.position.set(-2, 3, 4);
camera.add(key);

function applyTheme() {
  const dark = darkQuery.matches;
  const bg = new THREE.Color(dark ? "#0f1114" : "#d9dad7");
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 30, 150);
  groundMat.color.set(dark ? "#15181c" : "#d3d4d0");
  concrete.color.set(dark ? "#33373d" : "#f1f0ec");
  for (const m of [facade, patioFacade]) {
    m.color.set(dark ? "#33373d" : "#f1f0ec");
    m.userData.glass.value.set(dark ? "#e2a35f" : "#6d7f8a");
    m.userData.frame.value.set(dark ? "#2a2d32" : "#e7e6e1");
  }
  lawnMat.color.set(dark ? "#33432f" : "#b4c0a6");
  lawnMat.emissiveIntensity = dark ? 0.4 : 0;
  lakeMat.color.set(dark ? "#141c24" : "#a9bcc7");
  shoreMat.color.set(dark ? "#1b1f24" : "#c9cbc5");
  alpsMat.color.set(dark ? "#1c2229" : "#c3cbd1");
  treeMat.color.set(dark ? "#3c4046" : "#f3f2ee");
  trunkMat.color.set(dark ? "#2c2f34" : "#d9d7d0");
  hemi.intensity = dark ? 0.3 : 0.55;
  hemi.groundColor.set(dark ? "#0b0c0e" : "#c9c9c4");
  sun.color.set(dark ? "#9db4d6" : "#fff4e6");
  sun.intensity = dark ? 0.9 : 3.3;
  key.intensity = dark ? 1.1 : 1.6;
}

// ==========================================================================================
// Le parcours : un arrêt par section
// ==========================================================================================
// pos/look : la caméra sur la maquette ; shift : décalage horizontal de l'image ; phone / laptop :
// où l'appareil se tient à l'écran (x, y en NDC, d profondeur, ry/rx rotations), quelle capture,
// et s'il est là (on).
const D = (x, y, d, ry, rx, screen, on = 1) => ({ x, y, d, ry, rx, screen, on });
const OFF_PHONE = D(0.45, -1.6, 5.4, -0.3, 0.2, null, 0);
const OFF_LAPTOP = D(0.4, -1.8, 7.5, -0.3, 0.3, null, 0);
const STOPS = [
  { pos: [-9, 15, 31], look: [2, 0, -3], shift: 0.34, phone: D(0.5, -0.04, 5.2, -0.42, 0.04, "iphone-today"), laptop: OFF_LAPTOP },
  { pos: [-14, 3.8, 9], look: [-7.5, 0.9, 0], shift: 0, phone: D(0.46, -0.02, 5.0, -0.26, 0.02, "iphone-courses"), laptop: OFF_LAPTOP },
  { pos: [-4.5, 5, 9.5], look: [0, 1.4, 0], shift: 0, phone: { ...OFF_PHONE, x: -0.45 }, laptop: D(-0.42, -0.1, 7.2, 0.42, 0.36, "windows-stats") },
  { pos: [2, 2.8, 7], look: [4.5, 1.2, -0.4], shift: 0, phone: D(0.46, -0.02, 5.0, -0.3, 0.02, "iphone-tutor"), laptop: OFF_LAPTOP },
  { pos: [9, 6.5, 9.5], look: [8, 0.8, 0.3], shift: 0, phone: D(-0.46, -0.02, 5.0, 0.32, 0.02, "iphone-groups"), laptop: OFF_LAPTOP },
  { pos: [17, 5.5, 10], look: [10, 1.4, 0], shift: 0, phone: D(0.68, -0.18, 4.6, -0.36, 0.04, "iphone-today"), laptop: D(0.38, 0.02, 8.2, -0.3, 0.32, "windows-today") },
  { pos: [0.01, 34, 3], look: [0, 0, -2], shift: 0, phone: OFF_PHONE, laptop: OFF_LAPTOP },
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
  wantPos.sub(wantLook).multiplyScalar(portrait() ? 1.55 : 1).add(wantLook);
  shiftWant = portrait() ? 0 : lerp(A.shift, B.shift);
  // En portrait, la scène monte dans le haut de l'écran : le texte garde le bas.
  liftWant = portrait() ? 0.2 : 0;
  const heroWeight = (ia === 0 ? 1 - t : 0) + (ib === 0 ? t : 0);
  for (const name of ["phone", "laptop"]) {
    const a = A[name], b = B[name], w = devWant[name];
    for (const k of ["x", "y", "d", "ry", "rx", "on"]) w[k] = lerp(a[k], b[k]);
    // L'écran change à mi-chemin ; un appareil qui s'en va garde sa capture.
    w.screen = (t < 0.5 ? a.screen : b.screen) ?? a.screen ?? b.screen;
    if (portrait()) {
      // En portrait, seul l'accueil montre l'iPhone, au-dessus du titre.
      if (name === "phone") Object.assign(w, { x: 0.22, y: 0.5, d: 10.5, ry: -0.36, rx: 0.08, on: heroWeight, screen: "iphone-today" });
      else w.on = 0;
    }
  }
}

// ==========================================================================================
// Pointeur : le soleil, et l'appareil qui suit un peu le regard
// ==========================================================================================
const sunWant = { az: -2.3, el: 0.5 }, sunNow = { ...sunWant };
const tilt = { x: 0, y: 0 }, tiltNow = { x: 0, y: 0 };
if (!reduced) {
  addEventListener("pointermove", (e) => {
    const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5;
    sunWant.az = -2.3 + nx * 1.4;
    sunWant.el = 0.5 - ny * 0.3;
    tilt.x = nx * 0.16; tilt.y = ny * 0.1;
    wake();
  }, { passive: true });
}
function placeSun() {
  const r = 34;
  sun.position.set(camLook.x + r * Math.cos(sunNow.el) * Math.sin(sunNow.az), r * Math.sin(sunNow.el), camLook.z + r * Math.cos(sunNow.el) * Math.cos(sunNow.az));
  sun.target.position.copy(camLook);
}

function placeDevice(group, s) {
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * s.d;
  const halfW = halfH * camera.aspect;
  // La position voulue à l'écran, corrigée du décalage d'image (setViewOffset).
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
  for (const name of ["x", "y", "d", "ry", "rx", "on"]) {
    const diff = want[name] - state[name];
    if (Math.abs(diff) > 1e-4) { state[name] += diff * k; moving = true; }
  }
  return moving;
}

function frame() {
  running = false;
  if (!visible || document.hidden) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const k = reduced ? 1 : 1 - Math.exp(-dt * 4.5);
  let moving = false;

  if (camPos.distanceToSquared(wantPos) > 1e-6 || camLook.distanceToSquared(wantLook) > 1e-6) {
    camPos.lerp(wantPos, k); camLook.lerp(wantLook, k); moving = true;
  }
  if (Math.abs(shiftNow - shiftWant) + Math.abs(liftNow - liftWant) > 1e-4) {
    shiftNow += (shiftWant - shiftNow) * k; liftNow += (liftWant - liftNow) * k; moving = true;
  }
  if (Math.abs(sunNow.az - sunWant.az) + Math.abs(sunNow.el - sunWant.el) > 1e-4) {
    sunNow.az += (sunWant.az - sunNow.az) * k; sunNow.el += (sunWant.el - sunNow.el) * k; moving = true;
  }
  if (Math.abs(tiltNow.x - tilt.x) + Math.abs(tiltNow.y - tilt.y) > 1e-4) {
    tiltNow.x += (tilt.x - tiltNow.x) * k * 0.6; tiltNow.y += (tilt.y - tiltNow.y) * k * 0.6; moving = true;
  }
  camera.setViewOffset(innerWidth, innerHeight, -shiftNow * innerWidth, liftNow * innerHeight, innerWidth, innerHeight);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  placeSun();

  if (approach(devState.phone, devWant.phone, k)) moving = true;
  if (approach(devState.laptop, devWant.laptop, k)) moving = true;
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

// Sous la section de téléchargement, plus rien à dessiner.
const cover = document.querySelector("[data-covers-slab]");
const coverCheck = () => { visible = !cover || cover.getBoundingClientRect().top > 0; };
addEventListener("scroll", () => { coverCheck(); scrollTarget(); wake(); }, { passive: true });
addEventListener("resize", resize);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { clock.getDelta(); wake(); } });
darkQuery.addEventListener("change", () => { applyTheme(); wake(); });

applyTheme();
coverCheck();
camera.aspect = innerWidth / innerHeight;
scrollTarget();
snap();
resize();
document.documentElement.classList.add("slab-ready");
