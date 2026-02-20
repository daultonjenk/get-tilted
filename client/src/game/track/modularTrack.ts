export type TrackPieceKind = "straight" | "bend90" | "sCurve" | "narrowBridge";

export type TrackPieceTemplate = {
  id: string;
  label: string;
  kind: TrackPieceKind;
  weight: number;
  length: number;
  widthScale: number;
  slopeDeg: number;
  turnDirection: "left" | "right";
  turnStrengthDeg: number;
  railLeft: boolean;
  railRight: boolean;
};

export type TrackSegmentBlueprint = {
  length: number;
  slopeDeg: number;
  yawDeg: number;
  landingLength?: number;
  railLeft?: boolean;
  railRight?: boolean;
  width?: number;
};

export type TrackBlueprint = {
  segments: TrackSegmentBlueprint[];
};

export type TrackGenerationConfig = {
  seed: string;
  pieceCount: number;
};

export type BuildTrackBlueprintOptions = {
  config: TrackGenerationConfig;
  customPieces: TrackPieceTemplate[];
  includeCustomPieces: boolean;
  trackWidth: number;
};

export const DEFAULT_TRACK_SEED = "v0_8_default_seed";
export const TRACK_SEED_MAX_LENGTH = 64;
export const TRACK_PIECE_COUNT_MIN = 6;
export const TRACK_PIECE_COUNT_MAX = 48;
export const TRACK_PIECE_COUNT_DEFAULT = 16;
const TRACK_SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const FALLBACK_TRACK_WIDTH = 9;

const DEFAULT_CUSTOM_TEMPLATE: Omit<TrackPieceTemplate, "id" | "label"> = {
  kind: "straight",
  weight: 1,
  length: 10,
  widthScale: 1,
  slopeDeg: 0,
  turnDirection: "left",
  turnStrengthDeg: 45,
  railLeft: true,
  railRight: true,
};

export const BUILTIN_TRACK_PIECES: ReadonlyArray<TrackPieceTemplate> = [
  {
    id: "builtin-straight",
    label: "Straight",
    kind: "straight",
    weight: 1.4,
    length: 11,
    widthScale: 1,
    slopeDeg: 0,
    turnDirection: "left",
    turnStrengthDeg: 0,
    railLeft: true,
    railRight: true,
  },
  {
    id: "builtin-bend-left",
    label: "Bend 90 Left",
    kind: "bend90",
    weight: 1,
    length: 14,
    widthScale: 1,
    slopeDeg: 0,
    turnDirection: "left",
    turnStrengthDeg: 90,
    railLeft: true,
    railRight: true,
  },
  {
    id: "builtin-bend-right",
    label: "Bend 90 Right",
    kind: "bend90",
    weight: 1,
    length: 14,
    widthScale: 1,
    slopeDeg: 0,
    turnDirection: "right",
    turnStrengthDeg: 90,
    railLeft: true,
    railRight: true,
  },
  {
    id: "builtin-scurve-left",
    label: "S-Curve Left",
    kind: "sCurve",
    weight: 1.1,
    length: 14,
    widthScale: 1,
    slopeDeg: 0,
    turnDirection: "left",
    turnStrengthDeg: 40,
    railLeft: true,
    railRight: true,
  },
  {
    id: "builtin-scurve-right",
    label: "S-Curve Right",
    kind: "sCurve",
    weight: 1.1,
    length: 14,
    widthScale: 1,
    slopeDeg: 0,
    turnDirection: "right",
    turnStrengthDeg: 40,
    railLeft: true,
    railRight: true,
  },
  {
    id: "builtin-bridge",
    label: "Narrow Bridge",
    kind: "narrowBridge",
    weight: 0.9,
    length: 12,
    widthScale: 0.62,
    slopeDeg: 0,
    turnDirection: "left",
    turnStrengthDeg: 0,
    railLeft: true,
    railRight: true,
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asOptionalBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeTurnDirection(value: unknown, fallback: "left" | "right"): "left" | "right" {
  return value === "right" ? "right" : value === "left" ? "left" : fallback;
}

export function sanitizeTrackSeed(value: unknown, fallback = DEFAULT_TRACK_SEED): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > TRACK_SEED_MAX_LENGTH) {
    return fallback;
  }
  return TRACK_SEED_PATTERN.test(trimmed) ? trimmed : fallback;
}

export function isTrackSeed(value: unknown): value is string {
  return typeof value === "string" && TRACK_SEED_PATTERN.test(value);
}

export function randomTrackSeed(prefix = "seed"): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return sanitizeTrackSeed(`${prefix}_${randomPart}`, DEFAULT_TRACK_SEED);
}

export function sanitizeTrackPieceCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return TRACK_PIECE_COUNT_DEFAULT;
  }
  return Math.round(clamp(value, TRACK_PIECE_COUNT_MIN, TRACK_PIECE_COUNT_MAX));
}

export function createDefaultCustomPiece(kind: TrackPieceKind): TrackPieceTemplate {
  const base: TrackPieceTemplate = {
    ...DEFAULT_CUSTOM_TEMPLATE,
    id: `custom-${Date.now().toString(36)}`,
    label: "Custom Piece",
    kind,
  };
  if (kind === "narrowBridge") {
    base.widthScale = 0.62;
    base.length = 12;
  } else if (kind === "bend90") {
    base.length = 14;
    base.turnStrengthDeg = 90;
  } else if (kind === "sCurve") {
    base.length = 14;
    base.turnStrengthDeg = 40;
  }
  return base;
}

export function sanitizeTrackPieceTemplate(
  input: unknown,
  fallbackId: string,
): TrackPieceTemplate | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const value = input as Partial<TrackPieceTemplate>;
  const kind: TrackPieceKind =
    value.kind === "bend90" || value.kind === "sCurve" || value.kind === "narrowBridge"
      ? value.kind
      : "straight";
  const length = clamp(asFiniteNumber(value.length) ?? 10, 4, 24);
  const slopeDeg = clamp(asFiniteNumber(value.slopeDeg) ?? 0, -8, 8);
  const widthScale = clamp(
    asFiniteNumber(value.widthScale) ?? (kind === "narrowBridge" ? 0.62 : 1),
    kind === "narrowBridge" ? 0.35 : 0.5,
    kind === "narrowBridge" ? 0.9 : 1.35,
  );
  const turnStrengthDeg = clamp(asFiniteNumber(value.turnStrengthDeg) ?? 45, 10, 90);
  const weight = clamp(asFiniteNumber(value.weight) ?? 1, 0.1, 5);
  const labelRaw = typeof value.label === "string" ? value.label.trim() : "";
  const label = (labelRaw || "Custom Piece").slice(0, 28);
  const idRaw = typeof value.id === "string" ? value.id.trim() : "";
  const id = idRaw || fallbackId;

  return {
    id,
    label,
    kind,
    weight,
    length,
    widthScale,
    slopeDeg,
    turnDirection: normalizeTurnDirection(value.turnDirection, "left"),
    turnStrengthDeg,
    railLeft: asOptionalBoolean(value.railLeft, true),
    railRight: asOptionalBoolean(value.railRight, true),
  };
}

export function sanitizeTrackPieceLibrary(input: unknown): TrackPieceTemplate[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const out: TrackPieceTemplate[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const piece = sanitizeTrackPieceTemplate(input[i], `custom-${i + 1}`);
    if (piece) {
      out.push(piece);
    }
  }
  return out.slice(0, 64);
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeSeededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeightedPiece(catalog: TrackPieceTemplate[], random: () => number): TrackPieceTemplate {
  const totalWeight = catalog.reduce((sum, piece) => sum + Math.max(piece.weight, 0.001), 0);
  let target = random() * totalWeight;
  for (const piece of catalog) {
    target -= Math.max(piece.weight, 0.001);
    if (target <= 0) {
      return piece;
    }
  }
  return catalog[catalog.length - 1]!;
}

function makeSegment(
  piece: TrackPieceTemplate,
  length: number,
  yawDeg: number,
  trackWidth: number,
): TrackSegmentBlueprint {
  const width = clamp(trackWidth * piece.widthScale, 2.8, trackWidth * 1.5);
  return {
    length,
    slopeDeg: piece.slopeDeg,
    yawDeg,
    width,
    railLeft: piece.railLeft,
    railRight: piece.railRight,
  };
}

function compilePieceToSegments(
  piece: TrackPieceTemplate,
  trackWidth: number,
): TrackSegmentBlueprint[] {
  const directionSign = piece.turnDirection === "right" ? -1 : 1;
  if (piece.kind === "straight" || piece.kind === "narrowBridge") {
    return [makeSegment(piece, piece.length, 0, trackWidth)];
  }
  if (piece.kind === "bend90") {
    const stepsPerSide = 4;
    const stepLength = piece.length / (stepsPerSide * 2);
    const stepYaw = (piece.turnStrengthDeg / stepsPerSide) * directionSign;
    const out: TrackSegmentBlueprint[] = [];
    for (let i = 0; i < stepsPerSide; i += 1) {
      out.push(makeSegment(piece, stepLength, stepYaw, trackWidth));
    }
    for (let i = 0; i < stepsPerSide; i += 1) {
      out.push(makeSegment(piece, stepLength, -stepYaw, trackWidth));
    }
    return out;
  }

  const stepsPerSide = 3;
  const stepLength = piece.length / (stepsPerSide * 2);
  const stepYaw = (piece.turnStrengthDeg / stepsPerSide) * directionSign;
  const out: TrackSegmentBlueprint[] = [];
  for (let i = 0; i < stepsPerSide; i += 1) {
    out.push(makeSegment(piece, stepLength, stepYaw, trackWidth));
  }
  for (let i = 0; i < stepsPerSide; i += 1) {
    out.push(makeSegment(piece, stepLength, -stepYaw, trackWidth));
  }
  return out;
}

export function buildTrackBlueprint(options: BuildTrackBlueprintOptions): TrackBlueprint {
  const seed = sanitizeTrackSeed(options.config.seed);
  const pieceCount = sanitizeTrackPieceCount(options.config.pieceCount);
  const trackWidth = Number.isFinite(options.trackWidth) ? options.trackWidth : FALLBACK_TRACK_WIDTH;
  const catalog = options.includeCustomPieces
    ? [...BUILTIN_TRACK_PIECES, ...options.customPieces]
    : [...BUILTIN_TRACK_PIECES];
  const sanitizedCatalog = catalog
    .map((piece, index) => sanitizeTrackPieceTemplate(piece, `piece-${index + 1}`))
    .filter((piece): piece is TrackPieceTemplate => piece != null);

  if (sanitizedCatalog.length === 0) {
    return {
      segments: [
        {
          length: 10,
          slopeDeg: 0,
          yawDeg: 0,
          width: trackWidth,
          railLeft: true,
          railRight: true,
        },
      ],
    };
  }

  const random = makeSeededRandom(seed);
  const segments: TrackSegmentBlueprint[] = [];
  for (let i = 0; i < pieceCount; i += 1) {
    const picked = pickWeightedPiece(sanitizedCatalog, random);
    const compiled = compilePieceToSegments(picked, trackWidth);
    for (const segment of compiled) {
      segments.push(segment);
    }
  }
  return { segments };
}
