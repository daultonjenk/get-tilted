export type MobilePerfTier = "high" | "medium" | "low";

export type MobilePerfSample = {
  nowMs: number;
  frameMs: number;
  physicsMs: number;
  renderMs: number;
  miscMs: number;
};

export type MobilePerfStats = {
  tier: MobilePerfTier;
  renderScale: number;
  frameMsEma: number;
  physicsMsEma: number;
  renderMsEma: number;
  miscMsEma: number;
};

export type MobilePerfDecision = MobilePerfStats & {
  changed: boolean;
};

type MobileGovernorConfig = {
  targetFps: number;
  minScale: number;
  maxScale: number;
  downStep: number;
  severeDownStep: number;
  upStep: number;
  downCooldownMs: number;
  severeDownCooldownMs: number;
  upCooldownMs: number;
  downSustainMs: number;
  upSustainMs: number;
  downThresholdFps: number;
  severeThresholdFps: number;
  recoverThresholdFps: number;
  emaAlpha: number;
};

const DEFAULT_CONFIG: MobileGovernorConfig = {
  targetFps: 60,
  minScale: 0.72,
  maxScale: 1,
  downStep: 0.04,
  severeDownStep: 0.06,
  upStep: 0.02,
  downCooldownMs: 800,
  severeDownCooldownMs: 450,
  upCooldownMs: 2000,
  downSustainMs: 900,
  upSustainMs: 2800,
  downThresholdFps: 58,
  severeThresholdFps: 52,
  recoverThresholdFps: 61,
  emaAlpha: 0.12,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toTier(renderScale: number, minScale: number, maxScale: number): MobilePerfTier {
  const span = Math.max(maxScale - minScale, 0.0001);
  const ratio = clamp((renderScale - minScale) / span, 0, 1);
  if (ratio > 0.65) {
    return "high";
  }
  if (ratio > 0.3) {
    return "medium";
  }
  return "low";
}

export function createMobileGovernor(
  initialScale: number,
  partialConfig?: Partial<MobileGovernorConfig>,
) {
  const config: MobileGovernorConfig = { ...DEFAULT_CONFIG, ...partialConfig };
  const targetFrameMs = 1000 / config.targetFps;
  const downThresholdFrameMs = 1000 / config.downThresholdFps;
  const severeThresholdFrameMs = 1000 / config.severeThresholdFps;
  const recoverThresholdFrameMs = 1000 / config.recoverThresholdFps;

  let userScaleCap = clamp(initialScale, config.minScale, config.maxScale);
  let renderScale = userScaleCap;
  let tier = toTier(renderScale, config.minScale, config.maxScale);
  let frameMsEma = targetFrameMs;
  let physicsMsEma = 0;
  let renderMsEma = 0;
  let miscMsEma = 0;
  let underTargetMs = 0;
  let stableMs = 0;
  let lastChangeMs = 0;
  let lastSampleMs = 0;

  const setUserScaleCap = (nextScale: number): void => {
    userScaleCap = clamp(nextScale, config.minScale, config.maxScale);
    if (renderScale > userScaleCap) {
      renderScale = userScaleCap;
      tier = toTier(renderScale, config.minScale, config.maxScale);
    }
  };

  const push = (sample: MobilePerfSample): MobilePerfDecision => {
    const nowMs = Number.isFinite(sample.nowMs) ? sample.nowMs : 0;
    const dtMs =
      lastSampleMs > 0
        ? clamp(nowMs - lastSampleMs, 4, 250)
        : targetFrameMs;
    lastSampleMs = nowMs;

    frameMsEma += (sample.frameMs - frameMsEma) * config.emaAlpha;
    physicsMsEma += (sample.physicsMs - physicsMsEma) * config.emaAlpha;
    renderMsEma += (sample.renderMs - renderMsEma) * config.emaAlpha;
    miscMsEma += (sample.miscMs - miscMsEma) * config.emaAlpha;

    if (frameMsEma >= downThresholdFrameMs) {
      underTargetMs += dtMs;
      stableMs = 0;
    } else if (frameMsEma <= recoverThresholdFrameMs) {
      stableMs += dtMs;
      underTargetMs = Math.max(0, underTargetMs - dtMs * 0.5);
    } else {
      underTargetMs = Math.max(0, underTargetMs - dtMs * 0.4);
      stableMs = Math.max(0, stableMs - dtMs);
    }

    const elapsedSinceChange = nowMs - lastChangeMs;
    const maxScale = Math.min(config.maxScale, userScaleCap);
    let nextScale = renderScale;

    if (
      frameMsEma >= severeThresholdFrameMs &&
      elapsedSinceChange >= config.severeDownCooldownMs
    ) {
      nextScale = clamp(
        renderScale - config.severeDownStep,
        config.minScale,
        maxScale,
      );
    } else if (
      underTargetMs >= config.downSustainMs &&
      elapsedSinceChange >= config.downCooldownMs
    ) {
      nextScale = clamp(
        renderScale - config.downStep,
        config.minScale,
        maxScale,
      );
      underTargetMs = 0;
    } else if (
      stableMs >= config.upSustainMs &&
      elapsedSinceChange >= config.upCooldownMs
    ) {
      nextScale = clamp(
        renderScale + config.upStep,
        config.minScale,
        maxScale,
      );
      stableMs = 0;
    }

    const changed = Math.abs(nextScale - renderScale) > 0.0001;
    if (changed) {
      renderScale = nextScale;
      lastChangeMs = nowMs;
    }
    tier = toTier(renderScale, config.minScale, config.maxScale);

    return {
      changed,
      tier,
      renderScale,
      frameMsEma,
      physicsMsEma,
      renderMsEma,
      miscMsEma,
    };
  };

  const getStats = (): MobilePerfStats => ({
    tier,
    renderScale,
    frameMsEma,
    physicsMsEma,
    renderMsEma,
    miscMsEma,
  });

  return {
    setUserScaleCap,
    push,
    getStats,
  };
}
