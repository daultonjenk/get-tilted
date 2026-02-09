export type MessagePayloadMap = {
  ping: { t: number };
  pong: { t: number };
  "room:create": Record<string, never>;
  "room:created": { roomCode: string };
  "room:join": { roomCode: string; name?: string };
  "room:state": { roomCode: string; clients: number };
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

function isOptionalString(value: unknown): value is string | undefined {
  return typeof value === "undefined" || isString(value);
}

function hasNoOwnKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
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
    case "pong":
      return isNumber(payload.t)
        ? { ok: true }
        : { ok: false, error: "Expected numeric field t" };
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
