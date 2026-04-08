/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type GetTiltedDiagnostics = {
  appVersion: string;
  buildId: string;
  gameMode: string;
  menuScreen: string;
  optionsSubmenu: string;
  roomCode: string;
  localPlayerId: string;
  hostPlayerId: string;
  playerCount: number;
  playerNames: string[];
  readyPlayerIds: string[];
  localReady: boolean;
  racePhase: string;
  controlsLocked: boolean;
  countdownToken: string | null;
  countdownStartAtMs: number | null;
  netStatus: string;
  netError: string | null;
  gyroEnabled: boolean;
  tiltEnabled: boolean;
  tiltSupported: boolean;
  tiltPermission: string;
  debugMenuEnabled: boolean;
  trackLabSeed: string;
  multiplayerTrackSeed: string;
  soloCourseName: string;
  soloCourseTagline: string;
  trialState: string;
  trialCurrentMs: number | null;
  trialLastMs: number | null;
  trialBestMs: number | null;
  marbleSpeed: number;
  marblePos: [number, number, number];
  ghostPlayers: number;
};

interface Window {
  __GET_TILTED_DIAGNOSTICS__?: GetTiltedDiagnostics;
}
