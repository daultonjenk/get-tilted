import type RAPIERModule from "@dimforge/rapier3d-compat";
import type { TrackContainmentSample } from "../track/createTrack";
import {
  DEFAULT_SIMULATION_V2_TUNING,
  type SimulationAxisIntent,
  type SimulationEvent,
  type SimulationInput,
  type SimulationQuaternion,
  type SimulationSnapshot,
  type SimulationStepResult,
  type SimulationV2Tuning,
  type SimulationVector3,
  type TrackColliderShapeAsset,
  type TrackCollisionAsset,
  type TrackRigidBodyAsset,
  type TrackRigidBodyMaterial,
} from "./types.ts";

type RapierColliderDesc = InstanceType<typeof RAPIERModule.ColliderDesc>;
type RapierCollider = InstanceType<typeof RAPIERModule.Collider>;
type RapierRigidBody = InstanceType<typeof RAPIERModule.RigidBody>;
type RapierWorld = InstanceType<typeof RAPIERModule.World>;
type RapierEventQueue = InstanceType<typeof RAPIERModule.EventQueue>;

type MovingBodyRuntime = {
  id: string;
  source: TrackRigidBodyAsset;
  rigidBody: RapierRigidBody;
};

type RapierSimulationV2Options = {
  rapier: typeof RAPIERModule;
  trackAsset: TrackCollisionAsset;
  marbleRadius?: number;
};

const IDENTITY_BOARD_POSITION: SimulationVector3 = [0, 0, 0];
const IDENTITY_BOARD_ROTATION: SimulationQuaternion = [0, 0, 0, 1];
const VISUAL_TILT_SMOOTH = 10;
const DEFAULT_TRACK_BASIS = {
  sampleIndex: 0,
  right: [1, 0, 0] as SimulationVector3,
  up: [0, 1, 0] as SimulationVector3,
  tangent: [0, 0, 1] as SimulationVector3,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lengthSq(x: number, y: number, z: number): number {
  return x * x + y * y + z * z;
}

function normalizeVector(vector: SimulationVector3): SimulationVector3 {
  const [x, y, z] = vector;
  const lenSq = lengthSq(x, y, z);
  if (lenSq <= 1e-12) {
    return [0, 0, 0];
  }
  const invLen = 1 / Math.sqrt(lenSq);
  return [x * invLen, y * invLen, z * invLen];
}

function scale(a: SimulationVector3, factor: number): SimulationVector3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function add(a: SimulationVector3, b: SimulationVector3): SimulationVector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function toVector3Tuple(
  vector: { x: number; y: number; z: number },
): SimulationVector3 {
  return [vector.x, vector.y, vector.z];
}

function toQuaternionTuple(
  quaternion: { x: number; y: number; z: number; w: number },
): SimulationQuaternion {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function quaternionFromPitchRoll(
  pitch: number,
  roll: number,
): SimulationQuaternion {
  const halfPitch = pitch * 0.5;
  const halfRoll = roll * 0.5;
  const sinPitch = Math.sin(halfPitch);
  const cosPitch = Math.cos(halfPitch);
  const sinRoll = Math.sin(halfRoll);
  const cosRoll = Math.cos(halfRoll);
  return [
    sinPitch * cosRoll,
    -sinPitch * sinRoll,
    cosPitch * sinRoll,
    cosPitch * cosRoll,
  ];
}

function createColliderDesc(
  rapier: typeof RAPIERModule,
  shape: TrackColliderShapeAsset,
): RapierColliderDesc {
  let desc: RapierColliderDesc;
  if (shape.kind === "box") {
    desc = rapier.ColliderDesc.cuboid(
      shape.halfExtents[0],
      shape.halfExtents[1],
      shape.halfExtents[2],
    );
  } else if (shape.kind === "sphere") {
    desc = rapier.ColliderDesc.ball(shape.radius);
  } else {
    desc = rapier.ColliderDesc.trimesh(
      new Float32Array(shape.vertices),
      new Uint32Array(shape.indices),
    );
  }

  desc.setTranslation(
    shape.translation[0],
    shape.translation[1],
    shape.translation[2],
  );
  desc.setRotation({
    x: shape.rotation[0],
    y: shape.rotation[1],
    z: shape.rotation[2],
    w: shape.rotation[3],
  });
  return desc;
}

function readMaterialProperties(
  material: TrackRigidBodyMaterial,
  tuning: SimulationV2Tuning,
): { friction: number; restitution: number } {
  if (material === "floor") {
    return {
      friction: tuning.floorFriction,
      restitution: 0,
    };
  }
  if (material === "wall") {
    return {
      friction: 0,
      restitution: tuning.railRestitution,
    };
  }
  return {
    friction: tuning.obstacleFriction,
    restitution: tuning.obstacleRestitution,
  };
}

function findNearestContainmentIndex(
  samples: TrackContainmentSample[],
  localPos: SimulationVector3,
  currentIndex: number,
): number {
  if (samples.length === 0) {
    return 0;
  }

  const lastIndex = samples.length - 1;
  const safeIndex = clamp(currentIndex, 0, lastIndex);
  let bestIndex = safeIndex;
  let bestDistSq = Number.POSITIVE_INFINITY;
  const windowRadius = 18;
  const minIndex = Math.max(0, safeIndex - windowRadius);
  const maxIndex = Math.min(lastIndex, safeIndex + windowRadius);

  for (let index = minIndex; index <= maxIndex; index += 1) {
    const sample = samples[index];
    if (!sample) {
      continue;
    }
    const dx = localPos[0] - sample.center[0];
    const dy = localPos[1] - sample.center[1];
    const dz = localPos[2] - sample.center[2];
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function normalizeIntent(intent: SimulationAxisIntent): SimulationAxisIntent {
  return {
    x: clamp(intent.x, -1, 1),
    z: clamp(intent.z, -1, 1),
  };
}

export class RapierSimulationV2 {
  private readonly rapier: typeof RAPIERModule;
  private readonly world: RapierWorld;
  private readonly eventQueue: RapierEventQueue;
  private readonly trackAsset: TrackCollisionAsset;
  private readonly marbleRadius: number;
  private readonly marbleBody: RapierRigidBody;
  private readonly marbleCollider: RapierCollider;
  private readonly marbleColliderHandle: number;
  private readonly movingBodies: MovingBodyRuntime[] = [];
  private readonly trackColliders: Array<{
    collider: RapierCollider;
    material: TrackRigidBodyMaterial;
  }> = [];
  private readonly colliderHandleToObstacleId = new Map<number, string>();
  private readonly tuning: SimulationV2Tuning = {
    ...DEFAULT_SIMULATION_V2_TUNING,
  };
  private nearestContainmentIndex = 0;
  private lastCheckpointIndex = -1;
  private respawnCount = 0;
  private frozen = false;
  private visualPitch = 0;
  private visualRoll = 0;
  private latestSnapshot: SimulationSnapshot;

  constructor(options: RapierSimulationV2Options) {
    this.rapier = options.rapier;
    this.trackAsset = options.trackAsset;
    this.marbleRadius = options.marbleRadius ?? 0.5;
    this.world = new this.rapier.World({
      x: 0,
      y: -this.tuning.gravityMagnitude,
      z: 0,
    });
    this.eventQueue = new this.rapier.EventQueue(true);

    for (const body of this.trackAsset.staticBodies) {
      this.createTrackBody(body, false);
    }

    for (const body of this.trackAsset.movingBodies) {
      this.movingBodies.push(this.createMovingBody(body));
    }

    const marbleDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(
        this.trackAsset.spawn[0],
        this.trackAsset.spawn[1],
        this.trackAsset.spawn[2],
      )
      .setLinearDamping(this.tuning.linearDamping)
      .setAngularDamping(this.tuning.angularDamping)
      .setCcdEnabled(this.tuning.ccdEnabled)
      .setCanSleep(false);
    this.marbleBody = this.world.createRigidBody(marbleDesc);

    const marbleColliderDesc = this.rapier.ColliderDesc.ball(this.marbleRadius)
      .setFriction(this.tuning.floorFriction)
      .setRestitution(0)
      .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS);
    this.marbleCollider = this.world.createCollider(
      marbleColliderDesc,
      this.marbleBody,
    );
    this.marbleColliderHandle = this.marbleCollider.handle;

    this.latestSnapshot = this.captureSnapshot();
  }

  getSnapshot(): SimulationSnapshot {
    return this.latestSnapshot;
  }

  setFrozen(frozen: boolean): void {
    if (this.frozen === frozen) {
      return;
    }
    this.frozen = frozen;
    if (frozen) {
      this.marbleBody.setBodyType(this.rapier.RigidBodyType.Fixed, true);
      this.marbleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.marbleBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else {
      this.marbleBody.setBodyType(this.rapier.RigidBodyType.Dynamic, true);
      this.marbleBody.setTranslation(
        {
          x: this.latestSnapshot.marble.position[0],
          y: this.latestSnapshot.marble.position[1],
          z: this.latestSnapshot.marble.position[2],
        },
        true,
      );
      this.marbleBody.enableCcd(this.tuning.ccdEnabled);
      this.marbleBody.wakeUp();
    }
    this.latestSnapshot = this.captureSnapshot();
  }

  resetMarble(
    spawn: SimulationVector3 = this.trackAsset.spawn,
    incrementRespawnCount = false,
  ): SimulationStepResult {
    if (incrementRespawnCount) {
      this.respawnCount += 1;
    }
    this.marbleBody.setTranslation(
      { x: spawn[0], y: spawn[1], z: spawn[2] },
      true,
    );
    this.marbleBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.marbleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.marbleBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.marbleBody.wakeUp();
    this.nearestContainmentIndex = 0;

    const events: SimulationEvent[] = [
      {
        type: "respawned",
        count: this.respawnCount,
        spawn,
      },
    ];
    this.latestSnapshot = this.captureSnapshot();
    return {
      snapshot: this.latestSnapshot,
      events,
    };
  }

  step(
    input: SimulationInput,
    fixedDt: number,
    partialTuning?: Partial<SimulationV2Tuning>,
  ): SimulationStepResult {
    this.applyTuning(partialTuning);

    if (input.resetRequested) {
      return this.resetMarble();
    }

    this.setFrozen(Boolean(input.paused));
    this.syncMovingBodies(fixedDt);
    const combinedIntent = this.resolveCombinedIntent(input);
    this.updateVisualTilt(input.paused ? { x: 0, z: 0 } : combinedIntent, fixedDt);

    if (!this.frozen) {
      const gravity = this.resolveGravityVector(combinedIntent);
      this.world.gravity.x = gravity[0];
      this.world.gravity.y = gravity[1];
      this.world.gravity.z = gravity[2];
      this.world.step(this.eventQueue);
      this.enforceMaxSpeed();
    }

    const events = this.collectEvents();
    this.updateCheckpointProgress(events);
    this.latestSnapshot = this.captureSnapshot();
    return {
      snapshot: this.latestSnapshot,
      events,
    };
  }

  dispose(): void {
    this.eventQueue.free();
    this.world.free();
  }

  private createTrackBody(
    body: TrackRigidBodyAsset,
    activeCollisionEvents: boolean,
  ): void {
    const rigidBodyDesc = this.rapier.RigidBodyDesc.fixed()
      .setTranslation(body.translation[0], body.translation[1], body.translation[2])
      .setRotation({
        x: body.rotation[0],
        y: body.rotation[1],
        z: body.rotation[2],
        w: body.rotation[3],
      });
    const rigidBody = this.world.createRigidBody(rigidBodyDesc);
    const materialProps = readMaterialProperties(body.material, this.tuning);

    for (const shape of body.shapes) {
      const colliderDesc = createColliderDesc(this.rapier, shape)
        .setFriction(materialProps.friction)
        .setRestitution(materialProps.restitution);
      if (activeCollisionEvents) {
        colliderDesc.setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS);
      }
      const collider = this.world.createCollider(colliderDesc, rigidBody);
      this.trackColliders.push({ collider, material: body.material });
      if (body.material === "obstacle") {
        this.colliderHandleToObstacleId.set(collider.handle, body.id);
      }
    }
  }

  private createMovingBody(body: TrackRigidBodyAsset): MovingBodyRuntime {
    const rigidBodyDesc = this.rapier.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(body.translation[0], body.translation[1], body.translation[2])
      .setRotation({
        x: body.rotation[0],
        y: body.rotation[1],
        z: body.rotation[2],
        w: body.rotation[3],
      });
    const rigidBody = this.world.createRigidBody(rigidBodyDesc);
    const materialProps = readMaterialProperties(body.material, this.tuning);

    for (const shape of body.shapes) {
      const colliderDesc = createColliderDesc(this.rapier, shape)
        .setFriction(materialProps.friction)
        .setRestitution(materialProps.restitution)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS);
      const collider = this.world.createCollider(colliderDesc, rigidBody);
      this.trackColliders.push({ collider, material: body.material });
      this.colliderHandleToObstacleId.set(collider.handle, body.id);
    }

    return {
      id: body.id,
      source: body,
      rigidBody,
    };
  }

  private applyTuning(partialTuning?: Partial<SimulationV2Tuning>): void {
    if (!partialTuning) {
      return;
    }
    Object.assign(this.tuning, partialTuning);
    this.marbleBody.setLinearDamping(this.tuning.linearDamping);
    this.marbleBody.setAngularDamping(this.tuning.angularDamping);
    this.marbleBody.enableCcd(this.tuning.ccdEnabled);
    this.marbleCollider.setFriction(this.tuning.floorFriction);
    this.marbleCollider.setRestitution(0);
    for (const entry of this.trackColliders) {
      const materialProps = readMaterialProperties(entry.material, this.tuning);
      entry.collider.setFriction(materialProps.friction);
      entry.collider.setRestitution(materialProps.restitution);
    }
  }

  private syncMovingBodies(fixedDt: number): void {
    this.trackAsset.updateDynamicBodies(fixedDt);
    for (const entry of this.movingBodies) {
      const sourceBody = entry.source.sourceBody;
      if (!sourceBody) {
        continue;
      }
      entry.rigidBody.setNextKinematicTranslation({
        x: sourceBody.position.x,
        y: sourceBody.position.y,
        z: sourceBody.position.z,
      });
      entry.rigidBody.setNextKinematicRotation({
        x: sourceBody.quaternion.x,
        y: sourceBody.quaternion.y,
        z: sourceBody.quaternion.z,
        w: sourceBody.quaternion.w,
      });
    }
  }

  private resolveCombinedIntent(input: SimulationInput): SimulationAxisIntent {
    return input.combinedIntent
      ? normalizeIntent(input.combinedIntent)
      : normalizeIntent({
          x: input.tiltIntent.x + input.fallbackIntent.x,
          z: input.tiltIntent.z + input.fallbackIntent.z,
        });
  }

  private resolveGravityVector(
    combinedIntent: SimulationAxisIntent,
  ): SimulationVector3 {
    const translation = this.marbleBody.translation();
    const localPos = toVector3Tuple(translation);
    const basis = this.resolveTrackBasis(localPos);
    const maxTiltRad = (this.tuning.maxTiltDeg * Math.PI) / 180;
    const controlAcceleration =
      this.tuning.gravityMagnitude *
      Math.sin(maxTiltRad) *
      this.tuning.controlStrength;

    const downComponent = scale(basis.up, -this.tuning.gravityMagnitude);
    const lateralComponent = scale(
      basis.right,
      combinedIntent.x * controlAcceleration,
    );
    const forwardComponent = scale(
      basis.tangent,
      combinedIntent.z * controlAcceleration,
    );

    return add(add(downComponent, lateralComponent), forwardComponent);
  }

  private updateVisualTilt(
    combinedIntent: SimulationAxisIntent,
    fixedDt: number,
  ): void {
    const visualTiltRad = ((this.tuning.maxTiltDeg * 0.92) * Math.PI) / 180;
    const targetPitch = combinedIntent.z * visualTiltRad;
    const targetRoll = -combinedIntent.x * visualTiltRad;
    const alpha = 1 - Math.exp(-VISUAL_TILT_SMOOTH * fixedDt);
    this.visualPitch += (targetPitch - this.visualPitch) * alpha;
    this.visualRoll += (targetRoll - this.visualRoll) * alpha;
  }

  private enforceMaxSpeed(): void {
    const velocity = this.marbleBody.linvel();
    const speedSq = lengthSq(velocity.x, velocity.y, velocity.z);
    const maxSpeedSq = this.tuning.maxSpeed * this.tuning.maxSpeed;
    if (speedSq <= maxSpeedSq || speedSq <= 1e-12) {
      return;
    }

    const scaleFactor = this.tuning.maxSpeed / Math.sqrt(speedSq);
    this.marbleBody.setLinvel(
      {
        x: velocity.x * scaleFactor,
        y: velocity.y * scaleFactor,
        z: velocity.z * scaleFactor,
      },
      true,
    );
  }

  private resolveTrackBasis(localPos: SimulationVector3): {
    sampleIndex: number;
    right: SimulationVector3;
    up: SimulationVector3;
    tangent: SimulationVector3;
  } {
    const samples = this.trackAsset.containmentPathLocal;
    if (samples.length === 0) {
      this.nearestContainmentIndex = 0;
      return DEFAULT_TRACK_BASIS;
    }

    this.nearestContainmentIndex = findNearestContainmentIndex(
      samples,
      localPos,
      this.nearestContainmentIndex,
    );
    const sample = samples[this.nearestContainmentIndex];
    if (!sample) {
      return DEFAULT_TRACK_BASIS;
    }

    return {
      sampleIndex: this.nearestContainmentIndex,
      right: normalizeVector(sample.right),
      up: normalizeVector(sample.up),
      tangent: normalizeVector(sample.tangent),
    };
  }

  private updateCheckpointProgress(events: SimulationEvent[]): void {
    const checkpoints = this.trackAsset.checkpoints;
    if (checkpoints.length === 0) {
      return;
    }

    for (
      let checkpointIndex = this.lastCheckpointIndex + 1;
      checkpointIndex < checkpoints.length;
      checkpointIndex += 1
    ) {
      const checkpoint = checkpoints[checkpointIndex];
      if (!checkpoint) {
        continue;
      }
      if (this.nearestContainmentIndex >= checkpoint.sampleIndex) {
        this.lastCheckpointIndex = checkpointIndex;
        events.push({
          type: "checkpoint",
          index: checkpointIndex,
          sampleIndex: checkpoint.sampleIndex,
        });
      } else {
        break;
      }
    }
  }

  private collectEvents(): SimulationEvent[] {
    const events: SimulationEvent[] = [];
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (!started) {
        return;
      }
      const obstacleIdA = this.colliderHandleToObstacleId.get(handle1);
      const obstacleIdB = this.colliderHandleToObstacleId.get(handle2);
      if (handle1 === this.marbleColliderHandle && obstacleIdB) {
        events.push({ type: "obstacle-hit", obstacleId: obstacleIdB });
      } else if (handle2 === this.marbleColliderHandle && obstacleIdA) {
        events.push({ type: "obstacle-hit", obstacleId: obstacleIdA });
      }
    });
    return events;
  }

  private captureSnapshot(): SimulationSnapshot {
    const translation = this.marbleBody.translation();
    const rotation = this.marbleBody.rotation();
    const velocity = this.marbleBody.linvel();
    const angularVelocity = this.marbleBody.angvel();
    const localPos = toVector3Tuple(translation);
    const basis = this.resolveTrackBasis(localPos);

    return {
      marble: {
        position: localPos,
        rotation: toQuaternionTuple(rotation),
        velocity: toVector3Tuple(velocity),
        angularVelocity: toVector3Tuple(angularVelocity),
      },
      board: {
        position: IDENTITY_BOARD_POSITION,
        rotation:
          this.visualPitch === 0 && this.visualRoll === 0
            ? IDENTITY_BOARD_ROTATION
            : quaternionFromPitchRoll(this.visualPitch, this.visualRoll),
      },
      trackBasis: basis,
      checkpoints: {
        lastReachedIndex: this.lastCheckpointIndex,
        total: this.trackAsset.checkpoints.length,
      },
      respawnCount: this.respawnCount,
      frozen: this.frozen,
      movingObstacles: this.movingBodies.map((entry) => {
        const rigidBodyTranslation = entry.rigidBody.translation();
        const rigidBodyRotation = entry.rigidBody.rotation();
        return {
          id: entry.id,
          position: toVector3Tuple(rigidBodyTranslation),
          rotation: toQuaternionTuple(rigidBodyRotation),
        };
      }),
    };
  }
}
