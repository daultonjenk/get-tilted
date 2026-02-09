import type { TypedMessage } from "@get-tilted/shared-protocol";
import { WSClient, type WSStatus } from "./wsClient";

export type RacePlayer = {
  playerId: string;
  name?: string;
};

export type RemoteRaceState = {
  roomCode: string;
  playerId: string;
  t: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
  vel: [number, number, number];
  trackPos?: [number, number, number];
  trackQuat?: [number, number, number, number];
  trackVel?: [number, number, number];
};

type MessageListener = (message: TypedMessage) => void;
type ErrorListener = (error: string) => void;
type StatusListener = (status: WSStatus) => void;

export class RaceClient {
  private readonly ws: WSClient;

  private roomCode = "";

  private playerId = "";

  private readonly messageListeners = new Set<MessageListener>();

  private readonly errorListeners = new Set<ErrorListener>();

  private readonly statusListeners = new Set<StatusListener>();

  constructor(url?: string) {
    this.ws = new WSClient(url);
    this.ws.onStatusChange((status) => {
      for (const cb of this.statusListeners) {
        cb(status);
      }
      if (status === "disconnected") {
        this.roomCode = "";
        this.playerId = "";
      }
    });
    this.ws.onError((error) => {
      for (const cb of this.errorListeners) {
        cb(error);
      }
    });
    this.ws.onMessage((message) => {
      if (message.type === "room:created") {
        this.roomCode = message.payload.roomCode;
        this.sendHello();
      }
      if (message.type === "room:state" && !this.roomCode) {
        this.roomCode = message.payload.roomCode;
      }
      if (message.type === "race:hello:ack") {
        this.roomCode = message.payload.roomCode;
        this.playerId = message.payload.playerId;
      }
      for (const cb of this.messageListeners) {
        cb(message);
      }
    });
  }

  connect(): void {
    this.ws.connect();
  }

  disconnect(): void {
    this.ws.disconnect();
  }

  getStatus(): WSStatus {
    return this.ws.getStatus();
  }

  getRoomCode(): string {
    return this.roomCode;
  }

  getPlayerId(): string {
    return this.playerId;
  }

  createRoom(): void {
    this.ws.send("room:create", {});
  }

  joinRoom(roomCode: string, name?: string): void {
    const normalized = roomCode.trim().toUpperCase();
    this.roomCode = normalized;
    this.ws.send("room:join", { roomCode: normalized, name });
    this.sendHello(name, normalized);
  }

  sendHello(name?: string, roomCode = this.roomCode): void {
    if (!roomCode) {
      return;
    }
    this.ws.send("race:hello", {
      roomCode,
      playerId: this.playerId || undefined,
      name,
    });
  }

  sendRaceState(state: Omit<RemoteRaceState, "roomCode" | "playerId">): void {
    if (!this.roomCode || !this.playerId) {
      return;
    }
    this.ws.send("race:state", {
      roomCode: this.roomCode,
      playerId: this.playerId,
      t: state.t,
      pos: state.pos,
      quat: state.quat,
      vel: state.vel,
      trackPos: state.trackPos,
      trackQuat: state.trackQuat,
      trackVel: state.trackVel,
    });
  }

  onMessage(cb: MessageListener): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onError(cb: ErrorListener): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  onStatusChange(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    cb(this.ws.getStatus());
    return () => this.statusListeners.delete(cb);
  }
}
