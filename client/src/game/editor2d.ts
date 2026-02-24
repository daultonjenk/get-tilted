export type EditorTemplateKind = "straight" | "arc90_left" | "arc90_right" | "s_curve";

export type EditorShapeKind = "rectangle" | "triangle" | "circle";

export type EditorObstacle = {
  id: string;
  name: string;
  shape: EditorShapeKind;
  x: number;
  z: number;
  width: number;
  length: number;
  depth: number;
  yawDeg: number;
};

export type EditorLayout = {
  version: 1;
  template: EditorTemplateKind;
  trackWidth: number;
  obstacles: EditorObstacle[];
};

export type EditorSamplePose = {
  centerX: number;
  centerZ: number;
  tangentX: number;
  tangentZ: number;
  lateralX: number;
  lateralZ: number;
};

export type EditorViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

const ARC_RADIUS = 11;
const STRAIGHT_LENGTH = 18;
const S_CURVE_LENGTH = 20;
const S_CURVE_AMPLITUDE = 2.9;

const TRACK_WIDTH_MIN = 6;
const TRACK_WIDTH_MAX = 12;
const OBSTACLE_WIDTH_MIN = 0.35;
const OBSTACLE_WIDTH_MAX = 9;
const OBSTACLE_LENGTH_MIN = 0.35;
const OBSTACLE_LENGTH_MAX = 14;
const OBSTACLE_DEPTH_MIN = 0.2;
const OBSTACLE_DEPTH_MAX = 8;
const EDGE_PADDING = 0.24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeTemplateKind(value: unknown): EditorTemplateKind {
  if (value === "arc90_left" || value === "arc90_right" || value === "s_curve") {
    return value;
  }
  return "straight";
}

function normalizeShapeKind(value: unknown): EditorShapeKind {
  if (value === "triangle" || value === "circle") {
    return value;
  }
  return "rectangle";
}

function normalizeYaw(value: unknown): number {
  const finite = asFiniteNumber(value);
  if (finite == null) {
    return 0;
  }
  return clamp(finite, -180, 180);
}

function normalizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 48) : fallback;
}

function getObstacleHalfWidth(obstacle: EditorObstacle): number {
  if (obstacle.shape === "circle") {
    return Math.max(obstacle.width, obstacle.length) * 0.5;
  }
  return obstacle.width * 0.5;
}

export function getEditorTemplateLength(template: EditorTemplateKind): number {
  if (template === "straight") {
    return STRAIGHT_LENGTH;
  }
  if (template === "s_curve") {
    return S_CURVE_LENGTH;
  }
  return ARC_RADIUS * Math.PI * 0.5;
}

function normalizeVec2(x: number, z: number): [number, number] {
  const length = Math.hypot(x, z);
  if (length <= 1e-7) {
    return [0, 1];
  }
  return [x / length, z / length];
}

function sampleCenterline(template: EditorTemplateKind, z: number): {
  centerX: number;
  centerZ: number;
  tangentX: number;
  tangentZ: number;
} {
  if (template === "straight") {
    return { centerX: 0, centerZ: z, tangentX: 0, tangentZ: 1 };
  }

  if (template === "s_curve") {
    const clampedZ = clamp(z, 0, S_CURVE_LENGTH);
    const t = clampedZ / S_CURVE_LENGTH;
    const phase = Math.PI * 2 * t;
    const centerX = S_CURVE_AMPLITUDE * Math.sin(phase);
    const slopeX = (S_CURVE_AMPLITUDE * Math.PI * 2 * Math.cos(phase)) / S_CURVE_LENGTH;
    const [tangentX, tangentZ] = normalizeVec2(slopeX, 1);
    return { centerX, centerZ: clampedZ, tangentX, tangentZ };
  }

  const arcLength = getEditorTemplateLength(template);
  const clampedZ = clamp(z, 0, arcLength);
  const theta = (clampedZ / arcLength) * (Math.PI * 0.5);
  const baseX = -ARC_RADIUS + ARC_RADIUS * Math.cos(theta);
  const baseZ = ARC_RADIUS * Math.sin(theta);
  const baseTangentX = -Math.sin(theta);
  const baseTangentZ = Math.cos(theta);
  if (template === "arc90_right") {
    const [tangentX, tangentZ] = normalizeVec2(-baseTangentX, baseTangentZ);
    return {
      centerX: -baseX,
      centerZ: baseZ,
      tangentX,
      tangentZ,
    };
  }
  const [tangentX, tangentZ] = normalizeVec2(baseTangentX, baseTangentZ);
  return {
    centerX: baseX,
    centerZ: baseZ,
    tangentX,
    tangentZ,
  };
}

export function sampleEditorPose(
  template: EditorTemplateKind,
  distanceZ: number,
  lateralOffset: number,
): EditorSamplePose {
  const centerline = sampleCenterline(template, distanceZ);
  const [lateralX, lateralZ] = normalizeVec2(centerline.tangentZ, -centerline.tangentX);
  return {
    centerX: centerline.centerX + lateralOffset * lateralX,
    centerZ: centerline.centerZ + lateralOffset * lateralZ,
    tangentX: centerline.tangentX,
    tangentZ: centerline.tangentZ,
    lateralX,
    lateralZ,
  };
}

function clampObstacleToTrack(obstacle: EditorObstacle, layout: EditorLayout): EditorObstacle {
  const templateLength = getEditorTemplateLength(layout.template);
  const halfTrack = layout.trackWidth * 0.5;
  const halfWidth = getObstacleHalfWidth(obstacle);
  const maxLateral = Math.max(0, halfTrack - halfWidth - EDGE_PADDING);
  return {
    ...obstacle,
    x: clamp(obstacle.x, -maxLateral, maxLateral),
    z: clamp(obstacle.z, 0, templateLength),
  };
}

export function createDefaultEditorLayout(): EditorLayout {
  return {
    version: 1,
    template: "straight",
    trackWidth: 9,
    obstacles: [],
  };
}

function sanitizeObstacle(input: unknown, fallbackId: string): EditorObstacle | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const value = input as Partial<EditorObstacle>;
  const shape = normalizeShapeKind(value.shape);
  const width = clamp(asFiniteNumber(value.width) ?? 1.4, OBSTACLE_WIDTH_MIN, OBSTACLE_WIDTH_MAX);
  const length = clamp(
    asFiniteNumber(value.length) ?? (shape === "circle" ? width : 1.6),
    OBSTACLE_LENGTH_MIN,
    OBSTACLE_LENGTH_MAX,
  );
  const depth = clamp(asFiniteNumber(value.depth) ?? 1.7, OBSTACLE_DEPTH_MIN, OBSTACLE_DEPTH_MAX);
  const id =
    typeof value.id === "string" && value.id.trim().length > 0
      ? value.id.trim().slice(0, 60)
      : fallbackId;
  const obstacle: EditorObstacle = {
    id,
    name: normalizeLabel(value.name, "Obstacle"),
    shape,
    x: asFiniteNumber(value.x) ?? 0,
    z: asFiniteNumber(value.z) ?? 0,
    width,
    length: shape === "circle" ? width : length,
    depth,
    yawDeg: normalizeYaw(value.yawDeg),
  };
  return obstacle;
}

export function sanitizeEditorLayout(input: unknown, fallback?: EditorLayout): EditorLayout {
  const defaults = fallback ?? createDefaultEditorLayout();
  if (!input || typeof input !== "object") {
    return defaults;
  }
  const value = input as Partial<EditorLayout>;
  const template = normalizeTemplateKind(value.template);
  const trackWidth = clamp(
    asFiniteNumber(value.trackWidth) ?? defaults.trackWidth,
    TRACK_WIDTH_MIN,
    TRACK_WIDTH_MAX,
  );
  const rawObstacles = Array.isArray(value.obstacles) ? value.obstacles : [];
  const nextLayout: EditorLayout = {
    version: 1,
    template,
    trackWidth,
    obstacles: [],
  };
  nextLayout.obstacles = rawObstacles
    .map((entry, index) => sanitizeObstacle(entry, `editor-obstacle-${index + 1}`))
    .filter((entry): entry is EditorObstacle => entry != null)
    .map((entry) => clampObstacleToTrack(entry, nextLayout));
  return nextLayout;
}

export function getEditorTrackGeometry(
  layout: EditorLayout,
  sampleCount = 96,
): {
  centerline: Array<{ x: number; z: number }>;
  leftEdge: Array<{ x: number; z: number }>;
  rightEdge: Array<{ x: number; z: number }>;
} {
  const count = Math.max(8, sampleCount);
  const length = getEditorTemplateLength(layout.template);
  const halfWidth = layout.trackWidth * 0.5;
  const centerline: Array<{ x: number; z: number }> = [];
  const leftEdge: Array<{ x: number; z: number }> = [];
  const rightEdge: Array<{ x: number; z: number }> = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const z = length * t;
    const centerPose = sampleEditorPose(layout.template, z, 0);
    const leftPose = sampleEditorPose(layout.template, z, -halfWidth);
    const rightPose = sampleEditorPose(layout.template, z, halfWidth);
    centerline.push({ x: centerPose.centerX, z: centerPose.centerZ });
    leftEdge.push({ x: leftPose.centerX, z: leftPose.centerZ });
    rightEdge.push({ x: rightPose.centerX, z: rightPose.centerZ });
  }
  return { centerline, leftEdge, rightEdge };
}

export function createEditorViewTransform(
  layout: EditorLayout,
  viewportWidth: number,
  viewportHeight: number,
  padding = 24,
): EditorViewTransform {
  const geometry = getEditorTrackGeometry(layout, 128);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of [...geometry.leftEdge, ...geometry.rightEdge]) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    minX = -layout.trackWidth * 0.5;
    maxX = layout.trackWidth * 0.5;
    minZ = 0;
    maxZ = getEditorTemplateLength(layout.template);
  }
  const usableWidth = Math.max(40, viewportWidth - padding * 2);
  const usableHeight = Math.max(40, viewportHeight - padding * 2);
  const worldWidth = Math.max(0.01, maxX - minX);
  const worldHeight = Math.max(0.01, maxZ - minZ);
  const scale = Math.min(usableWidth / worldWidth, usableHeight / worldHeight);
  const contentWidth = worldWidth * scale;
  const contentHeight = worldHeight * scale;
  const offsetX = (viewportWidth - contentWidth) * 0.5 - minX * scale;
  const offsetY = (viewportHeight - contentHeight) * 0.5 - minZ * scale;
  return { scale, offsetX, offsetY };
}

export function worldToEditorView(
  transform: EditorViewTransform,
  x: number,
  z: number,
): { x: number; y: number } {
  return {
    x: x * transform.scale + transform.offsetX,
    y: z * transform.scale + transform.offsetY,
  };
}

export function viewToEditorWorld(
  transform: EditorViewTransform,
  x: number,
  y: number,
): { x: number; z: number } {
  return {
    x: (x - transform.offsetX) / transform.scale,
    z: (y - transform.offsetY) / transform.scale,
  };
}

export function projectWorldPointToTemplate(
  layout: EditorLayout,
  worldX: number,
  worldZ: number,
  sampleCount = 220,
): { x: number; z: number } {
  if (layout.template === "straight") {
    return {
      x: worldX,
      z: clamp(worldZ, 0, getEditorTemplateLength(layout.template)),
    };
  }

  const length = getEditorTemplateLength(layout.template);
  const count = Math.max(24, sampleCount);
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let bestX = 0;
  let bestZ = 0;

  for (let i = 0; i <= count; i += 1) {
    const candidateZ = (length * i) / count;
    const pose = sampleEditorPose(layout.template, candidateZ, 0);
    const dx = worldX - pose.centerX;
    const dz = worldZ - pose.centerZ;
    const along = dx * pose.tangentX + dz * pose.tangentZ;
    const projectedZ = clamp(candidateZ + along, 0, length);
    const projectedPose = sampleEditorPose(layout.template, projectedZ, 0);
    const pdx = worldX - projectedPose.centerX;
    const pdz = worldZ - projectedPose.centerZ;
    const lateral = pdx * projectedPose.lateralX + pdz * projectedPose.lateralZ;
    const distanceSq = pdx * pdx + pdz * pdz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestX = lateral;
      bestZ = projectedZ;
    }
  }

  return {
    x: bestX,
    z: bestZ,
  };
}

export function clampEditorObstacle(obstacle: EditorObstacle, layout: EditorLayout): EditorObstacle {
  const width = clamp(
    asFiniteNumber(obstacle.width) ?? OBSTACLE_WIDTH_MIN,
    OBSTACLE_WIDTH_MIN,
    OBSTACLE_WIDTH_MAX,
  );
  const length = clamp(
    asFiniteNumber(obstacle.length) ?? OBSTACLE_LENGTH_MIN,
    OBSTACLE_LENGTH_MIN,
    OBSTACLE_LENGTH_MAX,
  );
  const depth = clamp(
    asFiniteNumber(obstacle.depth) ?? OBSTACLE_DEPTH_MIN,
    OBSTACLE_DEPTH_MIN,
    OBSTACLE_DEPTH_MAX,
  );
  const yawDeg = normalizeYaw(obstacle.yawDeg);
  const clamped: EditorObstacle = {
    ...obstacle,
    shape: normalizeShapeKind(obstacle.shape),
    x: asFiniteNumber(obstacle.x) ?? 0,
    z: asFiniteNumber(obstacle.z) ?? 0,
    width,
    length,
    depth,
    yawDeg,
  };
  if (clamped.shape === "circle") {
    const diameter = Math.max(clamped.width, clamped.length);
    clamped.width = diameter;
    clamped.length = diameter;
  }
  return clampObstacleToTrack(clamped, layout);
}
