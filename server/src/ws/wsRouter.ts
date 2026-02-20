import type { IncomingMessage } from "node:http";
import {
  encodeMessage,
  generateRoomCode,
  safeParseMessage,
  sanitizeTrackSeed,
  COUNTDOWN_STEP_MS,
  COUNTDOWN_PREROLL_MS,
  type MessagePayloadMap,
} from "@get-tilted/shared-protocol";
import type { WebSocket } from "ws";
import { RoomStore } from "./roomStore.js";

type SendableSocket = WebSocket & { readyState: number };
const OPEN_STATE = 1;

const roomStore = new RoomStore();

function send<TType extends keyof MessagePayloadMap>(
  ws: SendableSocket,
  type: TType,
  payload: MessagePayloadMap[TType],
): void {
  if (ws.readyState !== OPEN_STATE) {
    return;
  }
  ws.send(encodeMessage(type, payload));
}

function broadcastRoomState(roomCode: string): void {
  const clients = roomStore.getClients(roomCode);
  const payload = {
    roomCode,
    clients: clients.size,
  };
  for (const client of clients) {
    send(client as SendableSocket, "room:state", payload);
  }
}

function broadcastReadyState(roomCode: string): void {
  const clients = roomStore.getClients(roomCode);
  const countdownStartAtMs = roomStore.getCountdownStart(roomCode);
  const payload = {
    roomCode,
    readyPlayerIds: roomStore.getReadyPlayerIds(roomCode),
    countdownStartAtMs,
  };
  for (const client of clients) {
    send(client as SendableSocket, "race:ready:state", payload);
  }
}

function broadcastHelloAck(roomCode: string): void {
  const players = roomStore.getPlayers(roomCode);
  const hostPlayerId = roomStore.getHostPlayerId(roomCode);
  if (!hostPlayerId) {
    return;
  }
  const clients = roomStore.getClients(roomCode);
  const lastStates = roomStore.getLastRaceStates(roomCode);
  for (const client of clients) {
    const playerId = roomStore.getPlayerId(client);
    if (!playerId) {
      continue;
    }
    send(client as SendableSocket, "race:hello:ack", {
      roomCode,
      playerId,
      hostPlayerId,
      players,
      lastStates: lastStates.length > 0 ? lastStates : undefined,
    });
  }
}

function broadcastRaceResult(roomCode: string, isFinal: boolean): void {
  const payload = roomStore.getRaceResultSnapshotWithCurrentPlayers(roomCode, isFinal);
  if (!payload) {
    return;
  }
  const clients = roomStore.getClients(roomCode);
  for (const client of clients) {
    send(client as SendableSocket, "race:result", payload);
  }
  if (isFinal) {
    roomStore.clearReady(roomCode);
    roomStore.clearCountdownStart(roomCode);
    broadcastReadyState(roomCode);
  }
}

function broadcastToOthers<TType extends keyof MessagePayloadMap>(
  roomCode: string,
  sender: WebSocket,
  type: TType,
  payload: MessagePayloadMap[TType],
): void {
  const clients = roomStore.getClients(roomCode);
  for (const client of clients) {
    if (client === sender) {
      continue;
    }
    send(client as SendableSocket, type, payload);
  }
}

export function handleWsConnection(ws: WebSocket, request: IncomingMessage): void {
  const remote = request.socket.remoteAddress ?? "unknown";
  console.log(`[${new Date().toISOString()}] connection ${remote}`);

  ws.on("message", (raw) => {
    const parsed = safeParseMessage(raw.toString());
    if (!parsed.ok) {
      send(ws as SendableSocket, "error", {
        code: "BAD_MESSAGE",
        message: parsed.error,
      });
      return;
    }

    switch (parsed.msg.type) {
      case "ping":
        send(ws as SendableSocket, "pong", {
          t: parsed.msg.payload.t,
          serverNowMs: Date.now(),
        });
        return;
      case "room:create": {
        let roomCode = generateRoomCode();
        while (roomStore.exists(roomCode)) {
          roomCode = generateRoomCode();
        }
        roomStore.join(roomCode, ws);
        send(ws as SendableSocket, "room:created", { roomCode });
        broadcastRoomState(roomCode);
        broadcastReadyState(roomCode);
        return;
      }
      case "room:join": {
        const { roomCode, name, skinId } = parsed.msg.payload;
        if (!roomStore.exists(roomCode)) {
          send(ws as SendableSocket, "error", {
            code: "ROOM_NOT_FOUND",
            message: `Room does not exist: ${roomCode}`,
          });
          return;
        }
        const joinResult = roomStore.join(roomCode, ws, name, skinId);
        if (!joinResult) {
          send(ws as SendableSocket, "error", {
            code: "ROOM_FULL",
            message: `Room is full: ${roomCode}`,
          });
          return;
        }
        broadcastRoomState(roomCode);
        broadcastHelloAck(roomCode);
        broadcastReadyState(roomCode);
        return;
      }
      case "race:hello": {
        const roomCode = roomStore.getRoomCode(ws);
        if (!roomCode || roomCode !== parsed.msg.payload.roomCode) {
          send(ws as SendableSocket, "error", {
            code: "NOT_IN_ROOM",
            message: "Client must join room before race:hello",
          });
          return;
        }
        const playerId = roomStore.getPlayerId(ws);
        if (!playerId) {
          send(ws as SendableSocket, "error", {
            code: "NO_PLAYER_ID",
            message: "Player identity not found for socket",
          });
          return;
        }
        roomStore.setPlayerProfile(ws, parsed.msg.payload.name, parsed.msg.payload.skinId);
        broadcastHelloAck(roomCode);
        return;
      }
      case "race:state": {
        const roomCode = roomStore.getRoomCode(ws);
        if (!roomCode || roomCode !== parsed.msg.payload.roomCode) {
          return;
        }
        const playerId = roomStore.getPlayerId(ws);
        if (!playerId || playerId !== parsed.msg.payload.playerId) {
          return;
        }
        roomStore.cacheRaceState(roomCode, playerId, parsed.msg.payload);
        broadcastToOthers(roomCode, ws, "race:state", parsed.msg.payload);
        return;
      }
      case "race:ready": {
        const roomCode = roomStore.getRoomCode(ws);
        if (!roomCode || roomCode !== parsed.msg.payload.roomCode) {
          return;
        }
        const playerId = roomStore.getPlayerId(ws);
        if (!playerId || playerId !== parsed.msg.payload.playerId) {
          return;
        }
        if (roomStore.hasCountdown(roomCode)) {
          send(ws as SendableSocket, "error", {
            code: "RACE_LOCKED",
            message: "Ready state is locked once countdown has started",
          });
          broadcastReadyState(roomCode);
          return;
        }
        const updated = roomStore.setReady(roomCode, playerId, parsed.msg.payload.ready);
        if (!updated) {
          return;
        }
        broadcastReadyState(roomCode);
        return;
      }
      case "race:start": {
        const roomCode = roomStore.getRoomCode(ws);
        if (!roomCode || roomCode !== parsed.msg.payload.roomCode) {
          return;
        }
        const playerId = roomStore.getPlayerId(ws);
        if (!playerId || playerId !== parsed.msg.payload.playerId) {
          return;
        }
        if (roomStore.hasCountdown(roomCode)) {
          send(ws as SendableSocket, "error", {
            code: "RACE_LOCKED",
            message: "Countdown already started",
          });
          return;
        }
        if (roomStore.isRaceActive(roomCode)) {
          send(ws as SendableSocket, "error", {
            code: "RACE_ACTIVE",
            message: "Race already active",
          });
          return;
        }
        if (roomStore.getHostPlayerId(roomCode) !== playerId) {
          send(ws as SendableSocket, "error", {
            code: "NOT_HOST",
            message: "Only the host can start the match",
          });
          return;
        }
        if (!roomStore.canStartRace(roomCode, playerId)) {
          send(ws as SendableSocket, "error", {
            code: "START_BLOCKED",
            message: "Need at least 2 players and all joined players ready",
          });
          broadcastReadyState(roomCode);
          return;
        }
        const trackSeed = sanitizeTrackSeed(parsed.msg.payload.trackSeed);
        const startAtMs = Date.now() + COUNTDOWN_PREROLL_MS;
        roomStore.beginRace(roomCode, trackSeed);
        roomStore.setCountdownStart(roomCode, startAtMs);
        const clients = roomStore.getClients(roomCode);
        for (const client of clients) {
          send(client as SendableSocket, "race:countdown:start", {
            roomCode,
            startAtMs,
            stepMs: COUNTDOWN_STEP_MS,
            trackSeed,
          });
        }
        broadcastReadyState(roomCode);
        return;
      }
      case "race:finish": {
        const roomCode = roomStore.getRoomCode(ws);
        if (!roomCode || roomCode !== parsed.msg.payload.roomCode) {
          return;
        }
        const playerId = roomStore.getPlayerId(ws);
        if (!playerId || playerId !== parsed.msg.payload.playerId) {
          return;
        }
        if (
          !roomStore.recordFinish(
            roomCode,
            playerId,
            parsed.msg.payload.elapsedMs,
            parsed.msg.payload.finishedAtMs,
          )
        ) {
          return;
        }
        broadcastRaceResult(roomCode, roomStore.getFinishCount(roomCode) >= roomStore.getClientCount(roomCode));
        return;
      }
      default:
        send(ws as SendableSocket, "error", {
          code: "UNHANDLED_TYPE",
          message: `Unhandled message type: ${parsed.msg.type}`,
        });
    }
  });

  ws.on("close", (code, reasonBuffer) => {
    const reason = reasonBuffer.toString() || "no-reason";
    const roomCodeBeforeLeave = roomStore.getRoomCode(ws);
    const playerIdBeforeLeave = roomStore.getPlayerId(ws);
    if (
      roomCodeBeforeLeave &&
      playerIdBeforeLeave &&
      roomStore.isRaceActive(roomCodeBeforeLeave) &&
      !roomStore.hasRaceResult(roomCodeBeforeLeave)
    ) {
      const shouldFinalizeFromDnf =
        roomStore.hasFinish(roomCodeBeforeLeave, playerIdBeforeLeave) ||
        roomStore.getFinishCount(roomCodeBeforeLeave) >= 1;

      if (!roomStore.hasFinish(roomCodeBeforeLeave, playerIdBeforeLeave)) {
        roomStore.recordFinish(
          roomCodeBeforeLeave,
          playerIdBeforeLeave,
          Number.POSITIVE_INFINITY,
          Date.now(),
        );
      }
      if (shouldFinalizeFromDnf) {
        broadcastRaceResult(roomCodeBeforeLeave, true);
      }
    }

    const leaveResult = roomStore.leave(ws);
    if (leaveResult.roomCode) {
      broadcastHelloAck(leaveResult.roomCode);
      broadcastRoomState(leaveResult.roomCode);
      broadcastReadyState(leaveResult.roomCode);
      if (leaveResult.playerId) {
        broadcastToOthers(leaveResult.roomCode, ws, "race:left", {
          roomCode: leaveResult.roomCode,
          playerId: leaveResult.playerId,
        });
      }
    }
    console.log(`[${new Date().toISOString()}] disconnect ${remote} (${code}:${reason})`);
  });
}
