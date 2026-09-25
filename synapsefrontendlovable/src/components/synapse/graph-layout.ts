import { concepts as defaultConcepts, edges as defaultEdges } from "@/demo/concepts";

export interface GraphBounds {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  radius: number;
}

export interface GraphLayoutResult {
  positions: Record<string, [number, number, number]>;
  bounds: GraphBounds;
  componentCount: number;
}

function hashStringToCoordinate(id: string): [number, number, number] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const u = Math.abs((hash % 1000) / 1000);
  const v = Math.abs(((hash >> 8) % 1000) / 1000);
  const w = Math.abs(((hash >> 16) % 1000) / 1000);

  const theta = u * 2 * Math.PI;
  const phi = Math.acos(Math.max(-1, Math.min(1, 2 * v - 1)));
  const r = 4 + w * 5;

  const x = r * Math.sin(phi) * Math.cos(theta);
  const y = r * Math.sin(phi) * Math.sin(theta) * 0.7;
  const z = r * Math.cos(phi);
  return [Number(x.toFixed(2)), Number(y.toFixed(2)), Number(z.toFixed(2))];
}

const layoutCache = new Map<string, GraphLayoutResult>();

/**
 * Component-Aware Deterministic 3D Force-Directed Layout:
 *
 * 1. Detect Connected Components via BFS (zero fake edges created).
 * 2. Lay out each component internally with local repulsion, edge springs,
 *    and centering gravity, centered on [0, 0, 0] with bounding radius R_k.
 * 3. Pack components compactly around global origin using 3D sphere-collision
 *    relaxation so disconnected clusters sit as readable, adjacent islands
 *    instead of repelling each other into distant space.
 * 4. Compute global graph bounding box, center, and bounding radius.
 */
export function computeDeterministic3DLayout(
  conceptsList: { id: string }[] = defaultConcepts,
  edgesList: [string, string][] = defaultEdges,
): GraphLayoutResult {
  if (!conceptsList || conceptsList.length === 0) {
    return {
      positions: {},
      bounds: { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 10 },
      componentCount: 0,
    };
  }

  // Deduplicate and index nodes
  const nodeMap = new Map<string, number>();
  const validNodes: { id: string }[] = [];
  for (const c of conceptsList) {
    if (c?.id && !nodeMap.has(c.id)) {
      nodeMap.set(c.id, validNodes.length);
      validNodes.push(c);
    }
  }

  const cacheKey =
    validNodes
      .map((c) => c.id)
      .sort()
      .join(",") +
    "::" +
    edgesList
      .map((e) => e.join("-"))
      .sort()
      .join(",");

  const cached = layoutCache.get(cacheKey);
  if (cached) return cached;

  // 1. Build adjacency list of real edges
  const adj = new Map<string, string[]>();
  for (const c of validNodes) adj.set(c.id, []);

  for (const [u, v] of edgesList) {
    if (nodeMap.has(u) && nodeMap.has(v) && u !== v) {
      adj.get(u)!.push(v);
      adj.get(v)!.push(u);
    }
  }

  // 2. Discover connected components via BFS
  const visited = new Set<string>();
  const rawComponents: string[][] = [];

  for (const c of validNodes) {
    if (visited.has(c.id)) continue;
    const comp: string[] = [];
    const queue = [c.id];
    visited.add(c.id);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(curr);
      const neighbours = (adj.get(curr) || []).slice().sort();
      for (const nb of neighbours) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    rawComponents.push(comp);
  }

  // 3. Lay out each component internally
  interface ComponentData {
    nodes: string[];
    localPositions: [number, number, number][];
    radius: number;
    center: [number, number, number];
  }

  const componentDataList: ComponentData[] = [];

  for (let k = 0; k < rawComponents.length; k++) {
    const compNodes = rawComponents[k];
    const n = compNodes.length;
    const localPos: [number, number, number][] = [];

    if (n === 1) {
      localPos.push([0, 0, 0]);
    } else if (n === 2) {
      localPos.push([-1.4, 0, 0]);
      localPos.push([1.4, 0, 0]);
    } else {
      // Deterministic PRNG seed unique to this component
      let seed = 1337 + k * 97;
      for (const nid of compNodes) {
        for (let ci = 0; ci < nid.length; ci++) {
          seed = (seed * 31 + nid.charCodeAt(ci)) | 0;
        }
      }
      seed = Math.abs(seed) || 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

      const initRadius = Math.max(1.8, Math.pow(n, 0.35) * 1.5);
      for (let i = 0; i < n; i++) {
        localPos.push([
          rnd() * initRadius * 2,
          rnd() * initRadius * 2,
          rnd() * initRadius * 2,
        ]);
      }

      const compIndex: Record<string, number> = Object.fromEntries(
        compNodes.map((id, i) => [id, i]),
      );
      const compEdges = edgesList.filter(
        ([a, b]) => compIndex[a] !== undefined && compIndex[b] !== undefined,
      );

      const iterations = 180;
      for (let it = 0; it < iterations; it++) {
        const f: [number, number, number][] = localPos.map(() => [0, 0, 0]);

        // Internal pairwise repulsion scaled by 1/sqrt(n) to maintain compact cluster volume
        const repScale = 3.5 / Math.sqrt(Math.max(1, n));
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const dx = localPos[i][0] - localPos[j][0];
            const dy = localPos[i][1] - localPos[j][1];
            const dz = localPos[i][2] - localPos[j][2];
            const distSq = Math.max(0.8, dx * dx + dy * dy + dz * dz);

            const rep = repScale / distSq;
            const fx = dx * rep;
            const fy = dy * rep;
            const fz = dz * rep;

            f[i][0] += fx;
            f[i][1] += fy;
            f[i][2] += fz;

            f[j][0] -= fx;
            f[j][1] -= fy;
            f[j][2] -= fz;
          }
        }

        // Spring attraction along internal edges
        for (const [a, b] of compEdges) {
          const i = compIndex[a];
          const j = compIndex[b];
          if (i === undefined || j === undefined) continue;

          const dx = localPos[j][0] - localPos[i][0];
          const dy = localPos[j][1] - localPos[i][1];
          const dz = localPos[j][2] - localPos[i][2];

          const fx = dx * 0.08;
          const fy = dy * 0.08;
          const fz = dz * 0.08;

          f[i][0] += fx;
          f[i][1] += fy;
          f[i][2] += fz;

          f[j][0] -= fx;
          f[j][1] -= fy;
          f[j][2] -= fz;
        }

        // Centering gravity toward component local origin
        for (let i = 0; i < n; i++) {
          f[i][0] -= localPos[i][0] * 0.06;
          f[i][1] -= localPos[i][1] * 0.06;
          f[i][2] -= localPos[i][2] * 0.06;
        }

        // Clamped step
        const maxDisp = Math.max(0.15, 0.8 - (it / iterations) * 0.6);
        for (let i = 0; i < n; i++) {
          for (let dim = 0; dim < 3; dim++) {
            localPos[i][dim] += Math.max(-maxDisp, Math.min(maxDisp, f[i][dim]));
          }
        }
      }

      // Recenter component on its exact centroid [0, 0, 0]
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < n; i++) {
        cx += localPos[i][0];
        cy += localPos[i][1];
        cz += localPos[i][2];
      }
      cx /= n; cy /= n; cz /= n;
      for (let i = 0; i < n; i++) {
        localPos[i][0] -= cx;
        localPos[i][1] -= cy;
        localPos[i][2] -= cz;
      }
    }

    // Compute component bounding radius
    let compRadius = 1.0;
    for (const p of localPos) {
      const d = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
      if (d > compRadius) compRadius = d;
    }
    compRadius += 1.8; // Visual buffer for labels and celestial rings

    componentDataList.push({
      nodes: compNodes,
      localPositions: localPos,
      radius: compRadius,
      center: [0, 0, 0],
    });
  }

  // 4. Sort components by radius descending so larger clusters form the central anchor
  componentDataList.sort((a, b) => b.radius - a.radius);

  // 5. Pack components in 3D around the global origin
  const M = componentDataList.length;
  if (M > 1) {
    const R0 = componentDataList[0].radius;
    for (let k = 1; k < M; k++) {
      const c = componentDataList[k];
      const targetDist = R0 + c.radius + 2.5;

      const y = 1 - (2 * k) / (M + 1);
      const rho = Math.sqrt(Math.max(0.1, 1 - y * y));
      const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~2.39996 rad
      const theta = goldenAngle * k;

      const x = rho * Math.cos(theta);
      const z = rho * Math.sin(theta);

      c.center = [
        Number((x * targetDist).toFixed(3)),
        Number((y * targetDist * 0.7).toFixed(3)),
        Number((z * targetDist).toFixed(3)),
      ];
    }

    // Component packing relaxation (100 iterations)
    const compIterations = 100;
    for (let it = 0; it < compIterations; it++) {
      const compF: [number, number, number][] = componentDataList.map(() => [0, 0, 0]);

      for (let i = 0; i < M; i++) {
        compF[i][0] -= componentDataList[i].center[0] * 0.05;
        compF[i][1] -= componentDataList[i].center[1] * 0.05;
        compF[i][2] -= componentDataList[i].center[2] * 0.05;
      }

      for (let i = 0; i < M; i++) {
        for (let j = i + 1; j < M; j++) {
          const cA = componentDataList[i];
          const cB = componentDataList[j];

          const dx = cA.center[0] - cB.center[0];
          const dy = cA.center[1] - cB.center[1];
          const dz = cA.center[2] - cB.center[2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const minDist = cA.radius + cB.radius + 2.2;

          if (dist < minDist) {
            const overlap = minDist - dist;
            const dirX = dist > 0.001 ? dx / dist : (i % 2 === 0 ? 1 : -1);
            const dirY = dist > 0.001 ? dy / dist : 0.4;
            const dirZ = dist > 0.001 ? dz / dist : (j % 2 === 0 ? 1 : -1);

            const push = overlap * 0.55;
            compF[i][0] += dirX * push;
            compF[i][1] += dirY * push;
            compF[i][2] += dirZ * push;

            compF[j][0] -= dirX * push;
            compF[j][1] -= dirY * push;
            compF[j][2] -= dirZ * push;
          }
        }
      }

      const maxShift = Math.max(0.2, 1.2 - (it / compIterations) * 0.9);
      for (let i = 0; i < M; i++) {
        for (let dim = 0; dim < 3; dim++) {
          componentDataList[i].center[dim] += Math.max(
            -maxShift,
            Math.min(maxShift, compF[i][dim]),
          );
        }
      }
    }
  }

  // 6. Assemble final world node positions and compute global graph bounds
  const finalPositions: Record<string, [number, number, number]> = {};
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const comp of componentDataList) {
    for (let i = 0; i < comp.nodes.length; i++) {
      const nid = comp.nodes[i];
      const local = comp.localPositions[i];
      const wx = Number((local[0] + comp.center[0]).toFixed(3));
      const wy = Number((local[1] + comp.center[1]).toFixed(3));
      const wz = Number((local[2] + comp.center[2]).toFixed(3));

      finalPositions[nid] = [wx, wy, wz];

      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;

  let maxRadius = 8;
  for (const pos of Object.values(finalPositions)) {
    const d = Math.sqrt(
      (pos[0] - centerX) ** 2 +
      (pos[1] - centerY) ** 2 +
      (pos[2] - centerZ) ** 2,
    );
    if (d > maxRadius) maxRadius = d;
  }
  maxRadius += 2.5;

  const result: GraphLayoutResult = {
    positions: finalPositions,
    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      center: [Number(centerX.toFixed(3)), Number(centerY.toFixed(3)), Number(centerZ.toFixed(3))],
      radius: Number(maxRadius.toFixed(3)),
    },
    componentCount: M,
  };

  layoutCache.set(cacheKey, result);
  return result;
}

// Compute base positions once for default demo concepts
const baseResult = computeDeterministic3DLayout(defaultConcepts, defaultEdges);

export const positions: Record<string, [number, number, number]> = new Proxy(
  baseResult.positions,
  {
    get(target, prop: string) {
      if (typeof prop === "string" && prop in target) {
        return target[prop];
      }
      if (
        typeof prop === "string" &&
        prop.length > 0 &&
        prop !== "prototype" &&
        prop !== "then"
      ) {
        const pos = hashStringToCoordinate(prop);
        target[prop] = pos;
        return pos;
      }
      return undefined;
    },
  },
);
