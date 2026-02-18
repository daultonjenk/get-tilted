import type * as THREE from "three";
import type { MessagePayloadMap } from "@get-tilted/shared-protocol";
import type { RingBuffer } from "./RingBuffer";

export type CameraPresetId =
  | "chaseCentered"
  | "chaseRight"
  | "chaseLeft"
  | "isoStandard"
  | "isoFlatter"
  | "topdownPure"
  | "topdownForward"
  | "broadcast";

export type TuningState = {
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
  mobileSafeFallback: boolean;
  localRenderInterpolation: boolean;
  debugUpdateHzMobile: number;
  physicsMaxSubSteps: number;
  physicsSolverIterations: number;
  ccdSpeedThreshold: number;
  ccdIterations: number;
};

export type TrialState = "idle" | "running" | "finished";
export type RacePhase = "waiting" | "countdown" | "racing";
export type GameMode = "unselected" | "solo" | "multiplayer";

export type GhostSnapshot = {
  seq: number | undefined;
  t: number;
  recvAtMs: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  hasTrackPose: boolean;
  trackPos: THREE.Vector3;
  trackQuat: THREE.Quaternion;
};

export type GhostRenderState = {
  snapshots: RingBuffer<GhostSnapshot>;
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

export type RaceResultPayload = MessagePayloadMap["race:result"];
