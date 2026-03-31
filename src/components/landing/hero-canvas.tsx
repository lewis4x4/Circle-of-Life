"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";

/**
 * Decorative WebGL hero — no interaction, aria-hidden at parent.
 * Kept lightweight: two wireframe meshes, limited DPR.
 */
export function HeroCanvas() {
  return (
    <div className="absolute inset-0" aria-hidden>
      <Canvas
        camera={{ position: [0, 0, 8.2], fov: 40 }}
        dpr={[1, 2]}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        }}
        style={{ width: "100%", height: "100%" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <ambientLight intensity={0.18} />
        <pointLight position={[6, 5, 9]} intensity={32} color="#2dd4bf" />
        <pointLight position={[-7, -3, 5]} intensity={16} color="#818cf8" />
        <HeroLattice />
      </Canvas>
    </div>
  );
}

function HeroLattice() {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    g.rotation.y += delta * 0.1;
    g.rotation.x += delta * 0.035;
  });

  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[2.35, 1]} />
        <meshStandardMaterial
          color="#0f766e"
          emissive="#042f2e"
          emissiveIntensity={0.9}
          wireframe
          metalness={0.4}
          roughness={0.2}
        />
      </mesh>
      <mesh rotation={[0.45, 0.65, 0.25]}>
        <torusKnotGeometry args={[0.92, 0.19, 96, 12]} />
        <meshStandardMaterial
          color="#5eead4"
          emissive="#115e59"
          emissiveIntensity={0.5}
          wireframe
          transparent
          opacity={0.38}
        />
      </mesh>
    </group>
  );
}
