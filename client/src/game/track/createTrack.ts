import * as THREE from "three";
import * as CANNON from "cannon-es";
import trackSurfaceUrl from "../../assets/textures/track/track-surface.png";

export type CreateTrackOptions = {
  seed?: string;
};

export type TrackBuildResult = {
  group: THREE.Group;
  bodies: CANNON.Body[];
  spawn: CANNON.Vec3;
  respawnY: number;
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
  isFinish?: boolean;
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

type MovingObstacle = {
  visual: THREE.Object3D;
  body: CANNON.Body;
  baseLocalPos: CANNON.Vec3;
  localQuat: CANNON.Quaternion;
  minX: number;
  maxX: number;
  phase: number;
  speedHz: number;
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
const SLALOM_COUNT = 6;
const SLALOM_OBSTACLE_W = 3.6;
const SLALOM_OBSTACLE_H = 1.8;
const SLALOM_OBSTACLE_L = 0.8;
const MOVING_OBSTACLE_SPEED_HZ = 0.18;
const WALL_CLEARANCE = 0.2;

const FINAL_OBSTACLE_TOTAL_W = 8.4;
const FINAL_OBSTACLE_TOTAL_H = 3.2;
const FINAL_OBSTACLE_DEPTH = 1.2;
const FINAL_OBSTACLE_HOLE_W = 2.0;
const FINAL_OBSTACLE_HOLE_H = 2.0;
const FINAL_OBSTACLE_TOP_H = FINAL_OBSTACLE_TOTAL_H - FINAL_OBSTACLE_HOLE_H;
const FINAL_OBSTACLE_SIDE_W = (FINAL_OBSTACLE_TOTAL_W - FINAL_OBSTACLE_HOLE_W) / 2;

const SEGMENTS: SegmentDef[] = [
  { length: 9, slopeDeg: 0, yawDeg: 0 },
  { length: 10, slopeDeg: 0, yawDeg: 0 },
  { length: 8, slopeDeg: 0, yawDeg: 0, landingLength: 3 },
  { length: 10, slopeDeg: 0, yawDeg: 0 },
  { length: 9, slopeDeg: 0, yawDeg: 0 },
  { length: 8, slopeDeg: 0, yawDeg: 0, landingLength: 3 },
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
      // Top/bottom faces: stretch one texture across the whole floor segment.
      uv.setXY(i, px / size.x + 0.5, pz / size.z + 0.5);
      continue;
    }

    if (nx >= nz) {
      // Side faces: tile by world units so edge grain doesn't get over-stretched.
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

export function createTrack(opts?: CreateTrackOptions): TrackBuildResult {
  // Accepted for v0.8 seeded generation; ignored in v0.3.x fixed authored track.
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
  });

  let currentYawDeg = 0;
  let lowestFloorY = 0;

  const movingObstacles: MovingObstacle[] = [];
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
    const rotation = new THREE.Euler(
      degToRad(slopeDeg),
      degToRad(currentYawDeg),
      0,
      "XYZ",
    );

    const forward = new THREE.Vector3(0, 0, 1).applyEuler(rotation).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyEuler(rotation).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyEuler(rotation).normalize();

    const segmentEndTopPoint = pathStartTopPoint
      .clone()
      .addScaledVector(forward, length);
    const topCenter = pathStartTopPoint
      .clone()
      .add(segmentEndTopPoint)
      .multiplyScalar(0.5);
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

  const createMovingObstacleBounds = (trackWidth: number, obstacleWidth: number): {
    minX: number;
    maxX: number;
  } => {
    const maxAbsX =
      trackWidth / 2 - RAIL_THICK - obstacleWidth / 2 - WALL_CLEARANCE;
    const clamped = Math.max(maxAbsX, 0);
    return { minX: -clamped, maxX: clamped };
  };

  const addMovingObstacle = (
    localPos: THREE.Vector3,
    size: THREE.Vector3,
    phase: number,
    speedHz = MOVING_OBSTACLE_SPEED_HZ,
  ): void => {
    const mesh = addVisualPart(group, {
      size,
      position: localPos,
      rotation: new THREE.Euler(0, 0, 0, "XYZ"),
      material: obstacleMaterial,
      uvScale: [Math.max(size.x, 1), Math.max(size.z, 1)],
      outline: { color: 0x000000, scale: 1.002 },
    });
    const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    body.addShape(new CANNON.Box(halfExtents));

    const bounds = createMovingObstacleBounds(TRACK_W, size.x);
    const startX = Math.min(Math.max(localPos.x, bounds.minX), bounds.maxX);
    const localStart = new CANNON.Vec3(startX, localPos.y, localPos.z);
    body.position.set(localStart.x, localStart.y, localStart.z);
    body.quaternion.set(0, 0, 0, 1);
    body.aabbNeedsUpdate = true;
    body.updateAABB();

    mesh.position.x = startX;

    movingObstacles.push({
      visual: mesh,
      body,
      baseLocalPos: localStart,
      localQuat: new CANNON.Quaternion(0, 0, 0, 1),
      minX: bounds.minX,
      maxX: bounds.maxX,
      phase,
      speedHz,
    });
    movingObstacleBodies.push(body);
  };

  const addMovingFinalObstacle = (localPos: THREE.Vector3, phase: number): void => {
    const obstacleGroup = new THREE.Group();
    obstacleGroup.position.copy(localPos);
    group.add(obstacleGroup);

    const pillarY = -FINAL_OBSTACLE_TOTAL_H / 2 + FINAL_OBSTACLE_HOLE_H / 2;
    const topY = FINAL_OBSTACLE_TOTAL_H / 2 - FINAL_OBSTACLE_TOP_H / 2;
    const sideX = FINAL_OBSTACLE_TOTAL_W / 2 - FINAL_OBSTACLE_SIDE_W / 2;

    const addFinalPiece = (size: THREE.Vector3, position: THREE.Vector3): void => {
      const mesh = addVisualPart(obstacleGroup, {
        size,
        position,
        rotation: new THREE.Euler(0, 0, 0, "XYZ"),
        material: obstacleMaterial,
        uvScale: [Math.max(size.x, 1), Math.max(size.z, 1)],
        outline: { color: 0x000000, scale: 1.002 },
      });
      mesh.castShadow = false;
    };

    addFinalPiece(
      new THREE.Vector3(FINAL_OBSTACLE_SIDE_W, FINAL_OBSTACLE_HOLE_H, FINAL_OBSTACLE_DEPTH),
      new THREE.Vector3(-sideX, pillarY, 0),
    );
    addFinalPiece(
      new THREE.Vector3(FINAL_OBSTACLE_SIDE_W, FINAL_OBSTACLE_HOLE_H, FINAL_OBSTACLE_DEPTH),
      new THREE.Vector3(sideX, pillarY, 0),
    );
    addFinalPiece(
      new THREE.Vector3(FINAL_OBSTACLE_TOTAL_W, FINAL_OBSTACLE_TOP_H, FINAL_OBSTACLE_DEPTH),
      new THREE.Vector3(0, topY, 0),
    );

    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    body.addShape(
      new CANNON.Box(
        new CANNON.Vec3(
          FINAL_OBSTACLE_SIDE_W / 2,
          FINAL_OBSTACLE_HOLE_H / 2,
          FINAL_OBSTACLE_DEPTH / 2,
        ),
      ),
      new CANNON.Vec3(-sideX, pillarY, 0),
    );
    body.addShape(
      new CANNON.Box(
        new CANNON.Vec3(
          FINAL_OBSTACLE_SIDE_W / 2,
          FINAL_OBSTACLE_HOLE_H / 2,
          FINAL_OBSTACLE_DEPTH / 2,
        ),
      ),
      new CANNON.Vec3(sideX, pillarY, 0),
    );
    body.addShape(
      new CANNON.Box(
        new CANNON.Vec3(
          FINAL_OBSTACLE_TOTAL_W / 2,
          FINAL_OBSTACLE_TOP_H / 2,
          FINAL_OBSTACLE_DEPTH / 2,
        ),
      ),
      new CANNON.Vec3(0, topY, 0),
    );

    const bounds = createMovingObstacleBounds(FINISH_WIDTH, FINAL_OBSTACLE_TOTAL_W);
    const startX = Math.min(Math.max(localPos.x, bounds.minX), bounds.maxX);
    const localStart = new CANNON.Vec3(startX, localPos.y, localPos.z);
    body.position.set(localStart.x, localStart.y, localStart.z);
    body.quaternion.set(0, 0, 0, 1);
    body.aabbNeedsUpdate = true;
    body.updateAABB();

    obstacleGroup.position.x = startX;

    movingObstacles.push({
      visual: obstacleGroup,
      body,
      baseLocalPos: localStart,
      localQuat: new CANNON.Quaternion(0, 0, 0, 1),
      minX: bounds.minX,
      maxX: bounds.maxX,
      phase,
      speedHz: MOVING_OBSTACLE_SPEED_HZ * 0.85,
    });
    movingObstacleBodies.push(body);
  };

  const tempOffset = new CANNON.Vec3();
  const tempWorldPos = new CANNON.Vec3();
  const tempWorldQuat = new CANNON.Quaternion();

  const updateMovingObstacles = (
    fixedDt: number,
    boardPos: CANNON.Vec3,
    boardQuat: CANNON.Quaternion,
  ): void => {
    for (const obstacle of movingObstacles) {
      obstacle.phase += fixedDt * obstacle.speedHz * Math.PI * 2;
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
    for (const obstacle of movingObstacles) {
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

  const finishSegment: SegmentDef = {
    length: FINISH_LENGTH,
    slopeDeg: 0,
    yawDeg: 0,
    width: FINISH_WIDTH,
    isFinish: true,
  };

  currentYawDeg += finishSegment.yawDeg;
  addSegment({
    length: finishSegment.length,
    slopeDeg: finishSegment.slopeDeg,
    width: finishSegment.width,
    railLeft: true,
    railRight: true,
  });

  // Keep floor visuals segmented, but use one collider slab for seamless rolling.
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
  const slalomStartZ = trialStartZ + 6;
  const slalomEndZ = trialFinishZ - 6;
  const slalomSpan = Math.max(slalomEndZ - slalomStartZ, 1);

  for (let i = 0; i < SLALOM_COUNT; i += 1) {
    const t = i / (SLALOM_COUNT - 1);
    const z = slalomStartZ + slalomSpan * t;
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (TRACK_W / 2 - SLALOM_OBSTACLE_W / 2 - 0.35);
    const y = FLOOR_THICK / 2 + SLALOM_OBSTACLE_H / 2;

    addMovingObstacle(
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(SLALOM_OBSTACLE_W, SLALOM_OBSTACLE_H, SLALOM_OBSTACLE_L),
      t * Math.PI * 1.15,
    );
  }

  const finalObstacleY = FLOOR_THICK / 2 + FINAL_OBSTACLE_TOTAL_H / 2;
  const finalObstacleZ = trialFinishZ - 2.4;
  addMovingFinalObstacle(new THREE.Vector3(0, finalObstacleY, finalObstacleZ), Math.PI * 0.35);

  addVisualPart(group, {
    size: new THREE.Vector3(TRACK_W + 0.8, MARKER_THICK, 0.45),
    position: new THREE.Vector3(
      0,
      FLOOR_THICK / 2 + MARKER_THICK / 2 + 0.01,
      trialStartZ,
    ),
    rotation: new THREE.Euler(0, 0, 0, "XYZ"),
    material: startMarkerMaterial,
  });

  addVisualPart(group, {
    size: new THREE.Vector3(FINISH_WIDTH + 1.2, MARKER_THICK, 0.55),
    position: new THREE.Vector3(
      0,
      FLOOR_THICK / 2 + MARKER_THICK / 2 + 0.01,
      trialFinishZ,
    ),
    rotation: new THREE.Euler(0, 0, 0, "XYZ"),
    material: finishMarkerMaterial,
  });

  updateMovingObstacles(0, boardBody.position, boardBody.quaternion);

  return {
    group,
    bodies: [boardBody, ...movingObstacleBodies],
    spawn: new CANNON.Vec3(spawn.x, spawn.y, spawn.z),
    respawnY: lowestFloorY - 6,
    trialStartZ,
    trialFinishZ,
    updateMovingObstacles,
    setMovingObstacleMaterial,
  };
}
