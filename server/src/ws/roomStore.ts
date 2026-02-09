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

  private readonly readyByRoom = new Map<RoomCode, Set<PlayerId>>();

  private readonly countdownStartByRoom = new Map<RoomCode, number>();

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
    if (!this.readyByRoom.has(roomCode)) {
      this.readyByRoom.set(roomCode, new Set());
    }
    if (roomClients.length < 2) {
      this.clearCountdownStart(roomCode);
    }
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
    if (playerId) {
      const ready = this.readyByRoom.get(roomCode);
      ready?.delete(playerId);
    }
    this.clientToRoom.delete(client);
    this.clientToPlayer.delete(client);

    if (roomClients.length === 0) {
      this.rooms.delete(roomCode);
      this.readyByRoom.delete(roomCode);
      this.clearCountdownStart(roomCode);
      return { size: 0, roomCode, playerId };
    }
    if (roomClients.length < 2) {
      this.clearCountdownStart(roomCode);
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

  setReady(roomCode: string, playerId: string, ready: boolean): boolean {
    const roomClients = this.rooms.get(roomCode) ?? [];
    if (!roomClients.some((entry) => entry.playerId === playerId)) {
      return false;
    }
    const readySet = this.readyByRoom.get(roomCode) ?? new Set<PlayerId>();
    if (ready) {
      readySet.add(playerId);
    } else {
      readySet.delete(playerId);
      this.clearCountdownStart(roomCode);
    }
    this.readyByRoom.set(roomCode, readySet);
    return true;
  }

  getReadyPlayerIds(roomCode: string): string[] {
    return [...(this.readyByRoom.get(roomCode) ?? new Set<PlayerId>())];
  }

  setCountdownStart(roomCode: string, startAtMs: number): void {
    this.countdownStartByRoom.set(roomCode, startAtMs);
  }

  getCountdownStart(roomCode: string): number | undefined {
    return this.countdownStartByRoom.get(roomCode);
  }

  clearCountdownStart(roomCode: string): void {
    this.countdownStartByRoom.delete(roomCode);
  }
}
