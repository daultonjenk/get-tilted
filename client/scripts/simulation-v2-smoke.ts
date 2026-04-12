import assert from "node:assert/strict";
import { loadRapier } from "../src/game/simulation-v2/rapierLoader.ts";
import { RapierSimulationV2 } from "../src/game/simulation-v2/rapierSimulationV2.ts";
import type {
  SimulationInput,
  TrackCollisionAsset,
} from "../src/game/simulation-v2/types.ts";

const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];

function createFlatPlaneAsset(): TrackCollisionAsset {
  return {
    spawn: [0, 1.2, -10],
    respawnY: -8,
    offCourseBoundsLocal: {
      minX: -80,
      maxX: 80,
      minZ: -14,
      maxZ: 14,
    },
    containmentPathLocal: Array.from({ length: 9 }, (_, index) => ({
      center: [0, 0, -10 + index * 2.5] as [number, number, number],
      right: [1, 0, 0] as [number, number, number],
      up: [0, 1, 0] as [number, number, number],
      tangent: [0, 0, 1] as [number, number, number],
      halfWidth: 10,
      railLeft: false,
      railRight: false,
    })),
    checkpoints: [],
    staticBodies: [
      {
        id: "floor",
        material: "floor",
        translation: [0, 0, 0],
        rotation: IDENTITY_QUAT,
        shapes: [
          {
            kind: "box",
            translation: [0, -0.3, 0],
            rotation: IDENTITY_QUAT,
            halfExtents: [80, 0.3, 14],
          },
        ],
      },
    ],
    movingBodies: [],
    updateDynamicBodies: () => {},
  };
}

function createCorridorAsset(): TrackCollisionAsset {
  return {
    spawn: [0, 1.2, -9],
    respawnY: -8,
    offCourseBoundsLocal: {
      minX: -3,
      maxX: 3,
      minZ: -12,
      maxZ: 18,
    },
    containmentPathLocal: Array.from({ length: 12 }, (_, index) => ({
      center: [0, 0, -9 + index * 2.2] as [number, number, number],
      right: [1, 0, 0] as [number, number, number],
      up: [0, 1, 0] as [number, number, number],
      tangent: [0, 0, 1] as [number, number, number],
      halfWidth: 2.25,
      railLeft: true,
      railRight: true,
    })),
    checkpoints: [
      {
        spawnPos: [0, 1.2, 2.5],
        sampleIndex: 5,
      },
    ],
    staticBodies: [
      {
        id: "floor",
        material: "floor",
        translation: [0, 0, 0],
        rotation: IDENTITY_QUAT,
        shapes: [
          {
            kind: "box",
            translation: [0, -0.3, 3],
            rotation: IDENTITY_QUAT,
            halfExtents: [2.8, 0.3, 15],
          },
        ],
      },
      {
        id: "wall-left",
        material: "wall",
        translation: [0, 0, 0],
        rotation: IDENTITY_QUAT,
        shapes: [
          {
            kind: "box",
            translation: [-2.75, 0.8, 3],
            rotation: IDENTITY_QUAT,
            halfExtents: [0.25, 1.1, 15],
          },
        ],
      },
      {
        id: "wall-right",
        material: "wall",
        translation: [0, 0, 0],
        rotation: IDENTITY_QUAT,
        shapes: [
          {
            kind: "box",
            translation: [2.75, 0.8, 3],
            rotation: IDENTITY_QUAT,
            halfExtents: [0.25, 1.1, 15],
          },
        ],
      },
      {
        id: "obstacle",
        material: "obstacle",
        translation: [0, 0, 0],
        rotation: IDENTITY_QUAT,
        shapes: [
          {
            kind: "box",
            translation: [0, 0.45, 6],
            rotation: IDENTITY_QUAT,
            halfExtents: [0.7, 0.45, 0.7],
          },
        ],
      },
    ],
    movingBodies: [],
    updateDynamicBodies: () => {},
  };
}

function makeInput(x: number, z: number): SimulationInput {
  return {
    timestampMs: 0,
    tiltIntent: { x: 0, z: 0 },
    fallbackIntent: { x: 0, z: 0 },
    combinedIntent: { x, z },
    paused: false,
  };
}

async function run(): Promise<void> {
  const rapier = await loadRapier();

  {
    const simulation = new RapierSimulationV2({
      rapier,
      trackAsset: createFlatPlaneAsset(),
    });
    for (let step = 0; step < 180; step += 1) {
      simulation.step(makeInput(0.85, 0), 1 / 120);
    }
    const snapshot = simulation.getSnapshot();
    assert(snapshot.marble.position[0] > 1.2, "marble should move laterally on flat ground");
    assert(snapshot.marble.position[1] > 0.35, "marble should remain above the floor");
    simulation.dispose();
  }

  {
    const simulation = new RapierSimulationV2({
      rapier,
      trackAsset: createCorridorAsset(),
    });
    let sawCheckpoint = false;
    let sawObstacleHit = false;
    for (let step = 0; step < 720; step += 1) {
      const result = simulation.step(makeInput(0, 0.95), 1 / 120);
      sawCheckpoint ||= result.events.some((event) => event.type === "checkpoint");
      sawObstacleHit ||= result.events.some((event) => event.type === "obstacle-hit");
      if (sawCheckpoint && sawObstacleHit) {
        break;
      }
    }
    const snapshot = simulation.getSnapshot();
    assert(sawCheckpoint, "corridor run should advance at least one checkpoint");
    assert(sawObstacleHit, "corridor run should report an obstacle collision");
    const resetResult = simulation.resetMarble(undefined, true);
    assert.equal(resetResult.snapshot.respawnCount, 1, "reset should increment respawn count");
    assert.equal(snapshot.checkpoints.lastReachedIndex, 0, "checkpoint state should persist before reset");
    simulation.dispose();
  }

  console.log("simulation-v2 smoke harness passed");
}

void run().catch((error) => {
  console.error("simulation-v2 smoke harness failed");
  console.error(error);
  process.exitCode = 1;
});
