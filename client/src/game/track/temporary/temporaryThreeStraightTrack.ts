import type { TrackPieceTemplate } from "../modularTrack";

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

export const TEMPORARY_THREE_STRAIGHT_SEGMENTS: ReadonlyArray<TemporaryTrackSegmentDef> = [
  { length: 12, slopeDeg: 0, yawDeg: 0 },
  { length: 350, slopeDeg: 0, yawDeg: 0 },
  { length: 50, slopeDeg: 0, yawDeg: 25 },
  { length: 50, slopeDeg: 0, yawDeg: -25 },
  { length: 12, slopeDeg: 0, yawDeg: 0 },
];
