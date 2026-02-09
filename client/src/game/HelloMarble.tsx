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
import { RaceClient } from "../net/raceClient";
import type { TypedMessage } from "@get-tilted/shared-protocol";
import {
  resolveDefaultWsUrl,
  resolveWsUrlForHost,
  type WSStatus,
} from "../net/wsClient";

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

type PhysicsPresetId = "marble" | "floaty" | "heavy";

type TuningState = {
  physicsPreset: PhysicsPresetId;
  gravityG: number;
  tiltStrength: number;
  gyroSensitivity: number;
  maxSpeed: number;
  maxTiltDeg: number;
  maxBoardAngVel: number;
  tiltFilterTau: number;
  linearDamping: number;
  angularDamping: number;
  cameraPreset: CameraPresetId;
  bounce: number;
  contactFriction: number;
  contactRestitution: number;
  invertTiltX: boolean;
  invertTiltZ: boolean;
  invertCameraSide: boolean;
  enableExtraDownforce: boolean;
  extraDownForce: number;
  renderScaleMobile: number;
  debugUpdateHzMobile: number;
};

type TrialState = "idle" | "running" | "finished";

type GhostSnapshot = {
  t: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
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
const BEST_TIME_STORAGE_KEY = "get-tilted:v0.3.8:best-time";
const DEV_JOIN_HOST_KEY = "get-tilted:v0.3.10.2:join-host";

const DEFAULT_TUNING: TuningState = {
  physicsPreset: "marble",
  gravityG: 21.9,
  tiltStrength: 1.56,
  gyroSensitivity: 1.35,
  maxSpeed: 20,
  maxTiltDeg: 14,
  maxBoardAngVel: 8.7,
  tiltFilterTau: 0.1,
  linearDamping: 0.02,
  angularDamping: 0.04,
  cameraPreset: "chaseRight",
  bounce: 0.1,
  contactFriction: 0.88,
  contactRestitution: 0.1,
  invertTiltX: false,
  invertTiltZ: false,
  invertCameraSide: false,
  enableExtraDownforce: false,
  extraDownForce: 2.4,
  renderScaleMobile: 1.2,
  debugUpdateHzMobile: 5,
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

const PHYSICS_PRESETS: Record<
  PhysicsPresetId,
  Pick<
    TuningState,
    | "gravityG"
    | "linearDamping"
    | "angularDamping"
    | "bounce"
    | "gyroSensitivity"
    | "contactFriction"
    | "contactRestitution"
    | "maxBoardAngVel"
    | "tiltFilterTau"
    | "renderScaleMobile"
    | "debugUpdateHzMobile"
  >
> = {
  marble: {
    gravityG: 18,
    linearDamping: 0.08,
    angularDamping: 0.08,
    bounce: 0.1,
    gyroSensitivity: 1.35,
    contactFriction: 0.88,
    contactRestitution: 0.1,
    maxBoardAngVel: 5,
    tiltFilterTau: 0.1,
    renderScaleMobile: 1.2,
    debugUpdateHzMobile: 5,
  },
  floaty: {
    gravityG: 14,
    linearDamping: 0.18,
    angularDamping: 0.18,
    bounce: 0.03,
    gyroSensitivity: 1.35,
    contactFriction: 0.85,
    contactRestitution: 0.03,
    maxBoardAngVel: 3.5,
    tiltFilterTau: 0.15,
    renderScaleMobile: 1.2,
    debugUpdateHzMobile: 5,
  },
  heavy: {
    gravityG: 20,
    linearDamping: 0.06,
    angularDamping: 0.06,
    bounce: 0.08,
    gyroSensitivity: 1.35,
    contactFriction: 0.7,
    contactRestitution: 0.08,
    maxBoardAngVel: 6,
    tiltFilterTau: 0.08,
    renderScaleMobile: 1.2,
    debugUpdateHzMobile: 5,
  },
};

const DRAWER_TABS: { id: DebugTabId; label: string }[] = [
  { id: "tuning", label: "Tuning" },
  { id: "camera", label: "Camera" },
  { id: "network", label: "Network" },
  { id: "diagnostics", label: "Diagnostics" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeJoinHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  let next = trimmed.replace(/^https?:\/\//i, "");
  next = next.split("/")[0] ?? "";
  next = next.trim();
  if (!next) return "";

  const hostPattern = /^[A-Za-z0-9.-]+(?::\d+)?$/;
  return hostPattern.test(next) ? next : "";
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function extractHostname(host: string): string {
  return host.replace(/:\d+$/, "");
}

function isCameraPresetId(value: unknown): value is CameraPresetId {
  return typeof value === "string" && CAMERA_PRESETS.includes(value as CameraPresetId);
}

function isPhysicsPresetId(value: unknown): value is PhysicsPresetId {
  return value === "marble" || value === "floaty" || value === "heavy";
}

function sanitizeTuning(input: unknown): TuningState {
  const base = { ...DEFAULT_TUNING };
  if (!input || typeof input !== "object") {
    return base;
  }

  const value = input as Partial<TuningState>;

  if (isPhysicsPresetId(value.physicsPreset)) {
    base.physicsPreset = value.physicsPreset;
  }
  if (typeof value.gravityG === "number") base.gravityG = clamp(value.gravityG, 8, 24);
  if (typeof value.tiltStrength === "number") {
    base.tiltStrength = clamp(value.tiltStrength, 0.5, 2);
  }
  if (typeof value.gyroSensitivity === "number") {
    base.gyroSensitivity = clamp(value.gyroSensitivity, 0.5, 2.5);
  }
  if (typeof value.maxSpeed === "number") base.maxSpeed = clamp(value.maxSpeed, 4, 20);
  if (typeof value.maxTiltDeg === "number") {
    base.maxTiltDeg = clamp(value.maxTiltDeg, 6, 25);
  }
  if (typeof value.maxBoardAngVel === "number") {
    base.maxBoardAngVel = clamp(value.maxBoardAngVel, 1, 10);
  }
  if (typeof value.tiltFilterTau === "number") {
    base.tiltFilterTau = clamp(value.tiltFilterTau, 0.05, 0.25);
  }
  if (typeof value.linearDamping === "number") {
    base.linearDamping = clamp(value.linearDamping, 0, 0.5);
  }
  if (typeof value.angularDamping === "number") {
    base.angularDamping = clamp(value.angularDamping, 0, 0.5);
  }
  if (typeof value.bounce === "number") {
    const nextBounce = clamp(value.bounce, 0, 0.35);
    base.bounce = nextBounce;
    base.contactRestitution = nextBounce;
  }
  if (typeof value.contactFriction === "number") {
    base.contactFriction = clamp(value.contactFriction, 0.3, 1.1);
  }
  if (typeof value.contactRestitution === "number") {
    const nextRestitution = clamp(value.contactRestitution, 0, 0.25);
    base.contactRestitution = nextRestitution;
    if (typeof value.bounce !== "number") {
      base.bounce = clamp(nextRestitution, 0, 0.35);
    }
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
  if (typeof value.renderScaleMobile === "number") {
    base.renderScaleMobile = clamp(value.renderScaleMobile, 0.75, 1.5);
  }
  if (typeof value.debugUpdateHzMobile === "number") {
    base.debugUpdateHzMobile = clamp(value.debugUpdateHzMobile, 2, 15);
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

function getPhysicsPresetLabel(id: PhysicsPresetId): string {
  switch (id) {
    case "marble":
      return "Marble (Default)";
    case "floaty":
      return "Floaty";
    case "heavy":
      return "Heavy";
    default:
      return "Unknown";
  }
}

function formatTimeMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) {
    return "--";
  }
  return `${(ms / 1000).toFixed(2)}s`;
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
  const [trialState, setTrialState] = useState<TrialState>("idle");
  const [trialCurrentMs, setTrialCurrentMs] = useState<number | null>(null);
  const [trialLastMs, setTrialLastMs] = useState<number | null>(null);
  const [trialBestMs, setTrialBestMs] = useState<number | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(BEST_TIME_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  });
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
  const [netStatus, setNetStatus] = useState<WSStatus>("disconnected");
  const [netError, setNetError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [joinRoomCode, setJoinRoomCode] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const room = new URLSearchParams(window.location.search).get("room");
    return room ? room.toUpperCase() : "";
  });
  const [localPlayerId, setLocalPlayerId] = useState("");
  const [playersInRoom, setPlayersInRoom] = useState<Array<{ playerId: string; name?: string }>>(
    [],
  );
  const [showQr, setShowQr] = useState(false);
  const [devJoinHost, setDevJoinHost] = useState(() => {
    if (typeof window === "undefined") return "";
    return sanitizeJoinHost(window.localStorage.getItem(DEV_JOIN_HOST_KEY) ?? "");
  });

  const tiltStatusRef = useRef(tiltStatus);
  const touchTiltRef = useRef(touchTilt);
  const tuningRef = useRef(tuning);
  const raceClientRef = useRef<RaceClient | null>(null);

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
    if (typeof window === "undefined") return;
    const sanitized = sanitizeJoinHost(devJoinHost);
    if (!sanitized) {
      window.localStorage.removeItem(DEV_JOIN_HOST_KEY);
      return;
    }
    window.localStorage.setItem(DEV_JOIN_HOST_KEY, sanitized);
  }, [devJoinHost]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (trialBestMs == null) {
      window.localStorage.removeItem(BEST_TIME_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(BEST_TIME_STORAGE_KEY, String(trialBestMs));
  }, [trialBestMs]);

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

    const mobileMode = window.matchMedia("(max-width: 700px)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: !mobileMode });
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, mobileMode ? tuningRef.current.renderScaleMobile : 2),
    );
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
    const solver = world.solver as unknown as {
      iterations: number;
      tolerance: number;
    };
    solver.iterations = 12;
    solver.tolerance = 1e-4;
    world.gravity.set(0, -tuningRef.current.gravityG, 0);
    world.addBody(boardBody);

    const boardMat = new CANNON.Material("board");
    const marbleMat = new CANNON.Material("marble");
    boardBody.material = boardMat;

    const contactMat = new CANNON.ContactMaterial(marbleMat, boardMat, {
      friction: tuningRef.current.contactFriction,
      restitution: tuningRef.current.contactRestitution,
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
    const marbleBodyWithCcd = marbleBody as CANNON.Body & {
      ccdSpeedThreshold: number;
      ccdIterations: number;
    };
    marbleBodyWithCcd.ccdSpeedThreshold = 1.0;
    marbleBodyWithCcd.ccdIterations = 10;
    world.addBody(marbleBody);

    const marbleSegments = mobileMode ? 20 : 32;
    const ghostSegments = mobileMode ? 16 : 24;
    const marbleMesh = new THREE.Mesh(
      new THREE.SphereGeometry(marbleRadius, marbleSegments, marbleSegments),
      new THREE.MeshStandardMaterial({ color: 0x4fc3f7 }),
    );
    scene.add(marbleMesh);
    const ghostMaterial = new THREE.MeshStandardMaterial({
      color: 0xff9e80,
      transparent: true,
      opacity: 0.6,
    });
    const ghostMeshes = new Map<string, THREE.Mesh>();
    const ghostBuffers = new Map<string, GhostSnapshot[]>();
    const interpolationDelayMs = 120;
    let lastRaceSendAt = 0;

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
    let filter = makeTiltFilter({ tau: tuningRef.current.tiltFilterTau });
    let lastFilterTau = tuningRef.current.tiltFilterTau;
    let lastFilteredIntent: TiltSample = { x: 0, y: 0, z: 0 };
    let currentPitch = 0;
    let currentRoll = 0;
    let trialStartAt: number | null = null;
    let prevMarbleZ = marbleBody.position.z;

    const raceClient = new RaceClient();
    raceClientRef.current = raceClient;
    raceClient.onStatusChange(setNetStatus);
    raceClient.onError((error) => {
      setNetError(error);
    });
    raceClient.onMessage((message: TypedMessage) => {
      switch (message.type) {
        case "room:created":
          setRoomCode(message.payload.roomCode);
          setJoinRoomCode(message.payload.roomCode);
          setShowQr(true);
          setNetError(null);
          return;
        case "room:state":
          setRoomCode(message.payload.roomCode);
          setNetError(null);
          return;
        case "race:hello:ack":
          setLocalPlayerId(message.payload.playerId);
          setPlayersInRoom(message.payload.players);
          setRoomCode(message.payload.roomCode);
          setNetError(null);
          return;
        case "race:state": {
          if (message.payload.playerId === raceClient.getPlayerId()) {
            return;
          }
          const snapshots = ghostBuffers.get(message.payload.playerId) ?? [];
          snapshots.push({
            t: message.payload.t,
            pos: new THREE.Vector3(...message.payload.pos),
            quat: new THREE.Quaternion(...message.payload.quat),
          });
          while (snapshots.length > 50) {
            snapshots.shift();
          }
          ghostBuffers.set(message.payload.playerId, snapshots);
          if (!ghostMeshes.has(message.payload.playerId)) {
            const ghostMesh = new THREE.Mesh(
              new THREE.SphereGeometry(marbleRadius, ghostSegments, ghostSegments),
              ghostMaterial,
            );
            scene.add(ghostMesh);
            ghostMeshes.set(message.payload.playerId, ghostMesh);
          }
          return;
        }
        case "race:left": {
          const ghostMesh = ghostMeshes.get(message.payload.playerId);
          if (ghostMesh) {
            scene.remove(ghostMesh);
            ghostMesh.geometry.dispose();
            ghostMeshes.delete(message.payload.playerId);
          }
          ghostBuffers.delete(message.payload.playerId);
          setPlayersInRoom((prev) =>
            prev.filter((entry) => entry.playerId !== message.payload.playerId),
          );
          return;
        }
        case "error":
          setNetError(`${message.payload.code}: ${message.payload.message}`);
          return;
        default:
          return;
      }
    });

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
      trialStartAt = null;
      prevMarbleZ = marbleBody.position.z;
      setTrialState("idle");
      setTrialCurrentMs(null);
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
    let lastRenderScale = tuningRef.current.renderScaleMobile;

    const tick = (nowMs: number) => {
      const now = nowMs / 1000;
      const delta = Math.min(now - lastTime, MAX_FRAME_DELTA);
      lastTime = now;
      accumulator += delta;
      debugTimer += delta;

      const currentTuning = tuningRef.current;
      if (mobileMode && Math.abs(currentTuning.renderScaleMobile - lastRenderScale) > 0.001) {
        lastRenderScale = currentTuning.renderScaleMobile;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, lastRenderScale));
      }
      world.gravity.set(0, -currentTuning.gravityG, 0);
      marbleBody.linearDamping = currentTuning.linearDamping;
      marbleBody.angularDamping = currentTuning.angularDamping;
      contactMat.friction = clamp(currentTuning.contactFriction, 0, 1.0);
      contactMat.restitution = clamp(currentTuning.bounce, 0, 0.2);

      if (Math.abs(currentTuning.tiltFilterTau - lastFilterTau) > 0.0001) {
        lastFilterTau = currentTuning.tiltFilterTau;
        filter = makeTiltFilter({ tau: lastFilterTau });
        filter.reset(lastFilteredIntent);
      }

      let sourceIntent: TiltSample;
      const status = tiltStatusRef.current;
      const touchIntent = touchTiltRef.current;

      if (status.enabled && status.permission === "granted" && status.supported) {
        sourceIntent = {
          x: motionTiltRef.current.x * currentTuning.gyroSensitivity,
          y: 0,
          z: motionTiltRef.current.z * currentTuning.gyroSensitivity,
        };
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
      lastFilteredIntent = filteredIntent;
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

      if (nowMs - lastRaceSendAt >= 1000 / 15) {
        raceClient.sendRaceState({
          t: nowMs,
          pos: [marbleBody.position.x, marbleBody.position.y, marbleBody.position.z],
          quat: [
            marbleBody.quaternion.x,
            marbleBody.quaternion.y,
            marbleBody.quaternion.z,
            marbleBody.quaternion.w,
          ],
          vel: [marbleBody.velocity.x, marbleBody.velocity.y, marbleBody.velocity.z],
        });
        lastRaceSendAt = nowMs;
      }

      if (marbleBody.position.y < track.respawnY) {
        respawnMarble(true);
      }

      const marbleZ = marbleBody.position.z;
      if (trialStartAt == null && prevMarbleZ <= track.trialStartZ && marbleZ > track.trialStartZ) {
        trialStartAt = nowMs;
        setTrialState("running");
        setTrialCurrentMs(0);
      } else if (
        trialStartAt != null &&
        prevMarbleZ <= track.trialFinishZ &&
        marbleZ > track.trialFinishZ
      ) {
        const elapsed = nowMs - trialStartAt;
        trialStartAt = null;
        setTrialState("finished");
        setTrialCurrentMs(null);
        setTrialLastMs(elapsed);
        setTrialBestMs((prevBest) => (prevBest == null ? elapsed : Math.min(prevBest, elapsed)));
      }
      prevMarbleZ = marbleZ;

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

      const targetInterpTime = nowMs - interpolationDelayMs;
      for (const [playerId, snapshots] of ghostBuffers) {
        const mesh = ghostMeshes.get(playerId);
        if (!mesh || snapshots.length === 0) {
          continue;
        }
        while (snapshots.length >= 2 && snapshots[1]!.t <= targetInterpTime) {
          snapshots.shift();
        }
        if (snapshots.length === 1) {
          mesh.position.copy(snapshots[0]!.pos);
          mesh.quaternion.copy(snapshots[0]!.quat);
          continue;
        }
        const a = snapshots[0]!;
        const b = snapshots[1]!;
        const span = Math.max(b.t - a.t, 1);
        const alpha = clamp((targetInterpTime - a.t) / span, 0, 1);
        mesh.position.copy(a.pos).lerp(b.pos, alpha);
        mesh.quaternion.copy(a.quat).slerp(b.quat, alpha);
      }

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

      const debugInterval = mobileMode
        ? 1 / Math.max(currentTuning.debugUpdateHzMobile, 1)
        : 0.1;
      if (debugTimer >= debugInterval) {
        if (trialStartAt != null) {
          setTrialCurrentMs(nowMs - trialStartAt);
        }
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
      raceClient.disconnect();
      raceClientRef.current = null;
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
      for (const ghostMesh of ghostMeshes.values()) {
        scene.remove(ghostMesh);
        ghostMesh.geometry.dispose();
      }
      ghostMaterial.dispose();
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
    setTuning((prev) => {
      if (key === "bounce") {
        return {
          ...prev,
          bounce: value as TuningState["bounce"],
          contactRestitution: value as TuningState["bounce"],
        };
      }
      if (key === "contactRestitution") {
        return {
          ...prev,
          contactRestitution: value as TuningState["contactRestitution"],
          bounce: clamp(value as number, 0, 0.35),
        };
      }
      return { ...prev, [key]: value };
    });
  };

  const applyPhysicsPreset = (preset: PhysicsPresetId) => {
    const values = PHYSICS_PRESETS[preset];
    setTuning((prev) => ({
      ...prev,
      physicsPreset: preset,
      ...values,
      contactRestitution: values.bounce,
    }));
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

  const connectMultiplayer = () => {
    raceClientRef.current?.connect();
  };

  const disconnectMultiplayer = () => {
    raceClientRef.current?.disconnect();
  };

  const createRoom = () => {
    setNetError(null);
    raceClientRef.current?.createRoom();
  };

  const joinRoom = () => {
    const code = joinRoomCode.trim().toUpperCase();
    if (!code) {
      setNetError("Join room code is empty.");
      return;
    }
    setNetError(null);
    raceClientRef.current?.joinRoom(code);
  };

  const sendRaceHello = () => {
    if (!roomCode) {
      setNetError("No room available for hello.");
      return;
    }
    raceClientRef.current?.sendHello(undefined, roomCode);
  };

  const resolvedWsUrl = resolveDefaultWsUrl();
  const joinHostWarning =
    typeof window !== "undefined" && roomCode
      ? (() => {
          const currentHost = window.location.hostname;
          const sanitizedOverride = sanitizeJoinHost(devJoinHost);
          if (!sanitizedOverride && isLocalHost(currentHost)) {
            return "Set Dev Join Host (LAN IPv4) to avoid localhost QR links.";
          }
          return "";
        })()
      : "";
  const joinUrl =
    typeof window !== "undefined" && roomCode
      ? (() => {
          const protocol = window.location.protocol;
          const path = window.location.pathname;
          const override = sanitizeJoinHost(devJoinHost);
          const currentHost = window.location.host;
          const currentHostname = window.location.hostname;
          const host = override || (!isLocalHost(currentHostname) ? currentHost : "");
          return host ? `${protocol}//${host}${path}?room=${roomCode}` : "";
        })()
      : "";
  const joinWsUrl = joinUrl
    ? resolveWsUrlForHost(extractHostname(new URL(joinUrl).host))
    : "";
  const qrImageUrl = joinUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl)}`
    : "";

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
              Physics Preset
              <select
                value={tuning.physicsPreset}
                onChange={(event) =>
                  applyPhysicsPreset(event.target.value as PhysicsPresetId)
                }
              >
                {(Object.keys(PHYSICS_PRESETS) as PhysicsPresetId[]).map((preset) => (
                  <option key={preset} value={preset}>
                    {getPhysicsPresetLabel(preset)}
                  </option>
                ))}
              </select>
            </label>
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
              Gyro Sensitivity
              <div className="controlRow">
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.01}
                  value={tuning.gyroSensitivity}
                  onChange={(event) =>
                    updateTuning("gyroSensitivity", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.01}
                  value={tuning.gyroSensitivity}
                  onChange={(event) =>
                    updateTuning("gyroSensitivity", Number(event.target.value))
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
              Contact Friction
              <div className="controlRow">
                <input
                  type="range"
                  min={0.3}
                  max={1.1}
                  step={0.01}
                  value={tuning.contactFriction}
                  onChange={(event) =>
                    updateTuning("contactFriction", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.01}
                  value={tuning.contactFriction}
                  onChange={(event) =>
                    updateTuning("contactFriction", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              Bounce
              <div className="controlRow">
                <input
                  type="range"
                  min={0}
                  max={0.35}
                  step={0.01}
                  value={tuning.bounce}
                  onChange={(event) =>
                    updateTuning("bounce", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.01}
                  value={tuning.bounce}
                  onChange={(event) =>
                    updateTuning("bounce", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              Tilt Filter Tau
              <div className="controlRow">
                <input
                  type="range"
                  min={0.05}
                  max={0.25}
                  step={0.01}
                  value={tuning.tiltFilterTau}
                  onChange={(event) =>
                    updateTuning("tiltFilterTau", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.01}
                  value={tuning.tiltFilterTau}
                  onChange={(event) =>
                    updateTuning("tiltFilterTau", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              Mobile Render Scale
              <div className="controlRow">
                <input
                  type="range"
                  min={0.75}
                  max={1.5}
                  step={0.01}
                  value={tuning.renderScaleMobile}
                  onChange={(event) =>
                    updateTuning("renderScaleMobile", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.01}
                  value={tuning.renderScaleMobile}
                  onChange={(event) =>
                    updateTuning("renderScaleMobile", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              Mobile Debug Hz
              <div className="controlRow">
                <input
                  type="range"
                  min={2}
                  max={15}
                  step={1}
                  value={tuning.debugUpdateHzMobile}
                  onChange={(event) =>
                    updateTuning("debugUpdateHzMobile", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={1}
                  value={tuning.debugUpdateHzMobile}
                  onChange={(event) =>
                    updateTuning("debugUpdateHzMobile", Number(event.target.value))
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
            <p>Status: {netStatus}</p>
            <p>Room: {roomCode || "n/a"}</p>
            <p>Player ID: {localPlayerId || "n/a"}</p>
            <p>Players: {playersInRoom.length}</p>
            {netError ? <p className="errorText">{netError}</p> : null}
            <div className="debugButtonRow">
              <button type="button" onClick={connectMultiplayer}>
                Connect
              </button>
              <button type="button" onClick={disconnectMultiplayer}>
                Disconnect
              </button>
            </div>
            <div className="debugButtonRow">
              <button type="button" onClick={createRoom}>
                Create Room
              </button>
              <button type="button" onClick={sendRaceHello}>
                Race Hello
              </button>
            </div>
            <label className="controlLabel" htmlFor="joinRoomCode">
              Join Room
            </label>
            <div className="controlRow">
              <input
                id="joinRoomCode"
                value={joinRoomCode}
                onChange={(event) => setJoinRoomCode(event.target.value.toUpperCase())}
                placeholder="ROOMCODE"
              />
              <button type="button" onClick={joinRoom}>
                Join
              </button>
            </div>
            <label className="controlLabel" htmlFor="devJoinHost">
              Dev Join Host (LAN IPv4)
            </label>
            <input
              id="devJoinHost"
              value={devJoinHost}
              onChange={(event) => setDevJoinHost(event.target.value)}
              placeholder="192.168.x.x or host:port"
            />
            <p>Resolved WS URL (this device): {resolvedWsUrl}</p>
            {joinWsUrl ? <p>Expected join WS URL: {joinWsUrl}</p> : null}
            {joinHostWarning ? <p className="errorText">{joinHostWarning}</p> : null}
            <label className="controlCheck">
              <input
                type="checkbox"
                checked={showQr}
                onChange={(event) => setShowQr(event.target.checked)}
                disabled={!roomCode}
              />
              Show QR
            </label>
            {joinUrl ? <p className="joinUrl">{joinUrl}</p> : null}
            {showQr && qrImageUrl ? (
              <img className="qrPreview" src={qrImageUrl} alt="Join room QR code" />
            ) : null}
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
            <p>Trial state: {trialState}</p>
            <p>Trial current: {formatTimeMs(trialCurrentMs)}</p>
            <p>Trial last: {formatTimeMs(trialLastMs)}</p>
            <p>Trial best: {formatTimeMs(trialBestMs)}</p>
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
