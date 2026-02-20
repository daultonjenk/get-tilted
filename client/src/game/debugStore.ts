import { useSyncExternalStore } from "react";
import type { MobilePerfTier } from "./perf/mobileGovernor";

export type MarbleDebug = {
  cadenceHz: number;
  rafGapP95Ms: number;
  rafGapP99Ms: number;
  rafGapsOver16Ms: number;
  rafGapsOver20Ms: number;
  rafGapsOver25Ms: number;
  simStepsPerFrameEma: number;
  simStepsMaxRecent: number;
  posX: number;
  posY: number;
  posZ: number;
  speed: number;
  angularSpeed: number;
  verticalSpeed: number;
  penetrationDepth: number;
  rawTiltX: number;
  rawTiltZ: number;
  tiltX: number;
  tiltZ: number;
  gravX: number;
  gravY: number;
  gravZ: number;
  renderScale: number;
  perfTier: MobilePerfTier | "desktop";
  cpuFrameMsEma: number;
  physicsMsEma: number;
  renderMsEma: number;
  miscMsEma: number;
};

export type NetSmoothingDebug = {
  ghostPlayers: number;
  avgDelayMs: number;
  avgJitterMs: number;
  avgSnapshotAgeMs: number;
  avgSnapshotAgeJitterMs: number;
  extrapolatingPlayers: number;
  droppedStale: number;
  droppedOutOfOrderSeq: number;
  droppedStaleTimestamp: number;
  droppedTooOld: number;
  timestampCorrected: number;
  queueOrderViolations: number;
  snapshotQueueSummary: string;
  latestSnapshotAgeMs: number | null;
  serverClockOffsetMs: number;
  inputSourcesSummary: string;
  inputIntentX: number;
  inputIntentZ: number;
};

type DebugStoreData = {
  debug: MarbleDebug;
  net: NetSmoothingDebug;
};

type Listener = () => void;

const DEFAULT_DEBUG: MarbleDebug = {
  cadenceHz: 0,
  rafGapP95Ms: 0,
  rafGapP99Ms: 0,
  rafGapsOver16Ms: 0,
  rafGapsOver20Ms: 0,
  rafGapsOver25Ms: 0,
  simStepsPerFrameEma: 0,
  simStepsMaxRecent: 0,
  posX: 0,
  posY: 0,
  posZ: 0,
  speed: 0,
  angularSpeed: 0,
  verticalSpeed: 0,
  penetrationDepth: 0,
  rawTiltX: 0,
  rawTiltZ: 0,
  tiltX: 0,
  tiltZ: 0,
  gravX: 0,
  gravY: -20,
  gravZ: 0,
  renderScale: 1,
  perfTier: "desktop",
  cpuFrameMsEma: 1000 / 60,
  physicsMsEma: 0,
  renderMsEma: 0,
  miscMsEma: 0,
};

const DEFAULT_NET: NetSmoothingDebug = {
  ghostPlayers: 0,
  avgDelayMs: 0,
  avgJitterMs: 0,
  avgSnapshotAgeMs: 0,
  avgSnapshotAgeJitterMs: 0,
  extrapolatingPlayers: 0,
  droppedStale: 0,
  droppedOutOfOrderSeq: 0,
  droppedStaleTimestamp: 0,
  droppedTooOld: 0,
  timestampCorrected: 0,
  queueOrderViolations: 0,
  snapshotQueueSummary: "none",
  latestSnapshotAgeMs: null,
  serverClockOffsetMs: 0,
  inputSourcesSummary: "none",
  inputIntentX: 0,
  inputIntentZ: 0,
};

/**
 * External store for debug/diagnostics data.
 * The game loop writes to this via updateDebug()/updateNet() — no React setState.
 * Debug panel components subscribe via useDebugStore()/useNetStore() —
 * only those leaf components re-render on changes.
 */
class DebugStore {
  private data: DebugStoreData = {
    debug: { ...DEFAULT_DEBUG },
    net: { ...DEFAULT_NET },
  };

  private version = 0;
  private readonly listeners = new Set<Listener>();

  getDebug(): MarbleDebug {
    return this.data.debug;
  }

  getNet(): NetSmoothingDebug {
    return this.data.net;
  }

  getVersion(): number {
    return this.version;
  }

  updateDebug(partial: Partial<MarbleDebug>): void {
    Object.assign(this.data.debug, partial);
    this.version++;
    this.notify();
  }

  updateNet(values: NetSmoothingDebug): void {
    this.data.net = values;
    this.version++;
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const debugStore = new DebugStore();

/** React hook: subscribe to MarbleDebug updates (only re-renders subscribed components). */
export function useDebugStore(): MarbleDebug {
  return useSyncExternalStore(
    (cb) => debugStore.subscribe(cb),
    () => debugStore.getDebug(),
  );
}

/** React hook: subscribe to NetSmoothingDebug updates (only re-renders subscribed components). */
export function useNetStore(): NetSmoothingDebug {
  return useSyncExternalStore(
    (cb) => debugStore.subscribe(cb),
    () => debugStore.getNet(),
  );
}
