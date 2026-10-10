import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/* Arcadas dentárias em 3D (numeração FDI), na vista clássica de boca aberta:
   - arcada superior inclinada para mostrar o palato e as faces oclusais;
   - arcada inferior de frente, com a base da gengiva.
   Cada dente tem a forma do seu tipo (incisivo, lateral, canino, pré-molar, molar) e a largura
   proporcional à real, distribuídos ao longo de uma arcada em U. Clique num dente para selecionar;
   arraste para girar. A cor mostra a situação do dente. */

import { ESTADOS_DENTE, QUADRANTES, type EstadoDente } from "./odontoDados";
export { ESTADOS_DENTE, QUADRANTES, type EstadoDente };

type Tipo = "incisivo" | "lateral" | "canino" | "premolar" | "molar";
function tipo(n: number): Tipo {
  const p = n % 10;
  return p === 1 ? "incisivo" : p === 2 ? "lateral" : p === 3 ? "canino" : p <= 5 ? "premolar" : "molar";
}

/* Medidas aproximadas (mésio-distal, altura da coroa, vestíbulo-lingual), em unidades de cena (~1 cm). */
function medidas(n: number, sup: boolean): { w: number; h: number; d: number } {
  const p = n % 10;
  const S: Record<number, [number, number, number]> = { 1: [0.86, 1.05, 0.68], 2: [0.66, 0.92, 0.6], 3: [0.78, 1.08, 0.8], 4: [0.7, 0.85, 0.9], 5: [0.68, 0.8, 0.9], 6: [1.02, 0.74, 1.1], 7: [0.94, 0.7, 1.06], 8: [0.86, 0.66, 1.0] };
  const I: Record<number, [number, number, number]> = { 1: [0.54, 0.92, 0.58], 2: [0.6, 0.94, 0.6], 3: [0.7, 1.05, 0.76], 4: [0.7, 0.86, 0.78], 5: [0.72, 0.82, 0.84], 6: [1.12, 0.76, 1.04], 7: [1.04, 0.72, 1.0], 8: [0.98, 0.68, 0.96] };
  const [w, h, d] = (sup ? S : I)[p];
  return { w, h, d };
}

/** Coroa com o eixo em y: y = 0 é o colo (junto da gengiva) e a coroa cresce para y negativo. */
function geometriaCoroa(t: Tipo, w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 4, Math.min(w, d) * (t === "molar" || t === "premolar" ? 0.28 : 0.2));
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const u = (y + h / 2) / h; // 1 no colo, 0 na borda incisal / oclusal
    if (t === "incisivo" || t === "lateral") {
      x *= 0.78 + 0.22 * (1 - u); // mais largo na borda
      z *= 0.38 + 0.62 * u; // fino na borda, grosso no colo (forma de pá)
      if (z < 0) z *= 0.85; // face palatina côncava
    } else if (t === "canino") {
      const ponta = Math.max(0, 0.45 - u) / 0.45;
      x *= (0.85 + 0.15 * u) * (1 - 0.55 * ponta * ponta);
      z *= 0.55 + 0.45 * u;
      y -= ponta * 0.06;
    } else {
      x *= 0.9 + 0.1 * u;
      z *= 0.92 + 0.08 * u;
      if (u < 0.12) {
        // cúspides na face oclusal
        const nx = x / (w / 2);
        const nz = z / (d / 2);
        const cusp = t === "molar"
          ? [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]
          : [[0, -0.45], [0, 0.45]];
        const relevo = Math.max(...cusp.map(([cx, cz]) => Math.exp(-((nx - cx) ** 2 + (nz - cz) ** 2) / 0.12)));
        y -= relevo * 0.09 - 0.03;
      }
    }
    pos.setXYZ(i, x, y - h / 2, z);
  }
  g.computeVertexNormals();
  return g;
}

/* Curva da arcada (meia arcada, da linha média até o fundo), em U: frente arredondada, laterais retas. */
function meiaArcada(escala: number, largura: number) {
  const base = [[0, 0], [0.9, -0.22], [1.6, -0.8], [2.05, -1.6], [2.35, -2.5], [2.52, -3.4], [2.6, -4.3]].map(
    ([x, z]) => new THREE.Vector3(x * largura * escala, 0, z * escala),
  );
  return new THREE.CatmullRomCurve3(base, false, "centripetal");
}

/** Gengiva: perfil arredondado varrido ao longo da arcada inteira (esquerda, frente, direita). */
function gengivaGeometria(curva: THREE.CatmullRomCurve3, sup: boolean): THREE.BufferGeometry {
  const N = 140;
  const M = 28;
  const L = curva.getLength();
  const pos: number[] = [];
  const idx: number[] = [];
  const pts: { p: THREE.Vector3; n: THREE.Vector3; f: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const s = -1 + (2 * i) / N; // -1 fundo esquerdo, 0 frente, 1 fundo direito
    const t = Math.abs(s);
    const p = curva.getPointAt(Math.min(0.999, t));
    const tg = curva.getTangentAt(Math.min(0.999, t));
    const n = new THREE.Vector3(-tg.z, 0, tg.x).normalize(); // para fora da arcada (lado direito)
    if (s < 0) {
      p.x = -p.x;
      n.x = -n.x;
    }
    pts.push({ p, n, f: t });
  }
  for (let i = 0; i <= N; i++) {
    const { p, n, f } = pts[i];
    const largura = 0.42 + 0.22 * f; // mais larga atrás (molares)
    const altura = sup ? 1.0 : 1.45;
    for (let j = 0; j <= M; j++) {
      const a = (j / M) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const ex = Math.sign(c) * Math.abs(c) ** 0.55; // superelipse: lados retos, cantos redondos
      const ey = Math.sign(sn) * Math.abs(sn) ** 0.55;
      const off = ex * largura + 0.02;
      const y = sup ? 0.45 * altura + ey * altura * 0.55 - 0.08 : -0.45 * altura + ey * altura * 0.55 + 0.08;
      pos.push(p.x + n.x * off, y, p.z + n.z * off);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j;
      const b = a + M + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // tampas no fundo de cada lado
  [0, N].forEach((i) => {
    const c = pos.length / 3;
    const { p } = pts[i];
    const yC = sup ? 0.45 : -0.65;
    pos.push(p.x, yC, p.z);
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j;
      idx.push(c, a, a + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  void L;
  return g;
}

/** Palato (céu da boca): superfície em cúpula entre a gengiva de um lado e a do outro. */
function palatoGeometria(curva: THREE.CatmullRomCurve3): THREE.BufferGeometry {
  const N = 60;
  const M = 16;
  const pos: number[] = [];
  const idx: number[] = [];
  const linhas: THREE.Vector3[][] = [];
  for (let i = 0; i <= N; i++) {
    const s = -1 + (2 * i) / N;
    const t = Math.min(0.97, Math.abs(s));
    const p = curva.getPointAt(t);
    const tg = curva.getTangentAt(t);
    const lado = s < 0 ? -1 : 1;
    const n = new THREE.Vector3(-tg.z, 0, tg.x).normalize();
    const borda = new THREE.Vector3(lado * (p.x - n.x * 0.5), 0.55, p.z - n.z * 0.5);
    const meio = new THREE.Vector3(0, 0.55, borda.z);
    const linha: THREE.Vector3[] = [];
    for (let j = 0; j <= M; j++) {
      const v = j / M;
      const q = borda.clone().lerp(meio, v);
      const fundo = Math.min(1, t * 1.6); // mais funda no meio e atrás, rasa na frente
      q.y = 0.55 + Math.sin((v * Math.PI) / 2) * 1.05 * fundo;
      linha.push(q);
    }
    linhas.push(linha);
  }
  linhas.forEach((l) => l.forEach((q) => pos.push(q.x, q.y, q.z)));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j;
      const b = a + M + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
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
    const camera = new THREE.PerspectiveCamera(30, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.set(0, 0.2, 18);
    const render = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    render.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    render.setSize(el.clientWidth, el.clientHeight);
    render.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(render.domElement);

    cena.add(new THREE.HemisphereLight(0xffffff, 0x9c8790, 1.5));
    const sol = new THREE.DirectionalLight(0xffffff, 1.7);
    sol.position.set(2, 3, 9);
    cena.add(sol);
    const lateral = new THREE.DirectionalLight(0xfff0ea, 0.7);
    lateral.position.set(-7, -2, 4);
    cena.add(lateral);

    const grupo = new THREE.Group();
    cena.add(grupo);

    const gengivaMat = new THREE.MeshPhysicalMaterial({ color: 0xe4919f, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4, side: THREE.DoubleSide });
    const palatoMat = new THREE.MeshPhysicalMaterial({ color: 0xe8a0ab, roughness: 0.55, clearcoat: 0.25, side: THREE.DoubleSide });
    const raizMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.6 });
    const anelMat = new THREE.MeshBasicMaterial({ color: 0xff7a00, transparent: true, opacity: 0.0 });

    (["sup", "inf"] as const).forEach((arcada) => {
      const sup = arcada === "sup";
      // largura total dos dentes de um lado: a curva é escalada para caber todos com folga
      const lado = QUADRANTES[arcada][1];
      const total = lado.reduce((a, n) => a + medidas(n, sup).w + 0.04, 0);
      let curva = meiaArcada(1, sup ? 1.32 : 1.24);
      curva = meiaArcada((total + 0.15) / curva.getLength(), sup ? 1.32 : 1.24);
      const prof = curva.getPointAt(1).z;

      // Boca aberta: cada arcada gira numa dobradiça atrás dos últimos molares.
      const dobradica = new THREE.Group();
      dobradica.position.set(0, sup ? 0.35 : -0.35, prof);
      dobradica.rotation.x = sup ? -0.9 : 0.42;
      const arco = new THREE.Group();
      arco.position.set(0, 0, -prof);
      dobradica.add(arco);
      grupo.add(dobradica);

      arco.add(new THREE.Mesh(gengivaGeometria(curva, sup), gengivaMat));
      if (sup) arco.add(new THREE.Mesh(palatoGeometria(curva), palatoMat));

      QUADRANTES[arcada].forEach((dentes, li) => {
        const sinal = li === 0 ? -1 : 1; // quadrantes 1 e 4 à esquerda de quem olha
        const ordem = [...dentes].sort((x, z) => (x % 10) - (z % 10));
        let s = 0.03;
        ordem.forEach((n) => {
          const t = tipo(n);
          const { w, h, d } = medidas(n, sup);
          const u = Math.min(0.999, (s + w / 2) / curva.getLength());
          s += w + 0.04;
          const p = curva.getPointAt(u);
          const tg = curva.getTangentAt(u);
          const ang = Math.atan2(-tg.z, tg.x);
          const coroa = new THREE.Mesh(
            geometriaCoroa(t, w, h, d),
            new THREE.MeshPhysicalMaterial({ color: 0xf4efe3, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
          );
          const raiz = new THREE.Mesh(new THREE.ConeGeometry(w * 0.3, 1.0, 12), raizMat);
          raiz.visible = false; // dentro da gengiva: só aparece no implante (não) e serve de referência
          const pivo = new THREE.Group();
          pivo.rotation.order = "YXZ";
          pivo.position.set(sinal * p.x, 0, p.z);
          pivo.rotation.y = sinal * ang;
          // inclinação natural: incisivos e caninos superiores um pouco para fora
          const incl = sup ? (t === "incisivo" || t === "lateral" ? -0.22 : t === "canino" ? -0.12 : 0) : (t === "incisivo" || t === "lateral" ? 0.08 : 0);
          pivo.rotation.x = incl;
          if (!sup) pivo.rotation.z = Math.PI;
          const anel = new THREE.Mesh(new THREE.TorusGeometry(Math.max(w, d) * 0.62, 0.035, 8, 40), anelMat.clone());
          anel.rotation.x = Math.PI / 2;
          anel.position.y = -h - 0.06;
          pivo.add(coroa, raiz, anel);
          coroa.userData.dente = String(n);
          arco.add(pivo);
          malhas.current.set(String(n), { coroa, raiz, anel });
        });
      });
    });

    const controles = new OrbitControls(camera, render.domElement);
    controles.enablePan = false;
    controles.enableDamping = true;
    controles.minDistance = 9;
    controles.maxDistance = 26;
    controles.minPolarAngle = Math.PI * 0.2;
    controles.maxPolarAngle = Math.PI * 0.8;
    controles.target.set(0, 0.55, 0);

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
    malhas.current.forEach(({ coroa, anel }, n) => {
      const est = estados[n] ?? "higido";
      const mat = coroa.material as THREE.MeshPhysicalMaterial;
      mat.color.set(est === "higido" ? 0xf4efe3 : ESTADOS_DENTE[est].cor);
      mat.metalness = est === "implante" || est === "coroa" ? 0.6 : 0;
      mat.transparent = est === "ausente";
      mat.opacity = est === "ausente" ? 0.18 : 1;
      mat.emissive.set(n === selecionado ? 0xff7a00 : 0x000000);
      mat.emissiveIntensity = n === selecionado ? 0.35 : 0;
      const am = anel.material as THREE.MeshBasicMaterial;
      am.opacity = n === selecionado ? 1 : planejados.includes(n) ? 0.55 : 0;
      am.color.set(n === selecionado ? 0xff7a00 : 0x3b82f6);
    });
  }, [estados, selecionado, planejados]);

  return <div ref={caixa} className="h-[380px] w-full cursor-grab touch-none active:cursor-grabbing sm:h-[460px]" role="img" aria-label="Arcadas dentárias em 3D. Use a grade de dentes abaixo para escolher pelo teclado." />;
}
