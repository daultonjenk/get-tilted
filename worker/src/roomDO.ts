import {
  calculateRaceResults,
  encodeMessage,
  generateRoomCode,
  safeParseMessage,
  sanitizeTrackSeed,
  COUNTDOWN_STEP_MS,
  COUNTDOWN_PREROLL_MS,
  ROOM_MAX_CLIENTS,
  type MessagePayloadMap,
  type RaceFinishRecord,
} from "@get-tilted/shared-protocol";

type SocketWithMeta = WebSocket & {
  roomCode?: string | null;
  playerId?: string;
  playerName?: string;
  playerSkinId?: string;
};

type RaceResultPayload = MessagePayloadMap["race:result"];

const OPEN_STATE = 1;
const LOBBY_KEY = "__LOBBY__";
const ROOM_IDLE_ALARM_MS = 5 * 60 * 1000; // 5 minutes until empty room cleanup

// race:state value-range bounds for server-side validation
const POS_RANGE = 500; // max absolute value for any position component
const VEL_RANGE = 200; // max absolute value for any velocity component
const RACE_STATE_MAX_HZ = 25; // max state messages per second per player
const RACE_STATE_MIN_INTERVAL_MS = 1000 / RACE_STATE_MAX_HZ;

export class RoomDO {
  private roomKey = LOBBY_KEY;

  private roomCode: string | null = null;

  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private sockets = new Set<SocketWithMeta>();

  /** Per-player timestamp of last accepted race:state message (for rate limiting). */
  private lastRaceStateAt = new Map<string, number>();

  /** Cached last race:state payload per player for reconnection recovery. */
  private lastRaceState = new Map<string, MessagePayloadMap["race:state"]>();

  private readyPlayerIds = new Set<string>();

  private countdownStartAtMs: number | null = null;

  private raceActive = false;

  private finishes = new Map<string, RaceFinishRecord>();

  private raceResult: RaceResultPayload | null = null;

  private hostPlayerId: string | null = null;

  private nextPlayerSeq = 1;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    this.roomKey = url.searchParams.get("roomKey") ?? LOBBY_KEY;
    this.roomCode = url.searchParams.get("roomCode");

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1] as SocketWithMeta;
    server.roomCode = this.roomCode;
    server.accept();

    this.sockets.add(server);
    this.cancelCleanupAlarm();
    this.broadcastRoomState();

    server.addEventListener("message", (event) => {
      const parsed = safeParseMessage(typeof event.data === "string" ? event.data : "");
      if (!parsed.ok) {
        this.send(server, "error", { code: "BAD_MESSAGE", message: parsed.error });
        return;
      }

      if (parsed.msg.type === "ping") {
        this.send(server, "pong", {
          t: parsed.msg.payload.t,
          serverNowMs: Date.now(),
        });
        return;
      }

      switch (parsed.msg.type) {
        case "room:create": {
          if (!this.isLobby()) {
            this.send(server, "error", {
              code: "INVALID_CONTEXT",
              message: "room:create is only available on lobby connections",
            });
            return;
          }
          const roomCode = generateRoomCode();
          this.send(server, "room:created", { roomCode });
          return;
        }
        case "room:join": {
          if (this.isLobby()) {
            this.send(server, "error", {
              code: "LOBBY_JOIN_FORBIDDEN",
              message: "Reconnect to /ws?room=ROOMCODE before joining",
            });
            return;
          }
          const normalized = parsed.msg.payload.roomCode.trim().toUpperCase();
          if (!this.roomCode || normalized !== this.roomCode) {
            this.send(server, "error", {
              code: "ROOM_MISMATCH",
              message: "Socket room does not match join payload room",
            });
            return;
          }
          if (!server.playerId) {
            if (this.getSocketCount() >= ROOM_MAX_CLIENTS) {
              this.send(server, "error", {
                code: "ROOM_FULL",
                message: `Room is full: ${this.roomCode}`,
              });
              return;
            }
            server.playerId = this.createPlayerId();
            if (!this.hostPlayerId) {
              this.hostPlayerId = server.playerId;
            }
          }
          server.playerName = parsed.msg.payload.name;
          server.playerSkinId = parsed.msg.payload.skinId;
          server.roomCode = normalized;
          this.broadcastRoomState();
          this.broadcastHelloAck();
          this.broadcastReadyState();
          return;
        }
        case "race:hello": {
          if (!this.roomCode || this.roomCode !== parsed.msg.payload.roomCode) {
            this.send(server, "error", {
              code: "NOT_IN_ROOM",
              message: "Client must join room before race:hello",
            });
            return;
          }
          const playerId = server.playerId;
          if (!playerId) {
            this.send(server, "error", {
              code: "NO_PLAYER_ID",
              message: "Player identity not found for socket",
            });
            return;
          }
          server.playerName = parsed.msg.payload.name;
          server.playerSkinId = parsed.msg.payload.skinId;
          this.broadcastHelloAck();
          return;
        }
        case "race:state": {
          if (!this.roomCode || parsed.msg.payload.roomCode !== this.roomCode) {
            return;
          }
          if (!server.playerId || parsed.msg.payload.playerId !== server.playerId) {
            return;
          }
          // T1-4: Rate limiting — drop messages exceeding max Hz per player
          const now = Date.now();
          const lastAt = this.lastRaceStateAt.get(server.playerId) ?? 0;
          if (now - lastAt < RACE_STATE_MIN_INTERVAL_MS) {
            return; // rate-limited
          }
          this.lastRaceStateAt.set(server.playerId, now);

          // T1-4: Value-range validation — reject extreme/malicious payloads
          if (!this.isRaceStateInBounds(parsed.msg.payload)) {
            return;
          }

          // T2-8: Cache last state per player for reconnection recovery.
          this.lastRaceState.set(server.playerId, parsed.msg.payload);

          this.broadcastToOthers(server, "race:state", parsed.msg.payload);
          return;
        }
        case "race:ready": {
          if (!this.roomCode || parsed.msg.payload.roomCode !== this.roomCode) {
            return;
          }
          if (!server.playerId || parsed.msg.payload.playerId !== server.playerId) {
            return;
          }
          if (this.countdownStartAtMs != null) {
            this.send(server, "error", {
              code: "RACE_LOCKED",
              message: "Ready state is locked once countdown has started",
            });
            this.broadcastReadyState();
            return;
          }

          if (parsed.msg.payload.ready) {
            this.readyPlayerIds.add(server.playerId);
          } else {
            this.readyPlayerIds.delete(server.playerId);
            this.countdownStartAtMs = null;
          }

          this.broadcastReadyState();
          return;
        }
        case "race:start": {
          if (!this.roomCode || parsed.msg.payload.roomCode !== this.roomCode) {
            return;
          }
          if (!server.playerId || parsed.msg.payload.playerId !== server.playerId) {
            return;
          }
          if (this.countdownStartAtMs != null) {
            this.send(server, "error", {
              code: "RACE_LOCKED",
              message: "Countdown already started",
            });
            return;
          }
          if (this.raceActive) {
            this.send(server, "error", {
              code: "RACE_ACTIVE",
              message: "Race already active",
            });
            return;
          }
          if (!this.hostPlayerId || this.hostPlayerId !== server.playerId) {
            this.send(server, "error", {
              code: "NOT_HOST",
              message: "Only the host can start the match",
            });
            return;
          }
          if (!this.canStartRace(server.playerId)) {
            this.send(server, "error", {
              code: "START_BLOCKED",
              message: "Need at least 2 players and all joined players ready",
            });
            this.broadcastReadyState();
            return;
          }
          const trackSeed = sanitizeTrackSeed(parsed.msg.payload.trackSeed);
          const startAtMs = Date.now() + COUNTDOWN_PREROLL_MS;
          this.beginRace(startAtMs);
          this.broadcast("race:countdown:start", {
            roomCode: this.roomCode,
            startAtMs,
            stepMs: COUNTDOWN_STEP_MS,
            trackSeed,
          });
          this.broadcastReadyState();
          return;
        }
        case "race:finish": {
          if (!this.roomCode || parsed.msg.payload.roomCode !== this.roomCode) {
            return;
          }
          if (!server.playerId || parsed.msg.payload.playerId !== server.playerId) {
            return;
          }
          if (!this.raceActive) {
            return;
          }
          if (this.finishes.has(server.playerId)) {
            return;
          }
          this.finishes.set(server.playerId, {
            elapsedMs: parsed.msg.payload.elapsedMs,
            finishedAtMs: parsed.msg.payload.finishedAtMs,
          });
          this.broadcastRaceResult(this.finishes.size >= this.getSocketCount());
          return;
        }
        default:
          this.send(server, "error", {
            code: "UNHANDLED_TYPE",
            message: `Unhandled message type: ${parsed.msg.type}`,
          });
      }
    });

    server.addEventListener("close", () => {
      this.sockets.delete(server);

      if (server.playerId) {
        this.readyPlayerIds.delete(server.playerId);
        this.lastRaceStateAt.delete(server.playerId);
        if (this.hostPlayerId === server.playerId) {
          this.hostPlayerId = this.findOldestPlayerId();
        }
      }

      if (
        this.roomCode &&
        server.playerId &&
        this.raceActive &&
        this.raceResult == null &&
        !this.finishes.has(server.playerId)
      ) {
        this.finishes.set(server.playerId, {
          elapsedMs: Number.POSITIVE_INFINITY,
          finishedAtMs: Date.now(),
        });
      }

      if (this.roomCode && server.playerId) {
        this.broadcastToOthers(server, "race:left", {
          roomCode: this.roomCode,
          playerId: server.playerId,
        });
      }

      if (this.finishes.size >= 1 && this.getSocketCount() < ROOM_MAX_CLIENTS) {
        this.broadcastRaceResult(true);
      }

      if (this.getSocketCount() < ROOM_MAX_CLIENTS) {
        this.countdownStartAtMs = null;
        if (!this.raceActive) {
          this.clearRace();
        }
      }

      this.broadcastRoomState();
      this.broadcastHelloAck();
      this.broadcastReadyState();
      this.scheduleCleanupAlarm();
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private send<TType extends keyof MessagePayloadMap>(
    socket: WebSocket,
    type: TType,
    payload: MessagePayloadMap[TType],
  ): void {
    if ((socket as { readyState?: number }).readyState !== OPEN_STATE) {
      return;
    }
    socket.send(encodeMessage(type, payload));
  }

  private broadcast<TType extends keyof MessagePayloadMap>(
    type: TType,
    payload: MessagePayloadMap[TType],
  ): void {
    for (const socket of this.sockets) {
      this.send(socket, type, payload);
    }
  }

  private broadcastToOthers<TType extends keyof MessagePayloadMap>(
    sender: WebSocket,
    type: TType,
    payload: MessagePayloadMap[TType],
  ): void {
    for (const socket of this.sockets) {
      if (socket === sender) {
        continue;
      }
      this.send(socket, type, payload);
    }
  }

  private isLobby(): boolean {
    return this.roomKey === LOBBY_KEY;
  }

  private getSocketCount(): number {
    let count = 0;
    for (const socket of this.sockets) {
      if (socket.playerId) {
        count += 1;
      }
    }
    return count;
  }

  private getPlayers(): Array<{ playerId: string; name?: string; skinId?: string }> {
    const players: Array<{ playerId: string; name?: string; skinId?: string }> = [];
    for (const socket of this.sockets) {
      if (!socket.playerId) {
        continue;
      }
      players.push({
        playerId: socket.playerId,
        name: socket.playerName,
        skinId: socket.playerSkinId,
      });
    }
    return players;
  }

  private broadcastRoomState(): void {
    if (!this.roomCode) {
      return;
    }
    const payload = {
      roomCode: this.roomCode,
      clients: this.getSocketCount(),
    };
    this.broadcast("room:state", payload);
  }

  private broadcastReadyState(): void {
    if (!this.roomCode) {
      return;
    }
    this.broadcast("race:ready:state", {
      roomCode: this.roomCode,
      readyPlayerIds: [...this.readyPlayerIds],
      countdownStartAtMs: this.countdownStartAtMs ?? undefined,
    });
  }

  private broadcastHelloAck(): void {
    if (!this.roomCode) {
      return;
    }
    if (!this.hostPlayerId) {
      this.hostPlayerId = this.findOldestPlayerId();
    }
    if (!this.hostPlayerId) {
      return;
    }
    const players = this.getPlayers();
    // T2-8: Build lastStates array for reconnection recovery.
    const lastStates: Array<{
      playerId: string;
      t: number;
      pos: [number, number, number];
      quat: [number, number, number, number];
      vel: [number, number, number];
      trackPos?: [number, number, number];
      trackQuat?: [number, number, number, number];
    }> = [];
    for (const [pid, state] of this.lastRaceState) {
      lastStates.push({
        playerId: pid,
        t: state.t,
        pos: state.pos,
        quat: state.quat,
        vel: state.vel,
        trackPos: state.trackPos,
        trackQuat: state.trackQuat,
      });
    }
    for (const socket of this.sockets) {
      if (!socket.playerId) {
        continue;
      }
      this.send(socket, "race:hello:ack", {
        roomCode: this.roomCode,
        playerId: socket.playerId,
        hostPlayerId: this.hostPlayerId,
        players,
        lastStates: lastStates.length > 0 ? lastStates : undefined,
      });
    }
  }

  private beginRace(startAtMs: number): void {
    this.raceActive = true;
    this.countdownStartAtMs = startAtMs;
    this.finishes.clear();
    this.raceResult = null;
  }

  private clearRace(): void {
    this.raceActive = false;
    this.countdownStartAtMs = null;
    this.finishes.clear();
    this.raceResult = null;
    this.readyPlayerIds.clear();
    this.lastRaceState.clear();
    if (this.getSocketCount() === 0) {
      this.hostPlayerId = null;
    }
  }

  private broadcastRaceResult(isFinal: boolean): void {
    if (!this.roomCode || (isFinal && this.raceResult != null)) {
      return;
    }

    const players = this.getPlayers();
    const calc = calculateRaceResults(players, this.finishes, isFinal);
    if (!calc) {
      return;
    }

    const payload: RaceResultPayload = {
      roomCode: this.roomCode,
      isFinal,
      winnerPlayerId: calc.winnerPlayerId,
      tie: calc.tie,
      results: calc.results,
    };
    this.broadcast("race:result", payload);
    if (isFinal) {
      this.raceResult = payload;
      this.raceActive = false;
      this.readyPlayerIds.clear();
      this.countdownStartAtMs = null;
      this.broadcastReadyState();
    }
  }

  private createPlayerId(): string {
    const id = `P${this.nextPlayerSeq.toString().padStart(4, "0")}`;
    this.nextPlayerSeq += 1;
    return id;
  }

  private canStartRace(playerId: string): boolean {
    if (this.hostPlayerId !== playerId) {
      return false;
    }
    const players = this.getPlayers();
    if (players.length < 2) {
      return false;
    }
    if (this.readyPlayerIds.size !== players.length) {
      return false;
    }
    return players.every((entry) => this.readyPlayerIds.has(entry.playerId));
  }

  private findOldestPlayerId(): string | null {
    for (const socket of this.sockets) {
      if (socket.playerId) {
        return socket.playerId;
      }
    }
    return null;
  }

  /** T1-4: Validate that race:state payload values are within expected bounds. */
  private isRaceStateInBounds(
    payload: MessagePayloadMap["race:state"],
  ): boolean {
    const { pos, vel, trackPos } = payload;
    if (!this.isTupleInRange(pos, POS_RANGE)) return false;
    if (!this.isTupleInRange(vel, VEL_RANGE)) return false;
    if (trackPos && !this.isTupleInRange(trackPos, POS_RANGE)) return false;
    return true;
  }

  private isTupleInRange(
    tuple: readonly number[],
    maxAbs: number,
  ): boolean {
    for (const v of tuple) {
      if (v !== v || v < -maxAbs || v > maxAbs) return false; // NaN check via self-inequality
    }
    return true;
  }

  /** T1-5: Schedule room cleanup when last socket disconnects. */
  private scheduleCleanupAlarm(): void {
    if (this.sockets.size === 0) {
      this.state.storage.setAlarm(Date.now() + ROOM_IDLE_ALARM_MS);
    }
  }

  /** T1-5: Cancel cleanup alarm when a new connection arrives. */
  private cancelCleanupAlarm(): void {
    this.state.storage.deleteAlarm();
  }

  /** T1-5: Durable Object alarm handler — clean up empty rooms. */
  async alarm(): Promise<void> {
    if (this.sockets.size === 0) {
      this.lastRaceStateAt.clear();
      this.clearRace();
      await this.state.storage.deleteAll();
    }
  }
}
