import type { Env } from "./env";
import { RoomDO } from "./roomDO";

const LOBBY_KEY = "__LOBBY__";
const ROOM_CODE_RE = /^[A-Z0-9]{1,16}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") {
      return new Response("Not Found", { status: 404 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const roomCodeParam = (url.searchParams.get("room") ?? "").trim().toUpperCase();
    if (roomCodeParam && !ROOM_CODE_RE.test(roomCodeParam)) {
      return new Response("Invalid room code", { status: 400 });
    }
    const roomKey = roomCodeParam || LOBBY_KEY;

    const id = env.ROOMS.idFromName(roomKey);
    const stub = env.ROOMS.get(id);
    const doUrl = new URL(request.url);
    doUrl.pathname = "/room";
    if (roomCodeParam) {
      doUrl.searchParams.set("roomCode", roomCodeParam);
    } else {
      doUrl.searchParams.delete("roomCode");
    }
    doUrl.searchParams.set("roomKey", roomKey);

    return stub.fetch(
      new Request(doUrl.toString(), {
        method: request.method,
        headers: request.headers,
      }),
    );
  },
};

export { RoomDO };
