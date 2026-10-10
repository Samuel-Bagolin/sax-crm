import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Armchair, Building2, CalendarCheck, Car, Crown, FileCheck2, HeartPulse, MapPin, Scissors, Smile, Sparkles, Syringe, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* Vitrine da tela de login: passa pelos 6 negócios atendidos, um de cada vez, com uma cena
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

const ESTADOS = ["#f1ece0", "#ef4444", "#3b82f6", "#f1ece0", "#8b5cf6", "#f1ece0", "#f1ece0", "#eab308"];
function TelaOdonto() {
  const dente = (i: number, sup: boolean) => {
    const cor = ESTADOS[(i * (sup ? 3 : 5)) % ESTADOS.length];
    return <span key={`${sup}-${i}`} className="h-6 flex-1 rounded-[5px] border border-[#ddd5c4]" style={{ background: cor }} />;
  };
  return (
    <Moldura rotulo="Odontograma">
      <div className="rounded-xl bg-gradient-to-b from-[#fbe9ec] to-[#f6dbe0] p-3">
        <div className="flex gap-[3px]">{Array.from({ length: 16 }, (_, i) => dente(i, true))}</div>
        <div className="my-2 h-px bg-[#e7b9c2]" />
        <div className="flex gap-[3px]">{Array.from({ length: 16 }, (_, i) => dente(i, false))}</div>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span>Restauração 16, canal 36</span>
        <b className="text-[#4a03a2]">R$ 1.150</b>
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

function TelaEstetica() {
  const pontos = [[60, 30], [44, 46], [76, 46], [50, 82], [70, 82]];
  return (
    <Moldura rotulo="Mapa facial">
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 120 130" className="h-32 w-28 shrink-0">
          <defs><linearGradient id="pele" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f3c9ad" /><stop offset="1" stopColor="#e2ab8c" /></linearGradient></defs>
          <path d="M60 6c26 0 40 22 38 50-2 30-18 64-38 66C40 120 24 86 22 56 20 28 34 6 60 6z" fill="url(#pele)" />
          <path d="M40 50q8-6 16 0M64 50q8-6 16 0" stroke="#8a5a45" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M48 92q12 8 24 0" stroke="#b5655a" strokeWidth="3" fill="none" strokeLinecap="round" />
          {pontos.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4.5" fill="#4a03a2" stroke="#fff" strokeWidth="1.5" />)}
        </svg>
        <div className="grid gap-1.5 text-sm">
          <p><b>5 pontos</b> marcados</p>
          <p className="text-[#6b5f86]">Toxina botulínica, 24 U</p>
          <p className="text-lg font-bold text-[#4a03a2]">R$ 432</p>
        </div>
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
