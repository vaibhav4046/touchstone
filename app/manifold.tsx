"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Interactive 3D Manifold — Conformal Boy's Surface Immersion (RP^2).
 *
 * Mathematical immersion of the real projective plane, embodying Yuzu's core thesis:
 * A continuous, self-bounding topology with zero ambient leakage and complete non-orientable closure.
 *
 * Rendered in 60FPS WebGL with smooth iridescent chromatic shading, specular clearcoat,
 * cursor-driven 3D orbit dragging, and auto-pause when scrolled out of viewport.
 */
export default function TopologicalManifold() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isRotating, setIsRotating] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [webglSupported, setWebglSupported] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Check WebGL support
    try {
      const testCanvas = document.createElement("canvas");
      const gl = testCanvas.getContext("webgl") || testCanvas.getContext("experimental-webgl");
      if (!gl) {
        setWebglSupported(false);
        return;
      }
    } catch {
      setWebglSupported(false);
      return;
    }

    const width = container.clientWidth || 380;
    const height = container.clientHeight || 340;

    // 1. Scene setup
    const scene = new THREE.Scene();

    // 2. Camera setup
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0.4, 4.4);

    // 3. Renderer setup
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    // 4. Parametric Geometry: Bryant-Kusner Boy Surface Immersion
    function complexDiv(r1: number, i1: number, r2: number, i2: number): [number, number] {
      const d = r2 * r2 + i2 * i2;
      return [(r1 * r2 + i1 * i2) / d, (i1 * r2 - r1 * i2) / d];
    }

    function complexPow(r: number, i: number, n: number): [number, number] {
      const mag = Math.hypot(r, i) ** n;
      const ang = Math.atan2(i, r) * n;
      return [mag * Math.cos(ang), mag * Math.sin(ang)];
    }

    function createBoySurfaceGeometry(radialSegments = 56, angularSegments = 110) {
      const geom = new THREE.BufferGeometry();
      const positions: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];

      function getPoint(u: number, v: number): [number, number, number] {
        const rho = u * 0.955;
        const theta = v;
        const w = [rho * Math.cos(theta), rho * Math.sin(theta)];
        const w3 = complexPow(w[0], w[1], 3);
        const w4 = complexPow(w[0], w[1], 4);
        const w5 = complexPow(w[0], w[1], 5);
        const w6 = complexPow(w[0], w[1], 6);

        const num1 = [-1.5 * (w[0] - w5[0]), -1.5 * (w[1] - w5[1])];
        const num2 = [-1.5 * (w[0] + w5[0]), -1.5 * (w[1] + w5[1])];
        const num3 = [1 + w6[0], w6[1]];

        const s5 = Math.sqrt(5);
        const den = [w6[0] + s5 * w3[0] - 1, w6[1] + s5 * w3[1]];

        const d1 = complexDiv(num1[0], num1[1], den[0], den[1]);
        const d2 = complexDiv(num2[0], num2[1], den[0], den[1]);
        const d3 = complexDiv(num3[0], num3[1], den[0], den[1]);

        const g1 = -d1[1];
        const g2 = -d2[0];
        const g3 = d3[1] - 0.5;

        const denomSum = g1 * g1 + g2 * g2 + g3 * g3;
        if (denomSum === 0) return [0, 0, 0];

        // Scale and orient to match YouTube model
        const scale = 1.6;
        return [
          (g1 / denomSum) * scale,
          (g3 / denomSum) * scale - 0.25,
          (-g2 / denomSum) * scale,
        ];
      }

      for (let i = 0; i <= radialSegments; i++) {
        const u = i / radialSegments;
        for (let j = 0; j <= angularSegments; j++) {
          const v = (j / angularSegments) * Math.PI * 2;
          const [x, y, z] = getPoint(u, v);
          positions.push(x, y, z);

          // Iridescent rainbow chromatic color map
          // Matches the image: yellow-chartreuse crest, cyan base, purple-magenta wing, coral fold
          const angle = Math.atan2(z, x);
          const normalizedAngle = ((angle / (Math.PI * 2) + 0.65) % 1 + 1) % 1;
          const hue = normalizedAngle;
          const saturation = 0.92;
          const lightness = 0.58 + (y * 0.08);

          const c = new THREE.Color().setHSL(hue, saturation, Math.max(0.42, Math.min(0.78, lightness)));
          colors.push(c.r, c.g, c.b);
        }
      }

      for (let i = 0; i < radialSegments; i++) {
        for (let j = 0; j < angularSegments; j++) {
          const a = i * (angularSegments + 1) + j;
          const b = (i + 1) * (angularSegments + 1) + j;
          const c = (i + 1) * (angularSegments + 1) + (j + 1);
          const d = i * (angularSegments + 1) + (j + 1);
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }

      geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      return geom;
    }

    const geometry = createBoySurfaceGeometry();

    // 5. Material with iridescent candy/liquid specular shine
    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.18,
      metalness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
      ior: 1.45,
      reflectivity: 0.85,
      flatShading: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = 0.45;
    mesh.rotation.y = -0.35;
    scene.add(mesh);

    // 6. Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xecd8ff, 1.3);
    fillLight.position.set(-5, -2, -3);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xffd479, 2.5, 12);
    rimLight.position.set(0, 4, 3);
    scene.add(rimLight);

    // 7. Interactive Pointer / Drag Controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let velocity = { x: 0, y: 0 };

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      isDragging = true;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      previousMousePosition = { x: clientX, y: clientY };
      velocity = { x: 0, y: 0 };
    };

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - previousMousePosition.x;
      const deltaY = clientY - previousMousePosition.y;

      mesh.rotation.y += deltaX * 0.008;
      mesh.rotation.x += deltaY * 0.008;

      velocity = { x: deltaX * 0.008, y: deltaY * 0.008 };
      previousMousePosition = { x: clientX, y: clientY };
    };

    const handlePointerUp = () => {
      isDragging = false;
    };

    const domElement = renderer.domElement;
    domElement.style.cursor = "grab";
    domElement.addEventListener("mousedown", handlePointerDown);
    domElement.addEventListener("touchstart", handlePointerDown, { passive: true });
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("touchmove", handlePointerMove, { passive: true });
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("touchend", handlePointerUp);

    // 8. Animation & Viewport Occlusion Loop
    let animationFrameId: number;
    let inView = true;

    const observer = new IntersectionObserver((entries) => {
      inView = entries[0].isIntersecting;
    });
    observer.observe(container);

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (!inView) return;

      if (!isDragging) {
        // Inertia decay
        mesh.rotation.y += velocity.x;
        mesh.rotation.x += velocity.y;
        velocity.x *= 0.94;
        velocity.y *= 0.94;

        // Base continuous rotation
        if (isRotating) {
          mesh.rotation.y += 0.0065;
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    // 9. Resize Handling
    const handleResize = () => {
      if (!container) return;
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrameId);
      observer.disconnect();
      resizeObserver.disconnect();

      domElement.removeEventListener("mousedown", handlePointerDown);
      domElement.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("touchmove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("touchend", handlePointerUp);

      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (container.contains(domElement)) {
        container.removeChild(domElement);
      }
    };
  }, [isRotating]);

  if (!webglSupported) {
    return (
      <div className="manifold-card-wrap">
        <div className="manifold-fallback">
          <img
            src="/art/yuzu-mascot-orbs-transparent.webp"
            alt="Yuzu Topological Manifold"
            width={240}
            height={240}
          />
          <p className="small muted">3D WebGL preview active on standard GPU.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="manifold-showcase-container"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="manifold-header-row">
        <span className="manifold-pill">
          <span className="manifold-pulse-dot" />
          INTERACTIVE 3D VIEW
        </span>
        <button
          type="button"
          className="manifold-toggle-btn"
          onClick={() => setIsRotating(!isRotating)}
          title={isRotating ? "Pause 3D rotation" : "Resume 3D rotation"}
        >
          {isRotating ? "⏸ Pause" : "▶ Rotate"}
        </button>
      </div>

      <div ref={containerRef} className="manifold-canvas-mount" />

      <div className="manifold-footer-row">
        <span className="manifold-hint">
          {isHovered ? "✦ Drag to inspect 360°" : "Click and drag to rotate"}
        </span>
        <span className="manifold-formula">WebGL 3D</span>
      </div>
    </div>
  );
}
