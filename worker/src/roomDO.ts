import {
  encodeMessage,
  safeParseMessage,
  type MessagePayloadMap,
} from "@get-tilted/shared-protocol";

type SocketWithMeta = WebSocket & {
  roomCode?: string | null;
  playerId?: string;
  playerName?: string;
};

type RaceFinishRecord = {
  elapsedMs: number;
  finishedAtMs: number;
};

type RaceResultPayload = MessagePayloadMap["race:result"];

const OPEN_STATE = 1;
const ROOM_MAX_CLIENTS = 2;
const COUNTDOWN_STEP_MS = 1000;
const COUNTDOWN_PREROLL_MS = 600;
const COUNTDOWN_TOTAL_STEPS = 4;
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LOBBY_KEY = "__LOBBY__";

export class RoomDO {
  private roomKey = LOBBY_KEY;

  private roomCode: string | null = null;

  constructor(state: DurableObjectState) {
    void state;
  }

  private sockets = new Set<SocketWithMeta>();

  private readyPlayerIds = new Set<string>();

  private countdownStartAtMs: number | null = null;

  private raceActive = false;

  private finishes = new Map<string, RaceFinishRecord>();

  private raceResult: RaceResultPayload | null = null;

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
          const roomCode = this.generateRoomCode();
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
          }
          server.playerName = parsed.msg.payload.name;
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

          const now = Date.now();
          if (
            this.countdownStartAtMs != null &&
            now >= this.countdownStartAtMs + COUNTDOWN_STEP_MS * COUNTDOWN_TOTAL_STEPS
          ) {
            this.countdownStartAtMs = null;
          }

          if (
            this.readyPlayerIds.size === ROOM_MAX_CLIENTS &&
            this.getSocketCount() === ROOM_MAX_CLIENTS &&
            this.countdownStartAtMs == null
          ) {
            const startAtMs = now + COUNTDOWN_PREROLL_MS;
            this.beginRace(startAtMs);
            this.broadcast("race:countdown:start", {
              roomCode: this.roomCode,
              startAtMs,
              stepMs: COUNTDOWN_STEP_MS,
            });
          }

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
          this.broadcastRaceResult(this.finishes.size >= ROOM_MAX_CLIENTS);
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
      this.broadcastReadyState();
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

  private getPlayers(): Array<{ playerId: string; name?: string }> {
    const players: Array<{ playerId: string; name?: string }> = [];
    for (const socket of this.sockets) {
      if (!socket.playerId) {
        continue;
      }
      players.push({ playerId: socket.playerId, name: socket.playerName });
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
    const players = this.getPlayers();
    for (const socket of this.sockets) {
      if (!socket.playerId) {
        continue;
      }
      this.send(socket, "race:hello:ack", {
        roomCode: this.roomCode,
        playerId: socket.playerId,
        players,
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
  }

  private broadcastRaceResult(isFinal: boolean): void {
    if (!this.roomCode || (isFinal && this.raceResult != null)) {
      return;
    }

    const players = this.getPlayers();
    if (players.length === 0) {
      return;
    }

    const results = isFinal
      ? players.map((player) => {
          const finish = this.finishes.get(player.playerId);
          if (finish && Number.isFinite(finish.elapsedMs)) {
            return {
              playerId: player.playerId,
              status: "finished" as const,
              elapsedMs: finish.elapsedMs,
            };
          }
          return {
            playerId: player.playerId,
            status: "dnf" as const,
          };
        })
      : players
          .map((player) => {
            const finish = this.finishes.get(player.playerId);
            if (finish && Number.isFinite(finish.elapsedMs)) {
              return {
                playerId: player.playerId,
                status: "finished" as const,
                elapsedMs: finish.elapsedMs,
              };
            }
            return null;
          })
          .filter((entry): entry is { playerId: string; status: "finished"; elapsedMs: number } => {
            return entry !== null;
          })
          .sort((a, b) => a.elapsedMs - b.elapsedMs);

    if (results.length === 0) {
      return;
    }

    const finished = results
      .filter((entry) => entry.status === "finished")
      .map((entry) => ({
        playerId: entry.playerId,
        elapsedMs: entry.elapsedMs ?? Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.elapsedMs - b.elapsedMs);

    let winnerPlayerId: string | undefined;
    let tie = false;
    if (finished.length >= 2 && finished[0]?.elapsedMs === finished[1]?.elapsedMs) {
      tie = true;
    } else if (finished.length >= 1 && Number.isFinite(finished[0]!.elapsedMs)) {
      winnerPlayerId = finished[0]!.playerId;
    }

    const payload: RaceResultPayload = {
      roomCode: this.roomCode,
      isFinal,
      winnerPlayerId,
      tie,
      results,
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

  private generateRoomCode(): string {
    const bytes = new Uint8Array(ROOM_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    let out = "";
    for (const byte of bytes) {
      out += ROOM_CODE_CHARS[byte % ROOM_CODE_CHARS.length];
    }
    return out;
  }
}
