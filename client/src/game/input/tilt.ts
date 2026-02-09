export type TiltState = {
  enabled: boolean;
  supported: boolean;
  permission: "unknown" | "granted" | "denied";
};

export type TiltSample = {
  x: number;
  y: number;
  z: number;
};

type TiltFilterOptions = {
  tau?: number;
};

const MAX_TILT_DEG = 15;

let neutralX = 0;
let neutralY = 0;
let neutralZ = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeOrientationSample(beta: number, gamma: number): TiltSample {
  const rawX = clamp(gamma / MAX_TILT_DEG, -1, 1);
  const rawZ = clamp(-beta / MAX_TILT_DEG, -1, 1);

  return {
    x: clamp(rawX - neutralX, -1, 1),
    y: 0,
    z: clamp(rawZ - neutralZ, -1, 1),
  };
}

function normalizeMotionSample(accelX: number, accelY: number): TiltSample {
  const rawX = clamp(accelX / 9.81, -1, 1);
  const rawZ = clamp(accelY / 9.81, -1, 1);

  return {
    x: clamp(rawX - neutralX, -1, 1),
    y: 0,
    z: clamp(rawZ - neutralZ, -1, 1),
  };
}

export function isTiltSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    ("DeviceOrientationEvent" in window || "DeviceMotionEvent" in window)
  );
}

export async function requestTiltPermissionIfNeeded(): Promise<
  "granted" | "denied"
> {
  if (!isTiltSupported()) {
    return "denied";
  }

  const maybeMotion = window.DeviceMotionEvent as
    | (typeof DeviceMotionEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      })
    | undefined;

  if (maybeMotion && typeof maybeMotion.requestPermission === "function") {
    const permission = await maybeMotion.requestPermission();
    return permission === "granted" ? "granted" : "denied";
  }

  const maybeOrientation = window.DeviceOrientationEvent as
    | (typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      })
    | undefined;

  if (
    maybeOrientation &&
    typeof maybeOrientation.requestPermission === "function"
  ) {
    const permission = await maybeOrientation.requestPermission();
    return permission === "granted" ? "granted" : "denied";
  }

  return "granted";
}

export function startTiltListener(onSample: (s: TiltSample) => void): () => void {
  const handleOrientation = (event: DeviceOrientationEvent) => {
    if (event.beta === null || event.gamma === null) {
      return;
    }
    onSample(normalizeOrientationSample(event.beta, event.gamma));
  };

  const handleMotion = (event: DeviceMotionEvent) => {
    const accel = event.accelerationIncludingGravity;
    if (!accel || accel.x === null || accel.y === null) {
      return;
    }
    onSample(normalizeMotionSample(accel.x, accel.y));
  };

  const hasOrientation = "ondeviceorientation" in window;
  if (hasOrientation) {
    window.addEventListener("deviceorientation", handleOrientation, true);
  } else {
    window.addEventListener("devicemotion", handleMotion, true);
  }

  return () => {
    window.removeEventListener("deviceorientation", handleOrientation, true);
    window.removeEventListener("devicemotion", handleMotion, true);
  };
}

export function makeTiltFilter(opts?: TiltFilterOptions): {
  push(raw: TiltSample, dt: number): TiltSample;
  reset(next?: TiltSample): void;
} {
  const tau = Math.max(opts?.tau ?? 0.15, 0.001);
  let current: TiltSample = { x: 0, y: 0, z: 0 };

  return {
    push(raw: TiltSample, dt: number): TiltSample {
      const safeDt = Math.max(0, dt);
      const alpha = 1 - Math.exp(-safeDt / tau);
      current = {
        x: current.x + (raw.x - current.x) * alpha,
        y: current.y + (raw.y - current.y) * alpha,
        z: current.z + (raw.z - current.z) * alpha,
      };
      return current;
    },
    reset(next?: TiltSample) {
      current = next ?? { x: 0, y: 0, z: 0 };
    },
  };
}

export function calibrateCurrent(sample: TiltSample): void {
  neutralX = clamp(neutralX + sample.x, -1, 1);
  neutralY = clamp(neutralY + sample.y, -1, 1);
  neutralZ = clamp(neutralZ + sample.z, -1, 1);
}
