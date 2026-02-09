import type { WebSocket } from "ws";

type RoomCode = string;
type PlayerId = string;

export type RoomPlayer = {
  playerId: string;
  name?: string;
};

type RoomEntry = {
  ws: WebSocket;
  playerId: PlayerId;
  name?: string;
};

export class RoomStore {
  private readonly rooms = new Map<RoomCode, RoomEntry[]>();

  private readonly clientToRoom = new Map<WebSocket, RoomCode>();

  private readonly clientToPlayer = new Map<WebSocket, PlayerId>();

  private nextPlayerSeq = 1;

  join(
    roomCode: string,
    client: WebSocket,
    name?: string,
  ): { size: number; playerId: string } | null {
    this.leave(client);
    const roomClients = this.rooms.get(roomCode) ?? [];
    if (roomClients.length >= 2) {
      return null;
    }
    const playerId = `P${this.nextPlayerSeq.toString().padStart(4, "0")}`;
    this.nextPlayerSeq += 1;
    roomClients.push({ ws: client, playerId, name });
    this.rooms.set(roomCode, roomClients);
    this.clientToRoom.set(client, roomCode);
    this.clientToPlayer.set(client, playerId);
    return { size: roomClients.length, playerId };
  }

  leave(client: WebSocket): { size: number | null; roomCode?: string; playerId?: string } {
    const roomCode = this.clientToRoom.get(client);
    if (!roomCode) {
      return { size: null };
    }

    const roomClients = this.rooms.get(roomCode);
    if (!roomClients) {
      this.clientToRoom.delete(client);
      this.clientToPlayer.delete(client);
      return { size: null, roomCode };
    }

    const idx = roomClients.findIndex((entry) => entry.ws === client);
    const playerId =
      idx >= 0 ? roomClients[idx]?.playerId : this.clientToPlayer.get(client);
    if (idx >= 0) {
      roomClients.splice(idx, 1);
    }
    this.clientToRoom.delete(client);
    this.clientToPlayer.delete(client);

    if (roomClients.length === 0) {
      this.rooms.delete(roomCode);
      return { size: 0, roomCode, playerId };
    }
    return { size: roomClients.length, roomCode, playerId };
  }

  exists(roomCode: string): boolean {
    return this.rooms.has(roomCode);
  }

  getRoomCode(client: WebSocket): string | undefined {
    return this.clientToRoom.get(client);
  }

  getClients(roomCode: string): Set<WebSocket> {
    return new Set((this.rooms.get(roomCode) ?? []).map((entry) => entry.ws));
  }

  getClientCount(roomCode: string): number {
    return this.rooms.get(roomCode)?.length ?? 0;
  }

  getPlayerId(client: WebSocket): string | undefined {
    return this.clientToPlayer.get(client);
  }

  getPlayers(roomCode: string): RoomPlayer[] {
    return (this.rooms.get(roomCode) ?? []).map((entry) => ({
      playerId: entry.playerId,
      name: entry.name,
    }));
  }
}
