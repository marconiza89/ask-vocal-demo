"use client";
import { Canvas, useFrame, extend } from "@react-three/fiber";
import { type ThreeElement } from '@react-three/fiber'
import { Suspense, useEffect, useRef, useState } from "react";
import { OrbitControls } from "@react-three/drei";

// import { Effects } from "./Effects";

// Estendi per React Three Fiber






export  function Render() {
    const [canvasKey, setCanvasKey] = useState(0);
    useEffect(() => {
        if (process.env.NODE_ENV === "development") {
            setCanvasKey((k) => k + 1);
        }
    }, []);
    return (
        <div className="w-full h-[100svh]">
            <Canvas
                key={canvasKey}
                camera={{ position: [0, 0, 10], fov: 35, near: 0.1, far: 100 }}
                gl={{ antialias: true }}
            >
                <Suspense fallback={null}>
                    <OrbitControls enableDamping dampingFactor={0.05} />
                    
                    <ambientLight intensity={0.3} />
                    <pointLight position={[10, 10, 10]} intensity={0.5} />
                    <mesh>
                        <boxGeometry args={[2, 2, 2]} />
                        <meshStandardMaterial color="orange"  />
                    </mesh>
                    
                    <color attach="background" args={['#000011']} />
                    
                   
                    {/* <Effects /> */}
                </Suspense>
            </Canvas>
        </div>
    );
}