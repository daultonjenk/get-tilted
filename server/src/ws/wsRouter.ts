import type { IncomingMessage } from "node:http";
import {
  encodeMessage,
  safeParseMessage,
  type MessagePayloadMap,
} from "@get-tilted/shared-protocol";
import type { WebSocket } from "ws";
import { generateRoomCode } from "./roomCode.js";
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
        send(ws as SendableSocket, "pong", { t: parsed.msg.payload.t });
        return;
      case "room:create": {
        let roomCode = generateRoomCode();
        while (roomStore.exists(roomCode)) {
          roomCode = generateRoomCode();
        }
        roomStore.join(roomCode, ws);
        send(ws as SendableSocket, "room:created", { roomCode });
        broadcastRoomState(roomCode);
        return;
      }
      case "room:join": {
        const { roomCode } = parsed.msg.payload;
        if (!roomStore.exists(roomCode)) {
          send(ws as SendableSocket, "error", {
            code: "ROOM_NOT_FOUND",
            message: `Room does not exist: ${roomCode}`,
          });
          return;
        }
        roomStore.join(roomCode, ws);
        broadcastRoomState(roomCode);
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
    const roomCode = roomStore.getRoomCode(ws);
    roomStore.leave(ws);
    if (roomCode) {
      broadcastRoomState(roomCode);
    }
    console.log(`[${new Date().toISOString()}] disconnect ${remote} (${code}:${reason})`);
  });
}
