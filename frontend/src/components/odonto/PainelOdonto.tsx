import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";
import { apiPut, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { useServicos } from "@/lib/atendimentos";
import type { DenteFicha, ItemTratamento } from "@/lib/pacientes";
import { lazy, Suspense } from "react";
import { ESTADOS_DENTE, QUADRANTES, type EstadoDente } from "./odontoDados";
const Odontograma3D = lazy(() => import("./Odontograma3D"));
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const FACES = [
  { f: "V", nome: "Vestibular" },
  { f: "L", nome: "Lingual / palatina" },
  { f: "M", nome: "Mesial" },
  { f: "D", nome: "Distal" },
  { f: "O", nome: "Oclusal / incisal" },
];

/** Diagrama clássico das 5 faces: clique numa face para marcar a situação escolhida. */
function Faces({ faces, onClick }: { faces: Record<string, EstadoDente>; onClick: (f: string) => void }) {
  const cor = (f: string) => ESTADOS_DENTE[faces[f] ?? "higido"].cor;
  return (
    <svg viewBox="0 0 120 120" className="h-32 w-32" role="group" aria-label="Faces do dente">
      <polygon points="10,10 110,10 85,35 35,35" fill={cor("V")} stroke="#64748b" onClick={() => onClick("V")} className="cursor-pointer"><title>Vestibular</title></polygon>
      <polygon points="35,85 85,85 110,110 10,110" fill={cor("L")} stroke="#64748b" onClick={() => onClick("L")} className="cursor-pointer"><title>Lingual</title></polygon>
      <polygon points="10,10 35,35 35,85 10,110" fill={cor("M")} stroke="#64748b" onClick={() => onClick("M")} className="cursor-pointer"><title>Mesial</title></polygon>
      <polygon points="110,10 110,110 85,85 85,35" fill={cor("D")} stroke="#64748b" onClick={() => onClick("D")} className="cursor-pointer"><title>Distal</title></polygon>
      <rect x="35" y="35" width="50" height="50" fill={cor("O")} stroke="#64748b" onClick={() => onClick("O")} className="cursor-pointer"><title>Oclusal</title></rect>
      {[["V", 60, 25], ["L", 60, 101], ["M", 22, 64], ["D", 98, 64], ["O", 60, 64]].map(([t, x, y]) => (
        <text key={t as string} x={x as number} y={y as number} textAnchor="middle" fontSize="11" fill="#1f2937" pointerEvents="none">{t}</text>
      ))}
    </svg>
  );
}

export default function PainelOdonto({
  pacienteId,
  odontograma,
  rascunho,
  setRascunho,
  onSalvarOrcamento,
}: {
  pacienteId: string;
  odontograma: Record<string, DenteFicha>;
  rascunho: ItemTratamento[];
  setRascunho: (i: ItemTratamento[]) => void;
  onSalvarOrcamento: () => void;
}) {
  const qc = useQueryClient();
  const servicos = useServicos();
  const [dente, setDente] = useState<string | null>(null);
  const [pincel, setPincel] = useState<EstadoDente>("carie");
  const atual = dente ? odontograma[dente] : undefined;
  const [faces, setFaces] = useState<Record<string, EstadoDente>>({});
  const [estado, setEstado] = useState<EstadoDente>("higido");
  const [proc, setProc] = useState("");

  const escolher = (d: string) => {
    setDente(d);
    setFaces(odontograma[d]?.faces ?? {});
    setEstado(odontograma[d]?.estado ?? "higido");
    setProc("");
  };
  const estados = useMemo(() => Object.fromEntries(Object.entries(odontograma).map(([k, v]) => [k, v.estado])), [odontograma]);
  const planejados = rascunho.map((i) => i.dente).filter(Boolean) as string[];

  const salvar = useMutation({
    mutationFn: () => apiPut(`/pacientes/${pacienteId}/odontograma/${dente}`, { estado, faces, nota: atual?.nota ?? null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ficha", pacienteId] }); toast.success(`Dente ${dente} salvo`); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });

  const procedimentos = (servicos.data ?? []).filter((s) => s.ativo && s.preco >= 0);
  const adicionar = () => {
    const s = procedimentos.find((x) => x.id === proc);
    if (!s || !dente) return;
    const fs = Object.keys(faces).filter((f) => faces[f] !== "higido");
    setRascunho([...rascunho, { servico_id: s.id, descricao: s.nome, dente, faces: fs, quantidade: 1, unidade: "un", valor_unitario: s.preco }]);
    toast.success(`${s.nome} no dente ${dente} entrou no orçamento`);
  };

  const total = rascunho.reduce((a, i) => a + i.quantidade * i.valor_unitario, 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="grid gap-3">
        <div className="overflow-hidden rounded-xl border bg-gradient-to-b from-[#faf7fd] to-[#efe9f7] dark:from-[#1b1530] dark:to-[#120d22]">
          <Suspense fallback={<div className="h-[340px] animate-pulse sm:h-[400px]" />}><Odontograma3D estados={estados} selecionado={dente} onSelecionar={escolher} planejados={planejados} /></Suspense>
        </div>
        {/* Grade FDI: escolha pelo teclado e visão rápida do mapa */}
        <div className="grid gap-1 overflow-x-auto rounded-xl border bg-card p-3" aria-label="Dentes pela numeração FDI">
          {(["sup", "inf"] as const).map((arc) => (
            <div key={arc} className="flex min-w-max justify-center gap-1">
              {QUADRANTES[arc].flat().map((n, i) => {
                const est = estados[String(n)] ?? "higido";
                return (
                  <button key={n} type="button" onClick={() => escolher(String(n))} aria-pressed={dente === String(n)}
                    className={cn("flex h-9 w-8 flex-col items-center justify-center rounded-md border text-[11px] font-semibold", i === 8 && "ml-3", dente === String(n) && "ring-2 ring-[#ff7a00]")}
                    style={{ background: ESTADOS_DENTE[est].cor, color: ["higido", "ausente", "implante", "selante", "coroa"].includes(est) ? "#1f2937" : "#fff" }}
                    title={`${n}: ${ESTADOS_DENTE[est].rotulo}`} data-testid={`dente-${n}`}>
                    {n}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {Object.entries(ESTADOS_DENTE).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border" style={{ background: v.cor }} />{v.rotulo}</span>
            ))}
          </div>
        </div>
      </div>

      <aside className="grid h-fit gap-4">
        <section className="grid gap-3 rounded-xl border bg-card p-4">
          {!dente ? <p className="text-sm text-muted-foreground">Clique num dente no modelo 3D ou na grade para registrar a situação e orçar.</p> : (
            <>
              <p className="text-lg font-bold">Dente {dente}</p>
              <div className="grid gap-1.5">
                <Label htmlFor="o-estado">Situação do dente</Label>
                <select id="o-estado" className="h-9 rounded-lg border bg-transparent px-2 text-sm" value={estado} onChange={(e) => setEstado(e.target.value as EstadoDente)} data-testid="dente-estado">
                  {Object.entries(ESTADOS_DENTE).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
                </select>
              </div>
              <div className="flex items-start gap-3">
                <Faces faces={faces} onClick={(f) => setFaces({ ...faces, [f]: faces[f] === pincel ? "higido" : pincel })} />
                <div className="grid gap-1 text-xs">
                  <Label className="text-xs">Marcar faces como</Label>
                  {(["carie", "restaurado", "selante", "fratura"] as EstadoDente[]).map((e) => (
                    <button key={e} type="button" onClick={() => setPincel(e)} className={cn("flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left", pincel === e && "bg-muted font-semibold")}>
                      <span className="h-3 w-3 rounded-sm" style={{ background: ESTADOS_DENTE[e].cor }} /> {ESTADOS_DENTE[e].rotulo}
                    </button>
                  ))}
                  <p className="mt-1 text-muted-foreground">{FACES.filter((x) => faces[x.f] && faces[x.f] !== "higido").map((x) => x.nome).join(", ") || "Nenhuma face marcada"}</p>
                </div>
              </div>
              <Button variant="outline" onClick={() => salvar.mutate()} disabled={salvar.isPending} data-testid="dente-salvar"><Save className="h-4 w-4" /> Salvar no odontograma</Button>
              <div className="grid gap-1.5 border-t pt-3">
                <Label htmlFor="o-proc">Orçar procedimento neste dente</Label>
                <div className="flex gap-2">
                  <select id="o-proc" className="h-9 min-w-0 flex-1 rounded-lg border bg-transparent px-2 text-sm" value={proc} onChange={(e) => setProc(e.target.value)} data-testid="dente-proc">
                    <option value="">Escolha</option>
                    {procedimentos.map((s) => <option key={s.id} value={s.id}>{s.nome} ({brl(s.preco)})</option>)}
                  </select>
                  <Button onClick={adicionar} disabled={!proc} data-testid="dente-orcar"><Plus className="h-4 w-4" /></Button>
                </div>
              </div>
            </>
          )}
        </section>
        <section className="grid gap-2 rounded-xl border bg-card p-4">
          <p className="font-semibold">Orçamento em montagem</p>
          {!rascunho.length ? <p className="text-sm text-muted-foreground">Nenhum procedimento ainda.</p> : (
            <ul className="grid gap-1 text-sm">
              {rascunho.map((i, k) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{i.dente && <b>{i.dente} </b>}{i.descricao}{i.faces?.length ? ` (${i.faces.join("")})` : ""}</span>
                  <span className="flex shrink-0 items-center gap-1">{brl(i.valor_unitario)}
                    <button type="button" onClick={() => setRascunho(rascunho.filter((_, n) => n !== k))} className="text-muted-foreground hover:text-destructive" aria-label="Remover">×</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><span>{brl(total)}</span></p>
          <Button onClick={onSalvarOrcamento} disabled={!rascunho.length} data-testid="orcamento-criar">Criar orçamento</Button>
        </section>
      </aside>
    </div>
  );
}
