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

export class WSClient {
  private socket: WebSocket | null = null;

  private status: WSStatus = "disconnected";

  private readonly url: string;

  private readonly messageListeners = new Set<MessageCallback>();

  private readonly errorListeners = new Set<ErrorCallback>();

  private readonly statusListeners = new Set<StatusCallback>();

  constructor(url = import.meta.env.VITE_WS_URL ?? "ws://localhost:3001/ws") {
    this.url = url;
  }

  connect(): void {
    if (this.socket && this.status !== "disconnected") {
      return;
    }
    this.setStatus("connecting");
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("open", () => this.setStatus("connected"));
    this.socket.addEventListener("close", () => {
      this.socket = null;
      this.setStatus("disconnected");
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
