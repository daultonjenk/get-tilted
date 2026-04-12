import type * as CANNON from "cannon-es";
import type { TrackContainmentSample } from "../track/createTrack";

export type SimulationVector3 = [number, number, number];
export type SimulationQuaternion = [number, number, number, number];

export type SimulationAxisIntent = {
  x: number;
  z: number;
};

export type SimulationInput = {
  timestampMs: number;
  tiltIntent: SimulationAxisIntent;
  fallbackIntent: SimulationAxisIntent;
  combinedIntent?: SimulationAxisIntent;
  paused?: boolean;
  resetRequested?: boolean;
};

export type SimulationEvent =
  | { type: "checkpoint"; index: number; sampleIndex: number }
  | { type: "respawned"; count: number; spawn: SimulationVector3 }
  | { type: "obstacle-hit"; obstacleId: string };

export type SimulationSnapshot = {
  marble: {
    position: SimulationVector3;
    rotation: SimulationQuaternion;
    velocity: SimulationVector3;
    angularVelocity: SimulationVector3;
  };
  board: {
    position: SimulationVector3;
    rotation: SimulationQuaternion;
  };
  trackBasis: {
    sampleIndex: number;
    right: SimulationVector3;
    up: SimulationVector3;
    tangent: SimulationVector3;
  };
  checkpoints: {
    lastReachedIndex: number;
    total: number;
  };
  respawnCount: number;
  frozen: boolean;
  movingObstacles: Array<{
    id: string;
    position: SimulationVector3;
    rotation: SimulationQuaternion;
  }>;
};

export type SimulationStepResult = {
  snapshot: SimulationSnapshot;
  events: SimulationEvent[];
};

export type SimulationV2Tuning = {
  gravityMagnitude: number;
  controlStrength: number;
  maxSpeed: number;
  maxTiltDeg: number;
  linearDamping: number;
  angularDamping: number;
  floorFriction: number;
  railRestitution: number;
  obstacleFriction: number;
  obstacleRestitution: number;
  ccdEnabled: boolean;
};

export const DEFAULT_SIMULATION_V2_TUNING: SimulationV2Tuning = {
  gravityMagnitude: 24,
  controlStrength: 0.76,
  maxSpeed: 20,
  maxTiltDeg: 13.5,
  linearDamping: 0.12,
  angularDamping: 0.18,
  floorFriction: 0.84,
  railRestitution: 0.18,
  obstacleFriction: 0.02,
  obstacleRestitution: 0.24,
  ccdEnabled: true,
};

export type TrackColliderShapeAsset =
  | {
      kind: "box";
      translation: SimulationVector3;
      rotation: SimulationQuaternion;
      halfExtents: SimulationVector3;
    }
  | {
      kind: "sphere";
      translation: SimulationVector3;
      rotation: SimulationQuaternion;
      radius: number;
    }
  | {
      kind: "trimesh";
      translation: SimulationVector3;
      rotation: SimulationQuaternion;
      vertices: number[];
      indices: number[];
    };

export type TrackRigidBodyMaterial = "floor" | "wall" | "obstacle";

export type TrackRigidBodyAsset = {
  id: string;
  material: TrackRigidBodyMaterial;
  translation: SimulationVector3;
  rotation: SimulationQuaternion;
  shapes: TrackColliderShapeAsset[];
  sourceBody?: CANNON.Body;
};

export type TrackCollisionAsset = {
  spawn: SimulationVector3;
  respawnY: number;
  offCourseBoundsLocal: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  containmentPathLocal: TrackContainmentSample[];
  checkpoints: Array<{
    spawnPos: SimulationVector3;
    sampleIndex: number;
  }>;
  staticBodies: TrackRigidBodyAsset[];
  movingBodies: TrackRigidBodyAsset[];
  updateDynamicBodies: (fixedDt: number) => void;
};
