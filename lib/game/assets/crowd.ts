import * as THREE from "three";
import { BOUNDARY_SQUARE, BOUNDARY_STRAIGHT } from "../dimensions";
import { mulberry32 } from "../mat/noise";

/** Builds low-detail spectators on the terrace treads, with GPU-driven cheering. */
export function buildCrowd(seed: number, tiers: number, rise: number, depth: number, runOff: number) {
  const group = new THREE.Group();
  group.name = "crowd";
  const random = mulberry32(seed);
  const positions: number[] = [];
  const colours: number[] = [];
  const arms: number[] = [];
  // Flat silhouettes preserve heads and waving arms at broadcast distance,
  // without paying for thousands of fully modelled player rigs.
  const quad = (x0: number, y0: number, x1: number, y1: number, colour: number, arm = 0) => {
    const c = new THREE.Color(colour);
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) {
      positions.push(x, y, 0);
      colours.push(c.r, c.g, c.b);
      arms.push(arm);
    }
  };
  quad(-0.22, 0.36, 0.22, 0.91, 0xffffff);
  quad(-0.15, 0.94, 0.15, 1.22, 0xdcae88);
  quad(-0.16, 1.19, 0.16, 1.28, 0x302821);
  quad(-0.22, 0.03, -0.03, 0.37, 0x293545);
  quad(0.03, 0.03, 0.22, 0.37, 0x293545);
  quad(-0.35, 0.42, -0.23, 0.87, 0xdcae88, -1);
  quad(0.23, 0.42, 0.35, 0.87, 0xdcae88, 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute("crowdArm", new THREE.Float32BufferAttribute(arms, 1));
  geometry.computeVertexNormals();
  const time = { value: 0 };
  const cheer = { value: 0 };
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.crowdTime = time;
    shader.uniforms.crowdCheer = cheer;
    shader.vertexShader = `attribute float crowdArm;
      uniform float crowdTime;
      uniform float crowdCheer;
      ${shader.vertexShader}`.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      float phase = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
      float excitement = crowdCheer * (0.78 + 0.22 * sin(crowdTime * 5.0 + phase));
      if (abs(crowdArm) > 0.5) {
        vec2 pivot = vec2(crowdArm * 0.25, 0.87);
        float angle = crowdArm * excitement * 2.7;
        vec2 arm = transformed.xy - pivot;
        transformed.xy = pivot + mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * arm;
      }
      transformed.y += excitement * (0.15 + 0.08 * sin(crowdTime * 7.0 + phase));
    `);
    // Tint shirts only: skin, hair and trousers keep their own colours.
    shader.vertexShader = shader.vertexShader.replace("#include <color_vertex>", `
      #include <color_vertex>
      if (color.r < 0.99 || color.g < 0.99 || color.b < 0.99) vColor = color;
    `);
  };
  const shirts = [0xe9e3d6, 0x408ad0, 0x24519c, 0xf3be45, 0xb4403f, 0x4e8266, 0xd0d6dc, 0x786585];
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  // Separate banks allow frustum culling; each bank leaves a staircase clear.
  for (let bank = 0; bank < 24; bank++) {
    const spectators: { x: number; y: number; z: number; scale: number; colour: number }[] = [];
    for (let row = 0; row < tiers; row++) {
      const extra = runOff + (row + 0.55) * depth;
      const seats = Math.floor((2 * Math.PI * (BOUNDARY_SQUARE + extra)) / 24 / 0.8);
      for (let seat = 1; seat < seats - 1; seat++) {
        if (random() < 0.13) continue;
        const angle = (bank + (seat + (row % 2) * 0.25) / seats) * Math.PI * 2 / 24;
        spectators.push({ x: (BOUNDARY_SQUARE + extra) * Math.cos(angle),
          z: (BOUNDARY_STRAIGHT + extra) * Math.sin(angle), y: (row + 1) * rise,
          scale: 0.88 + random() * 0.22, colour: shirts[Math.floor(random() * shirts.length)] });
      }
    }
    const mesh = new THREE.InstancedMesh(geometry, material, spectators.length);
    mesh.name = `crowd-bank-${bank}`;
    spectators.forEach((spectator, i) => {
      dummy.position.set(spectator.x, spectator.y, spectator.z);
      dummy.rotation.y = Math.atan2(-spectator.x, -spectator.z);
      dummy.scale.setScalar(spectator.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tint.setHex(spectator.colour));
    });
    mesh.computeBoundingSphere();
    // Include raised hands and bouncing in the shader's culling bounds.
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 1;
    group.add(mesh);
  }
  return {
    group,
    /** Smoothly raises the crowd for a boundary chase and settles it between balls. */
    update(dt: number, excitement: number) {
      time.value += dt;
      cheer.value = THREE.MathUtils.damp(cheer.value, excitement, 5, dt);
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
