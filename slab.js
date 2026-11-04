// La dalle : le semestre posé comme le sol du Rolex Learning Center. Quatorze travées pour
// quatorze semaines, les collines où les semaines pèsent, les patios où tombent les rendus,
// et les cours posés dans leur semaine. Le défilement promène la caméra de semaine en semaine ;
// le pointeur déplace le soleil. Rien ne tourne quand rien ne bouge.
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
renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

// --- Le relief -------------------------------------------------------------------------
const HALF_X = 14, HALF_Z = 5.6, T = 0.55, BAY = 2;
const weekX = (w) => -HALF_X + BAY * (w - 0.5);
// Les semaines qui pèsent : la première vague de séries, les midterms, la fin du semestre.
const HILLS = [
  { x: weekX(4.2), z: -1.2, sx: 2.3, sz: 2.6, h: 1.05 },
  { x: weekX(7.6), z: 1.4, sx: 2.6, sz: 3.0, h: 1.65 },
  { x: weekX(12.8), z: -0.6, sx: 2.4, sz: 3.4, h: 2.05 },
];
const lift = (x, z) => {
  let y = 0.06 * Math.sin(x * 0.55) * Math.cos(z * 0.7) + 0.06;
  for (const hill of HILLS) {
    y += hill.h * Math.exp(-(((x - hill.x) ** 2) / (2 * hill.sx ** 2) + ((z - hill.z) ** 2) / (2 * hill.sz ** 2)));
  }
  return Math.max(0, y);
};
const top = (x, z) => lift(x, z) + T;
// Les patios : là où tombent les rendus (semaines 3, 6, 9, 11, 14).
const PATIOS = [
  [weekX(3), 2.1, 1.0], [weekX(6.2), -2.6, 1.2], [weekX(9.1), 2.3, 1.05], [weekX(11.2), -2.2, 0.9], [weekX(13.9), 2.6, 0.75],
];
const inPatio = (x, z, pad = 0) => PATIOS.some(([px, pz, r]) => (x - px) ** 2 + (z - pz) ** 2 < (r + pad) ** 2);

// --- Matériaux --------------------------------------------------------------------------
const patioUniform = { value: PATIOS.map(([x, z, r]) => new THREE.Vector4(x, z, r, 0)) };
const bayUniform = { value: new THREE.Color("#c8c8c2") };
function carvePatios(material, withBays) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPatios = patioUniform;
    shader.uniforms.uBay = bayUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;\nuniform vec4 uPatios[5];\nuniform vec3 uBay;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        for (int i = 0; i < 5; i++) {
          if (distance(vWorld.xz, uPatios[i].xy) < uPatios[i].z) discard;
        }`);
    if (withBays) {
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        float bay = abs(fract((vWorld.x + ${HALF_X.toFixed(1)}) / ${BAY.toFixed(1)} + 0.5) - 0.5) * ${BAY.toFixed(1)};
        float joint = 1.0 - smoothstep(0.0, 0.025, bay);
        float grid = 1.0 - smoothstep(0.0, 0.012, abs(fract(vWorld.z * 1.25 + 0.5) - 0.5) / 1.25);
        diffuseColor.rgb = mix(diffuseColor.rgb, uBay, max(joint * 0.9, grid * 0.25));`);
    }
  };
}
const slabMat = new THREE.MeshStandardMaterial({ color: "#f2f1ed", roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
carvePatios(slabMat, true);
const slabDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
carvePatios(slabDepth, false);

// --- La dalle : dessus, dessous, chants --------------------------------------------------
const NX = small ? 160 : 260, NZ = small ? 64 : 104;
function surface(fy, flip) {
  const geo = new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2, NX, NZ);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, fy(p.getX(i), p.getZ(i)));
  if (flip) { const idx = geo.index.array; for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; }
  geo.computeVertexNormals();
  return geo;
}
function skirt(points) {
  const pos = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    pos.push(x0, lift(x0, z0), z0, x1, lift(x1, z1), z1, x1, top(x1, z1), z1);
    pos.push(x0, lift(x0, z0), z0, x1, top(x1, z1), z1, x0, top(x0, z0), z0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
const edge = (from, to, n) => Array.from({ length: n + 1 }, (_, i) => [from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n]);
const slab = new THREE.Group();
for (const geo of [
  surface(top, false), surface(lift, true),
  skirt(edge([-HALF_X, HALF_Z], [HALF_X, HALF_Z], NX)), skirt(edge([HALF_X, -HALF_Z], [-HALF_X, -HALF_Z], NX)),
  skirt(edge([-HALF_X, -HALF_Z], [-HALF_X, HALF_Z], NZ)), skirt(edge([HALF_X, HALF_Z], [HALF_X, -HALF_Z], NZ)),
]) {
  const mesh = new THREE.Mesh(geo, slabMat);
  mesh.customDepthMaterial = slabDepth;
  mesh.castShadow = mesh.receiveShadow = true;
  slab.add(mesh);
}
scene.add(slab);

// Les patios vitrés : un cylindre ouvert qui épouse le dessus et le dessous de la dalle.
const glassMat = new THREE.MeshStandardMaterial({
  color: "#7fa3b8", roughness: 0.04, metalness: 0.65, envMapIntensity: 2.2, transparent: true, opacity: 0.72,
  side: THREE.DoubleSide, emissive: "#ffb76b", emissiveIntensity: 0, depthWrite: false,
});
// Le fond de chaque patio : un jardin (comme au Rolex Center), allumé le soir.
const lawnMat = new THREE.MeshStandardMaterial({ color: "#a9b79a", roughness: 1, emissive: "#ffcf96", emissiveIntensity: 0 });
for (const [px, pz, r] of PATIOS) {
  const geo = new THREE.CylinderGeometry(r, r, 1, 64, 1, true);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + px, z = p.getZ(i) + pz;
    p.setY(i, p.getY(i) > 0 ? top(x, z) : lift(x, z));
  }
  geo.computeVertexNormals();
  const glass = new THREE.Mesh(geo, glassMat);
  glass.position.set(px, 0, pz);
  glass.renderOrder = 2;
  scene.add(glass);
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(r * 0.995, 64), lawnMat);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(px, Math.max(0.004, lift(px, pz) - 0.002), pz);
  lawn.receiveShadow = true;
  scene.add(lawn);
}

// Le sol, qui se fond dans la page.
const groundMat = new THREE.MeshStandardMaterial({ color: "#dcdcd8", roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- Les cours, posés dans leur semaine (données d'exemple) -------------------------------
const COURSES = [
  { color: "#5b4fb3", z: -3.9 }, // CS-250
  { color: "#2e7a8c", z: -1.3 }, // MATH-101
  { color: "#2f7356", z: 1.3 },  // PHYS-101
  { color: "#a66a2c", z: 3.9 },  // PROJ-101
];
const LATE = new THREE.Color("#ff5a1f");
const CURRENT_WEEK = 8;
const items = [];
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let w = 1; w <= 14; w++) {
  COURSES.forEach((course, lane) => {
    const kinds = rand() < 0.75 ? ["series", "theory"] : ["series"];
    kinds.forEach((kind, k) => {
      let x = weekX(w) + (k === 0 ? -0.38 : 0.38), z = course.z + (rand() - 0.5) * 0.5;
      if (inPatio(x, z, 0.35)) z += z > 0 ? -1.1 : 1.1;
      const late = w < CURRENT_WEEK && rand() < 0.22;
      items.push({ kind, x, z, w, lane, color: late ? LATE : new THREE.Color(course.color), late });
    });
  });
}
const SIZE = 0.24;
const boxGeo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
const ballGeo = new THREE.SphereGeometry(SIZE * 0.55, 24, 16);
const itemMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
const series = items.filter((i) => i.kind === "series"), theory = items.filter((i) => i.kind === "theory");
const seriesMesh = new THREE.InstancedMesh(boxGeo, itemMat, series.length);
const theoryMesh = new THREE.InstancedMesh(ballGeo, itemMat, theory.length);
for (const [mesh, list] of [[seriesMesh, series], [theoryMesh, theory]]) {
  mesh.castShadow = true;
  list.forEach((item, i) => {
    mesh.setColorAt(i, item.color);
    const n = normalAt(item.x, item.z);
    item.rest = new THREE.Vector3(item.x, top(item.x, item.z) + SIZE * (item.kind === "series" ? 0.5 : 0.55), item.z);
    item.quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    item.delay = 0.35 + item.w * 0.09 + item.lane * 0.05 + rand() * 0.15;
  });
  scene.add(mesh);
}
function normalAt(x, z) {
  const e = 0.05;
  return new THREE.Vector3(top(x - e, z) - top(x + e, z), 2 * e, top(x, z - e) - top(x, z + e)).normalize();
}

// Les gens d'un groupe : ils arrivent dans la travée 10 quand on parle de groupes.
const people = [];
const personGeo = new THREE.CapsuleGeometry(0.075, 0.16, 4, 12);
const headGeo = new THREE.SphereGeometry(0.06, 16, 12);
const personMat = new THREE.MeshStandardMaterial({ color: "#15171a", roughness: 0.6 });
[[0, -0.5], [0.45, -0.1], [-0.4, 0.2], [0.2, 0.55], [-0.15, -0.95], [0.75, 0.6]].forEach(([dx, dz], i) => {
  const x = weekX(10) + dx, z = 0.3 + dz;
  const m = new THREE.Group();
  const body = new THREE.Mesh(personGeo, personMat), head = new THREE.Mesh(headGeo, personMat);
  body.position.y = 0.155; head.position.y = 0.4;
  body.castShadow = head.castShadow = true;
  m.add(body, head);
  m.position.set(x, top(x, z), z);
  m.scale.setScalar(0.001);
  m.visible = false;
  m.userData.delay = i * 0.12;
  people.push(m);
  scene.add(m);
});

// Les heures : une colonne de plaques (une par heure) qui monte dans la travée 7.
const HOURS = [["#5b4fb3", 5], ["#a66a2c", 5], ["#2f7356", 2]];
const plates = [];
{
  const x = weekX(7) - 0.1, z = -0.4, base = top(x, z);
  const plateGeo = new THREE.BoxGeometry(0.62, 0.075, 0.62);
  let n = 0;
  for (const [color, count] of HOURS) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    for (let i = 0; i < count; i++, n++) {
      const m = new THREE.Mesh(plateGeo, mat);
      m.castShadow = m.receiveShadow = true;
      m.position.set(x, base + 0.04 + n * 0.085, z);
      m.scale.setScalar(0.001);
      m.visible = false;
      m.userData.order = n;
      plates.push(m);
      scene.add(m);
    }
  }
}

// Partout : trois appareils dressés sur la dernière colline, l'app à l'écran.
const devices = new THREE.Group();
const DEVICE_X = weekX(12.4), DEVICE_Z = 0.4;
{
  const loader = new THREE.TextureLoader();
  const screen = (file) => {
    const tex = loader.load(file, () => { dirty = true; wake(); });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  };
  const body = new THREE.MeshStandardMaterial({ color: "#1b1d21", roughness: 0.35, metalness: 0.4 });
  const add = (w, h, d, file, x, z, tilt) => {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, d), body);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screen(file));
    face.position.z = d / 2 + 0.002;
    frame.castShadow = true;
    g.add(frame, face);
    g.position.set(x, h / 2 + 0.05, z);
    g.rotation.x = -tilt;
    return g;
  };
  // Le moniteur (Windows), l'ordinateur portable (son écran), le téléphone.
  const monitor = add(1.6, 1.0, 0.05, "shots/windows-today.webp", 0, 0, 0.05);
  monitor.position.y += 0.18;
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), body);
  stand.position.set(0, 0.15, -0.05);
  const laptop = add(1.05, 0.66, 0.035, "shots/windows-stats.webp", 1.35, 0.55, 0.22);
  laptop.rotation.y = -0.45;
  const keys = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.035, 0.7), body);
  keys.position.set(1.42, 0.02, 0.85); keys.rotation.y = -0.45; keys.castShadow = true;
  const phone = add(0.34, 0.74, 0.04, "shots/iphone-today.webp", -1.05, 0.6, 0.12);
  phone.rotation.y = 0.35;
  devices.add(monitor, stand, laptop, keys, phone);
  devices.position.set(DEVICE_X, top(DEVICE_X, DEVICE_Z), DEVICE_Z);
  devices.rotation.y = -0.35;
  devices.scale.set(1, 0.001, 1);
  devices.visible = false;
  scene.add(devices);
}

// --- Lumière --------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight("#ffffff", "#c9c9c4", 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff6ea", 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 80 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// --- Thème : le jour, ou le soir où les patios s'allument --------------------------------
function applyTheme() {
  const dark = darkQuery.matches;
  const bg = new THREE.Color(dark ? "#0f1114" : "#d9dad7");
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 34, 95);
  groundMat.color.set(dark ? "#15181c" : "#d3d4d0");
  slabMat.color.set(dark ? "#34383e" : "#efeeea");
  bayUniform.value.set(dark ? "#4a4f56" : "#c8c8c2");
  // Le soir, la lumière des patios monte du jardin et éclaire le verre de l'intérieur.
  glassMat.emissive.set(dark ? "#e8a35c" : "#000000");
  glassMat.emissiveIntensity = dark ? 0.55 : 0;
  glassMat.opacity = dark ? 0.5 : 0.72;
  lawnMat.color.set(dark ? "#33432f" : "#a9b79a");
  lawnMat.emissive.set(dark ? "#9fb37c" : "#000000");
  lawnMat.emissiveIntensity = dark ? 0.45 : 0;
  hemi.intensity = dark ? 0.3 : 0.55;
  hemi.groundColor.set(dark ? "#0b0c0e" : "#c9c9c4");
  sun.color.set(dark ? "#9db4d6" : "#fff6ea");
  sun.intensity = dark ? 1.1 : 3.4;
  personMat.color.set(dark ? "#eceae4" : "#15171a");
  renderer.toneMappingExposure = dark ? 1.05 : 1.0;
  dirty = true;
}

// --- Caméra : un arrêt par section ---------------------------------------------------------
// `shift` : de combien décaler l'image (fraction de la largeur) pour laisser la place au texte ;
// positif pousse la dalle vers la droite (texte à gauche).
const STOPS = [
  { pos: [-6, 13, 25], look: [0.5, 0.4, 0], shift: 0.54, down: 0.1, portrait: 1.15, up: 0.2 }, // accueil : toute la dalle
  { pos: [-13, 3.6, 8.5], look: [-7.5, 0.9, 0], shift: 0.28 },    // import : semaines 1 à 4
  { pos: [-6.5, 4.6, 7.8], look: [weekX(7) - 0.1, 1.9, -0.4], shift: -0.24, portrait: 1.5, up: 0.12 }, // heures : la colonne
  { pos: [0.4, 2.9, 6.4], look: [weekX(9), 1.2, -0.6], shift: 0.28 }, // mode étude : semaine 9
  { pos: [9.5, 7.2, 9.5], look: [weekX(10), 0.7, 0.3], shift: -0.24, portrait: 1.25, up: 0.18 }, // groupes
  { pos: [DEVICE_X + 3.2, top(DEVICE_X, DEVICE_Z) + 2.2, DEVICE_Z + 6.2], look: [DEVICE_X + 0.2, top(DEVICE_X, DEVICE_Z) + 0.6, DEVICE_Z], shift: 0.26, portrait: 1.5, up: 0.14 }, // partout
  { pos: [0.01, 30, 2.5], look: [0, 0, 0], shift: 0, portrait: 1.15, up: 0.12, turn: 1 }, // le plan
];
const sections = [...document.querySelectorAll("[data-cam]")];
const camPos = new THREE.Vector3(...STOPS[0].pos), camLook = new THREE.Vector3(...STOPS[0].look);
const wantPos = camPos.clone(), wantLook = camLook.clone();
let shiftNow = STOPS[0].shift, shiftWant = shiftNow, liftNow = 0, liftWant = 0;
let groupsShown = 0, hoursShown = 0, devicesShown = 0, importShown = 0, turnNow = 0, turnWant = 0;
const ease = (t) => t * t * (3 - 2 * t);

function scrollTarget() {
  const mid = scrollY + innerHeight * 0.5;
  const centers = sections.map((s) => s.offsetTop + s.offsetHeight * 0.5);
  let i = 0;
  while (i < centers.length - 1 && mid > centers[i + 1]) i++;
  const a = +sections[i].dataset.cam, b = +sections[Math.min(i + 1, sections.length - 1)].dataset.cam;
  const span = (centers[i + 1] ?? centers[i] + 1) - centers[i];
  const t = i === centers.length - 1 ? 0 : ease(Math.min(1, Math.max(0, (mid - centers[i]) / span)));
  const A = STOPS[a], B = STOPS[b];
  const pick = (key, fallback) => (A[key] ?? fallback) + ((B[key] ?? fallback) - (A[key] ?? fallback)) * t;
  const portrait = camera.aspect < 0.9 ? pick("portrait", 1.75) : camera.aspect < 1.3 ? 1.25 : 1;
  for (const [out, key] of [[wantPos, "pos"], [wantLook, "look"]]) {
    out.set(A[key][0] + (B[key][0] - A[key][0]) * t, A[key][1] + (B[key][1] - A[key][1]) * t, A[key][2] + (B[key][2] - A[key][2]) * t);
  }
  // En portrait, reculer le long de l'axe de visée pour garder la travée entière.
  wantPos.sub(wantLook).multiplyScalar(portrait).add(wantLook);
  // Le décalage ne sert qu'en largeur : en portrait le texte passe au-dessus de la dalle.
  shiftWant = camera.aspect < 1.1 ? 0 : A.shift + (B.shift - A.shift) * t;
  // Vertical : en largeur la dalle descend un peu (`down`) ; en portrait elle monte au-dessus du texte (`up`).
  liftWant = camera.aspect < 1.1 ? pick("up", -0.12) : pick("down", 0);
  const weight = (stop) => (a === stop ? 1 - t : 0) + (b === stop ? t : 0);
  groupsShown = weight(4);
  hoursShown = weight(2);
  devicesShown = weight(5);
  importShown = weight(1);
  // En portrait, le plan tourne d'un quart : la dalle court de haut en bas.
  turnWant = camera.aspect < 1.1 ? pick("turn", 0) : 0;
  return wantLook.x;
}

// La règle des semaines en bas de l'écran suit la travée visée.
const ruler = document.querySelector(".ruler");
const rulerMarks = ruler ? [...ruler.querySelectorAll("li")] : [];
let shownWeek = 0;
function updateRuler(x) {
  const week = Math.min(14, Math.max(1, Math.round((x + HALF_X) / BAY + 0.5)));
  if (week === shownWeek) return;
  shownWeek = week;
  rulerMarks.forEach((li, i) => li.classList.toggle("on", i + 1 === week));
}

// --- Soleil au pointeur -------------------------------------------------------------------
const sunWant = { az: -2.35, el: 0.5 }, sunNow = { ...sunWant };
function placeSun() {
  const r = 30, target = camLook;
  sun.position.set(target.x + r * Math.cos(sunNow.el) * Math.sin(sunNow.az), r * Math.sin(sunNow.el), target.z + r * Math.cos(sunNow.el) * Math.cos(sunNow.az));
  sun.target.position.copy(target);
}
if (!reduced) {
  addEventListener("pointermove", (e) => {
    sunWant.az = -2.35 + (e.clientX / innerWidth - 0.5) * 1.6;
    sunWant.el = 0.5 - (e.clientY / innerHeight - 0.5) * 0.35;
    wake();
  }, { passive: true });
}

// --- Boucle ----------------------------------------------------------------------------
const clock = new THREE.Clock();
let introStart = null, introDone = reduced, dirty = true, running = false, visible = true;
const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();

// `time` : secondes depuis le début de l'intro ; `importAt` : quand la caméra s'est posée sur
// l'import (les semaines 1 à 4 retombent alors dans leur travée).
let importAt = null;
function placeItems(time, now) {
  let pending = false;
  for (const [mesh, list] of [[seriesMesh, series], [theoryMesh, theory]]) {
    list.forEach((item, i) => {
      let t = introDone ? 1 : Math.min(1, Math.max(0, (time - item.delay) / 0.7));
      if (importAt !== null && item.w <= 4) {
        const local = now - importAt - (item.w - 1) * 0.16 - item.lane * 0.06;
        t = Math.min(t, Math.min(1, Math.max(0, local / 0.75)));
      }
      if (t < 1) pending = true;
      const fall = 1 - (1 - t) ** 3;
      v3.copy(item.rest); v3.y += (1 - fall) * 7;
      s3.setScalar(t === 0 ? 0.001 : 1);
      mesh.setMatrixAt(i, m4.compose(v3, item.quat, s3));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  return pending;
}

let peopleNow = 0, hoursNow = 0, devicesNow = 0;
function frame() {
  running = false;
  if (!visible || document.hidden) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  let moving = false;

  const k = reduced ? 1 : 1 - Math.exp(-dt * 4.5);
  if (camPos.distanceToSquared(wantPos) > 1e-6 || camLook.distanceToSquared(wantLook) > 1e-6) {
    camPos.lerp(wantPos, k); camLook.lerp(wantLook, k); moving = true;
  }
  if (Math.abs(shiftNow - shiftWant) + Math.abs(liftNow - liftWant) > 1e-4) {
    shiftNow += (shiftWant - shiftNow) * k; liftNow += (liftWant - liftNow) * k; moving = true;
  }
  applyShift();
  if (Math.abs(turnNow - turnWant) > 1e-4) { turnNow += (turnWant - turnNow) * k; moving = true; }
  camera.up.set(Math.sin(turnNow * Math.PI / 2), Math.cos(turnNow * Math.PI / 2), 0);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  if (Math.abs(sunNow.az - sunWant.az) + Math.abs(sunNow.el - sunWant.el) > 1e-4) {
    sunNow.az += (sunWant.az - sunNow.az) * k; sunNow.el += (sunWant.el - sunNow.el) * k; moving = true;
  }
  placeSun();

  const now = clock.elapsedTime;
  if (!reduced && introDone) {
    if (importShown > 0.7 && importAt === null) importAt = now;
    if (importShown < 0.15 && importAt !== null && now - importAt > 2.5) importAt = null;
  }
  if (!introDone) {
    introStart ??= now;
    introDone = !placeItems(now - introStart, now);
    moving = true;
  } else if (importAt !== null && now - importAt < 2.6) {
    placeItems(99, now);
    moving = true;
  }

  if (Math.abs(hoursNow - hoursShown) > 1e-3) {
    hoursNow += (hoursShown - hoursNow) * (reduced ? 1 : k * 0.7);
    plates.forEach((m) => {
      const t = Math.min(1, Math.max(0, hoursNow * (plates.length + 3) - m.userData.order));
      m.scale.setScalar(Math.max(0.001, 1 - (1 - t) ** 3));
      m.visible = t > 0;
    });
    moving = true;
  }
  if (Math.abs(devicesNow - devicesShown) > 1e-3) {
    devicesNow += (devicesShown - devicesNow) * (reduced ? 1 : k * 0.8);
    devices.scale.y = Math.max(0.001, 1 - (1 - Math.min(1, devicesNow * 1.4)) ** 3);
    devices.visible = devicesNow > 0.01;
    moving = true;
  }

  const wantPeople = groupsShown;
  if (Math.abs(peopleNow - wantPeople) > 1e-3) {
    peopleNow += (wantPeople - peopleNow) * (reduced ? 1 : k * 0.8);
    people.forEach((p) => {
      const t = Math.min(1, Math.max(0, (peopleNow - p.userData.delay * 0.5) / 0.6));
      p.scale.setScalar(Math.max(0.001, 1 - (1 - t) ** 3));
      p.visible = t > 0;
    });
    moving = true;
  }

  renderer.render(scene, camera);
  dirty = false;
  if (moving) wake();
}
function wake() {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
}

function applyShift() {
  const w = innerWidth, h = innerHeight;
  // liftNow > 0 : la dalle monte dans l'image ; < 0 : elle descend.
  camera.setViewOffset(w, h, -shiftNow * w, liftNow * h, w, h);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateRuler(scrollTarget());
  if (reduced) { camPos.copy(wantPos); camLook.copy(wantLook); shiftNow = shiftWant; liftNow = liftWant; }
  applyShift();
  wake();
}

// La dalle s'efface sous la section de téléchargement : plus rien à dessiner.
const cover = document.querySelector("[data-covers-slab]");
const coverCheck = () => {
  const coverTop = cover ? cover.getBoundingClientRect().top : Infinity;
  visible = coverTop > 0;
  document.documentElement.classList.toggle("slab-covered", coverTop < innerHeight * 0.9);
};
addEventListener("scroll", () => { coverCheck(); updateRuler(scrollTarget()); wake(); }, { passive: true });
addEventListener("resize", resize);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { clock.getDelta(); wake(); } });
darkQuery.addEventListener("change", () => { applyTheme(); wake(); });
coverCheck();

placeItems(reduced ? 99 : 0, 0);
applyTheme();
scrollTarget();
camPos.copy(wantPos); camLook.copy(wantLook); shiftNow = shiftWant; liftNow = liftWant;
resize();
document.documentElement.classList.add("slab-ready");
