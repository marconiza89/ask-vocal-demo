"use client";
import { Canvas, useFrame, extend } from "@react-three/fiber";
import { type ThreeElement } from '@react-three/fiber'
import { Suspense, useEffect, useRef, useState } from "react";
import { OrbitControls, Sphere, MeshDistortMaterial, Environment } from "@react-three/drei";
import { AudioBlob } from "./AudioBlob";

// import { Effects } from "./Effects";

// Estendi per React Three Fiber


function DistortedTorusBG() {
 
  return (
    <Sphere     
      castShadow
      receiveShadow     
      args={[1.5, 128, 128]}
      position={[0, 0, 0]}
    >
      <MeshDistortMaterial
        color="#04114b"
        distort={0.45}
        speed={0.9}
        roughness={0.8}
        metalness={0.0}

      />
    </Sphere>
  );
}



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
                    <Environment preset="city" />
                    <ambientLight intensity={0.3} />
                    <pointLight position={[10, 10, 10]} intensity={0.5} />
                    {/* <AudioBlob /> */}
                    <DistortedTorusBG />
                    
                    <color attach="background" args={['#000011']} />
                    
                   
                    {/* <Effects /> */}
                </Suspense>
            </Canvas>
        </div>
    );
}