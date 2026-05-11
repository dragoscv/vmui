"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html, Stats } from "@react-three/drei";
import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Vector3 } from "three";
import type { TopologyData, TopologyNode } from "@/server/queries/topology";

interface Props {
  data: TopologyData;
}

interface SimNode extends TopologyNode {
  pos: Vector3;
  vel: Vector3;
  fixed: boolean;
}

const KIND_COLOR: Record<string, string> = {
  account: "#a78bfa",
  instance: "#22d3ee",
  volume: "#34d399",
  snapshot: "#86efac",
  "security-group": "#fbbf24",
  vpc: "#60a5fa",
  subnet: "#93c5fd",
  bucket: "#f472b6",
  "load-balancer": "#fb7185",
  database: "#fb923c",
  dns: "#a3e635",
};

const KIND_SIZE: Record<string, number> = {
  account: 0.6,
  instance: 0.4,
  volume: 0.28,
  snapshot: 0.22,
  "security-group": 0.26,
  vpc: 0.5,
  subnet: 0.32,
  bucket: 0.3,
  "load-balancer": 0.34,
  database: 0.34,
  dns: 0.26,
};

function initialLayout(nodes: TopologyNode[]): Map<string, Vector3> {
  // Cluster initial positions by accountId so accounts start in a ring,
  // with their children sprayed around them in spherical fashion.
  const accounts = nodes.filter((n) => n.kind === "account");
  const byAcc = new Map<string, TopologyNode[]>();
  for (const n of nodes) {
    if (n.kind === "account") continue;
    const list = byAcc.get(n.accountId) ?? [];
    list.push(n);
    byAcc.set(n.accountId, list);
  }

  const positions = new Map<string, Vector3>();
  const accRadius = Math.max(6, accounts.length * 1.6);
  accounts.forEach((acc, i) => {
    const theta = (i / Math.max(1, accounts.length)) * Math.PI * 2;
    const center = new Vector3(Math.cos(theta) * accRadius, 0, Math.sin(theta) * accRadius);
    positions.set(acc.id, center);
    const children = byAcc.get(acc.accountId) ?? [];
    children.forEach((c, j) => {
      const r = 2 + Math.sqrt(j) * 0.6;
      const phi = j * 2.4;
      const yaw = (j % 7) * 0.4 - 1.2;
      positions.set(
        c.id,
        new Vector3(
          center.x + Math.cos(phi) * r,
          yaw,
          center.z + Math.sin(phi) * r,
        ),
      );
    });
  });
  // Orphans (no account) end up near origin.
  for (const n of nodes) {
    if (!positions.has(n.id)) {
      positions.set(n.id, new Vector3(Math.random() * 2 - 1, 0, Math.random() * 2 - 1));
    }
  }
  return positions;
}

function ForceScene({ data, onHover }: { data: TopologyData; onHover: (n: TopologyNode | null) => void }) {
  const nodesRef = useRef<SimNode[]>([]);
  const indexRef = useRef<Map<string, SimNode>>(new Map());
  const adjacencyRef = useRef<Map<string, string[]>>(new Map());

  useMemo(() => {
    const initial = initialLayout(data.nodes);
    const sim: SimNode[] = data.nodes.map((n) => ({
      ...n,
      pos: initial.get(n.id)!.clone(),
      vel: new Vector3(),
      fixed: n.kind === "account",
    }));
    nodesRef.current = sim;
    const idx = new Map<string, SimNode>();
    for (const s of sim) idx.set(s.id, s);
    indexRef.current = idx;
    const adj = new Map<string, string[]>();
    for (const e of data.edges) {
      adj.set(e.from, (adj.get(e.from) ?? []).concat(e.to));
      adj.set(e.to, (adj.get(e.to) ?? []).concat(e.from));
    }
    adjacencyRef.current = adj;
  }, [data]);

  // Spheres + lines refs.
  const sphereRefs = useRef<Map<string, { position: Vector3 }>>(new Map());
  const linesArrayRef = useRef<Float32Array>(new Float32Array(data.edges.length * 6));
  const lineGeomRef = useRef<BufferGeometry | null>(null);

  useEffect(() => {
    const geom = new BufferGeometry();
    const attr = new BufferAttribute(linesArrayRef.current, 3);
    attr.setUsage(DynamicDrawUsage);
    geom.setAttribute("position", attr);
    lineGeomRef.current = geom;
    return () => {
      geom.dispose();
    };
  }, [data]);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.033);
    const nodes = nodesRef.current;
    const n = nodes.length;
    const idx = indexRef.current;

    // Repulsion (O(n^2), fine up to a few hundred).
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]!;
        const dx = a.pos.x - b.pos.x;
        const dy = a.pos.y - b.pos.y;
        const dz = a.pos.z - b.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const k = 0.6 / d2;
        const fx = dx * k;
        const fy = dy * k;
        const fz = dz * k;
        a.vel.x += fx;
        a.vel.y += fy;
        a.vel.z += fz;
        b.vel.x -= fx;
        b.vel.y -= fy;
        b.vel.z -= fz;
      }
    }

    // Spring along edges.
    for (const e of data.edges) {
      const a = idx.get(e.from);
      const b = idx.get(e.to);
      if (!a || !b) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const dz = b.pos.z - a.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const target = e.kind === "owned-by" ? 2.5 : 1.6;
      const k = 0.25;
      const f = (d - target) * k;
      const ux = dx / d;
      const uy = dy / d;
      const uz = dz / d;
      a.vel.x += ux * f;
      a.vel.y += uy * f;
      a.vel.z += uz * f;
      b.vel.x -= ux * f;
      b.vel.y -= uy * f;
      b.vel.z -= uz * f;
    }

    // Gentle center pull.
    for (const a of nodes) {
      a.vel.x += -a.pos.x * 0.01;
      a.vel.y += -a.pos.y * 0.04;
      a.vel.z += -a.pos.z * 0.01;
    }

    // Integrate + damping.
    for (const a of nodes) {
      if (a.fixed) {
        a.vel.set(0, 0, 0);
        continue;
      }
      a.vel.multiplyScalar(0.85);
      a.pos.x += a.vel.x * step;
      a.pos.y += a.vel.y * step;
      a.pos.z += a.vel.z * step;
      const sphere = sphereRefs.current.get(a.id);
      if (sphere) sphere.position.copy(a.pos);
    }

    // Update line positions.
    const arr = linesArrayRef.current;
    let p = 0;
    for (const e of data.edges) {
      const a = idx.get(e.from);
      const b = idx.get(e.to);
      if (!a || !b) {
        p += 6;
        continue;
      }
      arr[p++] = a.pos.x;
      arr[p++] = a.pos.y;
      arr[p++] = a.pos.z;
      arr[p++] = b.pos.x;
      arr[p++] = b.pos.y;
      arr[p++] = b.pos.z;
    }
    const geom = lineGeomRef.current;
    if (geom) {
      const posAttr = geom.getAttribute("position") as BufferAttribute;
      posAttr.needsUpdate = true;
    }
  });

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 14, 6]} intensity={0.8} />
      {lineGeomRef.current && (
        <lineSegments geometry={lineGeomRef.current}>
          <lineBasicMaterial color={new Color("#475569")} transparent opacity={0.45} />
        </lineSegments>
      )}
      {nodesRef.current.map((n) => (
        <mesh
          key={n.id}
          position={n.pos}
          ref={(m) => {
            if (m) sphereRefs.current.set(n.id, m);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            onHover(n);
          }}
          onPointerOut={() => onHover(null)}
        >
          <sphereGeometry args={[KIND_SIZE[n.kind] ?? 0.3, 16, 16]} />
          <meshStandardMaterial
            color={new Color(KIND_COLOR[n.kind] ?? "#94a3b8")}
            emissive={new Color(KIND_COLOR[n.kind] ?? "#94a3b8")}
            emissiveIntensity={n.status === "running" || n.kind === "account" ? 0.45 : 0.1}
            roughness={0.4}
            metalness={0.15}
          />
        </mesh>
      ))}
    </>
  );
}

export function TopologyGraph({ data }: Props) {
  const [hover, setHover] = useState<TopologyNode | null>(null);
  const [showStats, setShowStats] = useState(false);

  // Toggle dev stats with `s`.
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowStats((s) => !s);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  if (data.nodes.length === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted">
        No resources yet — sync an account to populate the topology.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Canvas camera={{ position: [0, 12, 18], fov: 55 }}>
        <color attach="background" args={["#0b0f17"]} />
        <ForceScene data={data} onHover={setHover} />
        <OrbitControls makeDefault enableDamping />
        {showStats && <Stats />}
        {hover && (
          <Html position={[hover.id.length, 0, 0]} center>
            <div className="pointer-events-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] shadow-lg">
              <div className="font-semibold">{hover.label}</div>
              <div className="text-muted">
                {hover.kind} · {hover.provider} · {hover.region}
              </div>
            </div>
          </Html>
        )}
      </Canvas>
      <div className="pointer-events-none absolute bottom-3 left-3 grid gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[10px]">
        {Object.entries(KIND_COLOR).map(([k, c]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />
            <span className="capitalize">{k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
