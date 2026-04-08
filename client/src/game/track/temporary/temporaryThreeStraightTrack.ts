import type { TrackPieceTemplate } from "../modularTrack";

type AuthoredBlueprintSetPieceKind =
  | "arc90-obstacle-1"
  | "straight-obstacle-1"
  | "straight-tight-triangles"
  | "straight-wide-triangles"
  | "straight-center-hole-respawn";

export type AuthoredBlueprintSetPieceSpec = {
  placementIndex: number;
  testPieceIndex: number;
  kind: AuthoredBlueprintSetPieceKind;
};

export type AuthoredBlueprintSetPieceTuning = {
  pieceObstacleScales?: number[][];
  setPieceLengthScale?: number;
  showObstacleDebugLabels?: boolean;
};

export type TemporarySoloCourseLayout = {
  courseName: string;
  courseTagline: string;
  briefing: string;
  successHint: string;
  forcedMainPieces: TrackPieceTemplate[];
  manualSetPieces: AuthoredBlueprintSetPieceSpec[];
  manualSetPieceTuning?: AuthoredBlueprintSetPieceTuning;
  enableMovingObstacles: boolean;
  movingObstacleSafeStartStraightCount: number;
  enableHoleSetPieces: boolean;
};

export type TemporaryTrackSegmentDef = {
  length: number;
  slopeDeg: number;
  yawDeg: number;
  landingLength?: number;
  railLeft?: boolean;
  railRight?: boolean;
  width?: number;
};

// Default width for fast/non-obstacle runtime sections.
export const DEFAULT_RUNTIME_TRACK_WIDTH = 9;
// Reserved wide width for future obstacle/set-piece expansion.
export const SETPIECE_WIDE_TRACK_WIDTH = 18;
export const SOLO_GAUNTLET_NAME = "Stormrun Gauntlet";
export const SOLO_GAUNTLET_TAGLINE = "A replayable solo sprint with a commit-or-die drop.";

const ARC90_OBSTACLE_SETPIECE_ID_LEFT = "builtin-setpiece-arc90-obstacle-1-left";
const ARC90_OBSTACLE_SETPIECE_ID_RIGHT = "builtin-setpiece-arc90-obstacle-1-right";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeLayoutRandom(seed: string): () => number {
  let state = hashStr(`${seed}-layout`) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTemporaryThreeStraightForcedPieces(seed: string): TrackPieceTemplate[] {
  const random = makeLayoutRandom(seed);
  const pieces: TrackPieceTemplate[] = [];

  // Fixed spawn straight
  pieces.push({
    id: "tmp-spawn",
    label: "Spawn Straight",
    kind: "straight",
    weight: 1,
    length: 12,
    widthScale: 1,
    gradeDeg: 0,
    bankDeg: 0,
    turnDirection: "left",
    turnDeg: 0,
    tunnelRoof: false,
    railLeft: true,
    railRight: true,
  });

  // 3 seeded content blocks
  for (let b = 0; b < 3; b += 1) {
    const roll = random();
    if (roll < 0.4) {
      pieces.push({
        id: `tmp-straight-${b}`,
        label: "Straight",
        kind: "straight",
        weight: 1,
        length: 110,
        widthScale: 1,
        gradeDeg: 0,
        bankDeg: 0,
        turnDirection: "left",
        turnDeg: 0,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      });
    } else if (roll < 0.7) {
      // curve-LR
      pieces.push({
        id: `tmp-cl-${b}`,
        label: "Curve Left",
        kind: "straight",
        weight: 1,
        length: 40,
        widthScale: 1,
        gradeDeg: 0,
        bankDeg: 0,
        turnDirection: "left",
        turnDeg: 25,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      });
      pieces.push({
        id: `tmp-cr-${b}`,
        label: "Curve Right",
        kind: "straight",
        weight: 1,
        length: 40,
        widthScale: 1,
        gradeDeg: 0,
        bankDeg: 0,
        turnDirection: "right",
        turnDeg: 25,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      });
    } else {
      // curve-RL
      pieces.push({
        id: `tmp-cr-${b}`,
        label: "Curve Right",
        kind: "straight",
        weight: 1,
        length: 40,
        widthScale: 1,
        gradeDeg: 0,
        bankDeg: 0,
        turnDirection: "right",
        turnDeg: 25,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      });
      pieces.push({
        id: `tmp-cl-${b}`,
        label: "Curve Left",
        kind: "straight",
        weight: 1,
        length: 40,
        widthScale: 1,
        gradeDeg: 0,
        bankDeg: 0,
        turnDirection: "left",
        turnDeg: 25,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      });
    }
  }

  // Fixed finish straight
  pieces.push({
    id: "tmp-finish",
    label: "Finish Straight",
    kind: "straight",
    weight: 1,
    length: 12,
    widthScale: 1,
    gradeDeg: 0,
    bankDeg: 0,
    turnDirection: "left",
    turnDeg: 0,
    tunnelRoof: false,
    railLeft: true,
    railRight: true,
  });

  return pieces;
}

export function buildSoloGauntletCourse(seed: string): TemporarySoloCourseLayout {
  const random = makeLayoutRandom(seed);
  const arcTurnsLeft = random() < 0.5;
  const arcDirection: "left" | "right" = arcTurnsLeft ? "left" : "right";
  const arcSetPieceId = arcTurnsLeft
    ? ARC90_OBSTACLE_SETPIECE_ID_LEFT
    : ARC90_OBSTACLE_SETPIECE_ID_RIGHT;
  const obstacleStraightLength = 34 + Math.round(random() * 10);
  const slalomLength = 48 + Math.round(random() * 12);
  const recoveryLength = 46 + Math.round(random() * 14);
  const slalomBank = arcTurnsLeft ? -4 : 4;
  const recoveryBank = arcTurnsLeft ? 5 : -5;
  const recoveryGrade = 2.2 + random() * 1.6;
  const introGrade = -1.4 - random() * 1.4;
  const obstacleWidthScale = clamp(1.08 + random() * 0.1, 1.04, 1.18);
  const recoveryWidthScale = clamp(1.04 + random() * 0.16, 1.06, 1.22);

  return {
    courseName: SOLO_GAUNTLET_NAME,
    courseTagline: SOLO_GAUNTLET_TAGLINE,
    briefing: "Learn the blockers, ride the ninety, then commit to the drop for a checkpointed finish sprint.",
    successHint: "Hold your nerve through the drop, then react cleanly to the finish machinery.",
    forcedMainPieces: [
      {
        id: "solo-gauntlet-start",
        label: "Run-Up",
        kind: "straight",
        weight: 1,
        length: 18,
        widthScale: 1.06,
        gradeDeg: 0,
        bankDeg: 0,
        turnDirection: "left",
        turnDeg: 0,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      },
      {
        id: "solo-gauntlet-breaker",
        label: "Breaker Lane",
        kind: "straight",
        weight: 1,
        length: obstacleStraightLength,
        widthScale: obstacleWidthScale,
        gradeDeg: introGrade,
        bankDeg: 0,
        turnDirection: "left",
        turnDeg: 0,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      },
      {
        id: arcSetPieceId,
        label: arcTurnsLeft ? "Pressure Bend Left" : "Pressure Bend Right",
        kind: "arc90",
        weight: 1,
        length: 16,
        widthScale: 1.04,
        gradeDeg: 0,
        bankDeg: arcTurnsLeft ? 9 : -9,
        turnDirection: arcDirection,
        turnDeg: 90,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      },
      {
        id: "solo-gauntlet-slalom",
        label: "Knife-Edge Slalom",
        kind: "straight",
        weight: 1,
        length: slalomLength,
        widthScale: 1,
        gradeDeg: 0,
        bankDeg: slalomBank,
        turnDirection: "left",
        turnDeg: 0,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      },
      {
        id: "solo-gauntlet-drop",
        label: "Commit Drop",
        kind: "straight",
        weight: 1,
        length: 28,
        widthScale: 1.14,
        gradeDeg: -2,
        bankDeg: 0,
        turnDirection: "left",
        turnDeg: 0,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      },
      {
        id: "solo-gauntlet-finish-sprint",
        label: "Storm Sprint",
        kind: "straight",
        weight: 1,
        length: recoveryLength,
        widthScale: recoveryWidthScale,
        gradeDeg: recoveryGrade,
        bankDeg: recoveryBank,
        turnDirection: "left",
        turnDeg: 0,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      },
      {
        id: "solo-gauntlet-finish",
        label: "Finish Straight",
        kind: "straight",
        weight: 1,
        length: 12,
        widthScale: 1.02,
        gradeDeg: 0,
        bankDeg: 0,
        turnDirection: "left",
        turnDeg: 0,
        tunnelRoof: false,
        railLeft: true,
        railRight: true,
      },
    ],
    manualSetPieces: [
      {
        placementIndex: 1,
        testPieceIndex: 1,
        kind: "straight-obstacle-1",
      },
      {
        placementIndex: 5,
        testPieceIndex: 2,
        kind: "straight-tight-triangles",
      },
      {
        placementIndex: 6,
        testPieceIndex: 3,
        kind: "straight-center-hole-respawn",
      },
    ],
    manualSetPieceTuning: {
      setPieceLengthScale: 1.04,
      pieceObstacleScales: [
        [0.9, 0.86, 0.82, 0.74],
        [0.86, 0.9, 0.8, 0.9, 0.86, 0.82],
        [0.68, 0.74, 0.7, 0.76, 0.71, 0.69, 0.73],
        [],
      ],
    },
    enableMovingObstacles: true,
    movingObstacleSafeStartStraightCount: 7,
    enableHoleSetPieces: false,
  };
}

export function buildTestAllForcedPieces(): TrackPieceTemplate[] {
  const pieces: TrackPieceTemplate[] = [];
  // Fixed spawn straight
  pieces.push({ id: "test-spawn", label: "Spawn Straight", kind: "straight", weight: 1,
    length: 12, widthScale: 1, gradeDeg: 0, bankDeg: 0, turnDirection: "left", turnDeg: 0,
    tunnelRoof: false, railLeft: true, railRight: true });
  // Straight with hole (guaranteed)
  pieces.push({ id: "test-straight", label: "Straight", kind: "straight", weight: 1,
    length: 110, widthScale: 1, gradeDeg: 0, bankDeg: 0, turnDirection: "left", turnDeg: 0,
    tunnelRoof: false, railLeft: true, railRight: true });
  // Curve Left → Curve Right
  pieces.push({ id: "test-cl", label: "Curve Left", kind: "straight", weight: 1,
    length: 40, widthScale: 1, gradeDeg: 0, bankDeg: 0, turnDirection: "left", turnDeg: 25,
    tunnelRoof: false, railLeft: true, railRight: true });
  pieces.push({ id: "test-cr", label: "Curve Right", kind: "straight", weight: 1,
    length: 40, widthScale: 1, gradeDeg: 0, bankDeg: 0, turnDirection: "right", turnDeg: 25,
    tunnelRoof: false, railLeft: true, railRight: true });
  // Curve Right → Curve Left
  pieces.push({ id: "test-cr2", label: "Curve Right", kind: "straight", weight: 1,
    length: 40, widthScale: 1, gradeDeg: 0, bankDeg: 0, turnDirection: "right", turnDeg: 25,
    tunnelRoof: false, railLeft: true, railRight: true });
  pieces.push({ id: "test-cl2", label: "Curve Left", kind: "straight", weight: 1,
    length: 40, widthScale: 1, gradeDeg: 0, bankDeg: 0, turnDirection: "left", turnDeg: 25,
    tunnelRoof: false, railLeft: true, railRight: true });
  // Fixed finish straight
  pieces.push({ id: "test-finish", label: "Finish Straight", kind: "straight", weight: 1,
    length: 12, widthScale: 1, gradeDeg: 0, bankDeg: 0, turnDirection: "left", turnDeg: 0,
    tunnelRoof: false, railLeft: true, railRight: true });
  return pieces;
}

export const TEMPORARY_THREE_STRAIGHT_SEGMENTS: ReadonlyArray<TemporaryTrackSegmentDef> = [
  { length: 12, slopeDeg: 0, yawDeg: 0 },
  { length: 350, slopeDeg: 0, yawDeg: 0 },
  { length: 50, slopeDeg: 0, yawDeg: 25 },
  { length: 50, slopeDeg: 0, yawDeg: -25 },
  { length: 12, slopeDeg: 0, yawDeg: 0 },
];
