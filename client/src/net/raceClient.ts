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
type JoinTimingListener = (timing: JoinTimingSnapshot | null) => void;

const PING_INTERVAL_MS = 2000;
const JOIN_ACK_RETRY_MS = 1200;
const JOIN_ACK_MAX_RETRIES = 2;

type JoinStage =
  | "requested"
  | "socket_connected"
  | "join_sent"
  | "retrying"
  | "hello_ack"
  | "timeout";

export type JoinTimingSnapshot = {
  attemptId: number;
  roomCode: string;
  stage: JoinStage;
  retryCount: number;
  requestedAtMs: number;
  wsConnectedAtMs: number | null;
  joinSentAtMs: number | null;
  helloAckAtMs: number | null;
  elapsedToSocketConnectedMs: number | null;
  elapsedToJoinSentMs: number | null;
  elapsedToHelloAckMs: number | null;
};

type JoinAttemptState = Omit<
  JoinTimingSnapshot,
  "elapsedToSocketConnectedMs" | "elapsedToJoinSentMs" | "elapsedToHelloAckMs"
>;

export class RaceClient {
  private readonly ws: WSClient;

  private readonly baseWsUrl: string;

  private roomCode = "";

  private playerId = "";
  private preferredName: string | undefined;

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
        handshakeSent: boolean;
      }
    | null = null;

  private joinAttemptId = 0;

  private joinAckRetryTimer: number | null = null;

  private joinAttemptState: JoinAttemptState | null = null;

  private readonly joinTimingListeners = new Set<JoinTimingListener>();

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
        if (this.pendingJoin) {
          this.pendingJoin.handshakeSent = false;
        }
        this.clearJoinAckRetryTimer();
        this.resetRaceStateSeq();
        this.stopPingLoop();
        this.serverClockOffsetMs = 0;
        this.hasClockSync = false;
        this.emitClockOffset();
      } else if (status === "connected") {
        if (this.pendingJoin) {
          this.markJoinSocketConnected(this.pendingJoin.roomCode);
        }
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
          name: this.preferredName,
          handshakeSent: false,
        };
        this.startJoinAttempt(message.payload.roomCode);
        this.ws.connect(this.getRoomSocketUrl(message.payload.roomCode));
      }
      if (message.type === "room:state" && !this.roomCode) {
        this.roomCode = message.payload.roomCode;
      }
      if (message.type === "race:hello:ack") {
        this.roomCode = message.payload.roomCode;
        this.playerId = message.payload.playerId;
        this.pendingJoin = null;
        this.clearJoinAckRetryTimer();
        this.markJoinHelloAck(message.payload.roomCode);
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
    this.clearJoinAckRetryTimer();
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

  setPreferredName(name?: string): void {
    const normalized = name?.trim();
    this.preferredName = normalized ? normalized : undefined;
    if (this.pendingJoin) {
      this.pendingJoin.name = this.preferredName;
    }
    if (this.roomCode && this.ws.getStatus() === "connected") {
      this.sendHello(this.preferredName, this.roomCode);
    }
  }

  createRoom(): void {
    this.resetRaceStateSeq();
    this.pendingCreateRoom = true;
    this.pendingJoin = null;
    this.joinAttemptState = null;
    this.emitJoinTiming(null);
    this.clearJoinAckRetryTimer();
    this.roomCode = "";
    this.playerId = "";
    this.ws.connect(this.getLobbySocketUrl());
    this.flushPendingActions();
  }

  joinRoom(roomCode: string, name?: string): void {
    const normalized = roomCode.trim().toUpperCase();
    const resolvedName = name ?? this.preferredName;
    this.resetRaceStateSeq();
    this.roomCode = normalized;
    this.pendingJoin = { roomCode: normalized, name: resolvedName, handshakeSent: false };
    this.startJoinAttempt(normalized);
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

  onJoinTiming(cb: JoinTimingListener): () => void {
    this.joinTimingListeners.add(cb);
    cb(this.makeJoinSnapshot(this.joinAttemptState));
    return () => this.joinTimingListeners.delete(cb);
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
      if (!this.pendingJoin.handshakeSent) {
        this.sendPendingJoinHandshake("join_sent");
      } else if (this.playerId) {
        this.pendingJoin = null;
      } else {
        this.scheduleJoinAckRetry();
      }
    }
  }

  private sendPendingJoinHandshake(
    stage: Extract<JoinStage, "join_sent" | "retrying">,
    retryCount = this.joinAttemptState?.retryCount ?? 0,
  ): void {
    if (!this.pendingJoin) {
      return;
    }
    this.pendingJoin.handshakeSent = true;
    this.ws.send("room:join", {
      roomCode: this.pendingJoin.roomCode,
      name: this.pendingJoin.name,
    });
    this.sendHello(this.pendingJoin.name, this.pendingJoin.roomCode);

    if (!this.joinAttemptState || this.joinAttemptState.roomCode !== this.pendingJoin.roomCode) {
      this.startJoinAttempt(this.pendingJoin.roomCode);
    }
    if (!this.joinAttemptState) {
      return;
    }

    const now = Date.now();
    if (this.joinAttemptState.joinSentAtMs == null) {
      this.joinAttemptState.joinSentAtMs = now;
    }
    this.joinAttemptState.stage = stage;
    this.joinAttemptState.retryCount = retryCount;
    this.emitJoinTiming(this.makeJoinSnapshot(this.joinAttemptState));
    this.scheduleJoinAckRetry();
  }

  private scheduleJoinAckRetry(): void {
    if (typeof window === "undefined") {
      return;
    }
    if (!this.pendingJoin || this.playerId) {
      this.clearJoinAckRetryTimer();
      return;
    }
    this.clearJoinAckRetryTimer();
    this.joinAckRetryTimer = window.setTimeout(() => {
      this.joinAckRetryTimer = null;
      if (!this.pendingJoin || this.playerId) {
        return;
      }
      if (this.ws.getStatus() !== "connected") {
        return;
      }
      const nextRetryCount = (this.joinAttemptState?.retryCount ?? 0) + 1;
      if (nextRetryCount > JOIN_ACK_MAX_RETRIES) {
        this.markJoinTimeout(this.pendingJoin.roomCode);
        for (const cb of this.errorListeners) {
          cb("Join handshake timed out. Retry join if this persists.");
        }
        return;
      }
      this.sendPendingJoinHandshake("retrying", nextRetryCount);
    }, JOIN_ACK_RETRY_MS);
  }

  private clearJoinAckRetryTimer(): void {
    if (this.joinAckRetryTimer == null || typeof window === "undefined") {
      return;
    }
    window.clearTimeout(this.joinAckRetryTimer);
    this.joinAckRetryTimer = null;
  }

  private startJoinAttempt(roomCode: string): void {
    this.clearJoinAckRetryTimer();
    this.joinAttemptId += 1;
    this.joinAttemptState = {
      attemptId: this.joinAttemptId,
      roomCode,
      stage: "requested",
      retryCount: 0,
      requestedAtMs: Date.now(),
      wsConnectedAtMs: null,
      joinSentAtMs: null,
      helloAckAtMs: null,
    };
    console.info(`[raceClient] join requested ${roomCode} (attempt ${this.joinAttemptId})`);
    this.emitJoinTiming(this.makeJoinSnapshot(this.joinAttemptState));
  }

  private markJoinSocketConnected(roomCode: string): void {
    if (!this.joinAttemptState || this.joinAttemptState.roomCode !== roomCode) {
      this.startJoinAttempt(roomCode);
    }
    if (!this.joinAttemptState) {
      return;
    }
    if (this.joinAttemptState.wsConnectedAtMs == null) {
      this.joinAttemptState.wsConnectedAtMs = Date.now();
    }
    if (this.joinAttemptState.stage === "requested") {
      this.joinAttemptState.stage = "socket_connected";
    }
    this.emitJoinTiming(this.makeJoinSnapshot(this.joinAttemptState));
  }

  private markJoinHelloAck(roomCode: string): void {
    if (!this.joinAttemptState || this.joinAttemptState.roomCode !== roomCode) {
      this.startJoinAttempt(roomCode);
    }
    if (!this.joinAttemptState) {
      return;
    }
    const now = Date.now();
    if (this.joinAttemptState.wsConnectedAtMs == null) {
      this.joinAttemptState.wsConnectedAtMs = now;
    }
    if (this.joinAttemptState.joinSentAtMs == null) {
      this.joinAttemptState.joinSentAtMs = now;
    }
    this.joinAttemptState.helloAckAtMs = now;
    this.joinAttemptState.stage = "hello_ack";
    const snapshot = this.makeJoinSnapshot(this.joinAttemptState);
    this.emitJoinTiming(snapshot);
    if (snapshot) {
      console.info("[raceClient] join handshake completed", {
        roomCode: snapshot.roomCode,
        attemptId: snapshot.attemptId,
        elapsedToSocketConnectedMs: snapshot.elapsedToSocketConnectedMs,
        elapsedToJoinSentMs: snapshot.elapsedToJoinSentMs,
        elapsedToHelloAckMs: snapshot.elapsedToHelloAckMs,
        retryCount: snapshot.retryCount,
      });
    }
  }

  private markJoinTimeout(roomCode: string): void {
    if (!this.joinAttemptState || this.joinAttemptState.roomCode !== roomCode) {
      return;
    }
    if (this.joinAttemptState.stage === "hello_ack") {
      return;
    }
    this.joinAttemptState.stage = "timeout";
    this.emitJoinTiming(this.makeJoinSnapshot(this.joinAttemptState));
  }

  private emitJoinTiming(snapshot: JoinTimingSnapshot | null): void {
    for (const cb of this.joinTimingListeners) {
      cb(snapshot);
    }
  }

  private makeJoinSnapshot(state: JoinAttemptState | null): JoinTimingSnapshot | null {
    if (!state) {
      return null;
    }
    return {
      ...state,
      elapsedToSocketConnectedMs:
        state.wsConnectedAtMs == null ? null : state.wsConnectedAtMs - state.requestedAtMs,
      elapsedToJoinSentMs:
        state.joinSentAtMs == null ? null : state.joinSentAtMs - state.requestedAtMs,
      elapsedToHelloAckMs:
        state.helloAckAtMs == null ? null : state.helloAckAtMs - state.requestedAtMs,
    };
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
