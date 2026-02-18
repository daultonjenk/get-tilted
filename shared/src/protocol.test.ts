import { describe, expect, it } from "vitest";
import {
  calculateRaceResults,
  generateRoomCode,
  ROOM_MAX_CLIENTS,
  COUNTDOWN_STEP_MS,
  COUNTDOWN_TOTAL_STEPS,
  encodeMessage,
  safeParseMessage,
  type RaceFinishRecord,
  type RoomPlayer,
} from "./protocol";

// ---------------------------------------------------------------------------
// generateRoomCode
// ---------------------------------------------------------------------------

describe("generateRoomCode", () => {
  it("returns a 6-character string", () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(6);
  });

  it("contains only valid characters (A-Z minus ambiguous, 2-9 minus ambiguous)", () => {
    const validChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      for (const ch of code) {
        expect(validChars).toContain(ch);
      }
    }
  });

  it("generates unique codes (probabilistic)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateRoomCode());
    }
    // With 30^6 ≈ 729M possibilities, 100 codes should all be unique
    expect(codes.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// calculateRaceResults
// ---------------------------------------------------------------------------

describe("calculateRaceResults", () => {
  const players: RoomPlayer[] = [
    { playerId: "P0001", name: "Alice" },
    { playerId: "P0002", name: "Bob" },
  ];

  it("returns null for empty player list", () => {
    expect(calculateRaceResults([], new Map(), true)).toBeNull();
  });

  it("returns null for non-final with no finishes", () => {
    expect(calculateRaceResults(players, new Map(), false)).toBeNull();
  });

  it("determines winner when one player finishes first (final)", () => {
    const finishes = new Map<string, RaceFinishRecord>([
      ["P0001", { elapsedMs: 5000, finishedAtMs: 100000 }],
      ["P0002", { elapsedMs: 7000, finishedAtMs: 102000 }],
    ]);
    const result = calculateRaceResults(players, finishes, true);
    expect(result).not.toBeNull();
    expect(result!.winnerPlayerId).toBe("P0001");
    expect(result!.tie).toBe(false);
    expect(result!.results).toHaveLength(2);
  });

  it("detects a tie when both finish with same time", () => {
    const finishes = new Map<string, RaceFinishRecord>([
      ["P0001", { elapsedMs: 5000, finishedAtMs: 100000 }],
      ["P0002", { elapsedMs: 5000, finishedAtMs: 100000 }],
    ]);
    const result = calculateRaceResults(players, finishes, true);
    expect(result).not.toBeNull();
    expect(result!.tie).toBe(true);
    expect(result!.winnerPlayerId).toBeUndefined();
  });

  it("marks DNF for players who did not finish (final)", () => {
    const finishes = new Map<string, RaceFinishRecord>([
      ["P0001", { elapsedMs: 5000, finishedAtMs: 100000 }],
    ]);
    const result = calculateRaceResults(players, finishes, true);
    expect(result).not.toBeNull();
    expect(result!.winnerPlayerId).toBe("P0001");
    const bob = result!.results.find((r) => r.playerId === "P0002");
    expect(bob?.status).toBe("dnf");
  });

  it("handles DNF with Infinity elapsedMs (final)", () => {
    const finishes = new Map<string, RaceFinishRecord>([
      ["P0001", { elapsedMs: 5000, finishedAtMs: 100000 }],
      ["P0002", { elapsedMs: Number.POSITIVE_INFINITY, finishedAtMs: 100000 }],
    ]);
    const result = calculateRaceResults(players, finishes, true);
    expect(result).not.toBeNull();
    expect(result!.winnerPlayerId).toBe("P0001");
    // Bob has Infinity elapsedMs so is treated as DNF in the final results
    const bob = result!.results.find((r) => r.playerId === "P0002");
    expect(bob?.status).toBe("dnf");
  });

  it("returns partial results (non-final) sorted by elapsed time", () => {
    const finishes = new Map<string, RaceFinishRecord>([
      ["P0001", { elapsedMs: 8000, finishedAtMs: 100000 }],
    ]);
    const result = calculateRaceResults(players, finishes, false);
    expect(result).not.toBeNull();
    // Non-final: only finished players are included
    expect(result!.results).toHaveLength(1);
    expect(result!.results[0]!.playerId).toBe("P0001");
    expect(result!.winnerPlayerId).toBe("P0001");
  });

  it("works with 3+ players", () => {
    const threePlayers: RoomPlayer[] = [
      { playerId: "P0001" },
      { playerId: "P0002" },
      { playerId: "P0003" },
    ];
    const finishes = new Map<string, RaceFinishRecord>([
      ["P0001", { elapsedMs: 9000, finishedAtMs: 100000 }],
      ["P0002", { elapsedMs: 6000, finishedAtMs: 100000 }],
      ["P0003", { elapsedMs: 7500, finishedAtMs: 100000 }],
    ]);
    const result = calculateRaceResults(threePlayers, finishes, true);
    expect(result).not.toBeNull();
    expect(result!.winnerPlayerId).toBe("P0002");
    expect(result!.tie).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

describe("shared constants", () => {
  it("ROOM_MAX_CLIENTS is a positive integer", () => {
    expect(ROOM_MAX_CLIENTS).toBe(4);
    expect(Number.isInteger(ROOM_MAX_CLIENTS)).toBe(true);
  });

  it("countdown timing is consistent", () => {
    expect(COUNTDOWN_STEP_MS).toBeGreaterThan(0);
    expect(COUNTDOWN_TOTAL_STEPS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Message encoding / parsing round-trip
// ---------------------------------------------------------------------------

describe("encodeMessage / safeParseMessage", () => {
  it("round-trips a ping message", () => {
    const encoded = encodeMessage("ping", { t: 12345 });
    const parsed = safeParseMessage(encoded);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.msg.type).toBe("ping");
      expect(parsed.msg.payload).toEqual({ t: 12345 });
    }
  });

  it("round-trips a race:state message", () => {
    const payload = {
      roomCode: "ABC123",
      playerId: "P0001",
      seq: 1,
      t: 1000,
      pos: [1, 2, 3] as [number, number, number],
      quat: [0, 0, 0, 1] as [number, number, number, number],
      vel: [0.5, 0, -1] as [number, number, number],
    };
    const encoded = encodeMessage("race:state", payload);
    const parsed = safeParseMessage(encoded);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.msg.type).toBe("race:state");
      expect(parsed.msg.payload).toEqual(payload);
    }
  });

  it("round-trips a race:hello message with optional skin", () => {
    const payload = {
      roomCode: "ABC123",
      playerId: "P0001",
      name: "Player One",
      skinId: "checkered-red",
    };
    const encoded = encodeMessage("race:hello", payload);
    const parsed = safeParseMessage(encoded);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.msg.type).toBe("race:hello");
      expect(parsed.msg.payload).toEqual(payload);
    }
  });

  it("round-trips a race:hello:ack message with host metadata", () => {
    const payload = {
      roomCode: "ABC123",
      playerId: "P0002",
      hostPlayerId: "P0001",
      players: [
        { playerId: "P0001", name: "Host" },
        { playerId: "P0002", name: "Guest" },
      ],
    };
    const encoded = encodeMessage("race:hello:ack", payload);
    const parsed = safeParseMessage(encoded);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.msg.type).toBe("race:hello:ack");
      expect(parsed.msg.payload).toEqual(payload);
    }
  });

  it("round-trips a race:start message", () => {
    const payload = {
      roomCode: "ABC123",
      playerId: "P0001",
    };
    const encoded = encodeMessage("race:start", payload);
    const parsed = safeParseMessage(encoded);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.msg.type).toBe("race:start");
      expect(parsed.msg.payload).toEqual(payload);
    }
  });

  it("rejects invalid JSON", () => {
    const parsed = safeParseMessage("not json{");
    expect(parsed.ok).toBe(false);
  });

  it("rejects unknown message type", () => {
    const parsed = safeParseMessage(JSON.stringify({ type: "banana", payload: {} }));
    expect(parsed.ok).toBe(false);
  });

  it("rejects malformed payload", () => {
    const parsed = safeParseMessage(JSON.stringify({ type: "ping", payload: { wrong: true } }));
    expect(parsed.ok).toBe(false);
  });
});
