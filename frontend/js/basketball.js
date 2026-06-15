// 3D basketball hero — matte leather, grooved seams, pebbled bump, soft halo.
import * as THREE from "three";

const mount = document.getElementById("ball-canvas");
if (mount) initBall(mount);

/* equirectangular basketball seam layout (real 8-panel geometry):
   two perpendicular great circles through the poles → 4 vertical meridians,
   plus the equator great circle. This is what makes a sphere read as a 🏀. */
function drawSeams(ctx, W, H, width) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;

  // 4 vertical meridians (2 perpendicular great circles through the poles)
  for (const x of [0, W * 0.25, W * 0.5, W * 0.75, W]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // equator great circle
  ctx.beginPath();
  ctx.moveTo(0, H * 0.5);
  ctx.lineTo(W, H * 0.5);
  ctx.stroke();
}

function initBall(mount) {
  const size = () => Math.min(mount.clientWidth || 480, mount.clientHeight || 480);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(size(), size());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 0, 6.6);

  // — warm key from top-right —
  const key = new THREE.DirectionalLight(0xfff1de, 2.0);
  key.position.set(5, 6, 7);
  scene.add(key);

  // — cool rim from back-left, gives the orange a blue edge —
  const rim = new THREE.DirectionalLight(0x4a6bff, 1.7);
  rim.position.set(-6, -1, -5);
  scene.add(rim);

  // — orange bounce near camera —
  const orangeFill = new THREE.PointLight(0xff6a22, 1.5, 22);
  orangeFill.position.set(-2.5, 2.5, 5);
  scene.add(orangeFill);

  scene.add(new THREE.AmbientLight(0xffe6d6, 0.42));

  // — ball material: matte leather with grooved seams —
  const colorTex = makeColorTexture();
  const bumpTex  = makeBumpTexture();
  const roughTex = makeRoughnessTexture();

  const material = new THREE.MeshStandardMaterial({
    map:             colorTex,
    bumpMap:         bumpTex,
    bumpScale:       0.05,
    roughnessMap:    roughTex,
    roughness:       0.95,
    metalness:       0.0,
  });

  const ball = new THREE.Mesh(new THREE.SphereGeometry(2, 96, 64), material);
  ball.rotation.z = 0.16;
  scene.add(ball);

  // — soft particle halo (subtle, behind/around) —
  const particles = makeParticles();
  scene.add(particles);

  // — mouse parallax (only tracked while the ball is on screen) —
  const target = { x: 0, y: 0 };
  const smooth = { x: 0, y: 0 };
  const onPointerMove = (e) => {
    target.x = (e.clientX / window.innerWidth  - 0.5) * 0.8;
    target.y = (e.clientY / window.innerHeight - 0.5) * 0.8;
    orangeFill.position.x = -2.5 + target.x * 4;
    orangeFill.position.y =  2.5 - target.y * 3;
  };

  // — visibility gating: don't burn CPU/GPU when the hero is scrolled away
  //   or the tab is hidden. This is the main fix for the page feeling heavy. —
  let onScreen = true;
  let tabVisible = !document.hidden;
  let rafId = null;
  const running = () => onScreen && tabVisible;

  const io = new IntersectionObserver(
    ([entry]) => { onScreen = entry.isIntersecting; sync(); },
    { threshold: 0.01 }
  );
  io.observe(mount);

  document.addEventListener("visibilitychange", () => {
    tabVisible = !document.hidden;
    sync();
  });

  let t = 0;
  function frame() {
    if (!running()) { rafId = null; return; }   // stop the loop entirely
    rafId = requestAnimationFrame(frame);
    t += 0.016;

    ball.rotation.y += 0.005;
    ball.position.y  = Math.sin(t * 0.9) * 0.12;

    smooth.x += (target.x  - smooth.x) * 0.045;
    smooth.y += (-target.y - smooth.y) * 0.045;
    camera.position.x = smooth.x;
    camera.position.y = smooth.y;
    camera.lookAt(0, ball.position.y * 0.25, 0);

    particles.rotation.y += 0.0022;
    particles.rotation.x  = Math.sin(t * 0.35) * 0.05;

    renderer.render(scene, camera);
  }

  function sync() {
    if (running()) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      if (rafId == null) frame();              // resume
    } else {
      window.removeEventListener("pointermove", onPointerMove);
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    }
  }

  sync(); // kick off (renders only while visible)

  window.addEventListener("resize", () => {
    const s = size();
    renderer.setSize(s, s);
    camera.updateProjectionMatrix();
  });
}

/* ---- colour: rich leather orange + dark seams ---- */
function makeColorTexture() {
  const W = 2048, H = 1024;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // even leather orange (subtle vertical warmth, no heavy gradient)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.00, "#e06a26");
  g.addColorStop(0.50, "#d25c1c");
  g.addColorStop(1.00, "#c1500f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // very fine grain speckle (tiny, low-contrast → leather, not blotches)
  ctx.globalAlpha = 0.04;
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 0.6 + Math.random() * 1.2;
    ctx.fillStyle = Math.random() > 0.5 ? "#ffb377" : "#9c3e08";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // seam shadow (wide, soft dark halo around each seam)
  ctx.strokeStyle = "rgba(40,16,4,0.5)";
  drawSeams(ctx, W, H, H * 0.04);

  // seam core (crisp near-black channel)
  ctx.strokeStyle = "#1a0d04";
  drawSeams(ctx, W, H, H * 0.015);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

/* ---- bump: pebble noise (fast ImageData) + recessed seam grooves ---- */
function makeBumpTexture() {
  const W = 1024, H = 512;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // per-pixel pebble grain in one pass — far cheaper than 60k arc fills
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 150 + ((Math.random() * 90) | 0);
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // seams as deep recessed channels (dark = low)
  ctx.strokeStyle = "rgba(10,10,10,0.85)";
  drawSeams(ctx, W, H, H * 0.022);
  ctx.strokeStyle = "#000";
  drawSeams(ctx, W, H, H * 0.01);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/* ---- roughness: seams slightly glossier than matte leather ---- */
function makeRoughnessTexture() {
  const W = 1024, H = 512;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // bright = rough (matte leather), darker on seams = a touch shinier
  ctx.fillStyle = "#e6e6e6";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#9a9a9a";
  drawSeams(ctx, W, H, H * 0.02);

  const t = new THREE.CanvasTexture(c);
  return t;
}

/* ---- soft orbital particle halo ---- */
function makeParticles() {
  const COUNT = 70;
  const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const r = 3.0 + Math.random() * 2.4;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xff7a35,
    size: 0.05,
    transparent: true,
    opacity: 0.45,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}
