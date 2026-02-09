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

type TrackSegmentSpec = {
  pos: [number, number, number];
  rot: [number, number, number];
  size: [number, number, number];
};

const TRACK_SEGMENTS: TrackSegmentSpec[] = [
  { pos: [0, 0, 0], rot: [0, 0, 0], size: [8, 0.6, 8] },
  { pos: [0, -0.7, 8], rot: [0.14, 0.06, 0], size: [8, 0.6, 8] },
  { pos: [1.2, -1.9, 15.5], rot: [0.2, 0.26, 0], size: [8, 0.6, 8] },
  { pos: [3.8, -3.5, 22], rot: [0.22, 0.3, 0], size: [8, 0.6, 8] },
  { pos: [7.4, -5.4, 28.3], rot: [0.18, 0.05, 0], size: [8, 0.6, 9] },
  { pos: [8.5, -6.8, 36.4], rot: [0.15, -0.18, 0], size: [8, 0.6, 8] },
  { pos: [7.1, -8.1, 44], rot: [0.1, -0.28, 0], size: [7.5, 0.6, 7.5] },
];

const RAIL_SEGMENTS: TrackSegmentSpec[] = [
  { pos: [-4.1, 1.1, 3.7], rot: [0, 0, 0], size: [0.45, 2, 7] },
  { pos: [4.1, 1.1, 3.7], rot: [0, 0, 0], size: [0.45, 2, 7] },
  { pos: [-4.4, 0.6, 12.4], rot: [0, 0.08, 0], size: [0.45, 2, 7] },
  { pos: [4.5, 0.4, 12], rot: [0, 0.08, 0], size: [0.45, 2, 7] },
  { pos: [-2.4, -1.2, 19], rot: [0, 0.3, 0], size: [0.45, 2, 6.5] },
  { pos: [6.8, -1.7, 18.7], rot: [0, 0.3, 0], size: [0.45, 2, 6.5] },
  { pos: [0.4, -3.3, 27.2], rot: [0, 0.13, 0], size: [0.45, 2, 8] },
  { pos: [9.1, -4.1, 27.1], rot: [0, 0.13, 0], size: [0.45, 2, 8] },
  { pos: [3.9, -5.9, 35], rot: [0, -0.18, 0], size: [0.45, 2, 7.5] },
  { pos: [12.1, -6.3, 34.8], rot: [0, -0.18, 0], size: [0.45, 2, 7.5] },
  { pos: [3.5, -7.2, 43.2], rot: [0, -0.28, 0], size: [0.45, 2, 6] },
  { pos: [10.8, -7.3, 42.8], rot: [0, -0.28, 0], size: [0.45, 2, 6] },
];

function createTrackPart(
  spec: TrackSegmentSpec,
  material: THREE.Material,
): { mesh: THREE.Mesh; body: CANNON.Body } {
  const [sx, sy, sz] = spec.size;
  const [px, py, pz] = spec.pos;
  const [rx, ry, rz] = spec.rot;

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.position.set(px, py, pz);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const body = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)),
    position: new CANNON.Vec3(px, py, pz),
  });
  body.quaternion.setFromEuler(rx, ry, rz, "XYZ");

  return { mesh, body };
}

export function createTrack(opts?: CreateTrackOptions): TrackBuildResult {
  // Accepted for v0.8 seeded generation; ignored in v0.2 fixed authored track.
  void opts?.seed;

  const group = new THREE.Group();
  group.name = "track";
  const bodies: CANNON.Body[] = [];

  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x2f6b39 });
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa7b2 });

  for (const segment of TRACK_SEGMENTS) {
    const { mesh, body } = createTrackPart(segment, floorMaterial);
    group.add(mesh);
    bodies.push(body);
  }

  for (const rail of RAIL_SEGMENTS) {
    const { mesh, body } = createTrackPart(rail, railMaterial);
    group.add(mesh);
    bodies.push(body);
  }

  const firstSegment = TRACK_SEGMENTS[0];
  const spawn = new CANNON.Vec3(
    firstSegment.pos[0],
    firstSegment.pos[1] + firstSegment.size[1] / 2 + 1.25,
    firstSegment.pos[2] - firstSegment.size[2] / 2 + 1.5,
  );

  return {
    group,
    bodies,
    spawn,
    respawnY: -8,
  };
}
