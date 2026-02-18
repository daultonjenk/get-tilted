import * as THREE from "three";
import * as CANNON from "cannon-es";
import trackSurfaceUrl from "../../assets/textures/track/track-surface.png";

export type CreateTrackOptions = {
  seed?: string;
};

export type TrackBuildResult = {
  group: THREE.Group;
  bodies: CANNON.Body[];
  movingObstacleBodies: CANNON.Body[];
  containmentLocal: {
    mainHalfX: number;
    finishHalfX: number;
    finishStartZ: number;
  };
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
const FINAL_WALL_H = 3.6;
const FINAL_WALL_DEPTH = 0.13;
const MARBLE_HOLE_SCALE = 1.15;
const STANDARD_MARBLE_HOLE_WIDTH = MARBLE_RADIUS * 2 * MARBLE_HOLE_SCALE;
const STANDARD_MARBLE_HOLE_BASE_HEIGHT = STANDARD_MARBLE_HOLE_WIDTH / 2;
const FINAL_WALL_HOLE_X = [-2.55, 0, 2.55];
const FINAL_WALL_CURVE_SEGMENTS = 40;
const DEFAULT_OBSTACLE_SEED = "track-v0.7.17.0";
const START_BACK_WALL_PADDING = 0.03;
const STATIC_GAP_WALL_H = 3.1;
const STATIC_GAP_WALL_DEPTH = 0.105;
const STATIC_INTERSTITIAL_H = MOVING_OBSTACLE_H * 1.02;
const STATIC_INTERSTITIAL_CENTER_W = TRACK_W / 5;
const STATIC_INTERSTITIAL_OFFCENTER_W = TRACK_W * 0.19;
const STATIC_INTERSTITIAL_WALL_JUT_W = TRACK_W / 6;
const STATIC_INTERSTITIAL_L = 0.62;

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

function geometryToTrimesh(geometry: THREE.BufferGeometry): CANNON.Trimesh {
  const position = geometry.getAttribute("position");
  const vertices: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    vertices.push(position.getX(i), position.getY(i), position.getZ(i));
  }
  const indices: number[] = [];
  const indexAttr = geometry.getIndex();
  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i += 1) {
      indices.push(indexAttr.getX(i));
    }
  } else {
    for (let i = 0; i < position.count; i += 1) {
      indices.push(i);
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

export function createTrack(opts?: CreateTrackOptions): TrackBuildResult {
  const obstacleSeed = opts?.seed ?? DEFAULT_OBSTACLE_SEED;
  const obstacleRandom = makeSeededRandom(obstacleSeed);

  const group = new THREE.Group();
  group.name = "track";

  const boardBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
  boardBody.position.set(0, 0, 0);
  boardBody.quaternion.set(0, 0, 0, 1);

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

      addPart(group, boardBody, {
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

    obstacleActors.push({
      visual: params.visual,
      body: params.body,
      baseLocalPos: new CANNON.Vec3(startX, params.localPos.y, params.localPos.z),
      localQuat: new CANNON.Quaternion(0, 0, 0, 1),
      minX,
      maxX,
      phase: params.phase ?? 0,
      speedHz: params.speedHz ?? 0,
    });
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
    bottomSlots?: Array<{ x: number; width: number; height: number }>;
  }): void => {
    const y = FLOOR_THICK / 2 + params.height / 2;
    const wallShape = new THREE.Shape();
    const halfW = params.width / 2;
    const halfH = params.height / 2;
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

    const wallGeometry = new THREE.ExtrudeGeometry(wallShape, {
      depth: params.depth,
      bevelEnabled: false,
      curveSegments: FINAL_WALL_CURVE_SEGMENTS,
      steps: 1,
    });
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
      bottomRoundedTopHoles: FINAL_WALL_HOLE_X.map((x) => ({
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
    for (const obstacle of obstacleActors) {
      if (obstacle.speedHz !== 0 && obstacle.maxX > obstacle.minX) {
        obstacle.phase += fixedDt * obstacle.speedHz * Math.PI * 2;
      }

      const centerX = (obstacle.minX + obstacle.maxX) / 2;
      const amplitude = (obstacle.maxX - obstacle.minX) / 2;
      const localX = centerX + Math.sin(obstacle.phase) * amplitude;

      obstacle.baseLocalPos.x = localX;
      obstacle.visual.position.x = localX;

      boardQuat.vmult(obstacle.baseLocalPos, tempOffset);
      tempWorldPos.set(
        boardPos.x + tempOffset.x,
        boardPos.y + tempOffset.y,
        boardPos.z + tempOffset.z,
      );
      boardQuat.mult(obstacle.localQuat, tempWorldQuat);

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
  addPart(group, boardBody, {
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
    bottomRoundedTopHoles: [
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
    bottomSlots: [
      {
        x: 1.45,
        width: MARBLE_RADIUS * 2 * 1.22,
        height: MARBLE_RADIUS * 2 * 1.4,
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
    bodies: [boardBody, ...obstacleBodies],
    movingObstacleBodies,
    containmentLocal: {
      mainHalfX: computeContainmentHalfX(TRACK_W),
      finishHalfX: computeContainmentHalfX(FINISH_WIDTH),
      finishStartZ,
    },
    spawn: new CANNON.Vec3(spawn.x, spawn.y, spawn.z),
    respawnY: lowestFloorY - 6,
    offCourseBoundsLocal,
    trialStartZ,
    trialFinishZ,
    updateMovingObstacles,
    setMovingObstacleMaterial,
  };
}
