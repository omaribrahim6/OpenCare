// The kiosk character: a rigged GLB hanging one-handed from the scanner disc.
// An orthographic camera maps world units to CSS pixels, so the rig is placed from
// the scanner's DOM rect. The model hangs from a pivot at the grip point; the pivot
// swings like a pendulum and two-bone IK keeps the (hidden) fist on the rim.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// Tuning, in model units (the rigs are about 1 unit tall, head top at y = 0.5).
const WRIST_DROP = -0.045; // wrist sits inside the rim, so the gripping fist is hidden behind the disc
const GRIP_X = -0.12; // grip point along the rim's bottom, as a fraction of the radius
const ARM_REACH = 0.985; // the hanging arm is nearly straight
const CIRCLE_R_MIN = 0.15; // scanner radius in model units: never draw the character bigger...
const CIRCLE_R_MAX = 0.36; // ...or smaller than this
const FEET_GAP = 14; // px between the toes and the headline
const FALL_TIME = 0.6; // s, entrance drop
const SWING_PERIOD = 2.8; // s
const SWING_AMP = 0.075; // rad, steady dangle
const SWING_START = 0.38; // rad, right after the catch

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  /** The scanner disc's box; the rig is sized and placed from it. */
  scanner: HTMLElement;
  /** The character's toes stop just above this element. */
  floor: HTMLElement;
  modelUrl: string;
  isReduced: () => boolean;
  /** Seconds (performance.now / 1000) of the last finger poke on the scanner. */
  pokedAt: () => number;
  onLoaded: () => void;
  onFailed: () => void;
  onCaught: () => void;
  onNudge: () => void;
}

interface Arm {
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  collar: THREE.Bone | undefined;
  /** Sign of the arm's model-space Z (the character's left is -Z). */
  lateral: number;
  /** Which side of the screen it is on. */
  side: number;
}

/** Starts the scene and returns a function that stops it and frees the GPU resources. */
export function startScene(opts: SceneOptions): { stop: () => void; kick: () => void } {
  const { canvas, scanner, floor } = opts;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  } catch {
    opts.onFailed();
    return { stop: () => {}, kick: () => {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  camera.position.set(0, 0, 2000);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9c1f0, 1.5));
  const key = new THREE.DirectionalLight(0xfff4ea, 2.3);
  key.position.set(-0.5, 0.35, 1);
  scene.add(key);
  const rimR = new THREE.DirectionalLight(0xb7a6ff, 2.6);
  rimR.position.set(1, 0.5, -0.7);
  scene.add(rimR);
  const rimL = new THREE.DirectionalLight(0xc9b8ff, 1.8);
  rimL.position.set(-1, 0.3, -0.8);
  scene.add(rimL);
  // The scanner glow lights the face from above.
  const glow = new THREE.PointLight(0xd8ccff, 0, 0, 0);
  scene.add(glow);

  const v = () => new THREE.Vector3();
  const _S = v(), _E = v(), _H = v(), _T = v(), _dir = v(), _p = v(), _a = v(), _b = v(), _o = v();
  const _pole = v(), _d1 = v(), _d2 = v();
  const UP = new THREE.Vector3(0, 1, 0);
  const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion();

  const pivot = new THREE.Group();
  scene.add(pivot);
  const st = {
    model: null as THREE.Object3D | null,
    bones: {} as Record<string, THREE.Bone>,
    rest: new Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>(),
    mesh: null as THREE.Mesh | null,
    hang: null as Arm | null,
    free: null as Arm | null,
    s: 1,
    cx: 0,
    cy: 0,
    R: 0,
    h: 0,
    floor: 0,
    loadedAt: 0,
    caught: false,
    nextNudge: 0,
    nudgeAt: -1e9,
    grip: new THREE.Vector3(),
    offset: new THREE.Vector3(),
    lean: 0,
    dropPerUnit: 0,
  };

  // Model axes: +X forward, +Y up, Z lateral. With the model turned to face the
  // camera, a bone's rotateX(+a) turns it counter-clockwise on screen, and
  // rotateZ(+a) swings it forward.

  function turn(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
    _q.setFromUnitVectors(from, to);
    bone.getWorldQuaternion(_qw).premultiply(_q);
    bone.parent!.getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_qp.multiply(_qw));
    bone.updateMatrixWorld(true);
  }

  /** Rotate `bone` so its child at `childPos` swings onto the line toward `target`. */
  function aim(bone: THREE.Object3D, childPos: THREE.Vector3, target: THREE.Vector3) {
    bone.getWorldPosition(_o);
    _a.subVectors(childPos, _o).normalize();
    _b.subVectors(target, _o).normalize();
    turn(bone, _a, _b);
  }

  /** Point a limb segment along a world direction. */
  function point(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
    bone.getWorldPosition(_o);
    child.getWorldPosition(_a);
    _a.sub(_o).normalize();
    _b.copy(dir).normalize();
    turn(bone, _a, _b);
  }

  function resetPose() {
    for (const [bone, r] of st.rest) {
      bone.quaternion.copy(r.q);
      bone.position.copy(r.p);
    }
  }

  /** Everything except the arms. ph is the swing phase, amp its size, m the idle amount. */
  function bodyPose(t: number, m: number, ph: number, amp: number, tilt: number) {
    const B = st.bones;
    const breath = Math.sin((t * Math.PI * 2) / 4.4);
    // The upper body trails the swing a little; the head stays nearer upright.
    B.Spine?.rotateX(0.18 * amp * Math.sin(ph - 0.6));
    B.Chest?.rotateZ(-0.02 * breath * m);
    B.Neck?.rotateY(0.1 * Math.sin(t * 0.42) * m);
    B.Head?.rotateX(-0.45 * tilt + 0.04 * Math.sin(t * 0.61 + 1.3) * m);
    B.Head?.rotateZ(0.06);
    // The hanging shoulder is pulled up toward the ear.
    st.hang?.collar?.rotateX(st.hang.lateral * -0.5);
    // Legs hang together: a soft knee, toes relaxed, a small lag behind the swing.
    const trail = -0.25 * amp * Math.sin(ph - 0.9);
    const legs: [THREE.Bone | undefined, THREE.Bone | undefined, THREE.Bone | undefined, number][] = [
      [B.LeftThigh, B.LeftShin, B.LeftFoot, -1],
      [B.RightThigh, B.RightShin, B.RightFoot, 1],
    ];
    for (const [thigh, shin, foot, lat] of legs) {
      if (!thigh) continue;
      thigh.rotateX(trail + lat * -0.025);
      thigh.rotateZ(0.06);
      shin?.rotateZ(-0.1);
      foot?.rotateZ(-0.28);
    }
  }

  /** Two-bone IK: put the wrist on `target`, elbow toward `pole`. */
  function reach(arm: Arm, target: THREE.Vector3, pole: THREE.Vector3) {
    const { upper, fore, hand } = arm;
    upper.getWorldPosition(_S);
    fore.getWorldPosition(_E);
    hand.getWorldPosition(_H);
    const a = _S.distanceTo(_E);
    const b = _E.distanceTo(_H);
    _dir.subVectors(target, _S);
    const d = THREE.MathUtils.clamp(_dir.length(), Math.abs(a - b) + 1e-3, (a + b) * 0.999);
    _dir.normalize();
    _p.copy(pole).addScaledVector(_dir, -pole.dot(_dir)).normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _T.copy(_S).addScaledVector(_dir, a * cosA).addScaledVector(_p, a * sinA);
    aim(upper, _E, _T);
    fore.getWorldPosition(_E);
    hand.getWorldPosition(_H);
    _T.copy(_S).addScaledVector(_dir, d);
    aim(fore, _H, _T);
  }

  function hangArm(arm: Arm) {
    _pole.set(arm.side, 0, -0.6);
    reach(arm, st.grip, _pole);
    // Keep the fist upright behind the disc while the body swings below it.
    arm.fore.getWorldPosition(_E);
    arm.hand.getWorldPosition(_H);
    _d1.subVectors(_H, _E).normalize();
    _d2.copy(_d1).lerp(UP, 0.85).normalize();
    turn(arm.hand, _d1, _d2);
  }

  function freeArm(arm: Arm, t: number, ph: number, amp: number, wave: number) {
    const side = arm.side;
    // Relaxed: hangs down and a little out, lagging the swing. Waves now and then.
    const lag = -0.9 * amp * Math.sin(ph - 1.4);
    _d1.set(side * 0.22 + lag, -1, 0.12).normalize();
    _d2.set(side * 0.95, 0.55, 0.3).normalize();
    _d1.lerp(_d2, wave);
    point(arm.upper, arm.fore, _d1);
    const wag = wave * 0.55 * Math.sin(t * 13);
    _d2.set(side * (0.12 + 0.2 * wave) + wag + lag * 0.6, -1 + 2.2 * wave, 0.35);
    point(arm.fore, arm.hand, _d2);
  }

  function setMorph(name: string, value: number) {
    const mesh = st.mesh;
    const i = mesh?.morphTargetDictionary?.[name];
    if (mesh?.morphTargetInfluences && i !== undefined) mesh.morphTargetInfluences[i] = value;
  }

  /**
   * Pose the rig hanging straight (no swing) at scale s with the wrist on st.grip.
   * Returns the pivot-local offset, the lean that puts the body under the hand, and
   * how far the toes hang below the grip.
   */
  function hangAt(s: number) {
    const model = st.model!;
    const arm = st.hang!;
    pivot.position.copy(st.grip);
    pivot.rotation.set(0, 0, 0);
    model.scale.setScalar(s);
    model.rotation.set(0, -Math.PI / 2, 0);
    model.position.set(0, 0, 0);
    resetPose();
    pivot.updateMatrixWorld(true);
    bodyPose(0, 0, 0, 0, 0);
    arm.upper.getWorldPosition(_S);
    arm.fore.getWorldPosition(_E);
    arm.hand.getWorldPosition(_H);
    const L = ARM_REACH * (_S.distanceTo(_E) + _E.distanceTo(_H));
    const offset = new THREE.Vector3(st.grip.x - _S.x, st.grip.y - L - _S.y, 0);
    model.position.copy(offset);
    pivot.updateMatrixWorld(true);
    st.bones.Spine?.getWorldPosition(_o);
    _o.sub(st.grip);
    const lean = Math.atan(_o.x / _o.y);
    pivot.rotation.z = lean;
    pivot.updateMatrixWorld(true);
    let low = Infinity;
    for (const name of ["LeftToe", "RightToe", "LeftFoot", "RightFoot"]) {
      const bone = st.bones[name];
      if (!bone) continue;
      bone.getWorldPosition(_o);
      low = Math.min(low, _o.y);
    }
    return { offset, lean, drop: st.grip.y - low + 0.035 * s };
  }

  function placeModel() {
    if (!st.model || !st.hang || !st.free) return;
    const { R, cx, cy } = st;
    if (!st.dropPerUnit) {
      st.grip.set(0, 0, 0);
      st.dropPerUnit = hangAt(1).drop;
    }
    // Size the character so its toes stop just above the headline.
    let s = (cy - R - st.floor) / (st.dropPerUnit + WRIST_DROP);
    s = THREE.MathUtils.clamp(s, R / CIRCLE_R_MAX, R / CIRCLE_R_MIN);
    st.s = s;
    st.grip.set(cx + GRIP_X * R, cy - R - WRIST_DROP * s, 0.06 * s);
    const placed = hangAt(s);
    st.offset.copy(placed.offset);
    st.lean = placed.lean;
    st.free.upper.getWorldPosition(_S);
    st.free.side = Math.sign(_S.x - st.grip.x) || st.free.side;
    st.hang.side = -st.free.side;
  }

  function layout() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    const r = scanner.getBoundingClientRect();
    st.cx = r.left + r.width / 2 - w / 2;
    st.cy = h / 2 - (r.top + r.height / 2);
    st.R = r.width / 2;
    st.floor = h / 2 - floor.getBoundingClientRect().top + FEET_GAP;
    st.h = h;
    glow.position.set(st.cx, st.cy - st.R * 1.1, st.R * 3);
    placeModel();
  }

  function pose(t: number, tl: number) {
    const model = st.model!;
    const reduced = opts.isReduced();
    const m = reduced ? 0 : 1;
    const nudgeT = t - st.nudgeAt;
    const nudge = nudgeT >= 0 && nudgeT < 2.2 ? Math.sin((nudgeT / 2.2) * Math.PI) : 0;
    const pokeT = t - opts.pokedAt();
    const poke = pokeT >= 0 && pokeT < 1.2 ? Math.sin((pokeT / 1.2) * Math.PI) : 0;

    // Entrance: drop in from above the screen and catch the rim.
    const fall = reduced ? 1 : clamp01(tl / FALL_TIME);
    const since = Math.max(0, tl - FALL_TIME);
    const settle = Math.exp(-since / 1.6);
    const amp = reduced ? 0 : SWING_AMP + (SWING_START - SWING_AMP) * settle;
    const ph = ((Math.PI * 2) / SWING_PERIOD) * since;
    const swing = amp * Math.sin(ph);
    const jolt = reduced || fall < 1 ? 0 : -0.05 * st.s * Math.exp(-since * 5) * Math.sin(since * 22);
    const fallY = (1 - fall * fall) * (st.h * 0.8);

    pivot.position.set(st.grip.x, st.grip.y + fallY + jolt, st.grip.z);
    pivot.rotation.set(0, 0, st.lean + swing);
    model.position.copy(st.offset);
    model.rotation.set(0, -Math.PI / 2 + 0.08 * Math.sin(ph * 0.5 + 0.6) * m, 0);
    resetPose();
    pivot.updateMatrixWorld(true);
    bodyPose(t, m, ph, amp, st.lean + swing);
    pivot.updateMatrixWorld(true);
    const hang = st.hang!;
    if (fall >= 1) {
      hangArm(hang);
    } else {
      // Still falling: reach straight up for the rim.
      hang.upper.getWorldPosition(_S);
      _T.set(st.grip.x, st.grip.y + fallY + 0.4 * st.s, st.grip.z);
      _d1.subVectors(_T, _S);
      point(hang.upper, hang.fore, _d1);
      point(hang.fore, hang.hand, _d1);
    }
    freeArm(st.free!, t, ph, amp, nudge * m);

    setMorph("Smile", 0.35 + 0.1 * Math.sin(t * 0.9) * m + 0.55 * Math.max(nudge, poke));
    setMorph("BrowRaise", 0.7 * Math.max(nudge, poke * 0.6, fall < 1 ? 1 : settle * 0.8));
    setMorph("Squint", 0.15 * Math.max(nudge, poke));

    const pulse = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 2.4 - Math.PI / 2);
    glow.intensity = (0.8 + 0.8 * pulse * m + 1.2 * nudge) * fall;

    if (!st.caught && fall >= 1) {
      st.caught = true;
      if (!reduced) opts.onCaught();
    }
  }

  let raf = 0;
  let stopped = false;
  function frame(now: number) {
    raf = 0;
    if (stopped) return;
    const t = now / 1000;
    const reduced = opts.isReduced();
    if (st.model) {
      if (!reduced && st.caught && t > st.nextNudge) {
        st.nudgeAt = t;
        st.nextNudge = t + 8 + Math.random() * 4;
        opts.onNudge();
      }
      pose(t, t - st.loadedAt);
    }
    renderer.render(scene, camera);
    if (!reduced && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const kick = () => {
    if (!raf && !stopped) raf = requestAnimationFrame(frame);
  };
  const relayout = () => {
    layout();
    kick();
  };

  const resize = new ResizeObserver(relayout);
  resize.observe(canvas);
  window.addEventListener("scroll", relayout, { passive: true });
  document.addEventListener("visibilitychange", kick);
  void document.fonts?.ready.then(relayout);

  let gltfScene: THREE.Object3D | null = null;
  new GLTFLoader().load(
    opts.modelUrl,
    (gltf) => {
      if (stopped) return;
      const model = gltf.scene;
      gltfScene = model;
      model.traverse((o) => {
        if ((o as THREE.Bone).isBone) {
          const bone = o as THREE.Bone;
          st.bones[bone.name] = bone;
          st.rest.set(bone, { q: bone.quaternion.clone(), p: bone.position.clone() });
        }
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.frustumCulled = false;
          if (mesh.morphTargetDictionary) st.mesh = mesh;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat && "envMapIntensity" in mat) mat.envMapIntensity = 0.8;
        }
      });
      const B = st.bones;
      const arm = (name: "Left" | "Right", lateral: number): Arm | null =>
        B[`${name}UpperArm`] && B[`${name}Forearm`] && B[`${name}Hand`]
          ? { upper: B[`${name}UpperArm`], fore: B[`${name}Forearm`], hand: B[`${name}Hand`], collar: B[`${name}Collar`], lateral, side: lateral }
          : null;
      // The character's right hand grips the rim; the left one is free to wave.
      st.hang = arm("Right", 1);
      st.free = arm("Left", -1);
      if (!st.hang || !st.free) {
        opts.onFailed();
        return;
      }
      pivot.add(model);
      st.model = model;
      layout();
      st.loadedAt = performance.now() / 1000;
      st.nextNudge = st.loadedAt + 4;
      opts.onLoaded();
      kick();
    },
    undefined,
    () => {
      if (!stopped) opts.onFailed();
    },
  );

  relayout();

  return {
    kick,
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      resize.disconnect();
      window.removeEventListener("scroll", relayout);
      document.removeEventListener("visibilitychange", kick);
      gltfScene?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          for (const value of Object.values(mat)) if (value instanceof THREE.Texture) value.dispose();
          mat.dispose();
        }
      });
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}
