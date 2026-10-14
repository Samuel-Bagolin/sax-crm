import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Armchair, Building2, CalendarCheck, Car, Crown, FileCheck2, HeartPulse, MapPin, MessageCircle, Scissors, ShoppingBag, Smile, Sparkles, Syringe, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* Vitrine da tela de login: passa pelos 7 negócios atendidos, um de cada vez, com uma cena
   ilustrativa de cada CRM. Para quando a pessoa passa o mouse (ou pede menos movimento). */

interface Cena {
  chave: string;
  nome: string;
  icone: LucideIcon;
  titulo: string;
  aviso: { icone: LucideIcon; titulo: string; sub: string };
  Tela: () => ReactElement;
}

function Moldura({ children, rotulo }: { children: ReactNode; rotulo: string }) {
  return (
    <div className="w-[min(100%,380px)] overflow-hidden rounded-2xl bg-white text-[#1d1530] shadow-[0_30px_60px_rgba(10,0,30,.45)]">
      <div className="flex items-center justify-between border-b border-[#ece7f5] bg-[#f7f4fc] px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6b5f86]">{rotulo}</span>
        <span className="flex gap-1">{[0, 1, 2].map((i) => <i key={i} className="h-1.5 w-1.5 rounded-full bg-[#d8cfe8]" />)}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function TelaImovel() {
  return (
    <Moldura rotulo="Imóvel AP-0142">
      <div className="flex gap-3">
        <div className="flex h-20 w-24 shrink-0 items-end justify-center rounded-lg bg-gradient-to-b from-[#efe9fb] to-[#e3d8f7]"><Building2 className="mb-2 h-10 w-10 text-[#4a03a2]/70" /></div>
        <div className="min-w-0">
          <p className="font-semibold leading-snug">Apartamento 3 quartos com sacada</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-[#6b5f86]"><MapPin className="h-3 w-3" /> Bairro Centro, 98 m²</p>
          <p className="mt-2 text-lg font-bold text-[#4a03a2]">R$ 890.000</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5 text-center text-[10px] text-[#6b5f86]">
        {["Novo", "Visita", "Proposta", "Contrato"].map((e, i) => (
          <span key={e} className={cn("rounded-md py-1", i <= 2 ? "bg-[#4a03a2] text-white" : "bg-[#f1edf8]")}>{e}</span>
        ))}
      </div>
    </Moldura>
  );
}

function TelaVeiculo() {
  return (
    <Moldura rotulo="Estoque VE-0007">
      <div className="flex gap-3">
        <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#fff1e3] to-[#ffe0c2]"><Car className="h-11 w-11 text-[#c25800]" /></div>
        <div className="min-w-0">
          <p className="font-semibold leading-snug">Jeep Compass Longitude 2023</p>
          <p className="mt-0.5 text-xs text-[#6b5f86]">18.000 km, automático, flex</p>
          <p className="mt-2 text-lg font-bold text-[#4a03a2]">R$ 159.900</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-xs">
        <span className="text-emerald-800">Margem prevista</span>
        <b className="text-emerald-700">R$ 21.450 (13,4%)</b>
      </div>
    </Moldura>
  );
}

// Sorriso de frente: lábios, dentes superiores e inferiores e dois dentes marcados no plano de tratamento.
// Desenho leve em SVG, sem carregar o 3D no login.
const SUPERIORES = [
  { n: 15, w: 13 }, { n: 14, w: 14 }, { n: 13, w: 15 }, { n: 12, w: 16 }, { n: 11, w: 20 },
  { n: 21, w: 20 }, { n: 22, w: 16 }, { n: 23, w: 15 }, { n: 24, w: 14 }, { n: 25, w: 13 },
];
const MARCADOS: Record<number, string> = { 12: "#f59e0b", 22: "#f59e0b" };

function Sorriso() {
  const total = SUPERIORES.reduce((t, d) => t + d.w, 0);
  let x = 130 - total / 2;
  const dentes = SUPERIORES.map((d) => {
    const centro = Math.abs(x + d.w / 2 - 130);
    const fundo = 88 - centro * 0.13; // dentes do fundo sobem acompanhando a curva do sorriso
    const r = { ...d, x, fundo };
    x += d.w;
    return r;
  });
  const boca = "M50,74 C92,62 168,62 210,74 C188,110 72,110 50,74 Z";
  return (
    <svg viewBox="20 28 220 106" className="mx-auto block h-[112px] w-auto" aria-hidden="true">
      <defs>
        <linearGradient id="lab-sup" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e88a98" /><stop offset="1" stopColor="#c95b6d" /></linearGradient>
        <linearGradient id="lab-inf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d8687a" /><stop offset="1" stopColor="#e79aa6" /></linearGradient>
        <linearGradient id="dente" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#eef0f5" /></linearGradient>
        <radialGradient id="interior" cx=".5" cy=".3" r=".7"><stop offset="0" stopColor="#7a2a3a" /><stop offset="1" stopColor="#4a1522" /></radialGradient>
        <clipPath id="clip-boca"><path d={boca} /></clipPath>
      </defs>
      <path d={boca} fill="url(#interior)" />
      <g clipPath="url(#clip-boca)">
        <ellipse cx="130" cy="104" rx="46" ry="14" fill="#c4505f" opacity=".85" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect key={i} x={84 + i * 11.5} y="91" width="11" height="22" rx="4" fill="#f3f3f6" stroke="#dcdfe6" strokeWidth=".8" />
        ))}
        {dentes.map((d) => (
          <g key={d.n}>
            <rect x={d.x + 0.6} y="56" width={d.w - 1.2} height={d.fundo - 56} rx="5" fill={MARCADOS[d.n] ? "#fff4db" : "url(#dente)"} stroke={MARCADOS[d.n] ?? "#dde1e8"} strokeWidth={MARCADOS[d.n] ? 1.6 : 0.9} />
            <rect x={d.x + 3} y="70" width={Math.max(2, d.w - 9)} height="4" rx="2" fill="#fff" opacity=".8" />
          </g>
        ))}
      </g>
      <path d="M30,74 C56,48 96,42 119,52 C125,47 135,47 141,52 C164,42 204,48 230,74 L210,74 C168,62 92,62 50,74 Z" fill="url(#lab-sup)" />
      <path d="M30,74 L50,74 C72,110 188,110 210,74 L230,74 C214,116 174,128 130,128 C86,128 46,116 30,74 Z" fill="url(#lab-inf)" />
      <path d="M96,114 C112,120 148,120 164,114" stroke="#fff" strokeOpacity=".45" strokeWidth="3" fill="none" strokeLinecap="round" />
      {dentes.filter((d) => MARCADOS[d.n]).map((d) => (
        <g key={`tag-${d.n}`}>
          <path d={`M${d.x + d.w / 2},62 L${d.x + d.w / 2},${d.n === 12 ? 40 : 40}`} stroke="#ff7a00" strokeWidth="1.2" strokeDasharray="2 2" />
          <rect x={d.x + d.w / 2 - 11} y="31" width="22" height="13" rx="6.5" fill="#ff7a00" />
          <text x={d.x + d.w / 2} y="40.5" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#fff">{d.n}</text>
        </g>
      ))}
    </svg>
  );
}

function TelaOdonto() {
  return (
    <Moldura rotulo="Odontograma 3D">
      <div className="rounded-xl bg-gradient-to-b from-[#fdf3ef] to-[#f6e7e4] py-1">
        <Sorriso />
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span>Restauração 12 e 22, clareamento</span>
        <b className="text-[#4a03a2]">R$ 1.400</b>
      </div>
    </Moldura>
  );
}

function TelaTerapia() {
  const dias = ["Seg", "Ter", "Qua", "Qui", "Sex"];
  const blocos: [number, number, string][] = [[0, 1, "#c4b5fd"], [1, 0, "#fdba74"], [1, 2, "#c4b5fd"], [2, 1, "#86efac"], [3, 0, "#c4b5fd"], [3, 2, "#fdba74"], [4, 1, "#c4b5fd"]];
  return (
    <Moldura rotulo="Agenda da semana">
      <div className="grid grid-cols-5 gap-1.5">
        {dias.map((d, i) => (
          <div key={d} className="grid gap-1.5">
            <span className="text-center text-[10px] font-semibold text-[#6b5f86]">{d}</span>
            {[0, 1, 2].map((h) => {
              const b = blocos.find(([x, y]) => x === i && y === h);
              return <span key={h} className="h-7 rounded-md" style={{ background: b ? b[2] : "#f4f1f9" }} />;
            })}
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm"><b>Ana Souza</b> toda terça às 18h, por 8 semanas</p>
    </Moldura>
  );
}

function TelaBarbearia() {
  const ocupadas = [true, true, true, false];
  return (
    <Moldura rotulo="Cadeiras agora">
      <div className="flex justify-between gap-2 rounded-xl bg-[#f7f2ec] p-3">
        {ocupadas.map((o, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <Armchair className={cn("h-10 w-10", o ? "text-[#ff7a00]" : "text-[#b8b1c4]")} />
            <span className="text-[10px] text-[#6b5f86]">{o ? "ocupada" : "livre"}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span>Ocupação do dia</span>
        <b className="text-[#4a03a2]">78%</b>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#efe9f7]"><div className="h-full w-[78%] rounded-full bg-[#ff7a00]" /></div>
    </Moldura>
  );
}

function Rosto() {
  // Pontos de aplicação: testa, pés de galinha e bigode chinês.
  const pontos: [number, number][] = [[64, 38], [32, 62], [88, 62], [43, 84], [77, 84]];
  return (
    <svg viewBox="0 0 120 140" className="h-36 w-[118px] shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id="pele" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f6d5c0" /><stop offset="1" stopColor="#ebb89c" /></linearGradient>
        <linearGradient id="cabelo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5b3a2e" /><stop offset="1" stopColor="#3a241c" /></linearGradient>
        <radialGradient id="blush"><stop offset="0" stopColor="#f08f8f" stopOpacity=".55" /><stop offset="1" stopColor="#f08f8f" stopOpacity="0" /></radialGradient>
      </defs>
      <path d="M60 4C30 4 14 26 15 58c1 26 4 52 4 76h82c0-24 3-50 4-76C106 26 90 4 60 4z" fill="url(#cabelo)" />
      <path d="M48 104h24v30H48z" fill="#e7b293" />
      <path d="M36 140c2-16 12-22 24-22s22 6 24 22z" fill="#e7b293" />
      <path d="M60 14c24 0 36 19 36 44 0 30-16 54-36 56-20-2-36-26-36-56 0-25 12-44 36-44z" fill="url(#pele)" />
      <ellipse cx="21.5" cy="62" rx="4" ry="7" fill="#ebb89c" />
      <ellipse cx="98.5" cy="62" rx="4" ry="7" fill="#ebb89c" />
      <path d="M24 46C26 22 42 10 62 10c16 0 30 10 34 30-10-12-24-16-38-12-12 3-22 10-34 18z" fill="url(#cabelo)" />
      <path d="M36 52q8-5 16-1M68 51q8-4 16 1" stroke="#6b4436" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M38 61q6 5 12 0M70 61q6 5 12 0" stroke="#5a3a30" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M39 62l-2 2.5M43.5 63.5l-.6 3M48 62.5l1.4 2.7M71 62.5l-1.4 2.7M75.5 63.5l.6 3M80 62l2 2.5" stroke="#5a3a30" strokeWidth="1" strokeLinecap="round" />
      <path d="M60 64c0 8-2 14-5 17 3 2 7 2 10 0" stroke="#cf9578" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <ellipse cx="40" cy="78" rx="9" ry="6" fill="url(#blush)" />
      <ellipse cx="80" cy="78" rx="9" ry="6" fill="url(#blush)" />
      <path d="M50 92c4-3 7-3 10-1 3-2 6-2 10 1-3 5-7 7-10 7s-7-2-10-7z" fill="#d46f7c" />
      <path d="M50 92c6 1.5 14 1.5 20 0" stroke="#b5525f" strokeWidth="1" fill="none" strokeLinecap="round" />
      {pontos.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="7" fill="#4a03a2" opacity=".18"><animate attributeName="r" values="4;8;4" dur="2.4s" begin={`${i * 0.3}s`} repeatCount="indefinite" /></circle>
          <circle cx={x} cy={y} r="3.6" fill="#4a03a2" stroke="#fff" strokeWidth="1.4" />
        </g>
      ))}
    </svg>
  );
}

function TelaEstetica() {
  return (
    <Moldura rotulo="Mapa facial">
      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-gradient-to-b from-[#f7f1fb] to-[#efe7f7] px-2 pt-2"><Rosto /></div>
        <div className="grid gap-1.5 text-sm">
          <p><b>5 pontos</b> marcados</p>
          <p className="text-[#6b5f86]">Toxina botulínica, 24 U</p>
          <p className="text-lg font-bold text-[#4a03a2]">R$ 432</p>
        </div>
      </div>
    </Moldura>
  );
}

// Pudim no prato: corpo com degradê, calda de caramelo escorrendo e o brilho por cima.
function Pudim() {
  return (
    <svg viewBox="0 0 120 100" className="h-24 w-28 shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id="pudim-corpo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe9a8" /><stop offset="1" stopColor="#f6c867" /></linearGradient>
        <linearGradient id="pudim-calda" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a14a0b" /><stop offset="1" stopColor="#c66a17" /></linearGradient>
      </defs>
      <ellipse cx="60" cy="86" rx="52" ry="10" fill="#ffffff" stroke="#eadfcf" strokeWidth="1.5" />
      <ellipse cx="60" cy="84" rx="40" ry="6" fill="#c66a17" opacity=".55" />
      <path d="M30 82 L38 34 Q60 26 82 34 L90 82 Q60 90 30 82 Z" fill="url(#pudim-corpo)" />
      <path d="M38 34 Q60 26 82 34 Q82 40 79 41 Q78 52 75 52 Q72 52 72 43 Q66 45 62 44 Q61 58 57 58 Q53 58 54 44 Q47 44 45 42 Q44 49 41 49 Q38 49 38.5 40 Z" fill="url(#pudim-calda)" />
      <ellipse cx="60" cy="33" rx="22" ry="5" fill="#8a3c08" />
      <path d="M47 31 Q55 28 63 29" stroke="#fff" strokeOpacity=".55" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M41 60 Q43 70 42 78" stroke="#fff" strokeOpacity=".5" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function TelaComercio() {
  return (
    <Moldura rotulo="Cardápio e WhatsApp">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-gradient-to-b from-[#fff8e8] to-[#fdebc8]"><Pudim /></div>
        <div className="min-w-0">
          <p className="font-semibold leading-snug">Pudim de doce de leite</p>
          <p className="mt-0.5 text-xs text-[#6b5f86]">Inteiro, serve 10 fatias</p>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#25d366] px-2.5 py-1 text-[11px] font-semibold text-white"><MessageCircle className="h-3 w-3" /> Pedir no WhatsApp</span>
        </div>
      </div>
      <div className="mt-3 grid gap-1.5 text-[11px]">
        <p className="ml-auto max-w-[80%] rounded-lg rounded-tr-sm bg-[#dcf8c6] px-2.5 py-1.5">Quero 3 para sábado, para revender no meu café.</p>
        <p className="max-w-[62%] rounded-lg rounded-tl-sm bg-[#f1edf8] px-2.5 py-1.5">Robô: chamei o time de <b>Revenda Curitiba</b>.</p>
      </div>
    </Moldura>
  );
}

const CENAS: Cena[] = [
  { chave: "imobiliaria", nome: "Imobiliária", icone: Building2, titulo: "Do lead do portal ao contrato assinado.", aviso: { icone: CalendarCheck, titulo: "Visita confirmada", sub: "Amanhã, 10:00" }, Tela: TelaImovel },
  { chave: "veiculos", nome: "Veículos", icone: Car, titulo: "Estoque que gira e lead que não esfria.", aviso: { icone: CalendarCheck, titulo: "Test drive marcado", sub: "Sábado, 9:30" }, Tela: TelaVeiculo },
  { chave: "odontologia", nome: "Odontologia", icone: Smile, titulo: "Odontograma 3D que vira orçamento.", aviso: { icone: FileCheck2, titulo: "Orçamento aprovado", sub: "3 parcelas no Financeiro" }, Tela: TelaOdonto },
  { chave: "terapia", nome: "Psicologia e fono", icone: HeartPulse, titulo: "Agenda recorrente e prontuário protegido.", aviso: { icone: CalendarCheck, titulo: "Agendado pelo link", sub: "Sessão com a Juliana" }, Tela: TelaTerapia },
  { chave: "barbearia", nome: "Barbearia", icone: Scissors, titulo: "Cadeira ocupada, assinante que volta.", aviso: { icone: Crown, titulo: "Assinante do clube", sub: "Bruno veio 4 vezes no mês" }, Tela: TelaBarbearia },
  { chave: "comercio", nome: "Restaurante", icone: UtensilsCrossed, titulo: "Cardápio no site, pedido no WhatsApp.", aviso: { icone: ShoppingBag, titulo: "Card no funil de Revenda", sub: "Loja Curitiba, sem digitar nada" }, Tela: TelaComercio },
  { chave: "estetica", nome: "Estética", icone: Sparkles, titulo: "Mapa facial 3D que vira orçamento.", aviso: { icone: Syringe, titulo: "Retorno em 120 dias", sub: "Lembrete agendado" }, Tela: TelaEstetica },
];

export default function LoginVitrine() {
  const [i, setI] = useState(0);
  const [pausa, setPausa] = useState(false);
  useEffect(() => {
    if (pausa || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => setI((x) => (x + 1) % CENAS.length), 4200);
    return () => window.clearTimeout(t);
  }, [i, pausa]);
  const c = CENAS[i];
  return (
    <div className="relative" onMouseEnter={() => setPausa(true)} onMouseLeave={() => setPausa(false)} data-testid="login-vitrine">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Segmentos">
        {CENAS.map((s, k) => (
          <button key={s.chave} type="button" role="tab" aria-selected={k === i} onClick={() => setI(k)}
            className={cn("relative flex items-center gap-1.5 overflow-hidden rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              k === i ? "border-white bg-white text-[#4a03a2]" : "border-white/25 text-white/75 hover:border-white/60 hover:text-white")}>
            <s.icone className="h-3.5 w-3.5" /> {s.nome}
            {k === i && !pausa && <span key={i} className="absolute bottom-0 left-0 h-0.5 bg-[#ff7a00] [animation:encher_4.2s_linear_forwards]" />}
          </button>
        ))}
      </div>
      <p key={`t-${i}`} className="mt-6 font-heading text-xl font-semibold text-white [animation:surgir_.5s_ease]">{c.titulo}</p>
      <div key={`c-${i}`} className="relative mt-5 h-[275px] [animation:surgir_.5s_ease]">
        <c.Tela />
        <div className="absolute bottom-0 right-0 flex items-center gap-2.5 rounded-xl bg-white px-3.5 py-2.5 text-[#1d1530] shadow-xl sm:right-[8%]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fff1e3] text-[#c25800]"><c.aviso.icone className="h-4 w-4" /></span>
          <span><b className="block text-sm leading-tight">{c.aviso.titulo}</b><span className="text-xs text-[#6b5f86]">{c.aviso.sub}</span></span>
        </div>
      </div>
      <style>{"@keyframes surgir{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes encher{from{width:0}to{width:100%}}"}</style>
    </div>
  );
}
