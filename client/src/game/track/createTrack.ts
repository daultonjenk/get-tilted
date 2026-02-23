import * as THREE from "three";
import * as CANNON from "cannon-es";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import trackSurfaceUrl from "../../assets/textures/track/track-surface.png";
import type { TrackBlueprint } from "./modularTrack";

export type CreateTrackOptions = {
  seed?: string;
  blueprint?: TrackBlueprint;
  blueprintObstacleSettings?: {
    safeStartStraightCount?: number;
    enableAutomaticObstacles?: boolean;
  };
};

export type TrackContainmentSample = {
  center: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  tangent: [number, number, number];
  halfWidth: number;
  railLeft: boolean;
  railRight: boolean;
};

export type TrackPhysicsDebug = {
  colliderPieceCount: number;
  primitiveShapeCount: number;
  exoticTrimeshPieceCount: number;
  floorShapeCount: number;
  wallShapeCount: number;
  estimatedBoardWallShapeTestsPerStep: number;
};

export type TrackBuildResult = {
  group: THREE.Group;
  bodies: CANNON.Body[];
  wallBody: CANNON.Body;
  movingObstacleBodies: CANNON.Body[];
  containmentLocal: {
    mainHalfX: number;
    finishHalfX: number;
    finishStartZ: number;
  };
  wallContainmentMode: "legacyLinear" | "curvedPathClamp";
  containmentPathLocal: TrackContainmentSample[];
  spawn: CANNON.Vec3;
  respawnY: number;
  offCourseBoundsLocal: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  trialStartZ: number;
  trialFinishZ: number;
  physicsDebug: TrackPhysicsDebug;
  updateMovingObstacles: (
    fixedDt: number,
    boardPos: CANNON.Vec3,
    boardQuat: CANNON.Quaternion,
  ) => void;
  setMovingObstacleMaterial: (material: CANNON.Material) => void;
};

type SegmentDef = {
  length: number;
  slopeDeg: number;
  yawDeg: number;
  landingLength?: number;
  railLeft?: boolean;
  railRight?: boolean;
  width?: number;
};

type PartSpec = {
  size: THREE.Vector3;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  material: THREE.Material;
  uvScale?: [number, number];
  uvProjection?: "default" | "floorSegment";
  outline?: {
    color: number;
    scale?: number;
  };
};

type ObstacleActor = {
  visual: THREE.Object3D;
  body: CANNON.Body;
  baseLocalPos: CANNON.Vec3;
  localQuat: CANNON.Quaternion;
  hasLocalRotation: boolean;
  isLocallyDynamic: boolean;
  minX: number;
  maxX: number;
  phase: number;
  speedHz: number;
};

type MovingObstacleSpec = {
  width: number;
  length: number;
  minSpeedHz: number;
  maxSpeedHz: number;
  laneMinScale: number;
  laneMaxScale: number;
};

const TRACK_W = 9;
const FLOOR_THICK = 0.6;
const RAIL_THICK = 0.35;
const RAIL_H = 2.0;
const RAIL_INSET = 0.15;
const RAIL_FLOOR_OVERLAP = 0.12;
const MARBLE_RADIUS = 0.5;
const START_LENGTH = 8;
const FINISH_LENGTH = 10;
const FINISH_WIDTH = 12;
const MARKER_THICK = 0.12;
const WALL_CLEARANCE = 0.2;
const OFF_COURSE_MARGIN = 1.1;
const OFF_COURSE_Z_MARGIN = 2.4;

const MOVING_OBSTACLE_HEIGHT_SCALE = 1.2;
const MOVING_OBSTACLE_WIDTH_SCALE = 1.18;
const MOVING_OBSTACLE_LENGTH_SCALE = 0.25;
const MOVING_OBSTACLE_H = (2.25 / 3) * MOVING_OBSTACLE_HEIGHT_SCALE;
const MOVING_OBSTACLE_LONG_W = 5.0 * MOVING_OBSTACLE_WIDTH_SCALE;
const MOVING_OBSTACLE_LONG_L = 1.85 * MOVING_OBSTACLE_LENGTH_SCALE;
const MOVING_OBSTACLE_SHORT_W = 3.1 * MOVING_OBSTACLE_WIDTH_SCALE;
const MOVING_OBSTACLE_SHORT_L = 0.6 * MOVING_OBSTACLE_LENGTH_SCALE;
const MOVING_OBSTACLE_MEDIUM_W = 4.2 * MOVING_OBSTACLE_WIDTH_SCALE;
const MOVING_OBSTACLE_MEDIUM_L = 1.1 * MOVING_OBSTACLE_LENGTH_SCALE;

const FINAL_WALL_W = 11.2;
const FINAL_WALL_H = MOVING_OBSTACLE_H;
const FINAL_WALL_DEPTH = 0.13;
const MARBLE_HOLE_SCALE = 1.15;
const STANDARD_MARBLE_HOLE_WIDTH = MARBLE_RADIUS * 2 * MARBLE_HOLE_SCALE;
const STANDARD_MARBLE_HOLE_BASE_HEIGHT = STANDARD_MARBLE_HOLE_WIDTH / 2;
const FINAL_WALL_HOLE_X = [-2.55, 0, 2.55];
const FINAL_WALL_CURVE_SEGMENTS = 40;
const DEFAULT_OBSTACLE_SEED = "track-v0.7.17.0";
const START_BACK_WALL_PADDING = 0.03;
const STATIC_GAP_WALL_H = MOVING_OBSTACLE_H;
const STATIC_GAP_WALL_DEPTH = 0.105;
const STATIC_INTERSTITIAL_H = MOVING_OBSTACLE_H * 1.02;
const STATIC_INTERSTITIAL_CENTER_W = TRACK_W / 5;
const STATIC_INTERSTITIAL_OFFCENTER_W = TRACK_W * 0.19;
const STATIC_INTERSTITIAL_WALL_JUT_W = TRACK_W / 6;
const STATIC_INTERSTITIAL_L = 0.62;
const BLUEPRINT_RENDER_SAMPLE_STEP = 0.25;
const BLUEPRINT_COLLIDER_SAMPLE_STEP = 1.2;
const CENTER_GUIDE_HALF_WIDTH = 0.16;
const BLUEPRINT_COLLIDER_MODE: BlueprintColliderMode = "primitive";
const COLLIDER_SPAN_OVERLAP_Z = 0.22;
const COLLIDER_LATERAL_PADDING_X = 0.04;
const BLUEPRINT_SET_PIECE_MIN_CLEARANCE_MULTIPLIER = 1.15;
const BLUEPRINT_SET_PIECE_GATE_CLEARANCE_MULTIPLIER = 1.35;
const BLUEPRINT_SET_PIECE_GATE_CLEARANCE_MAX_MULTIPLIER = 1.5;
const BLUEPRINT_SET_PIECE_OBSTACLE_RATE = 0.75;
const BLUEPRINT_SET_PIECE_S_PATTERN_COUNT = 8;
const BLUEPRINT_SET_PIECE_MIN_LENGTH = 8;
const BLUEPRINT_SET_PIECE_SAFE_START_MAIN_COUNT = 2;
const BLUEPRINT_SET_PIECE_OBSTACLE_HEIGHT = MARBLE_RADIUS * 2 * 1.15;
const BLUEPRINT_OBSTACLE_CORNER_RADIUS_SCALE = 0.22;
const BLUEPRINT_OBSTACLE_CORNER_RADIUS_MIN = 0.08;
const BLUEPRINT_OBSTACLE_CORNER_RADIUS_MAX = 0.32;
const BLUEPRINT_OBSTACLE_CORNER_CURVE_SEGMENTS = 8;
const BLUEPRINT_OBSTACLE_WALL_TOUCH_EPSILON = 0.03;

// Roughly 2x original authored length.
const SEGMENTS: SegmentDef[] = [
  { length: 11, slopeDeg: 0, yawDeg: 0 },
  { length: 10, slopeDeg: 0, yawDeg: 0 },
  { length: 9, slopeDeg: 0, yawDeg: 0, landingLength: 3 },
  { length: 11, slopeDeg: 0, yawDeg: 0 },
  { length: 10, slopeDeg: 0, yawDeg: 0 },
  { length: 9, slopeDeg: 0, yawDeg: 0, landingLength: 3 },
  { length: 11, slopeDeg: 0, yawDeg: 0 },
  { length: 10, slopeDeg: 0, yawDeg: 0 },
  { length: 9, slopeDeg: 0, yawDeg: 0, landingLength: 3 },
  { length: 11, slopeDeg: 0, yawDeg: 0 },
  { length: 10, slopeDeg: 0, yawDeg: 0 },
  { length: 9, slopeDeg: 0, yawDeg: 0, landingLength: 3 },
];

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeSeededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(min: number, max: number, alpha: number): number {
  return min + (max - min) * alpha;
}

function createTrackSurfaceTexture(): THREE.Texture {
  const texture = new THREE.TextureLoader().load(trackSurfaceUrl);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function applyFloorSegmentUv(geometry: THREE.BoxGeometry, size: THREE.Vector3): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const sideTileWorldUnits = 2;

  for (let i = 0; i < uv.count; i += 1) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));

    if (ny >= nx && ny >= nz) {
      uv.setXY(i, px / size.x + 0.5, pz / size.z + 0.5);
      continue;
    }

    if (nx >= nz) {
      uv.setXY(
        i,
        (pz + size.z / 2) / sideTileWorldUnits,
        (py + size.y / 2) / sideTileWorldUnits,
      );
      continue;
    }

    uv.setXY(
      i,
      (px + size.x / 2) / sideTileWorldUnits,
      (py + size.y / 2) / sideTileWorldUnits,
    );
  }
  uv.needsUpdate = true;
}

function addVisualPart(group: THREE.Group, spec: PartSpec): THREE.Mesh {
  const { size, position, rotation, material, uvScale, uvProjection, outline } = spec;
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const mesh = new THREE.Mesh(geometry, material);
  if (uvProjection === "floorSegment") {
    applyFloorSegmentUv(geometry, size);
  }
  if (uvScale) {
    const geom = mesh.geometry;
    const uv = geom.getAttribute("uv");
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getX(i) * uvScale[0], uv.getY(i) * uvScale[1]);
    }
    uv.needsUpdate = true;
  }
  mesh.position.copy(position);
  mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);

  if (outline) {
    const edges = new THREE.EdgesGeometry(mesh.geometry);
    const edgeLines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: outline.color }),
    );
    const outlineScale = outline.scale ?? 1.001;
    edgeLines.scale.set(outlineScale, outlineScale, outlineScale);
    mesh.add(edgeLines);
  }
  return mesh;
}

function addCompoundPart(boardBody: CANNON.Body, spec: PartSpec): void {
  const shape = new CANNON.Box(
    new CANNON.Vec3(spec.size.x / 2, spec.size.y / 2, spec.size.z / 2),
  );
  const offset = new CANNON.Vec3(spec.position.x, spec.position.y, spec.position.z);
  const orientation = new CANNON.Quaternion();
  orientation.setFromEuler(spec.rotation.x, spec.rotation.y, spec.rotation.z, "XYZ");
  boardBody.addShape(shape, offset, orientation);
}

function addPart(group: THREE.Group, boardBody: CANNON.Body, spec: PartSpec): void {
  addVisualPart(group, spec);
  addCompoundPart(boardBody, spec);
}

function geometryToTrimesh(
  geometry: THREE.BufferGeometry,
  options?: { doubleSided?: boolean; minAreaSq?: number },
): CANNON.Trimesh {
  const doubleSided = options?.doubleSided ?? false;
  const minAreaSq = options?.minAreaSq ?? 1e-12;
  const position = geometry.getAttribute("position");
  const vertices: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    vertices.push(position.getX(i), position.getY(i), position.getZ(i));
  }
  const sourceIndices: number[] = [];
  const indexAttr = geometry.getIndex();
  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i += 1) {
      sourceIndices.push(indexAttr.getX(i));
    }
  } else {
    for (let i = 0; i < position.count; i += 1) {
      sourceIndices.push(i);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i + 2 < sourceIndices.length; i += 3) {
    const ia = sourceIndices[i]!;
    const ib = sourceIndices[i + 1]!;
    const ic = sourceIndices[i + 2]!;
    if (ia < 0 || ib < 0 || ic < 0) {
      continue;
    }
    const aBase = ia * 3;
    const bBase = ib * 3;
    const cBase = ic * 3;
    const ax = vertices[aBase];
    const ay = vertices[aBase + 1];
    const az = vertices[aBase + 2];
    const bx = vertices[bBase];
    const by = vertices[bBase + 1];
    const bz = vertices[bBase + 2];
    const cx = vertices[cBase];
    const cy = vertices[cBase + 1];
    const cz = vertices[cBase + 2];
    if (
      !Number.isFinite(ax) ||
      !Number.isFinite(ay) ||
      !Number.isFinite(az) ||
      !Number.isFinite(bx) ||
      !Number.isFinite(by) ||
      !Number.isFinite(bz) ||
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(cz)
    ) {
      continue;
    }
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    const areaSq = crossX * crossX + crossY * crossY + crossZ * crossZ;
    if (areaSq <= minAreaSq) {
      continue;
    }
    indices.push(ia, ib, ic);
    if (doubleSided) {
      indices.push(ia, ic, ib);
    }
  }
  return new CANNON.Trimesh(vertices, indices);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function computeContainmentHalfX(trackWidth: number): number {
  return Math.max(0, trackWidth / 2 - RAIL_INSET - RAIL_THICK / 2 - MARBLE_RADIUS - 0.02);
}

type BlueprintSweepSample = {
  center: THREE.Vector3;
  width: number;
  railLeft: boolean;
  railRight: boolean;
  tunnelRoof: boolean;
};

type BlueprintSweepFrame = {
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
};

type SweepRect = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type BlueprintColliderMode = "primitive" | "trimesh";

type BlueprintSweepPath = {
  samples: BlueprintSweepSample[];
  finishStart: THREE.Vector3;
  finishDirection: THREE.Vector3;
};

type BlueprintSweepDistanceLookup = {
  cumulativeDistances: number[];
  totalLength: number;
};

type BlueprintSweepPose = {
  center: THREE.Vector3;
  width: number;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
};

function toTuple(point: THREE.Vector3): [number, number, number] {
  return [point.x, point.y, point.z];
}

function getPlacementVectors(points: Array<[number, number, number]>): THREE.Vector3[] {
  return points.map((point) => new THREE.Vector3(point[0], point[1], point[2]));
}

function resamplePolyline(points: THREE.Vector3[], step: number): THREE.Vector3[] {
  if (points.length <= 1) {
    return points.map((point) => point.clone());
  }
  const out: THREE.Vector3[] = [points[0]!.clone()];
  let distanceSinceLast = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i]!;
    const end = points[i + 1]!;
    const delta = end.clone().sub(start);
    const segmentLength = delta.length();
    if (segmentLength <= 1e-5) {
      continue;
    }
    const direction = delta.multiplyScalar(1 / segmentLength);
    let traveled = 0;
    while (distanceSinceLast + (segmentLength - traveled) >= step) {
      const needed = step - distanceSinceLast;
      traveled += needed;
      out.push(start.clone().addScaledVector(direction, traveled));
      distanceSinceLast = 0;
    }
    distanceSinceLast += segmentLength - traveled;
  }
  const tail = points[points.length - 1]!;
  const lastOut = out[out.length - 1]!;
  if (lastOut.distanceToSquared(tail) > 1e-4) {
    out.push(tail.clone());
  }
  return out;
}

function buildBlueprintSweepSamples(
  placements: TrackBlueprint["placements"],
  step: number,
): BlueprintSweepSample[] {
  const out: BlueprintSweepSample[] = [];
  for (const placement of placements) {
    const points = getPlacementVectors(placement.points);
    if (points.length < 2) {
      continue;
    }
    const sampled = resamplePolyline(points, step);
    for (const point of sampled) {
      const last = out[out.length - 1];
      if (last && last.center.distanceToSquared(point) <= 1e-4) {
        continue;
      }
      out.push({
        center: point,
        width: placement.width,
        railLeft: placement.railLeft,
        railRight: placement.railRight,
        tunnelRoof: placement.tunnelRoof,
      });
    }
  }
  return out;
}

function buildBlueprintSweepFrames(samples: BlueprintSweepSample[]): BlueprintSweepFrame[] {
  const frames: BlueprintSweepFrame[] = [];
  const worldUp = new THREE.Vector3(0, 1, 0);
  const fallbackRight = new THREE.Vector3(1, 0, 0);
  let previousTangent = new THREE.Vector3(0, 0, 1);
  let previousRight = fallbackRight.clone();

  for (let i = 0; i < samples.length; i += 1) {
    const prevCenter = i > 0 ? samples[i - 1]!.center : samples[i]!.center;
    const nextCenter =
      i < samples.length - 1 ? samples[i + 1]!.center : samples[i]!.center;

    const tangent = nextCenter.clone().sub(prevCenter);
    if (tangent.lengthSq() <= 1e-8) {
      tangent.copy(previousTangent);
    } else {
      tangent.normalize();
    }

    const right = previousRight
      .clone()
      .sub(tangent.clone().multiplyScalar(previousRight.dot(tangent)));
    if (right.lengthSq() <= 1e-8) {
      right.copy(worldUp).cross(tangent);
    }
    if (right.lengthSq() <= 1e-8) {
      right
        .copy(fallbackRight)
        .sub(tangent.clone().multiplyScalar(fallbackRight.dot(tangent)));
    }
    if (right.lengthSq() <= 1e-8) {
      right.set(1, 0, 0);
    }
    right.normalize();
    if (right.dot(previousRight) < 0) {
      right.negate();
    }

    const up = tangent.clone().cross(right);
    if (up.lengthSq() <= 1e-8) {
      up.copy(worldUp);
    } else {
      up.normalize();
    }

    frames.push({ tangent, right, up });
    previousRight = right.clone();
    previousTangent = tangent.clone();
  }

  return frames;
}

function buildBlueprintSweepDistanceLookup(samples: BlueprintSweepSample[]): BlueprintSweepDistanceLookup {
  const cumulativeDistances: number[] = [0];
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]!.center;
    const next = samples[i]!.center;
    cumulativeDistances.push(cumulativeDistances[i - 1]! + prev.distanceTo(next));
  }
  return {
    cumulativeDistances,
    totalLength: cumulativeDistances[cumulativeDistances.length - 1] ?? 0,
  };
}

function sampleBlueprintSweepPoseAtDistance(
  samples: BlueprintSweepSample[],
  frames: BlueprintSweepFrame[],
  lookup: BlueprintSweepDistanceLookup,
  distance: number,
): BlueprintSweepPose | null {
  if (samples.length === 0 || frames.length !== samples.length) {
    return null;
  }
  if (samples.length === 1) {
    const sample = samples[0]!;
    const frame = frames[0]!;
    return {
      center: sample.center.clone(),
      width: sample.width,
      tangent: frame.tangent.clone(),
      right: frame.right.clone(),
      up: frame.up.clone(),
    };
  }

  const target = clamp(distance, 0, lookup.totalLength);
  const cumulative = lookup.cumulativeDistances;
  let upperIndex = cumulative.length - 1;
  for (let i = 1; i < cumulative.length; i += 1) {
    if (target <= cumulative[i]!) {
      upperIndex = i;
      break;
    }
  }

  const lowerIndex = Math.max(0, upperIndex - 1);
  const sampleA = samples[lowerIndex]!;
  const sampleB = samples[upperIndex]!;
  const frameA = frames[lowerIndex]!;
  const frameB = frames[upperIndex]!;
  const distA = cumulative[lowerIndex]!;
  const distB = cumulative[upperIndex]!;
  const span = Math.max(distB - distA, 1e-6);
  const alpha = clamp((target - distA) / span, 0, 1);

  const center = sampleA.center.clone().lerp(sampleB.center, alpha);
  const width = lerp(sampleA.width, sampleB.width, alpha);

  const tangent = frameA.tangent.clone().lerp(frameB.tangent, alpha);
  if (tangent.lengthSq() <= 1e-8) {
    tangent.copy(frameA.tangent);
  }
  tangent.normalize();

  const right = frameA.right.clone().lerp(frameB.right, alpha);
  right.addScaledVector(tangent, -right.dot(tangent));
  if (right.lengthSq() <= 1e-8) {
    right.copy(frameA.right);
  }
  right.normalize();

  const up = tangent.clone().cross(right);
  if (up.lengthSq() <= 1e-8) {
    up.copy(frameA.up);
  } else {
    up.normalize();
  }
  if (up.dot(frameA.up) < 0) {
    up.negate();
    right.negate();
  }

  return {
    center,
    width,
    tangent,
    right,
    up,
  };
}

type RoundedObstacleCornerRadii = {
  bottomLeft: number;
  bottomRight: number;
  topRight: number;
  topLeft: number;
};

function normalizeRoundedRectRadii(
  width: number,
  depth: number,
  radii: RoundedObstacleCornerRadii,
): RoundedObstacleCornerRadii {
  const maxRadius = Math.max(0, Math.min(width, depth) * 0.5 - 1e-4);
  let bottomLeft = clamp(radii.bottomLeft, 0, maxRadius);
  let bottomRight = clamp(radii.bottomRight, 0, maxRadius);
  let topRight = clamp(radii.topRight, 0, maxRadius);
  let topLeft = clamp(radii.topLeft, 0, maxRadius);

  const scalePair = (a: number, b: number, maxSum: number): [number, number] => {
    const sum = a + b;
    if (sum <= maxSum || sum <= 1e-6) {
      return [a, b];
    }
    const scale = maxSum / sum;
    return [a * scale, b * scale];
  };

  [bottomLeft, bottomRight] = scalePair(bottomLeft, bottomRight, width);
  [topLeft, topRight] = scalePair(topLeft, topRight, width);
  [bottomLeft, topLeft] = scalePair(bottomLeft, topLeft, depth);
  [bottomRight, topRight] = scalePair(bottomRight, topRight, depth);

  return { bottomLeft, bottomRight, topRight, topLeft };
}

function createRoundedObstacleGeometry(
  width: number,
  height: number,
  depth: number,
  radii: RoundedObstacleCornerRadii,
): THREE.ExtrudeGeometry {
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const normalized = normalizeRoundedRectRadii(width, depth, radii);

  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + normalized.bottomLeft, -halfDepth);
  shape.lineTo(halfWidth - normalized.bottomRight, -halfDepth);
  if (normalized.bottomRight > 0) {
    shape.absarc(
      halfWidth - normalized.bottomRight,
      -halfDepth + normalized.bottomRight,
      normalized.bottomRight,
      -Math.PI / 2,
      0,
      false,
    );
  } else {
    shape.lineTo(halfWidth, -halfDepth);
  }
  shape.lineTo(halfWidth, halfDepth - normalized.topRight);
  if (normalized.topRight > 0) {
    shape.absarc(
      halfWidth - normalized.topRight,
      halfDepth - normalized.topRight,
      normalized.topRight,
      0,
      Math.PI / 2,
      false,
    );
  } else {
    shape.lineTo(halfWidth, halfDepth);
  }
  shape.lineTo(-halfWidth + normalized.topLeft, halfDepth);
  if (normalized.topLeft > 0) {
    shape.absarc(
      -halfWidth + normalized.topLeft,
      halfDepth - normalized.topLeft,
      normalized.topLeft,
      Math.PI / 2,
      Math.PI,
      false,
    );
  } else {
    shape.lineTo(-halfWidth, halfDepth);
  }
  shape.lineTo(-halfWidth, -halfDepth + normalized.bottomLeft);
  if (normalized.bottomLeft > 0) {
    shape.absarc(
      -halfWidth + normalized.bottomLeft,
      -halfDepth + normalized.bottomLeft,
      normalized.bottomLeft,
      Math.PI,
      Math.PI * 1.5,
      false,
    );
  } else {
    shape.lineTo(-halfWidth, -halfDepth);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: BLUEPRINT_OBSTACLE_CORNER_CURVE_SEGMENTS,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, height * 0.5, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function selectBlueprintObstaclePieceIds(
  placements: TrackBlueprint["placements"],
  seed: string,
  safeStartStraightCount: number,
): Set<string> {
  const eligible = placements
    .filter(
      (placement) =>
        placement.kind === "straight" &&
        !placement.isCompensatingTurn &&
        placement.points.length >= 2,
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  if (eligible.length === 0) {
    return new Set();
  }

  const mainLaneEligible = eligible.filter((placement) => placement.lane === "main");
  const spawnSafetySource = mainLaneEligible.length > 0 ? mainLaneEligible : eligible;
  const protectedStartIds = new Set(
    spawnSafetySource
      .slice(0, safeStartStraightCount)
      .map((placement) => placement.id),
  );
  const selectionPool = eligible.filter((placement) => !protectedStartIds.has(placement.id));
  if (selectionPool.length === 0) {
    return new Set();
  }

  const targetCount = Math.max(
    0,
    Math.min(
      selectionPool.length,
      Math.round(selectionPool.length * BLUEPRINT_SET_PIECE_OBSTACLE_RATE),
    ),
  );
  if (targetCount === 0) {
    return new Set();
  }

  const shuffled = [...selectionPool];
  const random = makeSeededRandom(`${seed}|blueprint-piece-obstacles-v2`);
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = swap;
  }

  return new Set(shuffled.slice(0, targetCount).map((placement) => placement.id));
}

function addBlueprintPieceSetObstacles(params: {
  group: THREE.Group;
  boardWallBody: CANNON.Body;
  placements: TrackBlueprint["placements"];
  seed: string;
  material: THREE.Material;
  safeStartStraightCount?: number;
}): void {
  const { group, boardWallBody, placements, seed, material } = params;
  const safeStartStraightCount = Math.max(
    0,
    Math.floor(params.safeStartStraightCount ?? BLUEPRINT_SET_PIECE_SAFE_START_MAIN_COUNT),
  );
  const selectedPieceIds = selectBlueprintObstaclePieceIds(
    placements,
    seed,
    safeStartStraightCount,
  );
  if (selectedPieceIds.size === 0) {
    return;
  }

  const minGap = MARBLE_RADIUS * 2 * BLUEPRINT_SET_PIECE_MIN_CLEARANCE_MULTIPLIER;
  const gateGap = clamp(
    MARBLE_RADIUS * 2 * BLUEPRINT_SET_PIECE_GATE_CLEARANCE_MULTIPLIER,
    minGap,
    MARBLE_RADIUS * 2 * BLUEPRINT_SET_PIECE_GATE_CLEARANCE_MAX_MULTIPLIER,
  );
  const obstacleHeight = BLUEPRINT_SET_PIECE_OBSTACLE_HEIGHT;
  const obstacleDepth = Math.max(RAIL_THICK * 1.25, 0.44);
  const verticalOffset = obstacleHeight * 0.5 + 0.015;
  const innerInset = RAIL_INSET + RAIL_THICK + 0.15;

  const basis = new THREE.Matrix4();
  const rotation = new THREE.Euler(0, 0, 0, "XYZ");
  const localQuat = new CANNON.Quaternion();

  const addObstacleAtPose = (
    pose: BlueprintSweepPose,
    centerX: number,
    width: number,
    depth = obstacleDepth,
    flushLeft = false,
    flushRight = false,
  ): void => {
    if (width <= 0.2 || depth <= 0.2) {
      return;
    }
    basis.makeBasis(pose.right, pose.up, pose.tangent);
    const quat = new THREE.Quaternion().setFromRotationMatrix(basis);
    rotation.setFromQuaternion(quat, "XYZ");
    const center = pose.center
      .clone()
      .addScaledVector(pose.right, centerX)
      .addScaledVector(pose.up, verticalOffset);

    const innerHalf = Math.max(1.4, pose.width * 0.5 - innerInset);
    const leftEdge = centerX - width * 0.5;
    const rightEdge = centerX + width * 0.5;
    const touchingLeftWall = flushLeft || leftEdge <= -innerHalf + BLUEPRINT_OBSTACLE_WALL_TOUCH_EPSILON;
    const touchingRightWall =
      flushRight || rightEdge >= innerHalf - BLUEPRINT_OBSTACLE_WALL_TOUCH_EPSILON;
    const cornerRadius = clamp(
      Math.min(width, depth) * BLUEPRINT_OBSTACLE_CORNER_RADIUS_SCALE,
      BLUEPRINT_OBSTACLE_CORNER_RADIUS_MIN,
      BLUEPRINT_OBSTACLE_CORNER_RADIUS_MAX,
    );
    const geometry = createRoundedObstacleGeometry(width, obstacleHeight, depth, {
      bottomLeft: touchingLeftWall ? 0 : cornerRadius,
      topLeft: touchingLeftWall ? 0 : cornerRadius,
      bottomRight: touchingRightWall ? 0 : cornerRadius,
      topRight: touchingRightWall ? 0 : cornerRadius,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);
    mesh.rotation.set(rotation.x, rotation.y, rotation.z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const edgeLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x3d0b0b }),
    );
    edgeLines.scale.set(1.002, 1.002, 1.002);
    mesh.add(edgeLines);
    group.add(mesh);

    localQuat.set(quat.x, quat.y, quat.z, quat.w);
    boardWallBody.addShape(
      geometryToTrimesh(geometry),
      new CANNON.Vec3(center.x, center.y, center.z),
      localQuat,
    );
  };

  for (const placement of placements) {
    if (!selectedPieceIds.has(placement.id)) {
      continue;
    }
    if (placement.kind !== "straight") {
      continue;
    }

    const pieceSamples = buildBlueprintSweepSamples([placement], BLUEPRINT_RENDER_SAMPLE_STEP);
    const pieceFrames = buildBlueprintSweepFrames(pieceSamples);
    if (pieceSamples.length < 3 || pieceFrames.length !== pieceSamples.length) {
      continue;
    }
    const lookup = buildBlueprintSweepDistanceLookup(pieceSamples);
    if (lookup.totalLength < BLUEPRINT_SET_PIECE_MIN_LENGTH) {
      continue;
    }

    const edgePadding = clamp(lookup.totalLength * 0.2, 1.4, 2.4);
    const startDistance = edgePadding;
    const endDistance = lookup.totalLength - edgePadding;
    const setPieceSpan = endDistance - startDistance;
    if (setPieceSpan < 5.8) {
      continue;
    }
    const spacing = setPieceSpan / (BLUEPRINT_SET_PIECE_S_PATTERN_COUNT - 1);
    const distances = Array.from({ length: BLUEPRINT_SET_PIECE_S_PATTERN_COUNT }, (_, index) => {
      return startDistance + spacing * index;
    });

    const withPose = (distance: number, handler: (pose: BlueprintSweepPose) => void): void => {
      const pose = sampleBlueprintSweepPoseAtDistance(pieceSamples, pieceFrames, lookup, distance);
      if (pose) {
        handler(pose);
      }
    };

    const placeCenteredGate = (distance: number, gap: number, gapOffset = 0): void => {
      withPose(distance, (pose) => {
        const innerHalf = Math.max(1.4, pose.width * 0.5 - innerInset);
        const traversableWidth = innerHalf * 2;
        const clampedGap = clamp(gap, minGap, Math.max(minGap, traversableWidth - 0.8));
        const minOffset = -innerHalf + clampedGap * 0.5 + 0.22;
        const maxOffset = innerHalf - clampedGap * 0.5 - 0.22;
        const safeOffset = clamp(gapOffset, minOffset, maxOffset);
        const leftInnerX = safeOffset - clampedGap * 0.5;
        const rightInnerX = safeOffset + clampedGap * 0.5;
        const leftWidth = leftInnerX + innerHalf;
        const rightWidth = innerHalf - rightInnerX;
        if (leftWidth > 0.28) {
          addObstacleAtPose(pose, -innerHalf + leftWidth * 0.5, leftWidth, obstacleDepth, true, false);
        }
        if (rightWidth > 0.28) {
          addObstacleAtPose(pose, rightInnerX + rightWidth * 0.5, rightWidth, obstacleDepth, false, true);
        }
      });
    };

    const placeWallJut = (distance: number, side: -1 | 1, protrusion: number): void => {
      withPose(distance, (pose) => {
        const innerHalf = Math.max(1.4, pose.width * 0.5 - innerInset);
        const maxProtrusion = Math.max(0.8, innerHalf * 2 - minGap - 0.45);
        const width = clamp(protrusion, 0.75, maxProtrusion);
        if (side < 0) {
          const minX = -innerHalf;
          addObstacleAtPose(pose, minX + width * 0.5, width, obstacleDepth, true, false);
        } else {
          const maxX = innerHalf;
          addObstacleAtPose(pose, maxX - width * 0.5, width, obstacleDepth, false, true);
        }
      });
    };

    const placeMiddleBlock = (distance: number, width: number, offset = 0): void => {
      withPose(distance, (pose) => {
        const innerHalf = Math.max(1.4, pose.width * 0.5 - innerInset);
        const maxWidth = Math.max(0.8, innerHalf * 2 - minGap * 2);
        const clampedWidth = clamp(width, 0.75, maxWidth);
        const half = clampedWidth * 0.5;
        const minCenter = -innerHalf + minGap + half;
        const maxCenter = innerHalf - minGap - half;
        if (maxCenter <= minCenter) {
          return;
        }
        addObstacleAtPose(pose, clamp(offset, minCenter, maxCenter), clampedWidth);
      });
    };

    // Single obstacle-piece style: custom-obstacle-S.
    placeCenteredGate(distances[0]!, gateGap);
    placeWallJut(distances[1]!, -1, TRACK_W * 0.32);
    placeMiddleBlock(distances[2]!, TRACK_W * 0.28);
    placeWallJut(distances[3]!, 1, TRACK_W * 0.34);
    placeCenteredGate(distances[4]!, gateGap + 0.08, -0.85);
    placeWallJut(distances[5]!, -1, TRACK_W * 0.26);
    placeMiddleBlock(distances[6]!, TRACK_W * 0.24, 0.78);
    placeCenteredGate(distances[7]!, gateGap);
  }
}

function toSweepWorldPoint(
  sample: BlueprintSweepSample,
  frame: BlueprintSweepFrame,
  localX: number,
  localY: number,
): THREE.Vector3 {
  return sample.center
    .clone()
    .addScaledVector(frame.right, localX)
    .addScaledVector(frame.up, localY);
}

function buildSweptRectGeometry(
  samples: BlueprintSweepSample[],
  frames: BlueprintSweepFrame[],
  resolveRect: (sample: BlueprintSweepSample) => SweepRect | null,
): THREE.BufferGeometry | null {
  if (samples.length < 2 || frames.length !== samples.length) {
    return null;
  }

  const rects = samples.map((sample) => resolveRect(sample));
  const vertices: number[] = [];
  const indices: number[] = [];

  const pushVertex = (point: THREE.Vector3): number => {
    vertices.push(point.x, point.y, point.z);
    return vertices.length / 3 - 1;
  };

  const pushQuad = (
    a0: THREE.Vector3,
    a1: THREE.Vector3,
    b1: THREE.Vector3,
    b0: THREE.Vector3,
  ): void => {
    const i0 = pushVertex(a0);
    const i1 = pushVertex(a1);
    const i2 = pushVertex(b1);
    const i3 = pushVertex(b0);
    indices.push(i0, i1, i2, i0, i2, i3);
  };

  const getCorner = (
    sample: BlueprintSweepSample,
    frame: BlueprintSweepFrame,
    rect: SweepRect,
    corner: 0 | 1 | 2 | 3,
  ): THREE.Vector3 => {
    switch (corner) {
      case 0:
        return toSweepWorldPoint(sample, frame, rect.minX, rect.minY);
      case 1:
        return toSweepWorldPoint(sample, frame, rect.maxX, rect.minY);
      case 2:
        return toSweepWorldPoint(sample, frame, rect.maxX, rect.maxY);
      default:
        return toSweepWorldPoint(sample, frame, rect.minX, rect.maxY);
    }
  };

  const pushCap = (
    sample: BlueprintSweepSample,
    frame: BlueprintSweepFrame,
    rect: SweepRect,
  ): void => {
    const c0 = getCorner(sample, frame, rect, 0);
    const c1 = getCorner(sample, frame, rect, 1);
    const c2 = getCorner(sample, frame, rect, 2);
    const c3 = getCorner(sample, frame, rect, 3);
    const i0 = pushVertex(c0);
    const i1 = pushVertex(c1);
    const i2 = pushVertex(c2);
    const i3 = pushVertex(c3);
    indices.push(i0, i1, i2, i0, i2, i3);
  };

  for (let i = 0; i < samples.length - 1; i += 1) {
    const rectA = rects[i];
    const rectB = rects[i + 1];
    if (!rectA || !rectB) {
      continue;
    }
    const sampleA = samples[i]!;
    const sampleB = samples[i + 1]!;
    const frameA = frames[i]!;
    const frameB = frames[i + 1]!;

    const a0 = getCorner(sampleA, frameA, rectA, 0);
    const a1 = getCorner(sampleA, frameA, rectA, 1);
    const a2 = getCorner(sampleA, frameA, rectA, 2);
    const a3 = getCorner(sampleA, frameA, rectA, 3);

    const b0 = getCorner(sampleB, frameB, rectB, 0);
    const b1 = getCorner(sampleB, frameB, rectB, 1);
    const b2 = getCorner(sampleB, frameB, rectB, 2);
    const b3 = getCorner(sampleB, frameB, rectB, 3);

    pushQuad(a0, a1, b1, b0);
    pushQuad(a1, a2, b2, b1);
    pushQuad(a2, a3, b3, b2);
    pushQuad(a3, a0, b0, b3);

    const hasPrevSpan = i > 0 && rects[i - 1] != null;
    if (!hasPrevSpan) {
      pushCap(sampleA, frameA, rectA);
    }

    const hasNextSpan = i + 2 < samples.length && rects[i + 2] != null;
    if (!hasNextSpan) {
      pushCap(sampleB, frameB, rectB);
    }
  }

  if (indices.length === 0) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildBlueprintSweepPath(
  placements: TrackBlueprint["placements"],
  sampleStep: number,
  startPoint: THREE.Vector3,
): BlueprintSweepPath {
  const samples = buildBlueprintSweepSamples(placements, sampleStep);
  if (samples.length === 0) {
    const fallbackEnd = startPoint.clone().add(new THREE.Vector3(0, 0, 28));
    for (const point of resamplePolyline([startPoint, fallbackEnd], sampleStep)) {
      samples.push({
        center: point,
        width: TRACK_W,
        railLeft: true,
        railRight: true,
        tunnelRoof: false,
      });
    }
  }

  const lastPlayable = samples[samples.length - 1]!;
  const prevPlayable = samples.length >= 2 ? samples[samples.length - 2]! : null;
  const finishDirection = (prevPlayable
    ? lastPlayable.center.clone().sub(prevPlayable.center)
    : new THREE.Vector3(0, 0, 1)
  ).normalize();
  if (finishDirection.lengthSq() <= 1e-8) {
    finishDirection.set(0, 0, 1);
  }
  const finishStart = lastPlayable.center.clone();
  const finishPoints = resamplePolyline(
    [finishStart, finishStart.clone().addScaledVector(finishDirection, FINISH_LENGTH)],
    sampleStep,
  );
  for (let i = 1; i < finishPoints.length; i += 1) {
    samples.push({
      center: finishPoints[i]!,
      width: FINISH_WIDTH,
      railLeft: true,
      railRight: true,
      tunnelRoof: false,
    });
  }

  return {
    samples,
    finishStart,
    finishDirection,
  };
}

function applyHeightVertexColors(
  geometry: THREE.BufferGeometry,
  lowColorHex: number,
  highColorHex: number,
): void {
  const position = geometry.getAttribute("position");
  const colorArray = new Float32Array(position.count * 3);
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return;
  }
  const range = Math.max(maxY - minY, 1e-5);
  const lowColor = new THREE.Color(lowColorHex);
  const highColor = new THREE.Color(highColorHex);
  const mixed = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const alpha = clamp((y - minY) / range, 0, 1);
    mixed.copy(lowColor).lerp(highColor, alpha);
    const base = i * 3;
    colorArray[base] = mixed.r;
    colorArray[base + 1] = mixed.g;
    colorArray[base + 2] = mixed.b;
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colorArray, 3));
}

function countBodyShapes(bodies: CANNON.Body[]): number {
  let total = 0;
  for (const body of bodies) {
    total += body.shapes.length;
  }
  return total;
}

function addBlueprintPrimitiveColliders(
  boardBody: CANNON.Body,
  boardWallBody: CANNON.Body,
  samples: BlueprintSweepSample[],
  frames: BlueprintSweepFrame[],
): { colliderPieceCount: number; primitiveShapeCount: number } {
  if (samples.length < 2 || frames.length !== samples.length) {
    return { colliderPieceCount: 0, primitiveShapeCount: 0 };
  }

  let colliderPieceCount = 0;
  let primitiveShapeCount = 0;
  const worldUp = new THREE.Vector3(0, 1, 0);
  const spanDelta = new THREE.Vector3();
  const spanCenter = new THREE.Vector3();
  const spanTangent = new THREE.Vector3();
  const spanRight = new THREE.Vector3();
  const spanUp = new THREE.Vector3();
  const orientedQuat = new THREE.Quaternion();
  const orientedBasis = new THREE.Matrix4();
  const floorCenter = new THREE.Vector3();
  const railCenter = new THREE.Vector3();
  const roofCenter = new THREE.Vector3();

  const addSpanBox = (center: THREE.Vector3, halfExtents: THREE.Vector3): void => {
    primitiveShapeCount += 1;
    boardBody.addShape(
      new CANNON.Box(new CANNON.Vec3(halfExtents.x, halfExtents.y, halfExtents.z)),
      new CANNON.Vec3(center.x, center.y, center.z),
      new CANNON.Quaternion(
        orientedQuat.x,
        orientedQuat.y,
        orientedQuat.z,
        orientedQuat.w,
      ),
    );
  };

  const addSpanBoxWall = (center: THREE.Vector3, halfExtents: THREE.Vector3): void => {
    primitiveShapeCount += 1;
    boardWallBody.addShape(
      new CANNON.Box(new CANNON.Vec3(halfExtents.x, halfExtents.y, halfExtents.z)),
      new CANNON.Vec3(center.x, center.y, center.z),
      new CANNON.Quaternion(orientedQuat.x, orientedQuat.y, orientedQuat.z, orientedQuat.w),
    );
  };

  const floorHalfExtents = new THREE.Vector3();
  const leftRailHalfExtents = new THREE.Vector3();
  const rightRailHalfExtents = new THREE.Vector3();
  const roofHalfExtents = new THREE.Vector3();

  for (let i = 0; i < samples.length - 1; i += 1) {
    const sampleA = samples[i]!;
    const sampleB = samples[i + 1]!;
    const frameA = frames[i]!;
    const frameB = frames[i + 1]!;

    spanDelta.copy(sampleB.center).sub(sampleA.center);
    const spanLength = spanDelta.length();
    if (spanLength <= 0.08) {
      continue;
    }
    colliderPieceCount += 1;
    spanTangent.copy(spanDelta).multiplyScalar(1 / spanLength);

    spanRight.copy(frameA.right).add(frameB.right);
    if (spanRight.lengthSq() <= 1e-8) {
      spanRight.copy(frameA.right);
    }
    spanRight.addScaledVector(spanTangent, -spanRight.dot(spanTangent));
    if (spanRight.lengthSq() <= 1e-8) {
      spanRight.copy(worldUp).cross(spanTangent);
    }
    if (spanRight.lengthSq() <= 1e-8) {
      spanRight.set(1, 0, 0);
    }
    spanRight.normalize();

    spanUp.copy(spanTangent).cross(spanRight);
    if (spanUp.lengthSq() <= 1e-8) {
      spanUp.copy(frameA.up);
    } else {
      spanUp.normalize();
    }
    if (spanUp.dot(frameA.up) < 0) {
      spanUp.negate();
      spanRight.negate();
    }

    orientedBasis.makeBasis(spanRight, spanUp, spanTangent);
    orientedQuat.setFromRotationMatrix(orientedBasis);
    spanCenter.copy(sampleA.center).add(sampleB.center).multiplyScalar(0.5);

    const spanWidth = Math.max(2.8, (sampleA.width + sampleB.width) * 0.5);
    const spanHalfLength = spanLength * 0.5 + COLLIDER_SPAN_OVERLAP_Z;

    floorHalfExtents.set(
      spanWidth * 0.5 + COLLIDER_LATERAL_PADDING_X,
      FLOOR_THICK * 0.5,
      spanHalfLength,
    );
    floorCenter
      .copy(spanCenter)
      .addScaledVector(spanUp, -FLOOR_THICK * 0.5);
    addSpanBox(floorCenter, floorHalfExtents);

    const sideOffset = spanWidth / 2 - RAIL_INSET;
    const railCenterYOffset = -FLOOR_THICK + RAIL_FLOOR_OVERLAP + RAIL_H * 0.5;
    if (sampleA.railLeft || sampleB.railLeft) {
      leftRailHalfExtents.set(
        RAIL_THICK * 0.5 + COLLIDER_LATERAL_PADDING_X,
        RAIL_H * 0.5,
        spanHalfLength,
      );
      railCenter
        .copy(spanCenter)
        .addScaledVector(spanRight, -sideOffset)
        .addScaledVector(spanUp, railCenterYOffset);
      addSpanBoxWall(railCenter, leftRailHalfExtents);
    }
    if (sampleA.railRight || sampleB.railRight) {
      rightRailHalfExtents.set(
        RAIL_THICK * 0.5 + COLLIDER_LATERAL_PADDING_X,
        RAIL_H * 0.5,
        spanHalfLength,
      );
      railCenter
        .copy(spanCenter)
        .addScaledVector(spanRight, sideOffset)
        .addScaledVector(spanUp, railCenterYOffset);
      addSpanBoxWall(railCenter, rightRailHalfExtents);
    }

    if (sampleA.tunnelRoof || sampleB.tunnelRoof) {
      const roofInset = Math.max(RAIL_THICK * 0.75, 0.25);
      const roofWidth = spanWidth - roofInset * 2;
      if (roofWidth > 0.15) {
        const railBottom = -FLOOR_THICK + RAIL_FLOOR_OVERLAP;
        const railTop = railBottom + RAIL_H;
        const roofBottom = railTop - 0.2;
        const roofHeight = 0.45;
        roofHalfExtents.set(roofWidth * 0.5, roofHeight * 0.5, spanHalfLength);
        roofCenter
          .copy(spanCenter)
          .addScaledVector(spanUp, roofBottom + roofHeight * 0.5);
        addSpanBoxWall(roofCenter, roofHalfExtents);
      }
    }
  }

  return {
    colliderPieceCount,
    primitiveShapeCount,
  };
}

function createTrackFromBlueprint(
  blueprint: TrackBlueprint,
  obstacleSettings?: CreateTrackOptions["blueprintObstacleSettings"],
): TrackBuildResult {
  const group = new THREE.Group();
  group.name = "track";

  const boardBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
  boardBody.position.set(0, 0, 0);
  boardBody.quaternion.set(0, 0, 0, 1);

  const boardWallBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
  boardWallBody.position.set(0, 0, 0);
  boardWallBody.quaternion.set(0, 0, 0, 1);

  const trackSurfaceTexture = createTrackSurfaceTexture();
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: trackSurfaceTexture,
    color: 0xffffff,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    map: trackSurfaceTexture,
    color: 0xe7f0f5,
    transparent: true,
    opacity: 0.56,
    side: THREE.DoubleSide,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    map: trackSurfaceTexture,
    color: 0xf2e7cd,
    side: THREE.DoubleSide,
  });
  const guideMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe08a,
    emissive: 0x39290b,
    emissiveIntensity: 0.45,
    roughness: 0.42,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const startMarkerMaterial = new THREE.MeshStandardMaterial({ color: 0x66bb6a });
  const finishMarkerMaterial = new THREE.MeshStandardMaterial({ color: 0xef5350 });
  const setPieceObstacleMaterial = new THREE.MeshStandardMaterial({
    color: 0xd54747,
    roughness: 0.42,
    metalness: 0.04,
    transparent: true,
    opacity: 0.88,
  });

  const startTopBackPoint = new THREE.Vector3(0, FLOOR_THICK / 2, -START_LENGTH / 2);
  const sourcePlacements = (() => {
    const mainLane = blueprint.placements.filter((placement) => placement.lane === "main");
    return mainLane.length > 0 ? mainLane : blueprint.placements;
  })();
  const renderPath = buildBlueprintSweepPath(
    sourcePlacements,
    BLUEPRINT_RENDER_SAMPLE_STEP,
    startTopBackPoint,
  );
  const colliderPath = buildBlueprintSweepPath(
    sourcePlacements,
    BLUEPRINT_COLLIDER_SAMPLE_STEP,
    startTopBackPoint,
  );
  const samples = renderPath.samples;
  const finishDirection = renderPath.finishDirection;
  const finishStart = renderPath.finishStart;
  const frames = buildBlueprintSweepFrames(samples);
  const colliderSamples = colliderPath.samples;
  const colliderFrames = buildBlueprintSweepFrames(colliderSamples);

  const floorGeometry = buildSweptRectGeometry(samples, frames, (sample) => ({
    minX: -sample.width / 2,
    maxX: sample.width / 2,
    minY: -FLOOR_THICK,
    maxY: 0,
  }));
  if (floorGeometry) {
    applyHeightVertexColors(floorGeometry, 0x7a8ea0, 0xe9f3f7);
  }
  const leftRailGeometry = buildSweptRectGeometry(samples, frames, (sample) => {
    if (!sample.railLeft) {
      return null;
    }
    const sideOffset = sample.width / 2 - RAIL_INSET;
    const railBottom = -FLOOR_THICK + RAIL_FLOOR_OVERLAP;
    return {
      minX: -sideOffset - RAIL_THICK / 2,
      maxX: -sideOffset + RAIL_THICK / 2,
      minY: railBottom,
      maxY: railBottom + RAIL_H,
    };
  });
  const rightRailGeometry = buildSweptRectGeometry(samples, frames, (sample) => {
    if (!sample.railRight) {
      return null;
    }
    const sideOffset = sample.width / 2 - RAIL_INSET;
    const railBottom = -FLOOR_THICK + RAIL_FLOOR_OVERLAP;
    return {
      minX: sideOffset - RAIL_THICK / 2,
      maxX: sideOffset + RAIL_THICK / 2,
      minY: railBottom,
      maxY: railBottom + RAIL_H,
    };
  });
  const roofGeometry = buildSweptRectGeometry(samples, frames, (sample) => {
    if (!sample.tunnelRoof) {
      return null;
    }
    const roofInset = Math.max(RAIL_THICK * 0.75, 0.25);
    const minX = -sample.width / 2 + roofInset;
    const maxX = sample.width / 2 - roofInset;
    if (maxX - minX < 0.15) {
      return null;
    }
    const railBottom = -FLOOR_THICK + RAIL_FLOOR_OVERLAP;
    const railTop = railBottom + RAIL_H;
    const roofBottom = railTop - 0.2;
    return {
      minX,
      maxX,
      minY: roofBottom,
      maxY: roofBottom + 0.45,
    };
  });

  const centerGuideGeometry = buildSweptRectGeometry(samples, frames, () => ({
    minX: -CENTER_GUIDE_HALF_WIDTH,
    maxX: CENTER_GUIDE_HALF_WIDTH,
    minY: 0.01,
    maxY: 0.04,
  }));

  const renderGeometries: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = [];
  if (floorGeometry) renderGeometries.push({ geometry: floorGeometry, material: floorMaterial });
  if (leftRailGeometry) renderGeometries.push({ geometry: leftRailGeometry, material: railMaterial });
  if (rightRailGeometry) renderGeometries.push({ geometry: rightRailGeometry, material: railMaterial });
  if (roofGeometry) renderGeometries.push({ geometry: roofGeometry, material: roofMaterial });
  if (centerGuideGeometry) {
    renderGeometries.push({ geometry: centerGuideGeometry, material: guideMaterial });
  }

  for (const entry of renderGeometries) {
    const mesh = new THREE.Mesh(entry.geometry, entry.material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  let colliderPieceCount = 0;
  let exoticTrimeshPieceCount = 0;
  if (BLUEPRINT_COLLIDER_MODE === "primitive") {
    const primitiveStats = addBlueprintPrimitiveColliders(
      boardBody,
      boardWallBody,
      colliderSamples,
      colliderFrames,
    );
    colliderPieceCount = primitiveStats.colliderPieceCount;
  } else {
    const colliderFloorGeometry = buildSweptRectGeometry(
      colliderSamples,
      colliderFrames,
      (sample) => ({
        minX: -sample.width / 2,
        maxX: sample.width / 2,
        minY: -FLOOR_THICK,
        maxY: 0,
      }),
    );
    const colliderLeftRailGeometry = buildSweptRectGeometry(
      colliderSamples,
      colliderFrames,
      (sample) => {
        if (!sample.railLeft) {
          return null;
        }
        const sideOffset = sample.width / 2 - RAIL_INSET;
        const railBottom = -FLOOR_THICK + RAIL_FLOOR_OVERLAP;
        return {
          minX: -sideOffset - RAIL_THICK / 2,
          maxX: -sideOffset + RAIL_THICK / 2,
          minY: railBottom,
          maxY: railBottom + RAIL_H,
        };
      },
    );
    const colliderRightRailGeometry = buildSweptRectGeometry(
      colliderSamples,
      colliderFrames,
      (sample) => {
        if (!sample.railRight) {
          return null;
        }
        const sideOffset = sample.width / 2 - RAIL_INSET;
        const railBottom = -FLOOR_THICK + RAIL_FLOOR_OVERLAP;
        return {
          minX: sideOffset - RAIL_THICK / 2,
          maxX: sideOffset + RAIL_THICK / 2,
          minY: railBottom,
          maxY: railBottom + RAIL_H,
        };
      },
    );
    const colliderRoofGeometry = buildSweptRectGeometry(
      colliderSamples,
      colliderFrames,
      (sample) => {
        if (!sample.tunnelRoof) {
          return null;
        }
        const roofInset = Math.max(RAIL_THICK * 0.75, 0.25);
        const minX = -sample.width / 2 + roofInset;
        const maxX = sample.width / 2 - roofInset;
        if (maxX - minX < 0.15) {
          return null;
        }
        const railBottom = -FLOOR_THICK + RAIL_FLOOR_OVERLAP;
        const railTop = railBottom + RAIL_H;
        const roofBottom = railTop - 0.2;
        return {
          minX,
          maxX,
          minY: roofBottom,
          maxY: roofBottom + 0.45,
        };
      },
    );
    // Floor → boardBody (friction: contactFriction)
    if (colliderFloorGeometry) {
      const mergedFloor = mergeGeometries([colliderFloorGeometry], false);
      mergedFloor.computeVertexNormals();
      boardBody.addShape(geometryToTrimesh(mergedFloor));
      mergedFloor.dispose();
      colliderFloorGeometry.dispose();
    }
    // Rails + roof → boardWallBody (friction: 0)
    const wallGeometries = [
      colliderLeftRailGeometry,
      colliderRightRailGeometry,
      colliderRoofGeometry,
    ].filter((g): g is THREE.BufferGeometry => g != null);
    const mergedWalls = wallGeometries.length > 0 ? mergeGeometries(wallGeometries, false) : null;
    if (mergedWalls) {
      mergedWalls.computeVertexNormals();
      boardWallBody.addShape(geometryToTrimesh(mergedWalls));
      mergedWalls.dispose();
    }
    for (const g of wallGeometries) {
      g.dispose();
    }
    exoticTrimeshPieceCount = 1;
    colliderPieceCount = Math.max(colliderSamples.length - 1, 1);
  }

  const startBackWallWidth = TRACK_W - (RAIL_INSET * 2 + RAIL_THICK);
  const startBackWallY = RAIL_H / 2 - FLOOR_THICK / 2 + RAIL_FLOOR_OVERLAP;
  const startBackWallZ = startTopBackPoint.z + RAIL_THICK / 2 + START_BACK_WALL_PADDING;
  addPart(group, boardWallBody, {
    size: new THREE.Vector3(startBackWallWidth, RAIL_H, RAIL_THICK),
    position: new THREE.Vector3(0, startBackWallY, startBackWallZ),
    rotation: new THREE.Euler(0, 0, 0, "XYZ"),
    material: railMaterial,
    uvScale: [Math.max(startBackWallWidth * 0.3, 1), Math.max(RAIL_H, 1)],
  });

  const enableAutomaticObstacles = obstacleSettings?.enableAutomaticObstacles ?? false;
  if (enableAutomaticObstacles) {
    addBlueprintPieceSetObstacles({
      group,
      boardWallBody,
      placements: sourcePlacements,
      seed: blueprint.seed,
      material: setPieceObstacleMaterial,
      safeStartStraightCount: obstacleSettings?.safeStartStraightCount,
    });
  }

  let lowestFloorY = Number.POSITIVE_INFINITY;
  let minTrackX = Number.POSITIVE_INFINITY;
  let maxTrackX = Number.NEGATIVE_INFINITY;
  let minTrackZ = Number.POSITIVE_INFINITY;
  let maxTrackZ = Number.NEGATIVE_INFINITY;
  let maxSegmentWidth = TRACK_W;
  for (const sample of samples) {
    const halfWidth = sample.width / 2;
    maxSegmentWidth = Math.max(maxSegmentWidth, sample.width);
    lowestFloorY = Math.min(lowestFloorY, sample.center.y - FLOOR_THICK);
    minTrackX = Math.min(minTrackX, sample.center.x - halfWidth);
    maxTrackX = Math.max(maxTrackX, sample.center.x + halfWidth);
    minTrackZ = Math.min(minTrackZ, sample.center.z - halfWidth * 0.35);
    maxTrackZ = Math.max(maxTrackZ, sample.center.z + halfWidth * 0.35);
  }
  if (!Number.isFinite(lowestFloorY)) {
    lowestFloorY = startTopBackPoint.y - FLOOR_THICK;
  }
  if (!Number.isFinite(minTrackX)) {
    minTrackX = -FINISH_WIDTH / 2;
    maxTrackX = FINISH_WIDTH / 2;
    minTrackZ = startTopBackPoint.z;
    maxTrackZ = startTopBackPoint.z + FINISH_LENGTH + START_LENGTH;
  }

  const finishStartZ = finishStart.z;

  boardBody.aabbNeedsUpdate = true;
  boardBody.updateAABB();
  boardWallBody.aabbNeedsUpdate = true;
  boardWallBody.updateAABB();

  const spawnForward = frames[0]?.tangent ?? new THREE.Vector3(0, 0, 1);
  const spawnCenter = samples[0]?.center ?? startTopBackPoint;
  const spawn = spawnCenter
    .clone()
    .addScaledVector(spawnForward, 1.8)
    .add(new THREE.Vector3(0, MARBLE_RADIUS + 0.6, 0));
  const trialStartZ = spawn.z + 2;
  const trialFinishZ = finishStart.z + Math.max(FINISH_LENGTH * 0.6, 4);

  const finishYaw = Math.atan2(finishDirection.x, finishDirection.z);

  addVisualPart(group, {
    size: new THREE.Vector3(TRACK_W + 0.8, MARKER_THICK, 0.45),
    position: new THREE.Vector3(0, FLOOR_THICK / 2 + MARKER_THICK / 2 + 0.01, trialStartZ),
    rotation: new THREE.Euler(0, 0, 0, "XYZ"),
    material: startMarkerMaterial,
  });

  addVisualPart(group, {
    size: new THREE.Vector3(FINISH_WIDTH + 1.2, MARKER_THICK, 0.55),
    position: finishStart
      .clone()
      .addScaledVector(finishDirection, Math.max(FINISH_LENGTH * 0.58, 3.2))
      .add(new THREE.Vector3(0, MARKER_THICK / 2 + 0.01, 0)),
    rotation: new THREE.Euler(0, finishYaw, 0, "XYZ"),
    material: finishMarkerMaterial,
  });

  const offCourseBoundsLocal = {
    minX: minTrackX - OFF_COURSE_MARGIN,
    maxX: maxTrackX + OFF_COURSE_MARGIN,
    minZ: minTrackZ - OFF_COURSE_Z_MARGIN,
    maxZ: maxTrackZ + OFF_COURSE_Z_MARGIN,
  };
  const containmentPathLocal = colliderSamples.map((sample, index) => {
    const frame = colliderFrames[index]!;
    return {
      center: toTuple(sample.center),
      right: toTuple(frame.right),
      up: toTuple(frame.up),
      tangent: toTuple(frame.tangent),
      halfWidth: computeContainmentHalfX(sample.width),
      railLeft: sample.railLeft,
      railRight: sample.railRight,
    };
  });

  return {
    group,
    bodies: [boardBody, boardWallBody],
    wallBody: boardWallBody,
    movingObstacleBodies: [],
    containmentLocal: {
      mainHalfX: computeContainmentHalfX(maxSegmentWidth),
      finishHalfX: computeContainmentHalfX(Math.max(FINISH_WIDTH, maxSegmentWidth)),
      finishStartZ,
    },
    wallContainmentMode: "curvedPathClamp",
    containmentPathLocal,
    spawn: new CANNON.Vec3(spawn.x, spawn.y, spawn.z),
    respawnY: lowestFloorY - 6,
    offCourseBoundsLocal,
    trialStartZ,
    trialFinishZ,
    physicsDebug: {
      colliderPieceCount,
      primitiveShapeCount: countBodyShapes([boardBody, boardWallBody]),
      exoticTrimeshPieceCount,
      floorShapeCount: boardBody.shapes.length,
      wallShapeCount: boardWallBody.shapes.length,
      estimatedBoardWallShapeTestsPerStep: boardBody.shapes.length * boardWallBody.shapes.length,
    },
    updateMovingObstacles: () => {},
    setMovingObstacleMaterial: () => {},
  };
}

export function createTrack(opts?: CreateTrackOptions): TrackBuildResult {
  if (opts?.blueprint) {
    return createTrackFromBlueprint(opts.blueprint, opts.blueprintObstacleSettings);
  }

  const obstacleSeed = opts?.seed ?? DEFAULT_OBSTACLE_SEED;
  const obstacleRandom = makeSeededRandom(obstacleSeed);

  const group = new THREE.Group();
  group.name = "track";

  const boardBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
  boardBody.position.set(0, 0, 0);
  boardBody.quaternion.set(0, 0, 0, 1);

  const boardWallBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
  boardWallBody.position.set(0, 0, 0);
  boardWallBody.quaternion.set(0, 0, 0, 1);

  const trackSurfaceTexture = createTrackSurfaceTexture();
  const floorMaterial = new THREE.MeshStandardMaterial({ map: trackSurfaceTexture });
  const railMaterial = new THREE.MeshStandardMaterial({
    map: trackSurfaceTexture,
    color: 0xffffff,
    transparent: true,
    opacity: 0.35,
  });
  const startMarkerMaterial = new THREE.MeshStandardMaterial({ color: 0x66bb6a });
  const finishMarkerMaterial = new THREE.MeshStandardMaterial({ color: 0xef5350 });
  const obstacleMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.75,
    roughness: 0.4,
    metalness: 0.02,
  });

  let currentYawDeg = 0;
  let lowestFloorY = 0;

  const obstacleActors: ObstacleActor[] = [];
  const dynamicObstacleActors: ObstacleActor[] = [];
  const obstacleBodies: CANNON.Body[] = [];
  const movingObstacleBodies: CANNON.Body[] = [];

  const startTopBackPoint = new THREE.Vector3(0, FLOOR_THICK / 2, -START_LENGTH / 2);
  const startForward = new THREE.Vector3(0, 0, 1);
  const pathStartTopPoint = new THREE.Vector3(0, FLOOR_THICK / 2, -START_LENGTH / 2);

  const addSegment = ({
    length,
    slopeDeg,
    width = TRACK_W,
    railLeft = true,
    railRight = true,
  }: {
    length: number;
    slopeDeg: number;
    width?: number;
    railLeft?: boolean;
    railRight?: boolean;
  }) => {
    const rotation = new THREE.Euler(degToRad(slopeDeg), degToRad(currentYawDeg), 0, "XYZ");

    const forward = new THREE.Vector3(0, 0, 1).applyEuler(rotation).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyEuler(rotation).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyEuler(rotation).normalize();

    const segmentEndTopPoint = pathStartTopPoint.clone().addScaledVector(forward, length);
    const topCenter = pathStartTopPoint.clone().add(segmentEndTopPoint).multiplyScalar(0.5);
    const floorCenter = topCenter.clone().addScaledVector(up, -FLOOR_THICK / 2);

    addVisualPart(group, {
      size: new THREE.Vector3(width, FLOOR_THICK, length),
      position: floorCenter,
      rotation,
      material: floorMaterial,
      uvProjection: "floorSegment",
    });

    lowestFloorY = Math.min(lowestFloorY, floorCenter.y);

    const sideOffset = width / 2 - RAIL_INSET;
    const verticalOffset = RAIL_H / 2 - FLOOR_THICK / 2 + RAIL_FLOOR_OVERLAP;

    const addRail = (direction: -1 | 1) => {
      const railCenter = floorCenter
        .clone()
        .addScaledVector(right, sideOffset * direction)
        .addScaledVector(up, verticalOffset);

      addPart(group, boardWallBody, {
        size: new THREE.Vector3(RAIL_THICK, RAIL_H, length),
        position: railCenter,
        rotation,
        material: railMaterial,
        uvScale: [Math.max(length * 0.3, 1), Math.max(RAIL_H, 1)],
      });
    };

    if (railLeft) addRail(-1);
    if (railRight) addRail(1);

    pathStartTopPoint.copy(segmentEndTopPoint);
  };

  const createBounds = (trackWidth: number, obstacleWidth: number): { minX: number; maxX: number } => {
    const maxAbsX = trackWidth / 2 - RAIL_THICK - obstacleWidth / 2 - WALL_CLEARANCE;
    const clampedAbs = Math.max(0, maxAbsX);
    return { minX: -clampedAbs, maxX: clampedAbs };
  };

  const registerObstacleActor = (params: {
    visual: THREE.Object3D;
    body: CANNON.Body;
    localPos: THREE.Vector3;
    trackWidth: number;
    obstacleWidth: number;
    phase?: number;
    speedHz?: number;
    lockX?: boolean;
  }): void => {
    const bounds = createBounds(params.trackWidth, params.obstacleWidth);
    const startX = clamp(params.localPos.x, bounds.minX, bounds.maxX);
    const lockX = params.lockX ?? (params.speedHz ?? 0) === 0;
    const minX = lockX ? startX : bounds.minX;
    const maxX = lockX ? startX : bounds.maxX;
    params.visual.position.set(startX, params.localPos.y, params.localPos.z);
    params.body.position.set(startX, params.localPos.y, params.localPos.z);
    params.body.quaternion.set(0, 0, 0, 1);
    params.body.aabbNeedsUpdate = true;
    params.body.updateAABB();
    const localQuat = new CANNON.Quaternion(0, 0, 0, 1);
    const actor: ObstacleActor = {
      visual: params.visual,
      body: params.body,
      baseLocalPos: new CANNON.Vec3(startX, params.localPos.y, params.localPos.z),
      localQuat,
      hasLocalRotation: false,
      isLocallyDynamic: (params.speedHz ?? 0) !== 0 && maxX > minX,
      minX,
      maxX,
      phase: params.phase ?? 0,
      speedHz: params.speedHz ?? 0,
    };
    obstacleActors.push(actor);
    if (actor.isLocallyDynamic) {
      dynamicObstacleActors.push(actor);
    }
    obstacleBodies.push(params.body);
  };

  const addMovingBlock = (
    localPos: THREE.Vector3,
    phase: number,
    speedHz: number,
    obstacleWidth: number,
    obstacleLength: number,
  ): void => {
    const mesh = addVisualPart(group, {
      size: new THREE.Vector3(obstacleWidth, MOVING_OBSTACLE_H, obstacleLength),
      position: localPos,
      rotation: new THREE.Euler(0, 0, 0, "XYZ"),
      material: obstacleMaterial,
      outline: { color: 0x330000, scale: 1.002 },
    });

    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    body.addShape(
      new CANNON.Box(
        new CANNON.Vec3(
          obstacleWidth / 2,
          MOVING_OBSTACLE_H / 2,
          obstacleLength / 2,
        ),
      ),
    );

    registerObstacleActor({
      visual: mesh,
      body,
      localPos,
      trackWidth: TRACK_W,
      obstacleWidth,
      phase,
      speedHz,
    });
    movingObstacleBodies.push(body);
  };

  const addStaticBlock = (
    localPos: THREE.Vector3,
    obstacleWidth: number,
    obstacleLength: number,
  ): void => {
    const mesh = addVisualPart(group, {
      size: new THREE.Vector3(obstacleWidth, STATIC_INTERSTITIAL_H, obstacleLength),
      position: localPos,
      rotation: new THREE.Euler(0, 0, 0, "XYZ"),
      material: obstacleMaterial,
      outline: { color: 0x330000, scale: 1.002 },
    });

    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    body.addShape(
      new CANNON.Box(
        new CANNON.Vec3(
          obstacleWidth / 2,
          STATIC_INTERSTITIAL_H / 2,
          obstacleLength / 2,
        ),
      ),
    );

    registerObstacleActor({
      visual: mesh,
      body,
      localPos,
      trackWidth: TRACK_W,
      obstacleWidth,
      phase: 0,
      speedHz: 0,
      lockX: true,
    });
  };

  const addGapWall = (params: {
    z: number;
    width: number;
    height: number;
    depth: number;
    trackWidth: number;
    circleHoles?: Array<{ x: number; y: number; r: number }>;
    bottomOpenCircleHoles?: Array<{ x: number; y: number; r: number }>;
    bottomRoundedTopHoles?: Array<{ x: number; width: number; baseHeight: number }>;
    topOpenRoundedHoles?: Array<{ x: number; width: number; baseHeight: number }>;
    bottomSlots?: Array<{ x: number; width: number; height: number }>;
  }): void => {
    const y = FLOOR_THICK / 2 + params.height / 2;
    const halfW = params.width / 2;
    const halfH = params.height / 2;
    let wallGeometry: THREE.ExtrudeGeometry;
    if ((params.topOpenRoundedHoles?.length ?? 0) > 0) {
      type ResolvedTopOpenRoundedHole = {
        x: number;
        radius: number;
        baseY: number;
        topY: number;
        leftBottomX: number;
        rightBottomX: number;
        leftTopX: number;
        rightTopX: number;
        leftTopAngle: number;
        rightTopAngle: number;
      };

      type Boundary =
        | { kind: "wall"; x: number }
        | { kind: "holeLeft"; hole: ResolvedTopOpenRoundedHole }
        | { kind: "holeRight"; hole: ResolvedTopOpenRoundedHole };

      const resolveTopOpenRoundedHole = (hole: {
        x: number;
        width: number;
        baseHeight: number;
      }): ResolvedTopOpenRoundedHole => {
        const radius = hole.width / 2;
        const baseY = -halfH + hole.baseHeight;
        const dyToTop = THREE.MathUtils.clamp(halfH - baseY, -radius, radius);
        const topY = baseY + dyToTop;
        const halfTopChord = Math.sqrt(Math.max(0, radius * radius - dyToTop * dyToTop));
        return {
          x: hole.x,
          radius,
          baseY,
          topY,
          leftBottomX: hole.x - radius,
          rightBottomX: hole.x + radius,
          leftTopX: hole.x - halfTopChord,
          rightTopX: hole.x + halfTopChord,
          leftTopAngle: Math.atan2(dyToTop, -halfTopChord),
          rightTopAngle: Math.atan2(dyToTop, halfTopChord),
        };
      };

      const boundaryBottomX = (boundary: Boundary): number => {
        if (boundary.kind === "wall") {
          return boundary.x;
        }
        if (boundary.kind === "holeLeft") {
          return boundary.hole.leftBottomX;
        }
        return boundary.hole.rightBottomX;
      };

      const boundaryTopX = (boundary: Boundary): number => {
        if (boundary.kind === "wall") {
          return boundary.x;
        }
        if (boundary.kind === "holeLeft") {
          return boundary.hole.leftTopX;
        }
        return boundary.hole.rightTopX;
      };

      const appendBoundaryUp = (shape: THREE.Shape, boundary: Boundary): void => {
        if (boundary.kind === "wall") {
          shape.lineTo(boundary.x, halfH);
          return;
        }

        const hole = boundary.hole;
        if (boundary.kind === "holeLeft") {
          shape.lineTo(hole.leftBottomX, hole.baseY);
          shape.absarc(hole.x, hole.baseY, hole.radius, Math.PI, hole.leftTopAngle, true);
          if (hole.topY < halfH) {
            shape.lineTo(hole.leftTopX, halfH);
          }
          return;
        }

        shape.lineTo(hole.rightBottomX, hole.baseY);
        shape.absarc(hole.x, hole.baseY, hole.radius, 0, hole.rightTopAngle, false);
        if (hole.topY < halfH) {
          shape.lineTo(hole.rightTopX, halfH);
        }
      };

      const appendBoundaryDown = (shape: THREE.Shape, boundary: Boundary): void => {
        if (boundary.kind === "wall") {
          shape.lineTo(boundary.x, -halfH);
          return;
        }

        const hole = boundary.hole;
        if (boundary.kind === "holeLeft") {
          if (hole.topY < halfH) {
            shape.lineTo(hole.leftTopX, hole.topY);
          }
          shape.absarc(hole.x, hole.baseY, hole.radius, hole.leftTopAngle, Math.PI, false);
          shape.lineTo(hole.leftBottomX, -halfH);
          return;
        }

        if (hole.topY < halfH) {
          shape.lineTo(hole.rightTopX, hole.topY);
        }
        shape.absarc(hole.x, hole.baseY, hole.radius, hole.rightTopAngle, 0, true);
        shape.lineTo(hole.rightBottomX, -halfH);
      };

      const resolvedHoles = [...params.topOpenRoundedHoles!]
        .sort((a, b) => a.x - b.x)
        .map(resolveTopOpenRoundedHole);

      const shapes: THREE.Shape[] = [];
      for (let i = 0; i <= resolvedHoles.length; i += 1) {
        const leftBoundary: Boundary =
          i === 0 ? { kind: "wall", x: -halfW } : { kind: "holeRight", hole: resolvedHoles[i - 1]! };
        const rightBoundary: Boundary =
          i === resolvedHoles.length
            ? { kind: "wall", x: halfW }
            : { kind: "holeLeft", hole: resolvedHoles[i]! };

        const leftBottomX = boundaryBottomX(leftBoundary);
        const rightBottomX = boundaryBottomX(rightBoundary);
        const leftTopX = boundaryTopX(leftBoundary);
        const rightTopX = boundaryTopX(rightBoundary);
        if (rightBottomX <= leftBottomX || rightTopX <= leftTopX) {
          continue;
        }

        const shape = new THREE.Shape();
        shape.moveTo(leftBottomX, -halfH);
        shape.lineTo(rightBottomX, -halfH);
        appendBoundaryUp(shape, rightBoundary);
        shape.lineTo(leftTopX, halfH);
        appendBoundaryDown(shape, leftBoundary);
        shape.closePath();
        shapes.push(shape);
      }

      if (shapes.length === 0) {
        const shape = new THREE.Shape();
        shape.moveTo(-halfW, -halfH);
        shape.lineTo(halfW, -halfH);
        shape.lineTo(halfW, halfH);
        shape.lineTo(-halfW, halfH);
        shape.closePath();
        shapes.push(shape);
      }

      wallGeometry = new THREE.ExtrudeGeometry(shapes, {
        depth: params.depth,
        bevelEnabled: false,
        curveSegments: FINAL_WALL_CURVE_SEGMENTS,
        steps: 1,
      });
    } else {
      const wallShape = new THREE.Shape();
      wallShape.moveTo(-halfW, -halfH);
      wallShape.lineTo(halfW, -halfH);
      wallShape.lineTo(halfW, halfH);
      wallShape.lineTo(-halfW, halfH);
      wallShape.closePath();

      for (const hole of params.circleHoles ?? []) {
        const holePath = new THREE.Path();
        holePath.absarc(hole.x, hole.y, hole.r, 0, Math.PI * 2, false);
        wallShape.holes.push(holePath);
      }

      for (const hole of params.bottomOpenCircleHoles ?? []) {
        const holePath = new THREE.Path();
        holePath.moveTo(hole.x - hole.r, -halfH);
        holePath.lineTo(hole.x + hole.r, -halfH);
        holePath.lineTo(hole.x + hole.r, hole.y);
        holePath.absarc(hole.x, hole.y, hole.r, 0, Math.PI, true);
        holePath.closePath();
        wallShape.holes.push(holePath);
      }

      for (const hole of params.bottomRoundedTopHoles ?? []) {
        const halfHoleW = hole.width / 2;
        const baseTop = -halfH + hole.baseHeight;
        const capCenterY = baseTop;
        const holePath = new THREE.Path();
        holePath.moveTo(hole.x - halfHoleW, -halfH);
        holePath.lineTo(hole.x + halfHoleW, -halfH);
        holePath.lineTo(hole.x + halfHoleW, capCenterY);
        holePath.absarc(hole.x, capCenterY, halfHoleW, 0, Math.PI, false);
        holePath.closePath();
        wallShape.holes.push(holePath);
      }

      for (const slot of params.bottomSlots ?? []) {
        const slotHalfW = slot.width / 2;
        const slotTop = -halfH + slot.height;
        const holePath = new THREE.Path();
        holePath.moveTo(slot.x - slotHalfW, -halfH);
        holePath.lineTo(slot.x + slotHalfW, -halfH);
        holePath.lineTo(slot.x + slotHalfW, slotTop);
        holePath.lineTo(slot.x - slotHalfW, slotTop);
        holePath.closePath();
        wallShape.holes.push(holePath);
      }

      wallGeometry = new THREE.ExtrudeGeometry(wallShape, {
        depth: params.depth,
        bevelEnabled: false,
        curveSegments: FINAL_WALL_CURVE_SEGMENTS,
        steps: 1,
      });
    }
    wallGeometry.translate(0, 0, -params.depth / 2);

    const wallMesh = new THREE.Mesh(wallGeometry, obstacleMaterial);
    wallMesh.position.set(0, y, params.z);
    wallMesh.castShadow = false;
    wallMesh.receiveShadow = true;
    const edgeLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(wallGeometry),
      new THREE.LineBasicMaterial({ color: 0x330000 }),
    );
    edgeLines.scale.set(1.002, 1.002, 1.002);
    wallMesh.add(edgeLines);
    group.add(wallMesh);

    const wallBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    wallBody.addShape(geometryToTrimesh(wallGeometry));

    registerObstacleActor({
      visual: wallMesh,
      body: wallBody,
      localPos: new THREE.Vector3(0, y, params.z),
      trackWidth: params.trackWidth,
      obstacleWidth: params.width,
      phase: 0,
      speedHz: 0,
    });
  };

  const addFinalThreeHoleWall = (z: number): void => {
    addGapWall({
      z,
      width: FINAL_WALL_W,
      height: FINAL_WALL_H,
      depth: FINAL_WALL_DEPTH,
      trackWidth: FINISH_WIDTH,
      topOpenRoundedHoles: FINAL_WALL_HOLE_X.map((x) => ({
        x,
        width: STANDARD_MARBLE_HOLE_WIDTH,
        baseHeight: STANDARD_MARBLE_HOLE_BASE_HEIGHT,
      })),
    });
  };

  const tempOffset = new CANNON.Vec3();
  const tempWorldPos = new CANNON.Vec3();
  const tempWorldQuat = new CANNON.Quaternion();

  const updateMovingObstacles = (
    fixedDt: number,
    boardPos: CANNON.Vec3,
    boardQuat: CANNON.Quaternion,
  ): void => {
    for (const obstacle of dynamicObstacleActors) {
      obstacle.phase += fixedDt * obstacle.speedHz * Math.PI * 2;
      const centerX = (obstacle.minX + obstacle.maxX) / 2;
      const amplitude = (obstacle.maxX - obstacle.minX) / 2;
      const localX = centerX + Math.sin(obstacle.phase) * amplitude;

      obstacle.baseLocalPos.x = localX;
      obstacle.visual.position.x = localX;
    }

    for (const obstacle of obstacleActors) {
      boardQuat.vmult(obstacle.baseLocalPos, tempOffset);
      tempWorldPos.set(
        boardPos.x + tempOffset.x,
        boardPos.y + tempOffset.y,
        boardPos.z + tempOffset.z,
      );
      if (obstacle.hasLocalRotation) {
        boardQuat.mult(obstacle.localQuat, tempWorldQuat);
      } else {
        tempWorldQuat.copy(boardQuat);
      }

      obstacle.body.position.copy(tempWorldPos);
      obstacle.body.quaternion.copy(tempWorldQuat);
      obstacle.body.aabbNeedsUpdate = true;
      obstacle.body.updateAABB();
    }
  };

  const setMovingObstacleMaterial = (material: CANNON.Material): void => {
    for (const obstacle of obstacleActors) {
      obstacle.body.material = material;
    }
  };

  addSegment({ length: START_LENGTH, slopeDeg: 0 });
  const startBackWallWidth = TRACK_W - (RAIL_INSET * 2 + RAIL_THICK);
  const startBackWallY = RAIL_H / 2 - FLOOR_THICK / 2 + RAIL_FLOOR_OVERLAP;
  const startBackWallZ = startTopBackPoint.z + RAIL_THICK / 2 + START_BACK_WALL_PADDING;
  addPart(group, boardWallBody, {
    size: new THREE.Vector3(startBackWallWidth, RAIL_H, RAIL_THICK),
    position: new THREE.Vector3(0, startBackWallY, startBackWallZ),
    rotation: new THREE.Euler(0, 0, 0, "XYZ"),
    material: railMaterial,
    uvScale: [Math.max(startBackWallWidth * 0.3, 1), Math.max(RAIL_H, 1)],
  });

  for (const segment of SEGMENTS) {
    currentYawDeg += segment.yawDeg;

    addSegment({
      length: segment.length,
      slopeDeg: segment.slopeDeg,
      width: segment.width ?? TRACK_W,
      railLeft: segment.railLeft ?? true,
      railRight: segment.railRight ?? true,
    });

    if (segment.landingLength && segment.landingLength > 0) {
      addSegment({
        length: segment.landingLength,
        slopeDeg: 0,
        width: segment.width ?? TRACK_W,
        railLeft: segment.railLeft ?? true,
        railRight: segment.railRight ?? true,
      });
    }
  }

  const finishStartZ = pathStartTopPoint.z;
  addSegment({
    length: FINISH_LENGTH,
    slopeDeg: 0,
    width: FINISH_WIDTH,
    railLeft: true,
    railRight: true,
  });

  const fullFloorLength = pathStartTopPoint.z - startTopBackPoint.z;
  const fullFloorCenterZ = startTopBackPoint.z + fullFloorLength / 2;
  addCompoundPart(boardBody, {
    size: new THREE.Vector3(FINISH_WIDTH, FLOOR_THICK, fullFloorLength),
    position: new THREE.Vector3(0, 0, fullFloorCenterZ),
    rotation: new THREE.Euler(0, 0, 0, "XYZ"),
    material: floorMaterial,
  });

  boardBody.aabbNeedsUpdate = true;
  boardBody.updateAABB();
  boardWallBody.aabbNeedsUpdate = true;
  boardWallBody.updateAABB();

  const spawn = startTopBackPoint
    .clone()
    .addScaledVector(startForward, 1.8)
    .add(new THREE.Vector3(0, MARBLE_RADIUS + 0.6, 0));
  const trialStartZ = spawn.z + 2;
  const trialFinishZ = pathStartTopPoint.z - 1;

  const mainObstacleCount = 16;
  const mainStartZ = trialStartZ + 7;
  const mainEndZ = trialFinishZ - 25;
  const mainSpan = Math.max(mainEndZ - mainStartZ, 1);
  const mainStep = mainObstacleCount > 1 ? mainSpan / (mainObstacleCount - 1) : 0;
  const laneAnchor = (obstacleWidth: number, laneScale = 1): number =>
    (TRACK_W / 2 - RAIL_THICK - obstacleWidth / 2 - 0.22) * laneScale;

  const movingObstacleSpecs: MovingObstacleSpec[] = [
    {
      width: MOVING_OBSTACLE_LONG_W,
      length: MOVING_OBSTACLE_LONG_L,
      minSpeedHz: 0.08,
      maxSpeedHz: 0.16,
      laneMinScale: 0.8,
      laneMaxScale: 0.92,
    },
    {
      width: MOVING_OBSTACLE_SHORT_W,
      length: MOVING_OBSTACLE_SHORT_L,
      minSpeedHz: 0.28,
      maxSpeedHz: 0.47,
      laneMinScale: 0.82,
      laneMaxScale: 0.95,
    },
    {
      width: MOVING_OBSTACLE_MEDIUM_W,
      length: MOVING_OBSTACLE_MEDIUM_L,
      minSpeedHz: 0.14,
      maxSpeedHz: 0.31,
      laneMinScale: 0.8,
      laneMaxScale: 0.92,
    },
    {
      width: MOVING_OBSTACLE_MEDIUM_W + 0.25,
      length: MOVING_OBSTACLE_SHORT_L + 0.08,
      minSpeedHz: 0.2,
      maxSpeedHz: 0.42,
      laneMinScale: 0.78,
      laneMaxScale: 0.9,
    },
  ];
  const movingObstacleZs: number[] = [];
  for (let i = 0; i < mainObstacleCount; i += 1) {
    const obstacle = movingObstacleSpecs[i % movingObstacleSpecs.length]!;
    const z = mainStartZ + mainStep * i;
    movingObstacleZs.push(z);
    const side = i % 2 === 0 ? -1 : 1;
    const width = obstacle.width * lerp(0.95, 1.08, obstacleRandom());
    const length = obstacle.length * lerp(0.9, 1.2, obstacleRandom());
    const speedHz = lerp(obstacle.minSpeedHz, obstacle.maxSpeedHz, obstacleRandom());
    const phase = obstacleRandom() * Math.PI * 2;
    const laneScale = lerp(obstacle.laneMinScale, obstacle.laneMaxScale, obstacleRandom());
    const x = side * laneAnchor(width, laneScale);
    addMovingBlock(
      new THREE.Vector3(x, FLOOR_THICK / 2 + MOVING_OBSTACLE_H / 2, z),
      phase,
      speedHz,
      width,
      length,
    );
  }

  for (let i = 0; i < movingObstacleZs.length - 1; i += 1) {
    const z = (movingObstacleZs[i]! + movingObstacleZs[i + 1]!) / 2;
    const pattern = i % 4;
    const offCenterSide = i % 2 === 0 ? -1 : 1;

    if (pattern === 0) {
      const width = STATIC_INTERSTITIAL_CENTER_W * lerp(0.9, 1.08, obstacleRandom());
      const length = STATIC_INTERSTITIAL_L * lerp(0.9, 1.15, obstacleRandom());
      addStaticBlock(
        new THREE.Vector3(0, FLOOR_THICK / 2 + STATIC_INTERSTITIAL_H / 2, z),
        width,
        length,
      );
      continue;
    }

    if (pattern === 1) {
      const width = STATIC_INTERSTITIAL_OFFCENTER_W * lerp(0.9, 1.08, obstacleRandom());
      const length = STATIC_INTERSTITIAL_L * lerp(0.88, 1.12, obstacleRandom());
      const x = offCenterSide * lerp(TRACK_W * 0.17, TRACK_W * 0.28, obstacleRandom());
      addStaticBlock(
        new THREE.Vector3(x, FLOOR_THICK / 2 + STATIC_INTERSTITIAL_H / 2, z),
        width,
        length,
      );
      continue;
    }

    const side = pattern === 2 ? -1 : 1;
    const width = STATIC_INTERSTITIAL_WALL_JUT_W * lerp(0.9, 1.08, obstacleRandom());
    const length = STATIC_INTERSTITIAL_L * lerp(0.82, 1.1, obstacleRandom());
    const x = side * (TRACK_W / 2 - RAIL_THICK - width / 2 - WALL_CLEARANCE * 0.45);
    addStaticBlock(
      new THREE.Vector3(x, FLOOR_THICK / 2 + STATIC_INTERSTITIAL_H / 2, z),
      width,
      length,
    );
  }

  // Zone C: two static precision walls followed by a clear line-up segment.
  addGapWall({
    z: trialFinishZ - 15.2,
    width: TRACK_W - 0.8,
    height: STATIC_GAP_WALL_H,
    depth: STATIC_GAP_WALL_DEPTH,
    trackWidth: TRACK_W,
    topOpenRoundedHoles: [
      {
        x: -1.45,
        width: STANDARD_MARBLE_HOLE_WIDTH,
        baseHeight: STANDARD_MARBLE_HOLE_BASE_HEIGHT,
      },
    ],
  });
  addGapWall({
    z: trialFinishZ - 10.9,
    width: TRACK_W - 0.7,
    height: STATIC_GAP_WALL_H,
    depth: STATIC_GAP_WALL_DEPTH,
    trackWidth: TRACK_W,
    topOpenRoundedHoles: [
      {
        x: -1.45,
        width: STANDARD_MARBLE_HOLE_WIDTH,
        baseHeight: STANDARD_MARBLE_HOLE_BASE_HEIGHT,
      },
    ],
  });

  // Zone D: final static wall with three floor-level marble cutouts.
  addFinalThreeHoleWall(trialFinishZ - 6.4);

  addVisualPart(group, {
    size: new THREE.Vector3(TRACK_W + 0.8, MARKER_THICK, 0.45),
    position: new THREE.Vector3(0, FLOOR_THICK / 2 + MARKER_THICK / 2 + 0.01, trialStartZ),
    rotation: new THREE.Euler(0, 0, 0, "XYZ"),
    material: startMarkerMaterial,
  });

  addVisualPart(group, {
    size: new THREE.Vector3(FINISH_WIDTH + 1.2, MARKER_THICK, 0.55),
    position: new THREE.Vector3(0, FLOOR_THICK / 2 + MARKER_THICK / 2 + 0.01, trialFinishZ),
    rotation: new THREE.Euler(0, 0, 0, "XYZ"),
    material: finishMarkerMaterial,
  });

  updateMovingObstacles(0, boardBody.position, boardBody.quaternion);

  const offCourseBoundsLocal = {
    minX: -FINISH_WIDTH / 2 - OFF_COURSE_MARGIN,
    maxX: FINISH_WIDTH / 2 + OFF_COURSE_MARGIN,
    minZ: startTopBackPoint.z - OFF_COURSE_Z_MARGIN,
    maxZ: pathStartTopPoint.z + OFF_COURSE_Z_MARGIN,
  };

  return {
    group,
    bodies: [boardBody, boardWallBody, ...obstacleBodies],
    wallBody: boardWallBody,
    movingObstacleBodies,
    containmentLocal: {
      mainHalfX: computeContainmentHalfX(TRACK_W),
      finishHalfX: computeContainmentHalfX(FINISH_WIDTH),
      finishStartZ,
    },
    wallContainmentMode: "legacyLinear",
    containmentPathLocal: [],
    spawn: new CANNON.Vec3(spawn.x, spawn.y, spawn.z),
    respawnY: lowestFloorY - 6,
    offCourseBoundsLocal,
    trialStartZ,
    trialFinishZ,
    physicsDebug: {
      colliderPieceCount: 0,
      primitiveShapeCount: countBodyShapes([boardBody, boardWallBody, ...obstacleBodies]),
      exoticTrimeshPieceCount: 0,
      floorShapeCount: boardBody.shapes.length,
      wallShapeCount: boardWallBody.shapes.length,
      estimatedBoardWallShapeTestsPerStep: boardBody.shapes.length * boardWallBody.shapes.length,
    },
    updateMovingObstacles,
    setMovingObstacleMaterial,
  };
}
