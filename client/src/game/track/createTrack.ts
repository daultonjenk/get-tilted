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
  speedHz: number;
  phase: number;
  laneScale?: number;
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

const MOVING_OBSTACLE_H = 2.25 / 3;
const MOVING_OBSTACLE_LONG_W = 5.0;
const MOVING_OBSTACLE_LONG_L = 1.85;
const MOVING_OBSTACLE_SHORT_W = 3.1;
const MOVING_OBSTACLE_SHORT_L = 0.6;
const MOVING_OBSTACLE_MEDIUM_W = 4.2;
const MOVING_OBSTACLE_MEDIUM_L = 1.1;

const FINAL_WALL_W = 8.8;
const FINAL_WALL_H = 3.6;
const FINAL_WALL_DEPTH = 1.3;
const FINAL_WALL_HOLE_DIAMETER = MARBLE_RADIUS * 2 * 1.15;
const FINAL_WALL_HOLE_R = FINAL_WALL_HOLE_DIAMETER / 2;
const FINAL_WALL_HOLE_Y = -FINAL_WALL_H / 2 + FINAL_WALL_HOLE_R;
const FINAL_WALL_HOLE_X = [-2.55, 0, 2.55];
const FINAL_WALL_CURVE_SEGMENTS = 40;

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
  void opts?.seed;

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
    map: trackSurfaceTexture,
    color: 0xffffff,
    transparent: true,
    opacity: 0.75,
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
  }): void => {
    const bounds = createBounds(params.trackWidth, params.obstacleWidth);
    const startX = clamp(params.localPos.x, bounds.minX, bounds.maxX);
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
      minX: bounds.minX,
      maxX: bounds.maxX,
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
      uvScale: [Math.max(obstacleWidth, 1), Math.max(obstacleLength, 1)],
      outline: { color: 0x000000, scale: 1.002 },
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

  const addFinalThreeHoleWall = (z: number): void => {
    const y = FLOOR_THICK / 2 + FINAL_WALL_H / 2;

    const wallShape = new THREE.Shape();
    const halfW = FINAL_WALL_W / 2;
    const halfH = FINAL_WALL_H / 2;
    wallShape.moveTo(-halfW, -halfH);
    wallShape.lineTo(halfW, -halfH);
    wallShape.lineTo(halfW, halfH);
    wallShape.lineTo(-halfW, halfH);
    wallShape.closePath();

    for (const holeX of FINAL_WALL_HOLE_X) {
      const holePath = new THREE.Path();
      holePath.absarc(holeX, FINAL_WALL_HOLE_Y, FINAL_WALL_HOLE_R, 0, Math.PI * 2, false);
      wallShape.holes.push(holePath);
    }

    const wallGeometry = new THREE.ExtrudeGeometry(wallShape, {
      depth: FINAL_WALL_DEPTH,
      bevelEnabled: false,
      curveSegments: FINAL_WALL_CURVE_SEGMENTS,
      steps: 1,
    });
    wallGeometry.translate(0, 0, -FINAL_WALL_DEPTH / 2);

    const wallMesh = new THREE.Mesh(wallGeometry, obstacleMaterial);
    wallMesh.position.set(0, y, z);
    wallMesh.castShadow = false;
    wallMesh.receiveShadow = true;
    const edgeLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(wallGeometry),
      new THREE.LineBasicMaterial({ color: 0x000000 }),
    );
    edgeLines.scale.set(1.002, 1.002, 1.002);
    wallMesh.add(edgeLines);
    group.add(wallMesh);

    const wallBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    wallBody.addShape(geometryToTrimesh(wallGeometry));

    registerObstacleActor({
      visual: wallMesh,
      body: wallBody,
      localPos: new THREE.Vector3(0, y, z),
      trackWidth: FINISH_WIDTH,
      obstacleWidth: FINAL_WALL_W,
      phase: 0,
      speedHz: 0,
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

  const mainObstacleCount = 10;
  const mainStartZ = trialStartZ + 7;
  const mainEndZ = trialFinishZ - 24;
  const mainSpan = Math.max(mainEndZ - mainStartZ, 1);
  const mainStep = mainObstacleCount > 1 ? mainSpan / (mainObstacleCount - 1) : 0;
  const laneAnchor = (obstacleWidth: number, laneScale = 1): number =>
    (TRACK_W / 2 - RAIL_THICK - obstacleWidth / 2 - 0.22) * laneScale;

  // Zone A: long + slow mixed against short + fast.
  const zoneA: MovingObstacleSpec[] = [
    { width: MOVING_OBSTACLE_LONG_W, length: MOVING_OBSTACLE_LONG_L, speedHz: 0.1, phase: 0 },
    {
      width: MOVING_OBSTACLE_SHORT_W,
      length: MOVING_OBSTACLE_SHORT_L,
      speedHz: 0.35,
      phase: Math.PI * 0.5,
    },
    {
      width: MOVING_OBSTACLE_MEDIUM_W,
      length: MOVING_OBSTACLE_MEDIUM_L,
      speedHz: 0.14,
      phase: Math.PI,
    },
    {
      width: MOVING_OBSTACLE_SHORT_W + 0.2,
      length: MOVING_OBSTACLE_SHORT_L + 0.12,
      speedHz: 0.39,
      phase: Math.PI * 1.5,
    },
  ];
  for (let i = 0; i < zoneA.length; i += 1) {
    const z = mainStartZ + mainStep * i;
    const obstacle = zoneA[i]!;
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * laneAnchor(obstacle.width, obstacle.laneScale);
    addMovingBlock(
      new THREE.Vector3(x, FLOOR_THICK / 2 + MOVING_OBSTACLE_H / 2, z),
      obstacle.phase,
      obstacle.speedHz,
      obstacle.width,
      obstacle.length,
    );
  }

  // Zone B: keep alternating lanes with wider speed spread and mixed sizes.
  const zoneB: MovingObstacleSpec[] = [
    {
      width: MOVING_OBSTACLE_MEDIUM_W + 0.25,
      length: MOVING_OBSTACLE_MEDIUM_L + 0.2,
      speedHz: 0.2,
      phase: 0.2,
      laneScale: 0.92,
    },
    {
      width: MOVING_OBSTACLE_SHORT_W,
      length: MOVING_OBSTACLE_SHORT_L,
      speedHz: 0.41,
      phase: Math.PI + 0.1,
      laneScale: 0.88,
    },
    {
      width: MOVING_OBSTACLE_LONG_W - 0.2,
      length: MOVING_OBSTACLE_LONG_L - 0.05,
      speedHz: 0.12,
      phase: 1.1,
      laneScale: 0.86,
    },
    {
      width: MOVING_OBSTACLE_SHORT_W + 0.1,
      length: MOVING_OBSTACLE_SHORT_L + 0.15,
      speedHz: 0.37,
      phase: Math.PI + 0.85,
      laneScale: 0.9,
    },
    {
      width: MOVING_OBSTACLE_MEDIUM_W - 0.3,
      length: MOVING_OBSTACLE_MEDIUM_L - 0.1,
      speedHz: 0.23,
      phase: 0.55,
      laneScale: 0.89,
    },
    {
      width: MOVING_OBSTACLE_SHORT_W - 0.1,
      length: MOVING_OBSTACLE_SHORT_L + 0.05,
      speedHz: 0.43,
      phase: Math.PI + 1.45,
      laneScale: 0.84,
    },
  ];
  for (let i = 0; i < zoneB.length; i += 1) {
    const z = mainStartZ + mainStep * (4 + i);
    const obstacle = zoneB[i]!;
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * laneAnchor(obstacle.width, obstacle.laneScale);
    addMovingBlock(
      new THREE.Vector3(x, FLOOR_THICK / 2 + MOVING_OBSTACLE_H / 2, z),
      obstacle.phase,
      obstacle.speedHz,
      obstacle.width,
      obstacle.length,
    );
  }

  // Zone C: clear line-up section (no obstacles) before the final wall.
  // Zone D: final static wall with three small circular floor-level holes.
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
