import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import {
  createTrack,
  type CreateTrackOptions,
  type TrackBuildResult,
} from "./track/createTrack";
import { RingBuffer } from "./RingBuffer";
import {
  debugStore,
  useDebugStore,
  useNetStore,
} from "./debugStore";
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
import { DebugScalarControl } from "../ui/DebugScalarControl";
import {
  RaceClient,
  type JoinTimingSnapshot,
  type RacePlayer,
} from "../net/raceClient";
import { APP_VERSION, BUILD_ID } from "../buildInfo";
import { ROOM_MAX_CLIENTS, type TypedMessage } from "@get-tilted/shared-protocol";
import {
  resolveDefaultWsUrl,
  resolveWsUrlForHost,
  type WSStatus,
} from "../net/wsClient";
import {
  createMobileGovernor,
  type MobilePerfTier,
} from "./perf/mobileGovernor";
import type {
  TuningState,
  TrialState,
  RacePhase,
  GameMode,
  GhostSnapshot,
  GhostRenderState,
  RaceResultPayload,
} from "./gameTypes";
import {
  TIMESTEP,
  MAX_FRAME_DELTA,
  LOOK_HEIGHT,
  LOOK_AHEAD,
  BOARD_TILT_SMOOTH,
  PIVOT_SMOOTH,
  SIDE_IMPACT_NORMAL_UP_DOT_MAX,
  SIDE_IMPACT_UPWARD_SPEED_MIN,
  SIDE_IMPACT_UPWARD_DAMPING,
  SOURCE_RATE_MS,
  INTERP_DELAY_MIN_MS,
  INTERP_DELAY_MAX_MS,
  INTERP_DELAY_RISE_BLEND,
  INTERP_DELAY_FALL_BLEND,
  EXTRAPOLATION_MAX_MS,
  SNAPSHOT_MAX_AGE_MS,
  TAB_BACKGROUND_THRESHOLD_MS,
  SNAPSHOT_QUEUE_CAPACITY,
  INPUT_LABELS,
  MOBILE_SAFE_RENDER_SCALE_MIN,
  MOBILE_SAFE_RENDER_SCALE_MAX,
  MOBILE_RENDER_SCALE_MIN,
  MOBILE_RENDER_SCALE_MAX,
  TUNING_STORAGE_KEY,
  BEST_TIME_STORAGE_KEY,
  DEV_JOIN_HOST_KEY,
  PLAYER_NAME_STORAGE_KEY,
  MARBLE_SKIN_STORAGE_KEY,
  GYRO_ENABLED_STORAGE_KEY,
  MUSIC_ENABLED_STORAGE_KEY,
  SOUND_ENABLED_STORAGE_KEY,
  DEBUG_MENU_ENABLED_STORAGE_KEY,
  TRACK_LAB_LIBRARY_STORAGE_KEY,
  TRACK_LAB_SEED_STORAGE_KEY,
  TRACK_LAB_PIECE_COUNT_STORAGE_KEY,
  COUNTDOWN_LABELS,
  RESULT_SPARKLES,
  DRAWER_TABS,
  DEFAULT_TUNING,
} from "./gameConstants";
import {
  clamp,
  sanitizeJoinHost,
  sanitizePlayerName,
  isEditableEventTarget,
  isFirefoxAndroidUserAgent,
  isLocalHost,
  extractHostname,
  buildCanonicalTuning,
  sanitizeTuning,
  loadTuning,
  formatTimeMs,
  createMarbleTexture,
  acquireSnapshot,
  releaseSnapshot,
} from "./gameUtils";
import {
  getDefaultSkinId,
  getSkinCatalog,
  resolveSkinById,
} from "./skins";
import {
  DEFAULT_TRACK_SEED,
  TRACK_PIECE_COUNT_DEFAULT,
  buildTrackBlueprint,
  createDefaultCustomPiece,
  randomTrackSeed,
  sanitizeTrackPieceCount,
  sanitizeTrackPieceLibrary,
  sanitizeTrackPieceTemplate,
  sanitizeTrackSeed,
  type TrackGenerationPolicy,
  type TrackPieceKind,
  type TrackPieceTemplate,
} from "./track/modularTrack";
import {
  DEFAULT_RUNTIME_TRACK_WIDTH,
  SOLO_GAUNTLET_NAME,
  buildSoloGauntletCourse,
  buildTemporaryThreeStraightForcedPieces,
  buildTestAllForcedPieces,
} from "./track/temporary/temporaryThreeStraightTrack";
import {
  EDITOR_REFERENCE_MARBLE_RADIUS,
  clampEditorReferenceMarble,
  clampEditorObstacle,
  createDefaultEditorLayout,
  createEditorViewTransform,
  getEditorTemplateLength,
  getEditorTrackGeometry,
  projectWorldPointToTemplate,
  sanitizeEditorLayout,
  sampleEditorPose,
  viewToEditorWorld,
  worldToEditorView,
  type EditorLayout,
  type EditorObstacle,
  type EditorShapeKind,
  type EditorTemplateKind,
} from "./editor2d";
import "./editor2d.css";

const skinCatalog = getSkinCatalog();
const defaultSkinId = getDefaultSkinId();
const MAX_LOBBY_SLOTS = ROOM_MAX_CLIENTS;
const OFF_COURSE_RESPAWN_DELAY_MS = 1000;
const GHOST_SPIN_STEP_MAX_RAD = Math.PI * 0.85;
const WALL_CONTAINMENT_EPSILON = 0.015;
const WALL_SQUEEZE_WALL_CONTACT_EPSILON = 0.01;
const WALL_SQUEEZE_CONTACT_PADDING_X = 0.01;
const WALL_SQUEEZE_CONTACT_PADDING_Z = 0.02;
const WALL_SQUEEZE_POP_CLEARANCE_Z = 0.16;
const WALL_SQUEEZE_MIN_ESCAPE_FORWARD_SPEED = 2.6;
const WALL_SQUEEZE_CONFIRM_FRAMES = 2;
const MOVING_OBSTACLE_CONTACT_FRICTION = 0.02;
const COLLISION_GROUP_MARBLE = 1 << 0;
const COLLISION_GROUP_TRACK_FLOOR = 1 << 1;
const COLLISION_GROUP_TRACK_WALL = 1 << 2;
const COLLISION_GROUP_OBSTACLE = 1 << 3;
const COLLISION_MASK_MARBLE =
  COLLISION_GROUP_TRACK_FLOOR | COLLISION_GROUP_TRACK_WALL | COLLISION_GROUP_OBSTACLE;
const COLLISION_MASK_TRACK = COLLISION_GROUP_MARBLE;
const CONTACT_SHADOW_RAYCAST_MAX_DIST = 5;
const CONTACT_SHADOW_FADE_MAX_DIST = 1.8;
const CONTACT_SHADOW_SURFACE_OFFSET = 0.02;
const CONTACT_SHADOW_MAX_OPACITY = 0.22;
const CONTACT_SHADOW_BASE_SCALE = 0.52;
const CONTACT_SHADOW_SCALE_RANGE = 0.26;
const SCENE_BACKGROUND_COLOR = 0x0b1320;
const CAMERA_FAR_PLANE = 2200;
const DISTANCE_FADE_START = 350;
const DISTANCE_FADE_END = 1200;
const EDITOR_LAYOUT_STORAGE_KEY = "get-tilted:v0.8.7.0:editor-layout";
const EDITOR_VIEWBOX_WIDTH = 760;
const EDITOR_VIEWBOX_HEIGHT = 420;
const EDITOR_TRACK_PADDING = 34;
const MAX_SPEED_SLIDER_MIN = 4;
const MAX_SPEED_SLIDER_MAX = 20;
const MAX_SPEED_TUNING_MAX = 60;
const SHADOW_LIGHT_OFFSET_X_MIN = -30;
const SHADOW_LIGHT_OFFSET_X_MAX = 30;
const SHADOW_LIGHT_OFFSET_Y_MIN = 2;
const SHADOW_LIGHT_OFFSET_Y_MAX = 40;
const SHADOW_LIGHT_OFFSET_Z_MIN = -30;
const SHADOW_LIGHT_OFFSET_Z_MAX = 30;
type MenuScreen = "main" | "options" | "trackLab" | "editor";
type OptionsSubmenu = "root" | "controls" | "camera";
type TrackCatalogMode = "builtin" | "builtin_plus_custom";
type TrackLayoutPreset = "default" | "testAll";
const SOLO_TRACK_GENERATION_POLICY: TrackGenerationPolicy = "singleplayer_camera_friendly_10";

type EditorShapeDraft = {
  shape: EditorShapeKind;
  name: string;
  width: number;
  length: number;
  depth: number;
  yawDeg: number;
  x: number;
  z: number;
};

type EditorDragState = {
  target: "obstacle" | "reference_marble";
  obstacleId: string | null;
  pointerId: number;
  offsetX: number;
  offsetZ: number;
};

type RuntimeTrackConfig = {
  seed: string;
  pieceCount: number;
  catalogMode: TrackCatalogMode;
  customPieces: TrackPieceTemplate[];
  layoutPreset: TrackLayoutPreset;
  generationPolicy?: TrackGenerationPolicy;
  trackVisualSettings?: TrackVisualSettings;
};

type TrackVisualSettings = {
  objectTransparencyPercent: number;
  showObjectWireframes: boolean;
  wireframeUsesObjectTransparency: boolean;
};

type RuntimeContainmentSample = {
  center: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  tangent: THREE.Vector3;
  halfWidth: number;
  railLeft: boolean;
  railRight: boolean;
};

type TrackPieceDraft = Omit<TrackPieceTemplate, "id">;

function readQueryParam(name: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = new URLSearchParams(window.location.search).get(name);
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function readQueryBoolean(name: string): boolean | null {
  const raw = readQueryParam(name);
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return null;
}

function readInitialRoomCode(): string {
  const room = readQueryParam("room");
  return room ? room.toUpperCase() : "";
}

function readStoredToggle(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") {
    return defaultValue;
  }
  const stored = window.localStorage.getItem(key);
  if (stored == null) {
    return defaultValue;
  }
  return stored === "1";
}

function readStoredTrackSeed(): string {
  const querySeed = readQueryParam("seed");
  if (querySeed) {
    return sanitizeTrackSeed(querySeed);
  }
  if (typeof window === "undefined") {
    return DEFAULT_TRACK_SEED;
  }
  return sanitizeTrackSeed(window.localStorage.getItem(TRACK_LAB_SEED_STORAGE_KEY));
}

function readStoredTrackPieceCount(): number {
  if (typeof window === "undefined") {
    return TRACK_PIECE_COUNT_DEFAULT;
  }
  const raw = window.localStorage.getItem(TRACK_LAB_PIECE_COUNT_STORAGE_KEY);
  return sanitizeTrackPieceCount(raw ? Number(raw) : TRACK_PIECE_COUNT_DEFAULT);
}

function readStoredBestTimesBySeed(): Record<string, number> {
  if (typeof window === "undefined") {
    return {};
  }
  const raw = window.localStorage.getItem(BEST_TIME_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed).filter(
      ([seed, value]) =>
        typeof seed === "string" &&
        Number.isFinite(value) &&
        typeof value === "number" &&
        value >= 0,
    ) as Array<[string, number]>;
    if (entries.length > 0) {
      return Object.fromEntries(entries.map(([seed, value]) => [sanitizeTrackSeed(seed), value]));
    }
  } catch {
    const legacyBest = Number(raw);
    if (Number.isFinite(legacyBest) && legacyBest >= 0) {
      return {
        [readStoredTrackSeed()]: legacyBest,
      };
    }
  }
  return {};
}

function readStoredBestTimeForSeed(seed: string): number | null {
  const bestTimesBySeed = readStoredBestTimesBySeed();
  const value = bestTimesBySeed[sanitizeTrackSeed(seed)];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function writeStoredBestTimeForSeed(seed: string, value: number | null): void {
  if (typeof window === "undefined") {
    return;
  }
  const nextSeed = sanitizeTrackSeed(seed);
  const bestTimesBySeed = readStoredBestTimesBySeed();
  if (value == null) {
    delete bestTimesBySeed[nextSeed];
  } else {
    bestTimesBySeed[nextSeed] = value;
  }
  const entries = Object.entries(bestTimesBySeed).filter(([, storedValue]) => storedValue >= 0);
  if (entries.length === 0) {
    window.localStorage.removeItem(BEST_TIME_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(BEST_TIME_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function readStoredTrackLibrary(): TrackPieceTemplate[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(TRACK_LAB_LIBRARY_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return sanitizeTrackPieceLibrary(parsed);
  } catch {
    return [];
  }
}

function createDefaultEditorShapeDraft(template: EditorTemplateKind): EditorShapeDraft {
  const templateLength = getEditorTemplateLength(template);
  const midDistance = Math.round(templateLength * 0.5 * 10) / 10;
  return {
    shape: "rectangle",
    name: "Obstacle",
    width: 1.4,
    length: 1.8,
    depth: 1.7,
    yawDeg: 0,
    x: 0,
    z: midDistance,
  };
}

function sanitizeEditorShapeDraft(
  input: Partial<EditorShapeDraft>,
  template: EditorTemplateKind,
): EditorShapeDraft {
  const defaults = createDefaultEditorShapeDraft(template);
  const shape: EditorShapeKind =
    input.shape === "triangle" || input.shape === "circle" ? input.shape : "rectangle";
  const width = clamp(
    typeof input.width === "number" && Number.isFinite(input.width)
      ? input.width
      : defaults.width,
    0.35,
    9,
  );
  const length = clamp(
    typeof input.length === "number" && Number.isFinite(input.length)
      ? input.length
      : defaults.length,
    0.35,
    14,
  );
  const depth = clamp(
    typeof input.depth === "number" && Number.isFinite(input.depth)
      ? input.depth
      : defaults.depth,
    0.2,
    8,
  );
  const yawDeg = clamp(
    typeof input.yawDeg === "number" && Number.isFinite(input.yawDeg)
      ? input.yawDeg
      : defaults.yawDeg,
    -180,
    180,
  );
  const x =
    typeof input.x === "number" && Number.isFinite(input.x) ? input.x : defaults.x;
  const z = clamp(
    typeof input.z === "number" && Number.isFinite(input.z) ? input.z : defaults.z,
    0,
    getEditorTemplateLength(template),
  );
  return {
    shape,
    name:
      typeof input.name === "string" && input.name.trim().length > 0
        ? input.name.trim().slice(0, 48)
        : defaults.name,
    width: shape === "circle" ? Math.max(width, length) : width,
    length: shape === "circle" ? Math.max(width, length) : length,
    depth,
    yawDeg,
    x,
    z,
  };
}

function readStoredEditorLayout(): EditorLayout {
  if (typeof window === "undefined") {
    return createDefaultEditorLayout();
  }
  const raw = window.localStorage.getItem(EDITOR_LAYOUT_STORAGE_KEY);
  if (!raw) {
    return createDefaultEditorLayout();
  }
  try {
    return sanitizeEditorLayout(JSON.parse(raw), createDefaultEditorLayout());
  } catch {
    return createDefaultEditorLayout();
  }
}

function createDefaultTrackVisualSettings(): TrackVisualSettings {
  return {
    objectTransparencyPercent: DEFAULT_TUNING.objectTransparencyPercent,
    showObjectWireframes: DEFAULT_TUNING.showObjectWireframes,
    wireframeUsesObjectTransparency: DEFAULT_TUNING.wireframeUsesObjectTransparency,
  };
}

function sanitizeTrackVisualSettings(input: unknown): TrackVisualSettings {
  const defaults = createDefaultTrackVisualSettings();
  if (!input || typeof input !== "object") {
    return defaults;
  }
  const value = input as Partial<TrackVisualSettings>;
  return {
    objectTransparencyPercent: clamp(
      typeof value.objectTransparencyPercent === "number" &&
        Number.isFinite(value.objectTransparencyPercent)
        ? value.objectTransparencyPercent
        : defaults.objectTransparencyPercent,
      0,
      85,
    ),
    showObjectWireframes:
      typeof value.showObjectWireframes === "boolean"
        ? value.showObjectWireframes
        : defaults.showObjectWireframes,
    wireframeUsesObjectTransparency:
      typeof value.wireframeUsesObjectTransparency === "boolean"
        ? value.wireframeUsesObjectTransparency
        : defaults.wireframeUsesObjectTransparency,
  };
}

function toTrackVisualSettingsFromTuning(tuning: TuningState): TrackVisualSettings {
  return sanitizeTrackVisualSettings({
    objectTransparencyPercent: tuning.objectTransparencyPercent,
    showObjectWireframes: tuning.showObjectWireframes,
    wireframeUsesObjectTransparency: tuning.wireframeUsesObjectTransparency,
  });
}

function sanitizeTrackGenerationPolicy(input: unknown): TrackGenerationPolicy {
  return input === "singleplayer_camera_friendly_10"
    ? "singleplayer_camera_friendly_10"
    : "default";
}

function sanitizeTrackSeedInput(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

function toTrackDraft(piece: TrackPieceTemplate): TrackPieceDraft {
  const { id, ...draft } = piece;
  void id;
  return draft;
}

function createTrackOptionsFromConfig(config: RuntimeTrackConfig): CreateTrackOptions {
  const seed = sanitizeTrackSeed(config.seed);
  const isTestAll = config.layoutPreset === "testAll";
  const sanitizedGenerationPolicy = sanitizeTrackGenerationPolicy(config.generationPolicy);
  const trackVisualSettings = sanitizeTrackVisualSettings(config.trackVisualSettings);
  if (isTestAll) {
    const testPieces = buildTestAllForcedPieces();
    const blueprint = buildTrackBlueprint({
      config: { seed, pieceCount: testPieces.length },
      customPieces: [],
      includeCustomPieces: false,
      trackWidth: DEFAULT_RUNTIME_TRACK_WIDTH,
      enableBranchPieces: false,
      maxHeadingDriftDeg: 18,
      enforceBendPairs: false,
      generationPolicy: "default",
      forcedMainPieces: testPieces,
      disableStarterSequence: true,
    });
    return {
      seed,
      blueprint,
      visualSettings: {
        objectTransparencyPercent: trackVisualSettings.objectTransparencyPercent,
        showObjectWireframes: trackVisualSettings.showObjectWireframes,
        wireframeUsesObjectTransparency: trackVisualSettings.wireframeUsesObjectTransparency,
      },
      blueprintObstacleSettings: {
        enableHoleSetPieces: true,
        safeStartStraightCount: 0,
        forceHoleSpawnOnAll: true,
      },
    };
  }
  if (sanitizedGenerationPolicy === "singleplayer_camera_friendly_10") {
    const soloCourse = buildSoloGauntletCourse(seed);
    const blueprint = buildTrackBlueprint({
      config: { seed, pieceCount: soloCourse.forcedMainPieces.length },
      customPieces: [],
      includeCustomPieces: false,
      trackWidth: DEFAULT_RUNTIME_TRACK_WIDTH,
      enableBranchPieces: false,
      maxHeadingDriftDeg: 18,
      enforceBendPairs: false,
      generationPolicy: "default",
      forcedMainPieces: soloCourse.forcedMainPieces,
      disableStarterSequence: true,
    });
    return {
      seed,
      blueprint,
      visualSettings: {
        objectTransparencyPercent: trackVisualSettings.objectTransparencyPercent,
        showObjectWireframes: trackVisualSettings.showObjectWireframes,
        wireframeUsesObjectTransparency: trackVisualSettings.wireframeUsesObjectTransparency,
      },
      blueprintObstacleSettings: {
        enableMovingObstacles: soloCourse.enableMovingObstacles,
        enableHoleSetPieces: soloCourse.enableHoleSetPieces,
        safeStartStraightCount: soloCourse.movingObstacleSafeStartStraightCount,
        manualTestPieces: soloCourse.manualSetPieces,
        manualTestTuning: soloCourse.manualSetPieceTuning,
      },
    };
  }
  // Temporary quarantine mode: active generation uses a seeded forced-piece layout.
  const forcedMainPieces = buildTemporaryThreeStraightForcedPieces(seed);
  const blueprint = buildTrackBlueprint({
    config: { seed, pieceCount: forcedMainPieces.length },
    customPieces: [],
    includeCustomPieces: false,
    trackWidth: DEFAULT_RUNTIME_TRACK_WIDTH,
    enableBranchPieces: false,
    maxHeadingDriftDeg: 18,
    enforceBendPairs: false,
    generationPolicy: "default",
    forcedMainPieces,
    disableStarterSequence: true,
  });
  return {
    seed,
    blueprint,
    visualSettings: {
      objectTransparencyPercent: trackVisualSettings.objectTransparencyPercent,
      showObjectWireframes: trackVisualSettings.showObjectWireframes,
      wireframeUsesObjectTransparency: trackVisualSettings.wireframeUsesObjectTransparency,
    },
    blueprintObstacleSettings: {
      enableHoleSetPieces: true,
      safeStartStraightCount: 1,
    },
  };
}

function buildTrackConfig(
  seed: string,
  pieceCount: number,
  catalogMode: TrackCatalogMode,
  customPieces: TrackPieceTemplate[],
  layoutPreset: TrackLayoutPreset = "default",
  trackVisualSettings?: TrackVisualSettings,
  generationPolicy: TrackGenerationPolicy = "default",
): RuntimeTrackConfig {
  const sanitizedGenerationPolicy = sanitizeTrackGenerationPolicy(generationPolicy);
  return {
    seed: sanitizeTrackSeed(seed),
    pieceCount:
      sanitizedGenerationPolicy === "singleplayer_camera_friendly_10"
        ? 10
        : sanitizeTrackPieceCount(pieceCount),
    catalogMode,
    customPieces: sanitizeTrackPieceLibrary(customPieces),
    layoutPreset,
    generationPolicy: sanitizedGenerationPolicy,
    trackVisualSettings: sanitizeTrackVisualSettings(trackVisualSettings),
  };
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
  const [isPortraitViewport, setIsPortraitViewport] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight >= window.innerWidth : true,
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
  const [trialBestMs, setTrialBestMs] = useState<number | null>(() =>
    readStoredBestTimeForSeed(readStoredTrackSeed()),
  );
  const debug = useDebugStore();
  const netSmoothing = useNetStore();
  const [netStatus, setNetStatus] = useState<WSStatus>("disconnected");
  const [netError, setNetError] = useState<string | null>(null);
  const [joinTiming, setJoinTiming] = useState<JoinTimingSnapshot | null>(null);
  const [autoJoinRoomCode] = useState(() => readInitialRoomCode());
  const initialGameMode: GameMode = autoJoinRoomCode ? "multiplayer" : "unselected";
  const [gameMode, setGameMode] = useState<GameMode>(initialGameMode);
  const [menuScreen, setMenuScreen] = useState<MenuScreen>("main");
  const [optionsSubmenu, setOptionsSubmenu] = useState<OptionsSubmenu>("root");
  const [roomCode, setRoomCode] = useState("");
  const [localPlayerId, setLocalPlayerId] = useState("");
  const [hostPlayerId, setHostPlayerId] = useState("");
  const [playersInRoom, setPlayersInRoom] = useState<RacePlayer[]>([]);
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
    const queryName = readQueryParam("name");
    if (queryName) {
      return sanitizePlayerName(queryName);
    }
    if (typeof window === "undefined") return "";
    return sanitizePlayerName(window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "");
  });
  const [selectedMarbleSkinId, setSelectedMarbleSkinId] = useState(() => {
    if (typeof window === "undefined") return defaultSkinId;
    const stored = window.localStorage.getItem(MARBLE_SKIN_STORAGE_KEY);
    return resolveSkinById(stored).id;
  });
  const [gyroEnabled, setGyroEnabled] = useState(() => {
    const queryGyro = readQueryBoolean("gyro");
    if (typeof queryGyro === "boolean") {
      return queryGyro;
    }
    return readStoredToggle(GYRO_ENABLED_STORAGE_KEY, true);
  });
  const [musicEnabled, setMusicEnabled] = useState(() =>
    readStoredToggle(MUSIC_ENABLED_STORAGE_KEY, true),
  );
  const [soundEnabled, setSoundEnabled] = useState(() =>
    readStoredToggle(SOUND_ENABLED_STORAGE_KEY, true),
  );
  const [debugMenuEnabled, setDebugMenuEnabled] = useState(() => {
    const queryDebug = readQueryBoolean("debug");
    if (typeof queryDebug === "boolean") {
      return queryDebug;
    }
    return readStoredToggle(DEBUG_MENU_ENABLED_STORAGE_KEY, false);
  });
  const [trackLabSeed, setTrackLabSeed] = useState(() => readStoredTrackSeed());
  const [trackLabPieceCount, setTrackLabPieceCount] = useState(() => readStoredTrackPieceCount());
  const [trackLabCustomPieces, setTrackLabCustomPieces] = useState<TrackPieceTemplate[]>(() =>
    readStoredTrackLibrary(),
  );
  const [trackLabSelectedPieceId, setTrackLabSelectedPieceId] = useState<string | null>(null);
  const [trackLabDraft, setTrackLabDraft] = useState<TrackPieceDraft>(() =>
    toTrackDraft(createDefaultCustomPiece("straight")),
  );
  const [trackLabStatus, setTrackLabStatus] = useState("");
  const trialBestSeedRef = useRef(readStoredTrackSeed());
  const [editorLayout, setEditorLayout] = useState<EditorLayout>(() => readStoredEditorLayout());
  const [editorSelectedObstacleId, setEditorSelectedObstacleId] = useState<string | null>(null);
  const [editorReferenceMarbleSelected, setEditorReferenceMarbleSelected] = useState(false);
  const [editorStatus, setEditorStatus] = useState("");
  const [editorAddShapeOpen, setEditorAddShapeOpen] = useState(false);
  const [editorImportText, setEditorImportText] = useState("");
  const [editorImportError, setEditorImportError] = useState("");
  const [editorShapeDraft, setEditorShapeDraft] = useState<EditorShapeDraft>(() =>
    createDefaultEditorShapeDraft("straight"),
  );
  const [multiplayerTrackSeed, setMultiplayerTrackSeed] = useState(DEFAULT_TRACK_SEED);

  const tiltStatusRef = useRef(tiltStatus);
  const touchTiltRef = useRef(touchTilt);
  const tuningRef = useRef(tuning);
  const gyroEnabledRef = useRef(gyroEnabled);
  const raceClientRef = useRef<RaceClient | null>(null);
  const playerNameRef = useRef(playerNameInput);
  const selectedMarbleSkinIdRef = useRef(selectedMarbleSkinId);
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
  const applyLocalSkinRef = useRef<(skinId: string) => void>(() => {});
  const applyTrackConfigRef = useRef<(config: RuntimeTrackConfig) => void>(() => {});
  const trackLabSeedRef = useRef(trackLabSeed);
  const trackLabPieceCountRef = useRef(trackLabPieceCount);
  const trackLabCustomPiecesRef = useRef(trackLabCustomPieces);
  const editorLayoutRef = useRef(editorLayout);
  const editorSvgRef = useRef<SVGSVGElement | null>(null);
  const editorDragStateRef = useRef<EditorDragState | null>(null);
  const multiplayerTrackSeedRef = useRef(multiplayerTrackSeed);

  const syncTrackLabSeed = (nextSeedInput: string): string => {
    const nextSeed = sanitizeTrackSeed(nextSeedInput);
    trackLabSeedRef.current = nextSeed;
    trialBestSeedRef.current = nextSeed;
    setTrackLabSeed(nextSeed);
    setTrialBestMs(readStoredBestTimeForSeed(nextSeed));
    return nextSeed;
  };

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
    const updateViewportOrientation = () => {
      const nextIsPortrait = window.innerHeight >= window.innerWidth;
      setIsPortraitViewport((prev) => (prev === nextIsPortrait ? prev : nextIsPortrait));
    };
    updateViewportOrientation();
    window.addEventListener("resize", updateViewportOrientation);
    window.addEventListener("orientationchange", updateViewportOrientation);
    return () => {
      window.removeEventListener("resize", updateViewportOrientation);
      window.removeEventListener("orientationchange", updateViewportOrientation);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    let isUnmounted = false;
    let lockUnsupported = false;
    let lockInFlight = false;
    const tryLockPortraitOrientation = async () => {
      if (isUnmounted || lockUnsupported || lockInFlight) {
        return;
      }
      const orientationApi = window.screen.orientation as
        | (ScreenOrientation & {
            lock?: (
              orientation:
                | "any"
                | "natural"
                | "landscape"
                | "portrait"
                | "portrait-primary"
                | "portrait-secondary"
                | "landscape-primary"
                | "landscape-secondary",
            ) => Promise<void>;
          })
        | undefined;
      if (!orientationApi || typeof orientationApi.lock !== "function") {
        lockUnsupported = true;
        return;
      }
      lockInFlight = true;
      try {
        await orientationApi.lock("portrait-primary");
      } catch {
        // Browsers can reject lock requests unless in fullscreen/PWA/user gesture.
      } finally {
        lockInFlight = false;
      }
    };
    void tryLockPortraitOrientation();
    const onGesture = () => {
      void tryLockPortraitOrientation();
    };
    const onFocus = () => {
      void tryLockPortraitOrientation();
    };
    const onOrientationChange = () => {
      void tryLockPortraitOrientation();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void tryLockPortraitOrientation();
      }
    };
    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("focus", onFocus);
    window.addEventListener("orientationchange", onOrientationChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      isUnmounted = true;
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("orientationchange", onOrientationChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
    gyroEnabledRef.current = gyroEnabled;
  }, [gyroEnabled]);

  useEffect(() => {
    playerNameRef.current = playerNameInput;
    raceClientRef.current?.setPreferredName(playerNameInput || undefined);
  }, [playerNameInput]);

  useEffect(() => {
    selectedMarbleSkinIdRef.current = selectedMarbleSkinId;
    raceClientRef.current?.setPreferredSkinId(
      selectedMarbleSkinId === defaultSkinId ? undefined : selectedMarbleSkinId,
    );
    applyLocalSkinRef.current(selectedMarbleSkinId);
  }, [selectedMarbleSkinId]);

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
    const visualSettings = toTrackVisualSettingsFromTuning(tuningRef.current);
    if (gameMode === "testAll") {
      applyTrackConfigRef.current(
        buildTrackConfig(
          trackLabSeedRef.current,
          trackLabPieceCountRef.current,
          "builtin",
          [],
          "testAll",
          visualSettings,
        ),
      );
      return;
    }
    if (gameMode === "solo") {
      const soloSeed = randomTrackSeed("solo");
      applyTrackConfigRef.current(
        buildTrackConfig(
          soloSeed,
          trackLabPieceCountRef.current,
          "builtin_plus_custom",
          trackLabCustomPiecesRef.current,
          "default",
          visualSettings,
          SOLO_TRACK_GENERATION_POLICY,
        ),
      );
    }
  }, [
    gameMode,
    tuning.objectTransparencyPercent,
    tuning.showObjectWireframes,
    tuning.wireframeUsesObjectTransparency,
  ]);

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
    if (typeof window === "undefined") return;
    if (selectedMarbleSkinId === defaultSkinId) {
      window.localStorage.removeItem(MARBLE_SKIN_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(MARBLE_SKIN_STORAGE_KEY, selectedMarbleSkinId);
  }, [selectedMarbleSkinId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GYRO_ENABLED_STORAGE_KEY, gyroEnabled ? "1" : "0");
  }, [gyroEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MUSIC_ENABLED_STORAGE_KEY, musicEnabled ? "1" : "0");
  }, [musicEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, soundEnabled ? "1" : "0");
  }, [soundEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DEBUG_MENU_ENABLED_STORAGE_KEY, debugMenuEnabled ? "1" : "0");
  }, [debugMenuEnabled]);

  useEffect(() => {
    trackLabSeedRef.current = trackLabSeed;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TRACK_LAB_SEED_STORAGE_KEY, sanitizeTrackSeed(trackLabSeed));
  }, [trackLabSeed]);

  useEffect(() => {
    trackLabPieceCountRef.current = trackLabPieceCount;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      TRACK_LAB_PIECE_COUNT_STORAGE_KEY,
      String(sanitizeTrackPieceCount(trackLabPieceCount)),
    );
  }, [trackLabPieceCount]);

  useEffect(() => {
    trackLabCustomPiecesRef.current = trackLabCustomPieces;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      TRACK_LAB_LIBRARY_STORAGE_KEY,
      JSON.stringify(sanitizeTrackPieceLibrary(trackLabCustomPieces)),
    );
  }, [trackLabCustomPieces]);

  useEffect(() => {
    editorLayoutRef.current = sanitizeEditorLayout(editorLayout, createDefaultEditorLayout());
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      EDITOR_LAYOUT_STORAGE_KEY,
      JSON.stringify(editorLayoutRef.current),
    );
  }, [editorLayout]);

  useEffect(() => {
    if (!editorSelectedObstacleId) {
      return;
    }
    if (!editorLayout.obstacles.some((obstacle) => obstacle.id === editorSelectedObstacleId)) {
      setEditorSelectedObstacleId(null);
    }
  }, [editorLayout, editorSelectedObstacleId]);

  useEffect(() => {
    if (!editorReferenceMarbleSelected) {
      return;
    }
    if (!editorLayout.referenceMarble) {
      setEditorReferenceMarbleSelected(false);
    }
  }, [editorLayout.referenceMarble, editorReferenceMarbleSelected]);

  useEffect(() => {
    setEditorShapeDraft((prev) => sanitizeEditorShapeDraft(prev, editorLayout.template));
  }, [editorLayout.template]);

  useEffect(() => {
    multiplayerTrackSeedRef.current = sanitizeTrackSeed(multiplayerTrackSeed);
  }, [multiplayerTrackSeed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const soloCourse = buildSoloGauntletCourse(trackLabSeed);
    window.__GET_TILTED_DIAGNOSTICS__ = {
      appVersion: APP_VERSION,
      buildId: BUILD_ID,
      gameMode,
      menuScreen,
      optionsSubmenu,
      roomCode,
      localPlayerId,
      hostPlayerId,
      playerCount: playersInRoom.length,
      playerNames: playersInRoom.map((player) => player.name?.trim() || player.playerId),
      readyPlayerIds,
      localReady,
      racePhase,
      controlsLocked,
      countdownToken,
      countdownStartAtMs,
      netStatus,
      netError,
      gyroEnabled,
      tiltEnabled: tiltStatus.enabled,
      tiltSupported: tiltStatus.supported,
      tiltPermission: tiltStatus.permission,
      debugMenuEnabled,
      trackLabSeed,
      multiplayerTrackSeed,
      soloCourseName: soloCourse.courseName,
      soloCourseTagline: soloCourse.courseTagline,
      trialState,
      trialCurrentMs,
      trialLastMs,
      trialBestMs,
      marbleSpeed: debug.speed,
      marblePos: [debug.posX, debug.posY, debug.posZ],
      ghostPlayers: netSmoothing.ghostPlayers,
    };
  }, [
    gameMode,
    menuScreen,
    optionsSubmenu,
    roomCode,
    localPlayerId,
    hostPlayerId,
    playersInRoom,
    readyPlayerIds,
    localReady,
    racePhase,
    controlsLocked,
    countdownToken,
    countdownStartAtMs,
    netStatus,
    netError,
    gyroEnabled,
    tiltStatus.enabled,
    tiltStatus.supported,
    tiltStatus.permission,
    debugMenuEnabled,
    trackLabSeed,
    multiplayerTrackSeed,
    trialState,
    trialCurrentMs,
    trialLastMs,
    trialBestMs,
    debug.posX,
    debug.posY,
    debug.posZ,
    debug.speed,
    netSmoothing.ghostPlayers,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writeStoredBestTimeForSeed(trialBestSeedRef.current, trialBestMs);
  }, [trialBestMs]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SCENE_BACKGROUND_COLOR);
    scene.fog = new THREE.Fog(
      SCENE_BACKGROUND_COLOR,
      DISTANCE_FADE_START,
      DISTANCE_FADE_END,
    );

    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, CAMERA_FAR_PLANE);
    camera.position.set(0, 7.5, 0);
    camera.lookAt(0, LOOK_HEIGHT, LOOK_AHEAD);
    camera.up.set(0, 1, 0);

    const mobileMode = window.matchMedia("(max-width: 700px)").matches;
    const firefoxAndroid = isFirefoxAndroidUserAgent();
    const initialRenderScaleCap = clamp(
      tuningRef.current.renderScaleMobile,
      MOBILE_RENDER_SCALE_MIN,
      MOBILE_RENDER_SCALE_MAX,
    );
    const mobilePerfGovernor = mobileMode && tuningRef.current.mobileSafeFallback
      ? createMobileGovernor(
          clamp(
            initialRenderScaleCap,
            MOBILE_SAFE_RENDER_SCALE_MIN,
            MOBILE_SAFE_RENDER_SCALE_MAX,
          ),
          {
            minScale: MOBILE_SAFE_RENDER_SCALE_MIN,
            maxScale: MOBILE_SAFE_RENDER_SCALE_MAX,
            targetFps: 60,
          },
        )
      : null;
    const initialRenderScale = mobilePerfGovernor?.getStats().renderScale ?? initialRenderScaleCap;
    const rendererOptions: THREE.WebGLRendererParameters = { antialias: true };
    if (firefoxAndroid) {
      rendererOptions.powerPreference = "high-performance";
      rendererOptions.stencil = false;
      (
        rendererOptions as THREE.WebGLRendererParameters & {
          desynchronized?: boolean;
        }
      ).desynchronized = true;
    }
    const renderer = new THREE.WebGLRenderer(rendererOptions);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, initialRenderScale));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;
    mount.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(
      tuningRef.current.shadowLightOffsetX,
      tuningRef.current.shadowLightOffsetY,
      tuningRef.current.shadowLightOffsetZ,
    );
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(tuningRef.current.shadowMapSize, tuningRef.current.shadowMapSize);
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 64;
    directionalLight.shadow.camera.left = -12;
    directionalLight.shadow.camera.right = 12;
    directionalLight.shadow.camera.top = 12;
    directionalLight.shadow.camera.bottom = -12;
    directionalLight.shadow.bias = -0.00025;
    directionalLight.shadow.normalBias = 0.012;
    directionalLight.shadow.radius = 1.5;
    (directionalLight.shadow.camera as THREE.OrthographicCamera).updateProjectionMatrix();
    scene.add(directionalLight);
    scene.add(directionalLight.target);

    const initialTrackConfig = buildTrackConfig(
      trackLabSeedRef.current,
      trackLabPieceCountRef.current,
      "builtin_plus_custom",
      trackLabCustomPiecesRef.current,
      "default",
      toTrackVisualSettingsFromTuning(tuningRef.current),
    );
    let track = createTrack(createTrackOptionsFromConfig(initialTrackConfig));
    scene.add(track.group);

    let boardBody = track.bodies[0];
    if (!boardBody) {
      throw new Error("Track did not provide board physics body");
    }
    let boardWallBody = track.wallBody;
    const getTrackObstacleBodies = (trackBuild: TrackBuildResult): CANNON.Body[] =>
      Array.from(new Set([...trackBuild.bodies.slice(2), ...trackBuild.movingObstacleBodies]));

    const applyTrackCollisionFiltering = (
      floorBody: CANNON.Body,
      wallBody: CANNON.Body,
      obstacleBodies: CANNON.Body[],
    ): void => {
      floorBody.collisionFilterGroup = COLLISION_GROUP_TRACK_FLOOR;
      floorBody.collisionFilterMask = COLLISION_MASK_TRACK;
      wallBody.collisionFilterGroup = COLLISION_GROUP_TRACK_WALL;
      wallBody.collisionFilterMask = COLLISION_MASK_TRACK;
      for (const obstacleBody of obstacleBodies) {
        obstacleBody.collisionFilterGroup = COLLISION_GROUP_OBSTACLE;
        obstacleBody.collisionFilterMask = COLLISION_MASK_TRACK;
      }
    };

    const isBoardWallCollisionFiltered = (
      floorBody: CANNON.Body,
      wallBody: CANNON.Body,
    ): boolean =>
      (floorBody.collisionFilterMask & wallBody.collisionFilterGroup) === 0 &&
      (wallBody.collisionFilterMask & floorBody.collisionFilterGroup) === 0;

    const world = new CANNON.World();
    const solver = world.solver as unknown as {
      iterations: number;
      tolerance: number;
    };
    solver.iterations = tuningRef.current.physicsSolverIterations;
    solver.tolerance = 1e-4;
    world.gravity.set(0, -tuningRef.current.gravityG, 0);
    applyTrackCollisionFiltering(boardBody, boardWallBody, getTrackObstacleBodies(track));
    world.addBody(boardBody);

    const boardMat = new CANNON.Material("board");
    const boardWallMat = new CANNON.Material("board-wall");
    const movingObstacleMat = new CANNON.Material("moving-obstacle");
    const marbleMat = new CANNON.Material("marble");
    boardBody.material = boardMat;
    boardWallBody.material = boardWallMat;
    track.setMovingObstacleMaterial(movingObstacleMat);

    const boardContactMat = new CANNON.ContactMaterial(marbleMat, boardMat, {
      friction: tuningRef.current.contactFriction,
      restitution: tuningRef.current.contactRestitution,
      contactEquationStiffness: 5e7,
      contactEquationRelaxation: 6,
      frictionEquationStiffness: 5e7,
      frictionEquationRelaxation: 5,
    });
    world.addContactMaterial(boardContactMat);
    world.addBody(boardWallBody);
    const boardWallContactMat = new CANNON.ContactMaterial(marbleMat, boardWallMat, {
      friction: 0,
      restitution: 0,
      contactEquationStiffness: 5e7,
      contactEquationRelaxation: 6,
      frictionEquationStiffness: 5e7,
      frictionEquationRelaxation: 5,
    });
    world.addContactMaterial(boardWallContactMat);
    const movingObstacleContactMat = new CANNON.ContactMaterial(marbleMat, movingObstacleMat, {
      friction: MOVING_OBSTACLE_CONTACT_FRICTION,
      restitution: tuningRef.current.contactRestitution,
      contactEquationStiffness: 5e7,
      contactEquationRelaxation: 6,
      frictionEquationStiffness: 5e7,
      frictionEquationRelaxation: 5,
    });
    world.addContactMaterial(movingObstacleContactMat);
    // bodies[0] = boardBody (added above), bodies[1] = boardWallBody (added above)
    // remaining entries are static and kinematic obstacle bodies
    for (const body of getTrackObstacleBodies(track)) {
      world.addBody(body);
    }

    const marbleRadius = 0.5;
    const marbleBody = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(marbleRadius),
      position: track.spawn.clone(),
      linearDamping: tuningRef.current.linearDamping,
      angularDamping: tuningRef.current.angularDamping,
      material: marbleMat,
    });
    marbleBody.collisionFilterGroup = COLLISION_GROUP_MARBLE;
    marbleBody.collisionFilterMask = COLLISION_MASK_MARBLE;
    const marbleBodyWithCcd = marbleBody as CANNON.Body & {
      ccdSpeedThreshold: number;
      ccdIterations: number;
    };
    marbleBodyWithCcd.ccdSpeedThreshold = tuningRef.current.ccdSpeedThreshold;
    marbleBodyWithCcd.ccdIterations = tuningRef.current.ccdIterations;
    world.addBody(marbleBody);

    const marbleSegments = 32;
    const ghostSegments = 24;
    const textureLoader = new THREE.TextureLoader();
    const configureSkinTexture = (texture: THREE.Texture): THREE.Texture => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
      return texture;
    };
    const loadTextureForSkinId = (skinId: string): Promise<THREE.Texture | null> => {
      const resolved = resolveSkinById(skinId);
      if (!resolved.url) {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        textureLoader.load(
          resolved.url!,
          (texture) => resolve(configureSkinTexture(texture)),
          undefined,
          () => resolve(null),
        );
      });
    };
    const marbleTexture = createMarbleTexture();
    let localSkinRequestSeq = 0;
    const marbleMesh = new THREE.Mesh(
      new THREE.SphereGeometry(marbleRadius, marbleSegments, marbleSegments),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: marbleTexture,
        roughness: 0.32,
        metalness: 0.08,
      }),
    );
    marbleMesh.castShadow = true;
    marbleMesh.receiveShadow = false;
    scene.add(marbleMesh);
    // Contact shadow assist: subtle fill to eliminate center-hole artifacts in dynamic shadow maps.
    const marbleShadowCanvas = document.createElement("canvas");
    marbleShadowCanvas.width = 128;
    marbleShadowCanvas.height = 128;
    const marbleShadowCtx = marbleShadowCanvas.getContext("2d")!;
    const marbleShadowGrad = marbleShadowCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    marbleShadowGrad.addColorStop(0, "rgba(0,0,0,0.9)");
    marbleShadowGrad.addColorStop(1, "rgba(0,0,0,0)");
    marbleShadowCtx.fillStyle = marbleShadowGrad;
    marbleShadowCtx.fillRect(0, 0, 128, 128);
    const marbleShadowTex = new THREE.CanvasTexture(marbleShadowCanvas);
    const marbleShadowMaterial = new THREE.MeshBasicMaterial({
      map: marbleShadowTex,
      transparent: true,
      depthWrite: false,
    });
    const marbleShadowMesh = new THREE.Mesh(
      new THREE.CircleGeometry(marbleRadius * 1.4, 32),
      marbleShadowMaterial,
    );
    marbleShadowMaterial.opacity = CONTACT_SHADOW_MAX_OPACITY;
    marbleShadowMesh.visible = true;
    scene.add(marbleShadowMesh);
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
    const shadowCircleNormal = new THREE.Vector3(0, 0, 1);
    const shadowRaycaster = new THREE.Raycaster();
    const shadowRayOrigin = new THREE.Vector3();
    const shadowRayDirection = new THREE.Vector3();
    const shadowHitNormalWorld = new THREE.Vector3();
    const shadowNormalMatrix = new THREE.Matrix3();
    const shadowHitResults: THREE.Intersection<THREE.Object3D<THREE.Object3DEventMap>>[] = [];
    const shadowLightTarget = new THREE.Vector3();
    const shadowLightOffset = new THREE.Vector3();
    // Pre-allocated tuples for network sends to avoid per-send GC pressure.
    const sendPos: [number, number, number] = [0, 0, 0];
    const sendQuat: [number, number, number, number] = [0, 0, 0, 0];
    const sendVel: [number, number, number] = [0, 0, 0];
    const sendTrackPos: [number, number, number] = [0, 0, 0];
    const sendTrackQuat: [number, number, number, number] = [0, 0, 0, 0];
    const boardPosThree = new THREE.Vector3();
    const boardQuatThree = new THREE.Quaternion();
    const boardInverseQuatThree = new THREE.Quaternion();
    const marblePosLocalToBoard = new THREE.Vector3();
    const localRenderPrevBoardPos = new THREE.Vector3();
    const localRenderPrevBoardQuat = new THREE.Quaternion();
    const localRenderCurrBoardPos = new THREE.Vector3();
    const localRenderCurrBoardQuat = new THREE.Quaternion();
    const localRenderPrevMarblePos = new THREE.Vector3();
    const localRenderPrevMarbleQuat = new THREE.Quaternion();
    const localRenderCurrMarblePos = new THREE.Vector3();
    const localRenderCurrMarbleQuat = new THREE.Quaternion();
    const boardPrevQuat = new THREE.Quaternion();
    const boardUpWorld = new THREE.Vector3();
    const boardRightWorld = new THREE.Vector3();
    const boardForwardWorld = new THREE.Vector3();
    const contactNormalWorld = new THREE.Vector3();
    const obstacleLocalPos = new THREE.Vector3();
    const targetLocalPos = new THREE.Vector3();
    const targetWorldPos = new THREE.Vector3();
    const containmentDelta = new THREE.Vector3();
    const containmentCorrectedLocalPos = new THREE.Vector3();
    const containmentCorrectedWorldPos = new THREE.Vector3();
    const containmentWallNormal = new THREE.Vector3();
    const ghostTrackUp = new THREE.Vector3();
    const ghostTravelDelta = new THREE.Vector3();
    const ghostSpinAxis = new THREE.Vector3();
    const ghostSpinStepQuat = new THREE.Quaternion();
    let movingObstacleBodySet = new Set(track.movingObstacleBodies);
    let curvedContainmentSamples: RuntimeContainmentSample[] = [];
    let curvedContainmentNearestIndex = 0;
    let lastCheckpointIndex = -1;
    let colliderPieceCount = track.physicsDebug.colliderPieceCount;
    let primitiveShapeCount = track.physicsDebug.primitiveShapeCount;
    let exoticTrimeshPieceCount = track.physicsDebug.exoticTrimeshPieceCount;
    let floorShapeCount = track.physicsDebug.floorShapeCount;
    let wallShapeCount = track.physicsDebug.wallShapeCount;
    let estimatedBoardWallShapeTestsPerStep =
      track.physicsDebug.estimatedBoardWallShapeTestsPerStep;
    let boardWallCollisionFiltered = isBoardWallCollisionFiltered(boardBody, boardWallBody);
    let lastShadowMapSize = -1;

    const motionTiltRef: { current: TiltSample } = {
      current: { x: 0, y: 0, z: 0 },
    };
    let stopTiltListener: (() => void) | null = null;
    let filter = makeTiltFilter({ tau: tuningRef.current.tiltFilterTau });
    let lastFilterTau = tuningRef.current.tiltFilterTau;
    let lastFilteredIntent: TiltSample = { x: 0, y: 0, z: 0 };
    let currentPitch = 0;
    let currentRoll = 0;
    let activeTiltPivotLayer: "upper" | "lower" = "upper";
    let trialStartAt: number | null = null;
    const readGateMetric = (
      gate:
        | {
            point: [number, number, number];
            normal: [number, number, number];
          }
        | undefined,
      fallbackZ: number,
      position: CANNON.Vec3,
    ): number => {
      if (!gate) {
        return position.z - fallbackZ;
      }
      const dx = position.x - gate.point[0];
      const dy = position.y - gate.point[1];
      const dz = position.z - gate.point[2];
      return dx * gate.normal[0] + dy * gate.normal[1] + dz * gate.normal[2];
    };
    let prevTrialStartMetric = readGateMetric(
      track.trialStartGateLocal,
      track.trialStartZ,
      marbleBody.position,
    );
    let prevTrialFinishMetric = readGateMetric(
      track.trialFinishGateLocal,
      track.trialFinishZ,
      marbleBody.position,
    );
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
    let inputRawIntentX = 0;
    let inputRawIntentZ = 0;
    let latestAngularSpeed = 0;
    let latestVerticalSpeed = 0;
    let latestPenetrationDepth = 0;
    let latestMarbleBoardContactCount = 0;
    let offCourseSinceMs: number | null = null;
    let squeezeBlockedFrames = 0;
    let railClampCorrectionsCounter = 0;
    let railClampCorrectionsPerSecEma = 0;
    let accumulator = 0;
    let disposed = false;

    const applyShadowRenderingConfig = (currentTuning: TuningState): void => {
      if (currentTuning.shadowMapSize !== lastShadowMapSize) {
        directionalLight.shadow.mapSize.set(currentTuning.shadowMapSize, currentTuning.shadowMapSize);
        directionalLight.shadow.map?.dispose();
        directionalLight.shadow.map = null;
        directionalLight.shadow.needsUpdate = true;
        lastShadowMapSize = currentTuning.shadowMapSize;
      }
    };

    const updateDynamicShadowFraming = (): void => {
      const currentTuning = tuningRef.current;
      shadowLightOffset.set(
        currentTuning.shadowLightOffsetX,
        currentTuning.shadowLightOffsetY,
        currentTuning.shadowLightOffsetZ,
      );
      shadowLightTarget.copy(marbleMesh.position);
      directionalLight.target.position.copy(shadowLightTarget);
      directionalLight.position.copy(shadowLightTarget).add(shadowLightOffset);
      directionalLight.target.updateMatrixWorld();
      directionalLight.updateMatrixWorld();
    };

    const updateContactShadowAssist = (trackUp: THREE.Vector3): void => {
      track.group.updateMatrixWorld(true);
      shadowRayOrigin.copy(marbleMesh.position).addScaledVector(trackUp, marbleRadius + 0.75);
      shadowRayDirection.copy(trackUp).multiplyScalar(-1);
      shadowRaycaster.set(shadowRayOrigin, shadowRayDirection);
      shadowRaycaster.far = CONTACT_SHADOW_RAYCAST_MAX_DIST;
      shadowHitResults.length = 0;
      shadowRaycaster.intersectObject(track.group, true, shadowHitResults);
      const surfaceHit = shadowHitResults.find((hit) => (hit.object as THREE.Mesh).isMesh);
      if (!surfaceHit) {
        marbleShadowMesh.visible = false;
        return;
      }

      if (surfaceHit.face) {
        shadowHitNormalWorld.copy(surfaceHit.face.normal);
        shadowNormalMatrix.getNormalMatrix(surfaceHit.object.matrixWorld);
        shadowHitNormalWorld.applyMatrix3(shadowNormalMatrix).normalize();
        if (shadowHitNormalWorld.dot(trackUp) < 0) {
          shadowHitNormalWorld.negate();
        }
      } else {
        shadowHitNormalWorld.copy(trackUp);
      }

      const surfaceDistance = marbleMesh.position.distanceTo(surfaceHit.point);
      const clearance = Math.max(0, surfaceDistance - marbleRadius);
      const clearanceAlpha = clamp(1 - clearance / CONTACT_SHADOW_FADE_MAX_DIST, 0, 1);
      const opacity = clearanceAlpha * CONTACT_SHADOW_MAX_OPACITY;
      if (opacity <= 0.002) {
        marbleShadowMesh.visible = false;
        return;
      }

      const distanceRatio = clamp(clearance / CONTACT_SHADOW_FADE_MAX_DIST, 0, 1);
      marbleShadowMaterial.opacity = opacity;
      marbleShadowMesh.visible = true;
      marbleShadowMesh.scale.set(
        CONTACT_SHADOW_BASE_SCALE + distanceRatio * CONTACT_SHADOW_SCALE_RANGE,
        CONTACT_SHADOW_BASE_SCALE + distanceRatio * CONTACT_SHADOW_SCALE_RANGE,
        1,
      );
      marbleShadowMesh.position
        .copy(surfaceHit.point)
        .addScaledVector(shadowHitNormalWorld, CONTACT_SHADOW_SURFACE_OFFSET);
      marbleShadowMesh.quaternion.setFromUnitVectors(shadowCircleNormal, shadowHitNormalWorld);
    };

    applyShadowRenderingConfig(tuningRef.current);

    const syncLocalRenderSnapshotsFromBodies = () => {
      localRenderPrevBoardPos.set(
        boardBody.position.x,
        boardBody.position.y,
        boardBody.position.z,
      );
      localRenderCurrBoardPos.copy(localRenderPrevBoardPos);
      localRenderPrevBoardQuat.set(
        boardBody.quaternion.x,
        boardBody.quaternion.y,
        boardBody.quaternion.z,
        boardBody.quaternion.w,
      );
      localRenderCurrBoardQuat.copy(localRenderPrevBoardQuat);
      localRenderPrevMarblePos.set(
        marbleBody.position.x,
        marbleBody.position.y,
        marbleBody.position.z,
      );
      localRenderCurrMarblePos.copy(localRenderPrevMarblePos);
      localRenderPrevMarbleQuat.set(
        marbleBody.quaternion.x,
        marbleBody.quaternion.y,
        marbleBody.quaternion.z,
        marbleBody.quaternion.w,
      );
      localRenderCurrMarbleQuat.copy(localRenderPrevMarbleQuat);
      track.group.position.copy(localRenderCurrBoardPos);
      track.group.quaternion.copy(localRenderCurrBoardQuat);
      marbleMesh.position.copy(localRenderCurrMarblePos);
      marbleMesh.quaternion.copy(localRenderCurrMarbleQuat);
      boardPosThree.copy(localRenderCurrBoardPos);
      boardQuatThree.copy(localRenderCurrBoardQuat);
    };

    const disposeTrack = (trackToDispose: TrackBuildResult): void => {
      const disposedTrackTextures = new Set<THREE.Texture>();
      for (const child of trackToDispose.group.children) {
        if (child instanceof THREE.Mesh) {
          for (const nested of child.children) {
            if (nested instanceof THREE.LineSegments) {
              nested.geometry.dispose();
              if (Array.isArray(nested.material)) {
                for (const material of nested.material) {
                  material.dispose();
                }
              } else {
                nested.material.dispose();
              }
            } else if (nested instanceof THREE.Sprite) {
              if (
                nested.material.map &&
                !disposedTrackTextures.has(nested.material.map)
              ) {
                disposedTrackTextures.add(nested.material.map);
                nested.material.map.dispose();
              }
              nested.material.dispose();
            }
          }
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            for (const material of child.material) {
              if (
                material instanceof THREE.MeshStandardMaterial &&
                material.map &&
                !disposedTrackTextures.has(material.map)
              ) {
                disposedTrackTextures.add(material.map);
                material.map.dispose();
              }
              material.dispose();
            }
          } else {
            if (
              child.material instanceof THREE.MeshStandardMaterial &&
              child.material.map &&
              !disposedTrackTextures.has(child.material.map)
            ) {
              disposedTrackTextures.add(child.material.map);
              child.material.map.dispose();
            }
            child.material.dispose();
          }
        }
      }
    };

    const suppressVerticalPopOnSideImpact = () => {
      tempQuatA.set(
        boardBody.quaternion.x,
        boardBody.quaternion.y,
        boardBody.quaternion.z,
        boardBody.quaternion.w,
      );
      boardUpWorld.set(0, 1, 0).applyQuaternion(tempQuatA).normalize();

      for (const contact of world.contacts) {
        const isMarbleBoardPair =
          (contact.bi === marbleBody && (contact.bj === boardBody || contact.bj === boardWallBody)) ||
          ((contact.bi === boardBody || contact.bi === boardWallBody) && contact.bj === marbleBody);
        if (!isMarbleBoardPair) {
          continue;
        }

        if (contact.bi === marbleBody) {
          contactNormalWorld.set(contact.ni.x, contact.ni.y, contact.ni.z);
        } else {
          contactNormalWorld.set(-contact.ni.x, -contact.ni.y, -contact.ni.z);
        }
        contactNormalWorld.normalize();

        const upDot = Math.abs(contactNormalWorld.dot(boardUpWorld));
        if (upDot >= SIDE_IMPACT_NORMAL_UP_DOT_MAX) {
          continue;
        }

        const upwardSpeed =
          marbleBody.velocity.x * boardUpWorld.x +
          marbleBody.velocity.y * boardUpWorld.y +
          marbleBody.velocity.z * boardUpWorld.z;
        if (upwardSpeed <= SIDE_IMPACT_UPWARD_SPEED_MIN) {
          continue;
        }

        const dampedUpwardSpeed = upwardSpeed * SIDE_IMPACT_UPWARD_DAMPING;
        const reduceBy = upwardSpeed - dampedUpwardSpeed;
        marbleBody.velocity.x -= boardUpWorld.x * reduceBy;
        marbleBody.velocity.y -= boardUpWorld.y * reduceBy;
        marbleBody.velocity.z -= boardUpWorld.z * reduceBy;
        break;
      }
    };

    const updateMarblePosLocalToBoard = (): void => {
      boardInverseQuatThree.set(
        boardBody.quaternion.x,
        boardBody.quaternion.y,
        boardBody.quaternion.z,
        boardBody.quaternion.w,
      ).invert();
      marblePosLocalToBoard.set(
        marbleBody.position.x - boardBody.position.x,
        marbleBody.position.y - boardBody.position.y,
        marbleBody.position.z - boardBody.position.z,
      );
      marblePosLocalToBoard.applyQuaternion(boardInverseQuatThree);
    };

    const resolveActivePivotLayerY = (): number => {
      const layers = track.tiltPivotLayersLocalY;
      if (!layers) {
        return 0;
      }
      return activeTiltPivotLayer === "lower" ? layers.lowerY : layers.upperY;
    };

    const updateActiveTiltPivotLayer = (): void => {
      const layers = track.tiltPivotLayersLocalY;
      if (!layers) {
        activeTiltPivotLayer = "upper";
        return;
      }
      updateMarblePosLocalToBoard();
      const marbleLocalY = marblePosLocalToBoard.y;
      if (activeTiltPivotLayer === "upper") {
        if (marbleLocalY <= layers.switchDownY) {
          activeTiltPivotLayer = "lower";
        }
      } else if (marbleLocalY >= layers.switchUpY) {
        activeTiltPivotLayer = "upper";
      }
    };

    const syncBoardPoseForContainment = (): void => {
      boardPosThree.set(boardBody.position.x, boardBody.position.y, boardBody.position.z);
      boardQuatThree.set(
        boardBody.quaternion.x,
        boardBody.quaternion.y,
        boardBody.quaternion.z,
        boardBody.quaternion.w,
      ).normalize();
    };

    const hydrateCurvedContainmentSamples = (
      source: TrackBuildResult["containmentPathLocal"],
    ): RuntimeContainmentSample[] =>
      source.map((sample) => ({
        center: new THREE.Vector3(sample.center[0], sample.center[1], sample.center[2]),
        right: new THREE.Vector3(sample.right[0], sample.right[1], sample.right[2]).normalize(),
        up: new THREE.Vector3(sample.up[0], sample.up[1], sample.up[2]).normalize(),
        tangent: new THREE.Vector3(sample.tangent[0], sample.tangent[1], sample.tangent[2]).normalize(),
        halfWidth: sample.halfWidth,
        railLeft: sample.railLeft,
        railRight: sample.railRight,
      }));

    const refreshCurvedContainment = (): void => {
      curvedContainmentSamples = hydrateCurvedContainmentSamples(track.containmentPathLocal);
      curvedContainmentNearestIndex = 0;
      lastCheckpointIndex = -1;
    };

    const findNearestCurvedContainmentIndex = (localPos: THREE.Vector3): number => {
      const count = curvedContainmentSamples.length;
      if (count === 0) {
        return -1;
      }
      const lastIndex = count - 1;
      const safeIndex = clamp(curvedContainmentNearestIndex, 0, lastIndex);
      let bestIndex = safeIndex;
      let bestDistSq = Number.POSITIVE_INFINITY;

      const windowRadius = 18;
      const minIndex = Math.max(0, safeIndex - windowRadius);
      const maxIndex = Math.min(lastIndex, safeIndex + windowRadius);
      for (let i = minIndex; i <= maxIndex; i += 1) {
        const distSq = curvedContainmentSamples[i]!.center.distanceToSquared(localPos);
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestIndex = i;
        }
      }

      curvedContainmentNearestIndex = bestIndex;
      return bestIndex;
    };

    const resolveCurvedPathContainment = (): void => {
      if (curvedContainmentSamples.length === 0) {
        return;
      }
      syncBoardPoseForContainment();
      updateMarblePosLocalToBoard();
      const sampleIndex = findNearestCurvedContainmentIndex(marblePosLocalToBoard);
      if (sampleIndex < 0) {
        return;
      }
      const sample = curvedContainmentSamples[sampleIndex]!;
      containmentDelta.copy(marblePosLocalToBoard).sub(sample.center);
      const lateralOffset = containmentDelta.dot(sample.right);
      const clampedLeft =
        sample.railLeft && lateralOffset < -sample.halfWidth ? -sample.halfWidth : lateralOffset;
      const clampedLateral =
        sample.railRight && clampedLeft > sample.halfWidth ? sample.halfWidth : clampedLeft;
      if (Math.abs(clampedLateral - lateralOffset) <= WALL_CONTAINMENT_EPSILON) {
        return;
      }
      railClampCorrectionsCounter += 1;

      const forwardOffset = containmentDelta.dot(sample.tangent);
      const verticalOffset = containmentDelta.dot(sample.up);
      containmentCorrectedLocalPos
        .copy(sample.center)
        .addScaledVector(sample.tangent, forwardOffset)
        .addScaledVector(sample.up, verticalOffset)
        .addScaledVector(sample.right, clampedLateral);
      containmentCorrectedWorldPos
        .copy(containmentCorrectedLocalPos)
        .applyQuaternion(boardQuatThree)
        .add(boardPosThree);
      marbleBody.position.set(
        containmentCorrectedWorldPos.x,
        containmentCorrectedWorldPos.y,
        containmentCorrectedWorldPos.z,
      );

      const wallNormalSign = lateralOffset > clampedLateral ? 1 : -1;
      containmentWallNormal
        .copy(sample.right)
        .multiplyScalar(wallNormalSign)
        .applyQuaternion(boardQuatThree)
        .normalize();
      const outwardSpeed =
        marbleBody.velocity.x * containmentWallNormal.x +
        marbleBody.velocity.y * containmentWallNormal.y +
        marbleBody.velocity.z * containmentWallNormal.z;
      if (outwardSpeed > 0) {
        marbleBody.velocity.x -= containmentWallNormal.x * outwardSpeed;
        marbleBody.velocity.y -= containmentWallNormal.y * outwardSpeed;
        marbleBody.velocity.z -= containmentWallNormal.z * outwardSpeed;
      }

      marbleBody.aabbNeedsUpdate = true;
      marbleBody.updateAABB();
      updateMarblePosLocalToBoard();
    };

    const countMarbleBoardContacts = (): number => {
      let count = 0;
      for (const contact of world.contacts) {
        const isMarbleBoardPair =
          (contact.bi === marbleBody && contact.bj === boardBody) ||
          (contact.bi === boardBody && contact.bj === marbleBody);
        if (!isMarbleBoardPair) {
          continue;
        }
        count += 1;
      }
      return count;
    };

    const clampMarbleWithinSideWalls = (halfWidth: number): void => {
      const clampedX = clamp(marblePosLocalToBoard.x, -halfWidth, halfWidth);
      if (Math.abs(clampedX - marblePosLocalToBoard.x) <= WALL_CONTAINMENT_EPSILON) {
        return;
      }

      targetLocalPos.set(clampedX, marblePosLocalToBoard.y, marblePosLocalToBoard.z);
      targetWorldPos.copy(targetLocalPos).applyQuaternion(boardQuatThree).add(boardPosThree);
      marbleBody.position.set(targetWorldPos.x, targetWorldPos.y, targetWorldPos.z);

      boardRightWorld.set(1, 0, 0).applyQuaternion(boardQuatThree).normalize();
      const lateralSpeed =
        marbleBody.velocity.x * boardRightWorld.x +
        marbleBody.velocity.y * boardRightWorld.y +
        marbleBody.velocity.z * boardRightWorld.z;
      const pushingPastWall = clampedX >= 0 ? lateralSpeed > 0 : lateralSpeed < 0;
      if (pushingPastWall) {
        marbleBody.velocity.x -= boardRightWorld.x * lateralSpeed;
        marbleBody.velocity.y -= boardRightWorld.y * lateralSpeed;
        marbleBody.velocity.z -= boardRightWorld.z * lateralSpeed;
      }

      marbleBody.aabbNeedsUpdate = true;
      marbleBody.updateAABB();
      updateMarblePosLocalToBoard();
    };

    const resolveWallSqueezeAgainstObstacle = (): void => {
      syncBoardPoseForContainment();
      updateMarblePosLocalToBoard();

      const containmentHalfX =
        marblePosLocalToBoard.z >= track.containmentLocal.finishStartZ
          ? track.containmentLocal.finishHalfX
          : track.containmentLocal.mainHalfX;
      clampMarbleWithinSideWalls(containmentHalfX);

      const distanceToWall = containmentHalfX - Math.abs(marblePosLocalToBoard.x);
      if (distanceToWall > WALL_SQUEEZE_WALL_CONTACT_EPSILON) {
        squeezeBlockedFrames = 0;
        return;
      }

      let bestObstacleLocalZ = 0;
      let bestObstacleHalfLength = 0;
      let bestDistanceZ = Number.POSITIVE_INFINITY;

      for (const contact of world.contacts) {
        let obstacleBody: CANNON.Body | null = null;
        if (contact.bi === marbleBody && movingObstacleBodySet.has(contact.bj)) {
          obstacleBody = contact.bj;
        } else if (contact.bj === marbleBody && movingObstacleBodySet.has(contact.bi)) {
          obstacleBody = contact.bi;
        }
        if (!obstacleBody) {
          continue;
        }

        const obstacleShape = obstacleBody.shapes[0];
        if (!(obstacleShape instanceof CANNON.Box)) {
          continue;
        }

        obstacleLocalPos.set(
          obstacleBody.position.x - boardBody.position.x,
          obstacleBody.position.y - boardBody.position.y,
          obstacleBody.position.z - boardBody.position.z,
        );
        obstacleLocalPos.applyQuaternion(boardInverseQuatThree);

        if (Math.sign(obstacleLocalPos.x) !== Math.sign(marblePosLocalToBoard.x)) {
          continue;
        }

        const deltaX = Math.abs(marblePosLocalToBoard.x - obstacleLocalPos.x);
        const deltaZ = Math.abs(marblePosLocalToBoard.z - obstacleLocalPos.z);
        const maxDeltaX = obstacleShape.halfExtents.x + marbleRadius + WALL_SQUEEZE_CONTACT_PADDING_X;
        const maxDeltaZ = obstacleShape.halfExtents.z + marbleRadius + WALL_SQUEEZE_CONTACT_PADDING_Z;
        if (deltaX > maxDeltaX || deltaZ > maxDeltaZ) {
          continue;
        }

        if (deltaZ < bestDistanceZ) {
          bestDistanceZ = deltaZ;
          bestObstacleLocalZ = obstacleLocalPos.z;
          bestObstacleHalfLength = obstacleShape.halfExtents.z;
        }
      }

      if (!Number.isFinite(bestDistanceZ)) {
        squeezeBlockedFrames = 0;
        return;
      }
      squeezeBlockedFrames += 1;
      if (squeezeBlockedFrames < WALL_SQUEEZE_CONFIRM_FRAMES) {
        return;
      }
      squeezeBlockedFrames = 0;

      const escapeDirection = marblePosLocalToBoard.z >= bestObstacleLocalZ ? 1 : -1;
      const targetX = clamp(
        marblePosLocalToBoard.x,
        -containmentHalfX + WALL_CONTAINMENT_EPSILON,
        containmentHalfX - WALL_CONTAINMENT_EPSILON,
      );
      const targetZ =
        bestObstacleLocalZ +
        escapeDirection * (bestObstacleHalfLength + marbleRadius + WALL_SQUEEZE_POP_CLEARANCE_Z);
      targetLocalPos.set(targetX, marblePosLocalToBoard.y, targetZ);
      targetWorldPos.copy(targetLocalPos).applyQuaternion(boardQuatThree).add(boardPosThree);
      marbleBody.position.set(targetWorldPos.x, targetWorldPos.y, targetWorldPos.z);

      boardForwardWorld.set(0, 0, 1).applyQuaternion(boardQuatThree).normalize();
      const forwardSpeed =
        marbleBody.velocity.x * boardForwardWorld.x +
        marbleBody.velocity.y * boardForwardWorld.y +
        marbleBody.velocity.z * boardForwardWorld.z;
      if (forwardSpeed * escapeDirection < WALL_SQUEEZE_MIN_ESCAPE_FORWARD_SPEED) {
        const desiredForwardSpeed = escapeDirection * WALL_SQUEEZE_MIN_ESCAPE_FORWARD_SPEED;
        const deltaForwardSpeed = desiredForwardSpeed - forwardSpeed;
        marbleBody.velocity.x += boardForwardWorld.x * deltaForwardSpeed;
        marbleBody.velocity.y += boardForwardWorld.y * deltaForwardSpeed;
        marbleBody.velocity.z += boardForwardWorld.z * deltaForwardSpeed;
      }

      boardRightWorld.set(1, 0, 0).applyQuaternion(boardQuatThree).normalize();
      const lateralSpeed =
        marbleBody.velocity.x * boardRightWorld.x +
        marbleBody.velocity.y * boardRightWorld.y +
        marbleBody.velocity.z * boardRightWorld.z;
      const pushingPastWall = targetX >= 0 ? lateralSpeed > 0 : lateralSpeed < 0;
      if (pushingPastWall) {
        marbleBody.velocity.x -= boardRightWorld.x * lateralSpeed;
        marbleBody.velocity.y -= boardRightWorld.y * lateralSpeed;
        marbleBody.velocity.z -= boardRightWorld.z * lateralSpeed;
      }

      marbleBody.aabbNeedsUpdate = true;
      marbleBody.updateAABB();
      updateMarblePosLocalToBoard();
    };

    refreshCurvedContainment();

    const getOrCreateGhostState = (playerId: string): GhostRenderState => {
      const existing = ghostPlayers.get(playerId);
      if (existing) {
        return existing;
      }
      const material = new THREE.MeshStandardMaterial({
        color: 0xff9e80,
        transparent: true,
        opacity: 0.6,
        roughness: 0.32,
        metalness: 0.08,
      });
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(marbleRadius, ghostSegments, ghostSegments),
        material,
      );
      mesh.visible = false;
      scene.add(mesh);
      const next: GhostRenderState = {
        snapshots: new RingBuffer<GhostSnapshot>(SNAPSHOT_QUEUE_CAPACITY),
        mesh,
        material,
        skinRequestSeq: 0,
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
        spinQuat: new THREE.Quaternion(),
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

    const setMaterialTexture = (
      material: THREE.MeshStandardMaterial,
      texture: THREE.Texture | null,
      fallbackColor: number,
    ) => {
      const previous = material.map;
      material.map = texture;
      if (texture) {
        material.color.setHex(0xffffff);
      } else {
        material.color.setHex(fallbackColor);
      }
      material.needsUpdate = true;
      if (previous && previous !== texture) {
        previous.dispose();
      }
    };

    const applyLocalSkin = (skinId: string): void => {
      const requestSeq = localSkinRequestSeq + 1;
      localSkinRequestSeq = requestSeq;
      const material = marbleMesh.material as THREE.MeshStandardMaterial;
      void (async () => {
        const loadedTexture = await loadTextureForSkinId(skinId);
        if (disposed || requestSeq !== localSkinRequestSeq) {
          loadedTexture?.dispose();
          return;
        }
        if (loadedTexture) {
          setMaterialTexture(material, loadedTexture, 0xffffff);
          return;
        }
        setMaterialTexture(material, createMarbleTexture(), 0xffffff);
      })();
    };

    const applyGhostSkin = (playerId: string, skinId?: string): void => {
      const state = getOrCreateGhostState(playerId);
      if (state.skinId === skinId) {
        return;
      }
      state.skinId = skinId;
      const requestSeq = state.skinRequestSeq + 1;
      state.skinRequestSeq = requestSeq;
      void (async () => {
        const loadedTexture = skinId ? await loadTextureForSkinId(skinId) : null;
        if (disposed) {
          loadedTexture?.dispose();
          return;
        }
        const liveState = ghostPlayers.get(playerId);
        if (!liveState || liveState.skinRequestSeq !== requestSeq) {
          loadedTexture?.dispose();
          return;
        }
        setMaterialTexture(liveState.material, loadedTexture, 0xff9e80);
      })();
    };

    applyLocalSkinRef.current = applyLocalSkin;
    applyLocalSkin(selectedMarbleSkinIdRef.current);

    const resetGhostSnapshots = (): void => {
      for (const [, playerState] of ghostPlayers) {
        playerState.snapshots.clear();
        playerState.lastSourceSeq = -1;
        playerState.lastSourceT = -1;
        playerState.lastRecvAtMs = -1;
        playerState.latestSnapshotAgeMs = null;
        playerState.avgSnapshotAgeMs = 0;
        playerState.snapshotAgeJitterMs = 0;
        playerState.hasRendered = false;
        playerState.spinQuat.identity();
        playerState.mesh.visible = false;
      }
    };

    const raceClient = new RaceClient();
    raceClientRef.current = raceClient;
    raceClient.setPreferredName(playerNameRef.current || undefined);
    raceClient.setPreferredSkinId(
      selectedMarbleSkinIdRef.current === defaultSkinId
        ? undefined
        : selectedMarbleSkinIdRef.current,
    );
    raceClient.onStatusChange((status) => {
      setNetStatus(status);
      if (status === "disconnected") {
        setHostPlayerId("");
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
        raceClient.joinRoom(
          autoJoinRoomCodeRef.current,
          playerNameRef.current || undefined,
          selectedMarbleSkinIdRef.current === defaultSkinId
            ? undefined
            : selectedMarbleSkinIdRef.current,
        );
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
          setHostPlayerId("");
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
          setHostPlayerId(message.payload.hostPlayerId);
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
              if (ghostState.material.map) {
                ghostState.material.map.dispose();
              }
              ghostState.material.dispose();
              ghostPlayers.delete(playerId);
            }

            for (const player of message.payload.players) {
              if (player.playerId === message.payload.playerId) {
                continue;
              }
              applyGhostSkin(player.playerId, player.skinId);
            }

            // T2-8: Seed ghost snapshot queues from cached lastStates on reconnection.
            // This prevents ghosts from freezing until the next live race:state arrives.
            const lastStates = message.payload.lastStates;
            if (lastStates && lastStates.length > 0) {
              const nowMs = Date.now();
              for (const entry of lastStates) {
                if (entry.playerId === message.payload.playerId) continue;
                const ghostState = getOrCreateGhostState(entry.playerId);
                const snap = acquireSnapshot();
                snap.seq = undefined;
                snap.t = entry.t;
                snap.recvAtMs = nowMs;
                snap.pos.set(...entry.pos);
                snap.quat.set(...entry.quat);
                snap.vel.set(...entry.vel);
                if (entry.trackPos && entry.trackQuat) {
                  snap.hasTrackPose = true;
                  snap.trackPos.set(...entry.trackPos);
                  snap.trackQuat.set(...entry.trackQuat);
                } else {
                  snap.hasTrackPose = false;
                }
                const evicted = ghostState.snapshots.push(snap);
                if (evicted) releaseSnapshot(evicted);
              }
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
            applyTrackConfigRef.current(
              buildTrackConfig(
                multiplayerTrackSeedRef.current,
                trackLabPieceCountRef.current,
                "builtin",
                [],
                "default",
                toTrackVisualSettingsFromTuning(tuningRef.current),
              ),
            );
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
          {
            const seededConfig = buildTrackConfig(
              message.payload.trackSeed,
              trackLabPieceCountRef.current,
              "builtin",
              [],
              "default",
              toTrackVisualSettingsFromTuning(tuningRef.current),
            );
            setMultiplayerTrackSeed(seededConfig.seed);
            applyTrackConfigRef.current(seededConfig);
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

          const snap = acquireSnapshot();
          snap.seq = sourceSeq;
          snap.t = enqueueT;
          snap.recvAtMs = recvAtMs;
          snap.pos.set(...message.payload.pos);
          snap.quat.set(...message.payload.quat);
          snap.vel.set(...message.payload.vel);
          if (message.payload.trackPos && message.payload.trackQuat) {
            snap.hasTrackPose = true;
            snap.trackPos.set(...message.payload.trackPos);
            snap.trackQuat.set(...message.payload.trackQuat);
          } else {
            snap.hasTrackPose = false;
          }
          const evicted = playerState.snapshots.push(snap);
          if (evicted) releaseSnapshot(evicted);
          // Ring buffer auto-evicts when at capacity; no manual overflow loop needed.
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
            if (ghostState.material.map) {
              ghostState.material.map.dispose();
            }
            ghostState.material.dispose();
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
      raceClient.joinRoom(
        autoJoinRoomCodeRef.current,
        playerNameRef.current || undefined,
        selectedMarbleSkinIdRef.current === defaultSkinId
          ? undefined
          : selectedMarbleSkinIdRef.current,
      );
    }

    const computeSpawnWorld = (localSpawn?: CANNON.Vec3): CANNON.Vec3 => {
      const spawn = localSpawn ?? track.spawn;
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
      syncLocalRenderSnapshotsFromBodies();
    };

    const unfreezeMarble = () => {
      marbleBody.type = CANNON.Body.DYNAMIC;
      marbleBody.mass = 1;
      marbleBody.updateMassProperties();
      marbleBody.wakeUp();
      syncLocalRenderSnapshotsFromBodies();
    };

    freezeMarbleRef.current = freezeMarble;
    unfreezeMarbleRef.current = unfreezeMarble;

    const respawnMarble = (incrementCounter: boolean) => {
      isRaceFinishedLocal = false;
      hasSentFinishRef.current = false;
      unfreezeMarble();
      const checkpointSpawn =
        lastCheckpointIndex >= 0
          ? track.checkpoints[lastCheckpointIndex]?.spawnPos
          : undefined;
      marbleBody.position.copy(computeSpawnWorld(checkpointSpawn));
      marbleBody.quaternion.set(0, 0, 0, 1);
      marbleBody.velocity.set(0, 0, 0);
      marbleBody.angularVelocity.set(0, 0, 0);
      trialStartAt = null;
      prevTrialStartMetric = readGateMetric(
        track.trialStartGateLocal,
        track.trialStartZ,
        marbleBody.position,
      );
      prevTrialFinishMetric = readGateMetric(
        track.trialFinishGateLocal,
        track.trialFinishZ,
        marbleBody.position,
      );
      offCourseSinceMs = null;
      squeezeBlockedFrames = 0;
      curvedContainmentNearestIndex = 0;
      railClampCorrectionsCounter = 0;
      activeTiltPivotLayer = "upper";
      pivotSmoothed.set(
        marbleBody.position.x,
        track.tiltPivotLayersLocalY?.upperY ?? 0,
        marbleBody.position.z,
      );
      syncLocalRenderSnapshotsFromBodies();
      setTrialState("idle");
      setTrialCurrentMs(null);
      if (incrementCounter) {
        setRespawnCount((count) => count + 1);
      }
    };
    resetRef.current = () => respawnMarble(false);
    respawnMarble(false);
    if (
      gameModeRef.current !== "solo" &&
      gameModeRef.current !== "testAll"
    ) {
      freezeMarble();
    }

    const rebuildTrack = (nextConfig: RuntimeTrackConfig): void => {
      const nextTrack = createTrack(createTrackOptionsFromConfig(nextConfig));
      const nextBoardBody = nextTrack.bodies[0];
      if (!nextBoardBody) {
        return;
      }
      const nextBoardWallBody = nextTrack.wallBody;

      for (const body of [boardBody, boardWallBody, ...getTrackObstacleBodies(track)]) {
        world.removeBody(body);
      }
      scene.remove(track.group);
      disposeTrack(track);

      track = nextTrack;
      boardBody = nextBoardBody;
      boardBody.material = boardMat;
      boardWallBody = nextBoardWallBody;
      boardWallBody.material = boardWallMat;
      track.setMovingObstacleMaterial(movingObstacleMat);
      applyTrackCollisionFiltering(boardBody, boardWallBody, getTrackObstacleBodies(track));
      world.addBody(boardBody);
      world.addBody(boardWallBody);
      // remaining entries are static and kinematic obstacle bodies
      for (const body of getTrackObstacleBodies(track)) {
        world.addBody(body);
      }
      movingObstacleBodySet = new Set(track.movingObstacleBodies);
      colliderPieceCount = track.physicsDebug.colliderPieceCount;
      primitiveShapeCount = track.physicsDebug.primitiveShapeCount;
      exoticTrimeshPieceCount = track.physicsDebug.exoticTrimeshPieceCount;
      floorShapeCount = track.physicsDebug.floorShapeCount;
      wallShapeCount = track.physicsDebug.wallShapeCount;
      estimatedBoardWallShapeTestsPerStep =
        track.physicsDebug.estimatedBoardWallShapeTestsPerStep;
      boardWallCollisionFiltered = isBoardWallCollisionFiltered(boardBody, boardWallBody);
      refreshCurvedContainment();
      scene.add(track.group);

      boardPrevQuat.set(
        boardBody.quaternion.x,
        boardBody.quaternion.y,
        boardBody.quaternion.z,
        boardBody.quaternion.w,
      );
      currentPitch = 0;
      currentRoll = 0;
      respawnMarble(false);
      if (
        gameModeRef.current !== "solo" &&
        gameModeRef.current !== "testAll"
      ) {
        freezeMarble();
      }
    };

    applyTrackConfigRef.current = rebuildTrack;

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

    let resizeRaf = 0;
    let lastViewportWidth = -1;
    let lastViewportHeight = -1;
    const resize = () => {
      resizeRaf = 0;
      const width = Math.max(1, Math.round(mount.clientWidth));
      const height = Math.max(1, Math.round(mount.clientHeight));
      if (width === lastViewportWidth && height === lastViewportHeight) {
        return;
      }
      lastViewportWidth = width;
      lastViewportHeight = height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const scheduleResize = () => {
      if (resizeRaf !== 0) {
        return;
      }
      resizeRaf = window.requestAnimationFrame(resize);
    };
    resize();
    window.addEventListener("resize", scheduleResize);
    window.visualViewport?.addEventListener("resize", scheduleResize);

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
      if (!snapshot.hasTrackPose) {
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
      trackUp: THREE.Vector3,
    ): void => {
      if (state.hasRendered) {
        ghostTravelDelta.copy(worldPos).sub(state.renderedPos);
        const travelDistance = ghostTravelDelta.length();
        if (travelDistance > 0.0001) {
          ghostTravelDelta.multiplyScalar(1 / travelDistance);
          ghostSpinAxis.crossVectors(trackUp, ghostTravelDelta);
          if (ghostSpinAxis.lengthSq() > 0.000001) {
            ghostSpinAxis.normalize();
            const spinAngle = Math.min(travelDistance / marbleRadius, GHOST_SPIN_STEP_MAX_RAD);
            ghostSpinStepQuat.setFromAxisAngle(ghostSpinAxis, spinAngle);
            state.spinQuat.premultiply(ghostSpinStepQuat).normalize();
          }
        }
      }
      state.renderedPos.copy(worldPos);
      state.renderedQuat.copy(state.spinQuat).multiply(worldQuat).normalize();
      state.hasRendered = true;
      state.mesh.visible = true;
      state.mesh.position.copy(worldPos);
      state.mesh.quaternion.copy(state.renderedQuat);
    };

    // T1-3: Tab-backgrounding handling — flush stale ghost snapshots on un-background.
    let lastVisibleAtMs = performance.now();
    let wasBackgrounded = false;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab going to background — record the timestamp.
        lastVisibleAtMs = performance.now();
      } else {
        // Tab returning to foreground.
        const gapMs = performance.now() - lastVisibleAtMs;
        if (gapMs > TAB_BACKGROUND_THRESHOLD_MS) {
          wasBackgrounded = true;
          // Flush ghost snapshot queues: keep only the 2 most recent entries
          // so interpolation can resume immediately without draining a huge queue.
          for (const [, playerState] of ghostPlayers) {
            const snaps = playerState.snapshots;
            while (snaps.length > 2) {
              const flushed = snaps.shift();
              if (flushed) releaseSnapshot(flushed);
            }
          }
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    let animationFrame = 0;
    let lastTime = performance.now() / 1000;
    let debugTimer = 0;
    let lastRenderScale = initialRenderScale;
    let cadenceMsEma = 1000 / 60;
    let cpuFrameMsEma = 1000 / 60;
    let lastCadenceTimestampMs: number | null = null;
    let physicsMsEma = 0;
    let renderMsEma = 0;
    let miscMsEma = 0;
    const rafGapSamples = new RingBuffer<number>(300);
    const simStepsSamples = new RingBuffer<number>(180);
    const RAF_GAP_SPIKE_16_MS = 16.7;
    const RAF_GAP_SPIKE_20_MS = 20;
    const RAF_GAP_SPIKE_25_MS = 25;
    let rafGapsOver16Ms = 0;
    let rafGapsOver20Ms = 0;
    let rafGapsOver25Ms = 0;
    let simStepsPerFrameEma = 0;
    let simStepsMaxRecent = 0;
    let perfTier: MobilePerfTier | "desktop" = mobilePerfGovernor ? "high" : "desktop";
    const updateRafSpikeCounters = (gapMs: number, direction: 1 | -1): void => {
      if (gapMs > RAF_GAP_SPIKE_16_MS) {
        rafGapsOver16Ms += direction;
      }
      if (gapMs > RAF_GAP_SPIKE_20_MS) {
        rafGapsOver20Ms += direction;
      }
      if (gapMs > RAF_GAP_SPIKE_25_MS) {
        rafGapsOver25Ms += direction;
      }
    };
    const recordRafGapMs = (gapMs: number): void => {
      const evicted = rafGapSamples.push(gapMs);
      if (evicted != null) {
        updateRafSpikeCounters(evicted, -1);
      }
      updateRafSpikeCounters(gapMs, 1);
    };
    const getRafGapPercentileMs = (percentile: number): number => {
      const count = rafGapSamples.length;
      if (count === 0) {
        return 0;
      }
      const values = new Array<number>(count);
      for (let i = 0; i < count; i += 1) {
        values[i] = rafGapSamples.at(i) ?? 0;
      }
      values.sort((a, b) => a - b);
      const idx = clamp(
        Math.round((values.length - 1) * clamp(percentile, 0, 1)),
        0,
        values.length - 1,
      );
      return values[idx] ?? 0;
    };
    const recordSimSteps = (steps: number): void => {
      simStepsPerFrameEma += (steps - simStepsPerFrameEma) * 0.12;
      const evicted = simStepsSamples.push(steps);
      if (steps > simStepsMaxRecent) {
        simStepsMaxRecent = steps;
        return;
      }
      if (evicted == null || evicted < simStepsMaxRecent) {
        return;
      }
      let maxRecent = 0;
      for (let i = 0; i < simStepsSamples.length; i += 1) {
        maxRecent = Math.max(maxRecent, simStepsSamples.at(i) ?? 0);
      }
      simStepsMaxRecent = maxRecent;
    };
    const resolveNormalizedIntent = (currentTuning: TuningState): TiltSample => {
      let sourceIntent: TiltSample;
      const status = tiltStatusRef.current;
      const touchIntent = touchTiltRef.current;
      const keyboardIntent = getKeyboardIntent();
      const tiltEnabled =
        gyroEnabledRef.current &&
        status.enabled &&
        status.permission === "granted" &&
        status.supported;
      const touchFallbackEnabled =
        !gyroEnabledRef.current || !status.supported || status.permission === "denied";
      const keyboardActive = keyboardIntent.x !== 0 || keyboardIntent.z !== 0;

      if (controlsLockedRef.current) {
        sourceIntent = { x: 0, y: 0, z: 0 };
        inputSourcesSummary = "locked";
      } else {
        let sourceX = keyboardIntent.x;
        let sourceZ = keyboardIntent.z;
        let inputMask = 0;
        if (keyboardActive) {
          inputMask |= 1;
        }
        if (tiltEnabled) {
          const gyroGain =
            Math.abs(currentTuning.gyroSensitivity - 1) > 0.0001
              ? currentTuning.gyroSensitivity
              : 1;
          sourceX += motionTiltRef.current.x * gyroGain;
          sourceZ += motionTiltRef.current.z * gyroGain;
          inputMask |= 2;
        }
        if (touchFallbackEnabled) {
          sourceX += touchIntent.x;
          sourceZ += touchIntent.z;
          inputMask |= 4;
        }
        sourceIntent = {
          x: sourceX,
          y: 0,
          z: sourceZ,
        };
        inputSourcesSummary = INPUT_LABELS[inputMask]!;
      }

      const intentX = currentTuning.invertTiltX ? -sourceIntent.x : sourceIntent.x;
      const intentZ = currentTuning.invertTiltZ ? -sourceIntent.z : sourceIntent.z;
      inputRawIntentX = intentX;
      inputRawIntentZ = intentZ;
      const normalizedIntent: TiltSample = {
        x: clamp(intentX, -1, 1),
        y: 0,
        z: clamp(intentZ, -1, 1),
      };
      inputIntentX = normalizedIntent.x;
      inputIntentZ = normalizedIntent.z;
      return normalizedIntent;
    };

    const updateTrackController = (
      currentTuning: TuningState,
      controllerDt: number,
    ): void => {
      track.group.quaternion.set(
        boardBody.quaternion.x,
        boardBody.quaternion.y,
        boardBody.quaternion.z,
        boardBody.quaternion.w,
      );

      const normalizedIntent = resolveNormalizedIntent(currentTuning);
      const filteredIntent = filter.push(normalizedIntent, controllerDt);
      lastFilteredIntent = filteredIntent;
      const maxTiltRad = (currentTuning.maxTiltDeg * Math.PI) / 180;

      const desiredPitch =
        filteredIntent.z * currentTuning.tiltStrength * maxTiltRad;
      const desiredRoll =
        -filteredIntent.x * currentTuning.tiltStrength * maxTiltRad;
      const maxStep = currentTuning.maxBoardAngVel * controllerDt;
      currentPitch += clamp(desiredPitch - currentPitch, -maxStep, maxStep);
      currentRoll += clamp(desiredRoll - currentRoll, -maxStep, maxStep);

      visualTiltTargetEuler.set(currentPitch, 0, currentRoll);
      visualTiltTargetQuat.setFromEuler(visualTiltTargetEuler);
      const boardTiltAlpha = 1 - Math.exp(-BOARD_TILT_SMOOTH * controllerDt);
      track.group.quaternion.slerp(visualTiltTargetQuat, boardTiltAlpha);

      updateActiveTiltPivotLayer();
      rawPivot.set(
        marbleBody.position.x,
        resolveActivePivotLayerY(),
        marbleBody.position.z,
      );
      const pivotAlpha = 1 - Math.exp(-PIVOT_SMOOTH * controllerDt);
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

      // Compute board velocity as the analytical derivative of boardPosition:
      //   v_board = -(ω × rotatedPivot)  +  (I - Q) * v_marble_XZ
      //
      // The first term is the angular-rotation contribution (pivot-anchored).
      // The second term is the marble-tracking contribution: as the marble moves,
      // the board must shift to keep its pivot at the marble's XZ position. This
      // term makes the board floor surface "follow" the marble, providing a
      // small normal-direction closing velocity that furnishes the forward drive
      // (via the contact-normal Z component) that gravity alone cannot reliably
      // supply through friction on a static kinematic surface.
      //
      // Both terms are Z-position-independent:
      //   - -(ω × rotatedPivot) computed analytically from ω (no finite-diff error)
      //   - (I-Q)*v_marble bounded by marble speed, not marble distance
      // Contact velocity at marble = ω×(0,my,0) + (I-Q)*v_marble — no mz terms.
      // This eliminates the original throwing bug (finite-diff error ∝ mz*ω) while
      // restoring the responsive feel the original code had.
      if (controllerDt > 0.00001) {
        // Marble-tracking contribution: (I - Q) * v_marble_XZ
        // Computed as v_marble - Q*v_marble (no allocations; uses rotation matrix).
        const mvx = marbleBody.velocity.x;
        const mvz = marbleBody.velocity.z;
        const qqx = qFinalCannon.x;
        const qqy = qFinalCannon.y;
        const qqz = qFinalCannon.z;
        const qqw = qFinalCannon.w;
        // Q * (mvx, 0, mvz):
        const Qmv_x = mvx * (1 - 2 * (qqy * qqy + qqz * qqz)) + mvz * (2 * (qqx * qqz + qqy * qqw));
        const Qmv_y = mvx * (2 * (qqx * qqy + qqz * qqw))      + mvz * (2 * (qqy * qqz - qqx * qqw));
        const Qmv_z = mvx * (2 * (qqx * qqz - qqy * qqw))      + mvz * (1 - 2 * (qqx * qqx + qqy * qqy));
        const trkVx = mvx - Qmv_x;
        const trkVy = 0   - Qmv_y;
        const trkVz = mvz - Qmv_z;

        // deltaQuat = currentQuat * prevQuat^-1
        tempQuatB.set(qFinalCannon.x, qFinalCannon.y, qFinalCannon.z, qFinalCannon.w);
        tempQuatC.copy(boardPrevQuat).invert();
        tempQuatB.multiply(tempQuatC).normalize();

        const w = clamp(tempQuatB.w, -1, 1);
        let angle = 2 * Math.acos(w);
        if (angle > Math.PI) angle -= 2 * Math.PI;
        const sinHalf = Math.sqrt(Math.max(1 - w * w, 0));
        const invDt = 1 / controllerDt;
        if (sinHalf > 0.00001 && Math.abs(angle) > 0.00001) {
          const angularSpeed = angle * invDt;
          const ox = (tempQuatB.x / sinHalf) * angularSpeed;
          const oy = (tempQuatB.y / sinHalf) * angularSpeed;
          const oz = (tempQuatB.z / sinHalf) * angularSpeed;
          boardBody.angularVelocity.set(ox, oy, oz);
          // v_body = -(ω × rotatedPivot) + (I-Q)*v_marble
          const rpx = rotatedPivot.x;
          const rpy = rotatedPivot.y;
          const rpz = rotatedPivot.z;
          boardBody.velocity.set(
            (oz * rpy - oy * rpz) + trkVx,
            (ox * rpz - oz * rpx) + trkVy,
            (oy * rpx - ox * rpy) + trkVz,
          );
        } else {
          // Board not rotating this frame; only the marble-tracking term applies.
          boardBody.velocity.set(trkVx, trkVy, trkVz);
          boardBody.angularVelocity.set(0, 0, 0);
        }
      } else {
        boardBody.velocity.set(0, 0, 0);
        boardBody.angularVelocity.set(0, 0, 0);
      }

      boardBody.quaternion.copy(qFinalCannon);
      boardBody.position.copy(boardPosition);
      boardBody.aabbNeedsUpdate = true;
      boardBody.updateAABB();

      // Keep wall body perfectly in sync with floor body every tick.
      boardWallBody.velocity.copy(boardBody.velocity);
      boardWallBody.angularVelocity.copy(boardBody.angularVelocity);
      boardWallBody.quaternion.copy(boardBody.quaternion);
      boardWallBody.position.copy(boardBody.position);
      boardWallBody.aabbNeedsUpdate = true;
      boardWallBody.updateAABB();

      boardPrevQuat.set(qFinalCannon.x, qFinalCannon.y, qFinalCannon.z, qFinalCannon.w);
    };

    let lastGravityG = Number.NaN;
    let lastSolverIterations = -1;
    let lastLinearDamping = Number.NaN;
    let lastAngularDamping = Number.NaN;
    let lastCcdSpeedThreshold = Number.NaN;
    let lastCcdIterations = -1;
    let lastBoardContactFriction = Number.NaN;
    let lastBoardContactRestitution = Number.NaN;
    let lastMovingObstacleRestitution = Number.NaN;

    const simulateFixedStep = (nowMs: number, fixedDt: number): number => {
      const currentTuning = tuningRef.current;
      if (currentTuning.gravityG !== lastGravityG) {
        world.gravity.set(0, -currentTuning.gravityG, 0);
        lastGravityG = currentTuning.gravityG;
      }
      const solverIterations = Math.round(currentTuning.physicsSolverIterations);
      if (solverIterations !== lastSolverIterations) {
        solver.iterations = solverIterations;
        lastSolverIterations = solverIterations;
      }
      if (currentTuning.linearDamping !== lastLinearDamping) {
        marbleBody.linearDamping = currentTuning.linearDamping;
        lastLinearDamping = currentTuning.linearDamping;
      }
      if (currentTuning.angularDamping !== lastAngularDamping) {
        marbleBody.angularDamping = currentTuning.angularDamping;
        lastAngularDamping = currentTuning.angularDamping;
      }
      if (currentTuning.ccdSpeedThreshold !== lastCcdSpeedThreshold) {
        marbleBodyWithCcd.ccdSpeedThreshold = currentTuning.ccdSpeedThreshold;
        lastCcdSpeedThreshold = currentTuning.ccdSpeedThreshold;
      }
      const ccdIterations = Math.round(currentTuning.ccdIterations);
      if (ccdIterations !== lastCcdIterations) {
        marbleBodyWithCcd.ccdIterations = ccdIterations;
        lastCcdIterations = ccdIterations;
      }
      const boardContactFriction = clamp(currentTuning.contactFriction, 0, 1.0);
      if (boardContactFriction !== lastBoardContactFriction) {
        boardContactMat.friction = boardContactFriction;
        lastBoardContactFriction = boardContactFriction;
      }
      const contactRestitution = clamp(currentTuning.bounce, 0, 0.99);
      if (contactRestitution !== lastBoardContactRestitution) {
        boardContactMat.restitution = contactRestitution;
        lastBoardContactRestitution = contactRestitution;
      }
      if (contactRestitution !== lastMovingObstacleRestitution) {
        movingObstacleContactMat.restitution = contactRestitution;
        lastMovingObstacleRestitution = contactRestitution;
      }
      updateTrackController(currentTuning, fixedDt);
      track.updateMovingObstacles(fixedDt, boardBody.position, boardBody.quaternion);

      if (currentTuning.enableExtraDownforce) {
        extraDownForceVec.set(0, -currentTuning.extraDownForce, 0);
        marbleBody.applyForce(extraDownForceVec, marbleBody.position);
      }

      const physicsStartMs = performance.now();
      world.step(fixedDt, fixedDt, 1);
      suppressVerticalPopOnSideImpact();
      if (track.wallContainmentMode === "legacyLinear") {
        resolveWallSqueezeAgainstObstacle();
      } else if (track.wallContainmentMode === "curvedPathClamp") {
        resolveCurvedPathContainment();
        const checkpoints = track.checkpoints;
        if (checkpoints.length > 0) {
          for (let ci = lastCheckpointIndex + 1; ci < checkpoints.length; ci += 1) {
            if (curvedContainmentNearestIndex >= checkpoints[ci]!.sampleIndex) {
              lastCheckpointIndex = ci;
            } else {
              break;
            }
          }
        }
      }
      const physicsMs = performance.now() - physicsStartMs;

      const speed = marbleBody.velocity.length();
      if (speed > currentTuning.maxSpeed && speed > 0) {
        const scale = currentTuning.maxSpeed / speed;
        marbleBody.velocity.scale(scale, marbleBody.velocity);
      }
      updateMarblePosLocalToBoard();
      const outBounds = track.offCourseBoundsLocal;
      let isOffCourseByBounds =
        marblePosLocalToBoard.x < outBounds.minX ||
        marblePosLocalToBoard.x > outBounds.maxX ||
        marblePosLocalToBoard.z < outBounds.minZ ||
        marblePosLocalToBoard.z > outBounds.maxZ;
      const penetrationDepth = 0;
      if (!isOffCourseByBounds) {
        isOffCourseByBounds =
          marblePosLocalToBoard.x < outBounds.minX ||
          marblePosLocalToBoard.x > outBounds.maxX ||
          marblePosLocalToBoard.z < outBounds.minZ ||
          marblePosLocalToBoard.z > outBounds.maxZ;
      }
      latestMarbleBoardContactCount = countMarbleBoardContacts();
      latestPenetrationDepth = penetrationDepth;
      latestAngularSpeed = marbleBody.angularVelocity.length();
      latestVerticalSpeed = marbleBody.velocity.y;
      if (!isRaceFinishedLocal) {
        if (isOffCourseByBounds) {
          if (offCourseSinceMs == null) {
            offCourseSinceMs = nowMs;
          } else if (nowMs - offCourseSinceMs >= OFF_COURSE_RESPAWN_DELAY_MS) {
            respawnMarble(true);
          }
        } else {
          offCourseSinceMs = null;
        }
      } else {
        offCourseSinceMs = null;
      }

      if (
        nowMs - lastRaceSendAt >= SOURCE_RATE_MS &&
        gameModeRef.current === "multiplayer" &&
        racePhaseRef.current === "racing" &&
        trialStateRef.current !== "finished" &&
        !isRaceFinishedLocal
      ) {
        const candidateT = raceClient.getServerNowMs();
        const monotonicT = Math.max(candidateT, lastSentRaceStateT + 1);
        lastSentRaceStateT = monotonicT;

        sendPos[0] = marbleBody.position.x;
        sendPos[1] = marbleBody.position.y;
        sendPos[2] = marbleBody.position.z;
        sendQuat[0] = marbleBody.quaternion.x;
        sendQuat[1] = marbleBody.quaternion.y;
        sendQuat[2] = marbleBody.quaternion.z;
        sendQuat[3] = marbleBody.quaternion.w;
        sendVel[0] = marbleBody.velocity.x;
        sendVel[1] = marbleBody.velocity.y;
        sendVel[2] = marbleBody.velocity.z;
        sendTrackPos[0] = boardBody.position.x;
        sendTrackPos[1] = boardBody.position.y;
        sendTrackPos[2] = boardBody.position.z;
        sendTrackQuat[0] = boardBody.quaternion.x;
        sendTrackQuat[1] = boardBody.quaternion.y;
        sendTrackQuat[2] = boardBody.quaternion.z;
        sendTrackQuat[3] = boardBody.quaternion.w;
        raceClient.sendRaceState({
          t: monotonicT,
          pos: sendPos,
          quat: sendQuat,
          vel: sendVel,
          trackPos: sendTrackPos,
          trackQuat: sendTrackQuat,
        });
        lastRaceSendAt = nowMs;
      }

      if (!isRaceFinishedLocal && marbleBody.position.y < track.respawnY) {
        offCourseSinceMs = null;
        respawnMarble(true);
      }

      const startMetric = readGateMetric(
        track.trialStartGateLocal,
        track.trialStartZ,
        marbleBody.position,
      );
      if (trialStartAt == null && prevTrialStartMetric <= 0 && startMetric > 0) {
        trialStartAt = nowMs;
        setTrialState("running");
        setTrialCurrentMs(0);
      }
      const finishMetric = readGateMetric(
        track.trialFinishGateLocal,
        track.trialFinishZ,
        marbleBody.position,
      );
      if (
        trialStartAt != null &&
        prevTrialFinishMetric <= 0 &&
        finishMetric > 0
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
      prevTrialStartMetric = startMetric;
      prevTrialFinishMetric = finishMetric;

      localRenderCurrBoardPos.set(
        boardBody.position.x,
        boardBody.position.y,
        boardBody.position.z,
      );
      localRenderCurrBoardQuat.set(
        boardBody.quaternion.x,
        boardBody.quaternion.y,
        boardBody.quaternion.z,
        boardBody.quaternion.w,
      );
      localRenderCurrMarblePos.set(
        marbleBody.position.x,
        marbleBody.position.y,
        marbleBody.position.z,
      );
      localRenderCurrMarbleQuat.set(
        marbleBody.quaternion.x,
        marbleBody.quaternion.y,
        marbleBody.quaternion.z,
        marbleBody.quaternion.w,
      );

      return physicsMs;
    };

    const tick = (nowMs: number) => {
      const frameStartMs = performance.now();
      if (lastCadenceTimestampMs != null) {
        const rafDeltaMs = clamp(nowMs - lastCadenceTimestampMs, 1, 250);
        cadenceMsEma += (rafDeltaMs - cadenceMsEma) * 0.12;
        recordRafGapMs(rafDeltaMs);
      }
      lastCadenceTimestampMs = nowMs;
      const now = nowMs / 1000;
      let delta = Math.min(now - lastTime, MAX_FRAME_DELTA);
      lastTime = now;
      // T1-3: After un-backgrounding, clamp delta to a single frame to avoid physics jump.
      if (wasBackgrounded) {
        delta = TIMESTEP;
        accumulator = 0;
        wasBackgrounded = false;
      }
      debugTimer += delta;

      const currentTuning = tuningRef.current;
      applyShadowRenderingConfig(currentTuning);
      if (mobileMode && mobilePerfGovernor) {
        mobilePerfGovernor.setUserScaleCap(
          clamp(
            currentTuning.renderScaleMobile,
            MOBILE_SAFE_RENDER_SCALE_MIN,
            MOBILE_SAFE_RENDER_SCALE_MAX,
          ),
        );
      } else if (mobileMode) {
        const nextRenderScale = clamp(
          currentTuning.renderScaleMobile,
          MOBILE_RENDER_SCALE_MIN,
          MOBILE_RENDER_SCALE_MAX,
        );
        if (Math.abs(nextRenderScale - lastRenderScale) > 0.001) {
          lastRenderScale = nextRenderScale;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, lastRenderScale));
        }
      }

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
            if (
              gameModeRef.current === "solo" ||
              gameModeRef.current === "testAll"
            ) {
              unfreezeMarbleRef.current();
            }
            setControlsLocked(false);
            setRacePhase("racing");
            calibrateTiltRef.current();
          }
        } else if (elapsedMs >= stepMs * COUNTDOWN_LABELS.length) {
          if (!countdownGoHandledRef.current) {
            countdownGoHandledRef.current = true;
            if (
              gameModeRef.current === "solo" ||
              gameModeRef.current === "testAll"
            ) {
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

      accumulator += delta;
      const maxCatchupSteps = Math.max(
        1,
        Math.min(6, Math.round(currentTuning.physicsMaxSubSteps)),
      );
      let physicsMs = 0;
      let simulatedSteps = 0;
      while (accumulator >= TIMESTEP && simulatedSteps < maxCatchupSteps) {
        localRenderPrevBoardPos.copy(localRenderCurrBoardPos);
        localRenderPrevBoardQuat.copy(localRenderCurrBoardQuat);
        localRenderPrevMarblePos.copy(localRenderCurrMarblePos);
        localRenderPrevMarbleQuat.copy(localRenderCurrMarbleQuat);
        physicsMs += simulateFixedStep(nowMs, TIMESTEP);
        accumulator -= TIMESTEP;
        simulatedSteps += 1;
      }
      if (simulatedSteps >= maxCatchupSteps && accumulator >= TIMESTEP) {
        accumulator = 0;
      }
      recordSimSteps(simulatedSteps);

      const marbleRenderAlpha = currentTuning.localMarbleRenderInterpolation
        ? clamp(accumulator / TIMESTEP, 0, 1)
        : 1;
      const trackRenderAlpha = currentTuning.localTrackRenderInterpolation
        ? clamp(accumulator / TIMESTEP, 0, 1)
        : 1;
      if (currentTuning.localTrackRenderInterpolation) {
        tempVecA.copy(localRenderPrevBoardPos).lerp(localRenderCurrBoardPos, trackRenderAlpha);
        tempQuatA.copy(localRenderPrevBoardQuat).slerp(localRenderCurrBoardQuat, trackRenderAlpha);
        track.group.position.copy(tempVecA);
        track.group.quaternion.copy(tempQuatA);
      } else {
        track.group.position.set(
          boardBody.position.x,
          boardBody.position.y,
          boardBody.position.z,
        );
        track.group.quaternion.set(
          boardBody.quaternion.x,
          boardBody.quaternion.y,
          boardBody.quaternion.z,
          boardBody.quaternion.w,
        );
      }
      tempVecB.copy(localRenderPrevMarblePos).lerp(localRenderCurrMarblePos, marbleRenderAlpha);
      tempQuatB.copy(localRenderPrevMarbleQuat).slerp(localRenderCurrMarbleQuat, marbleRenderAlpha);
      marbleMesh.position.copy(tempVecB);
      marbleMesh.quaternion.copy(tempQuatB);

      boardPosThree.copy(track.group.position);
      boardQuatThree.copy(track.group.quaternion);
      ghostTrackUp.set(0, 1, 0).applyQuaternion(boardQuatThree).normalize();
      updateDynamicShadowFraming();
      updateContactShadowAssist(ghostTrackUp);

      let extrapolatingPlayers = 0;
      const interpNowMs = raceClient.getServerNowMs();
      for (const [, playerState] of ghostPlayers) {
        const snapshots = playerState.snapshots;
        if (snapshots.length === 0) {
          continue;
        }
        // Remove ALL out-of-order violations in a single pass (T2-7 fix).
        // Scan backwards so removeAt() doesn't shift unvisited indices.
        for (let idx = snapshots.length - 1; idx >= 1; idx--) {
          if (snapshots.at(idx)!.t <= snapshots.at(idx - 1)!.t) {
            snapshots.removeAt(idx);
            playerState.queueOrderViolationCount += 1;
            totalQueueOrderViolations += 1;
          }
        }
        if (snapshots.length === 0) {
          continue;
        }
        const targetInterpTime = interpNowMs - playerState.interpolationDelayMs;
        while (
          snapshots.length >= 3 &&
          snapshots.at(1)!.t <= targetInterpTime
        ) {
          const shifted = snapshots.shift();
          if (shifted) releaseSnapshot(shifted);
        }
        if (snapshots.length >= 2) {
          const a = snapshots.at(0)!;
          const b = snapshots.at(1)!;
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
            applyGhostPose(playerState, tempVecA, tempQuatA, ghostTrackUp);
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
          applyGhostPose(playerState, tempVecA, tempQuatA, ghostTrackUp);
          continue;
        }

        const latest = snapshots.at(0)!;
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
        applyGhostPose(playerState, tempVecA, tempQuatA, ghostTrackUp);
      }

      const cameraAlpha = 1 - Math.exp(-8 * delta);
      const zoomDistanceScale = 1 / clamp(currentTuning.cameraZoom, 0.5, 1.4);
      const heightBias = currentTuning.cameraHeightBias;
      const pitchLookAheadBias = clamp(-heightBias * 0.6, -5, 5);
      const nextFov = clamp(currentTuning.cameraFov, 50, 90);
      if (Math.abs(camera.fov - nextFov) > 0.01) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
      const broadcastCameraBaseHeight = 15.6;
      cameraTarget.set(
        marbleMesh.position.x,
        marbleMesh.position.y + broadcastCameraBaseHeight + heightBias,
        marbleMesh.position.z - 12 * zoomDistanceScale,
      );
      camera.position.lerp(cameraTarget, cameraAlpha);
      camera.position.y = marbleMesh.position.y + broadcastCameraBaseHeight + heightBias;
      lookTarget.set(
        marbleMesh.position.x,
        marbleMesh.position.y + LOOK_HEIGHT + heightBias * 0.15,
        marbleMesh.position.z + LOOK_AHEAD + pitchLookAheadBias,
      );

      camera.lookAt(lookTarget);

      const renderStartMs = performance.now();
      renderer.render(scene, camera);
      const renderMs = performance.now() - renderStartMs;
      const frameMs = Math.max(performance.now() - frameStartMs, 0.1);
      const miscMs = Math.max(0, frameMs - physicsMs - renderMs);

      if (mobileMode && mobilePerfGovernor) {
        const decision = mobilePerfGovernor.push({
          nowMs,
          frameMs,
          physicsMs,
          renderMs,
          miscMs,
        });
        cpuFrameMsEma = decision.frameMsEma;
        physicsMsEma = decision.physicsMsEma;
        renderMsEma = decision.renderMsEma;
        miscMsEma = decision.miscMsEma;
        perfTier = decision.tier;
        if (decision.changed && Math.abs(decision.renderScale - lastRenderScale) > 0.001) {
          lastRenderScale = decision.renderScale;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, lastRenderScale));
        }
      } else {
        cpuFrameMsEma += (frameMs - cpuFrameMsEma) * 0.12;
        physicsMsEma += (physicsMs - physicsMsEma) * 0.12;
        renderMsEma += (renderMs - renderMsEma) * 0.12;
        miscMsEma += (miscMs - miscMsEma) * 0.12;
      }

      const debugInterval = mobileMode
        ? 1 / Math.max(currentTuning.debugUpdateHzMobile, 1)
        : 0.1;
      if (debugTimer >= debugInterval) {
        const rafGapP95Ms = getRafGapPercentileMs(0.95);
        const rafGapP99Ms = getRafGapPercentileMs(0.99);
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
        const debugWindowSec = Math.max(debugTimer, 1e-4);
        const railClampRateSample = railClampCorrectionsCounter / debugWindowSec;
        railClampCorrectionsPerSecEma +=
          (railClampRateSample - railClampCorrectionsPerSecEma) * 0.24;
        railClampCorrectionsCounter = 0;
        debugStore.updateDebug({
          cadenceHz: Math.round(1000 / Math.max(cadenceMsEma, 0.0001)),
          rafGapP95Ms,
          rafGapP99Ms,
          rafGapsOver16Ms,
          rafGapsOver20Ms,
          rafGapsOver25Ms,
          simStepsPerFrameEma,
          simStepsMaxRecent,
          posX: marbleBody.position.x,
          posY: marbleBody.position.y,
          posZ: marbleBody.position.z,
          speed: marbleBody.velocity.length(),
          angularSpeed: latestAngularSpeed,
          verticalSpeed: latestVerticalSpeed,
          penetrationDepth: latestPenetrationDepth,
          rawTiltX: inputRawIntentX,
          rawTiltZ: inputRawIntentZ,
          tiltX: lastFilteredIntent.x,
          tiltZ: lastFilteredIntent.z,
          gravX: world.gravity.x,
          gravY: world.gravity.y,
          gravZ: world.gravity.z,
          renderScale: lastRenderScale,
          perfTier,
          cpuFrameMsEma,
          physicsMsEma,
          renderMsEma,
          miscMsEma,
          marbleBoardContactCount: latestMarbleBoardContactCount,
          colliderPieceCount,
          primitiveShapeCount,
          exoticTrimeshPieceCount,
          floorShapeCount,
          wallShapeCount,
          estimatedBoardWallShapeTestsPerStep,
          boardWallCollisionFiltered,
          shadowMapSize: currentTuning.shadowMapSize,
          railClampCorrectionsPerSec: railClampCorrectionsPerSecEma,
        });
        debugStore.updateNet({
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
      disposed = true;
      applyLocalSkinRef.current = () => {};
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (resizeRaf !== 0) {
        window.cancelAnimationFrame(resizeRaf);
      }
      window.removeEventListener("resize", scheduleResize);
      window.visualViewport?.removeEventListener("resize", scheduleResize);
      stopTiltListener?.();
      raceClient.disconnect();
      raceClientRef.current = null;
      applyTrackConfigRef.current = () => {};
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      scene.remove(track.group);
      disposeTrack(track);
      for (const [, playerState] of ghostPlayers) {
        scene.remove(playerState.mesh);
        playerState.mesh.geometry.dispose();
        if (playerState.material.map) {
          playerState.material.map.dispose();
        }
        playerState.material.dispose();
      }
      for (const body of [boardBody, boardWallBody, ...getTrackObstacleBodies(track)]) {
        world.removeBody(body);
      }
      world.removeBody(marbleBody);
      marbleMesh.geometry.dispose();
      (marbleMesh.material as THREE.Material).dispose();
      marbleShadowMesh.geometry.dispose();
      (marbleShadowMesh.material as THREE.Material).dispose();
      marbleShadowTex.dispose();
    };
  }, []);

  const showTouchFallback =
    !gyroEnabled || !tiltStatus.supported || tiltStatus.permission === "denied";
  const soloCourse = useMemo(() => buildSoloGauntletCourse(trackLabSeed), [trackLabSeed]);
  const showModePicker = gameMode === "unselected" && menuScreen === "main";
  const showOptionsMenu = gameMode === "unselected" && menuScreen === "options";
  const showTrackLabMenu = gameMode === "unselected" && menuScreen === "trackLab";
  const showEditorMenu = gameMode === "unselected" && menuScreen === "editor";
  const showingOptionsRoot = showOptionsMenu && optionsSubmenu === "root";
  const showingOptionsControls = showOptionsMenu && optionsSubmenu === "controls";
  const showingOptionsCamera = showOptionsMenu && optionsSubmenu === "camera";
  const showMultiplayerResult = gameMode === "multiplayer" && raceResult != null;
  const showSoloResult =
    (gameMode === "solo" || gameMode === "testAll") &&
    trialState === "finished";
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
    !showModePicker &&
    !showOptionsMenu &&
    !showTrackLabMenu &&
    !showEditorMenu &&
    !showRaceLobby &&
    !showMultiplayerResult &&
    !showSoloResult;
  const showFloatingGyroCalibrateButton =
    gameplayUiVisible &&
    gyroEnabled &&
    tiltStatus.supported &&
    tiltStatus.enabled &&
    tiltStatus.permission === "granted";
  const showMobileInRaceCameraControls =
    gameplayUiVisible &&
    isMobile &&
    debugMenuEnabled &&
    drawerOpen &&
    activeDebugTab === "camera" &&
    gyroEnabled &&
    racePhase === "racing" &&
    trialState !== "finished";
  const showSoloHud =
    gameplayUiVisible &&
    gameMode === "solo" &&
    (racePhase === "countdown" || racePhase === "racing");
  const showSoloCountdownBrief =
    gameMode === "solo" && racePhase === "countdown" && trialState !== "finished";
  const compactSoloSeed = trackLabSeed.replace(/^solo_/, "").slice(0, 8);
  const optionsTitleLabel = (() => {
    if (showingOptionsRoot) {
      return "Options";
    }
    if (showingOptionsControls) {
      return "Controls";
    }
    return "Camera";
  })();
  const creatingLobby =
    gameMode === "multiplayer" &&
    !roomCode &&
    (netStatus === "connecting" || netStatus === "connected");
  const waitingForPlayers = gameMode === "multiplayer" && playersInRoom.length < 2;
  const showRotateToPortraitOverlay = isMobile && !isPortraitViewport;
  const joinHandshakePending =
    gameMode === "multiplayer" &&
    netStatus !== "disconnected" &&
    joinTiming != null &&
    joinTiming.stage !== "hello_ack";
  const isLocalPlayerHost = Boolean(localPlayerId) && localPlayerId === hostPlayerId;
  const allPlayersReady =
    playersInRoom.length > 0 &&
    playersInRoom.every((player) => readyPlayerIds.includes(player.playerId));
  const canToggleLobbyReady =
    netStatus === "connected" &&
    Boolean(roomCode) &&
    Boolean(localPlayerId) &&
    racePhase === "waiting";
  const canStartMatch =
    canToggleLobbyReady &&
    isLocalPlayerHost &&
    playersInRoom.length >= 2 &&
    allPlayersReady;
  const lobbySlots = Array.from({ length: MAX_LOBBY_SLOTS }, (_, index) => {
    const player = playersInRoom[index];
    if (!player) {
      return {
        slotId: `slot-${index}`,
        name: "??????",
        icon: "?",
        readyClass: "empty",
        isEmpty: true,
        isHost: false,
      };
    }
    const isReady = readyPlayerIds.includes(player.playerId);
    return {
      slotId: player.playerId,
      name:
        player.name ||
        (player.playerId === localPlayerId ? playerNameInput || "You" : player.playerId),
      icon: isReady ? "✓" : "✕",
      readyClass: isReady ? "ready" : "notReady",
      isEmpty: false,
      isHost: player.playerId === hostPlayerId,
    };
  });
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

  const handleMenuSkinChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedMarbleSkinId(resolveSkinById(event.target.value).id);
  };

  const handleGyroSettingChange = (enabled: boolean) => {
    setGyroEnabled(enabled);
    if (!enabled) {
      setStatusMessage("Gyro disabled in options. Using fallback controls.");
    }
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

  const resetCameraOptionsToDefault = () => {
    updateTuning("cameraPreset", DEFAULT_TUNING.cameraPreset);
    updateTuning("cameraZoom", DEFAULT_TUNING.cameraZoom);
    updateTuning("cameraFov", DEFAULT_TUNING.cameraFov);
    updateTuning("cameraHeightBias", DEFAULT_TUNING.cameraHeightBias);
  };

  const handleOptionsBack = () => {
    if (optionsSubmenu === "root") {
      setMenuScreen("main");
      return;
    }
    setOptionsSubmenu("root");
  };

  const handleTrackLabBack = () => {
    setMenuScreen("main");
  };

  const handleEditorBack = () => {
    editorDragStateRef.current = null;
    setEditorAddShapeOpen(false);
    setEditorImportError("");
    setEditorReferenceMarbleSelected(false);
    setMenuScreen("main");
  };

  const editorTemplateLength = getEditorTemplateLength(editorLayout.template);
  const editorTrackGeometry = useMemo(
    () => getEditorTrackGeometry(editorLayout, 120),
    [editorLayout],
  );
  const editorViewTransform = useMemo(
    () =>
      createEditorViewTransform(
        editorLayout,
        EDITOR_VIEWBOX_WIDTH,
        EDITOR_VIEWBOX_HEIGHT,
        EDITOR_TRACK_PADDING,
      ),
    [editorLayout],
  );
  const editorTemplateLabel = (() => {
    if (editorLayout.template === "arc90_left") {
      return "Arc 90 Left";
    }
    if (editorLayout.template === "arc90_right") {
      return "Arc 90 Right";
    }
    if (editorLayout.template === "s_curve") {
      return "S-Curve";
    }
    return "Straight";
  })();
  const editorTrackPathData = useMemo(() => {
    const left = editorTrackGeometry.leftEdge.map((point) =>
      worldToEditorView(editorViewTransform, point.x, point.z),
    );
    const right = editorTrackGeometry.rightEdge
      .map((point) => worldToEditorView(editorViewTransform, point.x, point.z))
      .reverse();
    const centerline = editorTrackGeometry.centerline.map((point) =>
      worldToEditorView(editorViewTransform, point.x, point.z),
    );
    const toPath = (points: Array<{ x: number; y: number }>): string =>
      points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(" ");
    const fillPath = [...left, ...right];
    return {
      fillPath: fillPath.length >= 3 ? `${toPath(fillPath)} Z` : "",
      centerlinePath: centerline.length >= 2 ? toPath(centerline) : "",
    };
  }, [editorTrackGeometry, editorViewTransform]);
  const editorRenderedObstacles = useMemo(
    () =>
      editorLayout.obstacles.map((obstacle) => {
        const pose = sampleEditorPose(editorLayout.template, obstacle.z, obstacle.x);
        const center = worldToEditorView(editorViewTransform, pose.centerX, pose.centerZ);
        const headingDeg =
          (Math.atan2(pose.tangentZ, pose.tangentX) * 180) / Math.PI + obstacle.yawDeg;
        return {
          ...obstacle,
          center,
          headingDeg,
          widthPx: Math.max(6, obstacle.width * editorViewTransform.scale),
          lengthPx: Math.max(
            6,
            (obstacle.shape === "circle" ? obstacle.width : obstacle.length) *
              editorViewTransform.scale,
          ),
        };
      }),
    [editorLayout, editorViewTransform],
  );
  const editorRenderedReferenceMarble = useMemo(() => {
    if (!editorLayout.referenceMarble) {
      return null;
    }
    const pose = sampleEditorPose(
      editorLayout.template,
      editorLayout.referenceMarble.z,
      editorLayout.referenceMarble.x,
    );
    return {
      center: worldToEditorView(editorViewTransform, pose.centerX, pose.centerZ),
      radiusPx: Math.max(6, EDITOR_REFERENCE_MARBLE_RADIUS * editorViewTransform.scale),
      x: editorLayout.referenceMarble.x,
      z: editorLayout.referenceMarble.z,
    };
  }, [editorLayout, editorViewTransform]);
  const editorSelectedObstacle = editorSelectedObstacleId
    ? editorLayout.obstacles.find((obstacle) => obstacle.id === editorSelectedObstacleId) ?? null
    : null;
  const editorSelectedRenderedObstacle = editorSelectedObstacleId
    ? editorRenderedObstacles.find((obstacle) => obstacle.id === editorSelectedObstacleId) ?? null
    : null;

  const getEditorWorldPointFromPointerEvent = (
    event: ReactPointerEvent<SVGSVGElement | SVGGElement>,
  ): { x: number; z: number } | null => {
    const svg = editorSvgRef.current;
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const viewX = ((event.clientX - rect.left) / rect.width) * EDITOR_VIEWBOX_WIDTH;
    const viewY = ((event.clientY - rect.top) / rect.height) * EDITOR_VIEWBOX_HEIGHT;
    return viewToEditorWorld(editorViewTransform, viewX, viewY);
  };

  const setEditorTemplate = (template: EditorTemplateKind) => {
    setEditorLayout((prev) => {
      if (prev.template === template) {
        return prev;
      }
      const prevLength = getEditorTemplateLength(prev.template);
      const nextLength = getEditorTemplateLength(template);
      const nextTemplateLayout = {
        ...prev,
        template,
      };
      const nextLayout: EditorLayout = {
        ...nextTemplateLayout,
        obstacles: prev.obstacles.map((obstacle) => {
          const scaledZ = prevLength > 0 ? (obstacle.z / prevLength) * nextLength : obstacle.z;
          return clampEditorObstacle(
            {
              ...obstacle,
              z: scaledZ,
            },
            nextTemplateLayout,
          );
        }),
        referenceMarble: prev.referenceMarble
          ? clampEditorReferenceMarble(
              {
                ...prev.referenceMarble,
                z: prevLength > 0 ? (prev.referenceMarble.z / prevLength) * nextLength : prev.referenceMarble.z,
              },
              nextTemplateLayout,
            )
          : null,
      };
      return nextLayout;
    });
    setEditorShapeDraft((prev) => sanitizeEditorShapeDraft(prev, template));
    setEditorStatus(
      `Template switched to ${
        template === "straight"
          ? "Straight"
          : template === "arc90_left"
            ? "Arc 90 Left"
            : template === "arc90_right"
              ? "Arc 90 Right"
              : "S-Curve"
      }.`,
    );
  };

  const openEditorAddShapeDialog = () => {
    setEditorShapeDraft(createDefaultEditorShapeDraft(editorLayout.template));
    setEditorAddShapeOpen(true);
    setEditorImportError("");
  };

  const addOrSelectReferenceMarble = () => {
    if (editorLayout.referenceMarble) {
      setEditorSelectedObstacleId(null);
      setEditorReferenceMarbleSelected(true);
      setEditorStatus("Reference marble selected.");
      return;
    }
    const startZ = getEditorTemplateLength(editorLayout.template) * 0.2;
    const nextReference = clampEditorReferenceMarble({ x: 0, z: startZ }, editorLayout);
    setEditorLayout((prev) => ({
      ...prev,
      referenceMarble: nextReference,
    }));
    setEditorSelectedObstacleId(null);
    setEditorReferenceMarbleSelected(true);
    setEditorStatus("Reference marble added.");
  };

  const updateEditorShapeDraft = <K extends keyof EditorShapeDraft>(
    key: K,
    value: EditorShapeDraft[K],
  ) => {
    setEditorShapeDraft((prev) =>
      sanitizeEditorShapeDraft(
        {
          ...prev,
          [key]: value,
        },
        editorLayout.template,
      ),
    );
  };

  const createEditorShape = () => {
    const draft = sanitizeEditorShapeDraft(editorShapeDraft, editorLayout.template);
    const nextId = `editor-shape-${Date.now().toString(36)}`;
    const shaped: EditorObstacle = clampEditorObstacle(
      {
        id: nextId,
        name: draft.name,
        shape: draft.shape,
        x: draft.x,
        z: draft.z,
        width: draft.width,
        length: draft.length,
        depth: draft.depth,
        yawDeg: draft.yawDeg,
      },
      editorLayout,
    );
    setEditorLayout((prev) => ({
      ...prev,
      obstacles: [...prev.obstacles, shaped],
    }));
    setEditorSelectedObstacleId(nextId);
    setEditorReferenceMarbleSelected(false);
    setEditorAddShapeOpen(false);
    setEditorStatus(`${shaped.name} created.`);
  };

  const updateSelectedEditorObstacle = <K extends keyof EditorObstacle>(
    key: K,
    value: EditorObstacle[K],
  ) => {
    if (!editorSelectedObstacleId) {
      return;
    }
    setEditorLayout((prev) => ({
      ...prev,
      obstacles: prev.obstacles.map((obstacle) => {
        if (obstacle.id !== editorSelectedObstacleId) {
          return obstacle;
        }
        return clampEditorObstacle(
          {
            ...obstacle,
            [key]: value,
          },
          prev,
        );
      }),
    }));
  };

  const updateSelectedEditorObstacleDiameter = (diameter: number) => {
    if (!editorSelectedObstacleId) {
      return;
    }
    setEditorLayout((prev) => ({
      ...prev,
      obstacles: prev.obstacles.map((obstacle) => {
        if (obstacle.id !== editorSelectedObstacleId) {
          return obstacle;
        }
        return clampEditorObstacle(
          {
            ...obstacle,
            width: diameter,
            length: diameter,
          },
          prev,
        );
      }),
    }));
  };

  const updateSelectedEditorShapeKind = (shape: EditorShapeKind) => {
    if (!editorSelectedObstacleId) {
      return;
    }
    setEditorLayout((prev) => ({
      ...prev,
      obstacles: prev.obstacles.map((obstacle) => {
        if (obstacle.id !== editorSelectedObstacleId) {
          return obstacle;
        }
        const nextWidth = shape === "circle" ? Math.max(obstacle.width, obstacle.length) : obstacle.width;
        const nextLength = shape === "circle" ? Math.max(obstacle.width, obstacle.length) : obstacle.length;
        return clampEditorObstacle(
          {
            ...obstacle,
            shape,
            width: nextWidth,
            length: nextLength,
          },
          prev,
        );
      }),
    }));
  };

  const deleteSelectedEditorShape = () => {
    if (editorReferenceMarbleSelected && editorLayout.referenceMarble) {
      setEditorLayout((prev) => ({
        ...prev,
        referenceMarble: null,
      }));
      setEditorReferenceMarbleSelected(false);
      setEditorStatus("Reference marble removed.");
      return;
    }
    if (!editorSelectedObstacleId) {
      setEditorStatus("Select a shape or reference marble to delete.");
      return;
    }
    const selected = editorLayout.obstacles.find((obstacle) => obstacle.id === editorSelectedObstacleId);
    setEditorLayout((prev) => ({
      ...prev,
      obstacles: prev.obstacles.filter((obstacle) => obstacle.id !== editorSelectedObstacleId),
    }));
    setEditorSelectedObstacleId(null);
    setEditorReferenceMarbleSelected(false);
    setEditorStatus(selected ? `${selected.name} deleted.` : "Shape deleted.");
  };

  const clearEditorShapes = () => {
    setEditorLayout((prev) => ({ ...prev, obstacles: [] }));
    setEditorSelectedObstacleId(null);
    setEditorReferenceMarbleSelected(false);
    setEditorStatus("All shapes cleared.");
  };

  const exportEditorLayout = async () => {
    const exportLayout = {
      version: editorLayoutRef.current.version,
      template: editorLayoutRef.current.template,
      trackWidth: editorLayoutRef.current.trackWidth,
      obstacles: editorLayoutRef.current.obstacles,
    };
    const payload = JSON.stringify(exportLayout, null, 2);
    setEditorImportText(payload);
    setEditorImportError("");
    if (!navigator.clipboard) {
      setEditorStatus("Layout exported to text box. Clipboard API unavailable.");
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      setEditorStatus("Layout JSON copied to clipboard.");
    } catch {
      setEditorStatus("Layout exported to text box.");
    }
  };

  const importEditorLayout = () => {
    try {
      const parsed = JSON.parse(editorImportText);
      const nextLayout = sanitizeEditorLayout(parsed, createDefaultEditorLayout());
      setEditorLayout(nextLayout);
      setEditorSelectedObstacleId(nextLayout.obstacles[0]?.id ?? null);
      setEditorReferenceMarbleSelected(false);
      setEditorImportError("");
      setEditorStatus(
        `Imported ${nextLayout.obstacles.length} shape${
          nextLayout.obstacles.length === 1 ? "" : "s"
        }.`,
      );
    } catch {
      setEditorImportError("Invalid layout JSON.");
    }
  };

  const handleEditorCanvasPointerDown = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }
    setEditorSelectedObstacleId(null);
    setEditorReferenceMarbleSelected(false);
  };

  const handleEditorObstaclePointerDown = (
    obstacleId: string,
    event: ReactPointerEvent<SVGGElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const selected = editorLayoutRef.current.obstacles.find((obstacle) => obstacle.id === obstacleId);
    if (!selected) {
      return;
    }
    const worldPoint = getEditorWorldPointFromPointerEvent(event);
    if (!worldPoint) {
      return;
    }
    const projected = projectWorldPointToTemplate(editorLayoutRef.current, worldPoint.x, worldPoint.z);
    editorDragStateRef.current = {
      target: "obstacle",
      obstacleId,
      pointerId: event.pointerId,
      offsetX: selected.x - projected.x,
      offsetZ: selected.z - projected.z,
    };
    setEditorSelectedObstacleId(obstacleId);
    setEditorReferenceMarbleSelected(false);
    editorSvgRef.current?.setPointerCapture(event.pointerId);
  };

  const handleEditorReferenceMarblePointerDown = (
    event: ReactPointerEvent<SVGGElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const referenceMarble = editorLayoutRef.current.referenceMarble;
    if (!referenceMarble) {
      return;
    }
    const worldPoint = getEditorWorldPointFromPointerEvent(event);
    if (!worldPoint) {
      return;
    }
    const projected = projectWorldPointToTemplate(editorLayoutRef.current, worldPoint.x, worldPoint.z);
    editorDragStateRef.current = {
      target: "reference_marble",
      obstacleId: null,
      pointerId: event.pointerId,
      offsetX: referenceMarble.x - projected.x,
      offsetZ: referenceMarble.z - projected.z,
    };
    setEditorSelectedObstacleId(null);
    setEditorReferenceMarbleSelected(true);
    editorSvgRef.current?.setPointerCapture(event.pointerId);
  };

  const handleEditorCanvasPointerMove = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    const drag = editorDragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const worldPoint = getEditorWorldPointFromPointerEvent(event);
    if (!worldPoint) {
      return;
    }
    const projected = projectWorldPointToTemplate(
      editorLayoutRef.current,
      worldPoint.x,
      worldPoint.z,
    );
    if (drag.target === "reference_marble") {
      setEditorLayout((prev) => ({
        ...prev,
        referenceMarble: prev.referenceMarble
          ? clampEditorReferenceMarble(
              {
                x: projected.x + drag.offsetX,
                z: projected.z + drag.offsetZ,
              },
              prev,
            )
          : null,
      }));
      return;
    }
    setEditorLayout((prev) => ({
      ...prev,
      obstacles: prev.obstacles.map((obstacle) => {
        if (obstacle.id !== drag.obstacleId) {
          return obstacle;
        }
        return clampEditorObstacle(
          {
            ...obstacle,
            x: projected.x + drag.offsetX,
            z: projected.z + drag.offsetZ,
          },
          prev,
        );
      }),
    }));
  };

  const endEditorDrag = () => {
    if (editorDragStateRef.current) {
      setEditorStatus(
        editorDragStateRef.current.target === "reference_marble"
          ? "Reference marble moved."
          : "Shape moved.",
      );
    }
    editorDragStateRef.current = null;
  };

  const handleEditorCanvasPointerEnd = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    const drag = editorDragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (editorSvgRef.current?.hasPointerCapture(event.pointerId)) {
      editorSvgRef.current.releasePointerCapture(event.pointerId);
    }
    endEditorDrag();
  };

  const setTrackDraftKind = (kind: TrackPieceKind) => {
    setTrackLabDraft((prev) => {
      const seeded = toTrackDraft(createDefaultCustomPiece(kind));
      return {
        ...seeded,
        label: prev.label,
        weight: prev.weight,
      };
    });
  };

  const updateTrackLabDraft = <K extends keyof TrackPieceDraft>(
    key: K,
    value: TrackPieceDraft[K],
  ) => {
    setTrackLabDraft((prev) => ({ ...prev, [key]: value }));
  };

  const beginNewTrackPiece = (kind: TrackPieceKind = trackLabDraft.kind) => {
    setTrackLabSelectedPieceId(null);
    setTrackLabDraft(toTrackDraft(createDefaultCustomPiece(kind)));
  };

  const indexedTrackPieceLabel = (piece: TrackPieceTemplate, suffix: string): string =>
    `${piece.label} ${suffix}.`;

  const saveTrackPieceDraft = () => {
    const nextId = trackLabSelectedPieceId ?? `custom-${Date.now().toString(36)}`;
    const candidate = sanitizeTrackPieceTemplate(
      {
        ...trackLabDraft,
        id: nextId,
      },
      nextId,
    );
    if (!candidate) {
      setTrackLabStatus("Invalid piece settings.");
      return;
    }
    setTrackLabCustomPieces((prev) => {
      const next = [...prev];
      const index = next.findIndex((entry) => entry.id === nextId);
      if (index >= 0) {
        next[index] = candidate;
      } else {
        next.push(candidate);
      }
      return sanitizeTrackPieceLibrary(next);
    });
    setTrackLabSelectedPieceId(nextId);
    setTrackLabStatus(indexedTrackPieceLabel(candidate, "saved"));
  };

  const selectTrackPiece = (pieceId: string) => {
    const selected = trackLabCustomPieces.find((piece) => piece.id === pieceId);
    if (!selected) {
      return;
    }
    setTrackLabSelectedPieceId(pieceId);
    setTrackLabDraft(toTrackDraft(selected));
    setTrackLabStatus(`${selected.label} loaded into editor.`);
  };

  const deleteSelectedTrackPiece = () => {
    if (!trackLabSelectedPieceId) {
      setTrackLabStatus("Select a piece to delete.");
      return;
    }
    const selected = trackLabCustomPieces.find((piece) => piece.id === trackLabSelectedPieceId);
    setTrackLabCustomPieces((prev) =>
      prev.filter((piece) => piece.id !== trackLabSelectedPieceId),
    );
    setTrackLabSelectedPieceId(null);
    beginNewTrackPiece();
    setTrackLabStatus(selected ? `${selected.label} deleted.` : "Piece deleted.");
  };

  const applyTrackLabPreview = () => {
    const nextConfig = buildTrackConfig(
      trackLabSeed,
      trackLabPieceCount,
      "builtin_plus_custom",
      trackLabCustomPieces,
      "default",
      toTrackVisualSettingsFromTuning(tuningRef.current),
    );
    syncTrackLabSeed(nextConfig.seed);
    setTrackLabPieceCount(nextConfig.pieceCount);
    applyTrackConfigRef.current(nextConfig);
    setTrackLabStatus(
      `Preview applied using seed "${nextConfig.seed}" with ${nextConfig.pieceCount} pieces.`,
    );
  };

  const resetTrackLabLibrary = () => {
    setTrackLabCustomPieces([]);
    setTrackLabSelectedPieceId(null);
    beginNewTrackPiece();
    setTrackLabStatus("Custom piece library cleared.");
  };

  const randomizeSeedForTrackLab = () => {
    const next = randomTrackSeed("track");
    syncTrackLabSeed(next);
    setTrackLabStatus(`Seed randomized: ${next}`);
  };

  const gyroPermissionWorking =
    tiltStatus.supported &&
    tiltStatus.permission === "granted" &&
    tiltStatus.enabled;

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
    if (!localReady && gyroEnabled) {
      await enableTiltRef.current();
    }
    raceClientRef.current?.sendReady(!localReady);
  };

  const startMatch = () => {
    if (gameMode !== "multiplayer") {
      return;
    }
    if (!roomCode || !localPlayerId) {
      setNetError("Join a room before starting the match.");
      return;
    }
    if (!isLocalPlayerHost) {
      setNetError("Only the host can start the match.");
      return;
    }
    if (playersInRoom.length < 2) {
      setNetError("At least 2 players are required.");
      return;
    }
    if (!allPlayersReady) {
      setNetError("All joined players must be READY.");
      return;
    }
    const seed = sanitizeTrackSeed(trackLabSeedRef.current);
    setMultiplayerTrackSeed(seed);
    setNetError(null);
    raceClientRef.current?.sendRaceStart(seed);
  };

  const applySoloTrackSeed = (seed: string): void => {
    const nextSeed = syncTrackLabSeed(seed);
    const nextConfig = buildTrackConfig(
      nextSeed,
      trackLabPieceCountRef.current,
      "builtin_plus_custom",
      trackLabCustomPiecesRef.current,
      "default",
      toTrackVisualSettingsFromTuning(tuningRef.current),
      SOLO_TRACK_GENERATION_POLICY,
    );
    setTrackLabPieceCount(nextConfig.pieceCount);
    applyTrackConfigRef.current(nextConfig);
  };

  const rebuildSoloTrackWithRandomSeed = (): void => {
    applySoloTrackSeed(randomTrackSeed("solo"));
  };

  const startSoloRaceSequence = async () => {
    const sequenceId = soloStartSequenceRef.current + 1;
    soloStartSequenceRef.current = sequenceId;
    setRaceResult(null);
    setCountdownToken(null);
    setCountdownStartAtMs(null);
    setTrialState("idle");
    setTrialCurrentMs(null);
    setRespawnCount(0);
    hasSentFinishRef.current = false;
    countdownIndexRef.current = -1;
    countdownGoHandledRef.current = false;
    resetRef.current();
    freezeMarbleRef.current();

    if (isMobile && gyroEnabled) {
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

  const remixSoloRace = () => {
    rebuildSoloTrackWithRandomSeed();
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
    if (nextMode !== "solo" && nextMode !== "testAll") {
      soloStartSequenceRef.current += 1;
    }
    setGameMode(nextMode);
    setCountdownStartAtMs(null);
    setCountdownToken(null);
    setRoomCode("");
    setLocalPlayerId("");
    setHostPlayerId("");
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
      rebuildSoloTrackWithRandomSeed();
      void startSoloRaceSequence();
      return;
    }
    if (nextMode === "testAll") {
      applyTrackConfigRef.current(
        buildTrackConfig(
          trackLabSeedRef.current,
          trackLabPieceCountRef.current,
          "builtin",
          [],
          "testAll",
          toTrackVisualSettingsFromTuning(tuningRef.current),
        ),
      );
      void startSoloRaceSequence();
      return;
    }
    if (nextMode === "multiplayer") {
      setDrawerOpen(false);
      applyTrackConfigRef.current(
        buildTrackConfig(
          multiplayerTrackSeedRef.current,
          trackLabPieceCountRef.current,
          "builtin",
          [],
          "default",
          toTrackVisualSettingsFromTuning(tuningRef.current),
        ),
      );
      raceClientRef.current?.setPreferredName(playerNameRef.current || undefined);
      raceClientRef.current?.setPreferredSkinId(
        selectedMarbleSkinIdRef.current === defaultSkinId
          ? undefined
          : selectedMarbleSkinIdRef.current,
      );
      raceClientRef.current?.createRoom();
    }
    if (nextMode === "unselected") {
      applyTrackConfigRef.current(
        buildTrackConfig(
          trackLabSeedRef.current,
          trackLabPieceCountRef.current,
          "builtin_plus_custom",
          trackLabCustomPiecesRef.current,
          "default",
          toTrackVisualSettingsFromTuning(tuningRef.current),
        ),
      );
      setOptionsSubmenu("root");
      setMenuScreen("main");
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
    <div className="appShell" data-testid="app-shell">
      <p className="versionBadge" data-testid="version-badge">Version {APP_VERSION}</p>
      <div className="viewport" ref={mountRef} data-testid="game-viewport" />
      {showRotateToPortraitOverlay ? (
        <div className="orientationGuardOverlay" role="alert" aria-live="polite">
          <div className="orientationGuardCard">
            <p className="orientationGuardTitle">Rotate To Portrait</p>
            <p className="orientationGuardHint">
              Keep your phone upright to keep tilt controls stable.
            </p>
          </div>
        </div>
      ) : null}
      {showModePicker ? (
        <div className="raceOverlay menuOverlay" data-testid="mode-picker-overlay">
          <div className="raceOverlayCard menuCard" data-testid="mode-picker-card">
            <div className="menuTitleWrap">
              <h1 className="menuGameTitle">Get Tilted</h1>
            </div>
            <p className="menuIntroText">Pick a mode and roll in.</p>
            <div className="menuFeatureCard" data-testid="solo-feature-card">
              <p className="menuFeatureEyebrow">Current Solo Slice</p>
              <h2 className="menuFeatureTitle">{SOLO_GAUNTLET_NAME}</h2>
              <p className="menuFeatureText">{soloCourse.courseTagline}</p>
            </div>
            <div className="mainMenuButtonGrid">
              <button
                type="button"
                className="menuActionButton"
                data-testid="main-menu-singleplayer"
                onClick={() => switchGameMode("solo")}
              >
                Solo Gauntlet
              </button>
              <button
                type="button"
                className="menuActionButton"
                data-testid="main-menu-test-all"
                onClick={() => switchGameMode("testAll")}
              >
                Test All
              </button>
              <button
                type="button"
                className="menuActionButton"
                data-testid="main-menu-multiplayer"
                onClick={() => switchGameMode("multiplayer")}
              >
                Multiplayer
              </button>
              <button
                type="button"
                className="menuActionButton"
                data-testid="main-menu-options"
                onClick={() => {
                  setOptionsSubmenu("root");
                  setMenuScreen("options");
                }}
              >
                Options
              </button>
              <button
                type="button"
                className="menuActionButton"
                data-testid="main-menu-editor"
                onClick={() => setMenuScreen("editor")}
              >
                Editor
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showOptionsMenu ? (
        <div className="raceOverlay menuOverlay" data-testid="options-overlay">
          <div className="raceOverlayCard menuCard optionsCard" data-testid="options-card">
            <div className="menuHeaderRow">
              <button
                type="button"
                className="lobbyBackButton optionsBackButton"
                onClick={handleOptionsBack}
              >
                {"< Back"}
              </button>
              <p className="raceOverlayTitle optionsTitle">{optionsTitleLabel}</p>
            </div>
            <div className="optionsPanel">
              <label className="optionsField" htmlFor="optionsPlayerName">
                <span className="optionsFieldLabel">Player Name</span>
                <input
                  id="optionsPlayerName"
                  data-testid="options-player-name"
                  className="optionsTextInput"
                  value={playerNameInput}
                  onChange={(event) => setPlayerNameInput(sanitizePlayerName(event.target.value))}
                  placeholder="Enter name"
                  maxLength={18}
                  autoComplete="nickname"
                />
              </label>
              <label className="optionsField" htmlFor="menuSkinSelect">
                <span className="optionsFieldLabel">Marble Skin</span>
                <select
                  id="menuSkinSelect"
                  className="menuSelect"
                  value={selectedMarbleSkinId}
                  onChange={handleMenuSkinChange}
                >
                  {skinCatalog.map((skin) => (
                    <option key={skin.id} value={skin.id}>
                      {skin.label}
                    </option>
                  ))}
                </select>
              </label>
              {showingOptionsRoot ? (
                <div className="optionsInlineButtons">
                  <button
                    type="button"
                    className="menuActionButton optionsMenuButton"
                    onClick={() => setOptionsSubmenu("controls")}
                  >
                    Controls
                  </button>
                  <button
                    type="button"
                    className="menuActionButton optionsMenuButton"
                    onClick={() => setOptionsSubmenu("camera")}
                  >
                    Camera
                  </button>
                </div>
              ) : null}
              {showingOptionsControls ? (
                <div className="optionsSubmenuPanel">
                  <label className="optionsToggleRow" htmlFor="optionsGyroEnabled">
                    <span>Gyro Enabled</span>
                    <input
                      id="optionsGyroEnabled"
                      data-testid="options-gyro-enabled"
                      type="checkbox"
                      checked={gyroEnabled}
                      onChange={(event) => handleGyroSettingChange(event.target.checked)}
                    />
                  </label>
                  <label className="optionsToggleRow" htmlFor="optionsMirrorX">
                    <span>Mirror X</span>
                    <input
                      id="optionsMirrorX"
                      type="checkbox"
                      checked={tuning.invertTiltX}
                      onChange={(event) => updateTuning("invertTiltX", event.target.checked)}
                    />
                  </label>
                  <label className="optionsToggleRow" htmlFor="optionsMirrorY">
                    <span>Mirror Y</span>
                    <input
                      id="optionsMirrorY"
                      type="checkbox"
                      checked={tuning.invertTiltZ}
                      onChange={(event) => updateTuning("invertTiltZ", event.target.checked)}
                    />
                  </label>
                  <button
                    type="button"
                    className="menuActionButton optionsSubmenuActionButton"
                    onClick={() => calibrateTiltRef.current()}
                  >
                    Calibrate Gyro
                  </button>
                  <button
                    type="button"
                    className="menuActionButton optionsSubmenuActionButton"
                    onClick={() => void enableTiltRef.current()}
                  >
                    Gyro Permissions: {gyroPermissionWorking ? "WORKING" : "NOT WORKING"}
                  </button>
                </div>
              ) : null}
              {showingOptionsCamera ? (
                <div className="optionsSubmenuPanel">
                  <p className="tiltStatus">Camera Type: Broadcast</p>
                  <label className="optionsSliderField" htmlFor="optionsCameraZoom">
                    <span className="optionsFieldLabel">
                      Camera Zoom Level ({tuning.cameraZoom.toFixed(2)})
                    </span>
                    <input
                      id="optionsCameraZoom"
                      type="range"
                      min={0.5}
                      max={1.4}
                      step={0.01}
                      value={tuning.cameraZoom}
                      onChange={(event) => updateTuning("cameraZoom", Number(event.target.value))}
                    />
                  </label>
                  <label className="optionsSliderField" htmlFor="optionsCameraFov">
                    <span className="optionsFieldLabel">FOV ({Math.round(tuning.cameraFov)})</span>
                    <input
                      id="optionsCameraFov"
                      type="range"
                      min={50}
                      max={90}
                      step={1}
                      value={tuning.cameraFov}
                      onChange={(event) => updateTuning("cameraFov", Number(event.target.value))}
                    />
                  </label>
                  <label className="optionsSliderField" htmlFor="optionsCameraHeight">
                    <span className="optionsFieldLabel">
                      Camera Height ({tuning.cameraHeightBias.toFixed(1)})
                    </span>
                    <input
                      id="optionsCameraHeight"
                      type="range"
                      min={-6}
                      max={8}
                      step={0.1}
                      value={tuning.cameraHeightBias}
                      onChange={(event) =>
                        updateTuning("cameraHeightBias", Number(event.target.value))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="menuActionButton optionsSubmenuActionButton"
                    onClick={resetCameraOptionsToDefault}
                  >
                    Reset to Default
                  </button>
                </div>
              ) : null}
              <label className="optionsToggleRow" htmlFor="optionsMusicEnabled">
                <span>Music</span>
                <input
                  id="optionsMusicEnabled"
                  type="checkbox"
                  checked={musicEnabled}
                  onChange={(event) => setMusicEnabled(event.target.checked)}
                />
              </label>
              <label className="optionsToggleRow" htmlFor="optionsSoundEnabled">
                <span>Sound</span>
                <input
                  id="optionsSoundEnabled"
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(event) => setSoundEnabled(event.target.checked)}
                />
              </label>
              <label className="optionsToggleRow" htmlFor="optionsDebugEnabled">
                <span>debug</span>
                <input
                  id="optionsDebugEnabled"
                  data-testid="options-debug-enabled"
                  type="checkbox"
                  checked={debugMenuEnabled}
                  onChange={(event) => setDebugMenuEnabled(event.target.checked)}
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}
      {showTrackLabMenu ? (
        <div className="raceOverlay menuOverlay">
          <div className="raceOverlayCard menuCard trackLabCard">
            <div className="menuHeaderRow">
              <button
                type="button"
                className="lobbyBackButton optionsBackButton"
                onClick={handleTrackLabBack}
              >
                {"< Back"}
              </button>
              <p className="raceOverlayTitle optionsTitle">Track Lab</p>
            </div>
            <div className="trackLabPanel">
              <label className="optionsField" htmlFor="trackLabSeedInput">
                <span className="optionsFieldLabel">Seed</span>
                <input
                  id="trackLabSeedInput"
                  className="optionsTextInput"
                  value={trackLabSeed}
                  onChange={(event) => syncTrackLabSeed(sanitizeTrackSeedInput(event.target.value))}
                  placeholder="seed_123"
                  maxLength={64}
                  autoComplete="off"
                />
              </label>
              <div className="optionsInlineButtons">
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton"
                  onClick={randomizeSeedForTrackLab}
                >
                  Randomize Seed
                </button>
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton"
                  onClick={() => syncTrackLabSeed(DEFAULT_TRACK_SEED)}
                >
                  Reset Seed
                </button>
              </div>
              <label className="optionsSliderField" htmlFor="trackLabPieceCount">
                <span className="optionsFieldLabel">Piece Count ({trackLabPieceCount})</span>
                <input
                  id="trackLabPieceCount"
                  type="range"
                  min={6}
                  max={48}
                  step={1}
                  value={trackLabPieceCount}
                  onChange={(event) => setTrackLabPieceCount(Number(event.target.value))}
                />
              </label>
              <p className="raceHint">Multiplayer race seed: {multiplayerTrackSeed}</p>
              <p className="raceHint">
                Split/Merge generation is temporarily disabled while path stabilization is in
                progress.
              </p>
              <p className="raceHint">
                90° bends are automatically paired so direction returns down-track quickly.
              </p>
              <div className="trackLabEditorGrid">
                <label className="optionsField" htmlFor="trackPieceLabel">
                  <span className="optionsFieldLabel">Piece Name</span>
                  <input
                    id="trackPieceLabel"
                    className="optionsTextInput"
                    value={trackLabDraft.label}
                    maxLength={28}
                    onChange={(event) => updateTrackLabDraft("label", event.target.value)}
                  />
                </label>
                <label className="optionsField" htmlFor="trackPieceKind">
                  <span className="optionsFieldLabel">Piece Type</span>
                  <select
                    id="trackPieceKind"
                    className="menuSelect"
                    value={trackLabDraft.kind}
                    onChange={(event) => setTrackDraftKind(event.target.value as TrackPieceKind)}
                  >
                    <option value="straight">Straight</option>
                    <option value="arc90">Arc 90</option>
                  </select>
                </label>
                <label className="optionsSliderField" htmlFor="trackPieceLength">
                  <span className="optionsFieldLabel">
                    Length ({trackLabDraft.length.toFixed(1)})
                  </span>
                  <input
                    id="trackPieceLength"
                    type="range"
                    min={4}
                    max={24}
                    step={0.5}
                    value={trackLabDraft.length}
                    onChange={(event) => updateTrackLabDraft("length", Number(event.target.value))}
                  />
                </label>
                <label className="optionsSliderField" htmlFor="trackPieceWidthScale">
                  <span className="optionsFieldLabel">
                    Width Scale ({trackLabDraft.widthScale.toFixed(2)})
                  </span>
                  <input
                    id="trackPieceWidthScale"
                    type="range"
                    min={0.35}
                    max={1.35}
                    step={0.01}
                    value={trackLabDraft.widthScale}
                    onChange={(event) =>
                      updateTrackLabDraft("widthScale", Number(event.target.value))
                    }
                  />
                </label>
                <label className="optionsSliderField" htmlFor="trackPieceSlope">
                  <span className="optionsFieldLabel">
                    Grade ({trackLabDraft.gradeDeg.toFixed(1)}°)
                  </span>
                  <input
                    id="trackPieceSlope"
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={trackLabDraft.gradeDeg}
                    onChange={(event) => updateTrackLabDraft("gradeDeg", Number(event.target.value))}
                  />
                </label>
                <label className="optionsSliderField" htmlFor="trackPieceTurnStrength">
                  <span className="optionsFieldLabel">
                    Turn ({Math.round(trackLabDraft.turnDeg)}°)
                  </span>
                  <input
                    id="trackPieceTurnStrength"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={trackLabDraft.turnDeg}
                    onChange={(event) =>
                      updateTrackLabDraft("turnDeg", Number(event.target.value))
                    }
                  />
                </label>
                <label className="optionsSliderField" htmlFor="trackPieceBank">
                  <span className="optionsFieldLabel">
                    Bank ({trackLabDraft.bankDeg.toFixed(1)}°)
                  </span>
                  <input
                    id="trackPieceBank"
                    type="range"
                    min={-35}
                    max={35}
                    step={0.5}
                    value={trackLabDraft.bankDeg}
                    onChange={(event) => updateTrackLabDraft("bankDeg", Number(event.target.value))}
                  />
                </label>
                <label className="optionsField" htmlFor="trackPieceDirection">
                  <span className="optionsFieldLabel">Turn Direction</span>
                  <select
                    id="trackPieceDirection"
                    className="menuSelect"
                    value={trackLabDraft.turnDirection}
                    onChange={(event) =>
                      updateTrackLabDraft(
                        "turnDirection",
                        event.target.value === "right" ? "right" : "left",
                      )
                    }
                  >
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <label className="optionsToggleRow" htmlFor="trackPieceTunnelRoof">
                  <span>Tunnel Roof</span>
                  <input
                    id="trackPieceTunnelRoof"
                    type="checkbox"
                    checked={trackLabDraft.tunnelRoof}
                    onChange={(event) => updateTrackLabDraft("tunnelRoof", event.target.checked)}
                  />
                </label>
                <label className="optionsSliderField" htmlFor="trackPieceWeight">
                  <span className="optionsFieldLabel">
                    Spawn Weight ({trackLabDraft.weight.toFixed(2)})
                  </span>
                  <input
                    id="trackPieceWeight"
                    type="range"
                    min={0.1}
                    max={5}
                    step={0.1}
                    value={trackLabDraft.weight}
                    onChange={(event) => updateTrackLabDraft("weight", Number(event.target.value))}
                  />
                </label>
                <label className="optionsToggleRow" htmlFor="trackPieceRailLeft">
                  <span>Rail Left</span>
                  <input
                    id="trackPieceRailLeft"
                    type="checkbox"
                    checked={trackLabDraft.railLeft}
                    onChange={(event) => updateTrackLabDraft("railLeft", event.target.checked)}
                  />
                </label>
                <label className="optionsToggleRow" htmlFor="trackPieceRailRight">
                  <span>Rail Right</span>
                  <input
                    id="trackPieceRailRight"
                    type="checkbox"
                    checked={trackLabDraft.railRight}
                    onChange={(event) => updateTrackLabDraft("railRight", event.target.checked)}
                  />
                </label>
              </div>
              <div className="optionsInlineButtons">
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton"
                  onClick={saveTrackPieceDraft}
                >
                  {trackLabSelectedPieceId ? "Update Piece" : "Save Piece"}
                </button>
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton"
                  onClick={() => beginNewTrackPiece(trackLabDraft.kind)}
                >
                  New Piece
                </button>
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton"
                  onClick={deleteSelectedTrackPiece}
                >
                  Delete Piece
                </button>
              </div>
              <div className="trackLabPieceList">
                {trackLabCustomPieces.length === 0 ? (
                  <p className="raceHint">No custom pieces yet. Save your first piece above.</p>
                ) : (
                  trackLabCustomPieces.map((piece) => (
                    <button
                      key={piece.id}
                      type="button"
                      className={`trackLabPieceButton ${
                        piece.id === trackLabSelectedPieceId ? "selected" : ""
                      }`}
                      onClick={() => selectTrackPiece(piece.id)}
                    >
                      {piece.label} · {piece.kind}
                    </button>
                  ))
                )}
              </div>
              <div className="optionsInlineButtons">
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton"
                  onClick={applyTrackLabPreview}
                >
                  Apply Preview Track
                </button>
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton"
                  onClick={resetTrackLabLibrary}
                >
                  Clear Custom Pieces
                </button>
              </div>
              {trackLabStatus ? <p className="raceHint">{trackLabStatus}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
      {showEditorMenu ? (
        <div className="raceOverlay menuOverlay">
          <div className="raceOverlayCard menuCard editorCard">
            <div className="menuHeaderRow">
              <button
                type="button"
                className="lobbyBackButton optionsBackButton"
                onClick={handleEditorBack}
              >
                {"< Back"}
              </button>
              <p className="raceOverlayTitle optionsTitle">Editor</p>
            </div>
            <div className="editorPanel">
              <div className="editorToolbar">
                <label className="optionsField" htmlFor="editorTemplateSelect">
                  <span className="optionsFieldLabel">Template Piece</span>
                  <select
                    id="editorTemplateSelect"
                    className="menuSelect"
                    value={editorLayout.template}
                    onChange={(event) =>
                      setEditorTemplate(event.target.value as EditorTemplateKind)
                    }
                  >
                    <option value="straight">Straight</option>
                    <option value="arc90_left">Arc 90 Left</option>
                    <option value="arc90_right">Arc 90 Right</option>
                    <option value="s_curve">S-Curve</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton editorToolbarButton"
                  onClick={openEditorAddShapeDialog}
                >
                  Add New Shape
                </button>
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton editorToolbarButton"
                  onClick={deleteSelectedEditorShape}
                >
                  Delete Selected
                </button>
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton editorToolbarButton"
                  onClick={addOrSelectReferenceMarble}
                >
                  {editorLayout.referenceMarble ? "Select Ref Marble" : "Add Ref Marble"}
                </button>
              </div>
              <p className="raceHint">
                Top-down editor: drag shapes in X/Z space. Y remains fixed to track height.
              </p>
              <p className="raceHint">
                Reference marble is a fixed-size guide and is excluded from exported obstacle JSON.
              </p>
              <p className="raceHint">
                Template: {editorTemplateLabel} · Track Width {editorLayout.trackWidth.toFixed(1)} ·
                Length {editorTemplateLength.toFixed(1)}
              </p>
              <div className="editorWorkspace">
                <div className="editorCanvasWrap">
                  <svg
                    ref={editorSvgRef}
                    className="editorSvgCanvas"
                    viewBox={`0 0 ${EDITOR_VIEWBOX_WIDTH} ${EDITOR_VIEWBOX_HEIGHT}`}
                    role="img"
                    aria-label="Track obstacle editor canvas"
                    onPointerDown={handleEditorCanvasPointerDown}
                    onPointerMove={handleEditorCanvasPointerMove}
                    onPointerUp={handleEditorCanvasPointerEnd}
                    onPointerCancel={handleEditorCanvasPointerEnd}
                  >
                    <rect
                      x={0}
                      y={0}
                      width={EDITOR_VIEWBOX_WIDTH}
                      height={EDITOR_VIEWBOX_HEIGHT}
                      className="editorCanvasBackdrop"
                    />
                    {editorTrackPathData.fillPath ? (
                      <path className="editorTrackSurface" d={editorTrackPathData.fillPath} />
                    ) : null}
                    {editorTrackPathData.centerlinePath ? (
                      <path className="editorTrackCenterline" d={editorTrackPathData.centerlinePath} />
                    ) : null}
                    {editorRenderedReferenceMarble ? (
                      <g
                        className={`editorReferenceMarble ${
                          editorReferenceMarbleSelected ? "selected" : ""
                        }`}
                        transform={`translate(${editorRenderedReferenceMarble.center.x.toFixed(2)} ${editorRenderedReferenceMarble.center.y.toFixed(2)})`}
                        onPointerDown={handleEditorReferenceMarblePointerDown}
                      >
                        <circle
                          cx={0}
                          cy={0}
                          r={editorRenderedReferenceMarble.radiusPx.toFixed(2)}
                          className="editorReferenceMarbleShape"
                        />
                        <text className="editorReferenceMarbleLabel" x={0} y={4}>
                          M
                        </text>
                      </g>
                    ) : null}
                    {editorRenderedObstacles.map((obstacle, index) => (
                      <g
                        key={obstacle.id}
                        className={`editorObstacle ${
                          obstacle.id === editorSelectedObstacleId ? "selected" : ""
                        }`}
                        transform={`translate(${obstacle.center.x.toFixed(2)} ${obstacle.center.y.toFixed(
                          2,
                        )}) rotate(${obstacle.headingDeg.toFixed(2)})`}
                        onPointerDown={(event) => handleEditorObstaclePointerDown(obstacle.id, event)}
                      >
                        {obstacle.shape === "circle" ? (
                          <circle
                            cx={0}
                            cy={0}
                            r={(obstacle.widthPx * 0.5).toFixed(2)}
                            className="editorObstacleShape circle"
                          />
                        ) : obstacle.shape === "triangle" ? (
                          <polygon
                            points={`${(obstacle.lengthPx * 0.5).toFixed(2)},0 ${(-obstacle.lengthPx * 0.5).toFixed(
                              2,
                            )},${(-obstacle.widthPx * 0.5).toFixed(2)} ${(-obstacle.lengthPx * 0.5).toFixed(
                              2,
                            )},${(obstacle.widthPx * 0.5).toFixed(2)}`}
                            className="editorObstacleShape triangle"
                          />
                        ) : (
                          <rect
                            x={(-obstacle.lengthPx * 0.5).toFixed(2)}
                            y={(-obstacle.widthPx * 0.5).toFixed(2)}
                            width={obstacle.lengthPx.toFixed(2)}
                            height={obstacle.widthPx.toFixed(2)}
                            className="editorObstacleShape rectangle"
                            rx={Math.max(2, obstacle.widthPx * 0.12)}
                            ry={Math.max(2, obstacle.widthPx * 0.12)}
                          />
                        )}
                        <text className="editorObstacleIndex" x={0} y={4}>
                          {index + 1}
                        </text>
                      </g>
                    ))}
                  </svg>
                </div>
                <div className="editorInspector">
                  <p className="tiltStatus">Selected Shape</p>
                  {editorSelectedObstacle ? (
                    <>
                      <label className="optionsField" htmlFor="editorSelectedName">
                        <span className="optionsFieldLabel">Name</span>
                        <input
                          id="editorSelectedName"
                          className="optionsTextInput"
                          value={editorSelectedObstacle.name}
                          onChange={(event) =>
                            updateSelectedEditorObstacle("name", event.target.value)
                          }
                          maxLength={48}
                        />
                      </label>
                      <label className="optionsField" htmlFor="editorSelectedShape">
                        <span className="optionsFieldLabel">Shape</span>
                        <select
                          id="editorSelectedShape"
                          className="menuSelect"
                          value={editorSelectedObstacle.shape}
                          onChange={(event) =>
                            updateSelectedEditorShapeKind(event.target.value as EditorShapeKind)
                          }
                        >
                          <option value="rectangle">Rectangle</option>
                          <option value="triangle">Triangle</option>
                          <option value="circle">Circle</option>
                        </select>
                      </label>
                      <div className="editorInspectorGrid">
                        <label className="optionsField" htmlFor="editorSelectedX">
                          <span className="optionsFieldLabel">X</span>
                          <input
                            id="editorSelectedX"
                            className="optionsTextInput"
                            type="number"
                            step={0.1}
                            value={editorSelectedObstacle.x.toFixed(2)}
                            onChange={(event) =>
                              updateSelectedEditorObstacle("x", Number(event.target.value))
                            }
                          />
                        </label>
                        <label className="optionsField" htmlFor="editorSelectedZ">
                          <span className="optionsFieldLabel">Z</span>
                          <input
                            id="editorSelectedZ"
                            className="optionsTextInput"
                            type="number"
                            step={0.1}
                            min={0}
                            max={editorTemplateLength}
                            value={editorSelectedObstacle.z.toFixed(2)}
                            onChange={(event) =>
                              updateSelectedEditorObstacle("z", Number(event.target.value))
                            }
                          />
                        </label>
                        {editorSelectedObstacle.shape === "circle" ? (
                          <label className="optionsField" htmlFor="editorSelectedDiameter">
                            <span className="optionsFieldLabel">Diameter</span>
                            <input
                              id="editorSelectedDiameter"
                              className="optionsTextInput"
                              type="number"
                              step={0.1}
                              min={0.35}
                              max={9}
                              value={Math.max(
                                editorSelectedObstacle.width,
                                editorSelectedObstacle.length,
                              ).toFixed(2)}
                              onChange={(event) =>
                                updateSelectedEditorObstacleDiameter(Number(event.target.value))
                              }
                            />
                          </label>
                        ) : (
                          <>
                            <label className="optionsField" htmlFor="editorSelectedWidth">
                              <span className="optionsFieldLabel">Width</span>
                              <input
                                id="editorSelectedWidth"
                                className="optionsTextInput"
                                type="number"
                                step={0.1}
                                min={0.35}
                                max={9}
                                value={editorSelectedObstacle.width.toFixed(2)}
                                onChange={(event) =>
                                  updateSelectedEditorObstacle("width", Number(event.target.value))
                                }
                              />
                            </label>
                            <label className="optionsField" htmlFor="editorSelectedLength">
                              <span className="optionsFieldLabel">Length</span>
                              <input
                                id="editorSelectedLength"
                                className="optionsTextInput"
                                type="number"
                                step={0.1}
                                min={0.35}
                                max={14}
                                value={editorSelectedObstacle.length.toFixed(2)}
                                onChange={(event) =>
                                  updateSelectedEditorObstacle("length", Number(event.target.value))
                                }
                              />
                            </label>
                          </>
                        )}
                        <label className="optionsField" htmlFor="editorSelectedDepth">
                          <span className="optionsFieldLabel">Depth</span>
                          <input
                            id="editorSelectedDepth"
                            className="optionsTextInput"
                            type="number"
                            step={0.1}
                            min={0.2}
                            max={8}
                            value={editorSelectedObstacle.depth.toFixed(2)}
                            onChange={(event) =>
                              updateSelectedEditorObstacle("depth", Number(event.target.value))
                            }
                          />
                        </label>
                        <label className="optionsField" htmlFor="editorSelectedYaw">
                          <span className="optionsFieldLabel">Yaw</span>
                          <input
                            id="editorSelectedYaw"
                            className="optionsTextInput"
                            type="number"
                            step={1}
                            min={-180}
                            max={180}
                            value={editorSelectedObstacle.yawDeg.toFixed(0)}
                            onChange={(event) =>
                              updateSelectedEditorObstacle("yawDeg", Number(event.target.value))
                            }
                          />
                        </label>
                      </div>
                      {editorSelectedRenderedObstacle ? (
                        <p className="raceHint">
                          Screen center: x {editorSelectedRenderedObstacle.center.x.toFixed(1)}, y{" "}
                          {editorSelectedRenderedObstacle.center.y.toFixed(1)}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="raceHint">
                      {editorReferenceMarbleSelected && editorRenderedReferenceMarble
                        ? `Reference marble selected (fixed diameter ${(EDITOR_REFERENCE_MARBLE_RADIUS * 2).toFixed(2)}). X ${editorRenderedReferenceMarble.x.toFixed(2)}, Z ${editorRenderedReferenceMarble.z.toFixed(2)}`
                        : "Select a shape from canvas or list to edit it."}
                    </p>
                  )}
                </div>
              </div>
              <div className="editorShapeList">
                {editorLayout.referenceMarble ? (
                  <button
                    type="button"
                    className={`trackLabPieceButton ${
                      editorReferenceMarbleSelected ? "selected" : ""
                    }`}
                    onClick={() => {
                      setEditorSelectedObstacleId(null);
                      setEditorReferenceMarbleSelected(true);
                    }}
                  >
                    R. Reference Marble · fixed
                  </button>
                ) : null}
                {editorLayout.obstacles.length === 0 ? (
                  <p className="raceHint">No shapes yet. Add your first shape above.</p>
                ) : (
                  editorLayout.obstacles.map((obstacle, index) => (
                    <button
                      key={obstacle.id}
                      type="button"
                      className={`trackLabPieceButton ${
                        obstacle.id === editorSelectedObstacleId ? "selected" : ""
                      }`}
                      onClick={() => {
                        setEditorSelectedObstacleId(obstacle.id);
                        setEditorReferenceMarbleSelected(false);
                      }}
                    >
                      {index + 1}. {obstacle.name} · {obstacle.shape}
                    </button>
                  ))
                )}
              </div>
              <div className="optionsInlineButtons editorActionButtons">
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton"
                  onClick={exportEditorLayout}
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton"
                  onClick={importEditorLayout}
                >
                  Import JSON
                </button>
                <button
                  type="button"
                  className="menuActionButton optionsMenuButton"
                  onClick={clearEditorShapes}
                >
                  Clear Shapes
                </button>
              </div>
              <label className="optionsField" htmlFor="editorLayoutJson">
                <span className="optionsFieldLabel">Layout JSON</span>
                <textarea
                  id="editorLayoutJson"
                  className="optionsTextInput editorJsonTextArea"
                  value={editorImportText}
                  onChange={(event) => setEditorImportText(event.target.value)}
                  placeholder='{"version":1,"template":"straight","trackWidth":9,"obstacles":[]}'
                />
              </label>
              {editorImportError ? <p className="raceHint">{editorImportError}</p> : null}
              {editorStatus ? <p className="raceHint">{editorStatus}</p> : null}
            </div>
          </div>
          {editorAddShapeOpen ? (
            <div className="editorModalScrim" onClick={() => setEditorAddShapeOpen(false)}>
              <div
                className="editorModalCard"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <p className="raceOverlayTitle editorModalTitle">Add New Shape</p>
                <div className="editorInspectorGrid">
                  <label className="optionsField" htmlFor="editorDraftName">
                    <span className="optionsFieldLabel">Name</span>
                    <input
                      id="editorDraftName"
                      className="optionsTextInput"
                      value={editorShapeDraft.name}
                      onChange={(event) => updateEditorShapeDraft("name", event.target.value)}
                      maxLength={48}
                    />
                  </label>
                  <label className="optionsField" htmlFor="editorDraftShape">
                    <span className="optionsFieldLabel">Shape</span>
                    <select
                      id="editorDraftShape"
                      className="menuSelect"
                      value={editorShapeDraft.shape}
                      onChange={(event) =>
                        updateEditorShapeDraft("shape", event.target.value as EditorShapeKind)
                      }
                    >
                      <option value="rectangle">Rectangle</option>
                      <option value="triangle">Triangle</option>
                      <option value="circle">Circle</option>
                    </select>
                  </label>
                  <label className="optionsField" htmlFor="editorDraftX">
                    <span className="optionsFieldLabel">X</span>
                    <input
                      id="editorDraftX"
                      className="optionsTextInput"
                      type="number"
                      step={0.1}
                      value={editorShapeDraft.x.toFixed(2)}
                      onChange={(event) => updateEditorShapeDraft("x", Number(event.target.value))}
                    />
                  </label>
                  <label className="optionsField" htmlFor="editorDraftZ">
                    <span className="optionsFieldLabel">Z</span>
                    <input
                      id="editorDraftZ"
                      className="optionsTextInput"
                      type="number"
                      step={0.1}
                      min={0}
                      max={editorTemplateLength}
                      value={editorShapeDraft.z.toFixed(2)}
                      onChange={(event) => updateEditorShapeDraft("z", Number(event.target.value))}
                    />
                  </label>
                  <label className="optionsField" htmlFor="editorDraftWidth">
                    <span className="optionsFieldLabel">Width</span>
                    <input
                      id="editorDraftWidth"
                      className="optionsTextInput"
                      type="number"
                      step={0.1}
                      min={0.35}
                      max={9}
                      value={editorShapeDraft.width.toFixed(2)}
                      onChange={(event) =>
                        updateEditorShapeDraft("width", Number(event.target.value))
                      }
                    />
                  </label>
                  <label className="optionsField" htmlFor="editorDraftLength">
                    <span className="optionsFieldLabel">Length</span>
                    <input
                      id="editorDraftLength"
                      className="optionsTextInput"
                      type="number"
                      step={0.1}
                      min={0.35}
                      max={14}
                      value={editorShapeDraft.length.toFixed(2)}
                      onChange={(event) =>
                        updateEditorShapeDraft("length", Number(event.target.value))
                      }
                    />
                  </label>
                  <label className="optionsField" htmlFor="editorDraftDepth">
                    <span className="optionsFieldLabel">Depth</span>
                    <input
                      id="editorDraftDepth"
                      className="optionsTextInput"
                      type="number"
                      step={0.1}
                      min={0.2}
                      max={8}
                      value={editorShapeDraft.depth.toFixed(2)}
                      onChange={(event) =>
                        updateEditorShapeDraft("depth", Number(event.target.value))
                      }
                    />
                  </label>
                  <label className="optionsField" htmlFor="editorDraftYaw">
                    <span className="optionsFieldLabel">Yaw</span>
                    <input
                      id="editorDraftYaw"
                      className="optionsTextInput"
                      type="number"
                      step={1}
                      min={-180}
                      max={180}
                      value={editorShapeDraft.yawDeg.toFixed(0)}
                      onChange={(event) =>
                        updateEditorShapeDraft("yawDeg", Number(event.target.value))
                      }
                    />
                  </label>
                </div>
                <div className="optionsInlineButtons editorModalActions">
                  <button
                    type="button"
                    className="menuActionButton optionsMenuButton"
                    onClick={createEditorShape}
                  >
                    Create Shape
                  </button>
                  <button
                    type="button"
                    className="menuActionButton optionsMenuButton"
                    onClick={() => setEditorAddShapeOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {showSoloCountdownBrief ? (
        <div className="soloCountdownBrief" data-testid="solo-countdown-brief">
          <p className="soloCountdownEyebrow">Solo Demo</p>
          <p className="soloCountdownTitle">{soloCourse.courseName}</p>
          <p className="soloCountdownText">{soloCourse.courseTagline}</p>
        </div>
      ) : null}
      {showSoloHud ? (
        <div className="soloHudCard" data-testid="solo-course-hud">
          <div className="soloHudStats">
            <p>
              <span>Time</span>
              <strong>{formatTimeMs(trialCurrentMs)}</strong>
            </p>
            <p>
              <span>Best</span>
              <strong>{formatTimeMs(trialBestMs)}</strong>
            </p>
          </div>
          <p className="soloHudMeta">
            Seed {isMobile ? compactSoloSeed : trackLabSeed}
          </p>
        </div>
      ) : null}
      {showRaceLobby ? (
        <div
          className="raceOverlay menuOverlay multiplayerLobbyOverlay"
          data-testid="multiplayer-lobby-overlay"
        >
          <div className="raceOverlayCard multiplayerLobbyCard" data-testid="multiplayer-lobby-card">
            <button type="button" className="lobbyBackButton" onClick={returnToMainMenu}>
              {"< Back"}
            </button>
            <p className="raceOverlayTitle">Multiplayer Lobby {roomCode ? `• ${roomCode}` : ""}</p>
            <div className="lobbyQrWrap">
              {qrImageUrl ? (
                <img
                  className="lobbyQrImage"
                  src={qrImageUrl}
                  alt="Join room QR code"
                  data-testid="multiplayer-lobby-qr"
                />
              ) : (
                <p className="raceHint">
                  {creatingLobby ? "Creating lobby..." : "QR available after room creation."}
                </p>
              )}
            </div>
            {joinHostWarning ? <p className="raceHint">{joinHostWarning}</p> : null}
            <div className="lobbySlotsGrid">
              {lobbySlots.map((slot) => (
                <div key={slot.slotId} className="lobbySlotCard">
                  <p className="lobbySlotName">
                    {slot.name}
                    {slot.isHost ? <span className="hostMarker">★</span> : null}
                  </p>
                  <div className={`lobbySlotIndicator ${slot.readyClass}`}>{slot.icon}</div>
                </div>
              ))}
            </div>
            <div className="lobbyActionsRow">
              <button
                type="button"
                className={`readyButton lobbyActionButton ${localReady ? "ready" : ""}`}
                data-testid="lobby-ready-button"
                onClick={() => void toggleReady()}
                disabled={!canToggleLobbyReady}
              >
                {localReady ? "UNREADY" : "READY"}
              </button>
              <button
                type="button"
                className="readyButton lobbyActionButton startMatchButton"
                data-testid="lobby-start-match-button"
                onClick={startMatch}
                disabled={!canStartMatch}
              >
                START MATCH
              </button>
            </div>
            <button
              type="button"
              className="menuActionButton lobbyReturnMainMenuButton"
              onClick={returnToMainMenu}
            >
              Return to Main Menu
            </button>
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
            {waitingForPlayers ? <p className="raceHint">Waiting for at least one more player.</p> : null}
            {!isLocalPlayerHost && playersInRoom.length >= 2 ? (
              <p className="raceHint">Host starts the match once everyone is ready.</p>
            ) : null}
            {isLocalPlayerHost && playersInRoom.length >= 2 && !allPlayersReady ? (
              <p className="raceHint">All joined players must be READY before start.</p>
            ) : null}
            {!gyroEnabled ? (
              <p className="raceHint">Gyro is disabled in Options. Fallback controls are active.</p>
            ) : null}
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
                ? "All joined players press READY for rematch."
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
            <button
              type="button"
              className="menuActionButton raceResultReturnMainMenuButton"
              onClick={returnToMainMenu}
            >
              Return to Main Menu
            </button>
          </div>
        </div>
      ) : null}
      {showSoloResult ? (
        <div className="raceOverlay">
          <div className="raceOverlayCard raceResultCard">
            <p className="raceOverlayTitle">Race Results</p>
            <p className="raceResultHeadline">Obstacle Run Cleared</p>
            <p>{soloCourse.courseName}</p>
            <p>{soloCourse.courseTagline}</p>
            <p>Seed: {trackLabSeed}</p>
            <p>Time: {formatTimeMs(trialLastMs)}</p>
            <p>Personal Best: {formatTimeMs(trialBestMs)}</p>
            <p>Respawns: {respawnCount}</p>
            <button type="button" className="readyButton ready" onClick={restartSoloRace}>
              RESTART SAME SEED
            </button>
            <button type="button" className="menuActionButton" onClick={remixSoloRace}>
              SHUFFLE TRACK
            </button>
            <button
              type="button"
              className="menuActionButton raceResultReturnMainMenuButton"
              onClick={returnToMainMenu}
            >
              Return to Main Menu
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
      {showMobileInRaceCameraControls ? (
        <>
          <div className="inRaceCameraControls" aria-hidden={false}>
            <div className="inRaceCameraSlider inRaceCameraSliderLeft">
              <p>Zoom</p>
              <input
                type="range"
                min={0.5}
                max={1.4}
                step={0.01}
                value={tuning.cameraZoom}
                onChange={(event) => updateTuning("cameraZoom", Number(event.target.value))}
                aria-label="Camera zoom"
              />
            </div>
            <div className="inRaceCameraSlider inRaceCameraSliderRight">
              <p>Height</p>
              <input
                type="range"
                min={-6}
                max={8}
                step={0.1}
                value={tuning.cameraHeightBias}
                onChange={(event) => updateTuning("cameraHeightBias", Number(event.target.value))}
                aria-label="Camera height and angle"
              />
            </div>
          </div>
        </>
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
      {(showMultiplayerNetworkUi ||
        gameMode === "solo" ||
        gameMode === "testAll") &&
      debugMenuEnabled ? (
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
            <DebugScalarControl
              label="Max Speed"
              min={MAX_SPEED_SLIDER_MIN}
              max={MAX_SPEED_SLIDER_MAX}
              step={0.1}
              value={tuning.maxSpeed}
              onChange={(value) => updateTuning("maxSpeed", value)}
              allowNumericInput
              clampMax={MAX_SPEED_TUNING_MAX}
            />
            <DebugScalarControl
              label="Tilt Strength"
              min={0.5}
              max={2}
              step={0.01}
              value={tuning.tiltStrength}
              onChange={(value) => updateTuning("tiltStrength", value)}
            />
            <DebugScalarControl
              label="Gyro Gain (Debug)"
              min={0.8}
              max={1.2}
              step={0.01}
              value={tuning.gyroSensitivity}
              onChange={(value) => updateTuning("gyroSensitivity", value)}
            />
            <DebugScalarControl
              label="Gravity G"
              min={8}
              max={24}
              step={0.1}
              value={tuning.gravityG}
              onChange={(value) => updateTuning("gravityG", value)}
            />
            <DebugScalarControl
              label="Max Tilt Deg"
              min={6}
              max={25}
              step={0.1}
              value={tuning.maxTiltDeg}
              onChange={(value) => updateTuning("maxTiltDeg", value)}
            />
            <DebugScalarControl
              label="Object Transparency (%)"
              min={0}
              max={85}
              step={1}
              value={tuning.objectTransparencyPercent}
              onChange={(value) => updateTuning("objectTransparencyPercent", value)}
            />
            <label className="controlLabel controlLabelCheckbox">
              <input
                type="checkbox"
                checked={tuning.showObjectWireframes}
                onChange={(event) => updateTuning("showObjectWireframes", event.target.checked)}
              />
              Show Wireframes
            </label>
            <label className="controlLabel controlLabelCheckbox">
              <input
                type="checkbox"
                checked={tuning.wireframeUsesObjectTransparency}
                onChange={(event) =>
                  updateTuning("wireframeUsesObjectTransparency", event.target.checked)
                }
              />
              Wireframes Match Transparency
            </label>
            <DebugScalarControl
              label="Max Board Angular Velocity"
              min={1}
              max={10}
              step={0.1}
              value={tuning.maxBoardAngVel}
              onChange={(value) => updateTuning("maxBoardAngVel", value)}
            />
            <DebugScalarControl
              label="Contact Friction"
              min={0}
              max={1.1}
              step={0.01}
              value={tuning.contactFriction}
              onChange={(value) => updateTuning("contactFriction", value)}
            />
            <DebugScalarControl
              label="Bounce"
              min={0}
              max={0.99}
              step={0.01}
              value={tuning.bounce}
              onChange={(value) => updateTuning("bounce", value)}
            />
            <DebugScalarControl
              label="Tilt Filter Tau"
              min={0.05}
              max={0.25}
              step={0.01}
              value={tuning.tiltFilterTau}
              onChange={(value) => updateTuning("tiltFilterTau", value)}
            />
            <DebugScalarControl
              label="Mobile Render Scale"
              min={0.75}
              max={2}
              step={0.01}
              value={tuning.renderScaleMobile}
              onChange={(value) => updateTuning("renderScaleMobile", value)}
            />
            <label className="controlLabel controlLabelCheckbox">
              <input
                type="checkbox"
                checked={tuning.mobileSafeFallback}
                onChange={(event) =>
                  updateTuning("mobileSafeFallback", event.target.checked)
                }
              />
              Mobile Safe Fallback (dynamic governor)
            </label>
            <label className="controlLabel">
              Dynamic Shadow Map Size
              <div className="controlRow">
                <select
                  value={tuning.shadowMapSize}
                  onChange={(event) =>
                    updateTuning(
                      "shadowMapSize",
                      event.target.value === "512" ? 512 : 1024,
                    )
                  }
                >
                  <option value={512}>512</option>
                  <option value={1024}>1024</option>
                </select>
              </div>
            </label>
            <DebugScalarControl
              label="Light Offset X"
              min={SHADOW_LIGHT_OFFSET_X_MIN}
              max={SHADOW_LIGHT_OFFSET_X_MAX}
              step={0.5}
              value={tuning.shadowLightOffsetX}
              onChange={(value) => updateTuning("shadowLightOffsetX", value)}
            />
            <DebugScalarControl
              label="Light Offset Y"
              min={SHADOW_LIGHT_OFFSET_Y_MIN}
              max={SHADOW_LIGHT_OFFSET_Y_MAX}
              step={0.5}
              value={tuning.shadowLightOffsetY}
              onChange={(value) => updateTuning("shadowLightOffsetY", value)}
            />
            <DebugScalarControl
              label="Light Offset Z"
              min={SHADOW_LIGHT_OFFSET_Z_MIN}
              max={SHADOW_LIGHT_OFFSET_Z_MAX}
              step={0.5}
              value={tuning.shadowLightOffsetZ}
              onChange={(value) => updateTuning("shadowLightOffsetZ", value)}
            />
            <label className="controlLabel controlLabelCheckbox">
              <input
                type="checkbox"
                checked={tuning.localMarbleRenderInterpolation}
                onChange={(event) =>
                  updateTuning("localMarbleRenderInterpolation", event.target.checked)
                }
              />
              Marble Render Interpolation
            </label>
            <label className="controlLabel controlLabelCheckbox">
              <input
                type="checkbox"
                checked={tuning.localTrackRenderInterpolation}
                onChange={(event) =>
                  updateTuning("localTrackRenderInterpolation", event.target.checked)
                }
              />
              Track Render Interpolation
            </label>
            <DebugScalarControl
              label="Mobile Debug Hz"
              min={2}
              max={15}
              step={1}
              value={tuning.debugUpdateHzMobile}
              onChange={(value) => updateTuning("debugUpdateHzMobile", value)}
              formatValue={(value) => value.toFixed(0)}
            />
            <DebugScalarControl
              label="Linear Damping"
              min={0}
              max={0.5}
              step={0.01}
              value={tuning.linearDamping}
              onChange={(value) => updateTuning("linearDamping", value)}
            />
            <DebugScalarControl
              label="Angular Damping"
              min={0}
              max={0.5}
              step={0.01}
              value={tuning.angularDamping}
              onChange={(value) => updateTuning("angularDamping", value)}
            />
            <DebugScalarControl
              label="Physics Max Substeps"
              min={1}
              max={6}
              step={1}
              value={tuning.physicsMaxSubSteps}
              onChange={(value) => updateTuning("physicsMaxSubSteps", value)}
              formatValue={(value) => value.toFixed(0)}
            />
            <DebugScalarControl
              label="Solver Iterations"
              min={8}
              max={24}
              step={1}
              value={tuning.physicsSolverIterations}
              onChange={(value) => updateTuning("physicsSolverIterations", value)}
              formatValue={(value) => value.toFixed(0)}
            />
            <DebugScalarControl
              label="CCD Speed Threshold"
              min={0.05}
              max={4}
              step={0.01}
              value={tuning.ccdSpeedThreshold}
              onChange={(value) => updateTuning("ccdSpeedThreshold", value)}
            />
            <DebugScalarControl
              label="CCD Iterations"
              min={1}
              max={40}
              step={1}
              value={tuning.ccdIterations}
              onChange={(value) => updateTuning("ccdIterations", value)}
              formatValue={(value) => value.toFixed(0)}
            />
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
            <DebugScalarControl
              label="Extra Downforce"
              min={0}
              max={12}
              step={0.1}
              value={tuning.extraDownForce}
              onChange={(value) => updateTuning("extraDownForce", value)}
            />
            <div className="debugButtonRow">
              <button type="button" onClick={() => setTuning(buildCanonicalTuning())}>
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
            <p className="tiltStatus">Camera Preset: Broadcast</p>
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
            <p>Cadence Hz: {debug.cadenceHz}</p>
            <p>Render Scale: {debug.renderScale.toFixed(2)}</p>
            <p>Perf Tier: {debug.perfTier}</p>
            <p>CPU frame ms (EMA): {debug.cpuFrameMsEma.toFixed(2)}</p>
            <p>Physics ms (EMA): {debug.physicsMsEma.toFixed(2)}</p>
            <p>Render ms (EMA): {debug.renderMsEma.toFixed(2)}</p>
            <p>Misc ms (EMA): {debug.miscMsEma.toFixed(2)}</p>
            <p>rAF gap p95 ms: {debug.rafGapP95Ms.toFixed(2)}</p>
            <p>rAF gap p99 ms: {debug.rafGapP99Ms.toFixed(2)}</p>
            <p>rAF gaps {'>'}16.7ms (window): {debug.rafGapsOver16Ms}</p>
            <p>rAF gaps {'>'}20ms (window): {debug.rafGapsOver20Ms}</p>
            <p>rAF gaps {'>'}25ms (window): {debug.rafGapsOver25Ms}</p>
            <p>Sim steps/frame (EMA): {debug.simStepsPerFrameEma.toFixed(2)}</p>
            <p>Sim steps/frame (max recent): {debug.simStepsMaxRecent}</p>
            <p>Marble-board contacts: {debug.marbleBoardContactCount}</p>
            <p>Collider pieces: {debug.colliderPieceCount}</p>
            <p>Primitive shapes: {debug.primitiveShapeCount}</p>
            <p>Exotic Trimesh pieces: {debug.exoticTrimeshPieceCount}</p>
            <p>Floor shapes: {debug.floorShapeCount}</p>
            <p>Wall shapes: {debug.wallShapeCount}</p>
            <p>
              Est board-wall shape tests/step: {debug.estimatedBoardWallShapeTestsPerStep}
            </p>
            <p>Board-wall collision filtered: {debug.boardWallCollisionFiltered ? "yes" : "no"}</p>
            <p>Shadow map size: {debug.shadowMapSize}</p>
            <p>Rail clamp corrections/sec: {debug.railClampCorrectionsPerSec.toFixed(2)}</p>
            <p>
              Marble: {debug.posX.toFixed(2)}, {debug.posY.toFixed(2)}, {debug.posZ.toFixed(2)}
            </p>
            <p>Speed: {debug.speed.toFixed(2)}</p>
            <p>Angular speed: {debug.angularSpeed.toFixed(2)}</p>
            <p>Vertical speed: {debug.verticalSpeed.toFixed(2)}</p>
            <p>Penetration depth: {debug.penetrationDepth.toFixed(3)}</p>
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
