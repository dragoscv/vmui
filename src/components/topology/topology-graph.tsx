"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Vector3 } from "three";
import { Save, RotateCcw, Box, Square } from "lucide-react";
import type { TopologyData, TopologyEdge, TopologyNode, TopologyNodeKind } from "@/server/queries/topology";

interface Props {
  data: TopologyData;
}

interface SimNode extends TopologyNode {
  pos: Vector3;
  vel: Vector3;
  fixed: boolean;
}

const KIND_COLOR: Record<TopologyNodeKind, string> = {
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

const KIND_SIZE: Record<TopologyNodeKind, number> = {
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

const EDGE_COLOR: Record<TopologyEdge["kind"], string> = {
  "owned-by": "#475569",
  attaches: "#34d399",
  "in-group": "#fbbf24",
  "in-vpc": "#60a5fa",
  "in-subnet": "#93c5fd",
};

const LAYOUT_STORAGE_KEY = "vmui:topology:layout";
const SETTINGS_STORAGE_KEY = "vmui:topology:settings";

interface SavedSettings {
  view: "3d" | "2d";
  edgeKinds: TopologyEdge["kind"][];
  providers: string[];
}

const DEFAULT_SETTINGS: SavedSettings = {
  view: "3d",
  edgeKinds: ["owned-by", "attaches", "in-group", "in-vpc", "in-subnet"],
  providers: [],
};

function initialLayout(nodes: TopologyNode[]): Map<string, Vector3> {
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
      positions.set(c.id, new Vector3(center.x + Math.cos(phi) * r, yaw, center.z + Math.sin(phi) * r));
    });
  });
  for (const n of nodes) {
    if (!positions.has(n.id)) positions.set(n.id, new Vector3(Math.random() * 2 - 1, 0, Math.random() * 2 - 1));
  }
  return positions;
}

function loadSavedLayout(): Map<string, [number, number, number]> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, [number, number, number]>;
    return new Map(Object.entries(obj));
  } catch {
    return null;
  }
}

function ForceScene({
  data,
  onHover,
  onSelect,
  saveSignal,
}: {
  data: TopologyData;
  onHover: (n: TopologyNode | null) => void;
  onSelect: (n: TopologyNode) => void;
  saveSignal: number;
}) {
  const nodesRef = useRef<SimNode[]>([]);
  const indexRef = useRef<Map<string, SimNode>>(new Map());

  useMemo(() => {
    const initial = initialLayout(data.nodes);
    const saved = loadSavedLayout();
    const sim: SimNode[] = data.nodes.map((n) => {
      const fromSaved = saved?.get(n.id);
      const pos = fromSaved ? new Vector3(fromSaved[0], fromSaved[1], fromSaved[2]) : initial.get(n.id)!.clone();
      return { ...n, pos, vel: new Vector3(), fixed: n.kind === "account" };
    });
    nodesRef.current = sim;
    const idx = new Map<string, SimNode>();
    for (const s of sim) idx.set(s.id, s);
    indexRef.current = idx;
  }, [data]);

  useEffect(() => {
    if (saveSignal === 0) return;
    if (typeof window === "undefined") return;
    const out: Record<string, [number, number, number]> = {};
    for (const n of nodesRef.current) out[n.id] = [n.pos.x, n.pos.y, n.pos.z];
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(out));
  }, [saveSignal]);

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
    const idx = indexRef.current;
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]!;
        const dx = a.pos.x - b.pos.x;
        const dy = a.pos.y - b.pos.y;
        const dz = a.pos.z - b.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const k = 0.6 / d2;
        a.vel.x += dx * k;
        a.vel.y += dy * k;
        a.vel.z += dz * k;
        b.vel.x -= dx * k;
        b.vel.y -= dy * k;
        b.vel.z -= dz * k;
      }
    }
    for (const e of data.edges) {
      const a = idx.get(e.from);
      const b = idx.get(e.to);
      if (!a || !b) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const dz = b.pos.z - a.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const target = e.kind === "owned-by" ? 2.5 : 1.6;
      const f = (d - target) * 0.25;
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
    for (const a of nodes) {
      a.vel.x += -a.pos.x * 0.01;
      a.vel.y += -a.pos.y * 0.04;
      a.vel.z += -a.pos.z * 0.01;
      if (a.fixed) {
        a.vel.set(0, 0, 0);
        continue;
      }
      a.vel.multiplyScalar(0.85);
      a.pos.x += a.vel.x * step;
      a.pos.y += a.vel.y * step;
      a.pos.z += a.vel.z * step;
      const s = sphereRefs.current.get(a.id);
      if (s) s.position.copy(a.pos);
    }
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
    if (geom) (geom.getAttribute("position") as BufferAttribute).needsUpdate = true;
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
          onClick={(e) => {
            e.stopPropagation();
            onSelect(n);
          }}
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

function Canvas2D({ data, onSelect }: { data: TopologyData; onSelect: (n: TopologyNode) => void }) {
  const positions = useMemo(() => initialLayout(data.nodes), [data]);
  const points = data.nodes.map((n) => {
    const p = positions.get(n.id)!;
    return { node: n, x: p.x * 30 + 400, y: p.z * 30 + 300 };
  });
  const pointById = new Map(points.map((p) => [p.node.id, p]));
  return (
    <svg viewBox="0 0 800 600" className="h-full w-full">
      <rect width="800" height="600" fill="#0b0f17" />
      {data.edges.map((e, i) => {
        const a = pointById.get(e.from);
        const b = pointById.get(e.to);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={EDGE_COLOR[e.kind] ?? "#475569"}
            strokeOpacity={0.45}
            strokeWidth={1}
          />
        );
      })}
      {points.map((p) => (
        <g key={p.node.id} onClick={() => onSelect(p.node)} style={{ cursor: "pointer" }}>
          <circle cx={p.x} cy={p.y} r={(KIND_SIZE[p.node.kind] ?? 0.3) * 12} fill={KIND_COLOR[p.node.kind] ?? "#94a3b8"} />
          <text x={p.x + 8} y={p.y + 3} fontSize="9" fill="#cbd5e1">
            {p.node.label.slice(0, 18)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function SidePanel({ node, onClose }: { node: TopologyNode; onClose: () => void }) {
  return (
    <div className="absolute right-3 top-3 z-10 w-72 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR[node.kind] }} />
        <button onClick={onClose} className="text-xs text-muted hover:underline">
          close
        </button>
      </div>
      <div className="text-sm font-semibold">{node.label}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">
        {node.kind} · {node.provider} · {node.region || "—"}
      </div>
      {node.status && (
        <div className="mt-1 text-xs">
          status: <span className="font-mono">{node.status}</span>
        </div>
      )}
      {node.meta && (
        <dl className="mt-2 space-y-0.5 text-[11px]">
          {Object.entries(node.meta).map(([k, v]) =>
            v == null || v === "" ? null : (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-muted">{k}</dt>
                <dd className="font-mono">{String(v)}</dd>
              </div>
            ),
          )}
        </dl>
      )}
      {node.kind === "instance" && (
        <a
          href={`/instances/${encodeURIComponent(node.id)}`}
          className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs hover:bg-[var(--color-surface-muted)]"
        >
          Open instance →
        </a>
      )}
      {node.kind === "account" && (
        <a
          href={`/accounts/${encodeURIComponent(node.accountId)}`}
          className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs hover:bg-[var(--color-surface-muted)]"
        >
          Open account →
        </a>
      )}
    </div>
  );
}

function readSettings(): SavedSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<SavedSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function TopologyGraph({ data }: Props) {
  const [hover, setHover] = useState<TopologyNode | null>(null);
  const [selected, setSelected] = useState<TopologyNode | null>(null);
  const [settings, setSettings] = useState<SavedSettings>(readSettings);
  const [saveSignal, setSaveSignal] = useState(0);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const accounts = useMemo(() => data.nodes.filter((n) => n.kind === "account"), [data]);
  const providers = useMemo(() => Array.from(new Set(data.nodes.map((n) => n.provider))).filter(Boolean), [data]);

  const filtered = useMemo<TopologyData>(() => {
    const nodes = data.nodes.filter((n) => {
      if (accountFilter && n.accountId !== accountFilter && n.id !== `acc:${accountFilter}`) return false;
      if (settings.providers.length > 0 && !settings.providers.includes(n.provider)) return false;
      return true;
    });
    const allowedIds = new Set(nodes.map((n) => n.id));
    const edges = data.edges.filter(
      (e) => allowedIds.has(e.from) && allowedIds.has(e.to) && settings.edgeKinds.includes(e.kind),
    );
    return { nodes, edges, generatedAt: data.generatedAt };
  }, [data, accountFilter, settings]);

  if (data.nodes.length === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted">
        No resources yet — sync an account to populate the topology.
      </div>
    );
  }

  const toggleEdge = (k: TopologyEdge["kind"]) => {
    setSettings((s) => ({
      ...s,
      edgeKinds: s.edgeKinds.includes(k) ? s.edgeKinds.filter((x) => x !== k) : [...s.edgeKinds, k],
    }));
  };
  const toggleProvider = (p: string) => {
    setSettings((s) => ({
      ...s,
      providers: s.providers.includes(p) ? s.providers.filter((x) => x !== p) : [...s.providers, p],
    }));
  };

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-start gap-2">
        <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[11px]">
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, view: "3d" }))}
            className={`flex items-center gap-1 rounded px-2 py-1 ${settings.view === "3d" ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : ""}`}
          >
            <Box className="h-3 w-3" /> 3D
          </button>
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, view: "2d" }))}
            className={`flex items-center gap-1 rounded px-2 py-1 ${settings.view === "2d" ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : ""}`}
          >
            <Square className="h-3 w-3" /> 2D
          </button>
        </div>

        {accounts.length > 0 && (
          <div className="pointer-events-auto flex flex-wrap gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[11px]">
            <button
              type="button"
              onClick={() => setAccountFilter(null)}
              className={`rounded px-2 py-1 ${accountFilter === null ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : ""}`}
            >
              all
            </button>
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAccountFilter(a.accountId)}
                className={`rounded px-2 py-1 ${accountFilter === a.accountId ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : ""}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}

        {providers.length > 0 && (
          <div className="pointer-events-auto flex flex-wrap gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[11px]">
            {providers.map((p) => {
              const on = settings.providers.length === 0 || settings.providers.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggleProvider(p)}
                  className={`rounded px-2 py-1 ${on ? "bg-[var(--color-surface-muted)]" : "opacity-40"}`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        )}

        <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[11px]">
          <button
            type="button"
            onClick={() => setSaveSignal((s) => s + 1)}
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--color-surface-muted)]"
          >
            <Save className="h-3 w-3" /> Save layout
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
                window.location.reload();
              }
            }}
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--color-surface-muted)]"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
      </div>

      {settings.view === "3d" ? (
        <Canvas camera={{ position: [0, 12, 18], fov: 55 }}>
          <color attach="background" args={["#0b0f17"]} />
          <ForceScene data={filtered} onHover={setHover} onSelect={setSelected} saveSignal={saveSignal} />
          <OrbitControls makeDefault enableDamping />
          {hover && !selected && (
            <Html position={[0, 0, 0]} center>
              <div className="pointer-events-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] shadow-lg">
                <div className="font-semibold">{hover.label}</div>
                <div className="text-muted">{hover.kind} · {hover.provider}</div>
              </div>
            </Html>
          )}
        </Canvas>
      ) : (
        <Canvas2D data={filtered} onSelect={setSelected} />
      )}

      {selected && <SidePanel node={selected} onClose={() => setSelected(null)} />}

      <div className="pointer-events-none absolute bottom-3 left-3 grid gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[10px]">
        <div className="mb-1 font-semibold uppercase tracking-wide text-muted">Nodes</div>
        {Object.entries(KIND_COLOR).map(([k, c]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />
            <span className="capitalize">{k}</span>
          </div>
        ))}
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[10px]">
        <div className="mb-1 font-semibold uppercase tracking-wide text-muted">Edges</div>
        {Object.entries(EDGE_COLOR).map(([k, c]) => {
          const on = settings.edgeKinds.includes(k as TopologyEdge["kind"]);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleEdge(k as TopologyEdge["kind"])}
              className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-[var(--color-surface-muted)] ${on ? "" : "opacity-30"}`}
            >
              <span className="inline-block h-0.5 w-3" style={{ background: c }} />
              <span>{k}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
