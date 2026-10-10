import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TRI468, UV468, pairsLeftEye, pairsLeftEyebrow, pairsLips, pairsRightEye, pairsRightEyebrow } from "./malhaFacial";

/* Rosto 3D para marcar pontos de aplicação (toxina, preenchedor, bioestimulador).
   A malha tem a topologia de 468 pontos do MediaPipe; a profundidade é modelada aqui
   (curvatura da cabeça, nariz, órbitas, lábios, queixo e maçãs). Clique para marcar um ponto;
   arraste para girar. Cada ponto recebe a região anatômica mais próxima. */

export interface PontoFacial {
  id: string;
  x: number;
  y: number;
  z: number;
  regiao: string;
  cor?: string;
  rotulo?: string;
}

const g = (u: number, v: number, cu: number, cv: number, su: number, sv: number) => Math.exp(-(((u - cu) / su) ** 2) - (((v - cv) / sv) ** 2));

export function posicao3D(u: number, v: number): [number, number, number] {
  const largura = v > 0.6 ? 1 - 0.5 * Math.pow((v - 0.6) / 0.36, 1.7) : v < 0.25 ? 1 - 0.14 * ((0.25 - v) / 0.15) ** 2 : 1;
  const phi = (u - 0.5) * Math.PI * 0.92;
  let x = 1.05 * largura * Math.sin(phi);
  let z = 0.82 * largura * Math.cos(phi);
  const y = (0.53 - v) * 2.45;
  const frente = Math.cos(phi);
  let d = 0;
  // nariz: dorso da raiz até a ponta, mais as asas
  const desce = Math.min(1, Math.max(0, (v - 0.33) / 0.21));
  d += 0.34 * desce ** 1.3 * Math.exp(-(((u - 0.5) / (0.035 + 0.025 * desce)) ** 2)) * (v > 0.555 ? Math.exp(-(((v - 0.555) / 0.022) ** 2)) : 1);
  d += 0.09 * g(u, v, 0.5, 0.535, 0.075, 0.028);
  // órbitas e globo ocular
  d -= 0.1 * (g(u, v, 0.345, 0.375, 0.075, 0.05) + g(u, v, 0.655, 0.375, 0.075, 0.05));
  d += 0.055 * (g(u, v, 0.35, 0.38, 0.04, 0.022) + g(u, v, 0.65, 0.38, 0.04, 0.022));
  // arco das sobrancelhas, maçãs, lábios, queixo; leve depressão abaixo do nariz
  d += 0.05 * Math.exp(-(((v - 0.29) / 0.035) ** 2)) * Math.exp(-(((Math.abs(u - 0.5) - 0.16) / 0.13) ** 2));
  d += 0.06 * (g(u, v, 0.27, 0.51, 0.08, 0.06) + g(u, v, 0.73, 0.51, 0.08, 0.06));
  d += 0.075 * g(u, v, 0.5, 0.695, 0.1, 0.032);
  d += 0.07 * g(u, v, 0.5, 0.9, 0.09, 0.05);
  d -= 0.025 * g(u, v, 0.5, 0.6, 0.03, 0.02);
  d -= 0.03 * (g(u, v, 0.36, 0.78, 0.06, 0.05) + g(u, v, 0.64, 0.78, 0.06, 0.05));
  z += d * Math.max(0, frente);
  x += d * Math.sin(phi) * 0.15;
  return [x, y, z];
}

// Âncoras anatômicas (índices da malha) para nomear o ponto marcado.
const REGIOES: [number[], string][] = [
  [[10, 151, 109, 338, 67, 297], "Testa"],
  [[9, 8, 168], "Glabela"],
  [[105, 66, 107], "Sobrancelha direita"],
  [[334, 296, 336], "Sobrancelha esquerda"],
  [[33, 130, 226, 127], "Pés de galinha direito"],
  [[263, 359, 446, 356], "Pés de galinha esquerdo"],
  [[230, 231, 228], "Olheira direita"],
  [[450, 451, 448], "Olheira esquerda"],
  [[198, 420, 6, 197], "Nariz (bunny lines)"],
  [[1, 4, 5], "Ponta do nariz"],
  [[50, 117, 123], "Malar direito"],
  [[280, 346, 352], "Malar esquerdo"],
  [[205, 206, 216], "Sulco nasogeniano direito"],
  [[425, 426, 436], "Sulco nasogeniano esquerdo"],
  [[0, 37, 267, 13], "Lábio superior"],
  [[17, 14, 84, 314], "Lábio inferior"],
  [[61, 57], "Comissura direita"],
  [[291, 287], "Comissura esquerda"],
  [[152, 175, 199, 200], "Mento (queixo)"],
  [[172, 136, 150], "Mandíbula direita"],
  [[397, 365, 379], "Mandíbula esquerda"],
  [[127, 162, 21], "Têmpora direita"],
  [[356, 389, 251], "Têmpora esquerda"],
];

const VERTICES = UV468.map(([u, v]) => posicao3D(u, v));

export function regiaoMaisProxima(p: THREE.Vector3): string {
  let melhor = "Face";
  let dist = Infinity;
  for (const [ids, nome] of REGIOES) {
    for (const i of ids) {
      const [x, y, z] = VERTICES[i];
      const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
      if (d < dist) {
        dist = d;
        melhor = nome;
      }
    }
  }
  return melhor;
}

export default function Rosto3D({
  pontos,
  selecionado,
  onMarcar,
  onSelecionar,
  bloqueado = false,
}: {
  pontos: PontoFacial[];
  selecionado: string | null;
  onMarcar: (p: { x: number; y: number; z: number; regiao: string }) => void;
  onSelecionar: (id: string) => void;
  bloqueado?: boolean;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const grupoPontos = useRef<THREE.Group | null>(null);
  const cbMarcar = useRef(onMarcar);
  const cbSel = useRef(onSelecionar);
  const travado = useRef(bloqueado);
  cbMarcar.current = onMarcar;
  cbSel.current = onSelecionar;
  travado.current = bloqueado;

  useEffect(() => {
    const el = caixa.current!;
    const cena = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, el.clientWidth / el.clientHeight, 0.1, 50);
    camera.position.set(1.6, 0.25, 5.95); // de leve três quartos: mostra que é 3D
    const render = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    render.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    render.setSize(el.clientWidth, el.clientHeight);
    render.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(render.domElement);

    cena.add(new THREE.HemisphereLight(0xfff4ee, 0x6b5560, 1.4));
    const chave = new THREE.DirectionalLight(0xffffff, 1.5);
    chave.position.set(2.5, 2.5, 5);
    cena.add(chave);
    const recorte = new THREE.DirectionalLight(0xffd9cc, 0.7);
    recorte.position.set(-4, 1, 2);
    cena.add(recorte);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(VERTICES.flat(), 3));
    const cores = new Float32Array(VERTICES.length * 3);
    const pele = new THREE.Color("#e9b9a0");
    const labio = new THREE.Color("#c97a7a");
    const sobr = new THREE.Color("#8a6656");
    const nosLabios = new Set(pairsLips.flat());
    const nasSobr = new Set([...pairsLeftEyebrow, ...pairsRightEyebrow].flat());
    VERTICES.forEach((_, i) => {
      const c = nosLabios.has(i) ? pele.clone().lerp(labio, 0.75) : nasSobr.has(i) ? pele.clone().lerp(sobr, 0.6) : pele;
      cores.set([c.r, c.g, c.b], i * 3);
    });
    geo.setAttribute("color", new THREE.BufferAttribute(cores, 3));
    geo.setIndex(TRI468);
    geo.computeVertexNormals();
    const rosto = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.62, sheen: 0.4, sheenColor: new THREE.Color("#ffd2c0"), side: THREE.DoubleSide }));
    const grupo = new THREE.Group();
    grupo.add(rosto);

    const linhas = (pares: [number, number][], cor: string, larg = 1) => {
      const pts: number[] = [];
      pares.forEach(([a, b]) => {
        const pa = VERTICES[a];
        const pb = VERTICES[b];
        pts.push(pa[0], pa[1], pa[2] + 0.004, pb[0], pb[1], pb[2] + 0.004);
      });
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      grupo.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: cor, linewidth: larg })));
    };
    linhas([...pairsLeftEye, ...pairsRightEye], "#4a3a3a");
    linhas([...pairsLeftEyebrow, ...pairsRightEyebrow], "#6b4b3e");
    linhas(pairsLips, "#9b4f55");

    const pontosG = new THREE.Group();
    grupo.add(pontosG);
    grupoPontos.current = pontosG;
    cena.add(grupo);

    const controles = new OrbitControls(camera, render.domElement);
    controles.enablePan = false;
    controles.enableDamping = true;
    controles.minDistance = 3.6;
    controles.maxDistance = 8;
    controles.minAzimuthAngle = -Math.PI * 0.42;
    controles.maxAzimuthAngle = Math.PI * 0.42;
    controles.minPolarAngle = Math.PI * 0.3;
    controles.maxPolarAngle = Math.PI * 0.7;

    const ray = new THREE.Raycaster();
    const ponteiro = new THREE.Vector2();
    let inicio: { x: number; y: number } | null = null;
    const baixo = (e: PointerEvent) => (inicio = { x: e.clientX, y: e.clientY });
    const cima = (e: PointerEvent) => {
      if (!inicio || Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 5) return;
      const r = render.domElement.getBoundingClientRect();
      ponteiro.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ponteiro, camera);
      const marcador = ray.intersectObjects(pontosG.children)[0];
      if (marcador) {
        cbSel.current(marcador.object.userData.id);
        return;
      }
      if (travado.current) return;
      const hit = ray.intersectObject(rosto)[0];
      if (hit) cbMarcar.current({ x: hit.point.x, y: hit.point.y, z: hit.point.z, regiao: regiaoMaisProxima(hit.point) });
    };
    render.domElement.addEventListener("pointerdown", baixo);
    render.domElement.addEventListener("pointerup", cima);

    let rodando = true;
    const quadro = () => {
      if (!rodando) return;
      controles.update();
      render.render(cena, camera);
      requestAnimationFrame(quadro);
    };
    quadro();
    const redim = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      render.setSize(el.clientWidth, el.clientHeight);
    });
    redim.observe(el);
    return () => {
      rodando = false;
      redim.disconnect();
      controles.dispose();
      render.dispose();
      cena.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      el.removeChild(render.domElement);
    };
  }, []);

  useEffect(() => {
    const g = grupoPontos.current;
    if (!g) return;
    g.children.slice().forEach((c) => {
      g.remove(c);
      if (c instanceof THREE.Mesh) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    });
    pontos.forEach((p) => {
      const sel = p.id === selecionado;
      const m = new THREE.Mesh(new THREE.SphereGeometry(sel ? 0.055 : 0.042, 16, 16), new THREE.MeshStandardMaterial({ color: p.cor ?? "#4a03a2", emissive: sel ? "#ff7a00" : "#000000", emissiveIntensity: sel ? 0.6 : 0 }));
      m.position.set(p.x, p.y, p.z);
      m.userData.id = p.id;
      g.add(m);
    });
  }, [pontos, selecionado]);

  return <div ref={caixa} className="h-[380px] w-full cursor-crosshair touch-none sm:h-[460px]" role="img" aria-label="Rosto em 3D para marcar pontos de aplicação" />;
}
