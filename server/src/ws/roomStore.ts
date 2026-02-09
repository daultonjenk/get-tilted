import type { WebSocket } from "ws";

type RoomCode = string;

export class RoomStore {
  private readonly rooms = new Map<RoomCode, Set<WebSocket>>();

  private readonly clientToRoom = new Map<WebSocket, RoomCode>();

  join(roomCode: string, client: WebSocket): number {
    this.leave(client);
    const roomClients = this.rooms.get(roomCode) ?? new Set<WebSocket>();
    roomClients.add(client);
    this.rooms.set(roomCode, roomClients);
    this.clientToRoom.set(client, roomCode);
    return roomClients.size;
  }

  leave(client: WebSocket): number | null {
    const roomCode = this.clientToRoom.get(client);
    if (!roomCode) {
      return null;
    }

    const roomClients = this.rooms.get(roomCode);
    if (!roomClients) {
      this.clientToRoom.delete(client);
      return null;
    }

    roomClients.delete(client);
    this.clientToRoom.delete(client);

    if (roomClients.size === 0) {
      this.rooms.delete(roomCode);
      return 0;
    }
    return roomClients.size;
  }

  exists(roomCode: string): boolean {
    return this.rooms.has(roomCode);
  }

  getRoomCode(client: WebSocket): string | undefined {
    return this.clientToRoom.get(client);
  }

  getClients(roomCode: string): Set<WebSocket> {
    return this.rooms.get(roomCode) ?? new Set<WebSocket>();
  }

  getClientCount(roomCode: string): number {
    return this.rooms.get(roomCode)?.size ?? 0;
  }
}
