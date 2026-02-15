import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
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
import { RaceClient, type JoinTimingSnapshot } from "../net/raceClient";
import { APP_VERSION, BUILD_ID } from "../buildInfo";
import type {
  MessagePayloadMap,
  TypedMessage,
} from "@get-tilted/shared-protocol";
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
type GameMode = "unselected" | "solo" | "multiplayer";

type GhostSnapshot = {
  seq?: number;
  t: number;
  recvAtMs: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  trackPos?: THREE.Vector3;
  trackQuat?: THREE.Quaternion;
};

type GhostRenderState = {
  snapshots: GhostSnapshot[];
  mesh: THREE.Mesh;
  avgSourceDeltaMs: number;
  jitterMs: number;
  avgSnapshotAgeMs: number;
  snapshotAgeJitterMs: number;
  latestSnapshotAgeMs: number | null;
  interpolationDelayMs: number;
  lastSourceSeq: number;
  lastSourceT: number;
  lastRecvAtMs: number;
  hasRendered: boolean;
  renderedPos: THREE.Vector3;
  renderedQuat: THREE.Quaternion;
  droppedOutOfOrderSeqCount: number;
  droppedStaleTimestampCount: number;
  droppedTooOldCount: number;
  timestampCorrectedCount: number;
  queueOrderViolationCount: number;
  droppedStaleCount: number;
};

type NetSmoothingDebug = {
  ghostPlayers: number;
  avgDelayMs: number;
  avgJitterMs: number;
  avgSnapshotAgeMs: number;
  avgSnapshotAgeJitterMs: number;
  extrapolatingPlayers: number;
  droppedStale: number;
  droppedOutOfOrderSeq: number;
  droppedStaleTimestamp: number;
  droppedTooOld: number;
  timestampCorrected: number;
  queueOrderViolations: number;
  snapshotQueueSummary: string;
  latestSnapshotAgeMs: number | null;
  serverClockOffsetMs: number;
  inputSourcesSummary: string;
  inputIntentX: number;
  inputIntentZ: number;
};

type RaceResultPayload = MessagePayloadMap["race:result"];

const TIMESTEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;
const LOOK_HEIGHT = 1.2;
const LOOK_AHEAD = 16;
const TOPDOWN_HEIGHT = 16;
const TOPDOWN_Z_OFFSET = 2;
const BOARD_TILT_SMOOTH = 12;
const PIVOT_SMOOTH = 10;
const SOURCE_RATE_MS = 1000 / 15;
const INTERP_DELAY_MIN_MS = 120;
const INTERP_DELAY_MAX_MS = 165;
const INTERP_DELAY_RISE_BLEND = 0.18;
const INTERP_DELAY_FALL_BLEND = 0.08;
const EXTRAPOLATION_MAX_MS = 45;
const SNAPSHOT_MAX_AGE_MS = 2000;
const TUNING_STORAGE_KEY = "get-tilted:v0.3.7:tuning";
const BEST_TIME_STORAGE_KEY = "get-tilted:v0.3.8:best-time";
const DEV_JOIN_HOST_KEY = "get-tilted:v0.3.10.2:join-host";
const PLAYER_NAME_STORAGE_KEY = "get-tilted:v0.7.2.8:player-name";
const COUNTDOWN_LABELS = ["3", "2", "1", "GO!"] as const;
const RESULT_SPARKLES = Array.from({ length: 12 }, (_, index) => index);

const DEFAULT_TUNING: TuningState = {
  physicsPreset: "marble",
  gravityG: 19.7,
  tiltStrength: 1.63,
  gyroSensitivity: 1.35,
  maxSpeed: 20,
  maxTiltDeg: 14,
  maxBoardAngVel: 5,
  tiltFilterTau: 0.1,
  linearDamping: 0.01,
  angularDamping: 0.01,
  cameraPreset: "chaseCentered",
  bounce: 0.25,
  contactFriction: 0,
  contactRestitution: 0.25,
  invertTiltX: true,
  invertTiltZ: false,
  invertCameraSide: false,
  enableExtraDownforce: false,
  extraDownForce: 0.7,
  renderScaleMobile: 1.2,
  debugUpdateHzMobile: 2,
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

function sanitizePlayerName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 18);
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
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
    const nextBounce = clamp(value.bounce, 0, 0.99);
    base.bounce = nextBounce;
    base.contactRestitution = nextBounce;
  }
  if (typeof value.contactFriction === "number") {
    base.contactFriction = clamp(value.contactFriction, 0, 1.1);
  }
  if (typeof value.contactRestitution === "number") {
    const nextRestitution = clamp(value.contactRestitution, 0, 0.99);
    base.contactRestitution = nextRestitution;
    if (typeof value.bounce !== "number") {
      base.bounce = clamp(nextRestitution, 0, 0.99);
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

  const defaultTuning = { ...DEFAULT_TUNING };
  // Each fresh app launch starts from canonical defaults, regardless of prior dev tuning.
  window.localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(defaultTuning));
  return defaultTuning;
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
  const [joinTiming, setJoinTiming] = useState<JoinTimingSnapshot | null>(null);
  const [autoJoinRoomCode] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const room = new URLSearchParams(window.location.search).get("room");
    return room ? room.toUpperCase() : "";
  });
  const initialGameMode: GameMode = autoJoinRoomCode ? "multiplayer" : "unselected";
  const [gameMode, setGameMode] = useState<GameMode>(initialGameMode);
  const [roomCode, setRoomCode] = useState("");
  const [localPlayerId, setLocalPlayerId] = useState("");
  const [playersInRoom, setPlayersInRoom] = useState<Array<{ playerId: string; name?: string }>>(
    [],
  );
  const [readyPlayerIds, setReadyPlayerIds] = useState<string[]>([]);
  const [localReady, setLocalReady] = useState(false);
  const [racePhase, setRacePhase] = useState<RacePhase>("waiting");
  const [controlsLocked, setControlsLocked] = useState(true);
  const [countdownStartAtMs, setCountdownStartAtMs] = useState<number | null>(null);
  const [countdownStepMs, setCountdownStepMs] = useState(1000);
  const [countdownToken, setCountdownToken] = useState<string | null>(null);
  const [raceResult, setRaceResult] = useState<RaceResultPayload | null>(null);
  const [devJoinHost, setDevJoinHost] = useState(() => {
    if (typeof window === "undefined") return "";
    return sanitizeJoinHost(window.localStorage.getItem(DEV_JOIN_HOST_KEY) ?? "");
  });
  const [playerNameInput, setPlayerNameInput] = useState(() => {
    if (typeof window === "undefined") return "";
    return sanitizePlayerName(window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "");
  });
  const [netSmoothing, setNetSmoothing] = useState<NetSmoothingDebug>({
    ghostPlayers: 0,
    avgDelayMs: 0,
    avgJitterMs: 0,
    avgSnapshotAgeMs: 0,
    avgSnapshotAgeJitterMs: 0,
    extrapolatingPlayers: 0,
    droppedStale: 0,
    droppedOutOfOrderSeq: 0,
    droppedStaleTimestamp: 0,
    droppedTooOld: 0,
    timestampCorrected: 0,
    queueOrderViolations: 0,
    snapshotQueueSummary: "none",
    latestSnapshotAgeMs: null,
    serverClockOffsetMs: 0,
    inputSourcesSummary: "none",
    inputIntentX: 0,
    inputIntentZ: 0,
  });

  const tiltStatusRef = useRef(tiltStatus);
  const touchTiltRef = useRef(touchTilt);
  const tuningRef = useRef(tuning);
  const raceClientRef = useRef<RaceClient | null>(null);
  const playerNameRef = useRef(playerNameInput);
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
  const hasSentFinishRef = useRef(false);
  const soloStartSequenceRef = useRef(0);
  const freezeMarbleRef = useRef<() => void>(() => {});
  const unfreezeMarbleRef = useRef<() => void>(() => {});

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
    playerNameRef.current = playerNameInput;
    raceClientRef.current?.setPreferredName(playerNameInput || undefined);
  }, [playerNameInput]);

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
    if (typeof window === "undefined") return;
    const sanitized = sanitizePlayerName(playerNameInput);
    if (!sanitized) {
      window.localStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, sanitized);
  }, [playerNameInput]);

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
    let lastSentRaceStateT = 0;

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
    const tempVecC = new THREE.Vector3();
    const tempVecD = new THREE.Vector3();
    const tempQuatA = new THREE.Quaternion();
    const tempQuatB = new THREE.Quaternion();
    const tempQuatC = new THREE.Quaternion();
    const tempQuatD = new THREE.Quaternion();
    const boardPosThree = new THREE.Vector3();
    const boardQuatThree = new THREE.Quaternion();

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
    let totalDroppedOutOfOrderSeq = 0;
    let totalDroppedStaleTimestamp = 0;
    let totalDroppedTooOld = 0;
    let totalTimestampCorrected = 0;
    let totalQueueOrderViolations = 0;
    let latestAcceptedSnapshotAgeMs: number | null = null;
    let serverClockOffsetMs = 0;
    let isRaceFinishedLocal = false;
    let inputSourcesSummary = "none";
    let inputIntentX = 0;
    let inputIntentZ = 0;

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
        avgSnapshotAgeMs: 0,
        snapshotAgeJitterMs: 0,
        latestSnapshotAgeMs: null,
        interpolationDelayMs: 75,
        lastSourceSeq: -1,
        lastSourceT: -1,
        lastRecvAtMs: -1,
        hasRendered: false,
        renderedPos: new THREE.Vector3(),
        renderedQuat: new THREE.Quaternion(),
        droppedOutOfOrderSeqCount: 0,
        droppedStaleTimestampCount: 0,
        droppedTooOldCount: 0,
        timestampCorrectedCount: 0,
        queueOrderViolationCount: 0,
        droppedStaleCount: 0,
      };
      ghostPlayers.set(playerId, next);
      return next;
    };

    const resetGhostSnapshots = (): void => {
      for (const [, playerState] of ghostPlayers) {
        playerState.snapshots.length = 0;
        playerState.lastSourceSeq = -1;
        playerState.lastSourceT = -1;
        playerState.lastRecvAtMs = -1;
        playerState.latestSnapshotAgeMs = null;
        playerState.avgSnapshotAgeMs = 0;
        playerState.snapshotAgeJitterMs = 0;
        playerState.hasRendered = false;
        playerState.mesh.visible = false;
      }
    };

    const raceClient = new RaceClient();
    raceClientRef.current = raceClient;
    raceClient.setPreferredName(playerNameRef.current || undefined);
    raceClient.onStatusChange((status) => {
      setNetStatus(status);
      if (status === "disconnected") {
        setReadyPlayerIds([]);
        setLocalReady(false);
        setRaceResult(null);
        hasSentFinishRef.current = false;
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
        raceClient.joinRoom(autoJoinRoomCodeRef.current, playerNameRef.current || undefined);
      }
    });
    raceClient.onError((error) => {
      setNetError(error);
    });
    raceClient.onJoinTiming((timing) => {
      setJoinTiming(timing);
    });
    raceClient.onClockSync((offsetMs) => {
      serverClockOffsetMs = offsetMs;
    });
    raceClient.onMessage((message: TypedMessage) => {
      switch (message.type) {
        case "room:created":
          if (gameModeRef.current !== "multiplayer") {
            return;
          }
          setRoomCode(message.payload.roomCode);
          setNetError(null);
          setReadyPlayerIds([]);
          setLocalReady(false);
          setRaceResult(null);
          hasSentFinishRef.current = false;
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
            setRaceResult(null);
            hasSentFinishRef.current = false;
            setCountdownStartAtMs(message.payload.countdownStartAtMs);
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
          setRaceResult(null);
          hasSentFinishRef.current = false;
          setCountdownStartAtMs(message.payload.startAtMs);
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
          const recvAtMs = Date.now();
          if (message.payload.playerId === raceClient.getPlayerId()) {
            return;
          }
          const playerState = getOrCreateGhostState(message.payload.playerId);

          const sourceSeq = message.payload.seq;
          if (
            typeof sourceSeq === "number" &&
            playerState.lastSourceSeq >= 0 &&
            sourceSeq <= playerState.lastSourceSeq
          ) {
            playerState.droppedStaleCount += 1;
            playerState.droppedOutOfOrderSeqCount += 1;
            totalDroppedStale += 1;
            totalDroppedOutOfOrderSeq += 1;
            return;
          }

          if (
            typeof sourceSeq !== "number" &&
            playerState.lastSourceT >= 0 &&
            message.payload.t <= playerState.lastSourceT
          ) {
            playerState.droppedStaleCount += 1;
            playerState.droppedStaleTimestampCount += 1;
            totalDroppedStale += 1;
            totalDroppedStaleTimestamp += 1;
            return;
          }

          const snapshotAgeMs = Math.max(0, raceClient.getServerNowMs() - message.payload.t);
          if (snapshotAgeMs > SNAPSHOT_MAX_AGE_MS) {
            playerState.droppedStaleCount += 1;
            playerState.droppedTooOldCount += 1;
            totalDroppedStale += 1;
            totalDroppedTooOld += 1;
            return;
          }

          let enqueueT = message.payload.t;
          if (
            typeof sourceSeq === "number" &&
            playerState.lastSourceT >= 0 &&
            enqueueT <= playerState.lastSourceT
          ) {
            enqueueT = playerState.lastSourceT + 1;
            playerState.timestampCorrectedCount += 1;
            totalTimestampCorrected += 1;
          }

          if (playerState.lastRecvAtMs >= 0) {
            const sourceDelta = recvAtMs - playerState.lastRecvAtMs;
            if (sourceDelta > 0 && sourceDelta < 1000) {
              playerState.avgSourceDeltaMs +=
                (sourceDelta - playerState.avgSourceDeltaMs) * 0.16;
              const jitterSample = Math.abs(sourceDelta - playerState.avgSourceDeltaMs);
              playerState.jitterMs += (jitterSample - playerState.jitterMs) * 0.24;
              const adaptiveDelay =
                playerState.avgSourceDeltaMs * 1.25 + playerState.jitterMs * 1.8 + 35;
              const clampedDelay = clamp(
                adaptiveDelay,
                INTERP_DELAY_MIN_MS,
                INTERP_DELAY_MAX_MS,
              );
              const blend =
                clampedDelay > playerState.interpolationDelayMs
                  ? INTERP_DELAY_RISE_BLEND
                  : INTERP_DELAY_FALL_BLEND;
              playerState.interpolationDelayMs +=
                (clampedDelay - playerState.interpolationDelayMs) * blend;
            }
          }

          if (playerState.latestSnapshotAgeMs == null) {
            playerState.avgSnapshotAgeMs = snapshotAgeMs;
            playerState.snapshotAgeJitterMs = 0;
          } else {
            playerState.avgSnapshotAgeMs +=
              (snapshotAgeMs - playerState.avgSnapshotAgeMs) * 0.16;
            const ageJitterSample = Math.abs(snapshotAgeMs - playerState.avgSnapshotAgeMs);
            playerState.snapshotAgeJitterMs +=
              (ageJitterSample - playerState.snapshotAgeJitterMs) * 0.24;
          }
          latestAcceptedSnapshotAgeMs = snapshotAgeMs;
          playerState.latestSnapshotAgeMs = snapshotAgeMs;
          if (typeof sourceSeq === "number") {
            playerState.lastSourceSeq = sourceSeq;
          }
          playerState.lastSourceT = enqueueT;
          playerState.lastRecvAtMs = recvAtMs;

          playerState.snapshots.push({
            seq: sourceSeq,
            t: enqueueT,
            recvAtMs,
            pos: new THREE.Vector3(...message.payload.pos),
            quat: new THREE.Quaternion(...message.payload.quat),
            vel: new THREE.Vector3(...message.payload.vel),
            trackPos: message.payload.trackPos
              ? new THREE.Vector3(...message.payload.trackPos)
              : undefined,
            trackQuat: message.payload.trackQuat
              ? new THREE.Quaternion(...message.payload.trackQuat)
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
        case "race:result":
          if (gameModeRef.current !== "multiplayer") {
            return;
          }
          setRaceResult(message.payload);
          if (message.payload.isFinal) {
            setRacePhase("waiting");
            setControlsLocked(true);
            setCountdownStartAtMs(null);
            setCountdownToken(null);
            countdownIndexRef.current = -1;
            countdownGoHandledRef.current = false;
            hasSentFinishRef.current = false;
          }
          return;
        case "error":
          setNetError(`${message.payload.code}: ${message.payload.message}`);
          return;
        default:
          return;
      }
    });
    if (autoJoinRoomCodeRef.current) {
      autoJoinAttemptedRef.current = true;
      raceClient.joinRoom(autoJoinRoomCodeRef.current, playerNameRef.current || undefined);
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
      if (isEditableEventTarget(event.target)) {
        return;
      }
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
        if (controlsLockedRef.current) {
          return;
        }
        event.preventDefault();
        pressedKeys.add(event.key);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.key);
    };

    window.addEventListener("keydown", handleKeyDown, { passive: false });
    window.addEventListener("keyup", handleKeyUp);

    const freezeMarble = () => {
      marbleBody.type = CANNON.Body.STATIC;
      marbleBody.mass = 0;
      marbleBody.updateMassProperties();
      marbleBody.velocity.set(0, 0, 0);
      marbleBody.angularVelocity.set(0, 0, 0);
    };

    const unfreezeMarble = () => {
      marbleBody.type = CANNON.Body.DYNAMIC;
      marbleBody.mass = 1;
      marbleBody.updateMassProperties();
      marbleBody.wakeUp();
    };

    freezeMarbleRef.current = freezeMarble;
    unfreezeMarbleRef.current = unfreezeMarble;

    const respawnMarble = (incrementCounter: boolean) => {
      isRaceFinishedLocal = false;
      hasSentFinishRef.current = false;
      unfreezeMarble();
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
    respawnMarble(false);
    if (gameModeRef.current !== "solo") {
      freezeMarble();
    }

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
      outPos: THREE.Vector3,
      outQuat: THREE.Quaternion,
    ): void => {
      outPos.copy(snapshot.pos);
      outQuat.copy(snapshot.quat);
    };

    const resolveSnapshotTrackPose = (
      snapshot: GhostSnapshot,
      outPos: THREE.Vector3,
      outQuat: THREE.Quaternion,
    ): boolean => {
      if (!snapshot.trackPos || !snapshot.trackQuat) {
        return false;
      }
      outPos.copy(snapshot.trackPos);
      outQuat.copy(snapshot.trackQuat);
      return true;
    };

    const rebaseGhostPoseToLocalBoard = (
      senderPos: THREE.Vector3,
      senderQuat: THREE.Quaternion,
      senderTrackPos: THREE.Vector3 | undefined,
      senderTrackQuat: THREE.Quaternion | undefined,
      localTrackPos: THREE.Vector3,
      localTrackQuat: THREE.Quaternion,
      outPos: THREE.Vector3,
      outQuat: THREE.Quaternion,
    ): void => {
      if (!senderTrackPos || !senderTrackQuat) {
        outPos.copy(senderPos);
        outQuat.copy(senderQuat);
        return;
      }

      tempQuatC.copy(senderTrackQuat).invert();
      outPos
        .copy(senderPos)
        .sub(senderTrackPos)
        .applyQuaternion(tempQuatC)
        .applyQuaternion(localTrackQuat)
        .add(localTrackPos);
      outQuat.copy(tempQuatC).multiply(senderQuat).premultiply(localTrackQuat).normalize();
    };

    const applyGhostPose = (
      state: GhostRenderState,
      worldPos: THREE.Vector3,
      worldQuat: THREE.Quaternion,
    ): void => {
      state.renderedPos.copy(worldPos);
      state.renderedQuat.copy(worldQuat);
      state.hasRendered = true;
      state.mesh.visible = true;
      state.mesh.position.copy(worldPos);
      state.mesh.quaternion.copy(worldQuat);
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
      contactMat.restitution = clamp(currentTuning.bounce, 0, 0.99);

      if (Math.abs(currentTuning.tiltFilterTau - lastFilterTau) > 0.0001) {
        lastFilterTau = currentTuning.tiltFilterTau;
        filter = makeTiltFilter({ tau: lastFilterTau });
        filter.reset(lastFilteredIntent);
      }

      const countdownStart = countdownStartAtRef.current;
      if (countdownStart != null) {
        const stepMs = countdownStepMsRef.current;
        const elapsedMs = raceClient.getServerNowMs() - countdownStart;
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
            if (gameModeRef.current === "solo") {
              unfreezeMarbleRef.current();
            }
            setControlsLocked(false);
            setRacePhase("racing");
            calibrateTiltRef.current();
          }
        } else if (elapsedMs >= stepMs * COUNTDOWN_LABELS.length) {
          if (!countdownGoHandledRef.current) {
            countdownGoHandledRef.current = true;
            if (gameModeRef.current === "solo") {
              unfreezeMarbleRef.current();
            }
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
      const keyboardIntent = getKeyboardIntent();
      const tiltEnabled = status.enabled && status.permission === "granted" && status.supported;
      const touchFallbackEnabled = !status.supported || status.permission === "denied";
      const keyboardActive = keyboardIntent.x !== 0 || keyboardIntent.z !== 0;

      if (controlsLockedRef.current) {
        sourceIntent = { x: 0, y: 0, z: 0 };
        inputSourcesSummary = "locked";
      } else {
        let sourceX = keyboardIntent.x;
        let sourceZ = keyboardIntent.z;
        const activeInputs: string[] = [];
        if (keyboardActive) {
          activeInputs.push("keyboard");
        }
        if (tiltEnabled) {
          sourceX += motionTiltRef.current.x * currentTuning.gyroSensitivity;
          sourceZ += motionTiltRef.current.z * currentTuning.gyroSensitivity;
          activeInputs.push("tilt");
        }
        if (touchFallbackEnabled) {
          sourceX += touchIntent.x;
          sourceZ += touchIntent.z;
          activeInputs.push("touch");
        }
        sourceIntent = {
          x: sourceX,
          y: 0,
          z: sourceZ,
        };
        inputSourcesSummary = activeInputs.length > 0 ? activeInputs.join("+") : "none";
      }

      const intentX = currentTuning.invertTiltX ? -sourceIntent.x : sourceIntent.x;
      const intentZ = currentTuning.invertTiltZ ? -sourceIntent.z : sourceIntent.z;
      const normalizedIntent: TiltSample = {
        x: clamp(intentX, -1, 1),
        y: 0,
        z: clamp(intentZ, -1, 1),
      };
      inputIntentX = normalizedIntent.x;
      inputIntentZ = normalizedIntent.z;

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
        trialStateRef.current !== "finished" &&
        !isRaceFinishedLocal
      ) {
        boardPosThree.set(boardBody.position.x, boardBody.position.y, boardBody.position.z);
        boardQuatThree.set(
          boardBody.quaternion.x,
          boardBody.quaternion.y,
          boardBody.quaternion.z,
          boardBody.quaternion.w,
        );
        const candidateT = raceClient.getServerNowMs();
        const monotonicT = Math.max(candidateT, lastSentRaceStateT + 1);
        lastSentRaceStateT = monotonicT;

        raceClient.sendRaceState({
          t: monotonicT,
          pos: [marbleBody.position.x, marbleBody.position.y, marbleBody.position.z],
          quat: [
            marbleBody.quaternion.x,
            marbleBody.quaternion.y,
            marbleBody.quaternion.z,
            marbleBody.quaternion.w,
          ],
          vel: [marbleBody.velocity.x, marbleBody.velocity.y, marbleBody.velocity.z],
          trackPos: [boardBody.position.x, boardBody.position.y, boardBody.position.z],
          trackQuat: [
            boardBody.quaternion.x,
            boardBody.quaternion.y,
            boardBody.quaternion.z,
            boardBody.quaternion.w,
          ],
        });
        lastRaceSendAt = nowMs;
      }

      if (!isRaceFinishedLocal && marbleBody.position.y < track.respawnY) {
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
        freezeMarble();
        setControlsLocked(true);
        if (gameModeRef.current === "multiplayer") {
          isRaceFinishedLocal = true;
          if (!hasSentFinishRef.current) {
            hasSentFinishRef.current = true;
            raceClient.sendRaceFinish(elapsed, raceClient.getServerNowMs());
          }
        }
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
      const interpNowMs = raceClient.getServerNowMs();
      for (const [, playerState] of ghostPlayers) {
        const snapshots = playerState.snapshots;
        if (snapshots.length === 0) {
          continue;
        }
        let queueViolationIndex = -1;
        for (let idx = 1; idx < snapshots.length; idx += 1) {
          if (snapshots[idx]!.t <= snapshots[idx - 1]!.t) {
            queueViolationIndex = idx;
            break;
          }
        }
        if (queueViolationIndex >= 0) {
          snapshots.splice(queueViolationIndex, 1);
          playerState.queueOrderViolationCount += 1;
          totalQueueOrderViolations += 1;
          if (snapshots.length === 0) {
            continue;
          }
        }
        const targetInterpTime = interpNowMs - playerState.interpolationDelayMs;
        while (
          snapshots.length >= 3 &&
          snapshots[1]!.t <= targetInterpTime
        ) {
          snapshots.shift();
        }
        if (snapshots.length >= 2) {
          const a = snapshots[0]!;
          const b = snapshots[1]!;
          resolveSnapshotPose(
            a,
            tempVecA,
            tempQuatA,
          );
          resolveSnapshotPose(
            b,
            tempVecB,
            tempQuatB,
          );
          const rawSpanMs = b.t - a.t;
          const spanMs = Math.max(rawSpanMs, 1);
          if (targetInterpTime <= b.t) {
            const alpha = clamp((targetInterpTime - a.t) / spanMs, 0, 1);
            tempVecA.lerp(tempVecB, alpha);
            tempQuatA.slerp(tempQuatB, alpha);
            const canRebaseA = resolveSnapshotTrackPose(a, tempVecC, tempQuatC);
            const canRebaseB = resolveSnapshotTrackPose(b, tempVecD, tempQuatD);
            if (canRebaseA && canRebaseB) {
              tempVecC.lerp(tempVecD, alpha);
              tempQuatC.slerp(tempQuatD, alpha);
              rebaseGhostPoseToLocalBoard(
                tempVecA,
                tempQuatA,
                tempVecC,
                tempQuatC,
                boardPosThree,
                boardQuatThree,
                tempVecA,
                tempQuatA,
              );
            }
            applyGhostPose(playerState, tempVecA, tempQuatA);
            continue;
          }

          const extrapolationMs = clamp(targetInterpTime - b.t, 0, EXTRAPOLATION_MAX_MS);
          if (extrapolationMs > 0) {
            const dt = extrapolationMs / 1000;
            tempVecA.copy(b.pos);
            if (rawSpanMs > 0) {
              tempVecB.copy(b.pos).sub(a.pos).multiplyScalar(1000 / rawSpanMs);
            } else {
              tempVecB.copy(b.vel);
            }
            tempVecA.addScaledVector(tempVecB, dt);
            extrapolatingPlayers += 1;
          } else {
            tempVecA.copy(tempVecB);
          }
          const canRebaseB = resolveSnapshotTrackPose(b, tempVecC, tempQuatC);
          if (canRebaseB) {
            rebaseGhostPoseToLocalBoard(
              tempVecA,
              tempQuatA,
              tempVecC,
              tempQuatC,
              boardPosThree,
              boardQuatThree,
              tempVecA,
              tempQuatA,
            );
          }
          applyGhostPose(playerState, tempVecA, tempQuatA);
          continue;
        }

        const latest = snapshots[0]!;
        resolveSnapshotPose(
          latest,
          tempVecA,
          tempQuatA,
        );
        const canRebaseLatest = resolveSnapshotTrackPose(latest, tempVecC, tempQuatC);
        if (canRebaseLatest) {
          rebaseGhostPoseToLocalBoard(
            tempVecA,
            tempQuatA,
            tempVecC,
            tempQuatC,
            boardPosThree,
            boardQuatThree,
            tempVecA,
            tempQuatA,
          );
        }
        applyGhostPose(playerState, tempVecA, tempQuatA);
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
        const statesWithSnapshotAge = ghostStateList.filter(
          (state) => state.latestSnapshotAgeMs != null,
        );
        const snapshotAgeCount = statesWithSnapshotAge.length;
        const avgSnapshotAgeMs =
          snapshotAgeCount > 0
            ? statesWithSnapshotAge.reduce((sum, state) => sum + state.avgSnapshotAgeMs, 0) /
              snapshotAgeCount
            : 0;
        const avgSnapshotAgeJitterMs =
          snapshotAgeCount > 0
            ? statesWithSnapshotAge.reduce((sum, state) => sum + state.snapshotAgeJitterMs, 0) /
              snapshotAgeCount
            : 0;
        const snapshotQueueSummary =
          ghostCount > 0
            ? [...ghostPlayers.entries()]
                .map(([playerId, state]) => `${playerId}:${state.snapshots.length}`)
                .join(", ")
            : "none";

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
          avgSnapshotAgeMs,
          avgSnapshotAgeJitterMs,
          extrapolatingPlayers,
          droppedStale: totalDroppedStale,
          droppedOutOfOrderSeq: totalDroppedOutOfOrderSeq,
          droppedStaleTimestamp: totalDroppedStaleTimestamp,
          droppedTooOld: totalDroppedTooOld,
          timestampCorrected: totalTimestampCorrected,
          queueOrderViolations: totalQueueOrderViolations,
          snapshotQueueSummary,
          latestSnapshotAgeMs: latestAcceptedSnapshotAgeMs,
          serverClockOffsetMs,
          inputSourcesSummary,
          inputIntentX,
          inputIntentZ,
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
  const showModePicker = gameMode === "unselected";
  const showMultiplayerResult = gameMode === "multiplayer" && raceResult != null;
  const showSoloResult = gameMode === "solo" && trialState === "finished";
  const multiplayerRaceInProgress =
    gameMode === "multiplayer" &&
    racePhase === "racing" &&
    trialState !== "finished";
  const multiplayerMenusVisible = gameMode === "multiplayer" && racePhase === "waiting";
  const showRaceLobby =
    multiplayerMenusVisible && !showMultiplayerResult;
  const showMultiplayerNetworkUi =
    multiplayerMenusVisible && !multiplayerRaceInProgress;
  const gameplayUiVisible =
    !showModePicker && !showRaceLobby && !showMultiplayerResult && !showSoloResult;
  const showFloatingGyroCalibrateButton =
    gameplayUiVisible &&
    tiltStatus.supported &&
    tiltStatus.enabled &&
    tiltStatus.permission === "granted";
  const creatingLobby =
    gameMode === "multiplayer" &&
    !roomCode &&
    (netStatus === "connecting" || netStatus === "connected");
  const waitingForPlayers = gameMode === "multiplayer" && playersInRoom.length < 2;
  const twoPlayersInLobby = gameMode === "multiplayer" && playersInRoom.length === 2;
  const joinHandshakePending =
    gameMode === "multiplayer" &&
    netStatus !== "disconnected" &&
    joinTiming != null &&
    joinTiming.stage !== "hello_ack";
  const localPlayer =
    localPlayerId.length > 0
      ? playersInRoom.find((player) => player.playerId === localPlayerId)
      : undefined;
  const remotePlayer = playersInRoom.find((player) => player.playerId !== localPlayerId);
  const playerOneName = localPlayer?.name || playerNameInput || "Player 1";
  const playerTwoName =
    remotePlayer?.name || remotePlayer?.playerId || (playersInRoom.length > 1 ? "Player 2" : "Waiting...");
  const playerOneReady = localPlayerId ? readyPlayerIds.includes(localPlayerId) : false;
  const playerTwoReady = remotePlayer ? readyPlayerIds.includes(remotePlayer.playerId) : false;
  const canToggleLobbyReady =
    netStatus === "connected" &&
    Boolean(roomCode) &&
    Boolean(localPlayerId) &&
    racePhase === "waiting" &&
    twoPlayersInLobby;
  const joinStageLabel = joinTiming
    ? (() => {
        switch (joinTiming.stage) {
          case "requested":
            return "requested";
          case "socket_connected":
            return "socket connected";
          case "join_sent":
            return "join sent";
          case "retrying":
            return "retrying";
          case "timeout":
            return "timeout";
          case "hello_ack":
            return "ready";
          default:
            return "n/a";
        }
      })()
    : "n/a";

  const getPlayerLabel = (playerId: string): string => {
    const player = playersInRoom.find((entry) => entry.playerId === playerId);
    if (player?.name) {
      return player.name;
    }
    if (playerId === localPlayerId) {
      return playerNameInput || "You";
    }
    return player?.name || player?.playerId || playerId;
  };

  const getResultHeadline = (): string => {
    if (!raceResult || gameMode !== "multiplayer") {
      return "Race Results";
    }
    if (!raceResult.isFinal) {
      return raceResult.winnerPlayerId === localPlayerId ? "You Finished!" : "First Finisher";
    }
    if (raceResult.tie) {
      return "Tie";
    }
    if (raceResult.winnerPlayerId === localPlayerId) {
      return "You Win";
    }
    if (raceResult.winnerPlayerId) {
      return `${getPlayerLabel(raceResult.winnerPlayerId)} Wins`;
    }
    return "Race Results";
  };

  const handleFloatingRecalibrate = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    calibrateTiltRef.current();
  };

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
          bounce: clamp(value as number, 0, 0.99),
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
    setRaceResult(null);
    raceClientRef.current?.createRoom();
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

  const startSoloRaceSequence = async () => {
    const sequenceId = soloStartSequenceRef.current + 1;
    soloStartSequenceRef.current = sequenceId;
    setRaceResult(null);
    setCountdownToken(null);
    setCountdownStartAtMs(null);
    setTrialState("idle");
    setTrialCurrentMs(null);
    hasSentFinishRef.current = false;
    countdownIndexRef.current = -1;
    countdownGoHandledRef.current = false;
    resetRef.current();
    freezeMarbleRef.current();

    if (isMobile) {
      await enableTiltRef.current();
      if (soloStartSequenceRef.current !== sequenceId) {
        return;
      }
    }

    setCountdownStartAtMs(raceClientRef.current?.getServerNowMs() ?? Date.now());
    setCountdownStepMs(1000);
    setRacePhase("countdown");
    setControlsLocked(true);
    setCountdownToken(null);
    countdownIndexRef.current = -1;
    countdownGoHandledRef.current = false;
  };

  const restartSoloRace = () => {
    void startSoloRaceSequence();
  };

  const returnToMainMenu = () => {
    raceClientRef.current?.disconnect();
    switchGameMode("unselected");
  };

  const switchGameMode = (nextMode: GameMode) => {
    if (nextMode === gameMode) {
      return;
    }
    if (nextMode !== "solo") {
      soloStartSequenceRef.current += 1;
    }
    setGameMode(nextMode);
    setCountdownStartAtMs(null);
    setCountdownToken(null);
    setRoomCode("");
    setLocalPlayerId("");
    setPlayersInRoom([]);
    setReadyPlayerIds([]);
    setLocalReady(false);
    setRaceResult(null);
    setNetError(null);
    setJoinTiming(null);
    hasSentFinishRef.current = false;
    countdownIndexRef.current = -1;
    countdownGoHandledRef.current = false;
    if (nextMode === "solo") {
      void startSoloRaceSequence();
      return;
    }
    if (nextMode === "multiplayer") {
      setDrawerOpen(false);
      raceClientRef.current?.setPreferredName(playerNameRef.current || undefined);
      raceClientRef.current?.createRoom();
    }
    setRacePhase("waiting");
    setControlsLocked(true);
    setTrialState("idle");
    setTrialCurrentMs(null);
    resetRef.current();
    freezeMarbleRef.current();
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
      <p className="versionBadge">Version {APP_VERSION}</p>
      <div className="viewport" ref={mountRef} />
      {showModePicker ? (
        <div className="raceOverlay menuOverlay">
          <div className="raceOverlayCard menuCard">
            <div className="menuTitleWrap">
              <h1 className="menuGameTitle">Get Tilted</h1>
            </div>
            <p className="menuIntroText">Choose a mode to begin.</p>
            <div className="modePickerButtons">
              <button
                type="button"
                className="modeButton"
                onClick={() => switchGameMode("solo")}
              >
                Single Player
              </button>
              <button
                type="button"
                className="modeButton"
                onClick={() => switchGameMode("multiplayer")}
              >
                Multiplayer
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showRaceLobby ? (
        <div className="raceOverlay menuOverlay multiplayerLobbyOverlay">
          <div className="raceOverlayCard multiplayerLobbyCard">
            <button type="button" className="lobbyBackButton" onClick={returnToMainMenu}>
              {"< Back"}
            </button>
            <p className="raceOverlayTitle">Multiplayer Lobby</p>
            <p className="lobbyCodeLabel">Lobby Code</p>
            <p className="lobbyCodeValue">{roomCode || "----"}</p>
            <div className="lobbyQrWrap">
              {twoPlayersInLobby ? (
                <button
                  type="button"
                  className={`readyButton lobbyCenterReadyButton ${localReady ? "ready" : ""}`}
                  onClick={() => void toggleReady()}
                  disabled={!canToggleLobbyReady}
                >
                  {localReady ? "UNREADY" : "READY"}
                </button>
              ) : qrImageUrl ? (
                <img className="lobbyQrImage" src={qrImageUrl} alt="Join room QR code" />
              ) : (
                <p className="raceHint">
                  {creatingLobby ? "Creating lobby..." : "QR available after room creation."}
                </p>
              )}
            </div>
            {joinHostWarning ? <p className="raceHint">{joinHostWarning}</p> : null}
            <div className="lobbyPlayersSplit">
              <div className="lobbyPlayerCard">
                <p className="lobbyPlayerSlotLabel">Player 1</p>
                <label className="controlLabel lobbyNameField" htmlFor="lobbyPlayerName">
                  Marble Name (Optional)
                </label>
                <input
                  id="lobbyPlayerName"
                  className="lobbyNameInput"
                  value={playerNameInput}
                  onChange={(event) => setPlayerNameInput(sanitizePlayerName(event.target.value))}
                  placeholder="Enter name"
                  maxLength={18}
                  autoComplete="nickname"
                />
                <p className="lobbyPlayerNameValue">{playerOneName}</p>
                <div className="lobbyReadyRow">
                  <div className={`lobbyReadyIndicator ${playerOneReady ? "ready" : "notReady"}`} />
                  <p className={`lobbyReadyStatus ${playerOneReady ? "ready" : "notReady"}`}>
                    {playerOneReady ? "READY" : "NOT READY"}
                  </p>
                </div>
              </div>
              <div className="lobbyPlayerCard">
                <p className="lobbyPlayerSlotLabel">Player 2</p>
                <p className="lobbyPlayerNameValue">{playerTwoName}</p>
                <div className="lobbyReadyRow">
                  <div className={`lobbyReadyIndicator ${playerTwoReady ? "ready" : "notReady"}`} />
                  <p className={`lobbyReadyStatus ${playerTwoReady ? "ready" : "notReady"}`}>
                    {playerTwoReady ? "READY" : "NOT READY"}
                  </p>
                </div>
              </div>
            </div>
            <p>Players: {playersInRoom.length}/2</p>
            {joinHandshakePending ? (
              <p className="raceHint">
                Joining room ({joinStageLabel}
                {joinTiming && joinTiming.retryCount > 0
                  ? `, retry ${joinTiming.retryCount}/${2}`
                  : ""}
                )...
              </p>
            ) : null}
            {creatingLobby ? <p className="raceHint">Waiting for room code...</p> : null}
            {waitingForPlayers ? <p className="raceHint">Waiting for second player.</p> : null}
            {!tiltStatus.supported ? (
              <p className="raceHint">
                Tilt unavailable on this device. Fallback controls enabled.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {showMultiplayerResult ? (
        <div className="raceOverlay raceResultOverlay">
          <div className={`raceResultCelebration ${raceResult?.isFinal ? "final" : "live"}`}>
            {RESULT_SPARKLES.map((sparkleIndex) => (
              <span key={sparkleIndex} className={`sparkle s${sparkleIndex + 1}`} />
            ))}
          </div>
          <div className="raceOverlayCard raceResultCard">
            <p className="raceOverlayTitle">Race Results</p>
            <p className="raceResultHeadline">{getResultHeadline()}</p>
            <div className="raceResultsTable">
              {raceResult.results.map((entry) => {
                const isLocal = entry.playerId === localPlayerId;
                return (
                  <p
                    key={entry.playerId}
                    className={`raceResultRow ${isLocal ? "local" : ""}`}
                  >
                    <span>{getPlayerLabel(entry.playerId)}</span>
                    <span>
                      {entry.status === "finished" && typeof entry.elapsedMs === "number"
                        ? formatTimeMs(entry.elapsedMs)
                        : "DNF"}
                    </span>
                  </p>
                );
              })}
            </div>
            <p className="raceHint">
              {raceResult.isFinal
                ? "Both players press READY to start rematch."
                : "Waiting for the next marble to finish..."}
            </p>
            {raceResult.isFinal ? (
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
                {localReady ? "UNREADY REMATCH" : "READY FOR REMATCH"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {showSoloResult ? (
        <div className="raceOverlay">
          <div className="raceOverlayCard raceResultCard">
            <p className="raceOverlayTitle">Race Results</p>
            <p className="raceResultHeadline">Solo Finished</p>
            <p>Time: {formatTimeMs(trialLastMs)}</p>
            <p>Best: {formatTimeMs(trialBestMs)}</p>
            <button type="button" className="readyButton ready" onClick={restartSoloRace}>
              RESTART RACE
            </button>
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
      {showFloatingGyroCalibrateButton ? (
        <button
          type="button"
          className="floatingGyroCalibrateButton"
          onClick={handleFloatingRecalibrate}
        >
          Recalibrate
        </button>
      ) : null}
      {showMultiplayerNetworkUi || gameMode === "solo" ? (
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
                  min={0}
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
                  max={0.99}
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
            <p>Join stage: {joinStageLabel}</p>
            <p>Join retries: {joinTiming?.retryCount ?? "n/a"}</p>
            <p>
              Join req → socket (ms):{" "}
              {joinTiming?.elapsedToSocketConnectedMs == null
                ? "n/a"
                : joinTiming.elapsedToSocketConnectedMs}
            </p>
            <p>
              Join req → send (ms):{" "}
              {joinTiming?.elapsedToJoinSentMs == null
                ? "n/a"
                : joinTiming.elapsedToJoinSentMs}
            </p>
            <p>
              Join req → ack (ms):{" "}
              {joinTiming?.elapsedToHelloAckMs == null
                ? "n/a"
                : joinTiming.elapsedToHelloAckMs}
            </p>
            <p>Players: {playersInRoom.length}</p>
            <p>Ready players: {readyPlayerIds.length}</p>
            <p>Race phase: {racePhase}</p>
            <p>Controls locked: {controlsLocked ? "yes" : "no"}</p>
            <p>Ghost players: {netSmoothing.ghostPlayers}</p>
            <p>Ghost interp delay (avg ms): {netSmoothing.avgDelayMs.toFixed(1)}</p>
            <p>Ghost jitter (avg ms): {netSmoothing.avgJitterMs.toFixed(1)}</p>
            <p>Ghost snapshot age (avg ms): {netSmoothing.avgSnapshotAgeMs.toFixed(1)}</p>
            <p>Ghost snapshot age jitter (avg ms): {netSmoothing.avgSnapshotAgeJitterMs.toFixed(1)}</p>
            <p>Ghost extrapolating: {netSmoothing.extrapolatingPlayers}</p>
            <p>Dropped stale packets: {netSmoothing.droppedStale}</p>
            <p>Dropped out-of-order seq: {netSmoothing.droppedOutOfOrderSeq}</p>
            <p>Dropped stale timestamp: {netSmoothing.droppedStaleTimestamp}</p>
            <p>Dropped too-old packets: {netSmoothing.droppedTooOld}</p>
            <p>Timestamp corrections: {netSmoothing.timestampCorrected}</p>
            <p>Queue order violations: {netSmoothing.queueOrderViolations}</p>
            <p>Snapshot queues: {netSmoothing.snapshotQueueSummary}</p>
            <p>
              Latest snapshot age (ms):{" "}
              {netSmoothing.latestSnapshotAgeMs == null
                ? "n/a"
                : netSmoothing.latestSnapshotAgeMs.toFixed(1)}
            </p>
            <p>Server clock offset (ms): {netSmoothing.serverClockOffsetMs.toFixed(1)}</p>
            <p>Input sources: {netSmoothing.inputSourcesSummary}</p>
            <p>
              Input intent: {netSmoothing.inputIntentX.toFixed(2)},{" "}
              {netSmoothing.inputIntentZ.toFixed(2)}
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
            {joinUrl ? <p className="joinUrl">{joinUrl}</p> : null}
          </div>
        ) : null}

        {activeDebugTab === "diagnostics" ? (
          <div className="debugSection">
            <p className="buildIdText">Build ID: {BUILD_ID}</p>
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
