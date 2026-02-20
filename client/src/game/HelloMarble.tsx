import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent } from "react";
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
  CameraPresetId,
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
  TOPDOWN_HEIGHT,
  TOPDOWN_Z_OFFSET,
  BOARD_TILT_SMOOTH,
  PIVOT_SMOOTH,
  TRACK_FLOOR_TOP_Y,
  PENETRATION_EPSILON,
  PENETRATION_CORRECTION_BIAS,
  PENETRATION_CORRECTION_MAX,
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
  CAMERA_PRESETS,
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
  getCameraLabel,
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
  type TrackPieceKind,
  type TrackPieceTemplate,
} from "./track/modularTrack";

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
type MenuScreen = "main" | "options" | "trackLab";
type OptionsSubmenu = "root" | "controls" | "camera";
type TrackCatalogMode = "builtin" | "builtin_plus_custom";

type RuntimeTrackConfig = {
  seed: string;
  pieceCount: number;
  catalogMode: TrackCatalogMode;
  customPieces: TrackPieceTemplate[];
};

type TrackPieceDraft = Omit<TrackPieceTemplate, "id">;

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
  const pieceCount = sanitizeTrackPieceCount(config.pieceCount);
  const blueprint = buildTrackBlueprint({
    config: { seed, pieceCount },
    customPieces: sanitizeTrackPieceLibrary(config.customPieces),
    includeCustomPieces: config.catalogMode === "builtin_plus_custom",
    trackWidth: 9,
    enableBranchPieces: false,
  });
  return {
    seed,
    blueprint,
  };
}

function buildTrackConfig(
  seed: string,
  pieceCount: number,
  catalogMode: TrackCatalogMode,
  customPieces: TrackPieceTemplate[],
): RuntimeTrackConfig {
  return {
    seed: sanitizeTrackSeed(seed),
    pieceCount: sanitizeTrackPieceCount(pieceCount),
    catalogMode,
    customPieces: sanitizeTrackPieceLibrary(customPieces),
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
  const debug = useDebugStore();
  const netSmoothing = useNetStore();
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
    if (typeof window === "undefined") return "";
    return sanitizePlayerName(window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "");
  });
  const [selectedMarbleSkinId, setSelectedMarbleSkinId] = useState(() => {
    if (typeof window === "undefined") return defaultSkinId;
    const stored = window.localStorage.getItem(MARBLE_SKIN_STORAGE_KEY);
    return resolveSkinById(stored).id;
  });
  const [gyroEnabled, setGyroEnabled] = useState(() =>
    readStoredToggle(GYRO_ENABLED_STORAGE_KEY, true),
  );
  const [musicEnabled, setMusicEnabled] = useState(() =>
    readStoredToggle(MUSIC_ENABLED_STORAGE_KEY, true),
  );
  const [soundEnabled, setSoundEnabled] = useState(() =>
    readStoredToggle(SOUND_ENABLED_STORAGE_KEY, true),
  );
  const [debugMenuEnabled, setDebugMenuEnabled] = useState(() =>
    readStoredToggle(DEBUG_MENU_ENABLED_STORAGE_KEY, false),
  );
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
  const multiplayerTrackSeedRef = useRef(multiplayerTrackSeed);

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
    if (!isMobile || typeof window === "undefined") {
      return;
    }
    let lockAttempted = false;
    const tryLockPortraitOrientation = async () => {
      if (lockAttempted) {
        return;
      }
      lockAttempted = true;
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
        return;
      }
      try {
        await orientationApi.lock("portrait-primary");
      } catch {
        // Browsers can reject lock requests unless in fullscreen/PWA/user gesture.
      }
    };
    void tryLockPortraitOrientation();
    const onGesture = () => {
      void tryLockPortraitOrientation();
    };
    window.addEventListener("pointerdown", onGesture, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture);
    };
  }, [isMobile]);

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
    multiplayerTrackSeedRef.current = sanitizeTrackSeed(multiplayerTrackSeed);
  }, [multiplayerTrackSeed]);

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
    mount.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(6, 8, 5);
    scene.add(directionalLight);

    const initialTrackConfig = buildTrackConfig(
      trackLabSeedRef.current,
      trackLabPieceCountRef.current,
      "builtin_plus_custom",
      trackLabCustomPiecesRef.current,
    );
    let track = createTrack(createTrackOptionsFromConfig(initialTrackConfig));
    scene.add(track.group);

    let boardBody = track.bodies[0];
    if (!boardBody) {
      throw new Error("Track did not provide board physics body");
    }

    const world = new CANNON.World();
    const solver = world.solver as unknown as {
      iterations: number;
      tolerance: number;
    };
    solver.iterations = tuningRef.current.physicsSolverIterations;
    solver.tolerance = 1e-4;
    world.gravity.set(0, -tuningRef.current.gravityG, 0);
    world.addBody(boardBody);

    const boardMat = new CANNON.Material("board");
    const movingObstacleMat = new CANNON.Material("moving-obstacle");
    const marbleMat = new CANNON.Material("marble");
    boardBody.material = boardMat;
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
    const movingObstacleContactMat = new CANNON.ContactMaterial(marbleMat, movingObstacleMat, {
      friction: MOVING_OBSTACLE_CONTACT_FRICTION,
      restitution: tuningRef.current.contactRestitution,
      contactEquationStiffness: 5e7,
      contactEquationRelaxation: 6,
      frictionEquationStiffness: 5e7,
      frictionEquationRelaxation: 5,
    });
    world.addContactMaterial(movingObstacleContactMat);
    for (const body of track.bodies.slice(1)) {
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
    scene.add(marbleMesh);
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
    const boardPrevPos = new CANNON.Vec3(0, 0, 0);
    boardPrevPos.copy(boardBody.position);
    const boardPrevQuat = new THREE.Quaternion(
      boardBody.quaternion.x,
      boardBody.quaternion.y,
      boardBody.quaternion.z,
      boardBody.quaternion.w,
    );
    const boardNextQuat = new THREE.Quaternion();
    const boardPrevQuatInv = new THREE.Quaternion();
    const boardDeltaQuat = new THREE.Quaternion();
    const boardAngularAxis = new THREE.Vector3();
    const boardUpWorld = new THREE.Vector3();
    const boardRightWorld = new THREE.Vector3();
    const boardForwardWorld = new THREE.Vector3();
    const contactNormalWorld = new THREE.Vector3();
    const obstacleLocalPos = new THREE.Vector3();
    const targetLocalPos = new THREE.Vector3();
    const targetWorldPos = new THREE.Vector3();
    const ghostTrackUp = new THREE.Vector3();
    const ghostTravelDelta = new THREE.Vector3();
    const ghostSpinAxis = new THREE.Vector3();
    const ghostSpinStepQuat = new THREE.Quaternion();
    let movingObstacleBodySet = new Set(track.movingObstacleBodies);

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
    let inputRawIntentX = 0;
    let inputRawIntentZ = 0;
    let latestAngularSpeed = 0;
    let latestVerticalSpeed = 0;
    let latestPenetrationDepth = 0;
    let offCourseSinceMs: number | null = null;
    let squeezeBlockedFrames = 0;
    let accumulator = 0;
    let disposed = false;

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
          (contact.bi === marbleBody && contact.bj === boardBody) ||
          (contact.bi === boardBody && contact.bj === marbleBody);
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
      boardPosThree.set(boardBody.position.x, boardBody.position.y, boardBody.position.z);
      boardQuatThree.set(
        boardBody.quaternion.x,
        boardBody.quaternion.y,
        boardBody.quaternion.z,
        boardBody.quaternion.w,
      ).normalize();
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
      marbleBody.position.copy(computeSpawnWorld());
      marbleBody.quaternion.set(0, 0, 0, 1);
      marbleBody.velocity.set(0, 0, 0);
      marbleBody.angularVelocity.set(0, 0, 0);
      trialStartAt = null;
      prevMarbleZ = marbleBody.position.z;
      offCourseSinceMs = null;
      squeezeBlockedFrames = 0;
      syncLocalRenderSnapshotsFromBodies();
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

    const rebuildTrack = (nextConfig: RuntimeTrackConfig): void => {
      const nextTrack = createTrack(createTrackOptionsFromConfig(nextConfig));
      const nextBoardBody = nextTrack.bodies[0];
      if (!nextBoardBody) {
        return;
      }

      for (const body of track.bodies) {
        world.removeBody(body);
      }
      scene.remove(track.group);
      disposeTrack(track);

      track = nextTrack;
      boardBody = nextBoardBody;
      boardBody.material = boardMat;
      track.setMovingObstacleMaterial(movingObstacleMat);
      for (const body of track.bodies) {
        world.addBody(body);
      }
      movingObstacleBodySet = new Set(track.movingObstacleBodies);
      scene.add(track.group);

      boardPrevPos.copy(boardBody.position);
      boardPrevQuat.set(
        boardBody.quaternion.x,
        boardBody.quaternion.y,
        boardBody.quaternion.z,
        boardBody.quaternion.w,
      );
      currentPitch = 0;
      currentRoll = 0;
      respawnMarble(false);
      if (gameModeRef.current !== "solo") {
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
      useLegacyDeltaGuard: boolean,
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

      rawPivot.set(marbleBody.position.x, 0, marbleBody.position.z);
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

      if (useLegacyDeltaGuard) {
        if (controllerDt > 0.00001) {
          const invDelta = 1 / controllerDt;
          boardBody.velocity.set(
            (boardPosition.x - boardPrevPos.x) * invDelta,
            (boardPosition.y - boardPrevPos.y) * invDelta,
            (boardPosition.z - boardPrevPos.z) * invDelta,
          );

          boardNextQuat.set(
            qFinalCannon.x,
            qFinalCannon.y,
            qFinalCannon.z,
            qFinalCannon.w,
          );
          boardPrevQuatInv.copy(boardPrevQuat).invert();
          boardDeltaQuat.copy(boardNextQuat).multiply(boardPrevQuatInv).normalize();
          const w = clamp(boardDeltaQuat.w, -1, 1);
          let angle = 2 * Math.acos(w);
          if (angle > Math.PI) {
            angle -= 2 * Math.PI;
          }
          const sinHalf = Math.sqrt(Math.max(1 - w * w, 0));
          if (sinHalf > 0.00001 && Math.abs(angle) > 0.00001) {
            boardAngularAxis.set(
              boardDeltaQuat.x / sinHalf,
              boardDeltaQuat.y / sinHalf,
              boardDeltaQuat.z / sinHalf,
            );
            const angularSpeed = angle * invDelta;
            boardBody.angularVelocity.set(
              boardAngularAxis.x * angularSpeed,
              boardAngularAxis.y * angularSpeed,
              boardAngularAxis.z * angularSpeed,
            );
          } else {
            boardBody.angularVelocity.set(0, 0, 0);
          }
        } else {
          boardBody.velocity.set(0, 0, 0);
          boardBody.angularVelocity.set(0, 0, 0);
          boardNextQuat.set(
            qFinalCannon.x,
            qFinalCannon.y,
            qFinalCannon.z,
            qFinalCannon.w,
          );
        }
      } else {
        const invDelta = 1 / controllerDt;
        boardBody.velocity.set(
          (boardPosition.x - boardPrevPos.x) * invDelta,
          (boardPosition.y - boardPrevPos.y) * invDelta,
          (boardPosition.z - boardPrevPos.z) * invDelta,
        );

        boardNextQuat.set(
          qFinalCannon.x,
          qFinalCannon.y,
          qFinalCannon.z,
          qFinalCannon.w,
        );
        boardPrevQuatInv.copy(boardPrevQuat).invert();
        boardDeltaQuat.copy(boardNextQuat).multiply(boardPrevQuatInv).normalize();
        const w = clamp(boardDeltaQuat.w, -1, 1);
        let angle = 2 * Math.acos(w);
        if (angle > Math.PI) {
          angle -= 2 * Math.PI;
        }
        const sinHalf = Math.sqrt(Math.max(1 - w * w, 0));
        if (sinHalf > 0.00001 && Math.abs(angle) > 0.00001) {
          boardAngularAxis.set(
            boardDeltaQuat.x / sinHalf,
            boardDeltaQuat.y / sinHalf,
            boardDeltaQuat.z / sinHalf,
          );
          const angularSpeed = angle * invDelta;
          boardBody.angularVelocity.set(
            boardAngularAxis.x * angularSpeed,
            boardAngularAxis.y * angularSpeed,
            boardAngularAxis.z * angularSpeed,
          );
        } else {
          boardBody.angularVelocity.set(0, 0, 0);
        }
      }

      boardBody.quaternion.copy(qFinalCannon);
      boardBody.position.copy(boardPosition);
      boardBody.aabbNeedsUpdate = true;
      boardBody.updateAABB();
      if (useLegacyDeltaGuard) {
        track.group.position.set(boardPosition.x, boardPosition.y, boardPosition.z);
      }
      boardPrevPos.copy(boardPosition);
      boardPrevQuat.copy(boardNextQuat);
    };

    const updateTrackControllerLegacy = (
      delta: number,
      currentTuning: TuningState,
    ): void => {
      updateTrackController(currentTuning, delta, true);
      localRenderPrevBoardPos.copy(localRenderCurrBoardPos);
      localRenderPrevBoardQuat.copy(localRenderCurrBoardQuat);
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
    };

    const updateTrackControllerFixed = (
      fixedDt: number,
      currentTuning: TuningState,
    ): void => {
      updateTrackController(currentTuning, fixedDt, false);
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
      if (!currentTuning.legacyTrackController) {
        updateTrackControllerFixed(fixedDt, currentTuning);
      }
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
      const expectedMarbleCenterYOnFloor = marbleRadius + TRACK_FLOOR_TOP_Y;
      const computePenetrationDepth = (): number =>
        Math.max(0, expectedMarbleCenterYOnFloor - marblePosLocalToBoard.y);
      let penetrationDepth = 0;
      if (!isOffCourseByBounds) {
        penetrationDepth = computePenetrationDepth();
        if (penetrationDepth > PENETRATION_EPSILON) {
          tempQuatA.set(
            boardBody.quaternion.x,
            boardBody.quaternion.y,
            boardBody.quaternion.z,
            boardBody.quaternion.w,
          );
          boardUpWorld.set(0, 1, 0).applyQuaternion(tempQuatA).normalize();
          const correction = Math.min(
            penetrationDepth + PENETRATION_CORRECTION_BIAS,
            PENETRATION_CORRECTION_MAX,
          );
          marbleBody.position.x += boardUpWorld.x * correction;
          marbleBody.position.y += boardUpWorld.y * correction;
          marbleBody.position.z += boardUpWorld.z * correction;

          const inwardSpeed =
            marbleBody.velocity.x * boardUpWorld.x +
            marbleBody.velocity.y * boardUpWorld.y +
            marbleBody.velocity.z * boardUpWorld.z;
          if (inwardSpeed < 0) {
            marbleBody.velocity.x -= boardUpWorld.x * inwardSpeed;
            marbleBody.velocity.y -= boardUpWorld.y * inwardSpeed;
            marbleBody.velocity.z -= boardUpWorld.z * inwardSpeed;
          }

          marbleBody.aabbNeedsUpdate = true;
          marbleBody.updateAABB();
          updateMarblePosLocalToBoard();
          penetrationDepth = computePenetrationDepth();
        }
        isOffCourseByBounds =
          marblePosLocalToBoard.x < outBounds.minX ||
          marblePosLocalToBoard.x > outBounds.maxX ||
          marblePosLocalToBoard.z < outBounds.minZ ||
          marblePosLocalToBoard.z > outBounds.maxZ;
      }
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

      const useLegacyTrackController = currentTuning.legacyTrackController;
      if (useLegacyTrackController) {
        updateTrackControllerLegacy(delta, currentTuning);
      }

      accumulator += delta;
      const maxCatchupSteps = Math.max(1, Math.round(currentTuning.physicsMaxSubSteps));
      let physicsMs = 0;
      let simulatedSteps = 0;
      while (accumulator >= TIMESTEP && simulatedSteps < maxCatchupSteps) {
        if (!useLegacyTrackController) {
          localRenderPrevBoardPos.copy(localRenderCurrBoardPos);
          localRenderPrevBoardQuat.copy(localRenderCurrBoardQuat);
        }
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
      const sideSign = currentTuning.invertCameraSide ? -1 : 1;
      const zoomDistanceScale = 1 / clamp(currentTuning.cameraZoom, 0.7, 1.4);
      const heightBias = currentTuning.cameraHeightBias;
      const pitchLookAheadBias = clamp(-heightBias * 0.6, -5, 5);
      const nextFov = clamp(currentTuning.cameraFov, 50, 90);
      if (Math.abs(camera.fov - nextFov) > 0.01) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
      switch (currentTuning.cameraPreset) {
        case "chaseCentered": {
          cameraTarget.set(0, 7.5 + heightBias, marbleMesh.position.z - 10 * zoomDistanceScale);
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.x = 0;
          camera.position.y = 7.5 + heightBias;
          lookTarget.set(0, LOOK_HEIGHT + heightBias * 0.15, marbleMesh.position.z + LOOK_AHEAD + pitchLookAheadBias);
          break;
        }
        case "chaseRight": {
          const side = 4 * sideSign;
          cameraTarget.set(side * zoomDistanceScale, 7.5 + heightBias, marbleMesh.position.z - 10 * zoomDistanceScale);
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 7.5 + heightBias;
          lookTarget.set(side * zoomDistanceScale, LOOK_HEIGHT + heightBias * 0.15, marbleMesh.position.z + LOOK_AHEAD + pitchLookAheadBias);
          break;
        }
        case "chaseLeft": {
          const side = -4 * sideSign;
          cameraTarget.set(side * zoomDistanceScale, 7.5 + heightBias, marbleMesh.position.z - 10 * zoomDistanceScale);
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 7.5 + heightBias;
          lookTarget.set(side * zoomDistanceScale, LOOK_HEIGHT + heightBias * 0.15, marbleMesh.position.z + LOOK_AHEAD + pitchLookAheadBias);
          break;
        }
        case "isoStandard": {
          cameraTarget.set(
            marbleMesh.position.x + 4 * sideSign * zoomDistanceScale,
            14 + heightBias,
            marbleMesh.position.z - 8 * zoomDistanceScale,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 14 + heightBias;
          lookTarget.set(marbleMesh.position.x, heightBias * 0.1, marbleMesh.position.z + LOOK_AHEAD + pitchLookAheadBias);
          break;
        }
        case "isoFlatter": {
          cameraTarget.set(
            marbleMesh.position.x + 4 * sideSign * zoomDistanceScale,
            11 + heightBias,
            marbleMesh.position.z - 10 * zoomDistanceScale,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 11 + heightBias;
          lookTarget.set(
            marbleMesh.position.x,
            heightBias * 0.1,
            marbleMesh.position.z + LOOK_AHEAD + 4 + pitchLookAheadBias,
          );
          break;
        }
        case "topdownPure": {
          cameraTarget.set(
            marbleMesh.position.x,
            TOPDOWN_HEIGHT + heightBias,
            marbleMesh.position.z - TOPDOWN_Z_OFFSET * zoomDistanceScale,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = TOPDOWN_HEIGHT + heightBias;
          lookTarget.set(marbleMesh.position.x, heightBias * 0.08, marbleMesh.position.z + pitchLookAheadBias * 0.2);
          break;
        }
        case "topdownForward": {
          cameraTarget.set(
            marbleMesh.position.x,
            TOPDOWN_HEIGHT + heightBias,
            marbleMesh.position.z - TOPDOWN_Z_OFFSET * zoomDistanceScale,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = TOPDOWN_HEIGHT + heightBias;
          lookTarget.set(marbleMesh.position.x, heightBias * 0.08, marbleMesh.position.z + 6 + pitchLookAheadBias * 0.4);
          break;
        }
        case "broadcast": {
          cameraTarget.set(
            marbleMesh.position.x + 6 * sideSign * zoomDistanceScale,
            18 + heightBias,
            marbleMesh.position.z - 12 * zoomDistanceScale,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 18 + heightBias;
          lookTarget.set(
            marbleMesh.position.x + sideSign * zoomDistanceScale,
            heightBias * 0.12,
            marbleMesh.position.z + LOOK_AHEAD + pitchLookAheadBias,
          );
          break;
        }
      }

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
      for (const body of track.bodies) {
        world.removeBody(body);
      }
      world.removeBody(marbleBody);
      marbleMesh.geometry.dispose();
      (marbleMesh.material as THREE.Material).dispose();
    };
  }, []);

  const showTouchFallback =
    !gyroEnabled || !tiltStatus.supported || tiltStatus.permission === "denied";
  const showModePicker = gameMode === "unselected" && menuScreen === "main";
  const showOptionsMenu = gameMode === "unselected" && menuScreen === "options";
  const showTrackLabMenu = gameMode === "unselected" && menuScreen === "trackLab";
  const showingOptionsRoot = showOptionsMenu && optionsSubmenu === "root";
  const showingOptionsControls = showOptionsMenu && optionsSubmenu === "controls";
  const showingOptionsCamera = showOptionsMenu && optionsSubmenu === "camera";
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
    !showModePicker &&
    !showOptionsMenu &&
    !showTrackLabMenu &&
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
    gyroEnabled &&
    racePhase === "racing" &&
    trialState !== "finished";
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

  const cycleCameraPreset = () => {
    const currentIndex = CAMERA_PRESETS.indexOf(tuning.cameraPreset);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % CAMERA_PRESETS.length : 0;
    updateTuning("cameraPreset", CAMERA_PRESETS[nextIndex]!);
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
    );
    setTrackLabSeed(nextConfig.seed);
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
    setTrackLabSeed(next);
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
      applyTrackConfigRef.current(
        buildTrackConfig(
          trackLabSeedRef.current,
          trackLabPieceCountRef.current,
          "builtin_plus_custom",
          trackLabCustomPiecesRef.current,
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
    <div className="appShell">
      <p className="versionBadge">Version {APP_VERSION}</p>
      <div className="viewport" ref={mountRef} />
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
        <div className="raceOverlay menuOverlay">
          <div className="raceOverlayCard menuCard">
            <div className="menuTitleWrap">
              <h1 className="menuGameTitle">Get Tilted</h1>
            </div>
            <p className="menuIntroText">Pick a mode and roll in.</p>
            <div className="mainMenuButtonGrid">
              <button
                type="button"
                className="menuActionButton"
                onClick={() => switchGameMode("solo")}
              >
                Singleplayer
              </button>
              <button
                type="button"
                className="menuActionButton"
                onClick={() => setMenuScreen("trackLab")}
              >
                Track Lab
              </button>
              <button
                type="button"
                className="menuActionButton"
                onClick={() => switchGameMode("multiplayer")}
              >
                Multiplayer
              </button>
              <button
                type="button"
                className="menuActionButton"
                onClick={() => {
                  setOptionsSubmenu("root");
                  setMenuScreen("options");
                }}
              >
                Options
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showOptionsMenu ? (
        <div className="raceOverlay menuOverlay">
          <div className="raceOverlayCard menuCard optionsCard">
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
                  <label className="optionsField" htmlFor="optionsCameraPreset">
                    <span className="optionsFieldLabel">Camera Type</span>
                    <select
                      id="optionsCameraPreset"
                      className="menuSelect"
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
                  <label className="optionsSliderField" htmlFor="optionsCameraZoom">
                    <span className="optionsFieldLabel">
                      Camera Zoom Level ({tuning.cameraZoom.toFixed(2)})
                    </span>
                    <input
                      id="optionsCameraZoom"
                      type="range"
                      min={0.7}
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
                  onChange={(event) => setTrackLabSeed(sanitizeTrackSeedInput(event.target.value))}
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
                  onClick={() => setTrackLabSeed(DEFAULT_TRACK_SEED)}
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
                    <option value="sCurve">S-Curve</option>
                    <option value="ramp">Ramp</option>
                    <option value="bridge">Bridge</option>
                    <option value="tunnel">Tunnel</option>
                    <option value="splitY">Split Y</option>
                    <option value="mergeY">Merge Y</option>
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
      {showRaceLobby ? (
        <div className="raceOverlay menuOverlay multiplayerLobbyOverlay">
          <div className="raceOverlayCard multiplayerLobbyCard">
            <button type="button" className="lobbyBackButton" onClick={returnToMainMenu}>
              {"< Back"}
            </button>
            <p className="raceOverlayTitle">Multiplayer Lobby {roomCode ? `• ${roomCode}` : ""}</p>
            <div className="lobbyQrWrap">
              {qrImageUrl ? (
                <img className="lobbyQrImage" src={qrImageUrl} alt="Join room QR code" />
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
                onClick={() => void toggleReady()}
                disabled={!canToggleLobbyReady}
              >
                {localReady ? "UNREADY" : "READY"}
              </button>
              <button
                type="button"
                className="readyButton lobbyActionButton startMatchButton"
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
            <p className="raceResultHeadline">Solo Finished</p>
            <p>Time: {formatTimeMs(trialLastMs)}</p>
            <p>Best: {formatTimeMs(trialBestMs)}</p>
            <button type="button" className="readyButton ready" onClick={restartSoloRace}>
              RESTART RACE
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
                min={0.7}
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
          <button
            type="button"
            className="mobileCycleCameraButton"
            onClick={cycleCameraPreset}
            aria-label="Cycle camera type"
          >
            C
          </button>
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
      {(showMultiplayerNetworkUi || gameMode === "solo") && debugMenuEnabled ? (
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
              Gyro Gain (Debug)
              <div className="controlRow">
                <input
                  type="range"
                  min={0.8}
                  max={1.2}
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
                  max={2}
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
            <label className="controlLabel controlLabelCheckbox">
              <input
                type="checkbox"
                checked={tuning.legacyTrackController}
                onChange={(event) =>
                  updateTuning("legacyTrackController", event.target.checked)
                }
              />
              Legacy Track Controller
            </label>
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
            <label className="controlLabel">
              Physics Max Substeps
              <div className="controlRow">
                <input
                  type="range"
                  min={1}
                  max={12}
                  step={1}
                  value={tuning.physicsMaxSubSteps}
                  onChange={(event) =>
                    updateTuning("physicsMaxSubSteps", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={1}
                  value={tuning.physicsMaxSubSteps}
                  onChange={(event) =>
                    updateTuning("physicsMaxSubSteps", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              Solver Iterations
              <div className="controlRow">
                <input
                  type="range"
                  min={8}
                  max={40}
                  step={1}
                  value={tuning.physicsSolverIterations}
                  onChange={(event) =>
                    updateTuning("physicsSolverIterations", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={1}
                  value={tuning.physicsSolverIterations}
                  onChange={(event) =>
                    updateTuning("physicsSolverIterations", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              CCD Speed Threshold
              <div className="controlRow">
                <input
                  type="range"
                  min={0.05}
                  max={4}
                  step={0.01}
                  value={tuning.ccdSpeedThreshold}
                  onChange={(event) =>
                    updateTuning("ccdSpeedThreshold", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={0.01}
                  value={tuning.ccdSpeedThreshold}
                  onChange={(event) =>
                    updateTuning("ccdSpeedThreshold", Number(event.target.value))
                  }
                />
              </div>
            </label>
            <label className="controlLabel">
              CCD Iterations
              <div className="controlRow">
                <input
                  type="range"
                  min={1}
                  max={40}
                  step={1}
                  value={tuning.ccdIterations}
                  onChange={(event) =>
                    updateTuning("ccdIterations", Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  step={1}
                  value={tuning.ccdIterations}
                  onChange={(event) =>
                    updateTuning("ccdIterations", Number(event.target.value))
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
