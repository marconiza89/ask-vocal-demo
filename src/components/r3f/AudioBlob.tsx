"use client";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAudioStore } from "./UseAudio";

export function AudioBlob() {
    const meshRef = useRef<THREE.Mesh>(null);
    const audioLevel = useAudioStore((state) => state.audioLevel);

    useFrame((state) => {
        if (!meshRef.current) return;

        const time = state.clock.elapsedTime;
        
        // Scala basata sul volume
        const scale = 1 + audioLevel * 4.5;
        meshRef.current.scale.lerp(
            new THREE.Vector3(scale, scale, scale),
            0.1
        );

        // Rotazione lenta
        meshRef.current.rotation.y += 0.01;
        meshRef.current.rotation.x = Math.sin(time * 0.5) * 0.2;

        // Modifica emissive intensity basata su audio
        const material = meshRef.current.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 0.1 + audioLevel * 0.9;
    });

    return (
        <mesh ref={meshRef}>
            <icosahedronGeometry args={[1, 4]} />
            <meshStandardMaterial
                color="#1e3a8a"
                emissive="#3b82f6"
                emissiveIntensity={0.1}
                roughness={0.2}
                metalness={0.8}
            />
        </mesh>
    );
}