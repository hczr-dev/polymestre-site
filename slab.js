// La scène : le Léman et les Alpes en relief (images swisstopo et Sentinel-2), et le campus tel
// qu'il est : les bâtiments de swissBUILDINGS3D, le Rolex Learning Center avec son vrai toit et
// ses patios, les arbres de la végétation 3D de swisstopo. À l'ouverture, la caméra descend du
// ciel jusqu'au bâtiment et en fait le tour ; ensuite le défilement la promène.
//
// Sobriété : on ne dessine que quand quelque chose bouge ; une machine qui ne suit pas passe en
// définition réduite pendant les mouvements. Les ombres sont figées
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
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
} catch {
  root.classList.add("no-webgl", "intro-done");
  throw new Error("WebGL indisponible");
}
const DPR_HI = Math.min(devicePixelRatio, small ? 1.5 : 2);
// Le canevas garde une taille fixe : le réallouer à chaque arrêt coûte plus que dessiner. Mouvement et
// arrêt sont le même rendu, sans saut entre les deux ; seule une machine trop lente passe, en
// mouvement, par une image plus petite agrandie à l'écran (voir fast).
let dprNow = DPR_HI;
let dprFast = Math.min(devicePixelRatio, small ? 1 : 1.2);
// Le téléphone part léger ; s'il tient le rythme pendant le vol, l'image passe en plus fine à l'arrêt.
const DPR_TOP = Math.min(devicePixelRatio, 2.25);
let canRise = small && DPR_TOP > DPR_HI, fineFrames = 0;
renderer.setPixelRatio(dprNow);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;            // le filtre doux coûtait sur chaque pixel de façade
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
let stale = true;                                    // l'image affichée n'est plus à jour
let shadowHold = false;                              // pendant la descente : pas d'ombres à recalculer
const shadowsDirty = () => { stale = true; if (!shadowHold) renderer.shadowMap.needsUpdate = true; };
// Les téléphones ont leurs propres données, plus légères (geo/mobile.py).
const SET = small ? "geo/m/" : "geo/";
// Sur téléphone, le campus ne se charge qu'une fois le relief arrivé : il ne lui dispute pas le réseau.
// (Sur ordinateur tout part d'un coup, et l'intro attend tout : aucune saccade en vol.)
let groundArrived;
const groundGate = small ? new Promise((resolve) => { groundArrived = resolve; }) : Promise.resolve();

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
// L'occlusion ambiante, cuite une fois pour toutes (geo/ao.py) et fixée au monde : la même sous toutes
// les caméras, sans passe à l'écran. Rouge : lumière reçue ; vert : hauteur du sol.
const aoMap = { value: new THREE.DataTexture(new Uint8Array([255, 128, 0, 255]), 1, 1) };
aoMap.value.needsUpdate = true;
const AO_GLSL = `
  uniform sampler2D uAo;
  float gAo = 1.0;
  float aoAt(vec2 xz, float y) {
    vec2 u = xz / 220.0 + 0.5;
    vec4 t = texture2D(uAo, u);
    float a = mix(t.r, 1.0, smoothstep(0.0, 3.0, y - (t.g * 10.0 - 4.0)));
    return mix(1.0, pow(a, 1.35), step(max(abs(u.x - 0.5), abs(u.y - 0.5)), 0.495));
  }`;
const hazeTone = { value: new THREE.Color("#a8bac3") };
const AO_APPLY = "outgoingLight = (outgoingLight - totalEmissiveRadiance) * gAo + totalEmissiveRadiance;\n#include <opaque_fragment>";
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
    shader.uniforms.uNight = night;
    shader.uniforms.uAo = aoMap;
    shader.uniforms.uHaze = hazeTone;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;\nvarying vec2 vUvT;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUvT = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;\nvarying vec2 vUvT;\nuniform vec4 uHole;\nuniform float uFade;\nuniform float uGain;\nuniform vec3 uWater;\nuniform float uLakeY;\nuniform sampler2D uLake;\nuniform float uHasLake;\nuniform sampler2D uHi;\nuniform vec4 uHiBox;\nuniform float uHasHi;\nfloat gWet = 0.0;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        if (uHole.z > 0.0 && abs(vWorld.x - uHole.x) < uHole.z && abs(vWorld.z - uHole.y) < uHole.w) discard;`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        // Vu de près du sol, le lointain : une photo aplatie, étirée en rayures par l'angle rasant. Comme
        // dans la vraie vue, elle s'adoucit puis se fond dans l'air. Pas depuis le ciel, où elle est nette.
        float gLow = 1.0 - smoothstep(70.0, 420.0, cameraPosition.y);
        float gFar = length(vViewPosition);
        gMist = gLow * 0.9 * (1.0 - exp(-pow(gFar / 1150.0, 1.35)));
        diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(map, vMapUv, 6.0).rgb, gLow * smoothstep(170.0, 620.0, gFar));
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
        // La nuit, vu de haut : les villes s'allument. Le bâti, gris et clair sur l'image, sous la
        // limite des neiges ; une lueur continue, tirée de l'image, donc rien qui scintille.
        vec3 raw = texture2D(map, vMapUv).rgb;
        float spread = max(raw.r, max(raw.g, raw.b)) - min(raw.r, min(raw.g, raw.b));
        gCity = smoothstep(0.09, 0.24, dot(raw, vec3(0.3, 0.59, 0.11))) * (1.0 - smoothstep(0.04, 0.11, spread)) * (1.0 - wet) * (1.0 - smoothstep(22.0, 50.0, vWorld.y));
        gHigh = smoothstep(180.0, 1100.0, cameraPosition.y);
        gAo = aoAt(vec2(vWorld.x, -vWorld.z), -100.0);
        if (uFade > 0.0) {
          float edge = min(min(vUvT.x, 1.0 - vUvT.x), min(vUvT.y, 1.0 - vUvT.y));
          diffuseColor.a *= smoothstep(0.0, uFade, edge);
        }`)
      .replace("#include <common>", `#include <common>\nuniform float uNight;\nuniform vec3 uHaze;\nfloat gCity = 0.0, gHigh = 0.0, gMist = 0.0;${AO_GLSL}`)
      .replace("#include <opaque_fragment>", `outgoingLight = mix(outgoingLight, uHaze, gMist);\n${AO_APPLY}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, gWet);")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += (vec3(1.0, 0.62, 0.3) * gCity * 0.8 + diffuseColor.rgb * 0.3 * (1.0 - gWet)) * gHigh * uNight;`);
  };
  return m;
}
function terrainMesh(layer, heights, tex, opts) {
  const size = layer.size / UNIT, g = layer.grid;
  // Le relief fin : un sommet sur deux suffit sous la photo (un quart des triangles).
  const stride = g > 400 || (small && (g - 1) % 2 === 0) ? 2 : 1;
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
loadTex("geo/ao.webp").then((t) => {
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  aoMap.value = t;
  stale = true; sharpDone = false; wake();
}).catch(() => {});
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
// Les vitres 3D sont à quelques centimètres devant ce maillage : à distance, la profondeur ne les
// départage plus et elles clignotent en mouvement. Le maillage passe donc juste derrière.
const campusMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
campusMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, { uAo: aoMap, uStyles: styleMap, uNight: night, uNear: nearPhoto, uNearBox: nearBox, uHi: hiPhoto, uHiBox: hiBox, uHasHi: hasHi, uWall: wallTone, uRoof: roofTone });
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vLocal;\nvarying vec3 vUp;\nvarying vec2 vSpan;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;\nvUp = normal;\nvSpan = uv;")
    // Les murs du maillage ne sont pas parfaitement plans : par endroits ils passaient devant les façades
    // 3D et se disputaient la profondeur. Rien ne bouge à l'écran, mais pour la profondeur ils sont
    // 70 cm plus loin : la façade gagne toujours.
    .replace("#include <project_vertex>", `#include <project_vertex>
      if (abs(normal.y) < 0.3) {
        vec4 behind = projectionMatrix * vec4(mvPosition.xyz * (1.0 + 0.12 / length(mvPosition.xyz)), 1.0);
        gl_Position.z = behind.z / behind.w * gl_Position.w;
      }`);
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
      ${AO_GLSL}
      vec3 gTilt = vec3(0.0);
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      ${small ? "float noise(vec2 p) { return 0.5; }" : `float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }`}
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
        } else if (st == 8.0) {      // BC : enduit gris clair, fenêtres hautes et étroites
          skin = vec3(0.6, 0.61, 0.6) * dim; fh = 0.62; cw = 0.2; rowA = 0.08; rowB = 0.92; fill = 0.72; blinds = 0.0; cover = 0.45; weather = 0.1;
        } else if (st == 9.0) {      // RTS : boîtes minérales taupe, très grandes baies
          skin = vec3(0.82, 0.81, 0.78) * dim; fh = 0.62; cw = 1.0; rowA = 0.27; rowB = 0.76; fill = 0.7; blinds = 0.0; cover = 0.26; weather = 0.1;
        } else if (st == 10.0) {     // RTS : la dalle suspendue, vitrée, traversée de poutres Warren
          skin = vec3(0.8) * dim; fh = 1.0; cw = 0.4; rowA = 0.07; rowB = 0.93; fill = 1.0; blinds = 0.0; cover = 0.75; weather = 0.2;
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
        float blend = st == 4.0 ? 0.14 : cover;
        vec3 far = mix(skin, mix(pane0, pane1, 0.5), blend);
        win *= step(0.3 * step(st, 0.5), above);
        wall = mix(far, mix(near, pane, win), detail);
        gGlass = win * detail;
        gGloss = win * (1.0 - blind) * detail * 0.85;
        gTilt = (vec3(r1, r2, r3) - 0.5) * 0.09 * gGloss;
        gLit = mix(0.22 * cover, win * step(0.72, r2) * (0.4 + 0.8 * r3), detail) * uNight;
        if (st == 10.0 && above > 1.0) { wall = vec3(0.14, 0.2, 0.24) * dim; gGlass = 1.0; gGloss = 0.8; gTilt = vec3(0.0); gLit = 0.0; }
        // Sur les photos, la RTS est un chantier : ses toits sont dessinés. Le dessous de la dalle est en bois.
        if (st == 9.0) top = vec3(0.72, 0.71, 0.69) * dim;
        // ArtLab : le long toit d'ardoise, sa sous-face de bois.
        if (st == 11.0) {
          top = vec3(0.075, 0.08, 0.09) * (0.88 + 0.24 * step(0.5, fract(vLocal.z / 0.11)));
          if (up.y * (gl_FrontFacing ? 1.0 : -1.0) < -0.2) top = vec3(0.6, 0.42, 0.22) * dim;
        }
        if (st == 10.0) {
          top = vec3(0.78, 0.77, 0.74) * dim;
          if (above < 0.05) top = vec3(0.42, 0.25, 0.12) * dim * (0.9 + 0.2 * noise(vLocal.xz * vec2(14.0, 1.2)));
        }
        top = mix(top, vec3(dot(top, vec3(0.333))), 0.12);
      }
      if (st == 10.0 || st == 9.0) gLit = 0.0;           // ses vraies fenêtres sont en 3D, avec leurs lumières
      if ((st == 10.0 || st == 9.0) && abs(up.y) > 0.12) { roof = 1.0; gGlass = 0.0; gGloss = 0.0; gLit = 0.0; }   // les pentes des sheds sont du toit, pas des murs
      diffuseColor.rgb = mix(wall, top, roof);
      vec2 outward = up.xz * (gl_FrontFacing ? 1.0 : -1.0) * 0.5;
      gAo = mix(aoAt(vLocal.xz + outward, vLocal.y), aoAt(vLocal.xz, -100.0), roof);
      gGlass *= 1.0 - roof; gGloss *= 1.0 - roof; gLit *= 1.0 - roof;`)
    .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(normal + gTilt);")
    .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, gGloss);")
    .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.75, gGloss);")
    .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.64, 0.32) * gLit * 0.34;")
    .replace("#include <opaque_fragment>", AO_APPLY);
};
// Entre CM et CE, swissBUILDINGS3D ferme d'un bloc plein ce qui est en réalité ouvert : la toiture
// d'acier passe au-dessus de l'avenue Piccard (voir crossing). On retire ses murs ; le toit, la marquise
// et l'aile de CE restent ; la marquise, plus basse, est refaite en acier.
const DISC = { x: -22.05, z: 7.13, r: 2.53, hx: -21.63, hz: 6.88, hr: 1.26 };   // l'Agora, relevée sur le maillage
// La RTS : le contour de l'anneau (OpenStreetMap) et ses quatre boîtes (coins, hauteur ; maillage).
const RTS_RING = [[21.8,-5.33],[21.84,-7.7],[22.15,-9.13],[22.95,-10.2],[24.34,-10.92],[25.94,-10.95],[27.49,-10.59],[28.74,-10.1],[29.67,-9.52],[30.23,-8.86],[31.0,-7.03],[31.54,-5.68],[32.28,-3.96],[32.97,-2.56],[33.96,-1.05],[35.09,0.21],[36.68,1.65],[37.62,2.82],[38.39,3.89],[38.96,5.39],[39.03,6.86],[38.93,8.12],[38.05,9.63],[36.73,10.66],[35.57,11.46],[33.93,12.08],[31.39,12.47],[29.36,12.46],[27.4,12.15],[25.78,11.75],[24.66,11.19],[23.72,10.42],[22.98,9.24],[22.52,7.95],[22.15,6.55],[21.97,4.77]];
const RTS_BOXES = [
  { c: [[22, -2.5], [25.6, -2.5], [25.6, 3.2], [22, 3.2]], top: 3.9 },
  { c: [[22.1, 8.65], [26.65, 5.4], [28.7, 8.35], [24.1, 11.6]], top: 4.5 },
  { c: [[24.87, -6.83], [29.8, -9.03], [32.03, -4.05], [27.1, -1.84]], top: 5.52 },
  { c: [[29.71, 2.31], [37.19, 2.45], [37.04, 9.98], [29.56, 9.84]], top: 3.39 },
];
const inPoly = (x, z, p) => {
  let on = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) on = !on;
  return on;
};
const inRts = (x, z) => x > 21 && x < 40 && z > -12 && z < 13 && inPoly(x, z, RTS_RING);
const inRtsBox = (x, z) => RTS_BOXES.some((b) => inPoly(x, z, b.c));
const inQN = (x, z) => x > -40.5 && x < -24.5 && z > 72 && z < 101;   // Quartier Nord, à côté du SwissTech
const QN_COURT = [-33, 94];
const inHall = (x, z) => x > -53.6 && x < -41.2 && z > 78.8 && z < 99.4;   // le SwissTech Convention Center
const inDome = (x, z) => Math.hypot(x - 8.25, z - 58) < 3;                  // le Polydôme
const inRedBox = (x, z) => x > 2.5 && x < 6.2 && z > 56 && z < 60.6;        // sa boîte de bois rouge
const inOdyssea = (x, z) => x > 39.9 && x < 44.6 && z > -4.8 && z < 2.3;
const inCrossing = (x, z) => x > -4.55 && x < 6.93 && z > 34.8 && z < 42.6 && !(x > 3.55 && z < 35.95);
function openCrossing(geo) {
  const p = geo.attributes.position, from = geo.index.array, keep = [];
  for (let i = 0; i < from.length; i += 3) {
    const a = from[i], b = from[i + 1], c = from[i + 2];
    const ya = p.getY(a), yb = p.getY(b), yc = p.getY(c), top = Math.max(ya, yb, yc), low = Math.min(ya, yb, yc);
    const gone = inCrossing((p.getX(a) + p.getX(b) + p.getX(c)) / 3, (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3) && top < 3.27 && !(top - low < 0.05 && low > 3.2);
    const cx = (p.getX(a) + p.getX(b) + p.getX(c)) / 3, cz = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
    const flatLow = top - low < 0.05 && top < 1;       // le sol, pas le bâtiment
    const rebuilt = (inRts(cx, cz) && !inRtsBox(cx, cz)) || inOdyssea(cx, cz) || inDome(cx, cz) || (inHall(cx, cz) && top > 1.7);
    if (!gone && Math.hypot(cx - DISC.x, cz - DISC.z) > 3.2 && (flatLow || !rebuilt)) keep.push(a, b, c);
  }
  geo.setIndex(keep);
}
const draco = new DRACOLoader().setDecoderPath("geo/draco/");
// Compile hors du fil principal avant d'entrer en scène : rien ne saccade pendant la descente.
const warm = (object) => renderer.compileAsync(object, camera, scene).catch(() => {});
const styleMap = { value: null };
const buildingsReady = groundGate.then(() => new Promise((resolve, reject) => draco.load(`${SET}campus.drc`, async (geo) => {
  const styles = await loadTex("geo/styles.png");
  styles.colorSpace = THREE.NoColorSpace;
  styles.magFilter = styles.minFilter = THREE.NearestFilter;
  styles.generateMipmaps = false;
  styles.anisotropy = 1;
  styles.needsUpdate = true;
  styleMap.value = styles;
  openCrossing(geo);
  const mesh = new THREE.Mesh(geo, campusMat);
  mesh.castShadow = mesh.receiveShadow = true;
  // Le toit du Rolex est une coque ondulée : dans la carte d'ombres il passe un peu plus bas, pour ne
  // pas s'ombrer lui-même (des rayures), tout en ombrant le sol et les patios.
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mesh.customDepthMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      if (abs(position.x) < 14.2 && abs(position.z) < 10.45) transformed.y -= 0.3;`);
  };
  await warm(mesh);
  campus.add(mesh);
  draco.dispose();
  shadowsDirty();
  wake();
  resolve(true);
}, undefined, reject)));

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
const treesReady = groundGate.then(() => loadBin(`${SET}trees.bin`, Float32Array)).then(async (a) => {
  const n = a.length / 4;
  const tiers = [
    { within: 22, geo: crownGeometry(small ? 1 : 2, small ? LOBES.slice(0, 5) : LOBES), list: [] },
    { within: 80, geo: crownGeometry(1, LOBES.slice(0, small ? 3 : 5)), list: [] },
    { within: Infinity, geo: crownGeometry(0, [[0, 0, 0, 0.98]]), list: [] },   // à plus de 480 m, vingt faces suffisent
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
    await warm(crowns);
    campus.add(crowns);
  }
  trunks.castShadow = true;
  await warm(trunks);
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
// Une barre plus fine qu'un pixel ne peut pas se dessiner de façon stable : elle apparaît et disparaît
// d'une image à l'autre, et toute la façade grouille. Alors, à l'approche du pixel, les barres
// s'amincissent doucement jusqu'à rien (largeur en pixels, de BAR_PX[0] à BAR_PX[1]). Rien ne bascule
// jamais d'un dessin à un autre : la façade reste la même à toute distance.
const pxPerUnit = { value: 1000 };
const AO_SITE = `
  #ifdef USE_INSTANCING
  vSite = (instanceMatrix * vec4(transformed, 1.0)).xyz + normalize((instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz) * 0.5;
  #else
  vSite = transformed;
  #endif`;
const BAR_PX = [0.9, 2.2];
class Module {
  // keep : ses pièces gardent leur largeur à toute distance.
  constructor(keep = false) { this.body = []; this.bars = []; this.glass = []; this.keep = keep; this.barW = 0; }
  paint(g, color, kind, slim = null) {
    const geo = g.index ? g.toNonIndexed() : g, n = geo.attributes.position.count, c = lin(color);
    const col = new Float32Array(n * 3), k = new Float32Array(n).fill(kind);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aKind", new THREE.BufferAttribute(k, 1));
    // aBar : le centre de la barre sur son axe fin, sa largeur (0 : pas une barre), cet axe (0 x, 1 y).
    const bar = new Float32Array(n * 3);
    if (slim) for (let i = 0; i < n; i++) bar.set(slim, i * 3);
    geo.setAttribute("aBar", new THREE.BufferAttribute(bar, 3));
    for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "color", "aKind", "aBar"].includes(name)) geo.deleteAttribute(name);
    // Les barres fines à part : de loin, réduites à rien par le shader, on ne les dessine plus du tout.
    if (slim) { this.bars.push(geo); this.barW = Math.max(this.barW, slim[1]); } else this.body.push(geo);
    return this;
  }
  box(x0, y0, z0, x1, y1, z1, color, kind = PLAIN, tilt = 0) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    if (tilt) g.rotateX(tilt);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const wide = x1 - x0, tall = y1 - y0;
    const slim = this.keep || Math.min(wide, tall) >= 0.13 ? null : wide < tall ? [(x0 + x1) / 2, wide, 0] : [(y0 + y1) / 2, tall, 1];
    return this.paint(g, color, kind, slim);
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
      // Indexée : chaque sommet partagé n'est calculé qu'une fois (jusqu'à trois fois moins de travail
      // pour la carte graphique), sans rien changer à l'image.
      return mergeVertices(g, 1e-6);
    };
    return { body: merge(this.body), bars: merge(this.bars), barW: this.barW, glass: merge(this.glass) };
  }
}
const ALU = "#a9adb2", JOINT = "#26282b", TILE_C = "#cdbfa6", NAVY = "#1d3760", WHITE = "#e4e3de", GREY_R = "#9aa7aa", TAUPE = "#8f867a", BLACK = "#101114";
function aluminium(rich) {
  // ME, MA, CM…, 7,20 × 3,75 m : deux rangs de tôles embouties à persiennes, puis une longue baie
  // dans un cadre arrondi, le vitrage en retrait.
  const m = new Module();
  // Le fond sombre s'arrête sous la baie : 3 cm derrière le verre, il le perçait à distance.
  // (De loin, ces fonds sont entièrement cachés par la tôle et le cadre : inutile de les dessiner.)
  if (rich) {
    m.box(0, 0, 0, 7.2, 2.04, 0.05, JOINT); m.box(0, 3.58, 0, 7.2, 3.75, 0.05, JOINT);
    m.box(0, 2.04, 0, 0.26, 3.58, 0.05, JOINT); m.box(6.94, 2.04, 0, 7.2, 3.58, 0.05, JOINT);
  }
  for (const [y0, y1] of [[0.02, 0.93], [0.95, 1.86]]) {
    for (const [x0, x1] of [[0.03, 4.3], [4.34, 7.17]]) {
      if (rich) {
        m.pillow(x0, y0, x1, y1, 0.16, 0.08, 0.2, ALU, PLAIN, null, 0.05);
        const half = (x0 + x1) / 2;
        m.sheet(x0 + 0.24, y0 + 0.2, half - 0.08, y1 - 0.2, 0.36, ALU, LOUVRE);
        m.sheet(half + 0.08, y0 + 0.2, x1 - 0.24, y1 - 0.2, 0.36, ALU, LOUVRE);
      }
    }
  }
  // De loin, une seule tôle : les joints de 2 à 4 cm grouilleraient sans rien montrer.
  if (!rich) m.box(0.03, 0.02, 0.05, 7.17, 1.88, 0.32, ALU, LOUVRE);
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
    m.box(x0, 2.54 - 1.9 * down[side], 0.1, x1, 2.53, 0.115, "#8b8f91", LOUVRE);   // le store baissé, ses lames dessinées
  }
  m.pane(0.42, 0.62, 5.58, 2.62, 0.05);
  return m.done();
}
function rtsBox() {
  // RTS, 6,00 × 3,70 m : enduit blanc lisse, une baie de 4,20 m à quatre vantaux, châssis blancs.
  const m = new Module(), W = "#eceae5";
  m.pillow(0, 0, 6, 3.7, 0.001, 0, 0.16, W, RENDER, [0.9, 1.0, 5.1, 2.8, 0.001], 0, 1);
  // Châssis clairs de 14 cm : c'est eux qui dessinent la baie de loin.
  const F = "#e6e7e6";
  m.box(0.9, 1.0, 0.03, 5.1, 1.14, 0.11, F); m.box(0.9, 2.66, 0.03, 5.1, 2.8, 0.11, F);
  for (const x of [0.97, 1.78, 2.59, 3.41, 4.22, 5.03]) m.box(x - 0.065, 1.0, 0.03, x + 0.065, 2.8, 0.11, F);
  m.pane(0.9, 1.0, 5.1, 2.8, 0.05);
  return m.done();
}
function curtain(w, h, color, slim) {
  // Mur-rideau : une grille de montants devant le verre.
  const m = new Module();
  m.box(0, 0, 0, slim, h, 0.16, color); m.box(0, 0, 0, w, slim, 0.12, color);
  m.pane(0, 0, w, h, 0.04);
  return m.done();
}
function bcSide() {
  // BC, le long côté : enduit gris clair, une haute fenêtre étroite par travée.
  const m = new Module(true), G = "#c4c6c4";
  m.box(0, 0, 0, 1.6, 3.7, 0.08, G, RENDER);
  m.box(0.6, 0.55, 0.02, 0.98, 3.25, 0.1, "#dfe1e1");
  m.pane(0.64, 0.6, 0.94, 3.2, 0.03);
  return m.done();
}
function bcFront() {
  // BC, le pignon vitré : grandes vitres à traverses, socle de lames.
  const m = new Module(true), F = "#d9dbdb";
  m.box(0, 0, 0.02, 2.4, 0.9, 0.14, "#b8bcbd", LOUVRE);
  m.box(0, 0.9, 0.02, 0.08, 3.7, 0.12, F); m.box(0, 3.62, 0.02, 2.4, 3.7, 0.12, F); m.box(0, 2.27, 0.02, 2.4, 2.33, 0.12, F);
  m.box(1.17, 0.9, 0.02, 1.23, 3.7, 0.11, F);
  m.pane(0, 0.9, 2.4, 3.7, 0.04);
  return m.done();
}
function darkMetal() {
  // BC : un bardage nervuré noir, de hauts vitrages étroits.
  const m = new Module();
  m.box(0, 0, 0, 1.58, 3.7, 0.04, "#0d0e10"); m.box(1.58, 0, 0, 3.6, 0.1, 0.04, "#0d0e10"); m.box(1.58, 3.6, 0, 3.6, 3.7, 0.04, "#0d0e10");
  m.sheet(0, 0, 1.5, 3.7, 0.14, "#17181b", RIB);
  m.box(1.5, 0, 0.04, 1.58, 3.7, 0.16, "#17181b"); m.box(3.52, 0, 0.04, 3.6, 3.7, 0.16, "#17181b");
  m.pane(1.58, 0.1, 3.52, 3.6, 0.06);
  return m.done();
}
function timber() {
  // ArtLab : des lames de bois verticales.
  // Sur les photos : de minces piles de béton clair, du verre entre elles, le bois reste sous le toit.
  const m = new Module(true);
  // Sur les photos : de larges lames de bois grisé, serrées, un étroit vitrage entre elles.
  m.box(0, 0, 0, 0.62, 3, 0.3, "#c9c2b3", RENDER);
  m.box(0.62, 2.75, 0.02, 0.95, 3, 0.12, "#a69f92", RENDER);
  m.pane(0.62, 0.05, 0.95, 2.75, 0.06);
  return m.done();
}
function rtsSlab() {
  // La dalle RTS, 2,40 × 6,00 m : bandeau blanc, longue bande de verre, bandeau blanc. Les poutres
  // Warren sont à l'intérieur, derrière le verre.
  const m = new Module(), W = "#eae8e3";
  m.box(0, 0, 0, 2.4, 1.3, 0.1, W, RENDER); m.box(0, 4.9, 0, 2.4, 6, 0.1, W, RENDER);
  m.box(0, 1.3, 0.02, 0.14, 4.9, 0.14, "#dfe1e1");
  m.box(0, 3.5, 0.02, 2.4, 3.64, 0.12, "#dfe1e1");
  m.pane(0, 1.3, 2.4, 4.9, 0.04);
  return m.done();
}
function redTop() {
  // L'étage en retrait des blocs ME, MA, CM, PH : ossature d'acier rouge, vitrage toute hauteur à
  // traverse, grand auvent noir porté par une poutre triangulée.
  const m = new Module(), RED = "#d0471f", BLK = "#14151a", STEEL = "#23252a";
  m.box(0, 0, 0, 7.2, 0.35, 0.16, RED);
  for (const x of [0.5, 2.55, 4.6, 6.65]) {
    m.box(x - 0.1, 0.35, 0.02, x + 0.1, 3.4, 0.22, RED);
    // Le bracon, du poteau vers le bord de l'auvent, et le tirant au-dessus.
    const strut = new THREE.BoxGeometry(0.08, 0.08, 1.9);
    strut.rotateX(0.38); strut.translate(x, 3.05, 1.0);
    m.paint(strut, STEEL, PLAIN);
  }
  for (const x of [1.03, 1.53, 2.03, 3.07, 3.57, 4.07, 5.12, 5.62, 6.12]) m.box(x - 0.025, 0.35, 0.02, x + 0.025, 3.4, 0.08, "#2b2d30");
  m.box(0, 2.45, 0.02, 7.2, 2.5, 0.08, "#2b2d30");
  m.box(0, 3.4, 0, 7.2, 3.62, 2.1, BLK);
  m.box(0, 3.3, 1.95, 7.2, 3.4, 2.1, STEEL);
  m.pane(0, 0.35, 7.2, 3.4, 0.03);
  return m.done();
}
function mxBay() {
  // MX, 3,60 × 3,60 m : piliers de béton clair, grille de vitrage blanche, allège à lames.
  const m = new Module(), PIER = "#c9c5bb", LAME = "#9fa4a6";
  m.box(0, 0, 0, 0.42, 3.6, 0.42, PIER, RENDER);
  m.box(0.42, 0, 0, 3.6, 0.14, 0.2, PIER, RENDER);
  m.box(0.42, 0.2, 0.05, 3.6, 1.05, 0.09, LAME, LOUVRE);   // l'allège à lames : une tôle, ses lames dessinées
  m.box(0.42, 1.06, 0.02, 3.6, 1.14, 0.1, WHITE); m.box(0.42, 3.52, 0.02, 3.6, 3.6, 0.1, WHITE);
  for (const y of [1.9, 2.72]) m.box(0.42, y - 0.025, 0.02, 3.6, y + 0.025, 0.09, WHITE);
  for (const x of [1.48, 2.54]) m.box(x - 0.025, 1.14, 0.02, x + 0.025, 3.52, 0.09, WHITE);
  m.pane(0.42, 1.14, 3.6, 3.52, 0.03);
  return m.done();
}
function steelPost() { const m = new Module(true); m.box(-0.11, 0, -0.11, 0.11, 1, 0.11, "#2b2d31"); return m.done(); }
function plainWall() { const m = new Module(true); m.box(0, 0, 0, 1, 1, 0.12, "#ffffff", RENDER); return m.done(); }
function shutter() {
  const m = new Module(true);
  m.box(0, 0, 0, 1, 1, 0.07, "#c3c7ca", LOUVRE);
  m.box(-0.04, 0, 0.0, 0.0, 1, 0.1, "#dfe2e4"); m.box(1, 0, 0, 1.04, 1, 0.1, "#dfe2e4");
  return m.done();
}
// ME D : l'auvent d'entrée, un faisceau de tubes d'acier inclinés, contre l'angle sud-ouest.
function medCanopy() {
  const m = new Module(true), S = 1 / M;
  const v = (x, y, z) => new THREE.Vector3(x * S, y * S, z * S);
  const bar = (a, b, w) => {
    const g = new THREE.BoxGeometry(w * S, w * S, a.distanceTo(b));
    g.applyMatrix4(new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0)));
    const c = a.clone().add(b).multiplyScalar(0.5); g.translate(c.x, c.y, c.z);
    m.paint(g, "#cfd3d6", PLAIN);
  };
  // Des cadres parallèles qui s'inclinent hors de la façade, reliés par des lisses et des diagonales.
  const X = -23.95, Z0 = 18.4, N = 6, DZ = 0.42;
  const top = (k) => v(X - 0.05, 2.25 - k * 0.05, Z0 + k * DZ), foot = (k) => v(X - 1.7 - k * 0.06, 0.32, Z0 + k * DZ + 0.25);
  const knee = (k) => v(X - 1.45 - k * 0.05, 1.25, Z0 + k * DZ + 0.1);
  for (let k = 0; k < N; k++) {
    bar(foot(k), knee(k), 0.05); bar(knee(k), top(k), 0.045); bar(knee(k), v(X - 0.05, 1.05, Z0 + k * DZ), 0.035);
    bar(foot(k), v(X - 0.05, 0.6, Z0 + k * DZ), 0.03);
    if (k) {
      bar(knee(k - 1), knee(k), 0.03); bar(top(k - 1), top(k), 0.03);
      bar(knee(k - 1), top(k), 0.025); bar(foot(k - 1), knee(k), 0.025);
    }
  }
  return bodyOf(m);
}
// Quartier Nord (logements, hôtel) : bardage gris clair, fenêtres verticales au rythme irrégulier ;
// côté cour, des loggias aux panneaux de couleur.
function qnBay(v) {
  const m = new Module(true), G = "#c8c4ba", F = "#8f8f8a";
  m.box(0, 0, 0, 2.4, 3.05, 0.1, G, RENDER);
  for (const [x0, x1] of v === 0 ? [[0.25, 0.95]] : v === 1 ? [[1.35, 2.05]] : [[0.3, 0.9], [1.5, 2.1]]) {
    m.box(x0 - 0.05, 0.55, 0.02, x1 + 0.05, 2.7, 0.12, F);
    m.pane(x0, 0.6, x1, 2.65, 0.04);
  }
  const k = m.done();
  return k;
}
function qnLoggia() {
  const m = new Module(true);
  m.box(0, 0, 0, 2.4, 0.3, 0.6, "#d6d3cb", RENDER);
  m.box(0, 2.85, 0, 2.4, 3.05, 0.6, "#d6d3cb", RENDER);
  m.box(0, 0.3, 0, 0.12, 2.85, 0.6, "#d6d3cb", RENDER);
  m.box(1.25, 0.3, 0.02, 2.3, 2.85, 0.1, "#ffffff", PLAIN);   // le panneau de couleur (teinte d'instance)
  m.box(0.12, 0.3, 0.45, 2.4, 0.95, 0.5, "#9a9a96", PLAIN);  // garde-corps
  m.pane(0.15, 0.3, 1.25, 2.85, 0.03);
  const k = m.done(); k.lit = true;
  return k;
}
function ribbed() { const m = new Module(true); m.box(0, 0, 0, 1, 1, 0.05, "#ffffff", RIB); return m.done(); }
function mullion() { const m = new Module(true); m.box(-0.035, 0, 0, 0.035, 1, 0.16, "#15171a"); return m.done(); }

// Le passage de l'avenue Piccard, entre CM et CE : pas un bâtiment, une toiture tridimensionnelle d'acier
// noir sur de hauts poteaux, ouverte dessous. La passerelle de la Méridienne franchit l'avenue au niveau
// du premier étage, deux escaliers en U à paliers arrondis descendent à la cour pavée. Tracé d'après
// OpenStreetMap, hauteurs d'après le maillage, dessin d'après les photos.
const AGORA_GROUND = 0.6;
const lampMat = new THREE.MeshStandardMaterial({ color: "#2a2620", emissive: "#ffd7a3", emissiveIntensity: 0, side: THREE.DoubleSide });
function crossing() {
  const m = new Module(), S = 1 / M;                   // m.box travaille en mètres
  const STEEL = "#1d1f24", CHORD = "#272a30", CONCRETE = "#a19e96", SETT = "#6b6a66", ROAD = "#404246";
  const GROUND = 0.52, DECK = 1.97, ROOF = 3.23, DEPTH = 0.42, LOW = ROOF - DEPTH;
  const box = (x0, y0, z0, x1, y1, z1, color, kind = PLAIN) => m.box(x0 * S, y0 * S, z0 * S, x1 * S, y1 * S, z1 * S, color, kind);
  const v = (x, y, z) => new THREE.Vector3(x * S, y * S, z * S);
  const beam = (a, b, w, h, color, kind = PLAIN) => {  // une barre de a vers b, gardant son dessus vers le haut
    const d = b.clone().sub(a), g = new THREE.BoxGeometry(w * S, h * S, d.length());
    g.applyMatrix4(new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0)));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.paint(g, color, kind);
  };
  // Le sol : la cour pavée et l'avenue.
  // (Le terrain descend vers le nord : 0,57 à 0,48 ; le sol le suit, juste au-dessus de la photo aérienne.)
  beam(v(1.165, 0.57, 34.8), v(1.165, 0.49, 42.5), 11.53, 0.03, SETT, RENDER);
  beam(v(0.8, 0.585, 34.8), v(0.8, 0.505, 42.5), 1.4, 0.03, ROAD, RENDER);
  // La toiture : deux nappes de barres et leurs diagonales, trame de 3,60 m.
  const B = 0.6, under = (x, z) => z > 37.25 || x > 2.25;
  box(-4.68, ROOF - 0.03, 37.2, 7.04, ROOF, 42.43, STEEL);
  box(2.2, ROOF - 0.03, 36, 7.04, ROOF, 37.2, STEEL);
  for (let x = -4.6; x < 6.95; x += B) for (let z = 36.05; z < 42.3; z += B) {
    if (!under(x + B / 2, z + B / 2)) continue;
    const c = v(x + B / 2, LOW, z + B / 2);
    for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) beam(v(x + i * B, ROOF - 0.03, z + j * B), c, 0.035, 0.035, STEEL);
    beam(c, v(x + B * 1.5, LOW, z + B / 2), 0.04, 0.04, CHORD);
    beam(c, v(x + B / 2, LOW, z + B * 1.5), 0.04, 0.04, CHORD);
  }
  for (const [a, b] of [[[-4.68, 42.43], [7.04, 42.43]], [[-4.68, 37.2], [2.2, 37.2]], [[2.2, 36], [7.04, 36]], [[2.2, 36], [2.2, 37.2]]]) beam(v(a[0], ROOF - 0.05, a[1]), v(b[0], ROOF - 0.05, b[1]), 0.1, 0.16, STEEL);
  box(-4.62, 2.6, 36.18, 2.2, 2.64, 37.23, STEEL);     // la marquise, côté sud
  box(-4.62, 2.5, 36.18, 2.2, 2.6, 36.26, STEEL);
  // Les poteaux, de part et d'autre de l'avenue et des escaliers.
  for (const x of [-3.4, -0.3, 2.0, 5.1]) for (const z of [36.4, 39.0, 41.9]) box(x - 0.05, GROUND, z - 0.05, x + 0.05, z < 37 && x < 2.2 ? 2.64 : LOW, z + 0.05, STEEL);
  // La passerelle, son retour nord, la galerie le long de CE ; tous bordés d'un garde-corps de béton.
  const slab = (x0, z0, x1, z1) => {
    box(x0, DECK - 0.2, z0, x1, DECK, z1, CONCRETE, RENDER);
  };
  const wall = (x0, z0, x1, z1) => box(x0, DECK, z0, x1, DECK + 0.17, z1, CONCRETE, RENDER);
  slab(-4.6, 40.1, 6.93, 41.5); slab(-1.7, 41.5, -0.5, 42.5); slab(4.9, 36.1, 6.93, 40.1);
  wall(-4.6, 41.46, -1.7, 41.5); wall(-0.5, 41.46, 6.93, 41.5);
  wall(-4.6, 40.1, -1.0, 40.14); wall(-0.5, 40.1, 3.9, 40.14); wall(4.9, 36.1, 4.94, 40.1); wall(4.9, 36.1, 6.93, 36.14);
  // Les escaliers : une volée sur le palier, une autre vers la passerelle ; joues de béton, palier arrondi.
  const stair = (xA, xB, turn, foot, w) => {
    const mid = (GROUND + DECK) / 2, cx = (xA + xB) / 2, r = (xB - xA) / 2 + w / 2;
    for (const [x, y0, y1, z0] of [[xA, GROUND, mid, foot], [xB, DECK, mid, 40.1]]) {
      const a = v(x, y0 - 0.06, z0), b = v(x, y1 - 0.06, turn);
      beam(a, b, w, 0.12, CONCRETE, RENDER);
      for (const side of [-1, 1]) {
        const o = side * (w / 2 - 0.012);
        beam(v(x + o, y0 + 0.08, z0), v(x + o, y1 + 0.08, turn), 0.024, 0.17, CONCRETE, RENDER);
      }
    }
    box(xA - w / 2, mid - 0.12, turn - 0.02, xB + w / 2, mid, turn + 0.25, CONCRETE, RENDER);
    const end = new THREE.CylinderGeometry(r * S, r * S, 0.12 * S, 20, 1, false, Math.PI / 2, Math.PI);
    end.translate(cx * S, (mid - 0.06) * S, turn * S);
    m.paint(end, CONCRETE, RENDER);
    const rim = new THREE.CylinderGeometry(r * S, r * S, 0.29 * S, 20, 1, true, Math.PI / 2, Math.PI);
    rim.translate(cx * S, (mid + 0.02) * S, turn * S);
    m.paint(rim, CONCRETE, RENDER);
  };
  stair(2.9, 4.3, 38.1, 40.7, 0.42);
  stair(-1.75, -0.75, 38.0, 40.7, 0.34);
  // Rien n'est tourné vers un mur ici : toutes les faces restent, contrairement aux modules de façade.
  const geo = mergeGeometries(m.body);
  geo.scale(M, M, M);
  const steel = new THREE.Mesh(geo, facadeMat.clone());
  steel.material.onBeforeCompile = facadeMat.onBeforeCompile;
  steel.material.side = THREE.DoubleSide;
  steel.castShadow = steel.receiveShadow = true;
  // Les luminaires, sous la nappe basse.
  const lamp = new THREE.BoxGeometry(0.16, 0.02, 0.05), spots = [];
  for (let x = -3.9; x < 6.8; x += 1.8) for (const z of [37.8, 39.6, 41.9]) spots.push(new THREE.Matrix4().makeTranslation(x, LOW - 0.04, z));
  const lamps = new THREE.InstancedMesh(lamp, lampMat, spots.length);
  spots.forEach((p, i) => lamps.setMatrixAt(i, p));
  const group = new THREE.Group();
  group.add(steel, lamps);
  return group;
}

// L'Agora Lombard Odier, « le Disque » (ALICE, EPFL, 2019), place Cosandey : un disque de 31 m incliné
// de 17°, posé sur le sol au sud-ouest, gradins de bois au-dessus, un grand oculus bordé de blanc,
// une forêt de poteaux blancs sur le gravier, en dessous.
function agora() {
  const m = new Module(true), S = 1 / M, D = DISC;
  const TIMBER = "#cdb893", RISER = "#7f6a4c", DARK = "#8c7350", WHITE_T = "#eeeeea", GRAVEL = "#c8c2b4";
  const plane = (x, z) => 0.17427 * x + 0.25624 * z + 3.5945;
  const len = Math.hypot(0.17427, 0.25624), ax = 0.17427 / len, az = 0.25624 / len, bx = -az, bz = ax;
  const at = (t, u) => [D.x + ax * t + bx * u, D.z + az * t + bz * u];
  const hole = { t: (D.hx - D.x) * ax + (D.hz - D.z) * az, u: (D.hx - D.x) * bx + (D.hz - D.z) * bz };
  const mesh = (color, kind, build) => {
    const pos = [], nrm = [];
    const quad = (a, b, c, d) => {
      const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), e2 = new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
      const n = e1.cross(e2).normalize();
      for (const p of [a, b, c, a, c, d]) { pos.push(p[0] * S, p[1] * S, p[2] * S); nrm.push(n.x, n.y, n.z); }
    };
    build(quad);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nrm), 3));
    m.paint(g, color, kind);
  };
  const v = (p) => new THREE.Vector3(p[0] * S, p[1] * S, p[2] * S);
  const bar = (a, b, w, color) => {
    const d = v(b).sub(v(a)), g = new THREE.BoxGeometry(w * S, w * S, d.length());
    g.applyMatrix4(new THREE.Matrix4().lookAt(v(a), v(b), new THREE.Vector3(0, 1, 0)));
    const c = v(a).add(v(b)).multiplyScalar(0.5);
    g.translate(c.x, c.y, c.z);
    m.paint(g, color, RENDER);
  };
  // Les gradins : marches droites, de niveau, découpées dans le disque et son oculus.
  const STEP = 0.2, chord = (t) => Math.sqrt(Math.max(0, D.r * D.r - t * t));
  const holeAt = (t) => Math.sqrt(Math.max(0, hole.hr2 - (t - hole.t) ** 2));
  hole.hr2 = D.hr * D.hr;
  const steps = (color, treads) => mesh(color, RENDER, (quad) => {
    for (let t = -D.r; t < D.r; t += STEP) {
      const t1 = Math.min(D.r, t + STEP), [cx, cz] = at((t + t1) / 2, 0), y = plane(cx, cz) + 0.06;
      const [nx, nz] = at(t1 + STEP / 2, 0), next = plane(nx, nz) + 0.06;
      const spans = [];
      const h0 = holeAt(t), h1 = holeAt(t1), inHole = h0 > 0 || h1 > 0;
      if (inHole) { spans.push([-chord(t), -chord(t1), hole.u - h0, hole.u - h1], [hole.u + h0, hole.u + h1, chord(t), chord(t1)]); }
      else spans.push([-chord(t), -chord(t1), chord(t), chord(t1)]);
      for (const [a0, a1, b0, b1] of spans) {
        const P = (tt, u, yy) => { const [x, z] = at(tt, u); return [x, yy, z]; };
        if (treads) quad(P(t, b0, y), P(t1, b1, y), P(t1, a1, y), P(t, a0, y));
        else if (t1 < D.r) quad(P(t1, a1, y), P(t1, b1, y), P(t1, b1, next), P(t1, a1, next));
      }
    }
  });
  steps(TIMBER, true);
  steps(RISER, false);                                 // les contremarches, plus sombres : on lit les gradins
  // Le dessous de bois, ses bords blancs, ses nervures, la main courante.
  const ring = (cx, cz, r, i, n) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; };
  const N = 56;
  mesh(DARK, RENDER, (quad) => {
    for (let i = 0; i < N; i++) {
      const o0 = ring(D.x, D.z, D.r, i, N), o1 = ring(D.x, D.z, D.r, i + 1, N), h0 = ring(D.hx, D.hz, D.hr, i, N), h1 = ring(D.hx, D.hz, D.hr, i + 1, N);
      const P = (p) => [p[0], plane(p[0], p[1]) - 0.12, p[1]];
      quad(P(o0), P(h0), P(h1), P(o1));
    }
  });
  mesh(WHITE_T, RENDER, (quad) => {
    for (let i = 0; i < N; i++) for (const [cx, cz, r] of [[D.x, D.z, D.r], [D.hx, D.hz, D.hr]]) {
      const p = ring(cx, cz, r, i, N), q = ring(cx, cz, r, i + 1, N);
      const lo = (e) => plane(e[0], e[1]) - 0.12, hi = (e) => plane(e[0], e[1]) + 0.05;
      quad([p[0], lo(p), p[1]], [q[0], lo(q), q[1]], [q[0], hi(q), q[1]], [p[0], hi(p), p[1]]);
    }
  });
  for (let i = 0; i < 24; i++) {
    const o = ring(D.x, D.z, D.r, i, 24), h = ring(D.hx, D.hz, D.hr, i, 24);
    bar([o[0], plane(o[0], o[1]) - 0.17, o[1]], [h[0], plane(h[0], h[1]) - 0.17, h[1]], 0.05, WHITE_T);
  }
  for (const r of [1.7, 2.15]) for (let i = 0; i < 28; i++) {
    const p = ring(D.x + (D.hx - D.x) * (D.r - r) / (D.r - D.hr), D.z + (D.hz - D.z) * (D.r - r) / (D.r - D.hr), r, i, 28), q = ring(D.x + (D.hx - D.x) * (D.r - r) / (D.r - D.hr), D.z + (D.hz - D.z) * (D.r - r) / (D.r - D.hr), r, i + 1, 28);
    bar([p[0], plane(p[0], p[1]) - 0.17, p[1]], [q[0], plane(q[0], q[1]) - 0.17, q[1]], 0.035, WHITE_T);
  }
  for (const [cx, cz, r, n] of [[D.x, D.z, D.r, 56], [D.hx, D.hz, D.hr, 32]]) for (let i = 0; i < n; i++) {
    const p = ring(cx, cz, r, i, n), q = ring(cx, cz, r, i + 1, n);
    const top = (e) => [e[0], plane(e[0], e[1]) + 0.3, e[1]];
    bar(top(p), top(q), 0.022, WHITE_T);
    if (i % 2 === 0) bar([p[0], plane(p[0], p[1]) + 0.08, p[1]], top(p), 0.018, WHITE_T);
  }
  // Les poteaux, de hauteurs et d'écarts variés ; seulement là où le disque a décollé.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 64; i++) {
    const a = rnd() * Math.PI * 2, r = D.hr + 0.25 + rnd() * (D.r - D.hr - 0.3);
    const x = D.hx + Math.cos(a) * r, z = D.hz + Math.sin(a) * r;
    if (Math.hypot(x - D.x, z - D.z) > D.r - 0.1) continue;
    const top = plane(x, z) - 0.17;
    if (top < AGORA_GROUND + 0.25) continue;
    const g = new THREE.CylinderGeometry(0.055 * S, 0.055 * S, (top - AGORA_GROUND) * S, 10);
    g.translate(x * S, (top + AGORA_GROUND) / 2 * S, z * S);
    m.paint(g, WHITE_T, RENDER);
  }
  // Le gravier sous le disque : le sol y bombe (0,6 au bord, 0,94 au centre), il suit.
  const pad = new THREE.CylinderGeometry(2.3 * S, 3.1 * S, 0.38 * S, 48);
  pad.translate(D.x * S, (AGORA_GROUND + 0.19) * S, D.z * S);
  m.paint(pad, GRAVEL, RENDER);
  const geo = mergeGeometries(m.body);
  geo.scale(M, M, M);
  const mesh3 = new THREE.Mesh(geo, facadeMat.clone());
  mesh3.material.onBeforeCompile = facadeMat.onBeforeCompile;
  mesh3.material.side = THREE.DoubleSide;
  mesh3.castShadow = mesh3.receiveShadow = true;
  return mesh3;
}
// Odyssea (ODY), l'ancien bâtiment Swisscom, le « vaisseau spatial » : un tambour de verre sombre, un noyau
// de béton qui le traverse, trois plateaux en éventail bordés de garde-corps, une plate-forme ronde et
// le grand mât. Emprise d'après OpenStreetMap, niveaux d'après le maillage, dessin d'après photo.
const odyGlassMat = new THREE.MeshStandardMaterial({ color: "#3a4852", roughness: 0.08, metalness: 0.85, side: THREE.DoubleSide });
const odyRoomMat = new THREE.MeshStandardMaterial({ color: "#3a4852", roughness: 0.08, metalness: 0.85, emissive: "#ffb56b", emissiveIntensity: 0, side: THREE.DoubleSide });
const beaconMat = new THREE.MeshStandardMaterial({ color: "#3a0505", emissive: "#ff2a12", emissiveIntensity: 0 });
function odyssea() {
  const m = new Module(true), S = 1 / M, G = 0.62;
  const STEEL = "#8e9498", PALE = "#b9b7ad", WHITE_O = "#e4e4df", DARK = "#2a2d31";
  const v = (x, y, z) => new THREE.Vector3(x * S, y * S, z * S);
  const bar = (a, b, w, color, kind = PLAIN) => {
    const d = a.clone().sub(b), g = new THREE.BoxGeometry(w * S, w * S, d.length());
    g.applyMatrix4(new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0)));
    const c = a.clone().add(b).multiplyScalar(0.5);
    g.translate(c.x, c.y, c.z);
    m.paint(g, color, kind);
  };
  const box = (x0, y0, z0, x1, y1, z1, color, kind = RENDER) => m.paint(new THREE.BoxGeometry((x1 - x0) * S, (y1 - y0) * S, (z1 - z0) * S).translate((x0 + x1) / 2 * S, (y0 + y1) / 2 * S, (z0 + z1) / 2 * S), color, kind);
  const slab = (pts, y0, y1, color, kind = PLAIN) => {
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x * S, z * S)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: (y1 - y0) * S, bevelEnabled: false });
    g.rotateX(Math.PI / 2);                            // le plan du tracé devient x, z ; l'épaisseur descend
    g.translate(0, y1 * S, 0);
    m.paint(g, color, kind);
  };
  // Le tambour : le contour, arrondi à l'est.
  const drum = [[40.2, 1.31], [40.56, -3.24], [43.22, -3.19], [44.15, -3.13], [44.44, -2.89], [44.4, -1.93], [44.29, -1.0], [44.09, 0.19], [43.74, 0.65], [43.48, 1.42], [43.25, 1.96], [42.6, 2.05], [41.5, 1.82]];
  const TOP = 4.35, FLOOR = (TOP - G - 0.45) / 5, pos = [], lit = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  drum.forEach((p, i) => {
    const q = drum[(i + 1) % drum.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]), bays = Math.max(1, Math.round(len / 0.6));
    for (let k = 0; k < bays; k++) {
      const a = [p[0] + (q[0] - p[0]) * k / bays, p[1] + (q[1] - p[1]) * k / bays], b = [p[0] + (q[0] - p[0]) * (k + 1) / bays, p[1] + (q[1] - p[1]) * (k + 1) / bays];
      pos.push(a[0], G + 0.45, a[1], b[0], G + 0.45, b[1], b[0], TOP, b[1], a[0], G + 0.45, a[1], b[0], TOP, b[1], a[0], TOP, a[1]);
      bar(v(a[0], G, a[1]), v(a[0], TOP, a[1]), 0.035, DARK);
      for (let f = 0; f < 5; f++) if (rnd() < 0.34) {
        const y = G + 0.45 + f * FLOOR, nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len, o = -0.02;
        lit.push(a[0] - nx * o, y + 0.1, a[1] - nz * o, b[0] - nx * o, y + 0.1, b[1] - nz * o, b[0] - nx * o, y + FLOOR - 0.12, b[1] - nz * o, a[0] - nx * o, y + 0.1, a[1] - nz * o, b[0] - nx * o, y + FLOOR - 0.12, b[1] - nz * o, a[0] - nx * o, y + FLOOR - 0.12, a[1] - nz * o);
      }
    }
    for (let f = 0; f <= 5; f++) bar(v(p[0], G + 0.45 + f * FLOOR, p[1]), v(q[0], G + 0.45 + f * FLOOR, q[1]), 0.06, "#596268");
  });
  const skin = (arr, mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3));
    g.computeVertexNormals();
    const o = new THREE.Mesh(g, mat);
    return o;
  };
  // Le socle en retrait, sombre ; le toit qui déborde en lentille.
  slab(drum.map(([x, z]) => [x + (42.3 - x) * 0.05, z + (-0.6 - z) * 0.05]), G, G + 0.45, DARK);
  slab(drum.map(([x, z]) => [x + (x - 42.3) * 0.05, z + (z + 0.6) * 0.05]), TOP, TOP + 0.09, WHITE_O);
  // Le noyau, les deux lames de service et l'escalier vitré entre elles, les conduites.
  box(41.85, G, -2.95, 42.55, 7.3, -2.25, PALE);
  box(41.76, G, -4.4, 42.14, 5.05, -3.2, PALE); box(42.6, G, -4.4, 43.0, 5.05, -3.2, PALE);
  box(42.14, G, -4.1, 42.6, 4.75, -3.2, "#7f8a90");
  for (let y = G + 0.3; y < 4.6; y += 0.62) box(42.2, y, -4.13, 42.54, y + 0.42, -4.08, WHITE_O, PLAIN);
  for (const x of [43.15, 43.32]) m.paint(new THREE.CylinderGeometry(0.05 * S, 0.05 * S, (5.3 - G) * S, 8).translate(x * S, (5.3 + G) / 2 * S, -3.1 * S), "#aeb3b5", PLAIN);
  // Les plateaux en éventail : plancher mince, sous-face sombre, garde-corps.
  const fan = [];
  for (let i = 0; i <= 14; i++) { const a = Math.PI * (1.02 - i / 14 * 1.04); fan.push([42.1 + Math.cos(a) * 1.18, -2.45 + Math.sin(a) * 0.72]); }
  fan.push([42.72, -3.95], [41.72, -3.95]);
  const rail = (pts, y, h) => pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    bar(v(p[0], y + h, p[1]), v(q[0], y + h, q[1]), 0.022, WHITE_O);
    bar(v(p[0], y + h * 0.5, p[1]), v(q[0], y + h * 0.5, q[1]), 0.012, WHITE_O);
    bar(v(p[0], y, p[1]), v(p[0], y + h, p[1]), 0.018, WHITE_O);
  });
  for (const y of [5.2, 6.1, 7.0]) {
    slab(fan, y - 0.07, y, STEEL);
    rail(fan, y, 0.19);
    for (const [x, z] of [[41.1, -2.2], [43.1, -2.2], [42.1, -1.75]]) bar(v(x, y - 0.07, z), v(42.2, y - 0.55, -2.6), 0.04, DARK);
  }
  // La plate-forme ronde au sommet.
  const round = [];
  for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; round.push([42.45 + Math.cos(a) * 0.76, -2.05 + Math.sin(a) * 0.76]); }
  slab(round, 7.22, 7.3, WHITE_O);
  rail(round, 7.3, 0.19);
  box(42.1, 7.3, -2.9, 42.34, 7.75, -2.66, PALE);
  // Le mât, par tronçons de plus en plus fins.
  for (const [y0, y1, r] of [[7.75, 9.2, 0.085], [9.2, 11, 0.055], [11, 12.6, 0.03]]) m.paint(new THREE.CylinderGeometry(r * 0.8 * S, r * S, (y1 - y0) * S, 10).translate(42.2 * S, (y0 + y1) / 2 * S, -2.8 * S), "#9aa0a4", PLAIN);
  const geo = mergeGeometries(m.body);
  geo.scale(M, M, M);
  const steel = new THREE.Mesh(geo, facadeMat.clone());
  steel.material.onBeforeCompile = facadeMat.onBeforeCompile;
  steel.material.side = THREE.DoubleSide;
  steel.castShadow = steel.receiveShadow = true;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), beaconMat);
  beacon.position.set(42.2, 12.64, -2.8);
  const group = new THREE.Group();
  group.add(steel, skin(pos, odyGlassMat), skin(lit, odyRoomMat), beacon);
  return group;
}
// Des morceaux de surface, posés en coordonnées du campus.
function surface(m, color, kind, build) {
  const pos = [], nrm = [], S = 1 / M;
  build((a, b, c, d) => {
    const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), e2 = new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    const n = e1.cross(e2).normalize();
    for (const p of [a, b, c, a, c, d]) { pos.push(p[0] * S, p[1] * S, p[2] * S); nrm.push(n.x, n.y, n.z); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nrm), 3));
  m.paint(g, color, kind);
}
function bodyOf(m) {
  const geo = mergeVertices(mergeGeometries(m.body), 1e-6);
  geo.scale(M, M, M);
  const o = new THREE.Mesh(geo, facadeMat.clone());
  o.material.onBeforeCompile = facadeMat.onBeforeCompile;
  o.material.side = THREE.DoubleSide;
  o.castShadow = o.receiveShadow = true;
  return o;
}
function glassSkin(tris, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tris), 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
const medGlassMat = new THREE.MeshStandardMaterial({ color: "#7b8c96", roughness: 0.1, metalness: 0.6, emissive: "#eef4ff", emissiveIntensity: 0 });
const qnGlassMat = new THREE.MeshStandardMaterial({ color: "#56646c", roughness: 0.1, metalness: 0.6, emissive: "#ffcf96", emissiveIntensity: 0 });
const stccGlassMat = new THREE.MeshStandardMaterial({ color: "#56788c", roughness: 0.08, metalness: 0.8, emissive: "#ffb366", emissiveIntensity: 0, side: THREE.DoubleSide });
const stccUnderMat = new THREE.MeshStandardMaterial({ color: "#a39c90", roughness: 0.45, metalness: 0.5, emissive: "#ffb366", emissiveIntensity: 0, side: THREE.DoubleSide });
const hallGlassMat = new THREE.MeshStandardMaterial({ color: "#56788c", roughness: 0.08, metalness: 0.8, emissive: "#ffb063", emissiveIntensity: 0, side: THREE.DoubleSide });
// Le SwissTech Convention Center : un toit plié, argent dessus, noir dessous, posé sur une haute salle de
// verre à fins montants. Les douze sommets de son toit viennent du maillage ; le débord d'après photos.
function swissTech() {
  const m = new Module(true), S = 1 / M;
  const R1 = [-51.1, 5.43, 89.25], R2 = [-43.65, 5.43, 89.34], S1 = [-51.32, 4.64, 79.35], S2 = [-43.19, 4.64, 79.45];
  const W = [-52.99, 3.76, 90.66], E = [-41.72, 3.81, 90.78], N1 = [-49.42, 3.76, 98.72], N2 = [-45.51, 3.72, 98.77];
  // Le débord : chaque bord dépasse le verre, le sud surtout, qui se relève.
  const out = (p, c, k, up = 0) => [p[0] + (p[0] - c[0]) * k, p[1] + up, p[2] + (p[2] - c[2]) * k];
  const C = [-47.3, 0, 89.3];
  const s1 = out(S1, C, 0.42, 1.25), s2 = out(S2, C, 0.42, 1.25), w = out(W, C, 0.16), e = out(E, C, 0.16), n1 = out(N1, C, 0.1), n2 = out(N2, C, 0.1);
  const faces = (q) => { q(s1, s2, R2, R1); q(R1, R2, n2, n1); q(s1, R1, w, w); q(s2, e, R2, R2); q(w, R1, n1, n1); q(R2, e, n2, n2); };
  const low = (p) => [p[0], p[1] - 0.16, p[2]];
  surface(m, "#d7dbde", LOUVRE, (q) => faces(q));     // des écailles d'aluminium, claires vu d'en haut
  const under = new Module(true);
  surface(under, "#ffffff", PLAIN, (q) => faces((a, b, c, d) => q(low(d), low(c), low(b), low(a))));
  surface(m, "#b4b9bd", PLAIN, (q) => { const rim = [s1, s2, e, n2, n1, w]; rim.forEach((p, i) => { const r = rim[(i + 1) % 6]; q(low(p), low(r), r, p); }); });
  // La salle de verre, ses montants verticaux serrés.
  const hall = [[S1, 1.6], [S2, 1.6], [E, 1.6], [N2, 0], [N1, 0], [W, 1.6]], glass = [];
  const bar = (a, b, wd, color) => {
    const va = new THREE.Vector3(a[0] * S, a[1] * S, a[2] * S), vb = new THREE.Vector3(b[0] * S, b[1] * S, b[2] * S), g = new THREE.BoxGeometry(wd * S, wd * S, va.distanceTo(vb));
    g.applyMatrix4(new THREE.Matrix4().lookAt(va, vb, new THREE.Vector3(0, 1, 0)));
    const c = va.clone().add(vb).multiplyScalar(0.5); g.translate(c.x, c.y, c.z);
    m.paint(g, color, PLAIN);
  };
  hall.forEach(([p, f0], i) => {
    const [r, f1] = hall[(i + 1) % 6], len = Math.hypot(r[0] - p[0], r[2] - p[2]), n = Math.max(2, Math.round(len / 0.45));
    glass.push(p[0], f0, p[2], r[0], f1, r[2], r[0], r[1] - 0.16, r[2], p[0], f0, p[2], r[0], r[1] - 0.16, r[2], p[0], p[1] - 0.16, p[2]);
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = p[0] + (r[0] - p[0]) * t, z = p[2] + (r[2] - p[2]) * t, y0 = f0 + (f1 - f0) * t, y1 = p[1] + (r[1] - p[1]) * t - 0.16;
      bar([x, y0, z], [x, y1, z], 0.05, "#20262b");
    }
  });
  const g = new THREE.Group();
  const ug = mergeGeometries(under.body); ug.scale(M, M, M);
  const um = new THREE.Mesh(ug, stccUnderMat); um.castShadow = true;
  g.add(bodyOf(m), um, glassSkin(glass, stccGlassMat));
  return g;
}
// Le Polydôme (Julius Natterer, 1991) : une coque en coussin, zinc nervuré, dont les rives se relèvent
// entre les angles, quatre lanterneaux au sommet ; à côté, la boîte de bois rouge.
function polydome() {
  const m = new Module(true), S = 1 / M, X = 8.25, Z = 58, TOPY = 2.17, RING = 22, SECT = 96, turn = -0.17;
  const plan = (a) => {                                // un carré aux angles très arrondis
    const c = Math.abs(Math.cos(a - turn)), n = Math.abs(Math.sin(a - turn));
    return 2.42 / (c ** 3.4 + n ** 3.4) ** (1 / 3.4);
  };
  const eave = (a) => 0.82 + 0.5 * Math.cos(2 * (a - turn)) ** 2;
  const at = (a, r) => { const rho = plan(a) * r, e = eave(a); return [X + Math.cos(a) * rho, e + (TOPY - e) * (1 - r ** 2.1), Z + Math.sin(a) * rho]; };
  for (const [color, odd] of [["#bcc3c8", 0], ["#a4acb2", 1]]) surface(m, color, PLAIN, (q) => {
    for (let i = odd; i < SECT; i += 2) for (let j = 0; j < RING; j++) {
      const a0 = i / SECT * Math.PI * 2, a1 = (i + 1) / SECT * Math.PI * 2, r0 = j / RING, r1 = (j + 1) / RING;
      q(at(a0, r1), at(a1, r1), at(a1, r0), at(a0, r0));
    }
  });
  // Les lanterneaux.
  for (let k = 0; k < 4; k++) {
    const a = turn + k * Math.PI / 2 + Math.PI / 4, [x, y, z] = at(a, 0.34), h = 0.2;
    m.paint(new THREE.BoxGeometry(0.46 * S, 0.1 * S, 0.46 * S).rotateY(-turn).translate(x * S, (y + 0.02) * S, z * S), "#e6e7e6", PLAIN);
    m.paint(new THREE.BoxGeometry(0.36 * S, 0.11 * S, 0.36 * S).rotateY(-turn).translate(x * S, (y + 0.03) * S, z * S), "#1f2a33", PLAIN);
  }
  // Le mur de verre sous la rive, en retrait.
  const glass = [];
  for (let i = 0; i < SECT; i++) {
    const a0 = i / SECT * Math.PI * 2, a1 = (i + 1) / SECT * Math.PI * 2, p = at(a0, 0.97), r = at(a1, 0.97);
    glass.push(p[0], 0.4, p[2], r[0], 0.4, r[2], r[0], r[1], r[2], p[0], 0.4, p[2], r[0], r[1], r[2], p[0], p[1], p[2]);
  }
  // La boîte rouge.
  surface(m, "#b3402c", RIB, (q) => {                  // ses murs seulement : le toit de gravier reste celui du maillage
    const c = [[2.58, 56.26], [5.82, 56.26], [5.82, 60.32], [2.58, 60.32]];
    c.forEach((p, i) => { const r = c[(i + 1) % 4]; q([p[0], 0.3, p[1]], [r[0], 0.3, r[1]], [r[0], 1.74, r[1]], [p[0], 1.74, p[1]]); });
  });
  const g = new THREE.Group();
  g.add(bodyOf(m), glassSkin(glass, hallGlassMat));
  return g;
}
// BC : un grand toit sombre en coin, qui se relève et déborde sur la façade de verre, une ligne rouge dessous.
// BC : un grand toit plat et mince, gris clair, qui déborde partout et se relève vers le pignon vitré ;
// sous lui, l'étage d'attique en verre ; au pied du pignon, l'auvent rouge de l'entrée.
function bcRoof() {
  const m = new Module(true);
  const X0 = -86.3, X1 = -77.7, Z0 = -4.1, Z1 = 9.6, YB = 4.02, YF = 4.55;
  const y = (z, dy) => YB + (YF - YB) * (Z1 - z) / (Z1 - Z0) + dy;
  const face = (dy) => [[X0, y(Z0, dy), Z0], [X1, y(Z0, dy), Z0], [X1, y(Z1, dy), Z1], [X0, y(Z1, dy), Z1]];
  surface(m, "#a9adb0", PLAIN, (q) => { const [a, b, c, d] = face(0); q(d, c, b, a); });
  surface(m, "#cfd1d0", PLAIN, (q) => { const [a, b, c, d] = face(-0.07); q(a, b, c, d); });
  surface(m, "#b9bcbd", PLAIN, (q) => {
    const t = face(0), u = face(-0.07);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; q(u[i], u[j], t[j], t[i]); }
  });
  // Les panneaux clairs sous le débord avant, comme sur la photo.
  surface(m, "#eceeee", PLAIN, (q) => { for (let i = 0; i < 4; i++) { const x = -84.8 + i * 1.6, z = -3.4; q([x, y(z, -0.075), z], [x + 1.1, y(z, -0.075), z], [x + 1.1, y(z + 0.5, -0.075), z + 0.5], [x, y(z + 0.5, -0.075), z + 0.5]); } });
  // L'attique vitré, en retrait sous le toit.
  surface(m, "#dfe1e1", PLAIN, (q) => { const c = [[-85.2, -1.9], [-78.8, -1.9], [-78.8, 8.8], [-85.2, 8.8]]; c.forEach((p, i) => { const r = c[(i + 1) % 4]; q([p[0], 3.83, p[1]], [r[0], 3.83, r[1]], [r[0], 3.87, r[1]], [p[0], 3.87, p[1]]); }); });
  // L'auvent rouge, au pied du pignon.
  m.paint(new THREE.BoxGeometry(1.3 / M, 0.06 / M, 0.55 / M).translate(-83.2 / M, 0.72 / M, -2.3 / M), "#c8202a", PLAIN);
  m.paint(new THREE.BoxGeometry(1.3 / M, 0.42 / M, 0.04 / M).translate(-83.2 / M, 0.5 / M, -2.56 / M), "#c8202a", PLAIN);
  const g = new THREE.Group();
  const att = [];
  const c = [[-85.2, -1.9], [-78.8, -1.9], [-78.8, 8.8], [-85.2, 8.8]];
  c.forEach((p, i) => { const r = c[(i + 1) % 4]; att.push(p[0], 3.87, p[1], r[0], 3.87, r[1], r[0], y(r[1], -0.08), r[1], p[0], 3.87, p[1], r[0], y(r[1], -0.08), r[1], p[0], y(p[1], -0.08), p[1]); });
  g.add(bodyOf(m), glassSkin(att, hallGlassMat));
  return g;
}
// Le lissage d'un contour, et son décalage vers l'intérieur (d < 0) ou l'extérieur.
const chaikin = (p) => p.flatMap((a, i) => { const b = p[(i + 1) % p.length]; return [[a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]]; });
function offsetLine(p, d) {
  let area = 0;
  p.forEach((a, i) => { const b = p[(i + 1) % p.length]; area += a[0] * b[1] - b[0] * a[1]; });
  const sgn = area > 0 ? 1 : -1;
  return p.map((a, i) => {
    const u = p[(i + p.length - 1) % p.length], v = p[(i + 1) % p.length];
    let nx = (v[1] - u[1]) * sgn, nz = -(v[0] - u[0]) * sgn;
    const l = Math.hypot(nx, nz) || 1;
    return [a[0] + nx / l * d, a[1] + nz / l * d];
  });
}
function prism(pts, y0, y1) {                          // un contour extrudé, en unités de scène
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z))), { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(Math.PI / 2);
  g.translate(0, y1, 0);
  return g;
}
const rtsCoreMat = new THREE.MeshStandardMaterial({ color: "#e4e1d8", roughness: 0.7, emissive: "#fff1d6", emissiveIntensity: 0 });
const rtsGroundMat = new THREE.MeshStandardMaterial({ color: "#e9e6dc", roughness: 0.8, emissive: "#ffd9a0", emissiveIntensity: 0 });
const rtsRezMat = new THREE.MeshStandardMaterial({ color: "#7f9aab", roughness: 0.1, metalness: 0.6, emissive: "#fff0cf", emissiveIntensity: 0, side: THREE.DoubleSide });
const rtsUnderMat = new THREE.MeshStandardMaterial({ color: "#d8d0bb", roughness: 0.6, emissive: "#ffdca6", emissiveIntensity: 0 });
const rtsRibbonMat = new THREE.MeshStandardMaterial({ color: "#a9c7da", roughness: 0.06, metalness: 0.35, transparent: true, opacity: 0.46, depthWrite: false, side: THREE.DoubleSide });
const rtsShedGlassMat = new THREE.MeshStandardMaterial({ color: "#6f8ea3", roughness: 0.08, metalness: 0.7, emissive: "#ffe3b8", emissiveIntensity: 0, side: THREE.DoubleSide });
// La RTS (OFFICE Kersten Geers David Van Severen, 2025) : un anneau continu, ruban de verre sur un socle
// de lames d'argent, suspendu à 8 m, que traversent quatre boîtes blanches ; sur l'anneau, de longs sheds
// de zinc vitrés sur leur face raide ; dessous, un rez en retrait sur poteaux.
function rtsRing() {
  const m = new Module(true), S = 1 / M, P = chaikin(chaikin(RTS_RING));
  const SOFFIT = 1.72, SILL = 1.96, HEAD = 2.6, ROOF = 2.72, GROUND = 0.3;
  const band = (y0, y1, off, color, kind) => surface(m, color, kind, (q) => {
    const L = offsetLine(P, off);
    L.forEach((a, i) => { const b = L[(i + 1) % L.length]; q([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]); });
  });
  const bar = (a, b, w, color) => {
    const va = new THREE.Vector3(a[0] * S, a[1] * S, a[2] * S), vb = new THREE.Vector3(b[0] * S, b[1] * S, b[2] * S);
    const g = new THREE.BoxGeometry(w * S, w * S, va.distanceTo(vb));
    g.applyMatrix4(new THREE.Matrix4().lookAt(va, vb, new THREE.Vector3(0, 1, 0)));
    const c = va.clone().add(vb).multiplyScalar(0.5); g.translate(c.x, c.y, c.z);
    m.paint(g, color, PLAIN);
  };
  band(SOFFIT, SILL, 0.02, "#c4cacd", LOUVRE);         // le socle de lames
  band(HEAD, ROOF + 0.02, 0.03, "#eeeeea", RENDER);    // la rive blanche
  // Le long du contour : un montant tous les 2,40 m, une croix d'acier tous les 7,20 m, derrière le verre.
  let walked = 0, nextPost = 0, nextBrace = 0;
  const inner = offsetLine(P, -0.28);
  P.forEach((a, i) => {
    const j = (i + 1) % P.length, b = P[j], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (walked >= nextPost) { nextPost = walked + 0.4; bar([a[0], SILL, a[1]], [a[0], HEAD, a[1]], 0.035, "#e2e5e6"); }
    if (walked >= nextBrace) {
      nextBrace = walked + 1.2;
      const k = (i + 4) % P.length, p = inner[i], r = inner[k];
      bar([p[0], SILL, p[1]], [r[0], HEAD, r[1]], 0.05, "#8f9a9f"); bar([p[0], HEAD, p[1]], [r[0], SILL, r[1]], 0.05, "#8f9a9f");
      bar([p[0], SILL, p[1]], [p[0], HEAD, p[1]], 0.07, "#8f9a9f");
    }
    walked += seg;
  });
  // Le rez : des poteaux sous l'anneau.
  const under = offsetLine(P, -1.3);
  let run = 0, nextCol = 0;
  under.forEach((a, i) => {
    const b = under[(i + 1) % under.length];
    if (run >= nextCol) { nextCol = run + 3; m.paint(new THREE.CylinderGeometry(0.07 * S, 0.07 * S, (SOFFIT - GROUND) * S, 10).translate(a[0] * S, (SOFFIT + GROUND) / 2 * S, a[1] * S), "#eeeeea", RENDER); }
    run += Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  // Les fenêtres du rez, en bandes : trois vantaux, un trumeau, et un hall vitré toute hauteur au sud.
  const rez = offsetLine(P, -2.27), rezGlass = [];
  let along = 0, nextBay = 0;
  rez.forEach((a, i) => {
    const b = rez[(i + 1) % rez.length], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (along >= nextBay) {
      nextBay = along + 1.15;
      const c = rez[(i + 3) % rez.length], foyer = a[1] < 3.5 && a[1] > -2 && a[0] > 26;
      const y0 = foyer ? 0.5 : 0.82, y1 = foyer ? 1.62 : 1.42;
      rezGlass.push(a[0], y0, a[1], c[0], y0, c[1], c[0], y1, c[1], a[0], y0, a[1], c[0], y1, c[1], a[0], y1, a[1]);
      for (const t of [0, 0.5, 1]) { const x = a[0] + (c[0] - a[0]) * t, z = a[1] + (c[1] - a[1]) * t; bar([x, y0, z], [x, y1, z], 0.03, "#dfe1e1"); }
      bar([a[0], y0, a[1]], [c[0], y0, c[1]], 0.03, "#dfe1e1"); bar([a[0], y1, a[1]], [c[0], y1, c[1]], 0.03, "#dfe1e1");
    }
    along += seg;
  });
  // Les sheds : des bandes parallèles, découpées par l'anneau et les boîtes.
  const dx = 0.62, dz = -0.78, nx = 0.78, nz = 0.62, W = 1.12, PEAK = 0.36;
  const clear = offsetLine(P, -0.42), shedGlass = [];
  const free = (x, z) => inPoly(x, z, clear) && !RTS_BOXES.some((b) => inPoly(x, z, offsetLine(b.c, 0.12)));
  const spans = [];
  for (let d = -16; d < 16; d += W) {
    let from = null;
    for (let t = -26; t <= 26; t += 0.15) {
      const ox = 30 + nx * d + dx * t, oz = 1 + nz * d + dz * t;
      const ok = free(ox, oz) && free(ox + nx * W, oz + nz * W);
      if (ok && from === null) from = t;
      if ((!ok || t >= 26) && from !== null) { if (t - from > 0.7) spans.push([d, from, t - 0.15]); from = null; }
    }
  }
  const at = (d, t, y) => [30 + nx * d + dx * t, y, 1 + nz * d + dz * t];
  surface(m, "#b6bcc0", PLAIN, (q) => spans.forEach(([d, a, b]) => {
    q(at(d, a, ROOF), at(d, b, ROOF), at(d + W * 0.82, b, ROOF + PEAK), at(d + W * 0.82, a, ROOF + PEAK));
    q(at(d, a, ROOF), at(d + W * 0.82, a, ROOF + PEAK), at(d + W, a, ROOF), at(d + W, a, ROOF));
    q(at(d, b, ROOF), at(d + W, b, ROOF), at(d + W * 0.82, b, ROOF + PEAK), at(d + W * 0.82, b, ROOF + PEAK));
  }));
  // Quelques panneaux sombres sur le zinc, comme sur les photos.
  surface(m, "#141c28", PLAIN, (q) => spans.forEach(([d, a, b], i) => {
    if (i % 3 !== 0 || b - a < 3) return;
    const c = (a + b) / 2, h = Math.min(1.6, (b - a) / 3), lift = 0.012;
    q(at(d + W * 0.2, c - h, ROOF + PEAK * 0.24 + lift), at(d + W * 0.2, c + h, ROOF + PEAK * 0.24 + lift), at(d + W * 0.68, c + h, ROOF + PEAK * 0.83 + lift), at(d + W * 0.68, c - h, ROOF + PEAK * 0.83 + lift));
  }));
  for (const [d, a, b] of spans) {
    const p = at(d + W * 0.82, a, ROOF + PEAK), r = at(d + W * 0.82, b, ROOF + PEAK), s0 = at(d + W, b, ROOF), s1 = at(d + W, a, ROOF);
    shedGlass.push(...p, ...r, ...s0, ...p, ...s0, ...s1);
  }
  // Les toits des boîtes : acrotère blanc, gravier brun-rouge, rangées de panneaux noirs, gaines.
  for (const b of RTS_BOXES) {
    const [p0, p1, , p3] = b.c, ux = p1[0] - p0[0], uz = p1[1] - p0[1], vx = p3[0] - p0[0], vz = p3[1] - p0[1];
    const pt = (u, v, y) => [p0[0] + ux * u + vx * v, y, p0[1] + uz * u + vz * v];
    surface(m, "#8c5c46", RENDER, (q) => q(pt(0, 0, b.top + 0.02), pt(1, 0, b.top + 0.02), pt(1, 1, b.top + 0.02), pt(0, 1, b.top + 0.02)));
    surface(m, "#141b27", PLAIN, (q) => { for (let r = 0; r < 4; r++) q(pt(0.12, 0.14 + r * 0.19, b.top + 0.05), pt(0.88, 0.14 + r * 0.19, b.top + 0.05), pt(0.88, 0.27 + r * 0.19, b.top + 0.09), pt(0.12, 0.27 + r * 0.19, b.top + 0.09)); });
    surface(m, "#f0f0ec", RENDER, (q) => b.c.forEach((a, i) => {
      const c = b.c[(i + 1) % 4], t = b.top + 0.12;
      q([a[0], b.top - 0.1, a[1]], [c[0], b.top - 0.1, c[1]], [c[0], t, c[1]], [a[0], t, a[1]]);
    }));
    const [cx, , cz] = pt(0.5, 0.92, 0);
    m.paint(new THREE.BoxGeometry(0.5 * S, 0.14 * S, 0.3 * S).translate(cx * S, (b.top + 0.09) * S, cz * S), "#d9dadb", PLAIN);
  }
  const g = new THREE.Group();
  const core = new THREE.Mesh(prism(offsetLine(P, -0.85), SILL, HEAD), rtsCoreMat);
  const deck = new THREE.Mesh(prism(P, SOFFIT + 0.02, SILL), new THREE.MeshStandardMaterial({ color: "#bdbab2", roughness: 0.8 }));
  const lid = new THREE.Mesh(prism(P, HEAD, ROOF), new THREE.MeshStandardMaterial({ color: "#aab0b4", roughness: 0.5, metalness: 0.4 }));
  const soffit = new THREE.Mesh(prism(offsetLine(P, 0.01), SOFFIT, SOFFIT + 0.02), rtsUnderMat);
  const ground = new THREE.Mesh(prism(offsetLine(P, -2.3), GROUND, SOFFIT), rtsGroundMat);
  for (const o of [core, deck, lid, soffit, ground]) { o.material.side = THREE.DoubleSide; o.castShadow = o.receiveShadow = true; }
  const ribbon = [];
  P.forEach((a, i) => { const b = P[(i + 1) % P.length]; ribbon.push(a[0], SILL, a[1], b[0], SILL, b[1], b[0], HEAD, b[1], a[0], SILL, a[1], b[0], HEAD, b[1], a[0], HEAD, a[1]); });
  const rib = glassSkin(ribbon, rtsRibbonMat);
  rib.renderOrder = 3;
  g.add(core, deck, lid, soffit, ground, bodyOf(m), glassSkin(shedGlass, rtsShedGlassMat), glassSkin(rezGlass, rtsRezMat), rib);
  return g;
}
// ArtLab (Kengo Kuma, 2016) : le long toit d'ardoise déborde sur une sous-face de bois clair semée de
// spots, bordée de noir ; au nord il se replie jusqu'au sol en un grand portail triangulaire.
function artlab() {
  const m = new Module(true), wood = new Module(true), S = 1 / M;
  const WX = -33.85, EAVE = 1.98, OUT = -34.55, OUTY = 2.2, Z0 = -11.8, Z1 = 24.2;
  // Le débord ouest, sa rive noire.
  surface(wood, "#ffffff", PLAIN, (q) => q([WX, EAVE, Z0], [WX, EAVE, Z1], [OUT, OUTY, Z1], [OUT, OUTY, Z0]));
  surface(m, "#1a1b1d", PLAIN, (q) => { q([OUT, OUTY, Z0], [OUT, OUTY, Z1], [OUT, OUTY + 0.09, Z1], [OUT, OUTY + 0.09, Z0]); q([OUT, OUTY + 0.09, Z0], [OUT, OUTY + 0.09, Z1], [WX, EAVE + 0.1, Z1], [WX, EAVE + 0.1, Z0]); });
  // Le portail : le toit continue, puis se replie vers le sol, plus bas à l'est.
  const A = [-34.7, 2.52, 24.2], B = [-31.2, 2.62, 24.2], A2 = [-34.7, 2.52, 26.9], B2 = [-31.2, 2.62, 26.9], G2 = [-31.0, 0.55, 28.1];
  const lift = (p, d) => [p[0], p[1] + d, p[2]];
  // Le repli ne ferme pas le portail : un triangle, du bord ouest du toit jusqu'au sol à l'est.
  surface(wood, "#ffffff", PLAIN, (q) => { q(B, A, A2, B2); q(B2, A2, G2, G2); });
  surface(m, "#16171a", PLAIN, (q) => { q(lift(A, 0.1), lift(B, 0.1), lift(B2, 0.1), lift(A2, 0.1)); q(lift(A2, 0.1), lift(B2, 0.1), [G2[0], G2[1], G2[2] + 0.1], [G2[0], G2[1], G2[2] + 0.1]); });
  surface(m, "#16171a", PLAIN, (q) => { for (const [p, r] of [[A, A2], [A2, G2], [B, B2], [B2, G2]]) q(p, r, lift(r, 0.1), lift(p, 0.1)); });
  // Les spots sous le débord.
  const spots = [];
  for (let z = Z0 + 0.4; z < Z1; z += 0.62) spots.push(new THREE.Matrix4().makeTranslation((WX + OUT) / 2, (EAVE + OUTY) / 2 - 0.03, z));
  for (let t = 0.15; t < 1; t += 0.2) spots.push(new THREE.Matrix4().makeTranslation(-33, 2.52 - 0.03, 24.4 + t * 2.4));
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.012, 0.05), lampMat, spots.length);
  spots.forEach((p, i) => lamps.setMatrixAt(i, p));
  const wg = mergeGeometries(wood.body); wg.scale(M, M, M);
  const soffit = new THREE.Mesh(wg, artWoodMat); soffit.castShadow = soffit.receiveShadow = true;
  const g = new THREE.Group();
  g.add(bodyOf(m), soffit, lamps);
  return g;
}
const artWoodMat = new THREE.MeshStandardMaterial({ color: "#d4a463", roughness: 0.6, emissive: "#ffb85c", emissiveIntensity: 0, side: THREE.DoubleSide });
// La matière, sans image.
const facadeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 });
facadeMat.onBeforeCompile = (shader) => {
  shader.uniforms.uPx = pxPerUnit;
  shader.uniforms.uAo = aoMap;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float aKind;\nattribute vec3 aBar;\nuniform float uPx;\nvarying float vKind;\nvarying vec3 vM;\nvarying float vCell;\nvarying vec3 vSite;")
    .replace("#include <project_vertex>", `#include <project_vertex>${AO_SITE}`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>
      vKind = aKind; vM = position * ${UNIT.toFixed(1)};
      vCell = float(gl_InstanceID);
      #ifdef USE_INSTANCING
      if (aBar.y > 0.0) {
        float seen = uPx / distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition) / ${UNIT.toFixed(1)};
        float keep = smoothstep(${BAR_PX[0].toFixed(2)}, ${BAR_PX[1].toFixed(2)}, seen * aBar.y);
        float mid = aBar.x / ${UNIT.toFixed(1)};
        if (aBar.z < 0.5) transformed.x = mix(mid, transformed.x, keep); else transformed.y = mix(mid, transformed.y, keep);
      }
      #endif`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
      varying float vKind; varying vec3 vM; varying float vCell; varying vec3 vSite;
      ${AO_GLSL}
      float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float fn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(fh(i), fh(i + vec2(1, 0)), f.x), mix(fh(i + vec2(0, 1)), fh(i + vec2(1, 1)), f.x), f.y); }
      float gHeight = 0.0; float gRough = -1.0; float gMetal = -1.0;`)
    .replace("#include <color_fragment>", `#include <color_fragment>
      float k = floor(vKind + 0.5);
      gAo = aoAt(vSite.xz, vSite.y);
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
      }`)
    .replace("#include <opaque_fragment>", AO_APPLY);
};
const glassMat = new THREE.MeshStandardMaterial({ color: "#3c4a55", roughness: 0.07, metalness: 0.82, side: THREE.DoubleSide });
glassMat.onBeforeCompile = (shader) => {
  shader.uniforms.uNight = night;
  shader.uniforms.uAo = aoMap;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying float vId;\nvarying vec2 vPane;\nvarying vec3 vSite;")
    .replace("#include <project_vertex>", `#include <project_vertex>${AO_SITE}`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>
      vId = float(gl_InstanceID);
      vPane = position.xy * ${UNIT.toFixed(1)};
      // Chaque vitre penche d'un rien : elle n'attrape pas le même morceau de ciel que sa voisine.
      vNormal = normalize(vNormal + normalMatrix * vec3((vec2(fract(sin(vId * 12.99) * 437.5), fract(sin(vId * 78.23) * 437.5)) - 0.5) * 0.05, 0.0));`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
      uniform float uNight; varying float vId; varying vec2 vPane; varying vec3 vSite;
      ${AO_GLSL}
      #define FADE_A 0.12
      #define FADE_B 0.5
      float gh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }`)
    .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      // La nuit, fenêtre par fenêtre : un bureau sur quatre allumé, chacun à sa lumière, plus claire
      // vers le plafond, parfois derrière un store à moitié baissé.
      vec2 room = vec2(floor(vPane.x / 1.8), vId);
      float on = step(0.74, gh(room));
      float tone = gh(room + 3.1), level = 0.1 + 0.3 * gh(room + 7.7);
      vec3 lamp = tone < 0.55 ? vec3(1.0, 0.6, 0.27) : tone < 0.85 ? vec3(1.0, 0.76, 0.5) : vec3(0.72, 0.84, 1.0);
      float h = fract(vPane.y / 3.6);
      float blind = step(0.6, gh(room + 11.0)) * smoothstep(0.42, 0.46, h);
      float falloff = (0.45 + 0.55 * h) * (1.0 - 0.75 * blind);
      // Une fenêtre de quelques pixels clignote derrière ses montants : de loin ou de biais, chaque
      // pièce se fond dans la lueur moyenne de la façade.
      float px = max(fwidth(vPane.x), fwidth(vPane.y));
      float glow = mix(on * level * falloff, 0.05, smoothstep(FADE_A, FADE_B, px));
      totalEmissiveRadiance += lamp * glow * uNight;
      // De nuit le verre garde le ciel : un bleu sourd, jamais un trou noir.
      totalEmissiveRadiance += diffuseColor.rgb * vec3(0.3, 0.42, 0.62) * 0.2 * uNight;
      gAo = aoAt(vSite.xz, vSite.y) * 0.82;             // le verre est en retrait dans son cadre
      diffuseColor.rgb *= 0.8 + 0.5 * fract(sin(vId * 33.1) * 437.5);`)
    .replace("#include <opaque_fragment>", AO_APPLY);
};

// Le verre de la RTS : clair, bleuté, il renvoie le ciel.
const rtsGlassMat = glassMat.clone();
rtsGlassMat.color.set("#8fb0cc");
rtsGlassMat.metalness = 0.7;
rtsGlassMat.onBeforeCompile = glassMat.onBeforeCompile;

// Le verre d'ArtLab : la nuit, une seule lueur chaude le long du bâtiment, derrière ses piles sombres.
const artGlassMat = new THREE.MeshStandardMaterial({ color: "#59666e", roughness: 0.08, metalness: 0.75, emissive: "#ffb46e", emissiveIntensity: 0 });

// Le verre du Rolex : un reflet, et derrière lui l'intérieur (plafond à bandes lumineuses, sol), tracé
// dans le shader à partir du regard. Rien à modéliser, mais la perspective est juste.
const eye = { value: new THREE.Vector3() };
const rolexGlassMat = new THREE.MeshStandardMaterial({ color: "#1b2429", roughness: 0.06, metalness: 0.5, side: THREE.DoubleSide });
rolexGlassMat.onBeforeCompile = (shader) => {
  shader.uniforms.uNight = night;
  shader.uniforms.uEye = eye;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float aCeil;\nattribute float aBase;\nvarying float vCeil;\nvarying float vBase;\nvarying vec3 vIn;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCeil = aCeil;\nvBase = aBase;\nvIn = position;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform float uNight;\nuniform vec3 uEye;\nvarying float vCeil;\nvarying float vBase;\nvarying vec3 vIn;")
    .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      vec3 ray = normalize(vIn - uEye);
      float up = ray.y > 0.0 ? 1.0 : 0.0;
      float plane = mix(vBase, vCeil - 0.05, up);
      float t = abs(plane - vIn.y) / max(abs(ray.y), 0.004);
      vec3 hit = vIn + ray * t;
      float strip = smoothstep(0.42, 0.5, abs(fract(hit.x / 0.9) - 0.5)) * up;
      vec3 room = mix(vec3(0.2, 0.17, 0.13), vec3(0.3, 0.27, 0.22), up) + strip * vec3(1.0, 0.86, 0.62);
      room *= exp(-t * 0.3);
      float facing = abs(dot(normalize(vViewPosition), normal));
      float see = (1.0 - pow(1.0 - facing, 3.0));
      totalEmissiveRadiance += room * see * mix(0.3, 1.0, uNight);`);
};
const FASCIA = 0.05, SLAB = 0.12, RECESS = 0.04;   // la coupe du Rolex, sous le toit (unités)
const facadeGroup = new THREE.Group();
// Les barres fines (montants, cadres) de chaque îlot : invisibles quand leur largeur à l'écran tombe sous le
// seuil où le shader les a déjà ramenées à zéro (voir BAR_PX). Même image, beaucoup moins de triangles.
const facadeBars = [], barCenter = new THREE.Vector3();
function cullBars() {
  for (const m of facadeBars) {
    barCenter.copy(m.boundingSphere.center).applyMatrix4(m.matrixWorld);
    const d = Math.max(1e-3, camera.position.distanceTo(barCenter) - m.boundingSphere.radius * campus.scale.x);
    m.visible = (pxPerUnit.value / d / UNIT) * m.userData.barW > BAR_PX[0] * 0.95;
  }
}
facadeGroup.visible = false;
const rolexParts = new THREE.Group();
const facadesReady = groundGate.then(() => Promise.all([loadBin(`${SET}walls.bin`, Float32Array), loadBin("geo/rolex.bin", Float32Array), loadBin("geo/canopies.bin", Float32Array)])).then(async ([a, rolex, roofs]) => {
  const HI = small ? 0 : 30, LO = small ? 95 : 125;
  const place = new THREE.Matrix4(), scaleM = new THREE.Matrix4(), turn = new THREE.Matrix4();
  const lists = new Map();                            // clé → { kit, matrices, colors }
  const push = (key, kit, m, color) => {
    let l = lists.get(key);
    if (!l) lists.set(key, l = { kit, matrices: [], colors: [] });
    l.matrices.push(m.clone()); l.colors.push(color);
  };
  const kits = {
    aluHi: aluminium(true), aluLo: aluminium(false), tile: ceramic(), bmA: panelled(true), bmB: panelled(false), rts: rtsBox(),
    top: redTop(), mx: mxBay(), plain: plainWall(), post: steelPost(), swiss: curtain(1.8, 3.6, "#0a0c0f", 0.09), bc: darkMetal(), bcSide: bcSide(), bcFront: bcFront(), wood: timber(), qnA: qnBay(0), qnB: qnBay(1), qnC: qnBay(2), qnL: qnLoggia(), medc: curtain(1.15, 3.7, "#8e969b", 0.05), slab: rtsSlab(), shutter: shutter(), rib: ribbed(), mull: mullion(),
  };
  const size = { top: [7.2, 3.75], mx: [3.6, 3.6], aluHi: [7.2, 3.75], aluLo: [7.2, 3.75], tile: [3.6, 3.6], bmA: [6, 3.3], rts: [6, 3.7], swiss: [1.8, 3.6], bc: [3.6, 3.7], bcSide: [1.6, 3.7], bcFront: [2.4, 3.7], wood: [0.95, 3], qnA: [2.4, 3.05], qnB: [2.4, 3.05], qnC: [2.4, 3.05], qnL: [2.4, 3.05], medc: [1.15, 3.7], slab: [2.4, 6] };
  const BI = ["#efa915", "#1a2126", "#e66f12", "#1a2126", "#cf2419", "#1a2126", "#1d5fb0", "#1a2126", "#148a44", "#1a2126", "#f2c812", "#1a2126"];
  let seedF = 11;
  const rnd = () => ((seedF = (seedF * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < a.length; i += 10) {
    const [x0, z0, x1, z1, y0, y1, nx, nz, s, lift] = a.subarray(i, i + 10);
    if (s === 0 && !inQN((x0 + x1) / 2, (z0 + z1) / 2)) continue;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, dist = Math.hypot(mx, mz);
    if (dist > LO || (y1 < 3.3 && inCrossing(mx, mz)) || inOdyssea(mx, mz) || inDome(mx, mz) || inRedBox(mx, mz) || (inHall(mx, mz) && y1 > 1.7)) continue;
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
    if (inQN(mx, mz)) {
      if (tall < 0.4 || len < 0.4) continue;
      const court = Math.hypot(mx - QN_COURT[0], mz - QN_COURT[1]) < 4.2;
      const LOG = [0xe9b521, 0xe07a2a, 0x3f78b5, 0x7fae4a, 0xd9d4c8, 0xe9b521];
      if (court) {
        const [w, h] = size.qnL, nx_ = Math.max(1, Math.round(len / (w * M))), ny = Math.max(1, Math.round(tall / (h * M)));
        for (let r = 0; r < ny; r++) for (let c = 0; c < nx_; c++) push(`qnL:${cell}`, kits.qnL, frame(c * len / nx_, y0 + r * tall / ny, len / nx_ / (w * M), tall / ny / (h * M)), LOG[(r * 3 + c * 5 + Math.abs(Math.floor(sx))) % LOG.length]);
      } else grid("qnA", (r, c) => { const k = (r * 7 + c * 3 + (c >> 1)) % 5; return (k < 2 ? "qnA" : k < 4 ? "qnB" : "qnC") + `:${cell}`; });
      continue;
    }
    if (s === 1) {
      continue;   // ses montants viennent de geo/mullions.bin
    } else if (s === 2 || s === 12 || s === 14) {
      if (tall < 0.45 || len < 0.5) continue;
      if (s === 14 && len < 1.1) { push(`plain:${cell}`, kits.plain, frame(0, y0, len * UNIT, tall * UNIT, 1), 0xd8c7a4); continue; }
      const tier = dist < HI ? "aluHi" : "aluLo";
      // L'étage rouge seulement là où le maillage a un étage en retrait : un mur court, posé sur un toit.
      const setback = s === 12 && lift > 1.2 && tall < 1.2;
      grid(setback ? "top" : tier, () => (setback ? `top:${cell}` : `${tier}:${cell}`));
    } else if (s === 13) {
      if (tall < 0.45) continue;
      grid("mx", () => `mx:${cell}`);
    } else if (s === 3) {
      if (tall < 0.45) continue;
      grid("tile", () => `tile:${cell}`);
    } else if (s === 6) {
      grid("bmA", (r, c) => ((r * 5 + c * 3) % 7 < 3 ? `bmB:${cell}` : `bmA:${cell}`));
    } else if (s === 9) {
      if (tall < 0.7) continue;                        // les retombées des sheds : pas des étages
      grid("rts", () => `rts:${cell}`);
    } else if (s === 7) {
      grid("swiss", () => `swiss:${cell}`);
    } else if (s === 8) {
      if (len < 8) grid("bcFront", () => `bcFront:${cell}`);   // les pignons sont vitrés, les longs côtés percés
      else grid("bcSide", () => `bcSide:${cell}`);
    } else if (s === 15) {
      grid("bc", () => `bc:${cell}`);
    } else if (s === 11) {
      grid("wood", () => `wood:${cell}`);
    } else if (s === 10) {
      continue;                                        // l'anneau est construit à part (rtsRing)
    } else if (s === 4) {
      // ME D : des volets indépendants, chacun penché à sa façon, à distance du mur ; un sur quatre
      // manque et laisse voir le verre.
      // D'après les photos : des volets étroits à lames, penchés deux à deux en V, le verre éclairé derrière.
      grid("medc", () => `medc:${cell}`);
      const bay = 1.15 * M, floor = 3.7 * M;
      const nX = Math.max(1, Math.round(len / bay)), nY = Math.max(1, Math.round(tall / floor));
      const w = len / nX, h = tall / nY;
      for (let r = 0; r < nY; r++) for (let c = 0; c < nX; c++) {
        if (rnd() < 0.1) continue;
        const lean = ((c + r) % 2 ? 1 : -1) * (0.07 + rnd() * 0.07);
        const m4b = frame((c + 0.5) * w, y0 + (r + 0.5) * h, w * 0.62 * UNIT, h * 0.97 * UNIT, 1, lean);
        m4b.multiply(turn.makeTranslation(-0.5 * M, -0.5 * M, 0.34 * M));
        push(`shutter:${cell}`, kits.shutter, m4b, 0xffffff);
      }
    } else if (s === 5) {
      // BI : un socle noir nervuré, puis de larges bandes de couleur.
      const bay = 1.8 * M, nX = Math.max(1, Math.round(len / bay)), w = len / nX;
      const base = Math.min(tall, 3.7 * M);
      for (let c = 0; c < nX; c++) {
        push(`rib:${cell}`, kits.rib, frame(c * w, y0, w * UNIT, base * UNIT, 1), 0x202225);
        // Au-dessus : de larges bandes pleines, une sur deux en verre sombre, un peu en retrait.
        const tone = BI[(c + Math.abs(Math.floor(sx * 3)) * 2) % BI.length];
        if (tall > base) push(`plain:${cell}`, kits.plain, frame(c * w, y0 + base, w * UNIT, (tall - base) * UNIT, tone === "#1a2126" ? 0.6 : 1.6), new THREE.Color(tone).getHex());
      }
    }
  }
  // Les auvents : des poteaux d'acier tous les 7,20 m, de part et d'autre.
  for (let i = 0; i < roofs.length; i += 8) {
    const [cx, cz, ax, az, hl, hw, top, foot] = roofs.subarray(i, i + 8);
    const bx = -az, bz = ax, n = Math.max(1, Math.round((hl * 2) / (7.2 * M)));
    for (let c = 0; c <= n; c++) for (const side of [-1, 1]) {
      const u = -hl + 0.1 + ((hl * 2 - 0.2) * c) / n, v = side * Math.max(0, hw - 0.1);
      const x = cx + ax * u + bx * v, z = cz + az * u + bz * v;
      place.makeTranslation(x, foot, z).multiply(scaleM.makeScale(1, (top - foot) * UNIT, 1));
      push(`post:${Math.floor(x / 45)},${Math.floor(z / 45)}`, kits.post, place, 0xffffff);
    }
  }
  // Le Rolex, depuis les contours de son toit : la rive mince, le verre en léger retrait, ses
  // montants tous les 2,40 m, la dalle, puis le plancher, qui reprend la forme du toit. Sous le
  // plancher il n'y a rien : c'est le vide des arches.
  let at = 1;
  const loops = [];
  for (let l = 0; l < rolex[0]; l++) {
    const n = rolex[at++];
    loops.push(rolex.subarray(at, at + n * 4));
    at += n * 4;
  }
  const shellCount = rolex[at++], shell = rolex.subarray(at, at + shellCount * 9);
  const skin = { glass: [], ceil: [], base: [], body: [], color: [], normal: [] };
  const edge = lin("#dcd9d3"), slabC = lin("#a9a59c"), under = lin("#c9c6bf"), vault = lin("#8d8a82");
  const face = (a, b, c, d, n, color) => {                     // quatre coins, dans le sens qui regarde n
    skin.body.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let v = 0; v < 6; v++) { skin.normal.push(...n); skin.color.push(color.r, color.g, color.b); }
  };
  for (const pts of loops) {
    const n = pts.length / 4;
    let walked = 0, next = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, k = (i + n - 1) % n, m = (j + 1) % n;
      const ax = pts[i * 4], ay = pts[i * 4 + 1], az = pts[i * 4 + 2], af = pts[i * 4 + 3];
      const bx = pts[j * 4], by = pts[j * 4 + 1], bz = pts[j * 4 + 2], bf = pts[j * 4 + 3];
      // La normale de chaque point, moyennée avec ses voisins : pas de marches dans les courbes.
      const out = (p, q) => { const dx = pts[q * 4] - pts[p * 4], dz = pts[q * 4 + 2] - pts[p * 4 + 2], d = Math.hypot(dx, dz) || 1; return [dz / d, 0, -dx / d]; };
      const an = out(k, j), bn = out(i, m);
      const P = (x, y, z, nrm, d) => [x + nrm[0] * d, y, z + nrm[2] * d];
      const N = [(an[0] + bn[0]) / 2, 0, (an[2] + bn[2]) / 2];
      const ag = af + SLAB, bg = bf + SLAB;                    // le bas du verre, sur la dalle
      // La rive, puis son dessous jusqu'au verre.
      face(P(ax, ay - FASCIA, az, an, 0.012), P(bx, by - FASCIA, bz, bn, 0.012), P(bx, by + 0.012, bz, bn, 0.012), P(ax, ay + 0.012, az, an, 0.012), N, edge);
      face(P(ax, ay - FASCIA, az, an, -RECESS), P(bx, by - FASCIA, bz, bn, -RECESS), P(bx, by - FASCIA, bz, bn, 0.012), P(ax, ay - FASCIA, az, an, 0.012), [0, -1, 0], under);
      // Le verre.
      const g0 = P(ax, ag, az, an, -RECESS), g1 = P(bx, bg, bz, bn, -RECESS), g2 = P(bx, by - FASCIA, bz, bn, -RECESS), g3 = P(ax, ay - FASCIA, az, an, -RECESS);
      skin.glass.push(...g0, ...g1, ...g2, ...g0, ...g2, ...g3);
      skin.ceil.push(ay, by, by, ay, by, ay);
      skin.base.push(ag, bg, bg, ag, bg, ag);
      // La dalle, son dessus jusqu'au verre, et son dessous vers l'intérieur (la voûte des arches).
      face(P(ax, af, az, an, 0.012), P(bx, bf, bz, bn, 0.012), P(bx, bg, bz, bn, 0.012), P(ax, ag, az, an, 0.012), N, slabC);
      face(P(ax, ag, az, an, 0.012), P(bx, bg, bz, bn, 0.012), P(bx, bg, bz, bn, -RECESS), P(ax, ag, az, an, -RECESS), [0, 1, 0], slabC);
      face(P(ax, af, az, an, -0.7), P(bx, bf, bz, bn, -0.7), P(bx, bf, bz, bn, 0.012), P(ax, af, az, an, 0.012), [0, -1, 0], vault);
      // Les montants.
      const seg = Math.hypot(bx - ax, bz - az);
      if (walked >= next) {
        next = walked + 2.4 * M;
        const px = ax - an[0] * (RECESS - 0.004), pz = az - an[2] * (RECESS - 0.004);
        place.set(an[2], 0, an[0], px, 0, 1, 0, ag, -an[0], 0, an[2], pz, 0, 0, 0, 1);
        place.multiply(scaleM.makeScale(1, (ay - FASCIA - ag) * UNIT, 1));
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
  skinGeo.setAttribute("aBar", new THREE.BufferAttribute(new Float32Array(skin.body.length), 3));
  const skinMat = facadeMat.clone();
  skinMat.onBeforeCompile = facadeMat.onBeforeCompile;
  skinMat.side = THREE.DoubleSide;
  const rolexSkin = new THREE.Mesh(skinGeo, skinMat);
  rolexSkin.castShadow = rolexSkin.receiveShadow = true;
  const glassGeo = new THREE.BufferGeometry();
  glassGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(skin.glass), 3));
  glassGeo.setAttribute("aCeil", new THREE.BufferAttribute(new Float32Array(skin.ceil), 1));
  glassGeo.setAttribute("aBase", new THREE.BufferAttribute(new Float32Array(skin.base), 1));
  glassGeo.computeVertexNormals();
  const rolexGlass = new THREE.Mesh(glassGeo, rolexGlassMat);
  rolexGlass.castShadow = true;
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(shell), 3));
  floorGeo.computeVertexNormals();
  const rolexFloor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: "#7d7a72", roughness: 0.9, side: THREE.DoubleSide }));
  rolexFloor.castShadow = rolexFloor.receiveShadow = true;
  rolexParts.add(rolexSkin, rolexGlass, rolexFloor);
  facadeGroup.add(crossing(), agora(), artlab(), medCanopy(), rtsRing(), odyssea(), swissTech(), polydome(), bcRoof());
  const tint = new THREE.Color();
  let triangles = 0;
  for (const [key, { kit, matrices, colors }] of lists) {
    const kitName = key.split(":")[0];
    const n = matrices.length;
    const add = (geo, mat, cast, barW = 0) => {
      if (!geo) return;
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.name = kitName;
      mesh.renderOrder = -1;                             // avant le mur du maillage qu'elle cache : ses pixels cachés sont sautés
      matrices.forEach((m, k) => mesh.setMatrixAt(k, m));
      if (mat === facadeMat) colors.forEach((c, k) => mesh.setColorAt(k, tint.set(c)));
      mesh.castShadow = cast && !small; mesh.receiveShadow = !small && mat === facadeMat;   // le verre n'en a pas besoin
      mesh.computeBoundingSphere();
      if (barW) { mesh.userData.barW = barW; facadeBars.push(mesh); }
      facadeGroup.add(mesh);
      triangles += n * geo.attributes.position.count / 3;
    };
    add(kit.body, facadeMat, true);
    add(kit.bars, facadeMat, false, kit.barW);
    add(kit.glass, kit === kits.rts || kit === kits.slab ? rtsGlassMat : kit === kits.wood ? artGlassMat : kit === kits.medc ? medGlassMat : kit.lit ? qnGlassMat : glassMat, false);
  }
  facadeGroup.visible = true;
  await warm(facadeGroup);
  await warm(rolexParts);
  facadeGroup.visible = campus.scale.y >= 0.999;
  campus.add(rolexParts, facadeGroup);
  shadowsDirty();
  wake();
});

// Le lac et le relief d'abord : sur téléphone l'intro part dès qu'ils sont là, le campus arrive pendant
// la descente.
let nearReady = null, photoArrived;
// Sur ordinateur l'intro attend aussi la photo fine : chargée en plein vol, elle figeait une image.
const photoReady = new Promise((resolve) => { photoArrived = resolve; });
const groundReady = (async () => {
  const meta = await (await fetch(`${SET}meta.json`)).json();
  const L = meta.layers;
  const [farH, midH, farT, midT, farLake, midLake] = await Promise.all([
    loadBin("geo/far.bin", Int16Array), loadBin("geo/mid.bin", Int16Array), loadTex(`${SET}far.webp`), loadTex(`${SET}mid.webp`),
    loadTex("geo/far-lake.png"), loadTex("geo/mid-lake.png"),
  ]);
  for (const t of [farLake, midLake]) t.colorSpace = THREE.NoColorSpace;
  const inner = (layer, margin) => new THREE.Vector4(layer.cx / UNIT, -layer.cz / UNIT, layer.size / UNIT / 2 * (1 - margin), layer.size / UNIT / 2 * (1 - margin));
  nearBox.value.set(L.near.cx / UNIT, L.near.cz / UNIT, L.near.size / UNIT, 0);
  const midHole = new THREE.Vector4(0, 0, 0, 0);       // ouvert quand la couche fine arrive
  world.add(terrainMesh(L.far, farH, farT, { fade: 0.16, hole: inner(L.mid, 0.36), lake: true, sink: true, lakeMask: farLake }));
  world.add(terrainMesh(L.mid, midH, midT, { fade: 0.18, hole: midHole, lake: true, order: 1, lift: 0.05, gain: 0.84, lakeMask: midLake }));
  nearReady = groundGate.then(() => Promise.all([loadBin(`${SET}near.bin`, Int16Array), loadTex(`${SET}near.webp`)])).then(async ([nearH, nearT]) => {
    nearPhoto.value = nearT;
    const near = terrainMesh(L.near, nearH, nearT, { fade: 0.025, order: 2, lift: 0.08, gain: 0.86, hi: true });
    near.receiveShadow = true;
    await warm(near);
    world.add(near);
    midHole.copy(inner(L.near, 0.045));
    shadowsDirty();
    wake();
    const sharpPhoto = () => Promise.all([loadTex(`${SET}campus-photo.webp`), fetch("geo/campus-photo.json").then((r) => r.json())]).then(([t, b]) => {
      hiPhoto.value = t;
      hiBox.value.set(b.x0, b.z0, b.x1, b.z1);
      hasHi.value = 1;
      stale = true;
      wake();
    }).catch(() => {});
    // Sur téléphone, la photo fine vient en dernier, une fois tout le reste arrivé.
    if (small) Promise.allSettled([buildingsReady, treesReady, facadesReady]).then(sharpPhoto); else photoArrived(sharpPhoto());
  }).catch(() => {});
  shadowsDirty();
  groundArrived?.();
  return true;
})();
groundReady.catch(() => groundArrived?.());

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
  hazeTone.value.set(dark ? "#0f1520" : "#9db4c4");
  night.value = dark ? 1 : 0;
  wallTone.value.set(dark ? "#8a8d92" : "#e7e3da");
  roofTone.value.set(dark ? "#8f9298" : "#c4bcb6");
  water.value.set(dark ? "#1d2d40" : "#4f6f84");
  sun.color.set(dark ? "#8fa8d0" : "#fff3e2");
  sun.intensity = dark ? 1.6 : 3.8;
  hemi.intensity = dark ? 1.1 : 0.55;
  key.intensity = dark ? 1.0 : 1.4;
  lampMat.emissiveIntensity = dark ? 2.2 : 0;
  beaconMat.emissiveIntensity = dark ? 4 : 0.6;
  odyRoomMat.emissiveIntensity = dark ? 0.32 : 0;
  hallGlassMat.emissiveIntensity = dark ? 0.09 : 0;
  medGlassMat.emissiveIntensity = dark ? 0.85 : 0;
  qnGlassMat.emissiveIntensity = dark ? 0.12 : 0;
  stccGlassMat.emissiveIntensity = dark ? 0.22 : 0;
  stccUnderMat.emissiveIntensity = dark ? 0.035 : 0.05;
  artGlassMat.emissiveIntensity = dark ? 0.16 : 0;
  artWoodMat.emissiveIntensity = dark ? 0.2 : 0;
  rtsCoreMat.emissiveIntensity = dark ? 1.15 : 0;
  rtsRibbonMat.opacity = dark ? 0.22 : 0.46;
  rtsRezMat.emissiveIntensity = dark ? 0.55 : 0;
  rtsUnderMat.emissiveIntensity = dark ? 0.32 : 0;
  rtsGroundMat.emissiveIntensity = dark ? 0.12 : 0;
  rtsShedGlassMat.emissiveIntensity = dark ? 0.14 : 0;
  shadowsDirty();
}

// ==========================================================================================
// Le parcours : un arrêt par section (data-cam)
// ==========================================================================================
const D = (x, y, d, ry, rx, screen, on = 1) => ({ x, y, d, ry, rx, screen, on });
const OFF_PHONE = D(0.45, -1.6, 5.4, -0.3, 0.2, null, 0);
// Une section, un lieu : le parcours fait visiter le campus en même temps que l'app. orbit : le tour
// lent (degrés) que fait la caméra autour du lieu pendant la lecture.
// Chaque lieu a son plan : la caméra va de pos à to (et son regard de look à lookTo) pendant la lecture.
const STOPS = {
  hero: { pos: [-46, 19, 52], look: [8, 3, -8], to: [-37, 15.5, 41], lookTo: [8, 2.6, -8], shift: 0.1, phone: D(0.66, -0.1, 5.8, -0.5, 0.06, "iphone-today") },
  today: { pos: [1.6, 7, 68], look: [1, 2.4, 39], to: [1.2, 5, 53], lookTo: [1, 2.2, 38], shift: 0.21, phone: OFF_PHONE },
  import: { pos: [61, 5, 9], look: [42, 6, -2], to: [57, 8.5, -15], lookTo: [42, 7.6, -2], shift: -0.21, phone: OFF_PHONE },
  etude: { pos: [-25, 6.5, -15], look: [2, 1.2, 2], to: [-15, 4.6, -22], lookTo: [6, 1.2, 5], shift: 0.21, phone: OFF_PHONE },
  hours: { pos: [27, 8, 13], look: [8, 2.4, 28], to: [26, 9, 33], lookTo: [8, 2.4, 28], shift: -0.21, phone: OFF_PHONE },
  groups: { pos: [-39, 12, -6], look: [-21, 1.2, 7], to: [-33, 6, -1], lookTo: [-21, 1.4, 7], shift: 0.21, phone: OFF_PHONE },
  everywhere: { pos: [43, 8, 22], look: [30, 3, 1], to: [48, 13, 32], lookTo: [30, 3, 1], shift: -0.21, phone: OFF_PHONE },
  plan: { pos: [0.01, 62, 9], look: [2.6, 0, -1], to: [0.01, 58, 9], lookTo: [2.6, 0, -1], shift: 0, phone: OFF_PHONE },
};
for (const s of Object.values(STOPS)) { s.pos = flipZ(s.pos); s.look = flipZ(s.look); s.to = flipZ(s.to); s.lookTo = flipZ(s.lookTo); }
const INSIDE = new Set(["hero", "today"]);            // en portrait, ces vues ne reculent pas
const sections = [...document.querySelectorAll("[data-cam]")];
let centers = [];
// Sur téléphone les sections sont hautes : la caméra doit être arrivée quand le texte entre à l'écran.
const measure = () => {
  centers = sections.map((s) => {
    const r = s.getBoundingClientRect(), panel = small && s.querySelector(".panel");
    return panel ? panel.getBoundingClientRect().top + scrollY - innerHeight * 0.75 + innerHeight * 0.5 : r.top + scrollY + r.height / 2;
  });
};
const camPos = new THREE.Vector3(...STOPS.hero.pos), camLook = new THREE.Vector3(...STOPS.hero.look);
const wantPos = camPos.clone(), wantLook = camLook.clone();
let shiftNow = STOPS.hero.shift, shiftWant = shiftNow, liftNow = 0, liftWant = 0;
const devState = { phone: { ...STOPS.hero.phone } };
const devWant = { phone: { ...STOPS.hero.phone } };
const ease = (t) => t * t * (3 - 2 * t);
const portrait = () => camera.aspect < 1.05;

let routeFor = null, routeNow = null;
function camRoute() {
  const tall = portrait();
  if (routeNow && routeFor === tall) return routeNow;
  const names = sections.map((s) => s.dataset.cam), P = [], L = [];
  const pose = (pos, look, name) => {
    const at = new THREE.Vector3(...look), arm = new THREE.Vector3(...pos).sub(at);
    if (tall && !INSIDE.has(name)) arm.multiplyScalar(1.5);
    return arm.add(at);
  };
  names.forEach((name, n) => {
    const s = STOPS[name], next = STOPS[names[n + 1]];
    P.push(pose(s.pos, s.look, name), pose(s.to, s.lookTo, name));
    L.push(new THREE.Vector3(...s.look), new THREE.Vector3(...s.lookTo));
    if (next) {
      // Entre deux lieux : on monte, on vire, on redescend ; le regard glisse d'un sujet à l'autre.
      const from = pose(s.to, s.lookTo, name), to = pose(next.pos, next.look, names[n + 1]), span = from.distanceTo(to);
      P.push(from.clone().lerp(to, 0.5).setY(Math.max(from.y, to.y) + Math.min(22, span * 0.28)));
      L.push(new THREE.Vector3(...s.lookTo).lerp(new THREE.Vector3(...next.look), 0.5));
    }
  });
  routeFor = tall;
  routeNow = { pos: new THREE.CatmullRomCurve3(P, false, "centripetal"), look: new THREE.CatmullRomCurve3(L, false, "centripetal"), count: P.length };
  return routeNow;
}
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
  // Un seul trajet continu : pendant une section la caméra tourne lentement autour du lieu, entre deux
  // elle prend de la hauteur et glisse vers le suivant. Trois repères par section (entrée, sortie, milieu du vol).
  const N = sections.length, near = (n) => centers[Math.min(N - 1, Math.max(0, n))];
  const startOf = (n) => centers[n] - 0.42 * (n ? centers[n] - near(n - 1) : innerHeight);
  const endOf = (n) => centers[n] + 0.3 * (n < N - 1 ? near(n + 1) - centers[n] : innerHeight);
  let key;
  if (mid <= startOf(i) && i === 0) key = 0;
  else if (mid <= endOf(i)) key = 3 * i + Math.min(1, Math.max(0, (mid - startOf(i)) / (endOf(i) - startOf(i))));
  else if (i >= N - 1) key = 3 * (N - 1) + 1;
  else { const f = Math.min(1, (mid - endOf(i)) / (startOf(i + 1) - endOf(i))); key = 3 * i + 1 + 2 * (f * 0.3 + ease(f) * 0.7); }
  const route = camRoute();
  const u = key / (route.count - 1);
  route.pos.getPoint(u, wantPos);
  route.look.getPoint(u, wantLook);
  wantLook.set(lerp(A.look[0], B.look[0]), lerp(A.look[1], B.look[1]), lerp(A.look[2], B.look[2]));
  // En portrait, reculer (sauf à l'intérieur, où l'on finirait dans le mur).
  shiftWant = portrait() ? 0 : lerp(A.shift, B.shift);
  liftWant = portrait() ? 0.2 : 0;
  const heroWeight = (ia === "hero" ? 1 - t : 0) + (ib === "hero" ? t : 0);
  {
    const a = A.phone, b = B.phone, w = devWant.phone;
    for (const k of ["x", "y", "d", "ry", "rx", "on"]) w[k] = lerp(a[k], b[k]);
    w.screen = (t < 0.5 ? a.screen : b.screen) ?? a.screen ?? b.screen;
    if (portrait()) Object.assign(w, { x: 0.3, y: 0.64, d: 13.5, ry: -0.36, rx: 0.08, on: Math.max(0, (heroWeight - 0.75) / 0.25), screen: "iphone-today" });
  }
}

// ==========================================================================================
// L'intro : le Léman vu d'en haut, la rive, le campus, le bâtiment qui se lève, le tour
// ==========================================================================================
const INTRO = {
  // Un seul mouvement : le lac, une longue descente, puis un vol lent qui s'approche du campus.
  pos: [[-2600, 8000, -1740], [-3000, 3400, 500], [-1050, 860, 720], [-240, 165, 250], [-78, 40, 96], [-40, 17, 46]],
  look: [[-2600, 0, -1800], [-1400, 0, -1300], [0, 0, -100], [4, 0, -4], [8, 2, -8], [8, 3, -8]],
  duration: small ? 8.5 : 9.5,
  beats: [
    { at: 0, coords: "46,43° N · 6,52° E", place: "Lac Léman" },
    { at: 0.36, coords: "46,52° N · 6,57° E", place: "Ecublens" },
    { at: 0.6, coords: "46,5184° N · 6,5681° E", place: "EPFL" },
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
// Les légendes viennent de la page, traduites avec le reste du site (i18n/strings.toml) : a|b|c.
card?.dataset.coords?.split("|").forEach((t, i) => { if (INTRO.beats[i]) INTRO.beats[i].coords = t; });
card?.dataset.places?.split("|").forEach((t, i) => { if (INTRO.beats[i]) INTRO.beats[i].place = t; });

function introFrame(dt) {
  intro.t = Math.min(1, intro.t + (dt * intro.speed) / INTRO.duration);
  const u = introEase(intro.t);
  const p = introPos.getPoint(u), l = introLook.getPoint(u);
  const tail = band01(u, 0.82, 1);
  camPos.copy(p).lerp(wantPos, ease(tail));
  camLook.copy(l).lerp(wantLook, ease(tail));
  shiftNow = shiftWant * ease(band01(u, 0.82, 1));
  liftNow = liftWant * ease(band01(u, 0.82, 1));
  const rise = Math.max(0.02, ease(band01(u, 0.34, 0.56)));
  // Le bâtiment se lève vu de loin : les ombres ne sont recalculées qu'une fois debout.
  if (Math.abs(campus.scale.y - rise) > 1e-4) {
    campus.scale.y = rise;
    if (rise >= 0.999) { facadeGroup.visible = true; shadowHold = false; if (!preloaded) shadowsDirty(); }
  }
  devState.phone.on = ease(band01(u, 0.92, 1)) * devWant.phone.on;
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
    startDrift();
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
// L'image à l'arrêt est la même que celle en mouvement, en plus fine : aucune passe qui change son
// aspect. (Une occlusion ambiante à l'arrêt noircissait les fenêtres : à chaque pause du défilement,
// toute l'image sautait, ce qui se voyait comme un clignotement.)
// Le recours d'une machine lente, en mouvement : une image plus petite, lissée, agrandie à l'écran.
// (Sur téléphone, rien de tout ça : un rendu direct, moins de pixels, pas de passes.)
const fast = small ? null : new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
if (fast) {
  fast.addPass(new RenderPass(scene, camera));
  fast.addPass(new OutputPass());
  fast.setPixelRatio(dprFast);
  fast.setSize(innerWidth, innerHeight);
}
const clock = new THREE.Clock();
const introClock = new THREE.Clock(false);
let useFast = false;
let driftStart = 0, driftHold = 1, bank = 0;
const startDrift = () => { if (small && !reduced && scrollY < 40) driftStart = performance.now(); };
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
      const glide = reduced ? 1 : 1 - Math.exp(-dt * 3.2);   // de l'inertie : le plan continue un instant
      camPos.lerp(wantPos, glide); camLook.lerp(wantLook, glide); moving = true;
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
  if (!moving && canRise && fineFrames > 90) {
    canRise = false;
    dprNow = DPR_TOP;
    renderer.setPixelRatio(dprNow);
    renderer.setSize(innerWidth, innerHeight, false);
    sharpDone = false; stale = true;
  }
  // Sur téléphone, pas de pointeur : l'arrivée reste vivante, un lent balancement qui s'éteint seul.
  let sway = 0;
  if (driftStart) {
    const p = (performance.now() - driftStart) / 22000;
    driftHold += ((scrollY < 40 ? 1 : 0) - driftHold) * k;
    if (p >= 1 || driftHold < 0.01) driftStart = 0;
    else { sway = 0.1 * Math.sin(Math.PI * p) ** 2 * driftHold; moving = true; }
  }
  // La profondeur suit la hauteur de vue : précise près du sol, sans limite vue du ciel.
  const dist = camPos.distanceTo(camLook);
  camera.near = THREE.MathUtils.clamp(Math.min(dist, camPos.y) * 0.02, 0.03, 40);
  camera.far = Math.max(3000, camPos.y * 45 + dist * 4);
  camera.updateProjectionMatrix();
  camera.setViewOffset(innerWidth, innerHeight, -shiftNow * innerWidth, liftNow * innerHeight, innerWidth, innerHeight);
  pxPerUnit.value = innerHeight * (useFast ? dprFast : dprNow) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  camera.position.copy(camPos);
  if (sway) camera.position.sub(camLook).applyAxisAngle(camera.up, sway).add(camLook);
  camera.lookAt(camLook);
  // Dans les virages, la caméra s'incline un peu, comme un drone.
  if (!reduced && !intro.active) {
    const side = new THREE.Vector3().subVectors(wantPos, camPos).dot(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion));
    bank += (THREE.MathUtils.clamp(-side * 0.012, -0.06, 0.06) - bank) * k * 0.6;
    if (Math.abs(bank) > 2e-4) { camera.rotateZ(bank); moving = true; }
  }

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
  // Un mouvement : l'image réduite. Un arrêt qui dure : la pleine définition, jamais au milieu d'une
  // lecture par à-coups.
  const sharp = !moving && wantSharp;
  camera.updateMatrixWorld();
  cullBars();
  renderer.autoClear = true;
  if (sharp) { renderer.render(scene, camera); sharpDone = true; wantSharp = false; stale = false; }
  else if (useFast) fast.render();                      // jusqu'à l'image nette : le même rendu lissé, pas de saut
  else {
    renderer.render(scene, camera);
    if (!moving) { sharpDone = true; stale = false; }   // c'est déjà l'image définitive
  }
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
      fineFrames = paceMs < 19 ? fineFrames + 1 : 0;
      if (paceMs > 19 && ++slowFrames > 10) {   // une machine qui peine passe vite en image réduite
        slowFrames = 0; paceMs = 16;
        if (fast && (!useFast || dprFast > 0.7)) {
          // La première fois, l'image réduite déjà allouée (aucune réallocation, donc aucun à-coup) ;
          // ensuite seulement, un cran plus bas.
          if (useFast) { dprFast = Math.max(0.7, dprFast - 0.25); fast.setPixelRatio(dprFast); }
          useFast = true;
        } else if (!fast && dprNow > 1) {
          canRise = false;
          dprNow = Math.max(1, dprNow - 0.25);
          renderer.setPixelRatio(dprNow);
          renderer.setSize(innerWidth, innerHeight, false);
        }
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
  fast?.setSize(innerWidth, innerHeight);
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
  shadowHold = true;
  const ready = small ? groundReady : groundReady.then(() => Promise.all([nearReady, Promise.race([photoReady, new Promise((r) => setTimeout(r, 4000))]), treesReady.catch(() => {}), buildingsReady.catch(() => {}), facadesReady.catch(() => {})]));
  ready.then(async () => {
    clearTimeout(giveUp);
    if (!intro.active) return;
    await renderer.compileAsync(scene, camera).catch(() => {});
    if (!intro.active) return;
    preload();
    if (!intro.active) return;
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
// Avant l'intro, l'écran encore vide : le campus debout, tout est dessiné une fois (les ombres d'abord,
// puis une vue d'en haut). Les géométries et les milliers de façades sont ainsi déjà dans la carte
// graphique et les ombres calculées : quand les bâtiments se lèvent, il n'y a plus rien à préparer.
let preloaded = false;
function preload() {
  const keep = campus.scale.y;
  campus.scale.y = 1; facadeGroup.visible = true;
  campus.updateMatrixWorld(true);
  renderer.shadowMap.needsUpdate = true;
  if (hiPhoto.value) renderer.initTexture(hiPhoto.value);
  const eyeOver = new THREE.PerspectiveCamera(70, 1, 1, 2000);
  eyeOver.position.set(0, 260, 0.01); eyeOver.lookAt(0, 0, 0); eyeOver.updateMatrixWorld();
  renderer.render(scene, eyeOver);
  renderer.render(scene, camera);
  fast?.render();                                      // l'image réduite allouée d'avance : la basculer ne coûte rien
  const shown = phone.visible;                         // l'iPhone aussi, sinon son écran se charge à l'arrivée
  phone.visible = true; renderer.autoClear = false; renderer.render(deviceScene, devCam); renderer.autoClear = true; phone.visible = shown;
  campus.scale.y = keep; facadeGroup.visible = false;
  preloaded = true;
}
function finishInstantly() {
  campus.scale.y = 1; facadeGroup.visible = true;
  shadowHold = false;
  shadowsDirty();
  root.classList.add("intro-done");
  root.classList.remove("intro", "intro-wait");
  snap();
  wake();
}
