import * as THREE from "three";
import {
  CAMERA_PRESETS,
  DEFAULT_TUNING,
  MOBILE_RENDER_SCALE_MIN,
  MOBILE_RENDER_SCALE_MAX,
  TUNING_STORAGE_KEY,
} from "./gameConstants";
import type { CameraPresetId, TuningState, GhostSnapshot } from "./gameTypes";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeJoinHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  let next = trimmed.replace(/^https?:\/\//i, "");
  next = next.split("/")[0] ?? "";
  next = next.trim();
  if (!next) return "";

  const hostPattern = /^[A-Za-z0-9.-]+(?::\d+)?$/;
  return hostPattern.test(next) ? next : "";
}

export function sanitizePlayerName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 18);
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function extractHostname(host: string): string {
  return host.replace(/:\d+$/, "");
}

export function isCameraPresetId(value: unknown): value is CameraPresetId {
  return typeof value === "string" && CAMERA_PRESETS.includes(value as CameraPresetId);
}

export function buildCanonicalTuning(): TuningState {
  return {
    ...DEFAULT_TUNING,
  };
}

export function sanitizeTuning(input: unknown): TuningState {
  const base = buildCanonicalTuning();
  if (!input || typeof input !== "object") {
    return base;
  }

  const value = input as Partial<TuningState> & {
    localRenderInterpolation?: unknown;
  };

  if (typeof value.gravityG === "number") base.gravityG = clamp(value.gravityG, 8, 24);
  if (typeof value.tiltStrength === "number") {
    base.tiltStrength = clamp(value.tiltStrength, 0.5, 2);
  }
  if (typeof value.gyroSensitivity === "number") {
    base.gyroSensitivity = clamp(value.gyroSensitivity, 0.8, 1.2);
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
    base.renderScaleMobile = clamp(value.renderScaleMobile, MOBILE_RENDER_SCALE_MIN, MOBILE_RENDER_SCALE_MAX);
  }
  if (typeof value.mobileSafeFallback === "boolean") {
    base.mobileSafeFallback = value.mobileSafeFallback;
  }
  if (typeof value.legacyTrackController === "boolean") {
    base.legacyTrackController = value.legacyTrackController;
  }
  if (typeof value.localRenderInterpolation === "boolean") {
    // Backward compatibility for old presets/imports.
    base.localMarbleRenderInterpolation = value.localRenderInterpolation;
    base.localTrackRenderInterpolation = value.localRenderInterpolation;
  }
  if (typeof value.localMarbleRenderInterpolation === "boolean") {
    base.localMarbleRenderInterpolation = value.localMarbleRenderInterpolation;
  }
  if (typeof value.localTrackRenderInterpolation === "boolean") {
    base.localTrackRenderInterpolation = value.localTrackRenderInterpolation;
  }
  if (typeof value.debugUpdateHzMobile === "number") {
    base.debugUpdateHzMobile = clamp(value.debugUpdateHzMobile, 2, 15);
  }
  if (typeof value.physicsMaxSubSteps === "number") {
    base.physicsMaxSubSteps = Math.round(clamp(value.physicsMaxSubSteps, 1, 12));
  }
  if (typeof value.physicsSolverIterations === "number") {
    base.physicsSolverIterations = Math.round(clamp(value.physicsSolverIterations, 8, 40));
  }
  if (typeof value.ccdSpeedThreshold === "number") {
    base.ccdSpeedThreshold = clamp(value.ccdSpeedThreshold, 0.05, 4);
  }
  if (typeof value.ccdIterations === "number") {
    base.ccdIterations = Math.round(clamp(value.ccdIterations, 1, 40));
  }
  if (typeof value.cameraZoom === "number") {
    base.cameraZoom = clamp(value.cameraZoom, 0.7, 1.4);
  }
  if (typeof value.cameraFov === "number") {
    base.cameraFov = clamp(value.cameraFov, 50, 90);
  }
  if (typeof value.cameraHeightBias === "number") {
    base.cameraHeightBias = clamp(value.cameraHeightBias, -6, 8);
  }

  return base;
}

export function loadTuning(): TuningState {
  if (typeof window === "undefined") {
    return buildCanonicalTuning();
  }

  const defaultTuning = buildCanonicalTuning();
  // Each fresh app launch starts from canonical defaults, regardless of prior dev tuning.
  window.localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(defaultTuning));
  return defaultTuning;
}

export function getCameraLabel(id: CameraPresetId): string {
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

export function formatTimeMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) {
    return "--";
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function createMarbleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.colorSpace = THREE.SRGBColorSpace;
    fallback.needsUpdate = true;
    return fallback;
  }

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#193145");
  gradient.addColorStop(0.55, "#1f4f78");
  gradient.addColorStop(1, "#102235");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const stripeColors = ["#64d2ff", "#2b8be0", "#4cb4ff"];
  const stripeWidth = canvas.width / 20;
  for (let i = 0; i < 20; i += 1) {
    ctx.fillStyle = stripeColors[i % stripeColors.length] ?? "#64d2ff";
    ctx.fillRect(i * stripeWidth, 0, stripeWidth * 0.7, canvas.height);
  }

  ctx.fillStyle = "#ff6f61";
  ctx.fillRect(canvas.width * 0.08, canvas.height * 0.2, canvas.width * 0.1, canvas.height * 0.2);
  ctx.fillStyle = "#ffd166";
  ctx.beginPath();
  ctx.arc(canvas.width * 0.76, canvas.height * 0.7, canvas.height * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(canvas.width * 0.48, 0, canvas.width * 0.03, canvas.height);

  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(canvas.width * 0.15, 0);
  ctx.lineTo(canvas.width * 0.95, canvas.height);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height * 0.22);
  ctx.lineTo(canvas.width, canvas.height * 0.78);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/** Pre-allocated pool of GhostSnapshot objects to avoid per-message GC pressure. */
const snapshotPool: GhostSnapshot[] = [];

export function acquireSnapshot(): GhostSnapshot {
  return snapshotPool.pop() ?? {
    seq: undefined,
    t: 0,
    recvAtMs: 0,
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    vel: new THREE.Vector3(),
    hasTrackPose: false,
    trackPos: new THREE.Vector3(),
    trackQuat: new THREE.Quaternion(),
  };
}

export function releaseSnapshot(snap: GhostSnapshot): void {
  snapshotPool.push(snap);
}
