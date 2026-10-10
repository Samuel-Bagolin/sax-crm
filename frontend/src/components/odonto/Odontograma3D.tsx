import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/* Arcada dentária em 3D (numeração FDI). Os dentes são modelados por tipo (incisivo, canino,
   pré-molar e molar), posicionados ao longo de uma arcada elíptica, com gengiva. Clique em um
   dente para selecionar; arraste para girar. A cor mostra a situação do dente. */

export type EstadoDente = "higido" | "carie" | "restaurado" | "ausente" | "implante" | "canal" | "coroa" | "extracao" | "fratura" | "selante" | "protese";

export const ESTADOS_DENTE: Record<EstadoDente, { rotulo: string; cor: string }> = {
  higido: { rotulo: "Hígido", cor: "#f3eee2" },
  carie: { rotulo: "Cárie", cor: "#d1453b" },
  restaurado: { rotulo: "Restaurado", cor: "#3b82f6" },
  canal: { rotulo: "Canal", cor: "#8b5cf6" },
  coroa: { rotulo: "Coroa", cor: "#d4a017" },
  implante: { rotulo: "Implante", cor: "#94a3b8" },
  protese: { rotulo: "Prótese", cor: "#14b8a6" },
  selante: { rotulo: "Selante", cor: "#22c55e" },
  fratura: { rotulo: "Fratura", cor: "#f97316" },
  extracao: { rotulo: "Extração indicada", cor: "#7f1d1d" },
  ausente: { rotulo: "Ausente", cor: "#cbd5e1" },
};

export const QUADRANTES = {
  sup: [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28]],
  inf: [[48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]],
};

type Tipo = "incisivo" | "lateral" | "canino" | "premolar" | "molar";
function tipo(n: number): Tipo {
  const p = n % 10;
  return p === 1 ? "incisivo" : p === 2 ? "lateral" : p === 3 ? "canino" : p <= 5 ? "premolar" : "molar";
}
const LARGURA: Record<Tipo, number> = { incisivo: 0.86, lateral: 0.68, canino: 0.78, premolar: 0.7, molar: 1.0 };

function geometriaCoroa(t: Tipo, largura: number): THREE.BufferGeometry {
  if (t === "incisivo" || t === "lateral") {
    const g = new RoundedBoxGeometry(largura, 1.0, 0.32, 3, 0.12);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setX(i, pos.getX(i) * (0.82 + 0.18 * (y + 0.5)));
      pos.setZ(i, pos.getZ(i) * (0.55 + 0.45 * (y + 0.5)));
    }
    g.computeVertexNormals();
    return g;
  }
  if (t === "canino") {
    const g = new RoundedBoxGeometry(largura, 1.08, 0.5, 3, 0.18);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const ponta = Math.max(0, -y - 0.15);
      pos.setX(i, pos.getX(i) * (1 - ponta * 1.4));
      pos.setZ(i, pos.getZ(i) * (1 - ponta * 0.8));
    }
    g.computeVertexNormals();
    return g;
  }
  const alt = t === "molar" ? 0.72 : 0.8;
  const prof = t === "molar" ? 0.98 : 0.78;
  const g = new RoundedBoxGeometry(largura, alt, prof, 3, 0.2);
  const pos = g.attributes.position;
  const cuspides = t === "molar" ? [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]] : [[0, -0.18], [0, 0.18]];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < -alt / 2 + 0.06) {
      const x = pos.getX(i) / largura;
      const z = pos.getZ(i) / prof;
      const relevo = Math.max(...cuspides.map(([cx, cz]) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / 0.02)));
      pos.setY(i, y - relevo * 0.12);
    }
  }
  g.computeVertexNormals();
  return g;
}

function pontosArcada(a: number, b: number, n = 400) {
  // meia elipse da linha média (frente) até o fundo, com comprimento acumulado
  const pts: { x: number; z: number; s: number }[] = [];
  let s = 0;
  let ant: { x: number; z: number } | null = null;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * (Math.PI / 2) * 0.98;
    const p = { x: a * Math.sin(t), z: b * Math.cos(t) - b };
    if (ant) s += Math.hypot(p.x - ant.x, p.z - ant.z);
    pts.push({ ...p, s });
    ant = p;
  }
  return pts;
}

function naArcada(pts: ReturnType<typeof pontosArcada>, s: number) {
  const i = Math.min(pts.length - 2, Math.max(0, pts.findIndex((p) => p.s >= s)));
  const p = pts[i];
  const q = pts[i + 1];
  const ang = Math.atan2(-(q.z - p.z), q.x - p.x); // gira o eixo x do dente para a tangente da arcada
  return { x: p.x, z: p.z, ang };
}

export default function Odontograma3D({
  estados,
  selecionado,
  onSelecionar,
  planejados = [],
}: {
  estados: Record<string, EstadoDente>;
  selecionado: string | null;
  onSelecionar: (dente: string) => void;
  planejados?: string[];
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const malhas = useRef<Map<string, { coroa: THREE.Mesh; raiz: THREE.Mesh; anel: THREE.Mesh }>>(new Map());
  const cb = useRef(onSelecionar);
  cb.current = onSelecionar;

  useEffect(() => {
    const el = caixa.current!;
    const cena = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.set(0, 2.2, 9.5);
    const render = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    render.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    render.setSize(el.clientWidth, el.clientHeight);
    render.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(render.domElement);

    cena.add(new THREE.HemisphereLight(0xffffff, 0x8a7a8a, 1.6));
    const sol = new THREE.DirectionalLight(0xffffff, 1.6);
    sol.position.set(3, 6, 8);
    cena.add(sol);
    const contra = new THREE.DirectionalLight(0xffe9e0, 0.6);
    contra.position.set(-4, -3, -6);
    cena.add(contra);

    const grupo = new THREE.Group();
    grupo.position.z = 1.6;
    cena.add(grupo);

    const gengiva = new THREE.MeshPhysicalMaterial({ color: 0xe2899a, roughness: 0.55, clearcoat: 0.3 });
    const raizMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.6 });
    const anelMat = new THREE.MeshBasicMaterial({ color: 0xff7a00, transparent: true, opacity: 0.0 });

    (["sup", "inf"] as const).forEach((arcada) => {
      const sup = arcada === "sup";
      const a = sup ? 2.75 : 2.45;
      const b = sup ? 3.2 : 2.95;
      const pts = pontosArcada(a, b);
      const y = sup ? 0.62 : -0.62;
      // gengiva: tubo ao longo da arcada inteira
      const curva = new THREE.CatmullRomCurve3(
        [...pts].reverse().map((p) => new THREE.Vector3(-p.x, y + (sup ? 0.55 : -0.55), p.z)).concat(pts.slice(1).map((p) => new THREE.Vector3(p.x, y + (sup ? 0.55 : -0.55), p.z))),
      );
      const tubo = new THREE.Mesh(new THREE.TubeGeometry(curva, 160, 0.42, 16, false), gengiva);
      tubo.scale.set(1, 1.1, 1);
      grupo.add(tubo);

      QUADRANTES[arcada].forEach((lado, li) => {
        const sinal = li === 0 ? -1 : 1; // quadrantes 1 e 4 aparecem à esquerda de quem olha
        const ordem = [...lado].sort((x, z) => (x % 10) - (z % 10));
        let s = 0.04;
        ordem.forEach((n) => {
          const t = tipo(n);
          const w = LARGURA[t] * (sup ? 1 : t === "incisivo" ? 0.72 : t === "molar" ? 1.04 : 0.95);
          const c = naArcada(pts, s + w / 2);
          s += w + 0.035;
          const coroa = new THREE.Mesh(geometriaCoroa(t, w), new THREE.MeshPhysicalMaterial({ color: 0xf3eee2, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 }));
          const raiz = new THREE.Mesh(new THREE.ConeGeometry(w * 0.32, 1.1, 14), raizMat);
          const pivo = new THREE.Group();
          pivo.position.set(sinal * c.x, y, c.z);
          pivo.rotation.y = sinal * c.ang;
          if (!sup) pivo.rotation.z = Math.PI;
          raiz.position.y = 0.95;
          raiz.rotation.z = Math.PI;
          const anel = new THREE.Mesh(new THREE.TorusGeometry(w * 0.62, 0.035, 8, 40), anelMat.clone());
          anel.rotation.x = Math.PI / 2;
          anel.position.y = 0.5;
          pivo.add(coroa, raiz, anel);
          coroa.userData.dente = String(n);
          grupo.add(pivo);
          malhas.current.set(String(n), { coroa, raiz, anel });
        });
      });
    });

    const controles = new OrbitControls(camera, render.domElement);
    controles.enablePan = false;
    controles.enableDamping = true;
    controles.minDistance = 6;
    controles.maxDistance = 13;
    controles.minPolarAngle = Math.PI * 0.18;
    controles.maxPolarAngle = Math.PI * 0.82;
    controles.target.set(0, 0, 0);

    const ray = new THREE.Raycaster();
    const ponteiro = new THREE.Vector2();
    let inicio: { x: number; y: number } | null = null;
    const baixo = (e: PointerEvent) => (inicio = { x: e.clientX, y: e.clientY });
    const cima = (e: PointerEvent) => {
      if (!inicio || Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 5) return;
      const r = render.domElement.getBoundingClientRect();
      ponteiro.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ponteiro, camera);
      const alvo = ray.intersectObjects([...malhas.current.values()].map((m) => m.coroa))[0];
      if (alvo) cb.current(alvo.object.userData.dente);
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
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      el.removeChild(render.domElement);
      malhas.current.clear();
    };
  }, []);

  useEffect(() => {
    malhas.current.forEach(({ coroa, raiz, anel }, n) => {
      const est = estados[n] ?? "higido";
      const mat = coroa.material as THREE.MeshPhysicalMaterial;
      mat.color.set(ESTADOS_DENTE[est].cor);
      mat.metalness = est === "implante" || est === "coroa" ? 0.6 : 0;
      mat.transparent = est === "ausente";
      mat.opacity = est === "ausente" ? 0.22 : 1;
      mat.emissive.set(n === selecionado ? 0xff7a00 : 0x000000);
      mat.emissiveIntensity = n === selecionado ? 0.35 : 0;
      raiz.visible = est !== "ausente" && est !== "implante";
      const am = anel.material as THREE.MeshBasicMaterial;
      am.opacity = n === selecionado ? 1 : planejados.includes(n) ? 0.55 : 0;
      am.color.set(n === selecionado ? 0xff7a00 : 0x3b82f6);
    });
  }, [estados, selecionado, planejados]);

  return <div ref={caixa} className="h-[340px] w-full cursor-grab touch-none active:cursor-grabbing sm:h-[400px]" role="img" aria-label="Arcada dentária em 3D. Use a grade de dentes abaixo para escolher pelo teclado." />;
}
