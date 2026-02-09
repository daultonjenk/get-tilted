import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { createTrack } from "./track/createTrack";

type MarbleDebug = {
  fps: number;
  posX: number;
  posY: number;
  posZ: number;
};

const INPUT_FORCE = 12;
const TIMESTEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;

export function HelloMarble() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const resetRef = useRef<() => void>(() => {});
  const [respawnCount, setRespawnCount] = useState(0);
  const [debug, setDebug] = useState<MarbleDebug>({
    fps: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
  });

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
    world.gravity.set(0, -9.82, 0);
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
    const force = new CANNON.Vec3();
    const cameraOffset = new THREE.Vector3(0, 4.5, 8);
    const lookOffset = new THREE.Vector3(0, 0.6, 0);
    const cameraTarget = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight"
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
      force.set(0, 0, 0);
      if (incrementCounter) {
        setRespawnCount((count) => count + 1);
      }
    };
    resetRef.current = () => respawnMarble(false);

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

      force.set(0, 0, 0);
      if (pressedKeys.has("ArrowUp")) force.z -= INPUT_FORCE;
      if (pressedKeys.has("ArrowDown")) force.z += INPUT_FORCE;
      if (pressedKeys.has("ArrowLeft")) force.x -= INPUT_FORCE;
      if (pressedKeys.has("ArrowRight")) force.x += INPUT_FORCE;
      if (force.lengthSquared() > 0) {
        marbleBody.applyForce(force, marbleBody.position);
      }

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

      cameraTarget.set(
        marbleBody.position.x + cameraOffset.x,
        marbleBody.position.y + cameraOffset.y,
        marbleBody.position.z + cameraOffset.z,
      );
      const cameraAlpha = 1 - Math.exp(-8 * delta);
      camera.position.lerp(cameraTarget, cameraAlpha);
      lookTarget.set(
        marbleBody.position.x + lookOffset.x,
        marbleBody.position.y + lookOffset.y,
        marbleBody.position.z + lookOffset.z,
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

  return (
    <div className="appShell">
      <div className="viewport" ref={mountRef} />
      <div className="hud">
        <p>FPS: {debug.fps}</p>
        <p>
          Marble: {debug.posX.toFixed(2)}, {debug.posY.toFixed(2)},{" "}
          {debug.posZ.toFixed(2)}
        </p>
        <p>Respawns: {respawnCount}</p>
        <button type="button" onClick={() => resetRef.current()}>
          Reset Marble
        </button>
      </div>
    </div>
  );
}
