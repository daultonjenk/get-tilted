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

// Active temporary baseline while legacy track content is quarantined.
export const TEMPORARY_ACTIVE_TRACK_PIECE_COUNT = 5;
// Default width for fast/non-obstacle runtime sections.
export const DEFAULT_RUNTIME_TRACK_WIDTH = 9;
// Reserved wide width for future obstacle/set-piece expansion.
export const SETPIECE_WIDE_TRACK_WIDTH = 18;

const TEMPORARY_THREE_STRAIGHT_FORCED_PIECES: ReadonlyArray<TrackPieceTemplate> = [
  {
    id: "temporary-spawn-straight",
    label: "Temporary Spawn Straight",
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
  },
  {
    id: "temporary-middle-straight-long",
    label: "Temporary Middle Straight Long",
    kind: "straight",
    weight: 1,
    length: 350,
    widthScale: 1,
    gradeDeg: 0,
    bankDeg: 0,
    turnDirection: "left",
    turnDeg: 0,
    tunnelRoof: false,
    railLeft: true,
    railRight: true,
  },
  {
    id: "temporary-curve-left-25",
    label: "Temporary Curve Left 25",
    kind: "straight",
    weight: 1,
    length: 50,
    widthScale: 1,
    gradeDeg: 0,
    bankDeg: 0,
    turnDirection: "left",
    turnDeg: 25,
    tunnelRoof: false,
    railLeft: true,
    railRight: true,
  },
  {
    id: "temporary-curve-right-25",
    label: "Temporary Curve Right 25",
    kind: "straight",
    weight: 1,
    length: 50,
    widthScale: 1,
    gradeDeg: 0,
    bankDeg: 0,
    turnDirection: "right",
    turnDeg: 25,
    tunnelRoof: false,
    railLeft: true,
    railRight: true,
  },
  {
    id: "temporary-finish-straight-short",
    label: "Temporary Finish Straight",
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
  },
];

export function buildTemporaryThreeStraightForcedPieces(): TrackPieceTemplate[] {
  return TEMPORARY_THREE_STRAIGHT_FORCED_PIECES.map((piece) => ({ ...piece }));
}

export const TEMPORARY_THREE_STRAIGHT_SEGMENTS: ReadonlyArray<TemporaryTrackSegmentDef> = [
  { length: 12, slopeDeg: 0, yawDeg: 0 },
  { length: 350, slopeDeg: 0, yawDeg: 0 },
  { length: 50, slopeDeg: 0, yawDeg: 25 },
  { length: 50, slopeDeg: 0, yawDeg: -25 },
  { length: 12, slopeDeg: 0, yawDeg: 0 },
];
