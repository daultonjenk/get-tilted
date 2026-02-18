import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent } from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { createTrack } from "./track/createTrack";
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
import type { TypedMessage } from "@get-tilted/shared-protocol";
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
  COUNTDOWN_LABELS,
  RESULT_SPARKLES,
  CAMERA_PRESETS,
  DRAWER_TABS,
} from "./gameConstants";
import {
  clamp,
  sanitizeJoinHost,
  sanitizePlayerName,
  isEditableEventTarget,
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

const skinCatalog = getSkinCatalog();
const defaultSkinId = getDefaultSkinId();

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
  const [roomCode, setRoomCode] = useState("");
  const [localPlayerId, setLocalPlayerId] = useState("");
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

  const tiltStatusRef = useRef(tiltStatus);
  const touchTiltRef = useRef(touchTilt);
  const tuningRef = useRef(tuning);
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
      setIsPortraitViewport(window.innerHeight >= window.innerWidth);
    };
    updateViewportOrientation();
    window.addEventListener("resize", updateViewportOrientation);
    window.addEventListener("orientationchange", updateViewportOrientation);
    window.visualViewport?.addEventListener("resize", updateViewportOrientation);
    return () => {
      window.removeEventListener("resize", updateViewportOrientation);
      window.removeEventListener("orientationchange", updateViewportOrientation);
      window.visualViewport?.removeEventListener("resize", updateViewportOrientation);
    };
  }, []);

  useEffect(() => {
    if (!isMobile || typeof window === "undefined") {
      return;
    }
    const tryLockPortraitOrientation = async () => {
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
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, initialRenderScale));
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
    solver.iterations = tuningRef.current.physicsSolverIterations;
    solver.tolerance = 1e-4;
    world.gravity.set(0, -tuningRef.current.gravityG, 0);
    world.addBody(boardBody);

    const boardMat = new CANNON.Material("board");
    const marbleMat = new CANNON.Material("marble");
    boardBody.material = boardMat;

    const contactMat = new CANNON.ContactMaterial(marbleMat, boardMat, {
      friction: tuningRef.current.contactFriction,
      restitution: tuningRef.current.contactRestitution,
      contactEquationStiffness: 5e7,
      contactEquationRelaxation: 6,
      frictionEquationStiffness: 5e7,
      frictionEquationRelaxation: 5,
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
    const contactNormalWorld = new THREE.Vector3();

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
    ): void => {
      state.renderedPos.copy(worldPos);
      state.renderedQuat.copy(worldQuat);
      state.hasRendered = true;
      state.mesh.visible = true;
      state.mesh.position.copy(worldPos);
      state.mesh.quaternion.copy(worldQuat);
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
    let perfTier: MobilePerfTier | "desktop" = mobilePerfGovernor ? "high" : "desktop";
    const resolveNormalizedIntent = (currentTuning: TuningState): TiltSample => {
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

    const simulateFixedStep = (nowMs: number, fixedDt: number): number => {
      const currentTuning = tuningRef.current;
      world.gravity.set(0, -currentTuning.gravityG, 0);
      solver.iterations = Math.round(currentTuning.physicsSolverIterations);
      marbleBody.linearDamping = currentTuning.linearDamping;
      marbleBody.angularDamping = currentTuning.angularDamping;
      marbleBodyWithCcd.ccdSpeedThreshold = currentTuning.ccdSpeedThreshold;
      marbleBodyWithCcd.ccdIterations = Math.round(currentTuning.ccdIterations);
      contactMat.friction = clamp(currentTuning.contactFriction, 0, 1.0);
      contactMat.restitution = clamp(currentTuning.bounce, 0, 0.99);
      if (!currentTuning.legacyTrackController) {
        updateTrackControllerFixed(fixedDt, currentTuning);
      }

      if (currentTuning.enableExtraDownforce) {
        extraDownForceVec.set(0, -currentTuning.extraDownForce, 0);
        marbleBody.applyForce(extraDownForceVec, marbleBody.position);
      }

      const physicsStartMs = performance.now();
      world.step(fixedDt, fixedDt, 1);
      suppressVerticalPopOnSideImpact();
      const physicsMs = performance.now() - physicsStartMs;

      const speed = marbleBody.velocity.length();
      if (speed > currentTuning.maxSpeed && speed > 0) {
        const scale = currentTuning.maxSpeed / speed;
        marbleBody.velocity.scale(scale, marbleBody.velocity);
      }
      const expectedMarbleCenterYOnFloor = marbleRadius + TRACK_FLOOR_TOP_Y;
      const computePenetrationDepth = (): number => {
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
        return Math.max(0, expectedMarbleCenterYOnFloor - marblePosLocalToBoard.y);
      };
      let penetrationDepth = computePenetrationDepth();
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
        penetrationDepth = computePenetrationDepth();
      }
      latestPenetrationDepth = penetrationDepth;
      latestAngularSpeed = marbleBody.angularVelocity.length();
      latestVerticalSpeed = marbleBody.velocity.y;

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
        applyGhostPose(playerState, tempVecA, tempQuatA);
      }

      const cameraAlpha = 1 - Math.exp(-8 * delta);
      const sideSign = currentTuning.invertCameraSide ? -1 : 1;
      switch (currentTuning.cameraPreset) {
        case "chaseCentered": {
          cameraTarget.set(0, 7.5, marbleMesh.position.z - 10);
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.x = 0;
          camera.position.y = 7.5;
          lookTarget.set(0, LOOK_HEIGHT, marbleMesh.position.z + LOOK_AHEAD);
          break;
        }
        case "chaseRight": {
          const side = 4 * sideSign;
          cameraTarget.set(side, 7.5, marbleMesh.position.z - 10);
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 7.5;
          lookTarget.set(side, LOOK_HEIGHT, marbleMesh.position.z + LOOK_AHEAD);
          break;
        }
        case "chaseLeft": {
          const side = -4 * sideSign;
          cameraTarget.set(side, 7.5, marbleMesh.position.z - 10);
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 7.5;
          lookTarget.set(side, LOOK_HEIGHT, marbleMesh.position.z + LOOK_AHEAD);
          break;
        }
        case "isoStandard": {
          cameraTarget.set(
            marbleMesh.position.x + 4 * sideSign,
            14,
            marbleMesh.position.z - 8,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 14;
          lookTarget.set(marbleMesh.position.x, 0, marbleMesh.position.z + LOOK_AHEAD);
          break;
        }
        case "isoFlatter": {
          cameraTarget.set(
            marbleMesh.position.x + 4 * sideSign,
            11,
            marbleMesh.position.z - 10,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 11;
          lookTarget.set(
            marbleMesh.position.x,
            0,
            marbleMesh.position.z + LOOK_AHEAD + 4,
          );
          break;
        }
        case "topdownPure": {
          cameraTarget.set(
            marbleMesh.position.x,
            TOPDOWN_HEIGHT,
            marbleMesh.position.z - TOPDOWN_Z_OFFSET,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = TOPDOWN_HEIGHT;
          lookTarget.set(marbleMesh.position.x, 0, marbleMesh.position.z);
          break;
        }
        case "topdownForward": {
          cameraTarget.set(
            marbleMesh.position.x,
            TOPDOWN_HEIGHT,
            marbleMesh.position.z - TOPDOWN_Z_OFFSET,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = TOPDOWN_HEIGHT;
          lookTarget.set(marbleMesh.position.x, 0, marbleMesh.position.z + 6);
          break;
        }
        case "broadcast": {
          cameraTarget.set(
            marbleMesh.position.x + 6 * sideSign,
            18,
            marbleMesh.position.z - 12,
          );
          camera.position.lerp(cameraTarget, cameraAlpha);
          camera.position.y = 18;
          lookTarget.set(
            marbleMesh.position.x + sideSign,
            0,
            marbleMesh.position.z + LOOK_AHEAD,
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
  const showRotateToPortraitOverlay = isMobile && !isPortraitViewport;
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

  const handleMenuSkinChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedMarbleSkinId(resolveSkinById(event.target.value).id);
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
      raceClientRef.current?.setPreferredSkinId(
        selectedMarbleSkinIdRef.current === defaultSkinId
          ? undefined
          : selectedMarbleSkinIdRef.current,
      );
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
            <p className="menuIntroText">Choose a mode to begin.</p>
            <div className="menuSelectWrap">
              <label className="menuSelectLabel" htmlFor="menuSkinSelect">
                Marble Skin
              </label>
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
            </div>
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
                <p className="lobbyPlayerNameValue">{playerOneName}</p>
                <div className="lobbyNameInputWrap">
                  <input
                    id="lobbyPlayerName"
                    className="lobbyNameInput"
                    value={playerNameInput}
                    onChange={(event) => setPlayerNameInput(sanitizePlayerName(event.target.value))}
                    placeholder="Enter name"
                    maxLength={18}
                    autoComplete="nickname"
                  />
                </div>
                <div className="lobbyReadyRow">
                  <div className={`lobbyReadyIndicator ${playerOneReady ? "ready" : "notReady"}`} />
                  <p className={`lobbyReadyStatus ${playerOneReady ? "ready" : "notReady"}`}>
                    {playerOneReady ? "READY" : "NOT READY"}
                  </p>
                </div>
              </div>
              <div className="lobbyPlayerCard">
                <p className="lobbyPlayerNameValue">{playerTwoName}</p>
                <div className="lobbyCardMidSpacer" aria-hidden="true" />
                <div className="lobbyReadyRow">
                  <div className={`lobbyReadyIndicator ${playerTwoReady ? "ready" : "notReady"}`} />
                  <p className={`lobbyReadyStatus ${playerTwoReady ? "ready" : "notReady"}`}>
                    {playerTwoReady ? "READY" : "NOT READY"}
                  </p>
                </div>
              </div>
            </div>
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
