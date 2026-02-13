import {
  encodeMessage,
  safeParseMessage,
  type ParseResult,
  type MessagePayloadMap,
  type TypedMessage,
} from "@get-tilted/shared-protocol";

export type WSStatus = "disconnected" | "connecting" | "connected";

type MessageCallback = (message: TypedMessage) => void;
type ErrorCallback = (error: string) => void;
type StatusCallback = (status: WSStatus) => void;

function getWsPort(): string {
  return String(import.meta.env.VITE_WS_PORT ?? "3001");
}

function getWsProtocol(): "ws" | "wss" {
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return "wss";
  }
  return "ws";
}

export function resolveWsUrlForHost(hostname: string): string {
  return `${getWsProtocol()}://${hostname}:${getWsPort()}/ws`;
}

function normalizeWsUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid WebSocket URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error(`WebSocket URL must use ws:// or wss://: ${rawUrl}`);
  }

  if (!parsed.pathname || parsed.pathname === "/") {
    parsed.pathname = "/ws";
  }
  if (parsed.pathname.endsWith("/") && parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  if (parsed.pathname !== "/ws") {
    throw new Error(
      `WebSocket URL must end with /ws. Received: ${parsed.pathname}`,
    );
  }

  parsed.hash = "";
  return parsed.toString();
}

export function resolveWsUrlForRoom(baseUrl: string, roomCode?: string): string {
  const url = new URL(normalizeWsUrl(baseUrl));
  const normalizedRoom = roomCode?.trim().toUpperCase() ?? "";
  if (normalizedRoom) {
    url.searchParams.set("room", normalizedRoom);
  } else {
    url.searchParams.delete("room");
  }
  return url.toString();
}

export function resolveDefaultWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) {
    return normalizeWsUrl(import.meta.env.VITE_WS_URL);
  }
  if (typeof window !== "undefined" && window.location.hostname) {
    return normalizeWsUrl(resolveWsUrlForHost(window.location.hostname));
  }
  return normalizeWsUrl(`ws://localhost:${getWsPort()}/ws`);
}

export class WSClient {
  private socket: WebSocket | null = null;

  private status: WSStatus = "disconnected";

  private url: string;

  private pendingReconnectUrl: string | null = null;

  private readonly messageListeners = new Set<MessageCallback>();

  private readonly errorListeners = new Set<ErrorCallback>();

  private readonly statusListeners = new Set<StatusCallback>();

  constructor(url = resolveDefaultWsUrl()) {
    this.url = normalizeWsUrl(url);
  }

  connect(url = this.url): void {
    const nextUrl = normalizeWsUrl(url);
    if (this.socket && this.status !== "disconnected") {
      if (this.url !== nextUrl) {
        this.pendingReconnectUrl = nextUrl;
        this.socket.close();
      }
      return;
    }
    this.url = nextUrl;
    this.setStatus("connecting");
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("open", () => this.setStatus("connected"));
    this.socket.addEventListener("close", () => {
      this.socket = null;
      this.setStatus("disconnected");
      if (this.pendingReconnectUrl) {
        const reconnectUrl = this.pendingReconnectUrl;
        this.pendingReconnectUrl = null;
        this.connect(reconnectUrl);
      }
    });
    this.socket.addEventListener("message", (event) => {
      const parsed: ParseResult = safeParseMessage(event.data);
      if (!parsed.ok) {
        this.emitError(parsed.error);
        return;
      }
      this.emitMessage(parsed.msg);
    });
    this.socket.addEventListener("error", () => {
      this.emitError("WebSocket error");
    });
  }

  disconnect(): void {
    this.pendingReconnectUrl = null;
    if (!this.socket) {
      this.setStatus("disconnected");
      return;
    }
    this.socket.close();
  }

  send<TType extends keyof MessagePayloadMap>(
    type: TType,
    payload: MessagePayloadMap[TType],
  ): void {
    if (!this.socket || this.status !== "connected") {
      this.emitError("Socket is not connected");
      return;
    }
    this.socket.send(encodeMessage(type, payload));
  }

  onMessage(cb: MessageCallback): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onError(cb: ErrorCallback): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  onStatusChange(cb: StatusCallback): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  getStatus(): WSStatus {
    return this.status;
  }

  getUrl(): string {
    return this.url;
  }

  private setStatus(status: WSStatus): void {
    this.status = status;
    for (const cb of this.statusListeners) {
      cb(status);
    }
  }

  private emitMessage(message: TypedMessage): void {
    for (const cb of this.messageListeners) {
      cb(message);
    }
  }

  private emitError(error: string): void {
    for (const cb of this.errorListeners) {
      cb(error);
    }
  }
}
