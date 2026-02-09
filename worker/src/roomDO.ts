import {
  encodeMessage,
  safeParseMessage,
  type MessagePayloadMap,
} from "@get-tilted/shared-protocol";

type SocketWithMeta = WebSocket & {
  roomCode?: string;
};

export class RoomDO {
  constructor(state: DurableObjectState) {
    void state;
  }

  private sockets = new Set<SocketWithMeta>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1] as SocketWithMeta;
    const roomCode = new URL(request.url).searchParams.get("roomCode") ?? "UNKNOWN";
    server.roomCode = roomCode;
    server.accept();

    this.sockets.add(server);
    this.broadcastRoomState(roomCode);

    server.addEventListener("message", (event) => {
      const parsed = safeParseMessage(typeof event.data === "string" ? event.data : "");
      if (!parsed.ok) {
        this.send(server, "error", { code: "BAD_MESSAGE", message: parsed.error });
        return;
      }

      if (parsed.msg.type === "ping") {
        this.send(server, "pong", { t: parsed.msg.payload.t });
      }
    });

    server.addEventListener("close", () => {
      this.sockets.delete(server);
      if (server.roomCode) {
        this.broadcastRoomState(server.roomCode);
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private send<TType extends keyof MessagePayloadMap>(
    socket: WebSocket,
    type: TType,
    payload: MessagePayloadMap[TType],
  ): void {
    socket.send(encodeMessage(type, payload));
  }

  private broadcastRoomState(roomCode: string): void {
    const clients = [...this.sockets].filter((socket) => socket.roomCode === roomCode);
    const payload = { roomCode, clients: clients.length };
    for (const socket of clients) {
      this.send(socket, "room:state", payload);
    }
  }
}
