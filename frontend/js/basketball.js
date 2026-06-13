// 3D basketball hero — procedurally textured sphere, lit and animated.
import * as THREE from "three";

const mount = document.getElementById("ball-canvas");
if (mount) initBall(mount);

function initBall(mount) {
  const size = () => Math.min(mount.clientWidth, mount.clientHeight) || 400;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(size(), size());
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 6.4);

  // --- lighting: warm key + cool rim + soft fill ---
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const key = new THREE.DirectionalLight(0xfff0e0, 2.1);
  key.position.set(4, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x5b7cff, 1.3);
  rim.position.set(-6, -2, -4);
  scene.add(rim);
  const warm = new THREE.PointLight(0xee6730, 1.4, 30);
  warm.position.set(-3, 3, 4);
  scene.add(warm);

  // --- material from procedural textures ---
  const tex = makeBallTexture();
  const bump = makePebbleTexture();
  const material = new THREE.MeshStandardMaterial({
    map: tex,
    bumpMap: bump,
    bumpScale: 0.015,
    roughness: 0.78,
    metalness: 0.05,
  });

  const ball = new THREE.Mesh(new THREE.SphereGeometry(2, 96, 96), material);
  ball.rotation.z = 0.18; // slight tilt
  scene.add(ball);

  // --- interaction: subtle parallax toward pointer ---
  const target = { x: 0, y: 0 };
  window.addEventListener("pointermove", (e) => {
    target.x = (e.clientX / window.innerWidth - 0.5) * 0.6;
    target.y = (e.clientY / window.innerHeight - 0.5) * 0.6;
  });

  let t = 0;
  function animate() {
    requestAnimationFrame(animate);
    t += 0.016;
    ball.rotation.y += 0.006;                       // constant spin
    ball.position.y = Math.sin(t * 1.1) * 0.12;     // gentle bob
    camera.position.x += (target.x - camera.position.x) * 0.05;
    camera.position.y += (-target.y - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }
  animate();

  const onResize = () => {
    const s = size();
    renderer.setSize(s, s);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);
}

// Equirectangular basketball texture: orange base + black seams.
function makeBallTexture() {
  const W = 1024, H = 512;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // base gradient (gives the leather depth)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#e8742f");
  g.addColorStop(0.5, "#d2581c");
  g.addColorStop(1, "#b8470f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // seams
  ctx.strokeStyle = "#140a06";
  ctx.lineCap = "round";
  ctx.lineWidth = H * 0.016;

  // vertical seam (meridian) — front + wrapped back edge
  line(ctx, [[W * 0.5, 0], [W * 0.5, H]]);
  line(ctx, [[0, 0], [0, H]]);
  line(ctx, [[W, 0], [W, H]]);

  // two curved seams (full-amplitude sine waves, 180° out of phase)
  const amp = H * 0.46, mid = H * 0.5, steps = 160;
  for (const phase of [0, Math.PI]) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * W;
      const y = mid + amp * Math.sin((x / W) * Math.PI * 2 + phase);
      pts.push([x, y]);
    }
    line(ctx, pts);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Fine pebbled noise used as a bump map for that basketball-leather feel.
function makePebbleTexture() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 150 + Math.floor(Math.random() * 105);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8);
  return t;
}

function line(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}
