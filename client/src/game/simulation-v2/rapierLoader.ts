import RAPIER from "@dimforge/rapier3d-compat";

let rapierPromise: Promise<typeof RAPIER> | null = null;

export function loadRapier(): Promise<typeof RAPIER> {
  if (!rapierPromise) {
    rapierPromise = RAPIER.init().then(() => RAPIER);
  }
  return rapierPromise;
}
