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
  renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 1.5, alpha: false, powerPreference: "high-performance" });
} catch {
  root.classList.add("no-webgl", "intro-done");
  throw new Error("WebGL indisponible");
}
const DPR_HI = Math.min(devicePixelRatio, 2);
// Le canevas garde une taille fixe : le réallouer à chaque arrêt coûte plus que dessiner. En mouvement,
// la scène passe par une image plus petite, agrandie à l'écran (voir fast) ; l'iPhone reste net.
let dprNow = DPR_HI;
let dprFast = Math.min(devicePixelRatio, small ? 1 : 1.35);
renderer.setPixelRatio(dprNow);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
let stale = true;                                    // l'image affichée n'est plus à jour
const shadowsDirty = () => { renderer.shadowMap.needsUpdate = true; stale = true; };

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
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.09;
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
  // Le relief fin : un sommet sur deux suffit sous la photo (un quart des triangles).
  const stride = g > 400 ? 2 : 1;
  const geo = new THREE.PlaneGeometry(size, size, (g - 1) / stride, (g - 1) / stride);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const u = x / size + 0.5, v = 0.5 - z / size;
    const col = Math.round(u * (g - 1)), row = Math.round(v * (g - 1));
    let h = heights[row * g + col] * (layer.scale ?? 1) / UNIT * EXAG;
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
// Les grandes images se décodent hors du fil principal quand le navigateur sait les retourner.
const safari = /Version\/(\d+).*Safari/.exec(navigator.userAgent);
const offThread = typeof createImageBitmap === "function" && (!safari || +safari[1] >= 17);
const loader = new THREE.TextureLoader();
const bitmaps = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
function loadTex(url) {
  const ready = (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  return new Promise((resolve, reject) => {
    if (!offThread) return loader.load(url, (t) => resolve(ready(t)), undefined, reject);
    bitmaps.load(url, (image) => {
      const t = new THREE.Texture(image);
      t.flipY = false;
      t.needsUpdate = true;
      resolve(ready(t));
    }, undefined, reject);
  });
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
const night = { value: 0 };
const nearPhoto = { value: null }, nearBox = { value: new THREE.Vector4(0, 0, 1, 0) };
const wallTone = { value: new THREE.Color("#e7e3da") };
const roofTone = { value: new THREE.Color("#c4bcb6") };
const campusMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, side: THREE.DoubleSide });
campusMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, { uStyles: styleMap, uNight: night, uNear: nearPhoto, uNearBox: nearBox, uHi: hiPhoto, uHiBox: hiBox, uHasHi: hasHi, uWall: wallTone, uRoof: roofTone });
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vLocal;\nvarying vec3 vUp;\nvarying vec2 vSpan;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;\nvUp = normal;\nvSpan = uv;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
      varying vec3 vLocal;
      varying vec3 vUp;
      varying vec2 vSpan;
      uniform float uNight, uHasHi;
      uniform sampler2D uNear, uHi, uStyles;
      uniform vec4 uNearBox, uHiBox;
      uniform vec3 uWall, uRoof;
      float gGlass = 0.0, gGloss = 0.0, gLit = 0.0;
      vec3 gTilt = vec3(0.0);
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float band(float t, float a, float b, float w) { return smoothstep(a - w, a + w, t) * (1.0 - smoothstep(b - w, b + w, t)); }`)
    .replace("#include <color_fragment>", `#include <color_fragment>
      vec3 up = normalize(vUp);
      float roof = smoothstep(0.42, 0.62, abs(up.y));
      vec2 su = vLocal.xz / 220.0 + 0.5;
      float st = all(greaterThan(su, vec2(0.0))) && all(lessThan(su, vec2(1.0))) ? floor(texture2D(uStyles, su).r * 255.0 + 0.5) : 0.0;
      float below = vSpan.x - vLocal.y, above = vLocal.y - vSpan.y;
      float run = abs(up.x) > abs(up.z) ? vLocal.z : vLocal.x;
      float wr = fwidth(run), wy = fwidth(vLocal.y);
      float dim = uWall.g / 0.77;
      // La photo aérienne, la plus fine qui couvre ce point.
      vec2 hu = (vLocal.xz - uHiBox.xy) / (uHiBox.zw - uHiBox.xy);
      bool hi = uHasHi > 0.5 && min(min(hu.x, 1.0 - hu.x), min(hu.y, 1.0 - hu.y)) > 0.0;
      vec3 top = hi ? texture2D(uHi, hu).rgb : texture2D(uNear, (vLocal.xz - uNearBox.xy) / uNearBox.z + 0.5).rgb;
      vec3 wall;
      if (st == 1.0) {
        // Le Rolex : la membrane claire de la photo, sans les ombres que la photo a figées.
        top = max(top, uRoof * 0.93);
        wall = uRoof;
      } else {
        // Chaque famille de façade, relevée sur des photos du campus : matière, hauteur d'étage,
        // largeur de travée, hauteur et largeur des vitrages, stores, part de verre vue de loin.
        float bid = floor(vSpan.y * 40.0);
        float kind = hash(vec2(bid, 11.0)), tint = hash(vec2(bid, 3.0));
        vec3 skin = uWall * mix(vec3(0.8, 0.79, 0.77), vec3(1.0, 0.985, 0.95), tint);
        vec3 pane0 = vec3(0.09, 0.12, 0.15), pane1 = vec3(0.25, 0.29, 0.31);
        float fh = 0.55, cw = 0.42, rowA = 0.3, rowB = 0.82, fill = 0.7, ribs = 0.0, blinds = 0.42, cover = 0.2, weather = 1.0;
        if (st == 0.0) {
          float curtain = step(kind, 0.16), ribbon = step(0.16, kind) * step(kind, 0.6);
          cw = mix(0.42, 0.28, curtain); rowA = mix(0.3, 0.16, curtain); rowB = mix(0.82, 0.96, curtain);
          fill = mix(0.7, 0.95, max(curtain, ribbon)); cover = mix(mix(0.2, 0.34, ribbon), 0.62, curtain);
        } else if (st == 2.0 || st >= 12.0) {      // ME, MA, CM, PH, GC… : aluminium clair, bandeaux vitrés continus
          skin = vec3(0.5, 0.52, 0.54) * dim; fh = 0.62; cw = 0.24; rowA = 0.44; rowB = 0.93; fill = 0.95; ribs = 1.0; blinds = 0.2; cover = 0.42; weather = 0.45;
          pane0 = vec3(0.06, 0.1, 0.14); pane1 = vec3(0.16, 0.24, 0.3);
        } else if (st == 3.0) {      // ELA…, INF… : le même dessin en ocre
          skin = vec3(0.61, 0.52, 0.38) * dim; fh = 0.6; cw = 0.6; rowA = 0.03; rowB = 0.6; fill = 0.82; blinds = 0.1; cover = 0.34; weather = 0.5;
          pane0 = vec3(0.03, 0.05, 0.11); pane1 = vec3(0.08, 0.12, 0.2);
        } else if (st == 4.0) {      // ME D : volets d'aluminium inclinés
          skin = vec3(0.05, 0.07, 0.09); fh = 0.62; cw = 0.46; rowA = 0.0; rowB = 1.0; fill = 1.0; ribs = 1.0; blinds = 0.0; cover = 0.14; weather = 0.3;
        } else if (st == 5.0) {      // BI : bandes de couleur sur noir
          skin = vec3(0.025); fh = 0.62; cw = 0.3; rowA = 0.12; rowB = 0.9; fill = 0.9; blinds = 0.0; cover = 0.3; weather = 0.2;
        } else if (st == 6.0) {      // BM : enduit gris clair, fenêtres larges à stores
          skin = vec3(0.47, 0.53, 0.55) * dim; fh = 0.52; cw = 0.5; rowA = 0.26; rowB = 0.8; fill = 0.82; blinds = 0.72; cover = 0.3; weather = 0.7;
        } else if (st == 7.0) {      // SwissTech : mur-rideau bleu
          skin = vec3(0.03, 0.04, 0.05); fh = 0.7; cw = 0.25; rowA = 0.02; rowB = 0.98; fill = 0.97; blinds = 0.0; cover = 0.9; weather = 0.0;
          pane0 = vec3(0.03, 0.09, 0.17); pane1 = vec3(0.09, 0.2, 0.32);
        } else if (st == 8.0) {      // BC : métal sombre, hauts vitrages
          skin = vec3(0.03, 0.032, 0.036); fh = 0.62; cw = 0.2; rowA = 0.08; rowB = 0.92; fill = 0.72; blinds = 0.0; cover = 0.45; weather = 0.1;
        } else if (st == 9.0) {      // RTS : boîtes minérales taupe, très grandes baies
          skin = vec3(0.34, 0.3, 0.25) * dim; fh = 1.0; cw = 0.92; rowA = 0.2; rowB = 0.84; fill = 0.8; blinds = 0.0; cover = 0.4; weather = 0.4;
        } else if (st == 10.0) {     // RTS : la dalle suspendue, vitrée, traversée de poutres Warren
          skin = vec3(0.55) * dim; fh = 1.5; cw = 2.0; rowA = 0.07; rowB = 0.93; fill = 1.0; blinds = 0.0; cover = 0.75; weather = 0.2;
          pane0 = vec3(0.08, 0.12, 0.14); pane1 = vec3(0.2, 0.25, 0.26);
        } else if (st == 11.0) {     // ArtLab : bois sous un long toit sombre
          skin = vec3(0.33, 0.19, 0.09) * dim; fh = 1.0; cw = 0.5; rowA = 0.05; rowB = 0.92; fill = 0.86; blinds = 0.0; cover = 0.5; weather = 0.3;
        }
        vec2 wp = vec2(run, vLocal.y);
        float stain = noise(wp * vec2(1.1, 0.6)) * 0.6 + noise(wp * vec2(4.5, 1.4)) * 0.4;
        float drip = noise(vec2(run * 11.0, vLocal.y * 0.5));
        skin *= mix(1.0, 0.9 + 0.17 * stain, weather) * mix(mix(1.0, 0.8, weather), 1.0, smoothstep(0.0, 0.55, above));
        if (st == 5.0 && above > 0.62) {
          float s = floor(run / 0.75), c6 = s - 6.0 * floor(s / 6.0);
          skin = c6 < 1.0 ? vec3(0.9, 0.55, 0.02) : c6 < 2.0 ? vec3(0.02, 0.26, 0.09) : c6 < 3.0 ? vec3(0.85, 0.2, 0.02) : c6 < 4.0 ? vec3(0.02, 0.1, 0.42) : c6 < 5.0 ? vec3(0.95, 0.72, 0.03) : vec3(0.6, 0.04, 0.03);
          skin *= dim;
          fill = 0.0;
        }
        float lvl = above / fh, col = run / cw;
        float fy = fract(lvl), fx = fract(col);
        float wl = fwidth(lvl), wc = fwidth(col);
        float win = band(fy, rowA, rowB, wl) * band(fx, 0.5 - fill * 0.5, 0.5 + fill * 0.5, wc);
        float detail = 1.0 - smoothstep(0.04, 0.12, max(wr, wy));
        vec2 pid = vec2(floor(col), floor(lvl)) + bid;
        float r1 = hash(pid), r2 = hash(pid + 7.0), r3 = hash(pid + 13.0);
        float t = clamp((fy - rowA) / (rowB - rowA), 0.0, 1.0);
        float blind = step(1.0 - blinds, r2) * step(1.0 - r1 * 0.85, t);
        vec3 pane = mix(pane0, pane1, r3);
        pane = mix(pane, vec3(0.62, 0.6, 0.55) * (0.9 + 0.1 * sin(t * 60.0)), blind);
        pane *= 1.0 - 0.5 * smoothstep(rowB - 0.08, rowB, fy);
        float sill = band(fy, rowA - 0.04, rowA, wl);
        float under = smoothstep(rowA, 0.0, fy);
        vec3 near = skin * (1.0 - 0.16 * under * drip * weather) * (1.0 + 0.12 * sill);
        near *= 1.0 - 0.14 * band(fy, 0.0, 0.015, wl);
        near *= 1.0 - 0.12 * ribs * step(0.5, fract(vLocal.y / 0.05));
        if (st == 4.0) {
          // Des volets de biais, chacun penché à sa façon ; un sur quatre ouvert sur le verre.
          float sk = (r1 - 0.5) * 0.7;
          float gx = fract(col + (fy - 0.5) * sk);
          float gap = 1.0 - band(gx, 0.05, 0.95, wc);
          near = mix(skin * (0.82 + 0.36 * r3), vec3(0.03), gap);
          near *= 1.0 - 0.14 * step(0.5, fract(vLocal.y / 0.035));
          win = step(0.76, r2) * (1.0 - gap);
        }
        if (st == 9.0) {
          // Trois meneaux par baie.
          float m3 = 1.0 - band(fract((fx - 0.1) / 0.8 * 3.0), 0.04, 0.96, wc * 3.0);
          pane = mix(pane, skin * 0.5, m3);
        }
        if (st == 10.0) {
          // Les poutres Warren : des diagonales claires dans le verre.
          float tri = abs(fract(run / 2.0) - 0.5) * 2.0;
          float truss = 1.0 - smoothstep(0.0, 0.03 + wl, abs(tri - fy));
          pane = mix(pane, vec3(0.68, 0.68, 0.66) * dim, truss);
        }
        float blend = st == 4.0 ? 0.14 : cover;
        vec3 far = mix(skin, mix(pane0, pane1, 0.5), blend);
        win *= step(0.3 * step(st, 0.5), above);
        wall = mix(far, mix(near, pane, win), detail);
        gGlass = win * detail;
        gGloss = win * (1.0 - blind) * detail * 0.85;
        gTilt = (vec3(r1, r2, r3) - 0.5) * 0.09 * gGloss;
        gLit = win * step(st == 10.0 ? 0.0 : 0.55, r2) * uNight;
        // Sur les photos, la RTS est un chantier : son toit est dessiné, à sheds pour la dalle.
        if (st == 9.0) top = vec3(0.4, 0.39, 0.37) * dim;
        if (st == 10.0) {
          float sd = dot(vLocal.xz, vec2(0.82, 0.57)) / 1.1, sw = fwidth(sd);
          float shed = band(fract(sd), 0.62, 0.98, sw);
          shed = mix(0.36, shed, 1.0 - smoothstep(0.2, 0.5, sw));
          top = mix(vec3(0.55, 0.55, 0.54), vec3(0.12, 0.17, 0.2), shed) * dim;
        }
        top = mix(top, vec3(dot(top, vec3(0.333))), 0.12);
      }
      diffuseColor.rgb = mix(wall, top, roof);
      gGlass *= 1.0 - roof; gGloss *= 1.0 - roof; gLit *= 1.0 - roof;`)
    .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(normal + gTilt);")
    .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, gGloss);")
    .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.75, gGloss);")
    .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * gLit * 1.3;");
};
const draco = new DRACOLoader().setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/");
const styleMap = { value: null };
const buildingsReady = new Promise((resolve, reject) => draco.load("geo/campus.drc", async (geo) => {
  const styles = await loadTex("geo/styles.png");
  styles.colorSpace = THREE.NoColorSpace;
  styles.magFilter = styles.minFilter = THREE.NearestFilter;
  styles.generateMipmaps = false;
  styles.anisotropy = 1;
  styles.needsUpdate = true;
  styleMap.value = styles;
  const mesh = new THREE.Mesh(geo, campusMat);
  mesh.castShadow = mesh.receiveShadow = true;
  // Le toit du Rolex est une coque ondulée : dans la carte d'ombres il passe un peu plus bas, pour ne
  // pas s'ombrer lui-même (des rayures), tout en ombrant le sol et les patios.
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mesh.customDepthMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      if (abs(position.x) < 14.2 && abs(position.z) < 10.45) transformed.y -= 0.3;`);
  };
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
    { within: 30, geo: crownGeometry(small ? 1 : 2, LOBES), list: [] },
    { within: 80, geo: crownGeometry(1, LOBES.slice(0, 5)), list: [] },
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

// ==========================================================================================
// Les façades en 3D : de vraies pièces, bâties le long des murs de campus.drc (geo/walls.bin). Les
// proportions sont relevées sur des photos du campus (trame EPFL de 7,20 m) ; aucune image : la
// matière et le petit relief (persiennes, joints de carrelage, enduit) sont calculés.
// ==========================================================================================
const M = 1 / UNIT;                                  // un mètre en unités de scène
const lin = (hex) => new THREE.Color(hex);
const PLAIN = 0, LOUVRE = 1, TILE = 2, RENDER = 3, RIB = 4;
class Module {
  constructor() { this.body = []; this.glass = []; }
  paint(g, color, kind) {
    const geo = g.index ? g.toNonIndexed() : g, n = geo.attributes.position.count, c = lin(color);
    const col = new Float32Array(n * 3), k = new Float32Array(n).fill(kind);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aKind", new THREE.BufferAttribute(k, 1));
    for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "color", "aKind"].includes(name)) geo.deleteAttribute(name);
    this.body.push(geo);
    return this;
  }
  box(x0, y0, z0, x1, y1, z1, color, kind = PLAIN, tilt = 0) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    if (tilt) g.rotateX(tilt);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return this.paint(g, color, kind);
  }
  // Un plan de verre, en retrait.
  pane(x0, y0, x1, y1, z) {
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
    const geo = g.toNonIndexed();
    geo.deleteAttribute("uv");
    this.glass.push(geo);
    return this;
  }
  // Un plan de matière (mur, persienne).
  sheet(x0, y0, x1, y1, z, color, kind) {
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
    return this.paint(g, color, kind);
  }
  // Un rectangle aux coins arrondis, plein ou percé, extrudé avec un chanfrein : les tôles embouties.
  pillow(x0, y0, x1, y1, r, z, depth, color, kind, hole, bevel = 0.03, curve = 2) {
    const rounded = (path, a, b, c, d, q) => {
      path.moveTo(a + q, b); path.lineTo(c - q, b); path.quadraticCurveTo(c, b, c, b + q);
      path.lineTo(c, d - q); path.quadraticCurveTo(c, d, c - q, d); path.lineTo(a + q, d);
      path.quadraticCurveTo(a, d, a, d - q); path.lineTo(a, b + q); path.quadraticCurveTo(a, b, a + q, b);
      return path;
    };
    const shape = rounded(new THREE.Shape(), x0, y0, x1, y1, r);
    if (hole) shape.holes.push(rounded(new THREE.Path(), hole[0], hole[1], hole[2], hole[3], hole[4]));
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: curve });
    g.translate(0, 0, z);
    return this.paint(g, color, kind);
  }
  done() {
    const merge = (list) => {
      if (!list.length) return null;
      const g = mergeGeometries(list);
      // Rien de ce qui regarde le mur ne se voit : un tiers des triangles en moins.
      const nrm = g.attributes.normal, keep = [];
      for (let t = 0; t < nrm.count; t += 3) if (nrm.getZ(t) + nrm.getZ(t + 1) + nrm.getZ(t + 2) > -1.5) keep.push(t);
      for (const name of Object.keys(g.attributes)) {
        const at = g.attributes[name], w = at.itemSize, out = new Float32Array(keep.length * 3 * w);
        keep.forEach((t, i) => out.set(at.array.subarray(t * w, (t + 3) * w), i * 3 * w));
        g.setAttribute(name, new THREE.BufferAttribute(out, w));
      }
      g.scale(M, M, M);
      return g;
    };
    return { body: merge(this.body), glass: merge(this.glass) };
  }
}
const ALU = "#a9adb2", JOINT = "#26282b", TILE_C = "#cdbfa6", NAVY = "#1d3760", WHITE = "#e4e3de", GREY_R = "#9aa7aa", TAUPE = "#8f867a", BLACK = "#101114";
function aluminium(rich) {
  // ME, MA, CM…, 7,20 × 3,75 m : deux rangs de tôles embouties à persiennes, puis une longue baie
  // dans un cadre arrondi, le vitrage en retrait.
  const m = new Module();
  m.box(0, 0, 0, 7.2, 3.75, 0.05, JOINT);
  for (const [y0, y1] of [[0.02, 0.93], [0.95, 1.86]]) {
    for (const [x0, x1] of [[0.03, 4.3], [4.34, 7.17]]) {
      if (rich) {
        m.pillow(x0, y0, x1, y1, 0.16, 0.08, 0.2, ALU, PLAIN, null, 0.05);
        const half = (x0 + x1) / 2;
        m.sheet(x0 + 0.24, y0 + 0.2, half - 0.08, y1 - 0.2, 0.36, ALU, LOUVRE);
        m.sheet(half + 0.08, y0 + 0.2, x1 - 0.24, y1 - 0.2, 0.36, ALU, LOUVRE);
      } else m.box(x0, y0, 0.05, x1, y1, 0.32, ALU, LOUVRE);
    }
  }
  if (rich) m.pillow(0.04, 1.88, 7.16, 3.73, 0.16, 0.08, 0.2, ALU, PLAIN, [0.26, 2.04, 6.94, 3.58, 0.14], 0.04);
  else { m.box(0.04, 1.88, 0.05, 7.16, 2.04, 0.32, ALU); m.box(0.04, 3.58, 0.05, 7.16, 3.73, 0.32, ALU); m.box(0.04, 2.04, 0.05, 0.26, 3.58, 0.32, ALU); m.box(6.94, 2.04, 0.05, 7.16, 3.58, 0.32, ALU); }
  for (const x of [1.42, 2.72, 4.78, 6.42]) m.box(x - 0.04, 2.04, 0.06, x + 0.04, 3.58, 0.13, "#3b4648");
  if (rich) { m.box(0.26, 3.5, 0.06, 6.94, 3.58, 0.13, "#3b4648"); m.box(0.26, 2.04, 0.06, 6.94, 2.1, 0.16, "#3b4648"); }
  m.pane(0.26, 2.04, 6.94, 3.58, 0.08);
  return m.done();
}
function ceramic() {
  // EL, IN, 3,60 × 3,60 m : un mur carrelé percé d'une baie, cadre bleu marine, tablette inclinée.
  const m = new Module();
  m.pillow(0, 0, 3.6, 3.6, 0.001, 0, 0.26, TILE_C, TILE, [0.33, 0.12, 3.25, 2.14, 0.001], 0, 1);
  m.box(0.33, 0.12, 0.02, 3.25, 0.22, 0.14, NAVY);
  m.box(0.33, 2.04, 0.02, 3.25, 2.14, 0.14, NAVY);
  m.box(0.33, 0.12, 0.02, 0.43, 2.14, 0.14, NAVY);
  m.box(3.15, 0.12, 0.02, 3.25, 2.14, 0.14, NAVY);
  m.box(1.76, 0.12, 0.02, 1.92, 2.14, 0.15, NAVY);
  m.box(0.86, 0.22, 0.02, 0.98, 1.68, 0.14, NAVY);
  m.box(0.43, 1.66, 0.02, 3.15, 1.78, 0.14, NAVY);
  m.box(0.3, 0.04, 0.1, 3.28, 0.13, 0.32, NAVY, PLAIN, -0.2);
  m.pane(0.33, 0.12, 3.25, 2.14, 0.06);
  return m.done();
}
function panelled(open) {
  // BM, 6,00 × 3,30 m : enduit gris clair, baie à deux vantaux, stores à lames.
  const m = new Module();
  m.pillow(0, 0, 6, 3.3, 0.001, 0, 0.2, GREY_R, RENDER, [0.42, 0.62, 5.58, 2.62, 0.001], 0, 1);
  m.box(0.42, 0.62, 0.03, 5.58, 0.7, 0.1, WHITE); m.box(0.42, 2.54, 0.03, 5.58, 2.62, 0.1, WHITE);
  m.box(0.42, 0.62, 0.03, 0.5, 2.62, 0.1, WHITE); m.box(5.5, 0.62, 0.03, 5.58, 2.62, 0.1, WHITE);
  m.box(2.95, 0.62, 0.03, 3.05, 2.62, 0.11, WHITE);
  m.box(0.38, 0.54, 0.1, 5.62, 0.6, 0.27, "#c8cbcb");
  const down = [open ? 0.25 : 0.9, open ? 0.72 : 0.5];
  for (const [side, x0, x1] of [[0, 0.5, 2.95], [1, 3.05, 5.5]]) {
    for (let y = 2.5; y > 2.54 - 1.9 * down[side]; y -= 0.075) m.box(x0, y - 0.03, 0.1, x1, y + 0.03, 0.115, "#8b8f91", PLAIN, 0.5);
  }
  m.pane(0.42, 0.62, 5.58, 2.62, 0.05);
  return m.done();
}
function rtsBox() {
  // RTS, 7,20 × 3,80 m : béton taupe, baie profonde cerclée de noir, châssis blancs.
  const m = new Module();
  m.pillow(0, 0, 7.2, 3.8, 0.001, 0, 0.42, TAUPE, RENDER, [0.62, 0.55, 6.58, 3.2, 0.001], 0, 1);
  m.box(0.62, 0.55, 0.14, 6.58, 0.66, 0.16, BLACK); m.box(0.62, 3.09, 0.14, 6.58, 3.2, 0.16, BLACK);
  m.box(0.62, 0.55, 0.14, 0.73, 3.2, 0.16, BLACK); m.box(6.47, 0.55, 0.14, 6.58, 3.2, 0.16, BLACK);
  m.box(0.73, 0.66, 0.05, 6.47, 0.74, 0.14, WHITE); m.box(0.73, 3.01, 0.05, 6.47, 3.09, 0.14, WHITE);
  m.box(0.73, 2.34, 0.05, 6.47, 2.4, 0.14, WHITE);
  for (let i = 0; i <= 6; i++) { const x = 0.73 + i * (5.74 / 6); m.box(x - 0.035, 0.66, 0.05, x + 0.035, 3.09, 0.14, WHITE); }
  m.pane(0.73, 0.66, 6.47, 3.09, 0.07);
  return m.done();
}
function curtain(w, h, color, slim) {
  // Mur-rideau : une grille de montants devant le verre.
  const m = new Module();
  m.box(0, 0, 0, slim, h, 0.16, color); m.box(0, 0, 0, w, slim, 0.12, color);
  m.pane(0, 0, w, h, 0.04);
  return m.done();
}
function darkMetal() {
  // BC : un bardage nervuré noir, de hauts vitrages étroits.
  const m = new Module();
  m.box(0, 0, 0, 3.6, 3.7, 0.04, "#0d0e10");
  m.sheet(0, 0, 1.5, 3.7, 0.14, "#17181b", RIB);
  m.box(1.5, 0, 0.04, 1.58, 3.7, 0.16, "#17181b"); m.box(3.52, 0, 0.04, 3.6, 3.7, 0.16, "#17181b");
  m.pane(1.58, 0.1, 3.52, 3.6, 0.06);
  return m.done();
}
function timber() {
  // ArtLab : des lames de bois verticales.
  const m = new Module();
  m.box(0, 0, 0, 1.2, 3, 0.05, "#2f2013");
  for (let x = 0.05; x < 1.2; x += 0.2) m.box(x, 0, 0.05, x + 0.13, 3, 0.13, "#7d5730");
  return m.done();
}
function warren() {
  // La dalle RTS, sur toute sa hauteur : montants et diagonales d'une poutre Warren.
  const m = new Module();
  m.box(0, 0, 0, 6, 0.5, 0.3, "#c9c7c1"); m.box(0, 8.5, 0, 6, 9, 0.3, "#c9c7c1");
  const d = Math.hypot(3, 8), a = Math.atan2(3, 8);
  for (const [x, s] of [[1.5, 1], [4.5, -1]]) {
    const g = new THREE.BoxGeometry(0.28, d, 0.22);
    g.rotateZ(-a * s); g.translate(x, 4.5, 0.2);
    m.paint(g, "#d6d4cf", PLAIN);
  }
  m.pane(0, 0.5, 6, 8.5, 0.06);
  return m.done();
}
function redTop() {
  // Le dernier étage des blocs ME, MA, CM : ossature d'acier rouge, vitrage toute hauteur, grand
  // auvent noir porté par des bracons.
  const m = new Module(), RED = "#b4371f", BLK = "#15161a";
  m.box(0, 0, 0, 7.2, 0.5, 0.34, ALU);
  for (const x of [0.5, 2.55, 4.6, 6.65]) { m.box(x - 0.09, 0.5, 0.02, x + 0.09, 3.3, 0.2, RED); m.box(x - 0.05, 3.15, 0.2, x + 0.05, 3.25, 1.5, RED, PLAIN, 0.34); }
  for (const x of [1.53, 3.57, 5.62]) m.box(x - 0.03, 0.5, 0.02, x + 0.03, 3.3, 0.08, "#2b2d30");
  m.box(0, 3.3, 0, 7.2, 3.5, 2.1, BLK);
  m.box(0, 3.22, 1.95, 7.2, 3.3, 2.1, BLK);
  m.pane(0, 0.5, 7.2, 3.3, 0.03);
  return m.done();
}
function mxBay() {
  // MX, 3,60 × 3,60 m : piliers de béton clair, grille de vitrage blanche, allège à lames.
  const m = new Module(), PIER = "#c9c5bb", LAME = "#9fa4a6";
  m.box(0, 0, 0, 0.42, 3.6, 0.42, PIER, RENDER);
  m.box(0.42, 0, 0, 3.6, 0.14, 0.2, PIER, RENDER);
  for (let y = 0.2; y < 1.05; y += 0.1) m.box(0.42, y, 0.05, 3.6, y + 0.07, 0.09, LAME, PLAIN, 0.5);
  m.box(0.42, 1.06, 0.02, 3.6, 1.14, 0.1, WHITE); m.box(0.42, 3.52, 0.02, 3.6, 3.6, 0.1, WHITE);
  for (const y of [1.9, 2.72]) m.box(0.42, y - 0.025, 0.02, 3.6, y + 0.025, 0.09, WHITE);
  for (const x of [1.48, 2.54]) m.box(x - 0.025, 1.14, 0.02, x + 0.025, 3.52, 0.09, WHITE);
  m.pane(0.42, 1.14, 3.6, 3.52, 0.03);
  return m.done();
}
function shutter() { const m = new Module(); m.box(0, 0, 0, 1, 1, 0.07, "#b8bcc0", LOUVRE); return m.done(); }
function ribbed() { const m = new Module(); m.box(0, 0, 0, 1, 1, 0.05, "#ffffff", RIB); return m.done(); }
function mullion() { const m = new Module(); m.box(-0.035, 0, 0, 0.035, 1, 0.16, "#15171a"); return m.done(); }

// La matière, sans image.
const facadeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 });
facadeMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float aKind;\nvarying float vKind;\nvarying vec3 vM;\nvarying float vCell;")
    .replace("#include <begin_vertex>", `#include <begin_vertex>
      vKind = aKind; vM = position * ${UNIT.toFixed(1)};
      vCell = float(gl_InstanceID);`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
      varying float vKind; varying vec3 vM; varying float vCell;
      float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float fn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(fh(i), fh(i + vec2(1, 0)), f.x), mix(fh(i + vec2(0, 1)), fh(i + vec2(1, 1)), f.x), f.y); }
      float gHeight = 0.0; float gRough = -1.0; float gMetal = -1.0;`)
    .replace("#include <color_fragment>", `#include <color_fragment>
      float k = floor(vKind + 0.5);
      vec2 q = vM.xy;
      float px = max(fwidth(q.x), fwidth(q.y));
      float wash = 0.93 + 0.12 * fn(q * 0.5 + vCell * 0.37);
      if (k == 1.0) {
        // Les persiennes de la tôle : de fines nervures horizontales.
        float vis = 1.0 - smoothstep(0.012, 0.032, px);
        float s = fract(q.y / 0.07);
        gHeight = (smoothstep(0.1, 0.3, s) - smoothstep(0.55, 0.8, s)) * 0.012 * vis;
        diffuseColor.rgb *= mix(0.86, 1.0 - 0.42 * smoothstep(0.62, 0.9, s), vis);
        gMetal = 0.72; gRough = 0.38;
      } else if (k == 2.0) {
        // Le carrelage : 24 cm, joints sombres, chaque carreau un peu différent.
        vec2 t = q / 0.24, c = floor(t), f = abs(fract(t) - 0.5);
        float vis = 1.0 - smoothstep(0.008, 0.024, px);
        float joint = smoothstep(0.455, 0.49, max(f.x, f.y));
        diffuseColor.rgb *= mix(0.9, (0.93 + 0.13 * fh(c)) * (1.0 - 0.72 * joint), vis) * wash;
        gHeight = -joint * 0.004 * vis;
        gRough = 0.34;
      } else if (k == 3.0) {
        float vis = 1.0 - smoothstep(0.01, 0.04, px);
        gHeight = fn(q * 40.0) * 0.003 * vis;
        diffuseColor.rgb *= wash;
        gRough = 0.86;
      } else if (k == 4.0) {
        float vis = 1.0 - smoothstep(0.02, 0.07, px);
        float s = fract(q.x / 0.12);
        gHeight = smoothstep(0.2, 0.5, abs(s - 0.5) * 2.0) * 0.012 * vis;
        diffuseColor.rgb *= 1.0 - 0.3 * vis * smoothstep(0.7, 1.0, abs(s - 0.5) * 2.0);
        gMetal = 0.4; gRough = 0.45;
      } else {
        diffuseColor.rgb *= wash;
        gMetal = 0.45; gRough = 0.42;
      }`)
    .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nif (gRough >= 0.0) roughnessFactor = gRough;")
    .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nif (gMetal >= 0.0) metalnessFactor = gMetal;")
    .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      {
        vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
        vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
        float det = dot(sx, r1) * faceDirection;
        vec3 grad = sign(det) * (dFdx(gHeight) * ${(1 / UNIT).toFixed(4)} * r1 + dFdy(gHeight) * ${(1 / UNIT).toFixed(4)} * r2) * 6.0;
        normal = normalize(abs(det) * normal - grad);
      }`);
};
const glassMat = new THREE.MeshStandardMaterial({ color: "#3c4a55", roughness: 0.07, metalness: 0.82, side: THREE.DoubleSide });
glassMat.onBeforeCompile = (shader) => {
  shader.uniforms.uNight = night;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying float vId;")
    .replace("#include <begin_vertex>", `#include <begin_vertex>
      vId = float(gl_InstanceID);
      // Chaque vitre penche d'un rien : elle n'attrape pas le même morceau de ciel que sa voisine.
      vNormal = normalize(vNormal + normalMatrix * vec3((vec2(fract(sin(vId * 12.99) * 437.5), fract(sin(vId * 78.23) * 437.5)) - 0.5) * 0.05, 0.0));`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform float uNight;\nvarying float vId;")
    .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      float lit = step(0.5, fract(sin(vId * 91.7) * 4375.5));
      totalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * lit * uNight * 0.9;
      diffuseColor.rgb *= 0.8 + 0.5 * fract(sin(vId * 33.1) * 437.5);`);
};

// Le verre du Rolex : un reflet, et derrière lui l'intérieur (plafond à bandes lumineuses, sol), tracé
// dans le shader à partir du regard. Rien à modéliser, mais la perspective est juste.
const eye = { value: new THREE.Vector3() };
const rolexGlassMat = new THREE.MeshStandardMaterial({ color: "#1b2429", roughness: 0.06, metalness: 0.5, side: THREE.DoubleSide });
rolexGlassMat.onBeforeCompile = (shader) => {
  shader.uniforms.uNight = night;
  shader.uniforms.uEye = eye;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float aCeil;\nvarying float vCeil;\nvarying vec3 vIn;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCeil = aCeil;\nvIn = position;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform float uNight;\nuniform vec3 uEye;\nvarying float vCeil;\nvarying vec3 vIn;")
    .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      vec3 ray = normalize(vIn - uEye);
      float up = ray.y > 0.0 ? 1.0 : 0.0;
      float plane = mix(vCeil - 0.6, vCeil - 0.05, up);
      float t = abs(plane - vIn.y) / max(abs(ray.y), 0.004);
      vec3 hit = vIn + ray * t;
      float strip = smoothstep(0.42, 0.5, abs(fract(hit.x / 0.9) - 0.5)) * up;
      vec3 room = mix(vec3(0.34, 0.33, 0.31), vec3(0.72, 0.71, 0.68), up) + strip * 1.2;
      room *= exp(-t * 0.22);
      float facing = abs(dot(normalize(vViewPosition), normal));
      float see = (1.0 - pow(1.0 - facing, 3.0));
      totalEmissiveRadiance += room * see * mix(0.16, 0.95, uNight) * vec3(1.0, 0.9, 0.76);`);
};
const FASCIA = 0.05, GLASS_END = 0.6, SLAB = 0.12, RECESS = 0.04;   // la coupe du Rolex, sous le toit (unités)
const facadeGroup = new THREE.Group();
facadeGroup.visible = false;
campus.add(facadeGroup);
const rolexParts = new THREE.Group();
campus.add(rolexParts);
const facadesReady = Promise.all([loadBin("geo/walls.bin", Float32Array), loadBin("geo/rolex.bin", Float32Array)]).then(([a, rolex]) => {
  const HI = small ? 0 : 44, LO = small ? 95 : 135;
  const place = new THREE.Matrix4(), scaleM = new THREE.Matrix4(), turn = new THREE.Matrix4();
  const lists = new Map();                            // clé → { kit, matrices, colors }
  const push = (key, kit, m, color) => {
    let l = lists.get(key);
    if (!l) lists.set(key, l = { kit, matrices: [], colors: [] });
    l.matrices.push(m.clone()); l.colors.push(color);
  };
  const kits = {
    aluHi: aluminium(true), aluLo: aluminium(false), tile: ceramic(), bmA: panelled(true), bmB: panelled(false), rts: rtsBox(),
    top: redTop(), mx: mxBay(), swiss: curtain(1.8, 3.6, "#0a0c0f", 0.09), bc: darkMetal(), wood: timber(), truss: warren(), shutter: shutter(), rib: ribbed(), mull: mullion(),
  };
  const size = { top: [7.2, 3.75], mx: [3.6, 3.6], aluHi: [7.2, 3.75], aluLo: [7.2, 3.75], tile: [3.6, 3.6], bmA: [6, 3.3], rts: [7.2, 3.8], swiss: [1.8, 3.6], bc: [3.6, 3.7], wood: [1.2, 3], truss: [6, 9] };
  const BI = ["#d98a12", "#2a2c30", "#c9241a", "#2a2c30", "#e0b21a", "#14613a", "#2a2c30", "#14306f"];
  let seedF = 11;
  const rnd = () => ((seedF = (seedF * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < a.length; i += 9) {
    const [x0, z0, x1, z1, y0, y1, nx, nz, s] = a.subarray(i, i + 9);
    if (s === 0) continue;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, dist = Math.hypot(mx, mz);
    if (dist > LO) continue;
    // Le repère du mur : x le long, y vers le haut, z vers l'extérieur.
    let tx = nz, tz = -nx;
    const flip = (x1 - x0) * tx + (z1 - z0) * tz < 0;
    const sx = flip ? x1 : x0, sz = flip ? z1 : z0;
    const len = Math.hypot(x1 - x0, z1 - z0), tall = y1 - y0;
    const frame = (u, y, w, h, depth = 1, roll = 0) => {
      place.set(tx, 0, nx, sx + tx * u, 0, 1, 0, y, tz, 0, nz, sz + tz * u, 0, 0, 0, 1);
      if (roll) { place.multiply(turn.makeRotationZ(roll)); }
      return place.multiply(scaleM.makeScale(w, h, depth));
    };
    const grid = (name, key, top = tall, wantH) => {
      const [w, h] = size[name];
      const nx_ = Math.max(1, Math.round(len / (w * M))), ny = Math.max(1, Math.round(top / ((wantH ?? h) * M)));
      const ws = len / nx_ / (w * M), hs = top / ny / (h * M);
      for (let r = 0; r < ny; r++) for (let c = 0; c < nx_; c++) {
        const k = key(r, c, ny);
        push(k, kits[k.split(":")[0]], frame(c * w * M * ws, y0 + r * h * M * hs, ws, hs), tintOf);
      }
    };
    const cell = `${Math.floor(mx / 45)},${Math.floor(mz / 45)}`;
    const tintOf = s === 14 ? 0xfff0d2 : 0xffffff;
    if (s === 1) {
      continue;   // ses montants viennent de geo/mullions.bin
    } else if (s === 2 || s === 12 || s === 14) {
      if (tall < 0.45 || len < 0.5) continue;
      const tier = dist < HI ? "aluHi" : "aluLo";
      grid(tier, (r, c, ny) => (s === 12 && r === ny - 1 && ny > 1 ? `top:${cell}` : `${tier}:${cell}`));
    } else if (s === 13) {
      if (tall < 0.45) continue;
      grid("mx", () => `mx:${cell}`);
    } else if (s === 3) {
      if (tall < 0.45) continue;
      grid("tile", () => `tile:${cell}`);
    } else if (s === 6) {
      grid("bmA", (r, c) => ((r * 5 + c * 3) % 7 < 3 ? `bmB:${cell}` : `bmA:${cell}`));
    } else if (s === 9) {
      grid("rts", () => `rts:${cell}`);
    } else if (s === 7) {
      grid("swiss", () => `swiss:${cell}`);
    } else if (s === 8) {
      grid("bc", () => `bc:${cell}`);
    } else if (s === 11) {
      grid("wood", () => `wood:${cell}`);
    } else if (s === 10) {
      grid("truss", () => `truss:${cell}`);
    } else if (s === 4) {
      // ME D : des volets indépendants, chacun penché à sa façon, à distance du mur ; un sur quatre
      // manque et laisse voir le verre.
      const bay = 2.3 * M, floor = 3.7 * M;
      const nX = Math.max(1, Math.round(len / bay)), nY = Math.max(1, Math.round(tall / floor));
      const w = len / nX, h = tall / nY;
      for (let r = 0; r < nY; r++) for (let c = 0; c < nX; c++) {
        if (rnd() < 0.24) continue;
        const lean = (rnd() - 0.5) * 0.3;
        const m4b = frame((c + 0.5) * w, y0 + (r + 0.5) * h, w * 0.92 * UNIT, h * 0.96 * UNIT, 1, lean);
        m4b.multiply(turn.makeTranslation(-0.5 * M, -0.5 * M, 0.34 * M));
        push(`shutter:${cell}`, kits.shutter, m4b, 0xffffff);
      }
    } else if (s === 5) {
      // BI : un socle noir nervuré, puis de larges bandes de couleur.
      const bay = 2.4 * M, nX = Math.max(1, Math.round(len / bay)), w = len / nX;
      const base = Math.min(tall, 3.7 * M);
      for (let c = 0; c < nX; c++) {
        push(`rib:${cell}`, kits.rib, frame(c * w, y0, w * UNIT, base * UNIT, 1), 0x202225);
        if (tall > base) push(`rib:${cell}`, kits.rib, frame(c * w, y0 + base, w * 0.985 * UNIT, (tall - base) * UNIT, 1.6), new THREE.Color(BI[(c + Math.floor(sx * 3)) & 7]).getHex());
      }
    }
  }
  // Le Rolex, depuis les contours de son toit : la rive mince, le verre en léger retrait, ses
  // montants tous les 2,40 m, la dalle, puis le plancher, qui reprend la forme du toit. Sous le
  // plancher il n'y a rien : c'est le vide des arches.
  let at = 1;
  const loops = [];
  for (let l = 0; l < rolex[0]; l++) {
    const n = rolex[at++];
    loops.push(rolex.subarray(at, at + n * 3));
    at += n * 3;
  }
  const shellCount = rolex[at++], shell = rolex.subarray(at, at + shellCount * 9);
  const skin = { glass: [], ceil: [], body: [], color: [], normal: [] };
  const edge = lin("#dcd9d3"), slabC = lin("#a9a59c"), under = lin("#c9c6bf");
  const face = (a, b, c, d, n, color) => {                     // quatre coins, dans le sens qui regarde n
    skin.body.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let v = 0; v < 6; v++) { skin.normal.push(...n); skin.color.push(color.r, color.g, color.b); }
  };
  for (const pts of loops) {
    const n = pts.length / 3;
    let walked = 0, next = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, k = (i + n - 1) % n, m = (j + 1) % n;
      const ax = pts[i * 3], ay = pts[i * 3 + 1], az = pts[i * 3 + 2], bx = pts[j * 3], by = pts[j * 3 + 1], bz = pts[j * 3 + 2];
      // La normale de chaque point, moyennée avec ses voisins : pas de marches dans les courbes.
      const out = (p, q) => { const dx = pts[q * 3] - pts[p * 3], dz = pts[q * 3 + 2] - pts[p * 3 + 2], d = Math.hypot(dx, dz) || 1; return [dz / d, -dx / d]; };
      const [ax1, az1] = out(k, j), [bx1, bz1] = out(i, m);
      const la = Math.hypot(ax1, az1) || 1, lb = Math.hypot(bx1, bz1) || 1;
      const an = [ax1 / la, 0, az1 / la], bn = [bx1 / lb, 0, bz1 / lb];
      const P = (x, y, z, nrm, d) => [x + nrm[0] * d, y, z + nrm[2] * d];
      const N = [(an[0] + bn[0]) / 2, 0, (an[2] + bn[2]) / 2];
      // La rive, puis son dessous jusqu'au verre.
      face(P(ax, ay - FASCIA, az, an, 0.012), P(bx, by - FASCIA, bz, bn, 0.012), P(bx, by + 0.012, bz, bn, 0.012), P(ax, ay + 0.012, az, an, 0.012), N, edge);
      face(P(ax, ay - FASCIA, az, an, -RECESS), P(bx, by - FASCIA, bz, bn, -RECESS), P(bx, by - FASCIA, bz, bn, 0.012), P(ax, ay - FASCIA, az, an, 0.012), [0, -1, 0], under);
      // Le verre.
      const g0 = P(ax, ay - GLASS_END, az, an, -RECESS), g1 = P(bx, by - GLASS_END, bz, bn, -RECESS), g2 = P(bx, by - FASCIA, bz, bn, -RECESS), g3 = P(ax, ay - FASCIA, az, an, -RECESS);
      skin.glass.push(...g0, ...g1, ...g2, ...g0, ...g2, ...g3);
      skin.ceil.push(ay, by, by, ay, by, ay);
      // La dalle, et son dessus jusqu'au verre.
      face(P(ax, ay - GLASS_END - SLAB, az, an, 0.012), P(bx, by - GLASS_END - SLAB, bz, bn, 0.012), P(bx, by - GLASS_END, bz, bn, 0.012), P(ax, ay - GLASS_END, az, an, 0.012), N, slabC);
      face(P(ax, ay - GLASS_END, az, an, 0.012), P(bx, by - GLASS_END, bz, bn, 0.012), P(bx, by - GLASS_END, bz, bn, -RECESS), P(ax, ay - GLASS_END, az, an, -RECESS), [0, 1, 0], slabC);
      // Les montants.
      const seg = Math.hypot(bx - ax, bz - az);
      if (walked >= next) {
        next = walked + 2.4 * M;
        const px = ax - an[0] * (RECESS - 0.004), pz = az - an[2] * (RECESS - 0.004);
        place.set(an[2], 0, an[0], px, 0, 1, 0, ay - GLASS_END, -an[0], 0, an[2], pz, 0, 0, 0, 1);
        place.multiply(scaleM.makeScale(1, (GLASS_END - FASCIA) * UNIT, 1));
        push(`mull:${Math.floor(px / 45)},${Math.floor(pz / 45)}`, kits.mull, place, 0xffffff);
      }
      walked += seg;
    }
  }
  const skinGeo = new THREE.BufferGeometry();
  skinGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(skin.body), 3));
  skinGeo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(skin.normal), 3));
  skinGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(skin.color), 3));
  skinGeo.setAttribute("aKind", new THREE.BufferAttribute(new Float32Array(skin.body.length / 3), 1));
  const skinMat = facadeMat.clone();
  skinMat.onBeforeCompile = facadeMat.onBeforeCompile;
  skinMat.side = THREE.DoubleSide;
  const rolexSkin = new THREE.Mesh(skinGeo, skinMat);
  rolexSkin.castShadow = rolexSkin.receiveShadow = true;
  const glassGeo = new THREE.BufferGeometry();
  glassGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(skin.glass), 3));
  glassGeo.setAttribute("aCeil", new THREE.BufferAttribute(new Float32Array(skin.ceil), 1));
  glassGeo.computeVertexNormals();
  const rolexGlass = new THREE.Mesh(glassGeo, rolexGlassMat);
  rolexGlass.castShadow = true;
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(shell), 3));
  floorGeo.translate(0, -(GLASS_END + SLAB), 0);
  floorGeo.computeVertexNormals();
  const rolexFloor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: "#7d7a72", roughness: 0.9, side: THREE.DoubleSide }));
  rolexFloor.castShadow = rolexFloor.receiveShadow = true;
  rolexParts.add(rolexSkin, rolexGlass, rolexFloor);
  const tint = new THREE.Color();
  let triangles = 0;
  for (const { kit, matrices, colors } of lists.values()) {
    const n = matrices.length;
    const add = (geo, mat, cast) => {
      if (!geo) return;
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      matrices.forEach((m, k) => mesh.setMatrixAt(k, m));
      if (mat === facadeMat) colors.forEach((c, k) => mesh.setColorAt(k, tint.set(c)));
      mesh.castShadow = cast; mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      facadeGroup.add(mesh);
      triangles += n * geo.attributes.position.count / 3;
    };
    add(kit.body, facadeMat, true);
    add(kit.glass, glassMat, false);
  }
  facadeGroup.visible = campus.scale.y >= 0.999;
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
    stale = true;
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
  const skyPaint = document.createElement("canvas");
  skyPaint.width = 2; skyPaint.height = 256;
  const brush = skyPaint.getContext("2d"), ramp = brush.createLinearGradient(0, 0, 0, 256);
  ramp.addColorStop(0, dark ? "#070b14" : "#8eacc2");
  ramp.addColorStop(0.48, dark ? "#1b2433" : "#a8bac3");
  ramp.addColorStop(1, dark ? "#1b2433" : "#a8bac3");
  brush.fillStyle = ramp; brush.fillRect(0, 0, 2, 256);
  scene.background?.dispose?.();
  scene.background = new THREE.CanvasTexture(skyPaint);
  scene.background.colorSpace = THREE.SRGBColorSpace;
  plainMat.color.set(dark ? "#10161c" : "#93a7b0");
  night.value = dark ? 1 : 0;
  wallTone.value.set(dark ? "#8a8d92" : "#e7e3da");
  roofTone.value.set(dark ? "#8f9298" : "#c4bcb6");
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
  hero: { pos: [-20, 6.5, 21], look: [6, 10.8, -14], shift: 0.1, phone: D(0.66, -0.1, 5.8, -0.5, 0.06, "iphone-today") },
  today: { pos: [-30, 9, 26], look: [4, 2, 0], shift: -0.14, phone: OFF_PHONE },
  import: { pos: [-37, 8, -15], look: [2, 2, 0], shift: 0.14, phone: OFF_PHONE },
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
  // Le bâtiment se lève vu de loin : les ombres ne sont recalculées qu'une fois debout.
  if (Math.abs(campus.scale.y - rise) > 1e-4) {
    campus.scale.y = rise;
    if (rise >= 0.999) { facadeGroup.visible = true; shadowsDirty(); }
  }
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
// En mouvement : une image plus petite, lissée, agrandie à l'écran.
const fast = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
fast.addPass(new RenderPass(scene, camera));
fast.addPass(new OutputPass());
fast.setPixelRatio(dprFast);
fast.setSize(innerWidth, innerHeight);
import("n8ao").then(({ N8AOPass }) => {
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: dprNow < 1.5 ? 4 : 0 }));
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
  composer.setPixelRatio(dprNow);
  composer.setSize(innerWidth, innerHeight);
  wake();
}).catch(() => {});
const clock = new THREE.Clock();
const introClock = new THREE.Clock(false);
let visible = true, slowFrames = 0, paceMs = 16, lastFrame = 0, sharpDone = false, wantSharp = false, sharpTimer = 0;
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
  eye.value.set(camPos.x, camPos.y, -camPos.z);
  if (moving) {
    sharpDone = false; stale = false;
    clearTimeout(sharpTimer); sharpTimer = 0;
  } else if (sharpDone && !stale) return;               // rien n'a changé : on ne dessine rien
  // Un mouvement : un rendu direct. Un arrêt qui dure : une image avec l'occlusion ambiante, jamais
  // au milieu d'une lecture par à-coups.
  const sharp = !moving && wantSharp && composer;
  renderer.autoClear = true;
  if (sharp) { composer.render(); sharpDone = true; wantSharp = false; stale = false; }
  else if (moving) fast.render();
  else renderer.render(scene, camera);
  if (phone.visible) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(deviceScene, devCam);
  }
  if (moving) {
    // Une machine qui ne suit pas : l'image en mouvement baisse par paliers, une fois pour toutes.
    const now = performance.now(), gap = now - lastFrame;
    lastFrame = now;
    if (gap < 200) {
      paceMs += (gap - paceMs) * 0.08;
      if (paceMs > 24 && dprFast > 0.7 && ++slowFrames > 30) {
        dprFast = Math.max(0.7, dprFast - 0.2);
        fast.setPixelRatio(dprFast);
        slowFrames = 0; paceMs = 16;
      }
    }
    wake();
  } else if (!sharpDone && !sharpTimer) {
    sharpTimer = setTimeout(() => { sharpTimer = 0; wantSharp = true; wake(); }, 260);
  }
}

function snap() {
  camPos.copy(wantPos); camLook.copy(wantLook); shiftNow = shiftWant; liftNow = liftWant;
  Object.assign(devState.phone, devWant.phone);
}
function resize() {
  stale = true;
  renderer.setSize(innerWidth, innerHeight, false);
  composer?.setSize(innerWidth, innerHeight);
  fast.setSize(innerWidth, innerHeight);
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
  campus.scale.y = 0.02; facadeGroup.visible = false; devState.phone.on = 0;
  const giveUp = setTimeout(() => { intro.active = false; finishInstantly(); }, 10000);
  Promise.all([groundReady, treesReady.catch(() => {}), buildingsReady.catch(() => {}), facadesReady.catch(() => {})]).then(async () => {
    clearTimeout(giveUp);
    if (!intro.active) return;
    // Tout se compile en tâche de fond avant le premier mouvement : pas d'à-coup en route.
    facadeGroup.visible = true;
    await renderer.compileAsync(scene, camera).catch(() => {});
    facadeGroup.visible = false;
    if (!intro.active) return;
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
  campus.scale.y = 1; facadeGroup.visible = true;
  shadowsDirty();
  root.classList.add("intro-done");
  root.classList.remove("intro", "intro-wait");
  snap();
  wake();
}
