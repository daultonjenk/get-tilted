export type MessagePayloadMap = {
  ping: { t: number };
  pong: { t: number; serverNowMs: number };
  "room:create": Record<string, never>;
  "room:created": { roomCode: string };
  "room:join": { roomCode: string; name?: string };
  "room:state": { roomCode: string; clients: number };
  "race:hello": { roomCode: string; playerId?: string; name?: string };
  "race:hello:ack": {
    roomCode: string;
    playerId: string;
    players: Array<{ playerId: string; name?: string }>;
  };
  "race:ready": { roomCode: string; playerId: string; ready: boolean };
  "race:ready:state": {
    roomCode: string;
    readyPlayerIds: string[];
    countdownStartAtMs?: number;
  };
  "race:countdown:start": { roomCode: string; startAtMs: number; stepMs: number };
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
  "race:ready:state",
  "race:countdown:start",
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
): value is Array<{ playerId: string; name?: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isObject(entry) &&
        isString(entry.playerId) &&
        isOptionalString(entry.name),
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isString(entry));
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
      return isOptionalString(payload.name)
        ? { ok: true }
        : { ok: false, error: "Expected optional name string" };
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
      return isOptionalString(payload.name)
        ? { ok: true }
        : { ok: false, error: "Expected optional name string" };
    case "race:hello:ack":
      if (!isString(payload.roomCode)) {
        return { ok: false, error: "Expected roomCode string" };
      }
      if (!isString(payload.playerId)) {
        return { ok: false, error: "Expected playerId string" };
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
      return isNumber(payload.stepMs)
        ? { ok: true }
        : { ok: false, error: "Expected stepMs number" };
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
