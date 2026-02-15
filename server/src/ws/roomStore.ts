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

type RaceFinishRecord = {
  elapsedMs: number;
  finishedAtMs: number;
};

type RaceResultRecord = {
  roomCode: string;
  isFinal: boolean;
  winnerPlayerId?: string;
  tie: boolean;
  results: Array<{
    playerId: string;
    status: "finished" | "dnf";
    elapsedMs?: number;
  }>;
};

export class RoomStore {
  private readonly rooms = new Map<RoomCode, RoomEntry[]>();

  private readonly clientToRoom = new Map<WebSocket, RoomCode>();

  private readonly clientToPlayer = new Map<WebSocket, PlayerId>();

  private readonly readyByRoom = new Map<RoomCode, Set<PlayerId>>();

  private readonly countdownStartByRoom = new Map<RoomCode, number>();

  private readonly raceActiveByRoom = new Map<RoomCode, boolean>();

  private readonly finishesByRoom = new Map<RoomCode, Map<PlayerId, RaceFinishRecord>>();

  private readonly raceResultByRoom = new Map<RoomCode, RaceResultRecord>();

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
      this.clearRace(roomCode);
      return { size: 0, roomCode, playerId };
    }
    if (roomClients.length < 2) {
      this.clearCountdownStart(roomCode);
      this.clearRace(roomCode);
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

  hasCountdown(roomCode: string): boolean {
    return this.countdownStartByRoom.has(roomCode);
  }

  clearCountdownStart(roomCode: string): void {
    this.countdownStartByRoom.delete(roomCode);
  }

  clearReady(roomCode: string): void {
    this.readyByRoom.set(roomCode, new Set<PlayerId>());
  }

  beginRace(roomCode: string): void {
    this.raceActiveByRoom.set(roomCode, true);
    this.finishesByRoom.set(roomCode, new Map<PlayerId, RaceFinishRecord>());
    this.raceResultByRoom.delete(roomCode);
  }

  isRaceActive(roomCode: string): boolean {
    return this.raceActiveByRoom.get(roomCode) === true;
  }

  recordFinish(
    roomCode: string,
    playerId: string,
    elapsedMs: number,
    finishedAtMs: number,
  ): boolean {
    if (!this.isRaceActive(roomCode)) {
      return false;
    }
    const roomClients = this.rooms.get(roomCode) ?? [];
    if (!roomClients.some((entry) => entry.playerId === playerId)) {
      return false;
    }
    const finishes = this.finishesByRoom.get(roomCode) ?? new Map<PlayerId, RaceFinishRecord>();
    if (finishes.has(playerId)) {
      return false;
    }
    finishes.set(playerId, { elapsedMs, finishedAtMs });
    this.finishesByRoom.set(roomCode, finishes);
    return true;
  }

  hasFinish(roomCode: string, playerId: string): boolean {
    const finishes = this.finishesByRoom.get(roomCode);
    return finishes?.has(playerId) ?? false;
  }

  getFinishCount(roomCode: string): number {
    return this.finishesByRoom.get(roomCode)?.size ?? 0;
  }

  hasRaceResult(roomCode: string): boolean {
    return this.raceResultByRoom.has(roomCode);
  }

  getRaceResultSnapshotWithCurrentPlayers(roomCode: string, isFinal: boolean): RaceResultRecord | null {
    const players = this.getPlayers(roomCode);
    if (players.length === 0) {
      return null;
    }
    const finishes = this.finishesByRoom.get(roomCode) ?? new Map<PlayerId, RaceFinishRecord>();

    const results = isFinal
      ? players.map((player) => {
          const finish = finishes.get(player.playerId);
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
            const finish = finishes.get(player.playerId);
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
      return null;
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

    const payload: RaceResultRecord = {
      roomCode,
      isFinal,
      winnerPlayerId,
      tie,
      results,
    };
    if (isFinal) {
      this.raceResultByRoom.set(roomCode, payload);
      this.raceActiveByRoom.set(roomCode, false);
    }
    return payload;
  }

  clearRace(roomCode: string): void {
    this.raceActiveByRoom.delete(roomCode);
    this.finishesByRoom.delete(roomCode);
    this.raceResultByRoom.delete(roomCode);
  }
}
