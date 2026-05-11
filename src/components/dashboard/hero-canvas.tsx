"use client";

import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Stars, Sparkles, Line } from "@react-three/drei";
import { useVibe, type Vibe } from "@/components/dashboard/vibe-provider";
import * as THREE from "three";

/**
 * Per-vibe hero scene. R3F runs purely client-side; the parent component
 * gates render on `mounted` to avoid SSR drift. Each vibe gets a distinct
 * subject; "minimal" + "terminal" return null and let CSS carry the look.
 */

function CyberpunkScene() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += dt * 0.4;
    ref.current.rotation.x += dt * 0.1;
  });
  return (
    <>
      <ambientLight intensity={0.25} />
      <pointLight position={[4, 3, 5]} intensity={2.5} color="#ff3eb1" />
      <pointLight position={[-4, -2, 4]} intensity={2} color="#3ee8ff" />
      <Float speed={1.2} rotationIntensity={0.6} floatIntensity={1.2}>
        <mesh ref={ref}>
          <icosahedronGeometry args={[1.4, 1]} />
          <meshStandardMaterial
            color="#1a0a2e"
            emissive="#ff3eb1"
            emissiveIntensity={0.45}
            wireframe
          />
        </mesh>
      </Float>
      <Sparkles count={120} scale={[8, 4, 4]} size={2.4} speed={0.4} color="#3ee8ff" />
    </>
  );
}

function CockpitScene() {
  const sweepRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (sweepRef.current) sweepRef.current.rotation.z -= dt * 0.6;
  });
  const rings = useMemo(() => [1.0, 1.6, 2.2, 2.8], []);
  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 0, 4]} intensity={1.6} color="#f6b04a" />
      {rings.map((r) => (
        <mesh key={r} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r - 0.012, r, 80]} />
          <meshBasicMaterial color="#f6b04a" transparent opacity={0.35} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <group ref={sweepRef}>
        <mesh position={[1.4, 0, 0]}>
          <planeGeometry args={[2.8, 0.04]} />
          <meshBasicMaterial color="#f6b04a" transparent opacity={0.85} />
        </mesh>
        <mesh position={[1.4, 0, 0]}>
          <coneGeometry args={[0.06, 0.4, 8]} />
          <meshStandardMaterial color="#5cc6c0" emissive="#5cc6c0" emissiveIntensity={0.6} />
        </mesh>
      </group>
      <mesh>
        <circleGeometry args={[0.18, 32]} />
        <meshStandardMaterial color="#f6b04a" emissive="#f6b04a" emissiveIntensity={0.7} />
      </mesh>
    </>
  );
}

function StrategyScene() {
  const globeRef = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (globeRef.current) globeRef.current.rotation.y += dt * 0.15;
  });
  // Static arcs between fictional region nodes.
  const arcs = useMemo(() => {
    const pts: THREE.Vector3[][] = [];
    const nodes: [number, number][] = [
      [0.4, 0.6],
      [-0.7, 0.2],
      [0.5, -0.5],
      [-0.3, -0.4],
      [0.0, 0.8],
    ];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const aLat = nodes[i]?.[0] ?? 0;
        const aLon = nodes[i]?.[1] ?? 0;
        const bLat = nodes[j]?.[0] ?? 0;
        const bLon = nodes[j]?.[1] ?? 0;
        const a = new THREE.Vector3().setFromSphericalCoords(1.55, Math.PI / 2 - aLat, aLon);
        const b = new THREE.Vector3().setFromSphericalCoords(1.55, Math.PI / 2 - bLat, bLon);
        const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(2.1);
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        pts.push(curve.getPoints(20));
      }
    }
    return pts;
  }, []);
  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 4, 5]} intensity={1.6} color="#fadf7a" />
      <pointLight position={[-4, -2, 3]} intensity={0.9} color="#5cc6c0" />
      <mesh ref={globeRef}>
        <sphereGeometry args={[1.5, 48, 48]} />
        <meshStandardMaterial
          color="#1c2436"
          emissive="#0a1422"
          emissiveIntensity={0.8}
          roughness={0.85}
          metalness={0.1}
          wireframe
        />
      </mesh>
      {arcs.map((curve, i) => (
        <Line key={i} points={curve} color="#fadf7a" lineWidth={1.4} transparent opacity={0.7} />
      ))}
      <Stars radius={20} depth={50} count={1500} factor={4} saturation={0} fade speed={0.5} />
    </>
  );
}

function AuroraScene() {
  const ribbonRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ribbonRef.current) return;
    ribbonRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.3) * 0.15;
    const mat = ribbonRef.current.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.35 + Math.sin(state.clock.elapsedTime * 0.5) * 0.15;
  });
  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[4, 4, 4]} intensity={1.6} color="#5fe8b1" />
      <pointLight position={[-4, -2, 3]} intensity={1.3} color="#9d6bff" />
      <Float speed={0.8} rotationIntensity={0.3} floatIntensity={0.6}>
        <mesh ref={ribbonRef}>
          <torusKnotGeometry args={[1.1, 0.32, 200, 24, 2, 5]} />
          <meshStandardMaterial
            color="#10222e"
            emissive="#5fe8b1"
            emissiveIntensity={0.4}
            roughness={0.25}
            metalness={0.7}
          />
        </mesh>
      </Float>
      <Sparkles count={80} scale={[8, 5, 4]} size={1.8} speed={0.25} color="#9d6bff" />
    </>
  );
}

function SynthwaveScene() {
  const sunRef = useRef<THREE.Mesh>(null);
  const gridRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (sunRef.current) sunRef.current.position.y = -0.3 + Math.sin(state.clock.elapsedTime * 0.4) * 0.05;
    if (gridRef.current) {
      gridRef.current.position.z = (state.clock.elapsedTime * 0.3) % 1;
    }
  });
  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 1, 4]} intensity={2.2} color="#ff3eb1" />
      <mesh ref={sunRef} position={[0, -0.3, -0.5]}>
        <circleGeometry args={[1.6, 64]} />
        <meshBasicMaterial color="#ff3eb1" />
      </mesh>
      <mesh ref={gridRef} rotation={[-Math.PI / 2.2, 0, 0]} position={[0, -1.6, 0]}>
        <planeGeometry args={[16, 12, 24, 24]} />
        <meshBasicMaterial color="#ff3eb1" wireframe transparent opacity={0.6} />
      </mesh>
    </>
  );
}

function SceneFor({ vibe }: { vibe: Vibe }) {
  switch (vibe) {
    case "cyberpunk":
      return <CyberpunkScene />;
    case "cockpit":
      return <CockpitScene />;
    case "strategy":
      return <StrategyScene />;
    case "aurora":
      return <AuroraScene />;
    case "synthwave":
      return <SynthwaveScene />;
    default:
      return null;
  }
}

export function HeroCanvas() {
  const { vibe, ready } = useVibe();
  if (!ready) return null;
  if (vibe === "default" || vibe === "minimal" || vibe === "terminal") return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--radius-xl)]">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 5], fov: 45 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ background: "transparent" }}
      >
        <Suspense fallback={null}>
          <SceneFor vibe={vibe} />
        </Suspense>
      </Canvas>
    </div>
  );
}
