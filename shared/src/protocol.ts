// ---------------------------------------------------------------------------
// Shared room / race constants
// ---------------------------------------------------------------------------

export const ROOM_MAX_CLIENTS = 4;
export const COUNTDOWN_STEP_MS = 1000;
export const COUNTDOWN_PREROLL_MS = 600;
export const COUNTDOWN_TOTAL_STEPS = 4;
export const DEFAULT_TRACK_SEED = "v0_8_default_seed";
export const TRACK_SEED_MAX_LENGTH = 64;

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const TRACK_SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Generate a random room code.  Uses `crypto.getRandomValues` when available
 * (worker / modern runtimes), falls back to `Math.random`.
 */
export function generateRoomCode(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(ROOM_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    let out = "";
    for (const byte of bytes) {
      out += ROOM_CODE_CHARS[byte % ROOM_CODE_CHARS.length];
    }
    return out;
  }
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export function isTrackSeed(value: unknown): value is string {
  return typeof value === "string" && TRACK_SEED_PATTERN.test(value);
}

export function sanitizeTrackSeed(
  value: unknown,
  fallback = DEFAULT_TRACK_SEED,
): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > TRACK_SEED_MAX_LENGTH) {
    return fallback;
  }
  return TRACK_SEED_PATTERN.test(trimmed) ? trimmed : fallback;
}

export type RaceFinishRecord = {
  elapsedMs: number;
  finishedAtMs: number;
};

export type RoomPlayer = {
  playerId: string;
  name?: string;
  skinId?: string;
};

export type RaceResultEntry = {
  playerId: string;
  status: "finished" | "dnf";
  elapsedMs?: number;
};

/**
 * Pure function that computes race results from a player list and finish map.
 * Used by both server and worker to avoid duplicated business logic.
 */
export function calculateRaceResults(
  players: RoomPlayer[],
  finishes: ReadonlyMap<string, RaceFinishRecord>,
  isFinal: boolean,
): { results: RaceResultEntry[]; winnerPlayerId?: string; tie: boolean } | null {
  if (players.length === 0) {
    return null;
  }

  const results: RaceResultEntry[] = isFinal
    ? players.map((player) => {
        const finish = finishes.get(player.playerId);
        if (finish && Number.isFinite(finish.elapsedMs)) {
          return { playerId: player.playerId, status: "finished" as const, elapsedMs: finish.elapsedMs };
        }
        return { playerId: player.playerId, status: "dnf" as const };
      })
    : players
        .map((player) => {
          const finish = finishes.get(player.playerId);
          if (finish && Number.isFinite(finish.elapsedMs)) {
            return { playerId: player.playerId, status: "finished" as const, elapsedMs: finish.elapsedMs };
          }
          return null;
        })
        .filter((entry): entry is RaceResultEntry & { status: "finished"; elapsedMs: number } => entry !== null)
        .sort((a, b) => a.elapsedMs - b.elapsedMs);

  if (results.length === 0) {
    return null;
  }

  const finished = results
    .filter((entry) => entry.status === "finished")
    .map((entry) => ({ playerId: entry.playerId, elapsedMs: entry.elapsedMs ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.elapsedMs - b.elapsedMs);

  let winnerPlayerId: string | undefined;
  let tie = false;
  if (finished.length >= 2 && finished[0]?.elapsedMs === finished[1]?.elapsedMs) {
    tie = true;
  } else if (finished.length >= 1 && Number.isFinite(finished[0]!.elapsedMs)) {
    winnerPlayerId = finished[0]!.playerId;
  }

  return { results, winnerPlayerId, tie };
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export type MessagePayloadMap = {
  ping: { t: number };
  pong: { t: number; serverNowMs: number };
  "room:create": Record<string, never>;
  "room:created": { roomCode: string };
  "room:join": { roomCode: string; name?: string; skinId?: string };
  "room:state": { roomCode: string; clients: number };
  "race:hello": { roomCode: string; playerId?: string; name?: string; skinId?: string };
  "race:hello:ack": {
    roomCode: string;
    playerId: string;
    hostPlayerId: string;
    players: Array<{ playerId: string; name?: string; skinId?: string }>;
    lastStates?: Array<{
      playerId: string;
      t: number;
      pos: [number, number, number];
      quat: [number, number, number, number];
      vel: [number, number, number];
      trackPos?: [number, number, number];
      trackQuat?: [number, number, number, number];
    }>;
  };
  "race:ready": { roomCode: string; playerId: string; ready: boolean };
  "race:start": { roomCode: string; playerId: string; trackSeed?: string };
  "race:ready:state": {
    roomCode: string;
    readyPlayerIds: string[];
    countdownStartAtMs?: number;
  };
  "race:countdown:start": {
    roomCode: string;
    startAtMs: number;
    stepMs: number;
    trackSeed: string;
  };
  "race:finish": {
    roomCode: string;
    playerId: string;
    elapsedMs: number;
    finishedAtMs: number;
  };
  "race:result": {
    roomCode: string;
    isFinal: boolean;
    winnerPlayerId?: string;
    tie: boolean;
    results: Array<{
      playerId: string;
      status: "finished" | "dnf";
      elapsedMs?: number;
    }>;
  };
  "race:state": {
    roomCode: string;
    playerId: string;
    seq?: number;
    t: number;
    pos: [number, number, number];
    quat: [number, number, number, number];
    vel: [number, number, number];
    trackPos?: [number, number, number];
    trackQuat?: [number, number, number, number];
    trackVel?: [number, number, number];
  };
  "race:left": { roomCode: string; playerId: string };
  error: { code: string; message: string };
};

export type MessageType = keyof MessagePayloadMap;

type MessageUnion = {
  [TType in MessageType]: {
    type: TType;
    payload: MessagePayloadMap[TType];
  };
}[MessageType];

export type TypedMessage<TType extends MessageType = MessageType> = Extract<
  MessageUnion,
  { type: TType }
>;

export type WireMessage = {
  type: string;
  payload: unknown;
};

export type ParseResult =
  | { ok: true; msg: TypedMessage }
  | { ok: false; error: string };

const MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "ping",
  "pong",
  "room:create",
  "room:created",
  "room:join",
  "room:state",
  "race:hello",
  "race:hello:ack",
  "race:ready",
  "race:start",
  "race:ready:state",
  "race:countdown:start",
  "race:finish",
  "race:result",
  "race:state",
  "race:left",
  "error",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 1;
}

function isOptionalString(value: unknown): value is string | undefined {
  return typeof value === "undefined" || isString(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStatus(value: unknown): value is "finished" | "dnf" {
  return value === "finished" || value === "dnf";
}

function hasNoOwnKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}

function isTuple3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => isNumber(entry))
  );
}

function isTuple4(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((entry) => isNumber(entry))
  );
}

function isOptionalTuple3(value: unknown): value is [number, number, number] | undefined {
  return typeof value === "undefined" || isTuple3(value);
}

function isOptionalTuple4(
  value: unknown,
): value is [number, number, number, number] | undefined {
  return typeof value === "undefined" || isTuple4(value);
}

function isOptionalPositiveInteger(value: unknown): value is number | undefined {
  return typeof value === "undefined" || isPositiveInteger(value);
}

function isPlayerList(
  value: unknown,
): value is Array<{ playerId: string; name?: string; skinId?: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isObject(entry) &&
        isString(entry.playerId) &&
        isOptionalString(entry.name) &&
        isOptionalString(entry.skinId),
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isString(entry));
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return typeof value === "undefined" || isNumber(value);
}

function isRaceResultItem(
  value: unknown,
): value is { playerId: string; status: "finished" | "dnf"; elapsedMs?: number } {
  if (!isObject(value) || !isString(value.playerId) || !isStatus(value.status)) {
    return false;
  }
  if (!isOptionalNumber(value.elapsedMs)) {
    return false;
  }
  if (value.status === "finished") {
    return isNumber(value.elapsedMs);
  }
  return typeof value.elapsedMs === "undefined";
}

function isRaceResultArray(
  value: unknown,
): value is Array<{ playerId: string; status: "finished" | "dnf"; elapsedMs?: number }> {
  return Array.isArray(value) && value.every((entry) => isRaceResultItem(entry));
}

export function isMessageType(value: string): value is MessageType {
  return MESSAGE_TYPES.has(value);
}

export function validatePayload<TType extends MessageType>(
  type: TType,
  payload: unknown,
): { ok: true } | { ok: false; error: string } {
  if (!isObject(payload)) {
    return { ok: false, error: "Payload must be an object" };
  }

  switch (type) {
    case "ping":
      return isNumber(payload.t)
        ? { ok: true }
        : { ok: false, error: "Expected numeric field t" };
    case "pong":
      if (!isNumber(payload.t)) {
        return { ok: false, error: "Expected numeric field t" };
      }
      return isNumber(payload.serverNowMs)
        ? { ok: true }
        : { ok: false, error: "Expected numeric field serverNowMs" };
    case "room:create":
      return hasNoOwnKeys(payload)
        ? { ok: true }
        : { ok: false, error: "room:create payload must be empty" };
    case "room:created":
      return isString(payload.roomCode)
        ? { ok: true }
        : { ok: false, error: "Expected roomCode string" };
    case "room:join":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      if (!isOptionalString(payload.name)) {
        return { ok: false, error: "Expected optional name string" };
      }
      return isOptionalString(payload.skinId)
        ? { ok: true }
        : { ok: false, error: "Expected optional skinId string" };
    case "room:state":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      return isNumber(payload.clients)
        ? { ok: true }
        : { ok: false, error: "Expected clients number" };
    case "race:hello":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      if (!isOptionalString(payload.playerId)) {
        return { ok: false, error: "Expected optional playerId string" };
      }
      if (!isOptionalString(payload.name)) {
        return { ok: false, error: "Expected optional name string" };
      }
      return isOptionalString(payload.skinId)
        ? { ok: true }
        : { ok: false, error: "Expected optional skinId string" };
    case "race:hello:ack":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      if (!isString(payload.playerId)) {
        return { ok: false, error: "Expected playerId string" };
      }
      if (!isString(payload.hostPlayerId)) {
        return { ok: false, error: "Expected hostPlayerId string" };
      }
      return isPlayerList(payload.players)
        ? { ok: true }
        : { ok: false, error: "Expected players array" };
    case "race:ready":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      if (!isString(payload.playerId)) {
        return { ok: false, error: "Expected playerId string" };
      }
      return isBoolean(payload.ready)
        ? { ok: true }
        : { ok: false, error: "Expected ready boolean" };
    case "race:start":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      if (!isString(payload.playerId)) {
        return { ok: false, error: "Expected playerId string" };
      }
      if (typeof payload.trackSeed === "undefined") {
        return { ok: true };
      }
      return isTrackSeed(payload.trackSeed)
        ? { ok: true }
        : { ok: false, error: "Expected optional trackSeed string" };
    case "race:ready:state":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      if (!isStringArray(payload.readyPlayerIds)) {
        return { ok: false, error: "Expected readyPlayerIds string array" };
      }
      if (
        typeof payload.countdownStartAtMs !== "undefined" &&
        !isNumber(payload.countdownStartAtMs)
      ) {
        return { ok: false, error: "Expected optional countdownStartAtMs number" };
      }
      return { ok: true };
    case "race:countdown:start":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      if (!isNumber(payload.startAtMs)) {
        return { ok: false, error: "Expected startAtMs number" };
      }
      if (!isNumber(payload.stepMs)) {
        return { ok: false, error: "Expected stepMs number" };
      }
      return isTrackSeed(payload.trackSeed)
        ? { ok: true }
        : { ok: false, error: "Expected trackSeed string" };
    case "race:finish":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      if (!isString(payload.playerId)) {
        return { ok: false, error: "Expected playerId string" };
      }
      if (!isNumber(payload.elapsedMs)) {
        return { ok: false, error: "Expected elapsedMs number" };
      }
      return isNumber(payload.finishedAtMs)
        ? { ok: true }
        : { ok: false, error: "Expected finishedAtMs number" };
    case "race:result":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      if (!isBoolean(payload.isFinal)) {
        return { ok: false, error: "Expected isFinal boolean" };
      }
      if (
        typeof payload.winnerPlayerId !== "undefined" &&
        !isString(payload.winnerPlayerId)
      ) {
        return { ok: false, error: "Expected optional winnerPlayerId string" };
      }
      if (!isBoolean(payload.tie)) {
        return { ok: false, error: "Expected tie boolean" };
      }
      return isRaceResultArray(payload.results)
        ? { ok: true }
        : { ok: false, error: "Expected results array" };
    case "race:state":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      if (!isString(payload.playerId)) {
        return { ok: false, error: "Expected playerId string" };
      }
      if (!isOptionalPositiveInteger(payload.seq)) {
        return { ok: false, error: "Expected optional positive integer seq" };
      }
      if (!isNumber(payload.t)) {
        return { ok: false, error: "Expected numeric t" };
      }
      if (!isTuple3(payload.pos)) {
        return { ok: false, error: "Expected numeric pos tuple" };
      }
      if (!isTuple4(payload.quat)) {
        return { ok: false, error: "Expected numeric quat tuple" };
      }
      if (!isTuple3(payload.vel)) {
        return { ok: false, error: "Expected numeric vel tuple" };
      }
      if (!isOptionalTuple3(payload.trackPos)) {
        return { ok: false, error: "Expected optional numeric trackPos tuple" };
      }
      if (!isOptionalTuple4(payload.trackQuat)) {
        return { ok: false, error: "Expected optional numeric trackQuat tuple" };
      }
      return isOptionalTuple3(payload.trackVel)
        ? { ok: true }
        : { ok: false, error: "Expected optional numeric trackVel tuple" };
    case "race:left":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      return isString(payload.playerId)
        ? { ok: true }
        : { ok: false, error: "Expected playerId string" };
    case "error":
      if (!isString(payload.code)) {
        return { ok: false, error: "Expected code string" };
      }
      return isString(payload.message)
        ? { ok: true }
        : { ok: false, error: "Expected message string" };
  }
}

export function encodeMessage<TType extends MessageType>(
  type: TType,
  payload: MessagePayloadMap[TType],
): string {
  return JSON.stringify({ type, payload });
}

export function safeParseMessage(raw: unknown): ParseResult {
  if (!isString(raw)) {
    return { ok: false, error: "Raw message is not a string" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }

  if (!isObject(parsed)) {
    return { ok: false, error: "Message must be an object" };
  }

  const wire = parsed as WireMessage;
  if (!isString(wire.type)) {
    return { ok: false, error: "Message type must be a string" };
  }

  if (!isMessageType(wire.type)) {
    return { ok: false, error: `Unsupported message type: ${wire.type}` };
  }

  const payloadCheck = validatePayload(wire.type, wire.payload);
  if (!payloadCheck.ok) {
    return { ok: false, error: payloadCheck.error };
  }

  return {
    ok: true,
    msg: {
      type: wire.type,
      payload: wire.payload,
    } as TypedMessage,
  };
}
