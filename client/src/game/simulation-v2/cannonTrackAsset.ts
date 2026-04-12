import * as CANNON from "cannon-es";
import type { TrackBuildResult } from "../track/createTrack";
import type {
  SimulationQuaternion,
  SimulationVector3,
  TrackColliderShapeAsset,
  TrackCollisionAsset,
  TrackRigidBodyAsset,
  TrackRigidBodyMaterial,
} from "./types.ts";

const ZERO_VEC3 = new CANNON.Vec3(0, 0, 0);
const IDENTITY_QUAT = new CANNON.Quaternion(0, 0, 0, 1);

function toVec3Tuple(vec: CANNON.Vec3): SimulationVector3 {
  return [vec.x, vec.y, vec.z];
}

function toQuatTuple(quat: CANNON.Quaternion): SimulationQuaternion {
  return [quat.x, quat.y, quat.z, quat.w];
}

function buildShapeAsset(body: CANNON.Body, index: number): TrackColliderShapeAsset | null {
  const shape = body.shapes[index];
  if (!shape) {
    return null;
  }
  const shapeOffset = body.shapeOffsets[index] ?? ZERO_VEC3;
  const shapeOrientation = body.shapeOrientations[index] ?? IDENTITY_QUAT;

  if (shape instanceof CANNON.Box) {
    return {
      kind: "box",
      translation: toVec3Tuple(shapeOffset),
      rotation: toQuatTuple(shapeOrientation),
      halfExtents: [
        shape.halfExtents.x,
        shape.halfExtents.y,
        shape.halfExtents.z,
      ],
    };
  }

  if (shape instanceof CANNON.Sphere) {
    return {
      kind: "sphere",
      translation: toVec3Tuple(shapeOffset),
      rotation: toQuatTuple(shapeOrientation),
      radius: shape.radius,
    };
  }

  if (shape instanceof CANNON.Trimesh) {
    return {
      kind: "trimesh",
      translation: toVec3Tuple(shapeOffset),
      rotation: toQuatTuple(shapeOrientation),
      vertices: Array.from(shape.vertices),
      indices: Array.from(shape.indices),
    };
  }

  return null;
}

function buildBodyAsset(
  body: CANNON.Body,
  id: string,
  material: TrackRigidBodyMaterial,
): TrackRigidBodyAsset {
  const shapes: TrackColliderShapeAsset[] = [];
  for (let index = 0; index < body.shapes.length; index += 1) {
    const shape = buildShapeAsset(body, index);
    if (shape) {
      shapes.push(shape);
    }
  }
  return {
    id,
    material,
    translation: toVec3Tuple(body.position),
    rotation: toQuatTuple(body.quaternion),
    shapes,
    sourceBody: body,
  };
}

export function createTrackCollisionAssetFromTrack(
  track: TrackBuildResult,
): TrackCollisionAsset {
  const boardBody = track.bodies[0];
  const wallBody = track.wallBody;
  if (!boardBody) {
    throw new Error("Track did not provide a board body for simulation-v2");
  }

  const movingBodySet = new Set(track.movingObstacleBodies);
  const staticObstacleBodies = Array.from(
    new Set(track.bodies.slice(2).filter((body) => !movingBodySet.has(body))),
  );

  const staticBodies: TrackRigidBodyAsset[] = [
    buildBodyAsset(boardBody, "track-floor", "floor"),
    buildBodyAsset(wallBody, "track-wall", "wall"),
    ...staticObstacleBodies.map((body, index) =>
      buildBodyAsset(body, `static-obstacle-${index}`, "obstacle"),
    ),
  ];

  const movingBodies = track.movingObstacleBodies.map((body, index) =>
    buildBodyAsset(body, `moving-obstacle-${index}`, "obstacle"),
  );

  return {
    spawn: [track.spawn.x, track.spawn.y, track.spawn.z],
    respawnY: track.respawnY,
    offCourseBoundsLocal: {
      ...track.offCourseBoundsLocal,
    },
    containmentPathLocal: track.containmentPathLocal,
    checkpoints: track.checkpoints.map((checkpoint) => ({
      spawnPos: [
        checkpoint.spawnPos.x,
        checkpoint.spawnPos.y,
        checkpoint.spawnPos.z,
      ],
      sampleIndex: checkpoint.sampleIndex,
    })),
    staticBodies,
    movingBodies,
    updateDynamicBodies: (fixedDt: number) => {
      track.updateMovingObstacles(fixedDt, ZERO_VEC3, IDENTITY_QUAT);
    },
  };
}
