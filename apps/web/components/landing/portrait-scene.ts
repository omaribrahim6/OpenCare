// The landing hero's speaker: one rigged character at a time, framed waist up in a three-quarter
// view, in one WebGL canvas. An orthographic camera maps world units to CSS pixels, and each figure
// is scaled so its hips-to-head span fills the frame (the canvas fades it out at the bottom). The
// rigs have no animation clips; every pose is built per frame from world-space directions.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** What a character does while it speaks. */
export type Gesture = "explain" | "present" | "wag";

export interface PortraitMember {
  id: string;
  modelUrl: string;
  gesture: Gesture;
}

export interface PortraitSceneOptions {
  canvas: HTMLCanvasElement;
  members: PortraitMember[];
  isReduced: () => boolean;
  onLoaded: (index: number) => void;
  onFailed: (index: number | null) => void;
}

export interface PortraitScene {
  /** Bring this member on; the previous one leaves. */
  show: (index: number) => void;
  /** Pointer position in viewport coordinates, or null when it left the hero. */
  setPointer: (present: { x: number; y: number } | null) => void;
  stop: () => void;
}

/** The body's turn away from the camera, toward the headline on the left (radians). */
const TURN = -0.8;
/** Where the top of the head sits, as a share of the canvas height from the top. */
const TOP_AT = 0.1;
/** Where the hips sit, as a share of the canvas height from the top (inside the fade). */
const HIPS_AT = 0.84;

interface Arm {
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  /** -1 for the arm on the left of the screen, 1 for the right. */
  side: number;
}

interface Figure {
  member: PortraitMember;
  holder: THREE.Group;
  model: THREE.Object3D | null;
  bones: Record<string, THREE.Bone>;
  rest: Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>;
  mesh: THREE.Mesh | null;
  left: Arm | null;
  right: Arm | null;
  /** Top of the head, head bone and hips heights in model units, feet at 0. */
  topU: number;
  headU: number;
  hipsU: number;
  x: number;
  floor: number;
  s: number;
  /** 0..1 since this figure came on. */
  enter: number;
  /** Smoothed 0..1: how far into its gesture. */
  active: number;
  yaw: number;
  pitch: number;
  phase: number;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export function startPortraitScene(opts: PortraitSceneOptions): PortraitScene {
  const { canvas } = opts;
  const noop: PortraitScene = { show() {}, setPointer() {}, stop() {} };
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

  // Soft daylight: a warm key from the front left (the side they turn toward), lilac and peach rims.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d0fa, 1.45));
  const key = new THREE.DirectionalLight(0xfff3e2, 2.6);
  key.position.set(-0.6, 0.45, 1);
  scene.add(key);
  const rimR = new THREE.DirectionalLight(0xffc4a6, 2.4);
  rimR.position.set(1, 0.4, -0.6);
  scene.add(rimR);
  const rimL = new THREE.DirectionalLight(0xc9c1f7, 1.6);
  rimL.position.set(-1, 0.3, -0.8);
  scene.add(rimL);

  const v = () => new THREE.Vector3();
  const _o = v(), _a = v(), _b = v(), _d1 = v(), _d2 = v();
  const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion();

  const figures: Figure[] = opts.members.map((member, index) => {
    const holder = new THREE.Group();
    holder.visible = false;
    scene.add(holder);
    return {
      member, holder, model: null, bones: {}, rest: new Map(), mesh: null, left: null, right: null,
      topU: 1, headU: 0.86, hipsU: 0.5, x: 0, floor: 0, s: 1, enter: 0, active: 0, yaw: 0, pitch: 0, phase: index * 1.7,
    };
  });

  const state = {
    shown: -1,
    pointer: null as { x: number; y: number } | null,
    pointerAt: -1e9,
    w: 0,
    h: 0,
    last: 0,
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

    // Coming on: a short glide in from the right while turning toward the reader.
    f.enter = reduced ? 1 : Math.min(1, f.enter + dt / 0.9);
    const e = 1 - Math.pow(1 - f.enter, 3);
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 3.2);
    f.active += ((f.enter > 0.45 ? 1 : 0) - f.active) * ease;
    const a = f.active;
    const tt = t + f.phase;

    f.holder.position.set(f.x + (1 - e) * state.w * 0.08, f.floor, 0);
    model.scale.setScalar(f.s);
    model.position.set(0, 0.5 * f.s, 0);

    for (const [bone, r] of f.rest) {
      bone.quaternion.copy(r.q);
      bone.position.copy(r.p);
    }

    // Where to look: the pointer if it moved recently, else nearly at the reader.
    const headY = f.floor + f.s * f.headU;
    const depth = f.s * 0.9;
    let wantYaw = -0.32;
    let wantPitch = 0.02;
    if (state.pointer && t - state.pointerAt < 2.5) {
      wantYaw = THREE.MathUtils.clamp(Math.atan2(state.pointer.x - f.x, depth), -0.8, 0.55);
      wantPitch = THREE.MathUtils.clamp(Math.atan2(state.pointer.y - headY, depth), -0.3, 0.35);
    }
    const lookEase = reduced ? 1 : 1 - Math.exp(-dt * 4);
    f.yaw += (wantYaw - f.yaw) * lookEase;
    f.pitch += (wantPitch - f.pitch) * lookEase;

    // The body holds a three-quarter turn; the neck and head turn back toward where it looks.
    const bodyYaw = TURN + 0.15 * (f.yaw - TURN) + (1 - e) * 0.3;
    const rest = f.yaw - bodyYaw;
    model.rotation.set(0, -Math.PI / 2 + bodyYaw + 0.035 * Math.sin(tt * 0.5) * m, 0);
    f.holder.updateMatrixWorld(true);

    const breath = Math.sin((tt * Math.PI * 2) / 4.2) * m;
    const sway = Math.sin(tt * 0.9) * m;
    spin(B.Hips, Z, 0.01 * sway);
    spin(B.Spine, Z, -0.01 * sway);
    spin(B.Chest, X, 0.016 * breath - 0.04 * a);
    spin(B.Neck, Y, rest * 0.4);
    spin(B.Head, Y, rest * 0.6);
    spin(B.Head, X, -f.pitch * 0.8 + 0.03 * Math.sin(tt * 0.7) * m);
    const g = f.member.gesture;
    // Speaking: small nods, or a slow shake for the one making a point.
    if (g !== "wag") spin(B.Head, X, a * 0.05 * Math.sin(tt * 2.9) * m);
    else spin(B.Head, Z, a * 0.045 * Math.sin(tt * 3.1) * m);

    const L = f.left;
    const R = f.right;
    if (L && R) {
      const idle = 0.02 * Math.sin(tt * 0.9) * m;
      const beat = Math.sin(tt * 2.6) * m;
      if (g === "explain") {
        // An open hand at chest height, counting off the point.
        arm(R, a, [0.45, -0.6, 0.6], [0.3, 0.75 + 0.12 * beat, 0.65], idle);
        arm(L, a * 0.45, [0.3, -0.85, 0.3], [0.05, -0.4, 1], idle);
      } else if (g === "present") {
        // Both hands open, offering the point to the reader.
        arm(R, a, [0.25, -0.8, 0.55], [0.3, 0.3 + 0.08 * beat, 0.9], idle);
        arm(L, a * 0.8, [0.25, -0.8, 0.55], [0.3, 0.25 - 0.08 * beat, 0.9], idle);
      } else {
        // A raised hand, making the point.
        arm(R, a, [0.5, 0.05, 0.5], [0.1 + 0.1 * beat, 1, 0.35], idle);
        arm(L, a * 0.4, [0.3, -0.85, 0.2], [0.1, -0.6, 0.8], idle);
      }
    }

    const smile = { explain: 0.75, present: 0.8, wag: 0.15 }[g];
    const furrow = { explain: 0, present: 0, wag: 0.8 }[g];
    const raise = { explain: 0.35, present: 0.45, wag: 0.15 }[g];
    setMorph(f, "Smile", 0.3 + (smile - 0.3) * a + 0.06 * Math.sin(tt * 0.8) * m);
    setMorph(f, "BrowFurrow", furrow * a);
    setMorph(f, "BrowRaise", raise * a * (0.8 + 0.2 * Math.sin(tt * 1.7) * m));
    setMorph(f, "Squint", 0.08 * a);
  }

  function frameFigure(f: Figure) {
    const { w, h } = state;
    const span = Math.max(0.2, f.topU - f.hipsU);
    f.s = Math.min(((HIPS_AT - TOP_AT) * h) / span, 1.55 * w);
    // The page says where the figure stands across the canvas (--ln-fx, a share of its width).
    const fx = parseFloat(getComputedStyle(canvas).getPropertyValue("--ln-fx")) || 0.5;
    f.x = (fx - 0.5) * w;
    f.floor = h / 2 - TOP_AT * h - f.topU * f.s;
  }

  function layout() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    state.w = rect.width;
    state.h = rect.height;
    renderer.setSize(rect.width, rect.height, false);
    camera.left = -rect.width / 2;
    camera.right = rect.width / 2;
    camera.top = rect.height / 2;
    camera.bottom = -rect.height / 2;
    camera.updateProjectionMatrix();
    for (const f of figures) frameFigure(f);
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
    const f = figures[state.shown];
    if (f?.model) pose(f, t, dt);
    renderer.render(scene, camera);
    const settling = f ? f.enter < 1 : false;
    if ((!opts.isReduced() || settling) && !document.hidden && visible) raf = requestAnimationFrame(frame);
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
  const seen = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) kick();
  });
  seen.observe(canvas);
  document.addEventListener("visibilitychange", kick);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const loaded: THREE.Object3D[] = [];
  figures.forEach((f, index) => {
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
        f.holder.add(model);
        f.model = model;

        // Measure the rig at scale 1, facing the camera, feet at 0.
        model.scale.setScalar(1);
        model.position.set(0, 0.5, 0);
        model.rotation.set(0, -Math.PI / 2, 0);
        f.holder.position.set(0, 0, 0);
        f.holder.updateMatrixWorld(true);
        const B = f.bones;
        if (B.Head) f.headU = B.Head.getWorldPosition(_o).y;
        if (B.Hips) f.hipsU = B.Hips.getWorldPosition(_o).y;
        f.topU = new THREE.Box3().setFromObject(model).max.y;

        // With the model turned to face the camera, its Left arm is on the right of the screen.
        const make = (name: "Left" | "Right"): Arm | null =>
          B[`${name}UpperArm`] && B[`${name}Forearm`] && B[`${name}Hand`]
            ? { upper: B[`${name}UpperArm`], fore: B[`${name}Forearm`], hand: B[`${name}Hand`], side: 0 }
            : null;
        const one = make("Left");
        const two = make("Right");
        if (one && two) {
          const x1 = one.upper.getWorldPosition(_o).x;
          const x2 = two.upper.getWorldPosition(_a).x;
          f.left = x1 < x2 ? one : two;
          f.right = x1 < x2 ? two : one;
          f.left.side = -1;
          f.right.side = 1;
        }
        layout();
        opts.onLoaded(index);
        kick();
      },
      undefined,
      () => {
        if (!stopped) opts.onFailed(index);
      },
    );
  });

  relayout();

  return {
    show(index) {
      if (index === state.shown) return;
      const prev = figures[state.shown];
      if (prev) prev.holder.visible = false;
      state.shown = index;
      const f = figures[index];
      if (f) {
        f.holder.visible = true;
        f.enter = 0;
        f.active = 0;
        f.yaw = -0.12;
        f.pitch = 0;
      }
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
