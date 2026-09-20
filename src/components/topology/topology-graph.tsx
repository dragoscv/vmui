"use client";

import { Badge, Button, EmptyState, PageHeader, PageSection, PageShell, Skeleton, ToggleGroup } from "@/components/ui";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { TopologyData, TopologyEdge, TopologyNode, TopologyNodeKind } from "@/server/queries/topology";
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Box, Maximize2, Network, RotateCcw, Save, Square } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Vector3 } from "three";
import { mixRgb, rgbToCss, useResolvedTokens, type Rgb } from "./theme-colors";

interface ControlsLike {
  target: Vector3;
  update: () => void;
}

interface Props {
  data: TopologyData;
}

interface SimNode extends TopologyNode {
  pos: Vector3;
  vel: Vector3;
  fixed: boolean;
}

const TOKENS = ["primary", "accent", "success", "warning", "danger", "info", "border", "fg", "fg-muted", "bg", "surface"] as const;
type Tokens = Record<(typeof TOKENS)[number], Rgb>;

interface Palette {
  node: Record<TopologyNodeKind, Rgb>;
  edge: Record<TopologyEdge["kind"], Rgb>;
  background: Rgb;
  label: Rgb;
  fallback: Rgb;
}

function buildPalette(t: Tokens): Palette {
  return {
    node: {
      account: t.primary,
      instance: t.accent,
      volume: t.success,
      snapshot: mixRgb(t.success, t.fg, 0.35),
      "security-group": t.warning,
      vpc: t.info,
      subnet: mixRgb(t.info, t.fg, 0.35),
      bucket: mixRgb(t.primary, t.danger, 0.5),
      "load-balancer": t.danger,
      database: mixRgb(t.warning, t.danger, 0.5),
      dns: mixRgb(t.success, t.accent, 0.5),
    },
    edge: {
      "owned-by": t["fg-muted"],
      attaches: t.success,
      "in-group": t.warning,
      "in-vpc": t.info,
      "in-subnet": mixRgb(t.info, t.fg, 0.35),
    },
    background: t.bg,
    label: t["fg-muted"],
    fallback: t["fg-muted"],
  };
}

const NODE_KINDS: TopologyNodeKind[] = ["account", "instance", "volume", "snapshot", "security-group", "vpc", "subnet", "bucket", "load-balancer", "database", "dns"];
const EDGE_KINDS: TopologyEdge["kind"][] = ["owned-by", "attaches", "in-group", "in-vpc", "in-subnet"];

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

function toColor(rgb: Rgb): Color {
  return new Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
}

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

function FitCamera({ nodesRef, fitSignal }: { nodesRef: React.RefObject<SimNode[]>; fitSignal: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as ControlsLike | null;
  useEffect(() => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.length === 0) return;
    const center = new Vector3();
    for (const n of nodes) center.add(n.pos);
    center.divideScalar(nodes.length);
    let radius = 1;
    for (const n of nodes) radius = Math.max(radius, n.pos.distanceTo(center));
    const fov = "fov" in camera && typeof camera.fov === "number" ? camera.fov : 55;
    const distance = (radius * 1.25) / Math.sin((fov * Math.PI) / 360);
    const dir = camera.position.clone().sub(controls?.target ?? new Vector3()).normalize();
    if (dir.lengthSq() === 0) dir.set(0, 0.6, 1).normalize();
    camera.position.copy(center.clone().add(dir.multiplyScalar(distance)));
    camera.lookAt(center);
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
  }, [fitSignal, camera, controls, nodesRef]);
  return null;
}

function ForceScene({
  data,
  palette,
  onHover,
  onSelect,
  saveSignal,
  fitSignal,
}: {
  data: TopologyData;
  palette: Palette;
  onHover: (n: TopologyNode | null) => void;
  onSelect: (n: TopologyNode) => void;
  saveSignal: number;
  fitSignal: number;
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

  const edgeColor = useMemo(() => toColor(palette.edge["owned-by"]), [palette]);
  const nodeColors = useMemo(() => {
    const m = new Map<TopologyNodeKind, Color>();
    for (const k of NODE_KINDS) m.set(k, toColor(palette.node[k]));
    return m;
  }, [palette]);
  const fallbackColor = useMemo(() => toColor(palette.fallback), [palette]);

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 14, 6]} intensity={0.8} />
      <FitCamera nodesRef={nodesRef} fitSignal={fitSignal} />
      {lineGeomRef.current && (
        <lineSegments geometry={lineGeomRef.current}>
          <lineBasicMaterial color={edgeColor} transparent opacity={0.45} />
        </lineSegments>
      )}
      {nodesRef.current.map((n) => {
        const color = nodeColors.get(n.kind) ?? fallbackColor;
        return (
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
              color={color}
              emissive={color}
              emissiveIntensity={n.status === "running" || n.kind === "account" ? 0.45 : 0.1}
              roughness={0.4}
              metalness={0.15}
            />
          </mesh>
        );
      })}
    </>
  );
}

function Canvas2D({ data, palette, onSelect }: { data: TopologyData; palette: Palette; onSelect: (n: TopologyNode) => void }) {
  const positions = useMemo(() => initialLayout(data.nodes), [data]);
  const points = data.nodes.map((n) => {
    const p = positions.get(n.id)!;
    return { node: n, x: p.x * 30, y: p.z * 30 };
  });
  const pointById = new Map(points.map((p) => [p.node.id, p]));
  const box = points.reduce(
    (b, p) => ({ minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const pad = 60;
  const viewBox = Number.isFinite(box.minX)
    ? `${box.minX - pad} ${box.minY - pad} ${Math.max(200, box.maxX - box.minX + pad * 2)} ${Math.max(150, box.maxY - box.minY + pad * 2)}`
    : "0 0 800 600";
  return (
    <svg viewBox={viewBox} className="h-full w-full" style={{ background: rgbToCss(palette.background) }}>
      {data.edges.map((e, i) => {
        const a = pointById.get(e.from);
        const b = pointById.get(e.to);
        if (!a || !b) return null;
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={rgbToCss(palette.edge[e.kind] ?? palette.fallback)} strokeOpacity={0.45} strokeWidth={1} />;
      })}
      {points.map((p) => (
        <g key={p.node.id} onClick={() => onSelect(p.node)} style={{ cursor: "pointer" }}>
          <circle cx={p.x} cy={p.y} r={(KIND_SIZE[p.node.kind] ?? 0.3) * 12} fill={rgbToCss(palette.node[p.node.kind] ?? palette.fallback)} />
          <text x={p.x + 8} y={p.y + 3} fontSize="9" fill={rgbToCss(palette.label)}>
            {p.node.label.slice(0, 18)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function NodeDetails({ node, palette, onClose }: { node: TopologyNode | null; palette: Palette; onClose: () => void }) {
  const t = useTranslations("ops.topology");
  return (
    <Sheet open={node !== null} onOpenChange={(o) => !o && onClose()}>
      {node && (
        <SheetContent title={node.label} description={`${t(`kinds.${node.kind}`)} · ${node.provider} · ${node.region || "—"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block size-2.5 rounded-full" style={{ background: rgbToCss(palette.node[node.kind] ?? palette.fallback) }} aria-hidden />
            <Badge variant="muted">{t(`kinds.${node.kind}`)}</Badge>
            {node.status && <Badge variant={node.status === "running" ? "success" : "muted"}>{node.status}</Badge>}
          </div>
          {node.meta && Object.values(node.meta).some((v) => v != null && v !== "") && (
            <dl className="space-y-1 text-xs">
              {Object.entries(node.meta).map(([k, v]) =>
                v == null || v === "" ? null : (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-muted">{k}</dt>
                    <dd className="min-w-0 truncate font-mono">{String(v)}</dd>
                  </div>
                ),
              )}
            </dl>
          )}
          {node.kind === "instance" && (
            <Button variant="secondary" asChild>
              <Link href={`/instances/${encodeURIComponent(node.id)}`}>{t("openInstance")}</Link>
            </Button>
          )}
          {node.kind === "account" && (
            <Button variant="secondary" asChild>
              <Link href={`/accounts/${encodeURIComponent(node.accountId)}`}>{t("openAccount")}</Link>
            </Button>
          )}
        </SheetContent>
      )}
    </Sheet>
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
  const t = useTranslations("ops.topology");
  const tc = useTranslations("common");
  const tokens = useResolvedTokens(TOKENS);
  const palette = useMemo(() => (tokens ? buildPalette(tokens) : null), [tokens]);
  const [hover, setHover] = useState<TopologyNode | null>(null);
  const [selected, setSelected] = useState<TopologyNode | null>(null);
  const [settings, setSettings] = useState<SavedSettings>(readSettings);
  const [saveSignal, setSaveSignal] = useState(0);
  const [fitSignal, setFitSignal] = useState(0);
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
    const edges = data.edges.filter((e) => allowedIds.has(e.from) && allowedIds.has(e.to) && settings.edgeKinds.includes(e.kind));
    return { nodes, edges, generatedAt: data.generatedAt };
  }, [data, accountFilter, settings]);

  const presentKinds = useMemo(() => NODE_KINDS.filter((k) => filtered.nodes.some((n) => n.kind === k)), [filtered]);

  const toggleEdge = (k: TopologyEdge["kind"]) =>
    setSettings((s) => ({ ...s, edgeKinds: s.edgeKinds.includes(k) ? s.edgeKinds.filter((x) => x !== k) : [...s.edgeKinds, k] }));
  const toggleProvider = (p: string) =>
    setSettings((s) => ({ ...s, providers: s.providers.includes(p) ? s.providers.filter((x) => x !== p) : [...s.providers, p] }));

  const header = (
    <PageHeader
      title={t("title")}
      description={t("description")}
      icon={<Network />}
      badge={<Badge variant="muted">{t("counts", { nodes: filtered.nodes.length, edges: filtered.edges.length })}</Badge>}
      actions={
        data.nodes.length > 0 ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => setFitSignal((s) => s + 1)}>
              <Maximize2 className="size-4" aria-hidden />
              {t("fit")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSaveSignal((s) => s + 1)} disabled={settings.view !== "3d"}>
              <Save className="size-4" aria-hidden />
              {t("saveLayout")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
                window.location.reload();
              }}
            >
              <RotateCcw className="size-4" aria-hidden />
              {t("resetLayout")}
            </Button>
          </>
        ) : undefined
      }
    />
  );

  if (data.nodes.length === 0) {
    return (
      <PageShell>
        {header}
        <EmptyState
          icon={<Network />}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button asChild>
              <Link href="/accounts">{t("empty.cta")}</Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      {header}

      <PageSection
        title={t("filters.title")}
        description={t("filters.description")}
        action={
          <ToggleGroup
            size="sm"
            value={settings.view}
            onValueChange={(v) => setSettings((s) => ({ ...s, view: v }))}
            aria-label={t("filters.view")}
            options={[
              { value: "3d", label: t("filters.view3d"), icon: <Box className="size-3.5" aria-hidden /> },
              { value: "2d", label: t("filters.view2d"), icon: <Square className="size-3.5" aria-hidden /> },
            ]}
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.length > 0 && (
            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-xs text-muted">{t("filters.accounts")}</legend>
              <div className="flex flex-wrap gap-1.5">
                <Chip pressed={accountFilter === null} onClick={() => setAccountFilter(null)}>
                  {tc("all")}
                </Chip>
                {accounts.map((a) => (
                  <Chip key={a.id} pressed={accountFilter === a.accountId} onClick={() => setAccountFilter(a.accountId)}>
                    {a.label}
                  </Chip>
                ))}
              </div>
            </fieldset>
          )}
          {providers.length > 0 && (
            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-xs text-muted">{t("filters.providers")}</legend>
              <div className="flex flex-wrap gap-1.5">
                {providers.map((p) => (
                  <Chip key={p} pressed={settings.providers.length === 0 || settings.providers.includes(p)} onClick={() => toggleProvider(p)}>
                    {p}
                  </Chip>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-xs text-muted">{t("filters.edges")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {EDGE_KINDS.map((k) => (
                <Chip key={k} pressed={settings.edgeKinds.includes(k)} onClick={() => toggleEdge(k)}>
                  <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: palette ? rgbToCss(palette.edge[k]) : undefined }} aria-hidden />
                  {t(`edges.${k}`)}
                </Chip>
              ))}
            </div>
          </fieldset>
        </div>
      </PageSection>

      <PageSection title={t("graph.title")} description={t("graph.hint")} className="hidden md:block">
        <div className="relative aspect-[16/10] min-h-[420px] max-h-[72vh] w-full overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg">
          {!palette ? (
            <Skeleton className="h-full w-full rounded-none" />
          ) : settings.view === "3d" ? (
            <Canvas camera={{ position: [0, 12, 18], fov: 55 }}>
              <color attach="background" args={[rgbToCss(palette.background)]} />
              <ForceScene data={filtered} palette={palette} onHover={setHover} onSelect={setSelected} saveSignal={saveSignal} fitSignal={fitSignal} />
              <OrbitControls makeDefault enableDamping />
              {hover && !selected && (
                <Html position={[0, 0, 0]} center>
                  <div className="pointer-events-none surface px-2 py-1 text-[11px] shadow-lg">
                    <div className="font-semibold">{hover.label}</div>
                    <div className="text-muted">
                      {t(`kinds.${hover.kind}`)} · {hover.provider}
                    </div>
                  </div>
                </Html>
              )}
            </Canvas>
          ) : (
            <Canvas2D key={fitSignal} data={filtered} palette={palette} onSelect={setSelected} />
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label={t("legend.title")}>
          {presentKinds.map((k) => (
            <Badge key={k} variant="default">
              <span className="inline-block size-2 rounded-full" style={{ background: palette ? rgbToCss(palette.node[k]) : undefined }} aria-hidden />
              {t(`kinds.${k}`)}
            </Badge>
          ))}
        </div>
      </PageSection>

      <PageSection title={t("list.title")} description={t("list.description")} className="md:hidden">
        <ul className="divide-y divide-border">
          {filtered.nodes.slice(0, 200).map((n, i) => (
            <motion.li
              key={n.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: Math.min(i, 12) * 0.03 }}
            >
              <button
                type="button"
                onClick={() => setSelected(n)}
                className="flex min-h-11 w-full items-center gap-3 px-1 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: palette ? rgbToCss(palette.node[n.kind]) : undefined }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.label}</span>
                  <span className="block truncate text-xs text-muted">
                    {n.provider} · {n.region || "—"}
                  </span>
                </span>
                <Badge variant="muted">{t(`kinds.${n.kind}`)}</Badge>
              </button>
            </motion.li>
          ))}
        </ul>
        {filtered.nodes.length > 200 && <p className="mt-2 text-xs text-muted">{t("list.truncated", { count: filtered.nodes.length - 200 })}</p>}
      </PageSection>

      {palette && <NodeDetails node={selected} palette={palette} onClose={() => setSelected(null)} />}
    </PageShell>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        pressed ? "border-primary bg-[color-mix(in_oklch,var(--color-primary)_14%,transparent)] text-fg" : "border-border text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
