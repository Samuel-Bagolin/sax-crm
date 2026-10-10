import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/* Salão em 3D: uma cadeira de barbeiro por posto, com espelho e bancada. A cadeira ocupada
   fica laranja com o cliente sentado; a ociosa fica cinza. Arraste para girar. */

export interface Posto {
  numero: number;
  ocupada: boolean;
  profissional?: string | null;
  cliente?: string | null;
}

const LARANJA = 0xff7a00;
const CINZA = 0x9aa0ad;

function cadeira(ocupada: boolean): THREE.Group {
  const g = new THREE.Group();
  const corEstofado = new THREE.MeshStandardMaterial({ color: ocupada ? LARANJA : CINZA, roughness: 0.45, metalness: 0.05 });
  const cromo = new THREE.MeshStandardMaterial({ color: 0xd9dde5, roughness: 0.18, metalness: 0.9 });
  const preto = new THREE.MeshStandardMaterial({ color: 0x1d1530, roughness: 0.6 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.08, 40), cromo);
  base.position.y = 0.04;
  const coluna = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.62, 24), cromo);
  coluna.position.y = 0.39;
  const assento = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.22, 0.9, 4, 0.08), corEstofado);
  assento.position.y = 0.8;
  const encosto = new THREE.Mesh(new RoundedBoxGeometry(0.9, 1.05, 0.2, 4, 0.08), corEstofado);
  encosto.position.set(0, 1.38, -0.4);
  encosto.rotation.x = -0.12;
  const cabeca = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.26, 0.16, 4, 0.07), corEstofado);
  cabeca.position.set(0, 2.02, -0.5);
  const descansoPe = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.06, 0.28, 2, 0.02), cromo);
  descansoPe.position.set(0, 0.36, 0.62);
  g.add(base, coluna, assento, encosto, cabeca, descansoPe);
  for (const lado of [-1, 1]) {
    const braco = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.12, 0.85, 2, 0.05), preto);
    braco.position.set(lado * 0.52, 1.08, -0.02);
    const apoio = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 12), cromo);
    apoio.position.set(lado * 0.52, 0.94, 0.3);
    g.add(braco, apoio);
  }
  if (ocupada) {
    // Cliente estilizado sentado, com a capa de corte.
    const capa = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.15, 32), new THREE.MeshStandardMaterial({ color: 0x4a03a2, roughness: 0.7 }));
    capa.position.set(0, 1.42, -0.05);
    const cabecaCliente = new THREE.Mesh(new THREE.SphereGeometry(0.24, 32, 24), new THREE.MeshStandardMaterial({ color: 0xc58c6a, roughness: 0.6 }));
    cabecaCliente.position.set(0, 2.15, -0.05);
    g.add(capa, cabecaCliente);
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

function bancada(): THREE.Group {
  const g = new THREE.Group();
  const madeira = new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.7 });
  const espelho = new THREE.MeshStandardMaterial({ color: 0xbfd5e6, roughness: 0.05, metalness: 0.85 });
  const moldura = new THREE.MeshStandardMaterial({ color: 0x1d1530, roughness: 0.4 });
  const tampo = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.12, 0.5, 2, 0.04), madeira);
  tampo.position.set(0, 1.0, 0);
  const vidro = new THREE.Mesh(new RoundedBoxGeometry(1.15, 1.5, 0.04, 2, 0.02), espelho);
  vidro.position.set(0, 2.05, -0.2);
  const quadro = new THREE.Mesh(new RoundedBoxGeometry(1.27, 1.62, 0.03, 2, 0.02), moldura);
  quadro.position.set(0, 2.05, -0.23);
  g.add(tampo, quadro, vidro);
  return g;
}

export default function Cadeiras3D({ postos }: { postos: Posto[] }) {
  const caixa = useRef<HTMLDivElement>(null);
  const chave = postos.map((p) => (p.ocupada ? 1 : 0)).join("");

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const largura = el.clientWidth || 600;
    const altura = el.clientHeight || 320;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(largura, altura);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const cena = new THREE.Scene();
    const n = Math.max(1, postos.length);
    const espaco = 2.1;
    const porFila = Math.min(n, 6);
    const filas = Math.ceil(n / porFila);
    const larguraSalao = porFila * espaco;
    const camera = new THREE.PerspectiveCamera(34, largura / altura, 0.1, 200);
    const dist = Math.max(9, larguraSalao * 1.25 + filas * 2);
    camera.position.set(0, dist * 0.55, dist);

    cena.add(new THREE.HemisphereLight(0xffffff, 0xd9cfe8, 1.1));
    const sol = new THREE.DirectionalLight(0xffffff, 1.6);
    sol.position.set(4, 10, 6);
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    sol.shadow.camera.left = -14;
    sol.shadow.camera.right = 14;
    sol.shadow.camera.top = 14;
    sol.shadow.camera.bottom = -14;
    cena.add(sol);

    const piso = new THREE.Mesh(
      new THREE.PlaneGeometry(larguraSalao + 3, filas * 3.4 + 2),
      new THREE.MeshStandardMaterial({ color: 0xf1ece6, roughness: 0.9 }),
    );
    piso.rotation.x = -Math.PI / 2;
    piso.receiveShadow = true;
    cena.add(piso);
    // Faixas do piso quadriculado, assinatura de barbearia.
    const ladrilho = new THREE.MeshStandardMaterial({ color: 0x1d1530, roughness: 0.9 });
    for (let i = -Math.floor(larguraSalao / 1.2); i <= Math.floor(larguraSalao / 1.2); i += 2) {
      const faixa = new THREE.Mesh(new THREE.PlaneGeometry(0.6, filas * 3.4 + 2), ladrilho);
      faixa.rotation.x = -Math.PI / 2;
      faixa.position.set(i * 0.6, 0.002, 0);
      faixa.material.transparent = true;
      (faixa.material as THREE.MeshStandardMaterial).opacity = 0.06;
      cena.add(faixa);
    }

    const grupo = new THREE.Group();
    postos.forEach((p, i) => {
      const fila = Math.floor(i / porFila);
      const col = i % porFila;
      const naFila = Math.min(porFila, n - fila * porFila);
      const x = (col - (naFila - 1) / 2) * espaco;
      const z = (fila - (filas - 1) / 2) * 3.4;
      const c = cadeira(p.ocupada);
      c.position.set(x, 0, z + 0.3);
      const b = bancada();
      b.position.set(x, 0, z - 0.95);
      grupo.add(c, b);
    });
    cena.add(grupo);

    const controles = new OrbitControls(camera, renderer.domElement);
    controles.target.set(0, 1, 0);
    controles.enableDamping = true;
    controles.enablePan = false;
    controles.minPolarAngle = 0.35;
    controles.maxPolarAngle = 1.35;
    controles.minDistance = 5;
    controles.maxDistance = dist * 1.8;
    controles.update();

    let quadro = 0;
    const animar = () => {
      controles.update();
      renderer.render(cena, camera);
      quadro = requestAnimationFrame(animar);
    };
    animar();

    const redimensionar = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const obs = new ResizeObserver(redimensionar);
    obs.observe(el);

    return () => {
      cancelAnimationFrame(quadro);
      obs.disconnect();
      controles.dispose();
      cena.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mat = m.material as THREE.Material | THREE.Material[];
          (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
        }
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return <div ref={caixa} className="h-[300px] w-full cursor-grab touch-none sm:h-[360px]" role="img" aria-label={`Salão em 3D: ${postos.filter((p) => p.ocupada).length} de ${postos.length} cadeiras ocupadas`} />;
}
