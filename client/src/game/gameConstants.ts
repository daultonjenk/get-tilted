import type { DebugTabId } from "../ui/DebugDrawer";
import type { CameraPresetId, TuningState } from "./gameTypes";

export const TIMESTEP = 1 / 120;
export const MAX_FRAME_DELTA = 0.1;
export const LOOK_HEIGHT = 1.2;
export const LOOK_AHEAD = 16;
export const TOPDOWN_HEIGHT = 16;
export const TOPDOWN_Z_OFFSET = 2;
export const BOARD_TILT_SMOOTH = 20;
export const PIVOT_SMOOTH = 10;
export const TRACK_FLOOR_TOP_Y = 0.3;
export const PENETRATION_EPSILON = 0.004;
export const PENETRATION_CORRECTION_BIAS = 0;
export const PENETRATION_CORRECTION_MAX = 0.04;
export const SIDE_IMPACT_NORMAL_UP_DOT_MAX = 0.35;
export const SIDE_IMPACT_UPWARD_SPEED_MIN = 0.35;
export const SIDE_IMPACT_UPWARD_DAMPING = 0.35;
export const SOURCE_RATE_MS = 1000 / 15;
export const INTERP_DELAY_MIN_MS = 120;
export const INTERP_DELAY_MAX_MS = 165;
export const INTERP_DELAY_RISE_BLEND = 0.18;
export const INTERP_DELAY_FALL_BLEND = 0.08;
export const EXTRAPOLATION_MAX_MS = 45;
export const SNAPSHOT_MAX_AGE_MS = 2000;
export const TAB_BACKGROUND_THRESHOLD_MS = 500;
export const SNAPSHOT_QUEUE_CAPACITY = 64;

// Pre-computed input source labels indexed by bitmask (keyboard=1, tilt=2, touch=4).
export const INPUT_LABELS = [
  "none", "keyboard", "tilt", "keyboard+tilt",
  "touch", "keyboard+touch", "tilt+touch", "keyboard+tilt+touch",
];

export const MOBILE_SAFE_RENDER_SCALE_MIN = 0.72;
export const MOBILE_SAFE_RENDER_SCALE_MAX = 1;
export const MOBILE_RENDER_SCALE_MIN = 0.75;
export const MOBILE_RENDER_SCALE_MAX = 2;

export const TUNING_STORAGE_KEY = "get-tilted:v0.8.3.11:tuning";
export const BEST_TIME_STORAGE_KEY = "get-tilted:v0.3.8:best-time";
export const DEV_JOIN_HOST_KEY = "get-tilted:v0.3.10.2:join-host";
export const PLAYER_NAME_STORAGE_KEY = "get-tilted:v0.7.2.8:player-name";
export const MARBLE_SKIN_STORAGE_KEY = "get-tilted:v0.7.9.0:marble-skin";
export const GYRO_ENABLED_STORAGE_KEY = "get-tilted:v0.7.10.0:gyro-enabled";
export const MUSIC_ENABLED_STORAGE_KEY = "get-tilted:v0.7.10.0:music-enabled";
export const SOUND_ENABLED_STORAGE_KEY = "get-tilted:v0.7.10.0:sound-enabled";
export const DEBUG_MENU_ENABLED_STORAGE_KEY = "get-tilted:v0.7.12.0:debug-menu-enabled";
export const TRACK_LAB_LIBRARY_STORAGE_KEY = "get-tilted:v0.8.1.2:track-lab-library";
export const TRACK_LAB_SEED_STORAGE_KEY = "get-tilted:v0.8.1.2:track-lab-seed";
export const TRACK_LAB_PIECE_COUNT_STORAGE_KEY = "get-tilted:v0.8.1.2:track-lab-piece-count";

export const COUNTDOWN_LABELS = ["3", "2", "1", "GO!"] as const;
export const RESULT_SPARKLES = Array.from({ length: 12 }, (_, index) => index);

export const DEFAULT_TUNING: TuningState = {
  gravityG: 24,
  tiltStrength: 1.9,
  gyroSensitivity: 1,
  maxSpeed: 20,
  maxTiltDeg: 16,
  maxBoardAngVel: 7.5,
  tiltFilterTau: 0.2,
  linearDamping: 0.12,
  angularDamping: 0.18,
  cameraPreset: "broadcast",
  bounce: 0,
  contactFriction: 0.84,
  contactRestitution: 0,
  invertTiltX: true,
  invertTiltZ: false,
  invertCameraSide: false,
  enableExtraDownforce: false,
  extraDownForce: 0.7,
  renderScaleMobile: 1,
  mobileSafeFallback: false,
  localMarbleRenderInterpolation: true,
  localTrackRenderInterpolation: true,
  debugUpdateHzMobile: 5,
  physicsMaxSubSteps: 6,
  physicsSolverIterations: 16,
  ccdSpeedThreshold: 0.75,
  ccdIterations: 20,
  cameraZoom: 1,
  cameraFov: 65,
  cameraHeightBias: 0,
  shadowMapSize: 1024,
};

export const CAMERA_PRESETS: CameraPresetId[] = [
  "chaseCentered",
  "chaseRight",
  "chaseLeft",
  "isoStandard",
  "isoFlatter",
  "topdownPure",
  "topdownForward",
  "broadcast",
];

export const DRAWER_TABS: { id: DebugTabId; label: string }[] = [
  { id: "tuning", label: "Tuning" },
  { id: "camera", label: "Camera" },
  { id: "network", label: "Network" },
  { id: "diagnostics", label: "Diagnostics" },
];
