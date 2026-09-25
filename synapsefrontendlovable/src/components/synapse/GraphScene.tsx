import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { computeDeterministic3DLayout, positions as fallbackPositions } from "./graph-layout";

interface Props {
  mastery: Record<string, number | null>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  dark: boolean;
  concepts?: { id: string; name: string }[];
  edges?: [string, string][];
  fitTrigger?: number;
}

const reduce =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Computes safe camera target and camera position to fit or focus within the usable viewport.
 * - Available space excludes the top-left Search & Legend box (~384px x ~180px).
 * - Offsets camera target slightly to the screen-left and up so the graph projects to the screen-right and down.
 * - In focus mode, shifts target slightly screen-right so the selected node sits to the left of the right detail drawer.
 */
function computeSafeFraming(
  centerCoords: [number, number, number],
  dist: number,
  camera: THREE.PerspectiveCamera,
  mode: "fit" | "focus",
): { target: THREE.Vector3; camPos: THREE.Vector3 } {
  const vFOV = (camera.fov * Math.PI) / 180;
  const H_w = 2 * dist * Math.tan(vFOV / 2);
  const aspect = camera.aspect || 1.6;
  const W_w = H_w * aspect;

  const target = new THREE.Vector3(...centerCoords);
  let dir = camera.position.clone().sub(target);
  if (dir.lengthSq() < 0.001) {
    dir.set(0, 0.22, 1);
  }
  dir.normalize();

  // Screen-space camera basis vectors
  const worldUp = new THREE.Vector3(0, 1, 0);
  let camRight = new THREE.Vector3().crossVectors(dir, worldUp);
  if (camRight.lengthSq() < 0.001) {
    camRight.set(1, 0, 0);
  } else {
    camRight.normalize();
  }
  const camUp = new THREE.Vector3().crossVectors(camRight, dir).normalize();

  if (mode === "fit") {
    // Top-left Search + Legend overlay: shift target left & up -> graph appears right & down in open area
    const shiftX = aspect > 1 ? -0.11 * W_w : 0;
    const shiftY = aspect > 1 ? 0.07 * H_w : 0.05 * H_w;
    target.addScaledVector(camRight, shiftX);
    target.addScaledVector(camUp, shiftY);
  } else if (mode === "focus") {
    // Concept drawer open on the right (desktop): shift target right -> node appears slightly left of center
    const shiftX = aspect > 1 ? 0.08 * W_w : 0;
    target.addScaledVector(camRight, shiftX);
  }

  const camPos = target.clone().add(dir.multiplyScalar(dist));
  return { target, camPos };
}

/**
 * CameraRig smoothly lerps controls.target and camera.position:
 * - When a node is selected: focuses on the node at distance 26 in the open screen area.
 * - When deselected or fitTrigger fires: smoothly frames the whole graph in the UI-safe viewport.
 * - Cancels transition immediately if the user touches the OrbitControls.
 */
function CameraRig({
  selected,
  nodePositions,
  graphBounds,
  fitTrigger,
}: {
  selected: string | null;
  nodePositions: Record<string, [number, number, number]>;
  graphBounds: {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    radius: number;
  };
  fitTrigger?: number;
}) {
  const { camera, controls } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: {
      target: THREE.Vector3;
      update: () => void;
      addEventListener: (type: string, listener: () => void) => void;
      removeEventListener: (type: string, listener: () => void) => void;
    } | null;
  };

  const goal = useRef<{ t: THREE.Vector3; c: THREE.Vector3 } | null>(null);
  const lastSelected = useRef<string | null>(selected);
  const lastFitTrigger = useRef<number | undefined>(fitTrigger);
  const isInitialMount = useRef(true);

  // If user starts dragging, orbiting, panning, or zooming, cancel animation immediately
  useEffect(() => {
    if (!controls) return;
    const cancel = () => {
      goal.current = null;
    };
    controls.addEventListener("start", cancel);
    return () => {
      controls.removeEventListener("start", cancel);
    };
  }, [controls]);

  // Safe fit distance based on graph radius and available viewport factor (0.68)
  const vFOV = (50 * Math.PI) / 180;
  const usableFactor = 0.68;
  const fitDist = Math.max(
    42,
    Math.min(200, graphBounds.radius / (Math.tan(vFOV / 2) * usableFactor)),
  );

  // Initial alignment on mount to safe viewport region
  useEffect(() => {
    if (!controls || !isInitialMount.current) return;
    isInitialMount.current = false;
    const { target, camPos } = computeSafeFraming(
      graphBounds.center,
      fitDist,
      camera,
      "fit",
    );
    controls.target.copy(target);
    camera.position.copy(camPos);
    controls.update();
  }, [controls, camera, graphBounds, fitDist]);

  // Handle explicit fitTrigger (e.g. Fit View button click)
  useEffect(() => {
    if (fitTrigger === undefined || fitTrigger === lastFitTrigger.current) return;
    lastFitTrigger.current = fitTrigger;
    if (!controls) return;

    const { target, camPos } = computeSafeFraming(
      graphBounds.center,
      fitDist,
      camera,
      "fit",
    );
    goal.current = { t: target, c: camPos };
  }, [fitTrigger, controls, camera, graphBounds, fitDist]);

  // Track selection changes and animate camera target/position
  useEffect(() => {
    if (lastSelected.current === selected) return;
    lastSelected.current = selected;

    if (!controls) return;

    if (selected && nodePositions[selected]) {
      const { target, camPos } = computeSafeFraming(
        nodePositions[selected],
        26,
        camera,
        "focus",
      );
      goal.current = { t: target, c: camPos };
    } else if (!selected) {
      // Pull back camera to frame the entire graph within the safe viewport
      const { target, camPos } = computeSafeFraming(
        graphBounds.center,
        fitDist,
        camera,
        "fit",
      );
      goal.current = { t: target, c: camPos };
    }
  }, [selected, controls, camera, nodePositions, graphBounds, fitDist]);

  useFrame(() => {
    if (!controls || !goal.current) return;

    const k = reduce ? 1 : 0.06;
    controls.target.lerp(goal.current.t, k);
    camera.position.lerp(goal.current.c, k);
    controls.update();

    if (
      camera.position.distanceTo(goal.current.c) < 0.05 &&
      controls.target.distanceTo(goal.current.t) < 0.05
    ) {
      controls.target.copy(goal.current.t);
      camera.position.copy(goal.current.c);
      controls.update();
      goal.current = null;
    }
  });

  return null;
}

/**
 * Celestial Node rendering based on student's mastery score:
 * 1. Strong Mastery (>= 75%): Solid planet core + continuously orbiting companion moon.
 * 2. Developing Mastery (45% - 74%): Solid planet core + thin tilted ring.
 * 3. Needs Review (< 45%): Dimmed faint planet core + swirling spherical dust cloud.
 * 4. Unassessed (null): Nebula seed (dual counter-rotating soft particle clouds, invisible hit sphere).
 */
function CelestialNode({
  id,
  name,
  m,
  sel,
  dim,
  near,
  fg,
  base,
  onSelect,
  isMajor,
  degree,
  hasSelected,
}: {
  id: string;
  name: string;
  m: number | null;
  sel: boolean;
  dim: boolean;
  near: boolean;
  fg: string;
  base: [number, number, number];
  onSelect: (id: string) => void;
  isMajor: boolean;
  degree: number;
  hasSelected: boolean;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const moonOrbitRef = useRef<THREE.Group>(null);
  const dustRef = useRef<THREE.Points>(null);
  const innerHazeRef = useRef<THREE.Points>(null);
  const outerCloudRef = useRef<THREE.Points>(null);

  const [hover, setHover] = useState(false);
  const [camDist, setCamDist] = useState(42);
  const [labelScale, setLabelScale] = useState(1);
  const [isLodVisible, setIsLodVisible] = useState(false);
  const isLodVisibleRef = useRef(false);
  const [isMountedInDom, setIsMountedInDom] = useState(false);
  const lastUpdate = useRef(0);
  const phase = useMemo(() => Math.random() * 20, []);

  // Tightly bounded base planet radius: strictly [0.17, 0.28]
  const r = useMemo(() => {
    if (m === null) return 0.20; // Unassessed
    const score = Math.max(0, Math.min(100, m));
    if (score < 45) {
      return 0.17 + (score / 45) * 0.04; // 0.17 - 0.21
    }
    if (score < 75) {
      return 0.21 + ((score - 45) / 30) * 0.04; // 0.21 - 0.25
    }
    return 0.25 + ((score - 75) / 25) * 0.03; // 0.25 - 0.28
  }, [m]);

  const opacity = dim ? 0.15 : 1;

  // Swirling dust particles for Needs Review (< 45%)
  const dustParticles = useMemo(() => {
    if (m === null || m >= 45) return null;
    const count = 90;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);
      const dist = r * (0.95 + Math.random() * 0.85);
      pos[i * 3] = dist * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = dist * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = dist * Math.cos(phi);
    }
    return pos;
  }, [m, r]);

  // Dual particle clouds for Unassessed Nebula seed (null)
  const nebulaParticles = useMemo(() => {
    if (m !== null) return null;
    const innerCount = 45;
    const innerPos = new Float32Array(innerCount * 3);
    for (let i = 0; i < innerCount; i++) {
      const rad = r * Math.pow(Math.random(), 0.5) * 0.75;
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);
      innerPos[i * 3] = rad * Math.sin(phi) * Math.cos(theta);
      innerPos[i * 3 + 1] = rad * Math.sin(phi) * Math.sin(theta);
      innerPos[i * 3 + 2] = rad * Math.cos(phi);
    }

    const outerCount = 65;
    const outerPos = new Float32Array(outerCount * 3);
    for (let i = 0; i < outerCount; i++) {
      const rad = r * (0.8 + Math.random() * 0.85);
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);
      outerPos[i * 3] = rad * Math.sin(phi) * Math.cos(theta);
      outerPos[i * 3 + 1] = rad * Math.sin(phi) * Math.sin(theta);
      outerPos[i * 3 + 2] = rad * Math.cos(phi);
    }

    return { innerPos, outerPos };
  }, [m, r]);

  // Per-frame floating bobbing motion, bounded scale lerping, and celestial orbit animations
  useFrame(({ camera, clock }) => {
    const time = clock.elapsedTime;

    // 1. Floating vertical bobbing motion
    if (rootRef.current && !reduce) {
      rootRef.current.position.set(
        base[0],
        base[1] + Math.sin(time * 0.5 + phase) * 0.08,
        base[2],
      );
    }

    // 2. Bounded selection / hover scale (max 1.25, never balloons)
    if (rootRef.current) {
      const s = sel ? 1.25 : hover ? 1.12 : 1;
      rootRef.current.scale.lerp(new THREE.Vector3(s, s, s), 0.15);
    }

    // 3. Camera distance & true Level-Of-Detail (LOD) check with hysteresis throttled to 70ms
    if (time - lastUpdate.current > 0.07) {
      lastUpdate.current = time;
      if (rootRef.current) {
        const d = camera.position.distanceTo(rootRef.current.position);
        setCamDist(d);

        // Bounded camera-adjusted scale: strictly [0.72, 1.15]
        const baseScale = 40 / Math.max(12, d);
        const clamped = Math.max(0.72, Math.min(1.15, baseScale));
        setLabelScale(clamped);

        // Hysteresis-aware LOD thresholds based on concept importance:
        // - Major/landmark concepts: appear when d < 34, disappear when d > 38
        // - Connected concepts (degree > 0): appear when d < 24, disappear when d > 28
        // - Leaf concepts (degree === 0): appear when d < 17, disappear when d > 20
        const showThresh = isMajor ? 34 : degree > 0 ? 24 : 17;
        const hideThresh = isMajor ? 38 : degree > 0 ? 28 : 20;

        let nextLod = isLodVisibleRef.current;
        if (isLodVisibleRef.current) {
          if (d > hideThresh) nextLod = false;
        } else {
          if (d < showThresh) nextLod = true;
        }

        if (nextLod !== isLodVisibleRef.current) {
          isLodVisibleRef.current = nextLod;
          setIsLodVisible(nextLod);
        }
      }
    }

    if (reduce) return;

    // Celestial accessory rotations
    if (moonOrbitRef.current) {
      moonOrbitRef.current.rotation.y = time * 1.35 + phase;
    }
    if (dustRef.current) {
      dustRef.current.rotation.y = time * 0.35 + phase;
      dustRef.current.rotation.x = Math.sin(time * 0.2 + phase) * 0.18;
    }
    if (innerHazeRef.current) {
      innerHazeRef.current.rotation.y = time * 0.4 + phase;
    }
    if (outerCloudRef.current) {
      outerCloudRef.current.rotation.y = -time * 0.25 - phase;
    }
  });

  // Active visibility logic:
  // - Searched/selected concept or hovered concept: ALWAYS visible immediately
  // - Selection mode: connected 1st-degree neighbours visible if d < 36
  // - General navigation: governed by hysteresis-aware LOD
  const isVisible = useMemo(() => {
    if (sel || hover) return true;
    if (hasSelected) {
      return near && camDist < 36;
    }
    return isLodVisible;
  }, [sel, hover, hasSelected, near, camDist, isLodVisible]);

  // Mount in DOM slightly before or when visible, and delay unmounting slightly to allow 200ms fade-out
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isVisible) {
      setIsMountedInDom(true);
    } else {
      timeout = setTimeout(() => {
        setIsMountedInDom(false);
      }, 250);
    }
    return () => clearTimeout(timeout);
  }, [isVisible]);

  const isStrong = m !== null && m >= 75;
  const isDeveloping = m !== null && m >= 45 && m < 75;
  const isNeedsReview = m !== null && m < 45;
  const isUnassessed = m === null;

  return (
    <group ref={rootRef} position={base}>
      {/* 1. STRONG MASTERY (>= 75%): Solid Planet Core + Orbiting Companion Moon */}
      {isStrong && (
        <>
          <mesh
            onClick={(e) => {
              e.stopPropagation();
              onSelect(id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHover(true);
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              setHover(false);
              document.body.style.cursor = "";
            }}
          >
            <sphereGeometry args={[r, 32, 32]} />
            <meshStandardMaterial
              color={fg}
              roughness={0.8}
              transparent
              opacity={opacity * 1.0}
            />
          </mesh>

          {/* Tilted orbit companion moon */}
          <group ref={moonOrbitRef} rotation={[Math.PI / 6.5, Math.PI / 8, 0]}>
            <mesh position={[r * 2.0, 0, 0]}>
              <sphereGeometry args={[r * 0.22, 16, 16]} />
              <meshStandardMaterial
                color={fg}
                roughness={0.8}
                transparent
                opacity={opacity * 0.95}
              />
            </mesh>
          </group>
        </>
      )}

      {/* 2. DEVELOPING MASTERY (45% - 74%): Solid Planet Core + Delicate Thin Tilted Ring */}
      {isDeveloping && (
        <>
          <mesh
            onClick={(e) => {
              e.stopPropagation();
              onSelect(id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHover(true);
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              setHover(false);
              document.body.style.cursor = "";
            }}
          >
            <sphereGeometry args={[r, 32, 32]} />
            <meshStandardMaterial
              color={fg}
              roughness={0.8}
              transparent
              opacity={opacity * 0.85}
            />
          </mesh>

          {/* Delicate thin ring encircling the planet at tilt Math.PI / 2.4 */}
          <mesh rotation={[Math.PI / 2.4, 0.15, 0]}>
            <torusGeometry args={[r * 1.55, 0.012, 16, 48]} />
            <meshStandardMaterial
              color={fg}
              roughness={0.8}
              transparent
              opacity={opacity * 0.75}
            />
          </mesh>
        </>
      )}

      {/* 3. NEEDS REVIEW / FOGGY (< 45%): Dimmed Faint Core + Swirling Spherical Dust Cloud */}
      {isNeedsReview && (
        <>
          <mesh
            onClick={(e) => {
              e.stopPropagation();
              onSelect(id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHover(true);
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              setHover(false);
              document.body.style.cursor = "";
            }}
          >
            <sphereGeometry args={[r, 24, 24]} />
            <meshStandardMaterial
              color={fg}
              roughness={0.8}
              transparent
              opacity={opacity * 0.35}
            />
          </mesh>

          {/* Swirling dust cloud representing foggy recall */}
          {dustParticles && (
            <points ref={dustRef}>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[dustParticles, 3]}
                />
              </bufferGeometry>
              <pointsMaterial
                color={fg}
                size={0.035}
                transparent
                opacity={opacity * 0.55}
                sizeAttenuation
              />
            </points>
          )}
        </>
      )}

      {/* 4. UNASSESSED / UNTESTED (null): Nebula Seed (Dual Counter-Rotating Particle Clouds) */}
      {isUnassessed && nebulaParticles && (
        <>
          {/* Invisible hit sphere for pointer events */}
          <mesh
            onClick={(e) => {
              e.stopPropagation();
              onSelect(id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHover(true);
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              setHover(false);
              document.body.style.cursor = "";
            }}
          >
            <sphereGeometry args={[r * 1.35, 16, 16]} />
            <meshBasicMaterial visible={false} />
          </mesh>

          {/* Inner core haze particle cloud */}
          <points ref={innerHazeRef}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[nebulaParticles.innerPos, 3]}
              />
            </bufferGeometry>
            <pointsMaterial
              color={fg}
              size={0.045}
              transparent
              opacity={opacity * 0.65}
              sizeAttenuation
            />
          </points>

          {/* Outer sparse counter-rotating cloud */}
          <points ref={outerCloudRef}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[nebulaParticles.outerPos, 3]}
              />
            </bufferGeometry>
            <pointsMaterial
              color={fg}
              size={0.035}
              transparent
              opacity={opacity * 0.45}
              sizeAttenuation
            />
          </points>
        </>
      )}

      {/* Crisp Billboarded HTML Text Label: LOD-controlled, hysteresis-aware, and smoothly faded */}
      {isMountedInDom && (
        <Html
          center
          position={[0, r + 0.30, 0]}
          style={{
            pointerEvents: isVisible ? "auto" : "none",
            zIndex: sel || hover ? 5 : 2,
          }}
          zIndexRange={[5, 1]}
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              onSelect(id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHover(true);
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              setHover(false);
              document.body.style.cursor = "";
            }}
            className={`cursor-pointer select-none transition-all duration-200 ease-out ${
              isVisible
                ? "opacity-100 scale-100 translate-y-0"
                : "opacity-0 scale-90 translate-y-1 pointer-events-none"
            } ${
              sel
                ? "bg-background/95 border-primary/60 text-foreground font-semibold shadow-md ring-1 ring-primary/30"
                : hover
                ? "bg-background/90 border-border text-foreground font-medium shadow-sm"
                : "bg-background/60 border-border/30 text-muted-foreground/90 backdrop-blur-[2px]"
            } px-2 py-0.5 rounded-full border text-[11px] leading-tight max-w-[130px] truncate text-center`}
            style={{
              transform: `scale(${sel ? Math.min(1.20, labelScale * 1.08) : labelScale})`,
              transformOrigin: "center bottom",
            }}
            title={name}
          >
            {name}
          </div>
        </Html>
      )}
    </group>
  );
}

/**
 * Batched LineSegments network edges with prominent active edge highlighting
 */
function Edges({
  selected,
  fg,
  edges = [],
  nodePositions,
}: {
  selected: string | null;
  fg: string;
  edges?: [string, string][];
  nodePositions: Record<string, [number, number, number]>;
}) {
  const { base, hi } = useMemo(() => {
    const a: number[] = [];
    const b: number[] = [];
    for (const [x, y] of edges) {
      const posX = nodePositions[x] || fallbackPositions[x];
      const posY = nodePositions[y] || fallbackPositions[y];
      if (!posX || !posY) continue;

      const isConnected = selected && (x === selected || y === selected);
      const arr = isConnected ? b : a;
      arr.push(...posX, ...posY);
    }
    return { base: new Float32Array(a), hi: new Float32Array(b) };
  }, [selected, edges, nodePositions]);

  return (
    <>
      <lineSegments key={`b${selected}`}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[base, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color={fg}
          transparent
          opacity={selected ? 0.06 : 0.22}
        />
      </lineSegments>

      {hi.length > 0 && (
        <lineSegments key={`h${selected}`}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[hi, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={fg} transparent opacity={0.9} />
        </lineSegments>
      )}
    </>
  );
}

export default function GraphScene({
  mastery,
  selected,
  onSelect,
  dark,
  concepts: activeConcepts = [],
  edges: activeEdges = [],
  fitTrigger,
}: Props) {
  const fg = dark ? "#e6e6e6" : "#262626";
  const themeBgColor = dark ? "#141413" : "#fbfbfa";

  // Compute deterministic 3D positions and global bounds for the active concepts and edges
  const layoutResult = useMemo(() => {
    return computeDeterministic3DLayout(activeConcepts, activeEdges);
  }, [activeConcepts, activeEdges]);

  const nodePositions = layoutResult.positions;
  const graphBounds = layoutResult.bounds;

  // Precompute concept degrees to identify landmarks and reduce label density
  const degreeMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of activeConcepts) map[c.id] = 0;
    for (const [u, v] of activeEdges) {
      if (map[u] !== undefined) map[u]++;
      if (map[v] !== undefined) map[v]++;
    }
    return map;
  }, [activeConcepts, activeEdges]);

  const majorConceptIds = useMemo(() => {
    const set = new Set<string>();
    if (activeConcepts.length <= 8) {
      for (const c of activeConcepts) set.add(c.id);
      return set;
    }
    const sorted = [...activeConcepts].sort(
      (a, b) => (degreeMap[b.id] || 0) - (degreeMap[a.id] || 0),
    );
    const topCount = Math.max(6, Math.ceil(activeConcepts.length * 0.32));
    for (let i = 0; i < topCount; i++) {
      if (sorted[i]) set.add(sorted[i].id);
    }
    for (const c of activeConcepts) {
      if ((degreeMap[c.id] || 0) >= 3) set.add(c.id);
    }
    return set;
  }, [activeConcepts, degreeMap]);

  // Compute 1-hop neighbours for active selection
  const near = useMemo(() => {
    if (!selected) return new Set<string>();
    const set = new Set<string>([selected]);
    for (const [a, b] of activeEdges) {
      if (a === selected) set.add(b);
      else if (b === selected) set.add(a);
    }
    return set;
  }, [selected, activeEdges]);

  // Initial camera position fitted dynamically to graph bounds with safe zone offset
  const initialCamPos = useMemo(() => {
    const vFOV = (50 * Math.PI) / 180;
    const usableFactor = 0.68;
    const fitDist = Math.max(
      42,
      Math.min(200, graphBounds.radius / (Math.tan(vFOV / 2) * usableFactor)),
    );
    return [
      graphBounds.center[0] - fitDist * 0.12,
      graphBounds.center[1] + fitDist * 0.28,
      graphBounds.center[2] + fitDist,
    ] as [number, number, number];
  }, [graphBounds]);

  return (
    <Canvas
      camera={{ position: initialCamPos, fov: 50, near: 0.1, far: 1000 }}
      onPointerMissed={() => {
        if (selected) onSelect(null);
      }}
      dpr={[1, 2]}
      aria-label="3D knowledge graph"
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />
      <fog attach="fog" args={[themeBgColor, 80, 260]} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan
        autoRotate={!selected && !reduce}
        autoRotateSpeed={0.25}
        minDistance={4}
        maxDistance={240}
      />

      <CameraRig
        selected={selected}
        nodePositions={nodePositions}
        graphBounds={graphBounds}
        fitTrigger={fitTrigger}
      />

      <Edges
        selected={selected}
        fg={fg}
        edges={activeEdges}
        nodePositions={nodePositions}
      />

      {activeConcepts.map((c) => {
        const base = nodePositions[c.id] || fallbackPositions[c.id] || [0, 0, 0];
        const m = mastery[c.id] ?? null;
        const isSel = selected === c.id;
        const isDim = !!selected && !near.has(c.id);
        const isNear = near.has(c.id);
        const isMajor = majorConceptIds.has(c.id);
        const deg = degreeMap[c.id] || 0;

        return (
          <CelestialNode
            key={c.id}
            id={c.id}
            name={c.name}
            m={m}
            sel={isSel}
            dim={isDim}
            near={isNear}
            fg={fg}
            base={base}
            onSelect={onSelect}
            isMajor={isMajor}
            degree={deg}
            hasSelected={!!selected}
          />
        );
      })}
    </Canvas>
  );
}
