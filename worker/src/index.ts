import type { Env } from "./env";
import { RoomDO } from "./roomDO";

function getRoomCode(pathname: string): string | null {
  const match = pathname.match(/^\/ws\/([A-Z0-9]{1,16})$/);
  return match ? match[1] : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const roomCode = getRoomCode(url.pathname);
    if (!roomCode) {
      return new Response("Not Found", { status: 404 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const id = env.ROOM_DO.idFromName(roomCode);
    const stub = env.ROOM_DO.get(id);
    const doUrl = new URL(request.url);
    doUrl.pathname = "/room";
    doUrl.searchParams.set("roomCode", roomCode);

    return stub.fetch(
      new Request(doUrl.toString(), {
        method: request.method,
        headers: request.headers,
      }),
    );
  },
};

export { RoomDO };
