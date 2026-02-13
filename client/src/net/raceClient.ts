import type { TypedMessage } from "@get-tilted/shared-protocol";
import {
  WSClient,
  resolveDefaultWsUrl,
  resolveWsUrlForRoom,
  type WSStatus,
} from "./wsClient";

export type RacePlayer = {
  playerId: string;
  name?: string;
};

export type RemoteRaceState = {
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

type MessageListener = (message: TypedMessage) => void;
type ErrorListener = (error: string) => void;
type StatusListener = (status: WSStatus) => void;
type ClockSyncListener = (offsetMs: number) => void;

const PING_INTERVAL_MS = 2000;

export class RaceClient {
  private readonly ws: WSClient;

  private readonly baseWsUrl: string;

  private roomCode = "";

  private playerId = "";

  private readonly messageListeners = new Set<MessageListener>();

  private readonly errorListeners = new Set<ErrorListener>();

  private readonly statusListeners = new Set<StatusListener>();

  private readonly clockSyncListeners = new Set<ClockSyncListener>();

  private serverClockOffsetMs = 0;

  private hasClockSync = false;

  private pingTimer: number | null = null;

  private nextRaceStateSeq = 1;

  private pendingCreateRoom = false;

  private pendingJoin:
    | {
        roomCode: string;
        name?: string;
      }
    | null = null;

  constructor(url?: string) {
    this.baseWsUrl = url ?? resolveDefaultWsUrl();
    this.ws = new WSClient(this.baseWsUrl);
    this.ws.onStatusChange((status) => {
      for (const cb of this.statusListeners) {
        cb(status);
      }
      if (status === "disconnected") {
        this.roomCode = "";
        this.playerId = "";
        this.resetRaceStateSeq();
        this.stopPingLoop();
        this.serverClockOffsetMs = 0;
        this.hasClockSync = false;
        this.emitClockOffset();
      } else if (status === "connected") {
        this.startPingLoop();
        this.flushPendingActions();
      }
    });
    this.ws.onError((error) => {
      for (const cb of this.errorListeners) {
        cb(error);
      }
    });
    this.ws.onMessage((message) => {
      if (message.type === "room:created") {
        this.resetRaceStateSeq();
        this.roomCode = message.payload.roomCode;
        this.pendingJoin = {
          roomCode: message.payload.roomCode,
        };
        this.ws.connect(this.getRoomSocketUrl(message.payload.roomCode));
      }
      if (message.type === "room:state" && !this.roomCode) {
        this.roomCode = message.payload.roomCode;
      }
      if (message.type === "race:hello:ack") {
        this.roomCode = message.payload.roomCode;
        this.playerId = message.payload.playerId;
      }
      if (message.type === "pong") {
        this.onPong(message.payload.t, message.payload.serverNowMs);
      }
      for (const cb of this.messageListeners) {
        cb(message);
      }
    });
  }

  connect(): void {
    if (this.pendingJoin?.roomCode) {
      this.ws.connect(this.getRoomSocketUrl(this.pendingJoin.roomCode));
      return;
    }
    if (this.roomCode) {
      this.ws.connect(this.getRoomSocketUrl(this.roomCode));
      return;
    }
    this.ws.connect(this.getLobbySocketUrl());
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
    this.resetRaceStateSeq();
    this.pendingCreateRoom = true;
    this.pendingJoin = null;
    this.roomCode = "";
    this.playerId = "";
    this.ws.connect(this.getLobbySocketUrl());
    this.flushPendingActions();
  }

  joinRoom(roomCode: string, name?: string): void {
    const normalized = roomCode.trim().toUpperCase();
    this.resetRaceStateSeq();
    this.roomCode = normalized;
    this.pendingJoin = { roomCode: normalized, name };
    this.ws.connect(this.getRoomSocketUrl(normalized));
    this.flushPendingActions();
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

  sendRaceState(state: Omit<RemoteRaceState, "roomCode" | "playerId" | "seq">): void {
    if (!this.roomCode || !this.playerId) {
      return;
    }
    const seq = this.consumeRaceStateSeq();
    this.ws.send("race:state", {
      roomCode: this.roomCode,
      playerId: this.playerId,
      seq,
      t: state.t,
      pos: state.pos,
      quat: state.quat,
      vel: state.vel,
      trackPos: state.trackPos,
      trackQuat: state.trackQuat,
      trackVel: state.trackVel,
    });
  }

  sendReady(ready: boolean): void {
    if (!this.roomCode || !this.playerId) {
      return;
    }
    this.ws.send("race:ready", {
      roomCode: this.roomCode,
      playerId: this.playerId,
      ready,
    });
  }

  sendRaceFinish(elapsedMs: number, finishedAtMs: number): void {
    if (!this.roomCode || !this.playerId) {
      return;
    }
    this.ws.send("race:finish", {
      roomCode: this.roomCode,
      playerId: this.playerId,
      elapsedMs,
      finishedAtMs,
    });
  }

  getServerNowMs(): number {
    return Date.now() + this.serverClockOffsetMs;
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

  onClockSync(cb: ClockSyncListener): () => void {
    this.clockSyncListeners.add(cb);
    cb(this.serverClockOffsetMs);
    return () => this.clockSyncListeners.delete(cb);
  }

  private startPingLoop(): void {
    if (typeof window === "undefined") {
      return;
    }
    if (this.pingTimer != null) {
      return;
    }
    this.sendPing();
    this.pingTimer = window.setInterval(() => {
      this.sendPing();
    }, PING_INTERVAL_MS);
  }

  private stopPingLoop(): void {
    if (this.pingTimer == null) {
      return;
    }
    if (typeof window !== "undefined") {
      window.clearInterval(this.pingTimer);
    }
    this.pingTimer = null;
  }

  private sendPing(): void {
    this.ws.send("ping", { t: Date.now() });
  }

  private flushPendingActions(): void {
    if (this.ws.getStatus() !== "connected") {
      return;
    }
    if (this.pendingCreateRoom) {
      if (!this.isLobbySocketUrl(this.ws.getUrl())) {
        this.ws.connect(this.getLobbySocketUrl());
        return;
      }
      this.ws.send("room:create", {});
      this.pendingCreateRoom = false;
      return;
    }
    if (this.pendingJoin) {
      const roomUrl = this.getRoomSocketUrl(this.pendingJoin.roomCode);
      if (this.ws.getUrl() !== roomUrl) {
        this.ws.connect(roomUrl);
        return;
      }
      this.ws.send("room:join", {
        roomCode: this.pendingJoin.roomCode,
        name: this.pendingJoin.name,
      });
      this.sendHello(this.pendingJoin.name, this.pendingJoin.roomCode);
      this.pendingJoin = null;
    }
  }

  private onPong(sentAtMs: number, serverNowMs: number): void {
    const receivedAtMs = Date.now();
    const rttMs = Math.max(0, receivedAtMs - sentAtMs);
    const estimatedServerNowAtReceive = serverNowMs + rttMs * 0.5;
    const sampleOffset = estimatedServerNowAtReceive - receivedAtMs;
    if (!this.hasClockSync) {
      this.serverClockOffsetMs = sampleOffset;
      this.hasClockSync = true;
    } else {
      this.serverClockOffsetMs =
        this.serverClockOffsetMs * 0.85 + sampleOffset * 0.15;
    }
    this.emitClockOffset();
  }

  private emitClockOffset(): void {
    for (const cb of this.clockSyncListeners) {
      cb(this.serverClockOffsetMs);
    }
  }

  private resetRaceStateSeq(): void {
    this.nextRaceStateSeq = 1;
  }

  private consumeRaceStateSeq(): number {
    const seq = this.nextRaceStateSeq;
    this.nextRaceStateSeq =
      seq >= Number.MAX_SAFE_INTEGER ? 1 : this.nextRaceStateSeq + 1;
    return seq;
  }

  private getLobbySocketUrl(): string {
    return resolveWsUrlForRoom(this.baseWsUrl);
  }

  private getRoomSocketUrl(roomCode: string): string {
    return resolveWsUrlForRoom(this.baseWsUrl, roomCode);
  }

  private isLobbySocketUrl(urlString: string): boolean {
    const url = new URL(urlString);
    return !url.searchParams.get("room");
  }
}
