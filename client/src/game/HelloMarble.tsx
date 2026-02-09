import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { createTrack } from "./track/createTrack";
import {
  calibrateCurrent,
  isTiltSupported,
  makeTiltFilter,
  requestTiltPermissionIfNeeded,
  startTiltListener,
  type TiltSample,
  type TiltState,
} from "./input/tilt";
import { DebugDrawer, type DebugTabId } from "../ui/DebugDrawer";
import { NetDebugPanel } from "../ui/NetDebugPanel";

type MarbleDebug = {
  fps: number;
  posX: number;
  posY: number;
  posZ: number;
  speed: number;
  rawTiltX: number;
  rawTiltZ: number;
  tiltX: number;
  tiltZ: number;
  gravX: number;
  gravY: number;
  gravZ: number;
};

type CameraPresetId =
  | "chaseCentered"
  | "chaseRight"
  | "chaseLeft"
  | "isoStandard"
  | "isoFlatter"
  | "topdownPure"
  | "topdownForward"
  | "broadcast";

type TuningState = {
  gravityG: number;
  tiltStrength: number;
  maxSpeed: number;
  maxTiltDeg: number;
  maxBoardAngVel: number;
  linearDamping: number;
  angularDamping: number;
  cameraPreset: CameraPresetId;
  invertTiltX: boolean;
  invertTiltZ: boolean;
  invertCameraSide: boolean;
  enableExtraDownforce: boolean;
  extraDownForce: number;
};

const TIMESTEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;
const LOOK_HEIGHT = 1.2;
const LOOK_AHEAD = 16;
const TOPDOWN_HEIGHT = 16;
const TOPDOWN_Z_OFFSET = 2;
const BOARD_TILT_SMOOTH = 12;
const PIVOT_SMOOTH = 10;
const TUNING_STORAGE_KEY = "get-tilted:v0.3.7:tuning";
const LEGACY_TUNING_STORAGE_KEY = "get-tilted:v0.3.6:tuning";

const DEFAULT_TUNING: TuningState = {
  gravityG: 14,
  tiltStrength: 1,
  maxSpeed: 10,
  maxTiltDeg: 14,
  maxBoardAngVel: 4,
  linearDamping: 0.18,
  angularDamping: 0.18,
  cameraPreset: "chaseCentered",
  invertTiltX: false,
  invertTiltZ: false,
  invertCameraSide: false,
  enableExtraDownforce: false,
  extraDownForce: 4,
};

const CAMERA_PRESETS: CameraPresetId[] = [
  "chaseCentered",
  "chaseRight",
  "chaseLeft",
  "isoStandard",
  "isoFlatter",
  "topdownPure",
  "topdownForward",
  "broadcast",
];

const DRAWER_TABS: { id: DebugTabId; label: string }[] = [
  { id: "tuning", label: "Tuning" },
  { id: "camera", label: "Camera" },
  { id: "network", label: "Network" },
  { id: "diagnostics", label: "Diagnostics" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isCameraPresetId(value: unknown): value is CameraPresetId {
  return typeof value === "string" && CAMERA_PRESETS.includes(value as CameraPresetId);
}

function sanitizeTuning(input: unknown): TuningState {
  const base = { ...DEFAULT_TUNING };
  if (!input || typeof input !== "object") {
    return base;
  }

  const value = input as Partial<TuningState>;

  if (typeof value.gravityG === "number") base.gravityG = clamp(value.gravityG, 8, 24);
  if (typeof value.tiltStrength === "number") {
    base.tiltStrength = clamp(value.tiltStrength, 0.5, 2);
  }
  if (typeof value.maxSpeed === "number") base.maxSpeed = clamp(value.maxSpeed, 4, 20);
  if (typeof value.maxTiltDeg === "number") {
    base.maxTiltDeg = clamp(value.maxTiltDeg, 6, 25);
  }
  if (typeof value.maxBoardAngVel === "number") {
    base.maxBoardAngVel = clamp(value.maxBoardAngVel, 1, 10);
  }
  if (typeof value.linearDamping === "number") {
    base.linearDamping = clamp(value.linearDamping, 0, 0.5);
  }
  if (typeof value.angularDamping === "number") {
    base.angularDamping = clamp(value.angularDamping, 0, 0.5);
  }
  if (isCameraPresetId(value.cameraPreset)) {
    base.cameraPreset = value.cameraPreset;
  }
  if (typeof value.invertTiltX === "boolean") base.invertTiltX = value.invertTiltX;
  if (typeof value.invertTiltZ === "boolean") base.invertTiltZ = value.invertTiltZ;
  if (typeof value.invertCameraSide === "boolean") {
    base.invertCameraSide = value.invertCameraSide;
  }
  if (typeof value.enableExtraDownforce === "boolean") {
    base.enableExtraDownforce = value.enableExtraDownforce;
  }
  if (typeof value.extraDownForce === "number") {
    base.extraDownForce = clamp(value.extraDownForce, 0, 12);
  }

  return base;
}

function loadTuning(): TuningState {
  if (typeof window === "undefined") {
    return { ...DEFAULT_TUNING };
  }

  const read = (key: string) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const next = read(TUNING_STORAGE_KEY);
  if (next) {
    return sanitizeTuning(next);
  }

  const legacy = read(LEGACY_TUNING_STORAGE_KEY);
  if (legacy) {
    return sanitizeTuning(legacy);
  }

  return { ...DEFAULT_TUNING };
}

function getCameraLabel(id: CameraPresetId): string {
  switch (id) {
    case "chaseCentered":
      return "Chase Centered";
    case "chaseRight":
      return "Chase Off-Right";
    case "chaseLeft":
      return "Chase Off-Left";
    case "isoStandard":
      return "Isometric Standard";
    case "isoFlatter":
      return "Isometric Flatter";
    case "topdownPure":
      return "Top-down Pure";
    case "topdownForward":
      return "Top-down Forward";
    case "broadcast":
      return "Broadcast";
    default:
      return "Unknown";
  }
}

export function HelloMarble() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const resetRef = useRef<() => void>(() => {});
  const enableTiltRef = useRef<() => Promise<void>>(async () => {});
  const calibrateTiltRef = useRef<() => void>(() => {});

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 700px)").matches
      : false,
  );
  const [drawerOpen, setDrawerOpen] = useState(() =>
    typeof window !== "undefined"
      ? !window.matchMedia("(max-width: 700px)").matches
      : true,
  );
  const [activeDebugTab, setActiveDebugTab] = useState<DebugTabId>("tuning");

  const [respawnCount, setRespawnCount] = useState(0);
  const [tiltStatus, setTiltStatus] = useState<TiltState>({
    enabled: false,
    supported: isTiltSupported(),
    permission: "unknown",
  });
  const [statusMessage, setStatusMessage] = useState(
    "Tilt disabled. Using fallback controls.",
  );
  const [touchTilt, setTouchTilt] = useState({ x: 0, z: 0 });
  const [tuning, setTuning] = useState<TuningState>(() => loadTuning());
  const [importJsonText, setImportJsonText] = useState("");
  const [importError, setImportError] = useState("");
  const [debug, setDebug] = useState<MarbleDebug>({
    fps: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    speed: 0,
    rawTiltX: 0,
    rawTiltZ: 0,
    tiltX: 0,
    tiltZ: 0,
    gravX: 0,
    gravY: -DEFAULT_TUNING.gravityG,
    gravZ: 0,
  });

  const tiltStatusRef = useRef(tiltStatus);
  const touchTiltRef = useRef(touchTilt);
  const tuningRef = useRef(tuning);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const apply = (matches: boolean) => {
      setIsMobile(matches);
      setDrawerOpen(!matches);
    };
    apply(media.matches);
    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    tiltStatusRef.current = tiltStatus;
  }, [tiltStatus]);

  useEffect(() => {
    touchTiltRef.current = touchTilt;
  }, [touchTilt]);

  useEffect(() => {
    tuningRef.current = tuning;
    window.localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(tuning));
  }, [tuning]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1320);

    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 240);
    camera.position.set(0, 7.5, 0);
    camera.lookAt(0, LOOK_HEIGHT, LOOK_AHEAD);
    camera.up.set(0, 1, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(6, 8, 5);
    scene.add(directionalLight);

    const track = createTrack();
    scene.add(track.group);

    const boardBody = track.bodies[0];
    if (!boardBody) {
      throw new Error("Track did not provide board physics body");
    }

    const world = new CANNON.World();
    world.gravity.set(0, -tuningRef.current.gravityG, 0);
    world.addBody(boardBody);

    const boardMat = new CANNON.Material("board");
    const marbleMat = new CANNON.Material("marble");
    boardBody.material = boardMat;

    const contactMat = new CANNON.ContactMaterial(marbleMat, boardMat, {
      friction: 0.85,
      restitution: 0.0,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e8,
      frictionEquationRelaxation: 3,
    });
    world.addContactMaterial(contactMat);

    const marbleRadius = 0.5;
    const marbleBody = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(marbleRadius),
      position: track.spawn.clone(),
      linearDamping: tuningRef.current.linearDamping,
      angularDamping: tuningRef.current.angularDamping,
      material: marbleMat,
    });
    world.addBody(marbleBody);

    const marbleMesh = new THREE.Mesh(
      new THREE.SphereGeometry(marbleRadius, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0x4fc3f7 }),
    );
    scene.add(marbleMesh);

    const pressedKeys = new Set<string>();
    const cameraTarget = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();
    const visualTiltTargetEuler = new THREE.Euler(0, 0, 0, "XYZ");
    const visualTiltTargetQuat = new THREE.Quaternion();
    const extraDownForceVec = new CANNON.Vec3();
    const rawPivot = new CANNON.Vec3();
    const pivotSmoothed = new CANNON.Vec3(0, 0, 0);
    const rotatedPivot = new CANNON.Vec3();
    const boardPosition = new CANNON.Vec3();
    const qFinalCannon = new CANNON.Quaternion();

    const motionTiltRef: { current: TiltSample } = {
      current: { x: 0, y: 0, z: 0 },
    };
    let stopTiltListener: (() => void) | null = null;
    const filter = makeTiltFilter({ tau: 0.1 });
    let currentPitch = 0;
    let currentRoll = 0;

    const computeSpawnWorld = (): CANNON.Vec3 => {
      const spawn = track.spawn;
      const q = boardBody.quaternion;

      const x2 = q.x + q.x;
      const y2 = q.y + q.y;
      const z2 = q.z + q.z;
      const xx = q.x * x2;
      const xy = q.x * y2;
      const xz = q.x * z2;
      const yy = q.y * y2;
      const yz = q.y * z2;
      const zz = q.z * z2;
      const wx = q.w * x2;
      const wy = q.w * y2;
      const wz = q.w * z2;

      const rx =
        (1 - (yy + zz)) * spawn.x +
        (xy - wz) * spawn.y +
        (xz + wy) * spawn.z;
      const ry =
        (xy + wz) * spawn.x +
        (1 - (xx + zz)) * spawn.y +
        (yz - wx) * spawn.z;
      const rz =
        (xz - wy) * spawn.x +
        (yz + wx) * spawn.y +
        (1 - (xx + yy)) * spawn.z;

      return new CANNON.Vec3(
        boardBody.position.x + rx,
        boardBody.position.y + ry,
        boardBody.position.z + rz,
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "w" ||
        event.key === "a" ||
        event.key === "s" ||
        event.key === "d" ||
        event.key === "W" ||
        event.key === "A" ||
        event.key === "S" ||
        event.key === "D"
      ) {
        event.preventDefault();
        pressedKeys.add(event.key);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.key);
    };

    window.addEventListener("keydown", handleKeyDown, { passive: false });
    window.addEventListener("keyup", handleKeyUp);

    const respawnMarble = (incrementCounter: boolean) => {
      marbleBody.position.copy(computeSpawnWorld());
      marbleBody.quaternion.set(0, 0, 0, 1);
      marbleBody.velocity.set(0, 0, 0);
      marbleBody.angularVelocity.set(0, 0, 0);
      if (incrementCounter) {
        setRespawnCount((count) => count + 1);
      }
    };
    resetRef.current = () => respawnMarble(false);

    const getKeyboardIntent = (): TiltSample => {
      let x = 0;
      let z = 0;
      if (
        pressedKeys.has("ArrowUp") ||
        pressedKeys.has("w") ||
        pressedKeys.has("W")
      ) {
        z -= 1;
      }
      if (
        pressedKeys.has("ArrowDown") ||
        pressedKeys.has("s") ||
        pressedKeys.has("S")
      ) {
        z += 1;
      }
      if (
        pressedKeys.has("ArrowLeft") ||
        pressedKeys.has("a") ||
        pressedKeys.has("A")
      ) {
        x -= 1;
      }
      if (
        pressedKeys.has("ArrowRight") ||
        pressedKeys.has("d") ||
        pressedKeys.has("D")
      ) {
        x += 1;
      }
      return { x, y: 0, z };
    };

    enableTiltRef.current = async () => {
      if (!tiltStatusRef.current.supported) {
        setTiltStatus((prev) => ({
          ...prev,
          enabled: false,
          permission: "denied",
        }));
        setStatusMessage("Motion sensors are unavailable. Using fallback controls.");
        return;
      }

      const permission = await requestTiltPermissionIfNeeded();

      if (permission === "denied") {
        setTiltStatus((prev) => ({
          ...prev,
          enabled: false,
          permission: "denied",
        }));
        setStatusMessage("Tilt permission denied. Using fallback controls.");
        return;
      }

      if (!stopTiltListener) {
        stopTiltListener = startTiltListener((sample) => {
          motionTiltRef.current = sample;
        });
      }

      setTiltStatus((prev) => ({
        ...prev,
        enabled: true,
        permission: "granted",
      }));
      setStatusMessage("Tilt controls enabled.");
    };

    calibrateTiltRef.current = () => {
      calibrateCurrent(motionTiltRef.current);
      filter.reset({ x: 0, y: 0, z: 0 });
      setStatusMessage("Tilt calibrated.");
    };

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();
    window.addEventListener("resize", resize);

    let animationFrame = 0;
    let lastTime = performance.now() / 1000;
    let accumulator = 0;
    let debugTimer = 0;

    const tick = (nowMs: number) => {
      const now = nowMs / 1000;
      const delta = Math.min(now - lastTime, MAX_FRAME_DELTA);
      lastTime = now;
      accumulator += delta;
      debugTimer += delta;

      const currentTuning = tuningRef.current;
      world.gravity.set(0, -currentTuning.gravityG, 0);
      marbleBody.linearDamping = currentTuning.linearDamping;
      marbleBody.angularDamping = currentTuning.angularDamping;

      let sourceIntent: TiltSample;
      const status = tiltStatusRef.current;
      const touchIntent = touchTiltRef.current;

      if (status.enabled && status.permission === "granted" && status.supported) {
        sourceIntent = motionTiltRef.current;
      } else if (!status.supported || status.permission === "denied") {
        sourceIntent = { x: touchIntent.x, y: 0, z: touchIntent.z };
      } else {
        sourceIntent = getKeyboardIntent();
      }

      const intentX = currentTuning.invertTiltX ? -sourceIntent.x : sourceIntent.x;
      const intentZ = currentTuning.invertTiltZ ? -sourceIntent.z : sourceIntent.z;
      const normalizedIntent: TiltSample = {
        x: clamp(intentX, -1, 1),
        y: 0,
        z: clamp(intentZ, -1, 1),
      };

      const filteredIntent = filter.push(normalizedIntent, delta);
      const maxTiltRad = (currentTuning.maxTiltDeg * Math.PI) / 180;

      const desiredPitch =
        filteredIntent.z * currentTuning.tiltStrength * maxTiltRad;
      const desiredRoll =
        -filteredIntent.x * currentTuning.tiltStrength * maxTiltRad;
      const maxStep = currentTuning.maxBoardAngVel * delta;
      currentPitch += clamp(desiredPitch - currentPitch, -maxStep, maxStep);
      currentRoll += clamp(desiredRoll - currentRoll, -maxStep, maxStep);

      visualTiltTargetEuler.set(currentPitch, 0, currentRoll);
      visualTiltTargetQuat.setFromEuler(visualTiltTargetEuler);
      const boardTiltAlpha = 1 - Math.exp(-BOARD_TILT_SMOOTH * delta);
      track.group.quaternion.slerp(visualTiltTargetQuat, boardTiltAlpha);

      rawPivot.set(marbleBody.position.x, 0, marbleBody.position.z);
      const pivotAlpha = 1 - Math.exp(-PIVOT_SMOOTH * delta);
      pivotSmoothed.x += (rawPivot.x - pivotSmoothed.x) * pivotAlpha;
      pivotSmoothed.y += (rawPivot.y - pivotSmoothed.y) * pivotAlpha;
      pivotSmoothed.z += (rawPivot.z - pivotSmoothed.z) * pivotAlpha;

      qFinalCannon.set(
        track.group.quaternion.x,
        track.group.quaternion.y,
        track.group.quaternion.z,
        track.group.quaternion.w,
      );
      qFinalCannon.vmult(pivotSmoothed, rotatedPivot);

      boardPosition.set(
        pivotSmoothed.x - rotatedPivot.x,
        pivotSmoothed.y - rotatedPivot.y,
        pivotSmoothed.z - rotatedPivot.z,
      );

      boardBody.quaternion.copy(qFinalCannon);
      boardBody.position.copy(boardPosition);
      boardBody.aabbNeedsUpdate = true;
      boardBody.updateAABB();
      track.group.position.set(boardPosition.x, boardPosition.y, boardPosition.z);

      if (currentTuning.enableExtraDownforce) {
        extraDownForceVec.set(0, -currentTuning.extraDownForce, 0);
        marbleBody.applyForce(extraDownForceVec, marbleBody.position);
      }

      while (accumulator >= TIMESTEP) {
        world.step(TIMESTEP);
        accumulator -= TIMESTEP;
      }

      const speed = marbleBody.velocity.length();
      if (speed > currentTuning.maxSpeed && speed > 0) {
        const scale = currentTuning.maxSpeed / speed;
        marbleBody.velocity.scale(scale, marbleBody.velocity);
      }

      if (marbleBody.position.y < track.respawnY) {
        respawnMarble(true);
      }

      marbleMesh.position.set(
        marbleBody.position.x,
        marbleBody.position.y,
        marbleBody.position.z,
      );
      marbleMesh.quaternion.set(
        marbleBody.quaternion.x,
        marbleBody.quaternion.y,
        marbleBody.quaternion.z,
        marbleBody.quaternion.w,
      );

      const cameraAlpha = 1 - Math.exp(-8 * delta);
      const sideSign = currentTuning.invertCameraSide ? -1 : 1;
      switch (currentTuning.cameraPreset) {
        case "chaseCentered": {
          cameraTarget.set(0, 7.5, marbleBody.position.z - 10);
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.x = 0;
          camera.position.y = 7.5;
          lookTarget.set(0, LOOK_HEIGHT, marbleBody.position.z + LOOK_AHEAD);
          break;
        }
        case "chaseRight": {
          const side = 4 * sideSign;
          cameraTarget.set(side, 7.5, marbleBody.position.z - 10);
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 7.5;
          lookTarget.set(side, LOOK_HEIGHT, marbleBody.position.z + LOOK_AHEAD);
          break;
        }
        case "chaseLeft": {
          const side = -4 * sideSign;
          cameraTarget.set(side, 7.5, marbleBody.position.z - 10);
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 7.5;
          lookTarget.set(side, LOOK_HEIGHT, marbleBody.position.z + LOOK_AHEAD);
          break;
        }
        case "isoStandard": {
          cameraTarget.set(
            marbleBody.position.x + 4 * sideSign,
            14,
            marbleBody.position.z - 8,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 14;
          lookTarget.set(marbleBody.position.x, 0, marbleBody.position.z + LOOK_AHEAD);
          break;
        }
        case "isoFlatter": {
          cameraTarget.set(
            marbleBody.position.x + 4 * sideSign,
            11,
            marbleBody.position.z - 10,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 11;
          lookTarget.set(
            marbleBody.position.x,
            0,
            marbleBody.position.z + LOOK_AHEAD + 4,
          );
          break;
        }
        case "topdownPure": {
          cameraTarget.set(
            marbleBody.position.x,
            TOPDOWN_HEIGHT,
            marbleBody.position.z - TOPDOWN_Z_OFFSET,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = TOPDOWN_HEIGHT;
          lookTarget.set(marbleBody.position.x, 0, marbleBody.position.z);
          break;
        }
        case "topdownForward": {
          cameraTarget.set(
            marbleBody.position.x,
            TOPDOWN_HEIGHT,
            marbleBody.position.z - TOPDOWN_Z_OFFSET,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = TOPDOWN_HEIGHT;
          lookTarget.set(marbleBody.position.x, 0, marbleBody.position.z + 6);
          break;
        }
        case "broadcast": {
          cameraTarget.set(
            marbleBody.position.x + 6 * sideSign,
            18,
            marbleBody.position.z - 12,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 18;
          lookTarget.set(
            marbleBody.position.x + sideSign,
            0,
            marbleBody.position.z + LOOK_AHEAD,
          );
          break;
        }
      }

      camera.lookAt(lookTarget);

      renderer.render(scene, camera);

      if (debugTimer >= 0.1) {
        setDebug((prev) => ({
          ...prev,
          fps: Math.round(1 / Math.max(delta, 0.0001)),
          posX: marbleBody.position.x,
          posY: marbleBody.position.y,
          posZ: marbleBody.position.z,
          speed: marbleBody.velocity.length(),
          rawTiltX: normalizedIntent.x,
          rawTiltZ: normalizedIntent.z,
          tiltX: filteredIntent.x,
          tiltZ: filteredIntent.z,
          gravX: world.gravity.x,
          gravY: world.gravity.y,
          gravZ: world.gravity.z,
        }));
        debugTimer = 0;
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("resize", resize);
      stopTiltListener?.();
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      scene.remove(track.group);
      for (const child of track.group.children) {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            for (const material of child.material) {
              material.dispose();
            }
          } else {
            child.material.dispose();
          }
        }
      }
      for (const body of track.bodies) {
        world.removeBody(body);
      }
      world.removeBody(marbleBody);
      marbleMesh.geometry.dispose();
      (marbleMesh.material as THREE.Material).dispose();
    };
  }, []);

  const showTouchFallback =
    !tiltStatus.supported || tiltStatus.permission === "denied";

  const updateTuning = <K extends keyof TuningState>(
    key: K,
    value: TuningState[K],
  ) => {
    setTuning((prev) => ({ ...prev, [key]: value }));
  };

  const copySettings = async () => {
    const payload = JSON.stringify(tuning, null, 2);
    setImportJsonText(payload);
    if (!navigator.clipboard) {
      setImportError("Clipboard API unavailable. Copy from the text area.");
      return;
    }
    await navigator.clipboard.writeText(payload);
    setImportError("");
    setStatusMessage("Settings copied to clipboard.");
  };

  const applyImportedSettings = () => {
    try {
      const parsed = JSON.parse(importJsonText);
      const next = sanitizeTuning(parsed);
      setTuning(next);
      setImportError("");
      setStatusMessage("Imported tuning settings.");
    } catch {
      setImportError("Invalid JSON. Check syntax and try again.");
    }
  };

  return (
    <div className="appShell">
      <div className="viewport" ref={mountRef} />
      <DebugDrawer
        open={drawerOpen}
        onToggle={() => setDrawerOpen((open) => !open)}
        activeTab={activeDebugTab}
        onTabChange={setActiveDebugTab}
        tabs={DRAWER_TABS}
      >
        {activeDebugTab === "tuning" ? (
          <div className="debugSection">
            <p className="tiltMessage">{statusMessage}</p>
            <label className="controlLabel">
              Max Speed
              <div className="controlRow">
                <input
                  type="range"
                  min={4}
                  max={20}
                  step={0.1}
                  value={tuning.maxSpeed}
                  onChange={(event) =>
                    updateTuning("maxSpeed", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.1}
                  value={tuning.maxSpeed}
                  onChange={(event) =>
                    updateTuning("maxSpeed", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              Tilt Strength
              <div className="controlRow">
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.01}
                  value={tuning.tiltStrength}
                  onChange={(event) =>
                    updateTuning("tiltStrength", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.01}
                  value={tuning.tiltStrength}
                  onChange={(event) =>
                    updateTuning("tiltStrength", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              Gravity G
              <div className="controlRow">
                <input
                  type="range"
                  min={8}
                  max={24}
                  step={0.1}
                  value={tuning.gravityG}
                  onChange={(event) =>
                    updateTuning("gravityG", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.1}
                  value={tuning.gravityG}
                  onChange={(event) =>
                    updateTuning("gravityG", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              Max Tilt Deg
              <div className="controlRow">
                <input
                  type="range"
                  min={6}
                  max={25}
                  step={0.1}
                  value={tuning.maxTiltDeg}
                  onChange={(event) =>
                    updateTuning("maxTiltDeg", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.1}
                  value={tuning.maxTiltDeg}
                  onChange={(event) =>
                    updateTuning("maxTiltDeg", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              Max Board Angular Velocity
              <div className="controlRow">
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={0.1}
                  value={tuning.maxBoardAngVel}
                  onChange={(event) =>
                    updateTuning("maxBoardAngVel", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.1}
                  value={tuning.maxBoardAngVel}
                  onChange={(event) =>
                    updateTuning("maxBoardAngVel", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              Linear Damping
              <div className="controlRow">
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={tuning.linearDamping}
                  onChange={(event) =>
                    updateTuning("linearDamping", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.01}
                  value={tuning.linearDamping}
                  onChange={(event) =>
                    updateTuning("linearDamping", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              Angular Damping
              <div className="controlRow">
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={tuning.angularDamping}
                  onChange={(event) =>
                    updateTuning("angularDamping", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.01}
                  value={tuning.angularDamping}
                  onChange={(event) =>
                    updateTuning("angularDamping", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlCheck">
              <input
                type="checkbox"
                checked={tuning.enableExtraDownforce}
                onChange={(event) =>
                  updateTuning("enableExtraDownforce", event.target.checked)
                }
              />
              Enable Extra Downforce
            </label>
            <label className="controlLabel">
              Extra Downforce
              <div className="controlRow">
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={0.1}
                  value={tuning.extraDownForce}
                  onChange={(event) =>
                    updateTuning("extraDownForce", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.1}
                  value={tuning.extraDownForce}
                  onChange={(event) =>
                    updateTuning("extraDownForce", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <div className="debugButtonRow">
              <button type="button" onClick={() => setTuning({ ...DEFAULT_TUNING })}>
                Reset Defaults
              </button>
              <button type="button" onClick={() => void copySettings()}>
                Copy JSON
              </button>
            </div>
            <label className="controlLabel" htmlFor="importJson">
              Import JSON
            </label>
            <textarea
              id="importJson"
              className="importBox"
              value={importJsonText}
              onChange={(event) => setImportJsonText(event.target.value)}
              placeholder="Paste settings JSON and tap Apply"
            />
            <div className="debugButtonRow">
              <button type="button" onClick={applyImportedSettings}>
                Apply Imported Settings
              </button>
            </div>
            {importError ? <p className="errorText">{importError}</p> : null}
          </div>
        ) : null}

        {activeDebugTab === "camera" ? (
          <div className="debugSection">
            <p className="tiltStatus">
              Tilt state: {tiltStatus.enabled ? "enabled" : "disabled"} | permission:{" "}
              {tiltStatus.permission} | mobile: {isMobile ? "yes" : "no"}
            </p>
            <label className="controlLabel">
              Camera Preset
              <select
                value={tuning.cameraPreset}
                onChange={(event) =>
                  updateTuning("cameraPreset", event.target.value as CameraPresetId)
                }
              >
                {CAMERA_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {getCameraLabel(preset)}
                  </option>
                ))}
              </select>
            </label>
            <label className="controlCheck">
              <input
                type="checkbox"
                checked={tuning.invertTiltX}
                onChange={(event) =>
                  updateTuning("invertTiltX", event.target.checked)
                }
              />
              Invert Tilt X (Left/Right)
            </label>
            <label className="controlCheck">
              <input
                type="checkbox"
                checked={tuning.invertTiltZ}
                onChange={(event) =>
                  updateTuning("invertTiltZ", event.target.checked)
                }
              />
              Invert Tilt Z (Forward/Back)
            </label>
            <label className="controlCheck">
              <input
                type="checkbox"
                checked={tuning.invertCameraSide}
                onChange={(event) =>
                  updateTuning("invertCameraSide", event.target.checked)
                }
              />
              Invert Camera Side Offset
            </label>
            <div className="debugButtonRow">
              <button type="button" onClick={() => void enableTiltRef.current()}>
                Enable Tilt Controls
              </button>
              <button type="button" onClick={() => calibrateTiltRef.current()}>
                Calibrate
              </button>
            </div>
            {showTouchFallback ? (
              <div className="tiltFallback">
                <p>Touch fallback</p>
                <label htmlFor="tiltX">Horizontal</label>
                <input
                  id="tiltX"
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={touchTilt.x}
                  onChange={(event) => {
                    const x = Number(event.target.value);
                    setTouchTilt((prev) => {
                      const next = { ...prev, x };
                      touchTiltRef.current = next;
                      return next;
                    });
                  }}
                  onPointerUp={() => {
                    setTouchTilt((prev) => {
                      const next = { ...prev, x: 0 };
                      touchTiltRef.current = next;
                      return next;
                    });
                  }}
                />
                <label htmlFor="tiltZ">Vertical</label>
                <input
                  id="tiltZ"
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={touchTilt.z}
                  onChange={(event) => {
                    const z = Number(event.target.value);
                    setTouchTilt((prev) => {
                      const next = { ...prev, z };
                      touchTiltRef.current = next;
                      return next;
                    });
                  }}
                  onPointerUp={() => {
                    setTouchTilt((prev) => {
                      const next = { ...prev, z: 0 };
                      touchTiltRef.current = next;
                      return next;
                    });
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {activeDebugTab === "network" ? (
          <div className="debugSection">
            <NetDebugPanel variant="embedded" />
          </div>
        ) : null}

        {activeDebugTab === "diagnostics" ? (
          <div className="debugSection">
            <p>FPS: {debug.fps}</p>
            <p>
              Marble: {debug.posX.toFixed(2)}, {debug.posY.toFixed(2)}, {debug.posZ.toFixed(2)}
            </p>
            <p>Speed: {debug.speed.toFixed(2)}</p>
            <p>Respawns: {respawnCount}</p>
            <p>
              Raw Tilt: {debug.rawTiltX.toFixed(2)}, {debug.rawTiltZ.toFixed(2)}
            </p>
            <p>
              Filtered Tilt: {debug.tiltX.toFixed(2)}, {debug.tiltZ.toFixed(2)}
            </p>
            <div className="tiltIndicatorWrap">
              <p>Tilt Indicator</p>
              <div className="tiltIndicator tiltIndicatorLarge">
                <span className="tiltCrosshair tiltCrosshairX" />
                <span className="tiltCrosshair tiltCrosshairY" />
                <span
                  className="tiltDot"
                  style={{
                    left: `${50 + clamp(debug.tiltX, -1, 1) * 40}%`,
                    top: `${50 + clamp(debug.tiltZ, -1, 1) * 40}%`,
                  }}
                />
              </div>
            </div>
            <p>
              Gravity: {debug.gravX.toFixed(2)}, {debug.gravY.toFixed(2)}, {debug.gravZ.toFixed(2)}
            </p>
            <div className="debugButtonRow">
              <button type="button" onClick={() => resetRef.current()}>
                Reset Marble
              </button>
            </div>
          </div>
        ) : null}
      </DebugDrawer>
    </div>
  );
}
