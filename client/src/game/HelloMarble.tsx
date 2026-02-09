import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { createTrack } from "./track/createTrack";
import {
  calibrateCurrent,
  isTiltSupported,
  makeTiltFilter,
  requestTiltPermissionIfNeeded,
  startTiltListener,
  type TiltSample,
  type TiltState,
} from "./input/tilt";

type MarbleDebug = {
  fps: number;
  posX: number;
  posY: number;
  posZ: number;
  tiltX: number;
  tiltZ: number;
  gravX: number;
  gravY: number;
  gravZ: number;
};

const TIMESTEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;
const BASE_G = 9.82;
const MAX_TILT_DEG = 15;
const FOLLOW_DIST = 8;
const CAM_HEIGHT = 4.5;
const LOOK_HEIGHT = 0.8;
const VEL_EPS = 0.25;
const MAX_VISUAL_TILT_DEG = 11;
const VISUAL_TILT_SMOOTH = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function HelloMarble() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const resetRef = useRef<() => void>(() => {});
  const enableTiltRef = useRef<() => Promise<void>>(async () => {});
  const calibrateTiltRef = useRef<() => void>(() => {});

  const [respawnCount, setRespawnCount] = useState(0);
  const [tiltStatus, setTiltStatus] = useState<TiltState>({
    enabled: false,
    supported: isTiltSupported(),
    permission: "unknown",
  });
  const [statusMessage, setStatusMessage] = useState("Tilt disabled. Using fallback controls.");
  const [touchTilt, setTouchTilt] = useState({ x: 0, z: 0 });
  const [debug, setDebug] = useState<MarbleDebug>({
    fps: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    tiltX: 0,
    tiltZ: 0,
    gravX: 0,
    gravY: -BASE_G,
    gravZ: 0,
  });

  const tiltStatusRef = useRef(tiltStatus);
  const touchTiltRef = useRef(touchTilt);

  useEffect(() => {
    tiltStatusRef.current = tiltStatus;
  }, [tiltStatus]);

  useEffect(() => {
    touchTiltRef.current = touchTilt;
  }, [touchTilt]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1320);

    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 100);
    camera.position.set(0, 6, 10);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(6, 8, 5);
    scene.add(directionalLight);

    const track = createTrack();
    scene.add(track.group);

    const world = new CANNON.World();
    world.gravity.set(0, -BASE_G, 0);
    for (const body of track.bodies) {
      world.addBody(body);
    }

    const marbleRadius = 0.5;
    const marbleBody = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(marbleRadius),
      position: track.spawn.clone(),
      linearDamping: 0.2,
      angularDamping: 0.2,
    });
    world.addBody(marbleBody);

    const marbleMesh = new THREE.Mesh(
      new THREE.SphereGeometry(marbleRadius, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0x4fc3f7 }),
    );
    scene.add(marbleMesh);

    const pressedKeys = new Set<string>();
    const cameraTarget = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();
    const velXZ = new THREE.Vector2();
    const lastForwardXZ = new THREE.Vector2(0, 1);
    const visualTiltTargetEuler = new THREE.Euler(0, 0, 0, "XYZ");
    const visualTiltTargetQuat = new THREE.Quaternion();

    const motionTiltRef: { current: TiltSample } = {
      current: { x: 0, y: 0, z: 0 },
    };
    let stopTiltListener: (() => void) | null = null;
    const filter = makeTiltFilter({ tau: 0.15 });
    const maxTiltRad = (MAX_TILT_DEG * Math.PI) / 180;
    const maxVisualTiltRad = (MAX_VISUAL_TILT_DEG * Math.PI) / 180;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "w" ||
        event.key === "a" ||
        event.key === "s" ||
        event.key === "d" ||
        event.key === "W" ||
        event.key === "A" ||
        event.key === "S" ||
        event.key === "D"
      ) {
        event.preventDefault();
        pressedKeys.add(event.key);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.key);
    };

    window.addEventListener("keydown", handleKeyDown, { passive: false });
    window.addEventListener("keyup", handleKeyUp);

    const respawnMarble = (incrementCounter: boolean) => {
      marbleBody.position.copy(track.spawn);
      marbleBody.quaternion.set(0, 0, 0, 1);
      marbleBody.velocity.set(0, 0, 0);
      marbleBody.angularVelocity.set(0, 0, 0);
      if (incrementCounter) {
        setRespawnCount((count) => count + 1);
      }
    };
    resetRef.current = () => respawnMarble(false);

    const getKeyboardIntent = (): TiltSample => {
      let x = 0;
      let z = 0;
      if (
        pressedKeys.has("ArrowUp") ||
        pressedKeys.has("w") ||
        pressedKeys.has("W")
      ) {
        z -= 1;
      }
      if (
        pressedKeys.has("ArrowDown") ||
        pressedKeys.has("s") ||
        pressedKeys.has("S")
      ) {
        z += 1;
      }
      if (
        pressedKeys.has("ArrowLeft") ||
        pressedKeys.has("a") ||
        pressedKeys.has("A")
      ) {
        x -= 1;
      }
      if (
        pressedKeys.has("ArrowRight") ||
        pressedKeys.has("d") ||
        pressedKeys.has("D")
      ) {
        x += 1;
      }
      return { x, y: 0, z };
    };

    enableTiltRef.current = async () => {
      if (!tiltStatusRef.current.supported) {
        setTiltStatus((prev) => ({
          ...prev,
          enabled: false,
          permission: "denied",
        }));
        setStatusMessage("Motion sensors are unavailable. Using fallback controls.");
        return;
      }

      const permission = await requestTiltPermissionIfNeeded();

      if (permission === "denied") {
        setTiltStatus((prev) => ({
          ...prev,
          enabled: false,
          permission: "denied",
        }));
        setStatusMessage("Tilt permission denied. Using fallback controls.");
        return;
      }

      if (!stopTiltListener) {
        stopTiltListener = startTiltListener((sample) => {
          motionTiltRef.current = sample;
        });
      }

      setTiltStatus((prev) => ({
        ...prev,
        enabled: true,
        permission: "granted",
      }));
      setStatusMessage("Tilt controls enabled.");
    };

    calibrateTiltRef.current = () => {
      calibrateCurrent(motionTiltRef.current);
      filter.reset({ x: 0, y: 0, z: 0 });
      setStatusMessage("Tilt calibrated.");
    };

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();
    window.addEventListener("resize", resize);

    let animationFrame = 0;
    let lastTime = performance.now() / 1000;
    let accumulator = 0;
    let debugTimer = 0;

    const tick = (nowMs: number) => {
      const now = nowMs / 1000;
      const delta = Math.min(now - lastTime, MAX_FRAME_DELTA);
      lastTime = now;
      accumulator += delta;
      debugTimer += delta;

      let targetIntent: TiltSample;
      const status = tiltStatusRef.current;
      const touchIntent = touchTiltRef.current;

      if (status.enabled && status.permission === "granted" && status.supported) {
        targetIntent = motionTiltRef.current;
      } else if (!status.supported || status.permission === "denied") {
        targetIntent = { x: touchIntent.x, y: 0, z: touchIntent.z };
      } else {
        targetIntent = getKeyboardIntent();
      }

      const filteredIntent = filter.push(targetIntent, delta);

      const gx = BASE_G * filteredIntent.x * Math.sin(maxTiltRad);
      const gz = BASE_G * filteredIntent.z * Math.sin(maxTiltRad);
      const gy = -Math.sqrt(Math.max(BASE_G * BASE_G - gx * gx - gz * gz, 0.1));
      world.gravity.set(gx, gy, gz);

      visualTiltTargetEuler.set(
        filteredIntent.z * maxVisualTiltRad,
        0,
        -filteredIntent.x * maxVisualTiltRad,
      );
      visualTiltTargetQuat.setFromEuler(visualTiltTargetEuler);
      const visualTiltAlpha = 1 - Math.exp(-VISUAL_TILT_SMOOTH * delta);
      track.group.quaternion.slerp(visualTiltTargetQuat, visualTiltAlpha);

      while (accumulator >= TIMESTEP) {
        world.step(TIMESTEP);
        accumulator -= TIMESTEP;
      }

      if (marbleBody.position.y < track.respawnY) {
        respawnMarble(true);
      }

      marbleMesh.position.set(
        marbleBody.position.x,
        marbleBody.position.y,
        marbleBody.position.z,
      );
      marbleMesh.quaternion.set(
        marbleBody.quaternion.x,
        marbleBody.quaternion.y,
        marbleBody.quaternion.z,
        marbleBody.quaternion.w,
      );

      velXZ.set(marbleBody.velocity.x, marbleBody.velocity.z);
      if (velXZ.length() > VEL_EPS) {
        velXZ.normalize();
        lastForwardXZ.copy(velXZ);
      }

      cameraTarget.set(
        marbleBody.position.x - lastForwardXZ.x * FOLLOW_DIST,
        marbleBody.position.y + CAM_HEIGHT,
        marbleBody.position.z - lastForwardXZ.y * FOLLOW_DIST,
      );
      const cameraAlpha = 1 - Math.exp(-8 * delta);
      camera.position.lerp(cameraTarget, cameraAlpha);
      lookTarget.set(
        marbleBody.position.x,
        marbleBody.position.y + LOOK_HEIGHT,
        marbleBody.position.z,
      );
      camera.lookAt(lookTarget);

      renderer.render(scene, camera);

      if (debugTimer >= 0.1) {
        setDebug((prev) => ({
          ...prev,
          fps: Math.round(1 / Math.max(delta, 0.0001)),
          posX: marbleBody.position.x,
          posY: marbleBody.position.y,
          posZ: marbleBody.position.z,
          tiltX: filteredIntent.x,
          tiltZ: filteredIntent.z,
          gravX: gx,
          gravY: gy,
          gravZ: gz,
        }));
        debugTimer = 0;
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("resize", resize);
      stopTiltListener?.();
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      scene.remove(track.group);
      for (const child of track.group.children) {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            for (const material of child.material) {
              material.dispose();
            }
          } else {
            child.material.dispose();
          }
        }
      }
      for (const body of track.bodies) {
        world.removeBody(body);
      }
      world.removeBody(marbleBody);
      marbleMesh.geometry.dispose();
      (marbleMesh.material as THREE.Material).dispose();
    };
  }, []);

  const showTouchFallback =
    !tiltStatus.supported || tiltStatus.permission === "denied";

  return (
    <div className="appShell">
      <div className="viewport" ref={mountRef} />
      <div className="hud">
        <p>FPS: {debug.fps}</p>
        <p>
          Marble: {debug.posX.toFixed(2)}, {debug.posY.toFixed(2)}, {" "}
          {debug.posZ.toFixed(2)}
        </p>
        <p>Respawns: {respawnCount}</p>
        <p>
          Tilt: {debug.tiltX.toFixed(2)}, {debug.tiltZ.toFixed(2)}
        </p>
        <div className="tiltIndicatorWrap">
          <p>Tilt Indicator</p>
          <div className="tiltIndicator">
            <span className="tiltCrosshair tiltCrosshairX" />
            <span className="tiltCrosshair tiltCrosshairY" />
            <span
              className="tiltDot"
              style={{
                left: `${50 + clamp(debug.tiltX, -1, 1) * 40}%`,
                top: `${50 + clamp(debug.tiltZ, -1, 1) * 40}%`,
              }}
            />
          </div>
        </div>
        <p>
          Gravity: {debug.gravX.toFixed(2)}, {debug.gravY.toFixed(2)}, {" "}
          {debug.gravZ.toFixed(2)}
        </p>
        <p className="tiltStatus">
          Tilt state: {tiltStatus.enabled ? "enabled" : "disabled"} | permission:{" "}
          {tiltStatus.permission}
        </p>
        <p className="tiltMessage">{statusMessage}</p>
        <div className="hudRow">
          <button type="button" onClick={() => void enableTiltRef.current()}>
            Enable Tilt Controls
          </button>
          <button type="button" onClick={() => calibrateTiltRef.current()}>
            Calibrate
          </button>
        </div>
        {showTouchFallback ? (
          <div className="tiltFallback">
            <p>Touch fallback</p>
            <label htmlFor="tiltX">Horizontal</label>
            <input
              id="tiltX"
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={touchTilt.x}
              onChange={(event) => {
                const x = Number(event.target.value);
                setTouchTilt((prev) => {
                  const next = { ...prev, x };
                  touchTiltRef.current = next;
                  return next;
                });
              }}
              onPointerUp={() => {
                setTouchTilt((prev) => {
                  const next = { ...prev, x: 0 };
                  touchTiltRef.current = next;
                  return next;
                });
              }}
            />
            <label htmlFor="tiltZ">Vertical</label>
            <input
              id="tiltZ"
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={touchTilt.z}
              onChange={(event) => {
                const z = Number(event.target.value);
                setTouchTilt((prev) => {
                  const next = { ...prev, z };
                  touchTiltRef.current = next;
                  return next;
                });
              }}
              onPointerUp={() => {
                setTouchTilt((prev) => {
                  const next = { ...prev, z: 0 };
                  touchTiltRef.current = next;
                  return next;
                });
              }}
            />
          </div>
        ) : null}
        <button type="button" onClick={() => resetRef.current()}>
          Reset Marble
        </button>
      </div>
    </div>
  );
}
