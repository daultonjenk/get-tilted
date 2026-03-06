import type { TrackPieceTemplate } from "../modularTrack";

// TEMPORARY ARCHIVE: These legacy track definitions are parked here so they are no
// longer used by active track generation. They are likely candidates for deletion
// after the new track generation pipeline is established.

export const LEGACY_BUILTIN_TRACK_PIECES_ARCHIVE: ReadonlyArray<TrackPieceTemplate> = [
  {
    id: "builtin-straight",
    label: "Straight",
    kind: "straight",
    weight: 1.45,
    length: 13,
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
    id: "builtin-arc-left",
    label: "Arc 90 Left",
    kind: "arc90",
    weight: 1,
    length: 14,
    widthScale: 1,
    gradeDeg: 0,
    bankDeg: 8,
    turnDirection: "left",
    turnDeg: 90,
    tunnelRoof: false,
    railLeft: true,
    railRight: true,
  },
  {
    id: "builtin-arc-right",
    label: "Arc 90 Right",
    kind: "arc90",
    weight: 1,
    length: 14,
    widthScale: 1,
    gradeDeg: 0,
    bankDeg: -8,
    turnDirection: "right",
    turnDeg: 90,
    tunnelRoof: false,
    railLeft: true,
    railRight: true,
  },
  {
    id: "builtin-setpiece-arc90-obstacle-1-left",
    label: "Arc 90 Obstacle 1 (Left Set)",
    kind: "arc90",
    weight: 0.52,
    length: 14,
    widthScale: 1,
    gradeDeg: 0,
    bankDeg: 8,
    turnDirection: "left",
    turnDeg: 90,
    tunnelRoof: false,
    railLeft: true,
    railRight: true,
  },
  {
    id: "builtin-setpiece-arc90-obstacle-1-right",
    label: "Arc 90 Obstacle 1 (Right Set)",
    kind: "arc90",
    weight: 0.52,
    length: 14,
    widthScale: 1,
    gradeDeg: 0,
    bankDeg: -8,
    turnDirection: "right",
    turnDeg: 90,
    tunnelRoof: false,
    railLeft: true,
    railRight: true,
  },
];

export const LEGACY_TEST_TRACK_MANUAL_SEQUENCE_ARCHIVE = [
  { kind: "straight-center-hole-respawn" },
  { kind: "finish" },
] as const;

export const LEGACY_TEST_TRACK_LAYOUT_PIECE_LENGTHS_ARCHIVE = {
  "straight-center-hole-respawn": 16,
} as const;

export const LEGACY_TEST_TRACK_SET_PIECE_LENGTHS_ARCHIVE = {
  "straight-center-hole-respawn": 16,
} as const;

export const LEGACY_TEST_TRACK_PIECE_LABELS_ARCHIVE = {
  "straight-center-hole-respawn": "Two-Level Circular Drop",
} as const;

export const LEGACY_TEST_TRACK_OBSTACLE_SLOT_COUNT_BY_KIND_ARCHIVE = {
  "straight-center-hole-respawn": 0,
} as const;

export type LegacyTrackSegmentDef = {
  length: number;
  slopeDeg: number;
  yawDeg: number;
  landingLength?: number;
  railLeft?: boolean;
  railRight?: boolean;
  width?: number;
};

export const LEGACY_SEGMENTS_ARCHIVE: ReadonlyArray<LegacyTrackSegmentDef> = [
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
