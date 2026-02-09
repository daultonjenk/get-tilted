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
type RacePhase = "waiting" | "countdown" | "racing";
type GameMode = "solo" | "multiplayer";

type GhostSnapshot = {
  t: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  trackPos?: THREE.Vector3;
  trackQuat?: THREE.Quaternion;
  trackVel?: THREE.Vector3;
};

type GhostRenderState = {
  snapshots: GhostSnapshot[];
  mesh: THREE.Mesh;
  avgSourceDeltaMs: number;
  jitterMs: number;
  interpolationDelayMs: number;
  lastSourceT: number;
  hasRendered: boolean;
  renderedPos: THREE.Vector3;
  renderedQuat: THREE.Quaternion;
  droppedStaleCount: number;
};

type NetSmoothingDebug = {
  ghostPlayers: number;
  avgDelayMs: number;
  avgJitterMs: number;
  extrapolatingPlayers: number;
  droppedStale: number;
  snapshotQueueSummary: string;
  latestRemoteAgeMs: number | null;
};

const TIMESTEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;
const LOOK_HEIGHT = 1.2;
const LOOK_AHEAD = 16;
const TOPDOWN_HEIGHT = 16;
const TOPDOWN_Z_OFFSET = 2;
const BOARD_TILT_SMOOTH = 12;
const PIVOT_SMOOTH = 10;
const SOURCE_RATE_MS = 1000 / 15;
const INTERP_DELAY_MIN_MS = 55;
const INTERP_DELAY_MAX_MS = 110;
const EXTRAPOLATION_MAX_MS = 80;
const SNAP_DISTANCE_M = 8;
const MAX_GHOST_STEP_SPEED_MPS = 35;
const SNAP_ANGLE_RAD = 1.3;
const MAX_GHOST_ANGULAR_RAD_PER_SEC = 8;
const TUNING_STORAGE_KEY = "get-tilted:v0.3.7:tuning";
const LEGACY_TUNING_STORAGE_KEY = "get-tilted:v0.3.6:tuning";
const BEST_TIME_STORAGE_KEY = "get-tilted:v0.3.8:best-time";
const DEV_JOIN_HOST_KEY = "get-tilted:v0.3.10.2:join-host";
const COUNTDOWN_LABELS = ["3", "2", "1", "GO!"] as const;

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

function normalizeCountdownStartAt(startAtMs: number, stepMs: number): number {
  const now = Date.now();
  const remainingMs = startAtMs - now;
  // Clamp skewed clocks to keep countdown progression reliable across devices.
  const clampedRemainingMs = clamp(remainingMs, 0, stepMs);
  return now + clampedRemainingMs;
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
  const [autoJoinRoomCode] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const room = new URLSearchParams(window.location.search).get("room");
    return room ? room.toUpperCase() : "";
  });
  const initialGameMode: GameMode = autoJoinRoomCode ? "multiplayer" : "solo";
  const [gameMode, setGameMode] = useState<GameMode>(initialGameMode);
  const [roomCode, setRoomCode] = useState("");
  const [joinRoomCode, setJoinRoomCode] = useState(autoJoinRoomCode);
  const [localPlayerId, setLocalPlayerId] = useState("");
  const [playersInRoom, setPlayersInRoom] = useState<Array<{ playerId: string; name?: string }>>(
    [],
  );
  const [readyPlayerIds, setReadyPlayerIds] = useState<string[]>([]);
  const [localReady, setLocalReady] = useState(false);
  const [racePhase, setRacePhase] = useState<RacePhase>(
    initialGameMode === "solo" ? "racing" : "waiting",
  );
  const [controlsLocked, setControlsLocked] = useState(initialGameMode !== "solo");
  const [countdownStartAtMs, setCountdownStartAtMs] = useState<number | null>(null);
  const [countdownStepMs, setCountdownStepMs] = useState(1000);
  const [countdownToken, setCountdownToken] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [devJoinHost, setDevJoinHost] = useState(() => {
    if (typeof window === "undefined") return "";
    return sanitizeJoinHost(window.localStorage.getItem(DEV_JOIN_HOST_KEY) ?? "");
  });
  const [netSmoothing, setNetSmoothing] = useState<NetSmoothingDebug>({
    ghostPlayers: 0,
    avgDelayMs: 0,
    avgJitterMs: 0,
    extrapolatingPlayers: 0,
    droppedStale: 0,
    snapshotQueueSummary: "none",
    latestRemoteAgeMs: null,
  });

  const tiltStatusRef = useRef(tiltStatus);
  const touchTiltRef = useRef(touchTilt);
  const tuningRef = useRef(tuning);
  const raceClientRef = useRef<RaceClient | null>(null);
  const localPlayerIdRef = useRef(localPlayerId);
  const autoJoinRoomCodeRef = useRef(autoJoinRoomCode);
  const gameModeRef = useRef(gameMode);
  const trialStateRef = useRef(trialState);
  const racePhaseRef = useRef(racePhase);
  const controlsLockedRef = useRef(controlsLocked);
  const countdownStartAtRef = useRef<number | null>(countdownStartAtMs);
  const countdownStepMsRef = useRef(countdownStepMs);
  const countdownIndexRef = useRef(-1);
  const countdownGoHandledRef = useRef(false);
  const autoJoinAttemptedRef = useRef(false);

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
    localPlayerIdRef.current = localPlayerId;
  }, [localPlayerId]);

  useEffect(() => {
    gameModeRef.current = gameMode;
  }, [gameMode]);

  useEffect(() => {
    trialStateRef.current = trialState;
  }, [trialState]);

  useEffect(() => {
    tuningRef.current = tuning;
    window.localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(tuning));
  }, [tuning]);

  useEffect(() => {
    racePhaseRef.current = racePhase;
  }, [racePhase]);

  useEffect(() => {
    controlsLockedRef.current = controlsLocked;
  }, [controlsLocked]);

  useEffect(() => {
    countdownStartAtRef.current = countdownStartAtMs;
  }, [countdownStartAtMs]);

  useEffect(() => {
    countdownStepMsRef.current = countdownStepMs;
  }, [countdownStepMs]);

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
    const ghostPlayers = new Map<string, GhostRenderState>();
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
    const tempVecA = new THREE.Vector3();
    const tempVecB = new THREE.Vector3();
    const tempQuatA = new THREE.Quaternion();
    const tempQuatB = new THREE.Quaternion();
    const boardPosThree = new THREE.Vector3();
    const boardQuatThree = new THREE.Quaternion();
    const boardQuatInvThree = new THREE.Quaternion();
    const marblePosThree = new THREE.Vector3();
    const marbleVelThree = new THREE.Vector3();
    const marbleQuatThree = new THREE.Quaternion();
    const marbleLocalPosThree = new THREE.Vector3();
    const marbleLocalVelThree = new THREE.Vector3();
    const marbleLocalQuatThree = new THREE.Quaternion();

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
    let totalDroppedStale = 0;
    let latestRemoteEpochMs: number | null = null;

    const getOrCreateGhostState = (playerId: string): GhostRenderState => {
      const existing = ghostPlayers.get(playerId);
      if (existing) {
        return existing;
      }
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(marbleRadius, ghostSegments, ghostSegments),
        ghostMaterial,
      );
      mesh.visible = false;
      scene.add(mesh);
      const next: GhostRenderState = {
        snapshots: [],
        mesh,
        avgSourceDeltaMs: SOURCE_RATE_MS,
        jitterMs: 0,
        interpolationDelayMs: 75,
        lastSourceT: -1,
        hasRendered: false,
        renderedPos: new THREE.Vector3(),
        renderedQuat: new THREE.Quaternion(),
        droppedStaleCount: 0,
      };
      ghostPlayers.set(playerId, next);
      return next;
    };

    const resetGhostSnapshots = (): void => {
      for (const [, playerState] of ghostPlayers) {
        playerState.snapshots.length = 0;
        playerState.lastSourceT = -1;
        playerState.hasRendered = false;
        playerState.mesh.visible = false;
      }
    };

    const raceClient = new RaceClient();
    raceClientRef.current = raceClient;
    raceClient.onStatusChange((status) => {
      setNetStatus(status);
      if (status === "disconnected") {
        setReadyPlayerIds([]);
        setLocalReady(false);
        if (
          gameModeRef.current === "multiplayer" &&
          racePhaseRef.current !== "racing"
        ) {
          setRacePhase("waiting");
          setControlsLocked(true);
        }
        setCountdownStartAtMs(null);
        setCountdownToken(null);
        countdownIndexRef.current = -1;
        countdownGoHandledRef.current = false;
        autoJoinAttemptedRef.current = false;
      }
      if (
        status === "connected" &&
        gameModeRef.current === "multiplayer" &&
        autoJoinRoomCodeRef.current &&
        !autoJoinAttemptedRef.current
      ) {
        autoJoinAttemptedRef.current = true;
        setNetError(null);
        raceClient.joinRoom(autoJoinRoomCodeRef.current);
      }
    });
    raceClient.onError((error) => {
      setNetError(error);
    });
    raceClient.onMessage((message: TypedMessage) => {
      switch (message.type) {
        case "room:created":
          if (gameModeRef.current !== "multiplayer") {
            return;
          }
          setRoomCode(message.payload.roomCode);
          setJoinRoomCode(message.payload.roomCode);
          setShowQr(true);
          setNetError(null);
          setReadyPlayerIds([]);
          setLocalReady(false);
          setRacePhase("waiting");
          setControlsLocked(true);
          setCountdownStartAtMs(null);
          setCountdownToken(null);
          countdownIndexRef.current = -1;
          countdownGoHandledRef.current = false;
          return;
        case "room:state":
          if (gameModeRef.current !== "multiplayer") {
            return;
          }
          setRoomCode(message.payload.roomCode);
          setNetError(null);
          if (racePhaseRef.current !== "racing") {
            setControlsLocked(true);
          }
          return;
        case "race:hello:ack":
          if (gameModeRef.current !== "multiplayer") {
            return;
          }
          localPlayerIdRef.current = message.payload.playerId;
          setLocalPlayerId(message.payload.playerId);
          setPlayersInRoom(message.payload.players);
          setRoomCode(message.payload.roomCode);
          setLocalReady(false);
          setNetError(null);
          {
            const livePlayerIds = new Set(message.payload.players.map((entry) => entry.playerId));
            for (const [playerId, ghostState] of ghostPlayers) {
              if (livePlayerIds.has(playerId) || playerId === message.payload.playerId) {
                continue;
              }
              scene.remove(ghostState.mesh);
              ghostState.mesh.geometry.dispose();
              ghostPlayers.delete(playerId);
            }
          }
          return;
        case "race:ready:state":
          if (gameModeRef.current !== "multiplayer") {
            return;
          }
          setReadyPlayerIds(message.payload.readyPlayerIds);
          setLocalReady(
            localPlayerIdRef.current
              ? message.payload.readyPlayerIds.includes(localPlayerIdRef.current)
              : false,
          );
          if (typeof message.payload.countdownStartAtMs === "number") {
            resetGhostSnapshots();
            setCountdownStartAtMs(
              normalizeCountdownStartAt(message.payload.countdownStartAtMs, 1000),
            );
            setCountdownStepMs(1000);
            setRacePhase("countdown");
            setControlsLocked(true);
            setCountdownToken(null);
            countdownIndexRef.current = -1;
            countdownGoHandledRef.current = false;
            resetRef.current();
          } else if (racePhaseRef.current !== "racing") {
            setCountdownStartAtMs(null);
            setCountdownToken(null);
            setRacePhase("waiting");
            setControlsLocked(true);
            countdownIndexRef.current = -1;
            countdownGoHandledRef.current = false;
          }
          return;
        case "race:countdown:start":
          if (gameModeRef.current !== "multiplayer") {
            return;
          }
          if (message.payload.roomCode !== raceClient.getRoomCode()) {
            return;
          }
          resetGhostSnapshots();
          setCountdownStartAtMs(
            normalizeCountdownStartAt(message.payload.startAtMs, message.payload.stepMs),
          );
          setCountdownStepMs(message.payload.stepMs);
          setRacePhase("countdown");
          setControlsLocked(true);
          setCountdownToken(null);
          countdownIndexRef.current = -1;
          countdownGoHandledRef.current = false;
          resetRef.current();
          return;
        case "race:state": {
          if (gameModeRef.current !== "multiplayer") {
            return;
          }
          latestRemoteEpochMs = message.payload.t;
          if (message.payload.playerId === raceClient.getPlayerId()) {
            return;
          }
          const playerState = getOrCreateGhostState(message.payload.playerId);
          if (playerState.lastSourceT >= 0 && message.payload.t <= playerState.lastSourceT) {
            playerState.droppedStaleCount += 1;
            totalDroppedStale += 1;
            return;
          }

          if (playerState.lastSourceT >= 0) {
            const sourceDelta = message.payload.t - playerState.lastSourceT;
            if (sourceDelta > 0 && sourceDelta < 1000) {
              playerState.avgSourceDeltaMs +=
                (sourceDelta - playerState.avgSourceDeltaMs) * 0.16;
              const jitterSample = Math.abs(sourceDelta - playerState.avgSourceDeltaMs);
              playerState.jitterMs += (jitterSample - playerState.jitterMs) * 0.24;
              const adaptiveDelay =
                playerState.avgSourceDeltaMs * 0.75 + playerState.jitterMs * 1.5 + 20;
              playerState.interpolationDelayMs = clamp(
                adaptiveDelay,
                INTERP_DELAY_MIN_MS,
                INTERP_DELAY_MAX_MS,
              );
            }
          }
          playerState.lastSourceT = message.payload.t;

          playerState.snapshots.push({
            t: message.payload.t,
            pos: new THREE.Vector3(...message.payload.pos),
            quat: new THREE.Quaternion(...message.payload.quat),
            vel: new THREE.Vector3(...message.payload.vel),
            trackPos: message.payload.trackPos
              ? new THREE.Vector3(...message.payload.trackPos)
              : undefined,
            trackQuat: message.payload.trackQuat
              ? new THREE.Quaternion(...message.payload.trackQuat)
              : undefined,
            trackVel: message.payload.trackVel
              ? new THREE.Vector3(...message.payload.trackVel)
              : undefined,
          });
          while (playerState.snapshots.length > 64) {
            playerState.snapshots.shift();
          }
          return;
        }
        case "race:left": {
          if (gameModeRef.current !== "multiplayer") {
            return;
          }
          const ghostState = ghostPlayers.get(message.payload.playerId);
          if (ghostState) {
            scene.remove(ghostState.mesh);
            ghostState.mesh.geometry.dispose();
            ghostPlayers.delete(message.payload.playerId);
          }
          setPlayersInRoom((prev) =>
            prev.filter((entry) => entry.playerId !== message.payload.playerId),
          );
          if (racePhaseRef.current !== "racing") {
            setRacePhase("waiting");
            setControlsLocked(true);
            setCountdownStartAtMs(null);
            setCountdownToken(null);
            countdownIndexRef.current = -1;
            countdownGoHandledRef.current = false;
          }
          return;
        }
        case "error":
          setNetError(`${message.payload.code}: ${message.payload.message}`);
          return;
        default:
          return;
      }
    });
    if (autoJoinRoomCodeRef.current) {
      raceClient.connect();
    }

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

    const resolveSnapshotPose = (
      snapshot: GhostSnapshot,
      boardPos: THREE.Vector3,
      boardQuat: THREE.Quaternion,
      useTrackLocal: boolean,
      outPos: THREE.Vector3,
      outQuat: THREE.Quaternion,
    ): void => {
      if (useTrackLocal && snapshot.trackPos && snapshot.trackQuat) {
        outPos.copy(snapshot.trackPos).applyQuaternion(boardQuat).add(boardPos);
        outQuat.copy(boardQuat).multiply(snapshot.trackQuat);
        return;
      }
      outPos.copy(snapshot.pos);
      outQuat.copy(snapshot.quat);
    };

    const applyGhostMotionSmoothing = (
      state: GhostRenderState,
      targetPos: THREE.Vector3,
      targetQuat: THREE.Quaternion,
      deltaSec: number,
    ): void => {
      if (!state.hasRendered) {
        state.renderedPos.copy(targetPos);
        state.renderedQuat.copy(targetQuat);
        state.hasRendered = true;
        state.mesh.visible = true;
        state.mesh.position.copy(state.renderedPos);
        state.mesh.quaternion.copy(state.renderedQuat);
        return;
      }

      tempVecA.copy(targetPos).sub(state.renderedPos);
      const jumpDistance = tempVecA.length();
      if (jumpDistance > SNAP_DISTANCE_M) {
        state.renderedPos.copy(targetPos);
      } else if (jumpDistance > 0) {
        const maxStep = Math.max(1.2, MAX_GHOST_STEP_SPEED_MPS * deltaSec);
        if (jumpDistance > maxStep) {
          tempVecA.multiplyScalar(maxStep / jumpDistance);
          state.renderedPos.add(tempVecA);
        } else {
          state.renderedPos.copy(targetPos);
        }
      }

      const quatDot = Math.min(1, Math.max(-1, state.renderedQuat.dot(targetQuat)));
      const angle = 2 * Math.acos(Math.abs(quatDot));
      if (angle > SNAP_ANGLE_RAD) {
        state.renderedQuat.copy(targetQuat);
      } else if (angle > 0.0001) {
        const maxAngularStep = Math.max(0.25, MAX_GHOST_ANGULAR_RAD_PER_SEC * deltaSec);
        const t = clamp(maxAngularStep / angle, 0, 1);
        state.renderedQuat.slerp(targetQuat, t);
      }

      state.mesh.position.copy(state.renderedPos);
      state.mesh.quaternion.copy(state.renderedQuat);
    };

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

      const countdownStart = countdownStartAtRef.current;
      if (countdownStart != null) {
        const stepMs = countdownStepMsRef.current;
        const elapsedMs = Date.now() - countdownStart;
        if (elapsedMs >= 0 && elapsedMs < stepMs * COUNTDOWN_LABELS.length) {
          const nextIndex = clamp(
            Math.floor(elapsedMs / stepMs),
            0,
            COUNTDOWN_LABELS.length - 1,
          );
          if (nextIndex !== countdownIndexRef.current) {
            countdownIndexRef.current = nextIndex;
            setCountdownToken(COUNTDOWN_LABELS[nextIndex] ?? null);
          }
          if (!countdownGoHandledRef.current && nextIndex >= COUNTDOWN_LABELS.length - 1) {
            countdownGoHandledRef.current = true;
            setControlsLocked(false);
            setRacePhase("racing");
            calibrateTiltRef.current();
          }
        } else if (elapsedMs >= stepMs * COUNTDOWN_LABELS.length) {
          if (!countdownGoHandledRef.current) {
            countdownGoHandledRef.current = true;
            setControlsLocked(false);
            setRacePhase("racing");
            calibrateTiltRef.current();
          }
          setCountdownStartAtMs(null);
          setCountdownToken(null);
          countdownIndexRef.current = -1;
        }
      }

      let sourceIntent: TiltSample;
      const status = tiltStatusRef.current;
      const touchIntent = touchTiltRef.current;

      if (controlsLockedRef.current) {
        sourceIntent = { x: 0, y: 0, z: 0 };
      } else if (status.enabled && status.permission === "granted" && status.supported) {
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

      if (
        nowMs - lastRaceSendAt >= SOURCE_RATE_MS &&
        gameModeRef.current === "multiplayer" &&
        racePhaseRef.current === "racing" &&
        trialStateRef.current !== "finished"
      ) {
        boardPosThree.set(boardBody.position.x, boardBody.position.y, boardBody.position.z);
        boardQuatThree.set(
          boardBody.quaternion.x,
          boardBody.quaternion.y,
          boardBody.quaternion.z,
          boardBody.quaternion.w,
        );
        boardQuatInvThree.copy(boardQuatThree).invert();
        marblePosThree.set(marbleBody.position.x, marbleBody.position.y, marbleBody.position.z);
        marbleVelThree.set(marbleBody.velocity.x, marbleBody.velocity.y, marbleBody.velocity.z);
        marbleQuatThree.set(
          marbleBody.quaternion.x,
          marbleBody.quaternion.y,
          marbleBody.quaternion.z,
          marbleBody.quaternion.w,
        );
        marbleLocalPosThree.copy(marblePosThree).sub(boardPosThree).applyQuaternion(boardQuatInvThree);
        marbleLocalVelThree.copy(marbleVelThree).applyQuaternion(boardQuatInvThree);
        marbleLocalQuatThree.copy(boardQuatInvThree).multiply(marbleQuatThree);

        raceClient.sendRaceState({
          t: Date.now(),
          pos: [marbleBody.position.x, marbleBody.position.y, marbleBody.position.z],
          quat: [
            marbleBody.quaternion.x,
            marbleBody.quaternion.y,
            marbleBody.quaternion.z,
            marbleBody.quaternion.w,
          ],
          vel: [marbleBody.velocity.x, marbleBody.velocity.y, marbleBody.velocity.z],
          trackPos: [marbleLocalPosThree.x, marbleLocalPosThree.y, marbleLocalPosThree.z],
          trackQuat: [
            marbleLocalQuatThree.x,
            marbleLocalQuatThree.y,
            marbleLocalQuatThree.z,
            marbleLocalQuatThree.w,
          ],
          trackVel: [marbleLocalVelThree.x, marbleLocalVelThree.y, marbleLocalVelThree.z],
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

      boardPosThree.set(boardBody.position.x, boardBody.position.y, boardBody.position.z);
      boardQuatThree.set(
        boardBody.quaternion.x,
        boardBody.quaternion.y,
        boardBody.quaternion.z,
        boardBody.quaternion.w,
      );

      let extrapolatingPlayers = 0;
      const interpNowMs = Date.now();
      for (const [, playerState] of ghostPlayers) {
        const snapshots = playerState.snapshots;
        if (snapshots.length === 0) {
          continue;
        }
        const targetInterpTime = interpNowMs - playerState.interpolationDelayMs;
        while (snapshots.length >= 2 && snapshots[1]!.t <= targetInterpTime) {
          snapshots.shift();
        }
        if (snapshots.length >= 2) {
          const a = snapshots[0]!;
          const b = snapshots[1]!;
          const useTrackLocal = Boolean(
            a.trackPos && a.trackQuat && b.trackPos && b.trackQuat,
          );
          resolveSnapshotPose(a, boardPosThree, boardQuatThree, useTrackLocal, tempVecA, tempQuatA);
          resolveSnapshotPose(b, boardPosThree, boardQuatThree, useTrackLocal, tempVecB, tempQuatB);
          const span = Math.max(b.t - a.t, 1);
          const alpha = clamp((targetInterpTime - a.t) / span, 0, 1);
          tempVecA.lerp(tempVecB, alpha);
          tempQuatA.slerp(tempQuatB, alpha);
          applyGhostMotionSmoothing(playerState, tempVecA, tempQuatA, delta);
          continue;
        }

        const latest = snapshots[0]!;
        const useTrackLocal = Boolean(latest.trackPos && latest.trackQuat);
        resolveSnapshotPose(
          latest,
          boardPosThree,
          boardQuatThree,
          useTrackLocal,
          tempVecA,
          tempQuatA,
        );
        const extrapolationMs = targetInterpTime - latest.t;
        if (extrapolationMs > 0 && extrapolationMs <= EXTRAPOLATION_MAX_MS) {
          const dt = extrapolationMs / 1000;
          if (useTrackLocal && latest.trackPos && latest.trackVel) {
            tempVecB.copy(latest.trackPos).addScaledVector(latest.trackVel, dt);
            tempVecA.copy(tempVecB).applyQuaternion(boardQuatThree).add(boardPosThree);
          } else {
            tempVecA.addScaledVector(latest.vel, dt);
          }
          extrapolatingPlayers += 1;
        }
        applyGhostMotionSmoothing(playerState, tempVecA, tempQuatA, delta);
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
        const ghostStateList = [...ghostPlayers.values()];
        const ghostCount = ghostStateList.length;
        const avgDelayMs =
          ghostCount > 0
            ? ghostStateList.reduce((sum, state) => sum + state.interpolationDelayMs, 0) / ghostCount
            : 0;
        const avgJitterMs =
          ghostCount > 0
            ? ghostStateList.reduce((sum, state) => sum + state.jitterMs, 0) / ghostCount
            : 0;
        const snapshotQueueSummary =
          ghostCount > 0
            ? [...ghostPlayers.entries()]
                .map(([playerId, state]) => `${playerId}:${state.snapshots.length}`)
                .join(", ")
            : "none";
        const latestRemoteAgeMs =
          typeof latestRemoteEpochMs === "number"
            ? Math.max(0, Date.now() - latestRemoteEpochMs)
            : null;

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
        setNetSmoothing({
          ghostPlayers: ghostCount,
          avgDelayMs,
          avgJitterMs,
          extrapolatingPlayers,
          droppedStale: totalDroppedStale,
          snapshotQueueSummary,
          latestRemoteAgeMs,
        });
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
      for (const [, playerState] of ghostPlayers) {
        scene.remove(playerState.mesh);
        playerState.mesh.geometry.dispose();
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
  const multiplayerRaceInProgress =
    gameMode === "multiplayer" &&
    racePhase === "racing" &&
    trialState !== "finished";
  const waitingForPlayers = gameMode === "multiplayer" && playersInRoom.length < 2;
  const waitingForReady =
    gameMode === "multiplayer" &&
    playersInRoom.length === 2 &&
    readyPlayerIds.length < 2;

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

  const toggleReady = async () => {
    if (gameMode !== "multiplayer") {
      setNetError("Switch to Multiplayer mode to use READY.");
      return;
    }
    if (!roomCode || !localPlayerId) {
      setNetError("Join a room before setting READY.");
      return;
    }
    if (racePhase !== "waiting") {
      setNetError("READY can only be changed before countdown starts.");
      return;
    }
    setNetError(null);
    if (!localReady) {
      await enableTiltRef.current();
    }
    raceClientRef.current?.sendReady(!localReady);
  };

  const switchGameMode = (nextMode: GameMode) => {
    if (nextMode === gameMode) {
      return;
    }
    setGameMode(nextMode);
    setCountdownStartAtMs(null);
    setCountdownToken(null);
    setReadyPlayerIds([]);
    setLocalReady(false);
    countdownIndexRef.current = -1;
    countdownGoHandledRef.current = false;
    if (nextMode === "solo") {
      setRacePhase("racing");
      setControlsLocked(false);
      return;
    }
    setRacePhase("waiting");
    setControlsLocked(true);
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
      {!multiplayerRaceInProgress ? (
        <div className="raceOverlay">
          <div className="raceOverlayCard">
            <p className="raceOverlayTitle">Race Lobby</p>
            <div className="modeSwitch" role="group" aria-label="Game mode">
              <button
                type="button"
                className={`modeButton ${gameMode === "solo" ? "active" : ""}`}
                onClick={() => switchGameMode("solo")}
              >
                Solo
              </button>
              <button
                type="button"
                className={`modeButton ${gameMode === "multiplayer" ? "active" : ""}`}
                onClick={() => switchGameMode("multiplayer")}
              >
                Multiplayer
              </button>
            </div>
            <p>
              {gameMode === "solo"
                ? "Solo run active."
                : roomCode
                  ? `Room ${roomCode}`
                  : "Create or join a room from Network tab"}
            </p>
            <p>Status: {gameMode === "solo" ? "solo-local" : netStatus}</p>
            {gameMode === "multiplayer" ? <p>Players: {playersInRoom.length}/2</p> : null}
            {gameMode === "multiplayer" && playersInRoom.length > 0 ? (
              <div className="racePlayers">
                {playersInRoom.map((player) => {
                  const isReady = readyPlayerIds.includes(player.playerId);
                  const isLocal = player.playerId === localPlayerId;
                  return (
                    <p key={player.playerId} className={isReady ? "ready" : "waiting"}>
                      {isLocal ? "You" : player.name || player.playerId}:{" "}
                      {isReady ? "READY" : "Waiting"}
                    </p>
                  );
                })}
              </div>
            ) : null}
            {gameMode === "multiplayer" && racePhase === "countdown" ? (
              <p className="raceHint">Countdown started...</p>
            ) : null}
            {waitingForPlayers ? <p className="raceHint">Waiting for second player.</p> : null}
            {waitingForReady ? <p className="raceHint">Both players must press READY.</p> : null}
            {gameMode === "solo" ? (
              <p className="raceHint">Solo mode skips room ready checks and starts immediately.</p>
            ) : null}
            {!tiltStatus.supported ? (
              <p className="raceHint">
                Tilt unavailable on this device. Fallback controls enabled.
              </p>
            ) : null}
            {gameMode === "multiplayer" ? (
              <button
                type="button"
                className={`readyButton ${localReady ? "ready" : ""}`}
                onClick={() => void toggleReady()}
                disabled={
                  netStatus !== "connected" ||
                  !roomCode ||
                  !localPlayerId ||
                  racePhase !== "waiting"
                }
              >
                {localReady ? "UNREADY" : "READY"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {countdownToken ? (
        <div className="countdownOverlay" key={`${countdownToken}-${countdownStartAtMs ?? 0}`}>
          <div className={`countdownValue ${countdownToken === "GO!" ? "go" : ""}`}>
            {countdownToken}
          </div>
        </div>
      ) : null}
      {!multiplayerRaceInProgress ? (
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
            <p>Ready players: {readyPlayerIds.length}</p>
            <p>Race phase: {racePhase}</p>
            <p>Controls locked: {controlsLocked ? "yes" : "no"}</p>
            <p>Ghost players: {netSmoothing.ghostPlayers}</p>
            <p>Ghost interp delay (avg ms): {netSmoothing.avgDelayMs.toFixed(1)}</p>
            <p>Ghost jitter (avg ms): {netSmoothing.avgJitterMs.toFixed(1)}</p>
            <p>Ghost extrapolating: {netSmoothing.extrapolatingPlayers}</p>
            <p>Dropped stale packets: {netSmoothing.droppedStale}</p>
            <p>Snapshot queues: {netSmoothing.snapshotQueueSummary}</p>
            <p>
              Latest remote age (ms):{" "}
              {netSmoothing.latestRemoteAgeMs == null
                ? "n/a"
                : netSmoothing.latestRemoteAgeMs.toFixed(1)}
            </p>
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
      ) : null}
    </div>
  );
}
