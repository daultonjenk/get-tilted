export type TrackPieceKind =
  | "straight"
  | "arc90"
  | "sCurve"
  | "ramp"
  | "bridge"
  | "tunnel"
  | "splitY"
  | "mergeY";

export type TrackLaneId = "main" | "left" | "right";

export type TrackPieceTemplate = {
  id: string;
  label: string;
  kind: TrackPieceKind;
  weight: number;
  length: number;
  widthScale: number;
  gradeDeg: number;
  bankDeg: number;
  turnDirection: "left" | "right";
  turnDeg: number;
  tunnelRoof: boolean;
  railLeft: boolean;
  railRight: boolean;
};

export type TrackPiecePlacement = {
  id: string;
  pieceId: string;
  pieceLabel: string;
  kind: TrackPieceKind;
  lane: TrackLaneId;
  branchNodeId?: string;
  groupId?: string;
  isCompensatingTurn?: boolean;
  length: number;
  width: number;
  gradeDeg: number;
  bankDeg: number;
  turnDeg: number;
  tunnelRoof: boolean;
  railLeft: boolean;
  railRight: boolean;
  start: [number, number, number];
  end: [number, number, number];
  points: Array<[number, number, number]>;
};

export type TrackBranchNode = {
  id: string;
  kind: "split" | "merge";
  sourceLane: TrackLaneId;
  targetLanes: TrackLaneId[];
};

export type TrackBlueprint = {
  seed: string;
  pieceCount: number;
  placements: TrackPiecePlacement[];
  branchNodes: TrackBranchNode[];
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
  enableBranchPieces?: boolean;
  maxHeadingDriftDeg?: number;
  enforceBendPairs?: boolean;
  forcedMainPieceKinds?: TrackPieceKind[];
  forcedMainPieces?: TrackPieceTemplate[];
  disableStarterSequence?: boolean;
  generationPolicy?: TrackGenerationPolicy;
};

export type TrackGenerationPolicy = "default" | "singleplayer_camera_friendly_10";

export const ARC90_OBSTACLE_1_SETPIECE_GROUP_PREFIX = "setpiece-arc90-obstacle-1";
export const ARC90_OBSTACLE_1_SETPIECE_ID_LEFT = "builtin-setpiece-arc90-obstacle-1-left";
export const ARC90_OBSTACLE_1_SETPIECE_ID_RIGHT = "builtin-setpiece-arc90-obstacle-1-right";
const CAMERA_FRIENDLY_TRACK_LOGICAL_PIECE_COUNT = 10;
const CAMERA_FRIENDLY_MIDDLE_SLOT_COUNT = 8;
const CAMERA_FRIENDLY_TARGET_OBSTACLE_COUNT = 6;
const CAMERA_FRIENDLY_TARGET_NON_OBSTACLE_COUNT = 2;
const CAMERA_FRIENDLY_TURN_MATCH_EPSILON = 0.001;

type LaneCursor = {
  x: number;
  y: number;
  z: number;
  yawDeg: number;
  bankDeg: number;
};

const START_TOP_Y = 0.3;
const START_TOP_Z = -4;
const MAX_YAW_DEG = 92;
const MAX_BANK_DEG = 35;

export const DEFAULT_TRACK_SEED = "v0_8_default_seed";
export const TRACK_SEED_MAX_LENGTH = 64;
export const TRACK_PIECE_COUNT_MIN = 6;
export const TRACK_PIECE_COUNT_MAX = 48;
export const TRACK_PIECE_COUNT_DEFAULT = 16;
const TRACK_SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const FALLBACK_TRACK_WIDTH = 9;
const ENABLED_RUNTIME_KINDS: ReadonlySet<TrackPieceKind> = new Set(["straight", "arc90"]);

const DEFAULT_CUSTOM_TEMPLATE: Omit<TrackPieceTemplate, "id" | "label"> = {
  kind: "straight",
  weight: 1,
  length: 12,
  widthScale: 1,
  gradeDeg: 0,
  bankDeg: 0,
  turnDirection: "left",
  turnDeg: 45,
  tunnelRoof: false,
  railLeft: true,
  railRight: true,
};

export const BUILTIN_TRACK_PIECES: ReadonlyArray<TrackPieceTemplate> = [
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
    id: ARC90_OBSTACLE_1_SETPIECE_ID_LEFT,
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
    id: ARC90_OBSTACLE_1_SETPIECE_ID_RIGHT,
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

function normalizeTrackPieceKind(value: unknown): TrackPieceKind {
  if (value === "bend90") {
    return "arc90";
  }
  if (value === "narrowBridge") {
    return "bridge";
  }
  if (
    value === "arc90" ||
    value === "sCurve" ||
    value === "ramp" ||
    value === "bridge" ||
    value === "tunnel" ||
    value === "splitY" ||
    value === "mergeY"
  ) {
    return value;
  }
  return "straight";
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
  switch (kind) {
    case "arc90":
      base.length = 14;
      base.turnDeg = 90;
      base.bankDeg = 8;
      break;
    case "sCurve":
      base.length = 14;
      base.turnDeg = 42;
      base.bankDeg = 6;
      break;
    case "ramp":
      base.length = 12;
      base.gradeDeg = 7;
      break;
    case "bridge":
      base.length = 12;
      base.widthScale = 0.66;
      break;
    case "tunnel":
      base.length = 12;
      base.widthScale = 0.9;
      base.tunnelRoof = true;
      break;
    case "splitY":
    case "mergeY":
      base.length = 12;
      base.turnDeg = 35;
      break;
    default:
      break;
  }
  return base;
}

export function sanitizeTrackPieceTemplate(
  input: unknown,
  fallbackId: string,
  options?: {
    maxLength?: number;
  },
): TrackPieceTemplate | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = input as Partial<TrackPieceTemplate> & {
    slopeDeg?: unknown;
    turnStrengthDeg?: unknown;
  };

  const kind = normalizeTrackPieceKind(value.kind);
  const legacySlopeDeg = asFiniteNumber(value.slopeDeg);
  const legacyTurnStrengthDeg = asFiniteNumber(value.turnStrengthDeg);

  const maxLength = clamp(asFiniteNumber(options?.maxLength) ?? 28, 8, 120);
  const length = clamp(asFiniteNumber(value.length) ?? 10, 4, maxLength);
  const gradeDeg = clamp(asFiniteNumber(value.gradeDeg) ?? legacySlopeDeg ?? 0, -12, 12);
  const bankDeg = clamp(asFiniteNumber(value.bankDeg) ?? 0, -MAX_BANK_DEG, MAX_BANK_DEG);

  const widthScale = clamp(
    asFiniteNumber(value.widthScale) ?? (kind === "bridge" ? 0.66 : kind === "tunnel" ? 0.9 : 1),
    kind === "bridge" ? 0.4 : 0.5,
    kind === "bridge" ? 0.9 : 1.35,
  );

  const turnDeg = clamp(asFiniteNumber(value.turnDeg) ?? legacyTurnStrengthDeg ?? 45, 0, 100);
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
    gradeDeg,
    bankDeg,
    turnDirection: normalizeTurnDirection(value.turnDirection, "left"),
    turnDeg,
    tunnelRoof: asOptionalBoolean(value.tunnelRoof, kind === "tunnel"),
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

function toTuple(position: LaneCursor): [number, number, number] {
  return [position.x, position.y, position.z];
}

function clampTurnForYaw(currentYawDeg: number, desiredTurnDeg: number, yawLimitDeg: number): number {
  const nextYaw = currentYawDeg + desiredTurnDeg;
  if (nextYaw > yawLimitDeg) {
    return yawLimitDeg - currentYawDeg;
  }
  if (nextYaw < -yawLimitDeg) {
    return -yawLimitDeg - currentYawDeg;
  }
  return desiredTurnDeg;
}

function tracePiecePoints(
  start: LaneCursor,
  pieceLength: number,
  gradeDeg: number,
  totalTurnDeg: number,
  kind: TrackPieceKind,
): { points: LaneCursor[]; end: LaneCursor } {
  const steps = Math.max(8, Math.ceil(pieceLength / 0.7));
  const stepLength = pieceLength / steps;
  const slope = Math.tan((gradeDeg * Math.PI) / 180);

  const points: LaneCursor[] = [
    {
      x: start.x,
      y: start.y,
      z: start.z,
      yawDeg: start.yawDeg,
      bankDeg: start.bankDeg,
    },
  ];

  let x = start.x;
  let y = start.y;
  let z = start.z;
  let yawDeg = start.yawDeg;

  for (let i = 0; i < steps; i += 1) {
    let turnStepDeg = totalTurnDeg / steps;
    if (kind === "sCurve") {
      const sign = i < steps / 2 ? 1 : -1;
      turnStepDeg = (Math.abs(totalTurnDeg) * 2 * sign) / steps;
    }

    yawDeg += turnStepDeg;
    const yawRad = (yawDeg * Math.PI) / 180;

    x += Math.sin(yawRad) * stepLength;
    y += slope * stepLength;
    z += Math.cos(yawRad) * stepLength;

    points.push({
      x,
      y,
      z,
      yawDeg,
      bankDeg: start.bankDeg,
    });
  }

  return {
    points,
    end: points[points.length - 1]!,
  };
}

function buildPlacement(
  piece: TrackPieceTemplate,
  lane: TrackLaneId,
  laneCursor: LaneCursor,
  trackWidth: number,
  placementId: string,
  forcedTurnDeg?: number,
  branchNodeId?: string,
  yawLimitDeg = MAX_YAW_DEG,
  groupId?: string,
  isCompensatingTurn?: boolean,
): { placement: TrackPiecePlacement; end: LaneCursor } {
  const directionSign = piece.turnDirection === "right" ? -1 : 1;
  const rawTurn = forcedTurnDeg ?? piece.turnDeg * directionSign;
  const totalTurnDeg = clampTurnForYaw(laneCursor.yawDeg, rawTurn, yawLimitDeg);

  const trace = tracePiecePoints(
    laneCursor,
    piece.length,
    piece.gradeDeg,
    totalTurnDeg,
    piece.kind,
  );

  const width = clamp(trackWidth * piece.widthScale, 2.8, trackWidth * 1.6);

  return {
    placement: {
      id: placementId,
      pieceId: piece.id,
      pieceLabel: piece.label,
      kind: piece.kind,
      lane,
      branchNodeId,
      groupId,
      isCompensatingTurn,
      length: piece.length,
      width,
      gradeDeg: piece.gradeDeg,
      bankDeg: piece.bankDeg,
      turnDeg: totalTurnDeg,
      tunnelRoof: piece.tunnelRoof,
      railLeft: piece.railLeft,
      railRight: piece.railRight,
      start: toTuple(trace.points[0]!),
      end: toTuple(trace.end),
      points: trace.points.map((point) => toTuple(point)),
    },
    end: {
      ...trace.end,
      bankDeg: clamp(piece.bankDeg, -MAX_BANK_DEG, MAX_BANK_DEG),
    },
  };
}

function resolvePieceForStep(
  index: number,
  pieceCount: number,
  splitActive: boolean,
  catalog: TrackPieceTemplate[],
  random: () => number,
  enableBranchPieces: boolean,
): TrackPieceTemplate {
  const safeCatalog = catalog.filter((piece) => {
    if (!enableBranchPieces && (piece.kind === "splitY" || piece.kind === "mergeY")) {
      return false;
    }
    if (piece.kind === "mergeY") {
      return splitActive;
    }
    if (piece.kind === "splitY") {
      return !splitActive && index < pieceCount - 2;
    }
    return true;
  });

  if (safeCatalog.length === 0) {
    return {
      ...DEFAULT_CUSTOM_TEMPLATE,
      id: "fallback-straight",
      label: "Fallback Straight",
      kind: splitActive ? "mergeY" : "straight",
      turnDeg: splitActive ? 30 : 0,
      length: 12,
      widthScale: 1,
      gradeDeg: 0,
      bankDeg: 0,
      tunnelRoof: false,
      railLeft: true,
      railRight: true,
      weight: 1,
    };
  }

  if (splitActive && index >= pieceCount - 1) {
    const mergePiece = safeCatalog.find((piece) => piece.kind === "mergeY");
    if (mergePiece) {
      return mergePiece;
    }
  }

  return pickWeightedPiece(safeCatalog, random);
}

export function resolveBranchLane(marbleId: string, nodeId: string, seed: string): "left" | "right" {
  const token = `${sanitizeTrackSeed(seed)}|${marbleId}|${nodeId}`;
  return hashSeed(token) % 2 === 0 ? "left" : "right";
}

function fallbackStraightPiece(): TrackPieceTemplate {
  return {
    ...DEFAULT_CUSTOM_TEMPLATE,
    id: "forced-starter-straight",
    label: "Straight",
    kind: "straight",
    length: 13,
    turnDeg: 0,
    bankDeg: 0,
    turnDirection: "left",
    weight: 1,
  };
}

function fallbackArcPiece(direction: "left" | "right"): TrackPieceTemplate {
  return {
    ...DEFAULT_CUSTOM_TEMPLATE,
    id: `forced-starter-arc-${direction}`,
    label: direction === "left" ? "Arc 90 Left" : "Arc 90 Right",
    kind: "arc90",
    length: 14,
    turnDeg: 90,
    bankDeg: direction === "left" ? 8 : -8,
    turnDirection: direction,
    weight: 1,
  };
}

function buildStarterSequence(
  catalog: TrackPieceTemplate[],
  pieceCount: number,
): TrackPieceTemplate[] {
  if (pieceCount <= 0) {
    return [];
  }
  const straight = catalog.find((piece) => piece.kind === "straight") ?? fallbackStraightPiece();
  const arcLeft =
    catalog.find((piece) => piece.kind === "arc90" && piece.turnDirection === "left") ??
    fallbackArcPiece("left");
  const arcRight =
    catalog.find((piece) => piece.kind === "arc90" && piece.turnDirection === "right") ??
    fallbackArcPiece("right");
  const sequence: TrackPieceTemplate[] = [straight, arcLeft, straight, arcRight, straight];
  return sequence.slice(0, Math.min(sequence.length, pieceCount));
}

function resolveForcedMainPiece(
  kind: TrackPieceKind,
  index: number,
  catalog: TrackPieceTemplate[],
): TrackPieceTemplate | null {
  if (kind === "straight") {
    return catalog.find((piece) => piece.kind === "straight") ?? fallbackStraightPiece();
  }
  if (kind === "arc90") {
    const direction: "left" | "right" = index % 2 === 0 ? "left" : "right";
    return (
      catalog.find((piece) => piece.kind === "arc90" && piece.turnDirection === direction) ??
      fallbackArcPiece(direction)
    );
  }
  return null;
}

function isArc90ObstacleSetPieceId(pieceId: string): boolean {
  return (
    pieceId === ARC90_OBSTACLE_1_SETPIECE_ID_LEFT ||
    pieceId === ARC90_OBSTACLE_1_SETPIECE_ID_RIGHT
  );
}

function resolveSignedTurnDeg(piece: TrackPieceTemplate): number {
  if (!Number.isFinite(piece.turnDeg) || Math.abs(piece.turnDeg) < CAMERA_FRIENDLY_TURN_MATCH_EPSILON) {
    return 0;
  }
  const directionSign = piece.turnDirection === "right" ? -1 : 1;
  return piece.turnDeg * directionSign;
}

function turnsMatch(piece: TrackPieceTemplate, targetTurnDeg: number): boolean {
  return Math.abs(resolveSignedTurnDeg(piece) - targetTurnDeg) <= CAMERA_FRIENDLY_TURN_MATCH_EPSILON;
}

type CameraFriendlyCandidate = {
  piece: TrackPieceTemplate;
  isObstacle: boolean;
};

type CameraFriendlyState = {
  slotIndex: number;
  remainingObstacle: number;
  remainingNonObstacle: number;
  pendingCorrectionTurnDeg: number | null;
  consecutiveTurnCount: number;
};

function pickWeightedCandidateOrder<T extends { piece: TrackPieceTemplate }>(
  source: T[],
  random: () => number,
): T[] {
  const pool = [...source];
  const ordered: T[] = [];
  while (pool.length > 0) {
    const totalWeight = pool.reduce(
      (sum, entry) => sum + Math.max(entry.piece.weight, 0.001),
      0,
    );
    let target = random() * totalWeight;
    let pickedIndex = pool.length - 1;
    for (let index = 0; index < pool.length; index += 1) {
      target -= Math.max(pool[index]!.piece.weight, 0.001);
      if (target <= 0) {
        pickedIndex = index;
        break;
      }
    }
    const [picked] = pool.splice(pickedIndex, 1);
    if (picked) {
      ordered.push(picked);
    }
  }
  return ordered;
}

function buildCameraFriendlyMiddleSequence(params: {
  obstaclePool: TrackPieceTemplate[];
  nonObstaclePool: TrackPieceTemplate[];
  random: () => number;
}): TrackPieceTemplate[] | null {
  const { obstaclePool, nonObstaclePool, random } = params;
  const hasStraightNonObstacle = nonObstaclePool.some(
    (piece) => Math.abs(resolveSignedTurnDeg(piece)) <= CAMERA_FRIENDLY_TURN_MATCH_EPSILON,
  );
  const recurse = (state: CameraFriendlyState): TrackPieceTemplate[] | null => {
    if (state.slotIndex >= CAMERA_FRIENDLY_MIDDLE_SLOT_COUNT) {
      if (
        state.remainingObstacle === 0 &&
        state.remainingNonObstacle === 0 &&
        state.pendingCorrectionTurnDeg == null
      ) {
        return [];
      }
      return null;
    }

    const slotsRemainingAfterPick = CAMERA_FRIENDLY_MIDDLE_SLOT_COUNT - state.slotIndex - 1;
    const candidates: CameraFriendlyCandidate[] = [];
    if (state.remainingObstacle > 0) {
      candidates.push(...obstaclePool.map((piece) => ({ piece, isObstacle: true })));
    }
    if (state.remainingNonObstacle > 0) {
      candidates.push(...nonObstaclePool.map((piece) => ({ piece, isObstacle: false })));
    }
    const validCandidates = candidates.filter((candidate) => {
      const turnDeg = resolveSignedTurnDeg(candidate.piece);
      if (state.pendingCorrectionTurnDeg != null) {
        return Math.abs(turnDeg - state.pendingCorrectionTurnDeg) <= CAMERA_FRIENDLY_TURN_MATCH_EPSILON;
      }
      // Keep non-obstacle picks mostly straight to reduce side-travel awkwardness.
      if (
        !candidate.isObstacle &&
        hasStraightNonObstacle &&
        Math.abs(turnDeg) > CAMERA_FRIENDLY_TURN_MATCH_EPSILON
      ) {
        return false;
      }
      // Avoid long turn streaks once a full corrective pair has happened.
      if (
        state.consecutiveTurnCount >= 2 &&
        state.remainingNonObstacle > 0 &&
        hasStraightNonObstacle &&
        Math.abs(turnDeg) > CAMERA_FRIENDLY_TURN_MATCH_EPSILON
      ) {
        return false;
      }
      if (Math.abs(turnDeg) > CAMERA_FRIENDLY_TURN_MATCH_EPSILON && slotsRemainingAfterPick <= 0) {
        return false;
      }
      return true;
    });
    if (validCandidates.length === 0) {
      return null;
    }

    const weightedOrder = pickWeightedCandidateOrder(validCandidates, random);
    for (const candidate of weightedOrder) {
      const turnDeg = resolveSignedTurnDeg(candidate.piece);
      const remainingObstacle =
        state.remainingObstacle - (candidate.isObstacle ? 1 : 0);
      const remainingNonObstacle =
        state.remainingNonObstacle - (candidate.isObstacle ? 0 : 1);
      if (remainingObstacle < 0 || remainingNonObstacle < 0) {
        continue;
      }
      const nextConsecutiveTurnCount =
        Math.abs(turnDeg) > CAMERA_FRIENDLY_TURN_MATCH_EPSILON
          ? state.consecutiveTurnCount + 1
          : 0;
      if (nextConsecutiveTurnCount > 2) {
        continue;
      }

      const nextPendingCorrectionTurnDeg =
        state.pendingCorrectionTurnDeg != null
          ? null
          : Math.abs(turnDeg) > CAMERA_FRIENDLY_TURN_MATCH_EPSILON
            ? -turnDeg
            : null;

      if (nextPendingCorrectionTurnDeg != null) {
        if (slotsRemainingAfterPick <= 0) {
          continue;
        }
        const hasObstacleCorrection =
          remainingObstacle > 0 &&
          obstaclePool.some((piece) => turnsMatch(piece, nextPendingCorrectionTurnDeg));
        const hasNonObstacleCorrection =
          remainingNonObstacle > 0 &&
          nonObstaclePool.some((piece) => turnsMatch(piece, nextPendingCorrectionTurnDeg));
        if (!hasObstacleCorrection && !hasNonObstacleCorrection) {
          continue;
        }
      }

      const rest = recurse({
        slotIndex: state.slotIndex + 1,
        remainingObstacle,
        remainingNonObstacle,
        pendingCorrectionTurnDeg: nextPendingCorrectionTurnDeg,
        consecutiveTurnCount: nextConsecutiveTurnCount,
      });
      if (rest) {
        return [candidate.piece, ...rest];
      }
    }
    return null;
  };

  return recurse({
    slotIndex: 0,
    remainingObstacle: CAMERA_FRIENDLY_TARGET_OBSTACLE_COUNT,
    remainingNonObstacle: CAMERA_FRIENDLY_TARGET_NON_OBSTACLE_COUNT,
    pendingCorrectionTurnDeg: null,
    consecutiveTurnCount: 0,
  });
}

function buildCameraFriendly10LogicalSequence(
  catalog: TrackPieceTemplate[],
  random: () => number,
): TrackPieceTemplate[] {
  const straightCandidates = catalog.filter(
    (piece) =>
      piece.kind === "straight" &&
      !isArc90ObstacleSetPieceId(piece.id) &&
      Math.abs(resolveSignedTurnDeg(piece)) <= CAMERA_FRIENDLY_TURN_MATCH_EPSILON,
  );
  const plainArcCandidates = catalog.filter(
    (piece) => piece.kind === "arc90" && !isArc90ObstacleSetPieceId(piece.id),
  );
  const authoredObstacleCandidates = catalog.filter((piece) =>
    isArc90ObstacleSetPieceId(piece.id),
  );

  const fallbackStraight = fallbackStraightPiece();
  const startFinishStraight =
    straightCandidates.find((piece) => Math.abs(resolveSignedTurnDeg(piece)) <= CAMERA_FRIENDLY_TURN_MATCH_EPSILON) ??
    straightCandidates[0] ??
    fallbackStraight;

  const nonObstaclePool = [
    ...straightCandidates,
    ...plainArcCandidates,
  ];
  if (nonObstaclePool.length === 0) {
    nonObstaclePool.push(startFinishStraight);
  }

  const obstaclePool =
    authoredObstacleCandidates.length > 0
      ? authoredObstacleCandidates
      : plainArcCandidates;
  if (obstaclePool.length === 0) {
    obstaclePool.push({
      ...fallbackArcPiece("left"),
      id: "camera-friendly-fallback-obstacle",
      label: "Camera Friendly Fallback Arc",
    });
  }

  const middle =
    buildCameraFriendlyMiddleSequence({
      obstaclePool,
      nonObstaclePool,
      random,
    }) ??
    [
      obstaclePool[0]!,
      obstaclePool[1] ?? obstaclePool[0]!,
      nonObstaclePool[0]!,
      obstaclePool[0]!,
      obstaclePool[1] ?? obstaclePool[0]!,
      nonObstaclePool[0]!,
      obstaclePool[0]!,
      obstaclePool[1] ?? obstaclePool[0]!,
    ];

  return [startFinishStraight, ...middle, startFinishStraight];
}

export function buildTrackBlueprint(options: BuildTrackBlueprintOptions): TrackBlueprint {
  const seed = sanitizeTrackSeed(options.config.seed);
  const generationPolicy = options.generationPolicy ?? "default";
  const disableStarterSequence = options.disableStarterSequence ?? false;
  const pieceCount = disableStarterSequence
    ? Math.round(
        clamp(
          asFiniteNumber(options.config.pieceCount) ?? TRACK_PIECE_COUNT_DEFAULT,
          1,
          TRACK_PIECE_COUNT_MAX,
        ),
      )
    : sanitizeTrackPieceCount(options.config.pieceCount);
  const trackWidth = Number.isFinite(options.trackWidth) ? options.trackWidth : FALLBACK_TRACK_WIDTH;
  const enableBranchPieces = options.enableBranchPieces ?? false;
  const maxHeadingDriftDeg = clamp(
    asFiniteNumber(options.maxHeadingDriftDeg) ?? 18,
    8,
    45,
  );
  const enforceBendPairs = options.enforceBendPairs ?? true;

  const catalog = options.includeCustomPieces
    ? [...BUILTIN_TRACK_PIECES, ...options.customPieces]
    : [...BUILTIN_TRACK_PIECES];
  const sanitizedCatalog = catalog
    .map((piece, index) => sanitizeTrackPieceTemplate(piece, `piece-${index + 1}`))
    .filter(
      (piece): piece is TrackPieceTemplate =>
        piece != null && ENABLED_RUNTIME_KINDS.has(piece.kind),
    );

  if (generationPolicy === "singleplayer_camera_friendly_10") {
    const cameraFriendlyRandom = makeSeededRandom(seed);
    const forcedCameraFriendlyPieces = buildCameraFriendly10LogicalSequence(
      sanitizedCatalog,
      cameraFriendlyRandom,
    );
    return buildTrackBlueprint({
      ...options,
      generationPolicy: "default",
      config: {
        ...options.config,
        pieceCount: CAMERA_FRIENDLY_TRACK_LOGICAL_PIECE_COUNT,
      },
      forcedMainPieceKinds: [],
      forcedMainPieces: forcedCameraFriendlyPieces,
      disableStarterSequence: true,
      enableBranchPieces: false,
      enforceBendPairs: false,
    });
  }

  const random = makeSeededRandom(seed);
  const forcedKinds = (options.forcedMainPieceKinds ?? [])
    .map((kind) => normalizeTrackPieceKind(kind))
    .filter((kind): kind is TrackPieceKind => ENABLED_RUNTIME_KINDS.has(kind));
  const forcedMainPieces = (options.forcedMainPieces ?? [])
    .map((piece, index) =>
      sanitizeTrackPieceTemplate(piece, `forced-main-${index + 1}`, {
        maxLength: disableStarterSequence ? 120 : 28,
      }),
    )
    .filter((piece): piece is TrackPieceTemplate => piece != null);
  const placements: TrackPiecePlacement[] = [];
  const branchNodes: TrackBranchNode[] = [];

  const lanes = new Map<TrackLaneId, LaneCursor>([
    [
      "main",
      {
        x: 0,
        y: START_TOP_Y,
        z: START_TOP_Z,
        yawDeg: 0,
        bankDeg: 0,
      },
    ],
  ]);

  let splitActive = false;
  let placementSeq = 1;
  let branchSeq = 1;
  let bendPairSeq = 1;
  let authoredSetPieceSeq = 1;
  const starterSequence = disableStarterSequence
    ? []
    : buildStarterSequence(sanitizedCatalog, pieceCount);
  const straightForAuthoredSetPiece =
    sanitizedCatalog.find((piece) => piece.kind === "straight") ?? fallbackStraightPiece();

  for (let i = 0; i < pieceCount; i += 1) {
    const forcedMainPiece = forcedMainPieces[i] ?? null;
    const forcedCatalogPiece =
      forcedKinds[i] != null ? resolveForcedMainPiece(forcedKinds[i]!, i, sanitizedCatalog) : null;
    const forcedStarterPiece = forcedMainPiece ?? forcedCatalogPiece ?? starterSequence[i] ?? null;
    const picked =
      forcedStarterPiece ??
      resolvePieceForStep(
        i,
        pieceCount,
        splitActive,
        sanitizedCatalog,
        random,
        enableBranchPieces,
      );
    const isForcedStarterPiece = forcedStarterPiece != null;

    if (enableBranchPieces && !splitActive && picked.kind === "splitY") {
      const mainLane = lanes.get("main");
      if (!mainLane) {
        continue;
      }
      const splitTurn = clamp(Math.max(18, picked.turnDeg * 0.6), 12, 42);
      const branchNodeId = `branch-${branchSeq.toString().padStart(3, "0")}`;
      branchSeq += 1;

      const leftBuild = buildPlacement(
        picked,
        "left",
        mainLane,
        trackWidth,
        `placement-${placementSeq.toString().padStart(4, "0")}`,
        splitTurn,
        branchNodeId,
      );
      placementSeq += 1;

      const rightBuild = buildPlacement(
        picked,
        "right",
        mainLane,
        trackWidth,
        `placement-${placementSeq.toString().padStart(4, "0")}`,
        -splitTurn,
        branchNodeId,
      );
      placementSeq += 1;

      placements.push(leftBuild.placement, rightBuild.placement);
      branchNodes.push({
        id: branchNodeId,
        kind: "split",
        sourceLane: "main",
        targetLanes: ["left", "right"],
      });

      lanes.delete("main");
      lanes.set("left", leftBuild.end);
      lanes.set("right", rightBuild.end);
      splitActive = true;
      continue;
    }

    if (enableBranchPieces && splitActive && picked.kind === "mergeY") {
      const leftLane = lanes.get("left");
      const rightLane = lanes.get("right");
      if (!leftLane || !rightLane) {
        splitActive = false;
        continue;
      }

      const mergeTurn = clamp(Math.max(16, picked.turnDeg * 0.65), 12, 44);
      const branchNodeId = `branch-${branchSeq.toString().padStart(3, "0")}`;
      branchSeq += 1;

      const leftBuild = buildPlacement(
        picked,
        "left",
        leftLane,
        trackWidth,
        `placement-${placementSeq.toString().padStart(4, "0")}`,
        -mergeTurn,
        branchNodeId,
      );
      placementSeq += 1;

      const rightBuild = buildPlacement(
        picked,
        "right",
        rightLane,
        trackWidth,
        `placement-${placementSeq.toString().padStart(4, "0")}`,
        mergeTurn,
        branchNodeId,
      );
      placementSeq += 1;

      placements.push(leftBuild.placement, rightBuild.placement);
      branchNodes.push({
        id: branchNodeId,
        kind: "merge",
        sourceLane: "left",
        targetLanes: ["main"],
      });

      const mergedCursor: LaneCursor = {
        x: (leftBuild.end.x + rightBuild.end.x) / 2,
        y: (leftBuild.end.y + rightBuild.end.y) / 2,
        z: (leftBuild.end.z + rightBuild.end.z) / 2,
        yawDeg: (leftBuild.end.yawDeg + rightBuild.end.yawDeg) / 2,
        bankDeg: (leftBuild.end.bankDeg + rightBuild.end.bankDeg) / 2,
      };

      lanes.delete("left");
      lanes.delete("right");
      lanes.set("main", mergedCursor);
      splitActive = false;
      continue;
    }

    const laneOrder: TrackLaneId[] = lanes.has("main") ? ["main"] : ["left", "right"];
    for (const lane of laneOrder) {
      const cursor = lanes.get(lane);
      if (!cursor) {
        continue;
      }

      const isMainLane = lane === "main";
      const yawLimitDeg = isMainLane
        ? isForcedStarterPiece
          ? MAX_YAW_DEG
          : maxHeadingDriftDeg
        : MAX_YAW_DEG;

      if (isArc90ObstacleSetPieceId(picked.id)) {
        const setPieceGroupId = `${ARC90_OBSTACLE_1_SETPIECE_GROUP_PREFIX}-${authoredSetPieceSeq
          .toString()
          .padStart(3, "0")}`;
        authoredSetPieceSeq += 1;
        const setPieceStraightTemplate: TrackPieceTemplate = {
          ...straightForAuthoredSetPiece,
          id: `${picked.id}-entry-straight`,
          label: `${picked.label} Straight`,
          turnDeg: 0,
          bankDeg: 0,
          turnDirection: "left",
        };
        const arcTemplate: TrackPieceTemplate = {
          ...picked,
          id: `${picked.id}-core-arc`,
          label: `${picked.label} Arc`,
        };

        const entryBuild = buildPlacement(
          setPieceStraightTemplate,
          lane,
          cursor,
          trackWidth,
          `placement-${placementSeq.toString().padStart(4, "0")}`,
          undefined,
          undefined,
          yawLimitDeg,
          setPieceGroupId,
          false,
        );
        placementSeq += 1;

        const arcBuild = buildPlacement(
          arcTemplate,
          lane,
          entryBuild.end,
          trackWidth,
          `placement-${placementSeq.toString().padStart(4, "0")}`,
          undefined,
          undefined,
          yawLimitDeg,
          setPieceGroupId,
          false,
        );
        placementSeq += 1;

        const exitBuild = buildPlacement(
          setPieceStraightTemplate,
          lane,
          arcBuild.end,
          trackWidth,
          `placement-${placementSeq.toString().padStart(4, "0")}`,
          undefined,
          undefined,
          yawLimitDeg,
          setPieceGroupId,
          false,
        );
        placementSeq += 1;

        placements.push(entryBuild.placement, arcBuild.placement, exitBuild.placement);
        lanes.set(lane, exitBuild.end);
        continue;
      }

      const shouldPairHardArc =
        enforceBendPairs &&
        isMainLane &&
        !isForcedStarterPiece &&
        picked.kind === "arc90" &&
        picked.turnDeg >= 80 &&
        !isArc90ObstacleSetPieceId(picked.id) &&
        !enableBranchPieces;

      if (shouldPairHardArc) {
        const pairId = `pair-${bendPairSeq.toString().padStart(3, "0")}`;
        bendPairSeq += 1;
        const firstTurnSign = picked.turnDirection === "right" ? -1 : 1;
        const firstBuild = buildPlacement(
          picked,
          lane,
          cursor,
          trackWidth,
          `placement-${placementSeq.toString().padStart(4, "0")}`,
          picked.turnDeg * firstTurnSign,
          undefined,
          MAX_YAW_DEG,
          pairId,
          false,
        );
        placementSeq += 1;
        placements.push(firstBuild.placement);

        const compensatingDirection: "left" | "right" =
          firstBuild.placement.turnDeg >= 0 ? "right" : "left";
        const compensatingPiece: TrackPieceTemplate = {
          ...picked,
          id: `${picked.id}-pair`,
          label: `${picked.label} Return`,
          turnDirection: compensatingDirection,
          bankDeg: -picked.bankDeg,
        };
        const compensatingBuild = buildPlacement(
          compensatingPiece,
          lane,
          firstBuild.end,
          trackWidth,
          `placement-${placementSeq.toString().padStart(4, "0")}`,
          -firstBuild.placement.turnDeg,
          undefined,
          MAX_YAW_DEG,
          pairId,
          true,
        );
        placementSeq += 1;
        placements.push(compensatingBuild.placement);
        lanes.set(lane, compensatingBuild.end);
        continue;
      }

      const built = buildPlacement(
        picked,
        lane,
        cursor,
        trackWidth,
        `placement-${placementSeq.toString().padStart(4, "0")}`,
        undefined,
        undefined,
        yawLimitDeg,
      );
      placementSeq += 1;
      placements.push(built.placement);
      lanes.set(lane, built.end);
    }
  }

  if (enableBranchPieces && splitActive) {
    const leftLane = lanes.get("left");
    const rightLane = lanes.get("right");
    if (leftLane && rightLane) {
      const mergePiece = sanitizeTrackPieceTemplate(
        {
          ...createDefaultCustomPiece("mergeY"),
          id: "forced-merge",
          label: "Forced Merge",
          length: 12,
          turnDeg: 30,
          widthScale: 1,
        },
        "forced-merge",
      );

      if (mergePiece) {
        const branchNodeId = `branch-${branchSeq.toString().padStart(3, "0")}`;

        const leftBuild = buildPlacement(
          mergePiece,
          "left",
          leftLane,
          trackWidth,
          `placement-${placementSeq.toString().padStart(4, "0")}`,
          -28,
          branchNodeId,
        );
        placementSeq += 1;

        const rightBuild = buildPlacement(
          mergePiece,
          "right",
          rightLane,
          trackWidth,
          `placement-${placementSeq.toString().padStart(4, "0")}`,
          28,
          branchNodeId,
        );

        placements.push(leftBuild.placement, rightBuild.placement);
        branchNodes.push({
          id: branchNodeId,
          kind: "merge",
          sourceLane: "left",
          targetLanes: ["main"],
        });
      }
    }
  }

  return {
    seed,
    pieceCount,
    placements,
    branchNodes,
  };
}
