import {
  calculateRaceResults,
  ROOM_MAX_CLIENTS,
  type MessagePayloadMap,
  type RaceFinishRecord,
  type RoomPlayer,
} from "@get-tilted/shared-protocol";
import type { WebSocket } from "ws";

type RoomCode = string;
type PlayerId = string;
type RaceStatePayload = MessagePayloadMap["race:state"];

type RoomEntry = {
  ws: WebSocket;
  playerId: PlayerId;
  name?: string;
  skinId?: string;
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

  private readonly hostByRoom = new Map<RoomCode, PlayerId>();

  private readonly countdownStartByRoom = new Map<RoomCode, number>();

  private readonly raceActiveByRoom = new Map<RoomCode, boolean>();

  private readonly finishesByRoom = new Map<RoomCode, Map<PlayerId, RaceFinishRecord>>();

  private readonly raceResultByRoom = new Map<RoomCode, RaceResultRecord>();

  private readonly lastRaceStateByRoom = new Map<RoomCode, Map<PlayerId, RaceStatePayload>>();

  private readonly trackSeedByRoom = new Map<RoomCode, string>();

  private nextPlayerSeq = 1;

  join(
    roomCode: string,
    client: WebSocket,
    name?: string,
    skinId?: string,
  ): { size: number; playerId: string } | null {
    this.leave(client);
    const roomClients = this.rooms.get(roomCode) ?? [];
    if (roomClients.length >= ROOM_MAX_CLIENTS) {
      return null;
    }
    const playerId = `P${this.nextPlayerSeq.toString().padStart(4, "0")}`;
    this.nextPlayerSeq += 1;
    roomClients.push({ ws: client, playerId, name, skinId });
    this.rooms.set(roomCode, roomClients);
    this.clientToRoom.set(client, roomCode);
    this.clientToPlayer.set(client, playerId);
    if (!this.hostByRoom.has(roomCode)) {
      this.hostByRoom.set(roomCode, playerId);
    }
    if (!this.readyByRoom.has(roomCode)) {
      this.readyByRoom.set(roomCode, new Set());
    }
    if (roomClients.length < ROOM_MAX_CLIENTS) {
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
      this.hostByRoom.delete(roomCode);
      this.clearCountdownStart(roomCode);
      this.clearRace(roomCode);
      return { size: 0, roomCode, playerId };
    }
    if (playerId && this.hostByRoom.get(roomCode) === playerId) {
      const nextHost = roomClients[0]?.playerId;
      if (nextHost) {
        this.hostByRoom.set(roomCode, nextHost);
      }
    }
    if (roomClients.length < ROOM_MAX_CLIENTS) {
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
      skinId: entry.skinId,
    }));
  }

  getHostPlayerId(roomCode: string): string | undefined {
    return this.hostByRoom.get(roomCode);
  }

  canStartRace(roomCode: string, playerId: string): boolean {
    const roomClients = this.rooms.get(roomCode) ?? [];
    if (roomClients.length < 2) {
      return false;
    }
    if (this.hostByRoom.get(roomCode) !== playerId) {
      return false;
    }
    const readySet = this.readyByRoom.get(roomCode) ?? new Set<PlayerId>();
    if (readySet.size !== roomClients.length) {
      return false;
    }
    return roomClients.every((entry) => readySet.has(entry.playerId));
  }

  cacheRaceState(roomCode: string, playerId: string, payload: RaceStatePayload): void {
    let stateMap = this.lastRaceStateByRoom.get(roomCode);
    if (!stateMap) {
      stateMap = new Map();
      this.lastRaceStateByRoom.set(roomCode, stateMap);
    }
    stateMap.set(playerId, payload);
  }

  getLastRaceStates(roomCode: string): Array<{
    playerId: string;
    t: number;
    pos: [number, number, number];
    quat: [number, number, number, number];
    vel: [number, number, number];
    trackPos?: [number, number, number];
    trackQuat?: [number, number, number, number];
  }> {
    const stateMap = this.lastRaceStateByRoom.get(roomCode);
    if (!stateMap || stateMap.size === 0) return [];
    const result: Array<{
      playerId: string;
      t: number;
      pos: [number, number, number];
      quat: [number, number, number, number];
      vel: [number, number, number];
      trackPos?: [number, number, number];
      trackQuat?: [number, number, number, number];
    }> = [];
    for (const [pid, state] of stateMap) {
      result.push({
        playerId: pid,
        t: state.t,
        pos: state.pos,
        quat: state.quat,
        vel: state.vel,
        trackPos: state.trackPos,
        trackQuat: state.trackQuat,
      });
    }
    return result;
  }

  setPlayerProfile(client: WebSocket, name?: string, skinId?: string): boolean {
    const roomCode = this.clientToRoom.get(client);
    if (!roomCode) {
      return false;
    }
    const roomClients = this.rooms.get(roomCode);
    if (!roomClients) {
      return false;
    }
    const entry = roomClients.find((roomEntry) => roomEntry.ws === client);
    if (!entry) {
      return false;
    }
    entry.name = name;
    entry.skinId = skinId;
    return true;
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

  beginRace(roomCode: string, trackSeed: string): void {
    this.raceActiveByRoom.set(roomCode, true);
    this.finishesByRoom.set(roomCode, new Map<PlayerId, RaceFinishRecord>());
    this.raceResultByRoom.delete(roomCode);
    this.trackSeedByRoom.set(roomCode, trackSeed);
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
    const finishes = this.finishesByRoom.get(roomCode) ?? new Map<PlayerId, RaceFinishRecord>();
    const calc = calculateRaceResults(players, finishes, isFinal);
    if (!calc) {
      return null;
    }

    const payload: RaceResultRecord = {
      roomCode,
      isFinal,
      winnerPlayerId: calc.winnerPlayerId,
      tie: calc.tie,
      results: calc.results,
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
    this.trackSeedByRoom.delete(roomCode);
  }
}
