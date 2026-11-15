// The landing page's cast: three rigged characters standing in a row, one WebGL canvas.
// An orthographic camera maps world units to CSS pixels, so each figure is sized and placed
// from its slot's DOM box. The rigs have no animation clips; every pose is built per frame
// from world-space directions, so the same code drives all of them.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** What a character does while it has the floor. */
export type Gesture = "explain" | "point" | "wag";

export interface CastMember {
  id: string;
  modelUrl: string;
  /** The box the figure stands in: feet on its bottom edge, centered. */
  slot: HTMLElement;
  gesture: Gesture;
}

export interface CastSceneOptions {
  canvas: HTMLCanvasElement;
  members: CastMember[];
  /** What the cast stares at when nobody has the floor (the bill). */
  focus?: HTMLElement | null;
  isReduced: () => boolean;
  onLoaded: (id: string) => void;
  onFailed: (id: string | null) => void;
}

export interface CastScene {
  /** Index of the member who has the floor, or -1 for nobody. */
  setActive: (index: number) => void;
  /** The bill reached $0: everyone relaxes, smiles and turns to the reader. */
  setCheer: (on: boolean) => void;
  /** Pointer position in viewport coordinates, or null when it left the stage. */
  setPointer: (point: { x: number; y: number } | null) => void;
  stop: () => void;
}

// The rigs are 1 unit tall (feet at y = -0.5) and about 0.3 wide with the arms down.
const FIGURE_ASPECT = 0.36;
const ACTIVE_GROW = 0.07;

interface Arm {
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  /** -1 for the arm on the left of the screen, 1 for the right. */
  side: number;
}

interface Figure {
  member: CastMember;
  index: number;
  holder: THREE.Group;
  model: THREE.Object3D | null;
  bones: Record<string, THREE.Bone>;
  rest: Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>;
  mesh: THREE.Mesh | null;
  left: Arm | null;
  right: Arm | null;
  x: number;
  floor: number;
  s: number;
  loadedAt: number;
  /** Smoothed 0..1: how much this figure has the floor. */
  active: number;
  cheer: number;
  /** Smoothed 0..1: staring at the bill. */
  shock: number;
  yaw: number;
  pitch: number;
  phase: number;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export function startCastScene(opts: CastSceneOptions): CastScene {
  const { canvas } = opts;
  const noop: CastScene = { setActive() {}, setCheer() {}, setPointer() {}, stop() {} };
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  } catch {
    opts.onFailed(null);
    return noop;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  camera.position.set(0, 0, 2000);

  // Soft daylight: a warm key from the front left, lilac and peach rims to match the stage.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d0fa, 1.5));
  const key = new THREE.DirectionalLight(0xfff3e2, 2.5);
  key.position.set(-0.45, 0.5, 1);
  scene.add(key);
  const rimR = new THREE.DirectionalLight(0xffc4a6, 2.0);
  rimR.position.set(1, 0.45, -0.7);
  scene.add(rimR);
  const rimL = new THREE.DirectionalLight(0xc9c1f7, 1.8);
  rimL.position.set(-1, 0.3, -0.8);
  scene.add(rimL);

  const v = () => new THREE.Vector3();
  const _o = v(), _a = v(), _b = v(), _d1 = v(), _d2 = v(), _head = v();
  const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion();

  const figures: Figure[] = opts.members.map((member, index) => {
    const holder = new THREE.Group();
    scene.add(holder);
    return {
      member, index, holder, model: null, bones: {}, rest: new Map(), mesh: null, left: null, right: null,
      x: 0, floor: 0, s: 1, loadedAt: 0, active: 0, cheer: 0, shock: 0, yaw: 0, pitch: 0, phase: index * 1.7,
    };
  });

  const state = {
    active: -1,
    cheer: false,
    pointer: null as { x: number; y: number } | null,
    pointerAt: -1e9,
    w: 0,
    h: 0,
    last: 0,
    focusX: 0,
    focusY: 0,
  };

  /** Rotate a bone by a world-space quaternion, keeping its position. */
  function applyWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
    bone.getWorldQuaternion(_qw).premultiply(q);
    bone.parent!.getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_qp.multiply(_qw));
    bone.updateMatrixWorld(true);
  }

  function spin(bone: THREE.Object3D | undefined, axis: THREE.Vector3, angle: number) {
    if (!bone || !angle) return;
    applyWorld(bone, _q.setFromAxisAngle(axis, angle));
  }

  /** Point a limb segment (bone to child) along a world direction. */
  function point(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
    bone.getWorldPosition(_o);
    child.getWorldPosition(_a);
    _a.sub(_o).normalize();
    _b.copy(dir).normalize();
    applyWorld(bone, _q.setFromUnitVectors(_a, _b));
  }

  function setMorph(f: Figure, name: string, value: number) {
    const i = f.mesh?.morphTargetDictionary?.[name];
    if (f.mesh?.morphTargetInfluences && i !== undefined) f.mesh.morphTargetInfluences[i] = THREE.MathUtils.clamp(value, 0, 1);
  }

  /** Blend an arm from hanging at the side toward a gesture, by weight w. */
  function arm(a: Arm, w: number, upper: [number, number, number], fore: [number, number, number], swing = 0) {
    const s = a.side;
    _d1.set(s * 0.1 + swing, -1, 0.05);
    _d2.set(s * upper[0], upper[1], upper[2]);
    point(a.upper, a.fore, _d1.lerp(_d2, w));
    _d1.set(s * 0.03 + swing, -1, 0.2);
    _d2.set(s * fore[0], fore[1], fore[2]);
    point(a.fore, a.hand, _d1.lerp(_d2, w));
  }

  function pose(f: Figure, t: number, dt: number) {
    const model = f.model!;
    const B = f.bones;
    const reduced = opts.isReduced();
    const m = reduced ? 0 : 1;
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 7);

    const isActive = state.active === f.index && !state.cheer;
    f.active += ((isActive ? 1 : 0) - f.active) * ease;
    f.cheer += ((state.cheer ? 1 : 0) - f.cheer) * ease;
    const a = f.active;
    const c = f.cheer;
    const tt = t + f.phase;

    const scale = f.s * (1 + ACTIVE_GROW * a);
    f.holder.position.set(f.x, f.floor, a * 40);
    model.scale.setScalar(scale);
    model.position.set(0, 0.5 * scale, 0);

    // Where to look: the pointer if it moved recently, else whoever has the floor, else the reader.
    for (const [bone, r] of f.rest) {
      bone.quaternion.copy(r.q);
      bone.position.copy(r.p);
    }
    let lookX = f.x;
    let lookY = f.floor + scale * 0.9;
    let strength = 0;
    let staring = false;
    const other = state.active >= 0 && state.active !== f.index ? figures[state.active] : null;
    if (state.pointer && t - state.pointerAt < 2.5) {
      lookX = state.pointer.x;
      lookY = state.pointer.y;
      strength = 1;
    } else if (other && !state.cheer) {
      lookX = other.x;
      lookY = other.floor + other.s * 0.86;
      strength = 0.8;
    } else if (state.active < 0 && !state.cheer && opts.focus) {
      lookX = state.focusX;
      lookY = state.focusY;
      strength = 1;
      staring = true;
    }
    f.shock += ((staring ? 1 : 0) - f.shock) * ease;
    const headY = f.floor + scale * 0.86;
    const depth = scale * 0.9;
    const wantYaw = THREE.MathUtils.clamp(Math.atan2(lookX - f.x, depth), -0.75, 0.75) * strength;
    const wantPitch = THREE.MathUtils.clamp(Math.atan2(lookY - headY, depth), -0.3, 0.4) * strength;
    const lookEase = reduced ? 1 : 1 - Math.exp(-dt * 5);
    f.yaw += (wantYaw - f.yaw) * lookEase;
    f.pitch += (wantPitch - f.pitch) * lookEase;

    // The body turns a third of the way; the neck and head do the rest.
    model.rotation.set(0, -Math.PI / 2 + f.yaw * 0.3 + 0.04 * Math.sin(tt * 0.5) * m, 0);
    f.holder.updateMatrixWorld(true);

    const breath = Math.sin((tt * Math.PI * 2) / 4.2) * m;
    const sway = Math.sin(tt * 0.9) * m;
    spin(B.Hips, Z, 0.012 * sway);
    spin(B.Spine, Z, -0.012 * sway);
    spin(B.Chest, X, 0.018 * breath - 0.05 * a);
    spin(B.Neck, Y, f.yaw * 0.3);
    spin(B.Head, Y, f.yaw * 0.4);
    spin(B.Head, X, -f.pitch * 0.8 + 0.03 * Math.sin(tt * 0.7) * m);
    const g = f.member.gesture;
    if (g === "explain") spin(B.Head, X, a * 0.07 * Math.sin(tt * 3.1) * m);
    if (g === "wag") spin(B.Head, Z, a * 0.05 * Math.sin(tt * 3.4) * m);

    const L = f.left;
    const R = f.right;
    if (L && R) {
      const idle = 0.02 * Math.sin(tt * 0.9) * m;
      if (g === "explain") {
        // One open hand up, counting off the point; the other relaxed.
        arm(R, a, [0.5, -0.55, 0.55], [0.35, 0.8 + 0.12 * Math.sin(tt * 3.1) * m, 0.6], idle);
        arm(L, a * 0.5, [0.3, -0.85, 0.3], [0.05, -0.4, 1], idle);
      } else if (g === "point") {
        // Points across the stage at the bill; the other hand goes to the hip.
        arm(L, a, [0.95, 0.12, 0.35], [1, 0.16 + 0.05 * Math.sin(tt * 3) * m, 0.3], idle);
        arm(R, a, [0.6, -0.72, -0.08], [-0.45, -0.5, 0.4], idle);
      } else {
        // A raised hand, making the point.
        arm(R, a, [0.5, 0.05, 0.5], [0.1 + 0.1 * Math.sin(tt * 2.6) * m, 1, 0.35], idle);
        arm(L, a * 0.4, [0.3, -0.85, 0.2], [0.1, -0.6, 0.8], idle);
      }
    }

    const k = f.shock;
    const smile = { explain: 0.85, point: 0.7, wag: 0.15 }[g];
    const furrow = { explain: 0, point: 0, wag: 0.9 }[g];
    const raise = { explain: 0.35, point: 0.55, wag: 0.1 }[g];
    setMorph(f, "Smile", 0.3 * (1 - k) + (smile - 0.3) * a + 0.7 * c + 0.06 * Math.sin(tt * 0.8) * m);
    setMorph(f, "BrowFurrow", furrow * a * (1 - c));
    setMorph(f, "BrowRaise", raise * a + 0.25 * c + 0.85 * k);
    setMorph(f, "Squint", 0.15 * c);
  }

  function layout() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!w || !h) return;
    state.w = w;
    state.h = h;
    renderer.setSize(w, h, false);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    for (const f of figures) {
      const r = f.member.slot.getBoundingClientRect();
      f.x = r.left + r.width / 2 - rect.left - w / 2;
      f.floor = h / 2 - (r.bottom - rect.top);
      f.s = Math.min(r.height / (1 + ACTIVE_GROW), r.width / FIGURE_ASPECT);
    }
    if (opts.focus) {
      const r = opts.focus.getBoundingClientRect();
      state.focusX = r.left + r.width / 2 - rect.left - w / 2;
      state.focusY = h / 2 - (r.top + r.height * 0.45 - rect.top);
    }
  }

  let raf = 0;
  let stopped = false;
  let visible = true;
  function frame(now: number) {
    raf = 0;
    if (stopped) return;
    const t = now / 1000;
    const dt = Math.min(0.1, state.last ? t - state.last : 0.016);
    state.last = t;
    for (const f of figures) if (f.model) pose(f, t, dt);
    renderer.render(scene, camera);
    if (!opts.isReduced() && !document.hidden && visible) raf = requestAnimationFrame(frame);
  }
  const kick = () => {
    if (!raf && !stopped) {
      state.last = 0;
      raf = requestAnimationFrame(frame);
    }
  };
  const relayout = () => {
    layout();
    kick();
  };

  const resize = new ResizeObserver(relayout);
  resize.observe(canvas);
  for (const f of figures) resize.observe(f.member.slot);
  const seen = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) kick();
  });
  seen.observe(canvas);
  document.addEventListener("visibilitychange", kick);
  void document.fonts?.ready.then(relayout);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const loaded: THREE.Object3D[] = [];
  for (const f of figures) {
    loader.load(
      f.member.modelUrl,
      (gltf) => {
        if (stopped) return;
        const model = gltf.scene;
        loaded.push(model);
        model.traverse((o) => {
          if ((o as THREE.Bone).isBone) {
            const bone = o as THREE.Bone;
            f.bones[bone.name] = bone;
            f.rest.set(bone, { q: bone.quaternion.clone(), p: bone.position.clone() });
          }
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.frustumCulled = false;
            if (mesh.morphTargetDictionary) f.mesh = mesh;
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat && "envMapIntensity" in mat) mat.envMapIntensity = 0.85;
          }
        });
        const B = f.bones;
        // With the model turned to face the camera, its Left arm is on the right of the screen.
        const make = (name: "Left" | "Right"): Arm | null =>
          B[`${name}UpperArm`] && B[`${name}Forearm`] && B[`${name}Hand`]
            ? { upper: B[`${name}UpperArm`], fore: B[`${name}Forearm`], hand: B[`${name}Hand`], side: 0 }
            : null;
        const one = make("Left");
        const two = make("Right");
        f.holder.add(model);
        f.model = model;
        layout();
        model.rotation.set(0, -Math.PI / 2, 0);
        f.holder.updateMatrixWorld(true);
        if (one && two) {
          const x1 = one.upper.getWorldPosition(_o).x;
          const x2 = two.upper.getWorldPosition(_head).x;
          f.left = x1 < x2 ? one : two;
          f.right = x1 < x2 ? two : one;
          f.left.side = -1;
          f.right.side = 1;
        }
        f.loadedAt = performance.now() / 1000;
        opts.onLoaded(f.member.id);
        kick();
      },
      undefined,
      () => {
        if (!stopped) opts.onFailed(f.member.id);
      },
    );
  }

  relayout();

  return {
    setActive(index) {
      state.active = index;
      kick();
    },
    setCheer(on) {
      state.cheer = on;
      kick();
    },
    setPointer(p) {
      if (!p) {
        state.pointer = null;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      state.pointer = { x: p.x - rect.left - rect.width / 2, y: rect.height / 2 - (p.y - rect.top) };
      state.pointerAt = performance.now() / 1000;
      kick();
    },
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      resize.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", kick);
      for (const model of loaded) {
        model.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            for (const value of Object.values(mat)) if (value instanceof THREE.Texture) value.dispose();
            mat.dispose();
          }
        });
      }
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
