import * as THREE from "three";
import * as CANNON from "cannon-es";

export type CreateTrackOptions = {
  seed?: string;
};

export type TrackBuildResult = {
  group: THREE.Group;
  bodies: CANNON.Body[];
  spawn: CANNON.Vec3;
  respawnY: number;
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
};

const TRACK_W = 6;
const FLOOR_THICK = 0.5;
const RAIL_THICK = 0.35;
const RAIL_H = 2.0;
const RAIL_INSET = 0.15;
const RAIL_FLOOR_OVERLAP = 0.08;
const FLOOR_COLOR = 0x2f6b39;
const RAIL_COLOR = 0x9aa7b2;
const MARBLE_RADIUS = 0.5;
const START_LENGTH = 8;
const FINISH_LENGTH = 10;
const FINISH_WIDTH = 8;

const SEGMENTS: SegmentDef[] = [
  { length: 9, slopeDeg: 7, yawDeg: 0 },
  { length: 10, slopeDeg: 10, yawDeg: 8 },
  { length: 8, slopeDeg: 12, yawDeg: -10, landingLength: 3 },
  { length: 10, slopeDeg: 9, yawDeg: 10 },
  { length: 9, slopeDeg: 11, yawDeg: -8 },
  { length: 8, slopeDeg: 7, yawDeg: 0, landingLength: 3 },
];

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function createPart(spec: PartSpec): { mesh: THREE.Mesh; body: CANNON.Body } {
  const { size, position, rotation, material } = spec;

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    material,
  );
  mesh.position.copy(position);
  mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const body = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(
      new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2),
    ),
    position: new CANNON.Vec3(position.x, position.y, position.z),
  });
  body.quaternion.setFromEuler(rotation.x, rotation.y, rotation.z, "XYZ");

  return { mesh, body };
}

export function createTrack(opts?: CreateTrackOptions): TrackBuildResult {
  // Accepted for v0.8 seeded generation; ignored in v0.2.x fixed authored track.
  void opts?.seed;

  const group = new THREE.Group();
  group.name = "track";
  const bodies: CANNON.Body[] = [];

  const floorMaterial = new THREE.MeshStandardMaterial({ color: FLOOR_COLOR });
  const railMaterial = new THREE.MeshStandardMaterial({ color: RAIL_COLOR });

  let currentYawDeg = 0;
  let lowestFloorY = 0;

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

    const floor = createPart({
      size: new THREE.Vector3(width, FLOOR_THICK, length),
      position: floorCenter,
      rotation,
      material: floorMaterial,
    });
    group.add(floor.mesh);
    bodies.push(floor.body);

    lowestFloorY = Math.min(lowestFloorY, floorCenter.y);

    const sideOffset = width / 2 - RAIL_INSET;
    const verticalOffset = RAIL_H / 2 - FLOOR_THICK / 2 + RAIL_FLOOR_OVERLAP;

    const addRail = (direction: -1 | 1) => {
      const railCenter = floorCenter
        .clone()
        .addScaledVector(right, sideOffset * direction)
        .addScaledVector(up, verticalOffset);

      const rail = createPart({
        size: new THREE.Vector3(RAIL_THICK, RAIL_H, length),
        position: railCenter,
        rotation,
        material: railMaterial,
      });
      group.add(rail.mesh);
      bodies.push(rail.body);
    };

    if (railLeft) addRail(-1);
    if (railRight) addRail(1);

    pathStartTopPoint.copy(segmentEndTopPoint);
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

  const spawn = startTopBackPoint
    .clone()
    .addScaledVector(startForward, 1.8)
    .add(new THREE.Vector3(0, MARBLE_RADIUS + 0.6, 0));

  return {
    group,
    bodies,
    spawn: new CANNON.Vec3(spawn.x, spawn.y, spawn.z),
    respawnY: lowestFloorY - 6,
  };
}
