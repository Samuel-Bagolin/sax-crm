import { useState } from "react";
import { Trash2 } from "lucide-react";
import { brl } from "@/lib/format";
import { useServicos } from "@/lib/atendimentos";
import type { ItemTratamento } from "@/lib/pacientes";
import { lazy, Suspense } from "react";
import type { PontoFacial } from "./Rosto3D";
const Rosto3D = lazy(() => import("./Rosto3D"));
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const CORES = ["#4a03a2", "#0ea5e9", "#e11d48", "#16a34a", "#d97706", "#7c3aed"];

/** Mapa facial: cada ponto marcado no rosto 3D vira um item do orçamento (produto, região e unidades). */
export default function PainelFacial({
  rascunho,
  setRascunho,
  onSalvarOrcamento,
}: {
  rascunho: ItemTratamento[];
  setRascunho: (i: ItemTratamento[]) => void;
  onSalvarOrcamento: () => void;
}) {
  const servicos = useServicos();
  const ordem = (u: string | null) => (u === "U" ? 0 : u === "ml" ? 1 : 2);
  const produtos = (servicos.data ?? []).filter((s) => s.ativo && s.unidade).sort((a, b) => ordem(a.unidade) - ordem(b.unidade));
  const doseInicial = (u: string | null | undefined) => (u === "U" ? "4" : u === "ml" ? "0.5" : "1");
  const [produto, setProduto] = useState<string>("");
  const [dose, setDose] = useState("4");
  const [sel, setSel] = useState<number | null>(null);
  const atual = produtos.find((p) => p.id === (produto || produtos[0]?.id));
  const corDe = (sid?: string | null) => CORES[Math.max(0, produtos.findIndex((p) => p.id === sid)) % CORES.length];

  const pontos: PontoFacial[] = rascunho
    .map((i, k) => ({ i, k }))
    .filter(({ i }) => i.ponto)
    .map(({ i, k }) => ({ id: String(k), x: i.ponto![0], y: i.ponto![1], z: i.ponto![2], regiao: i.regiao ?? "", cor: corDe(i.servico_id) }));

  const marcar = (p: { x: number; y: number; z: number; regiao: string }) => {
    if (!atual) return;
    const q = Number(dose.replace(",", ".")) || 1;
    setRascunho([...rascunho, { servico_id: atual.id, descricao: `${atual.nome}, ${p.regiao}`, regiao: p.regiao, ponto: [p.x, p.y, p.z], quantidade: q, unidade: atual.unidade ?? "un", valor_unitario: atual.preco }]);
    setSel(rascunho.length);
  };
  const porRegiao = rascunho.reduce<Record<string, number>>((acc, i) => {
    const chave = `${i.descricao.split(",")[0]} (${i.unidade})`;
    acc[chave] = (acc[chave] ?? 0) + i.quantidade;
    return acc;
  }, {});
  const total = rascunho.reduce((a, i) => a + i.quantidade * i.valor_unitario, 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="h-fit self-start overflow-hidden rounded-xl border bg-gradient-to-b from-[#fbf6f3] to-[#f1e6e0] dark:from-[#221a18] dark:to-[#140f0e]">
        <Suspense fallback={<div className="h-[380px] animate-pulse sm:h-[460px]" />}><Rosto3D pontos={pontos} selecionado={sel != null ? String(sel) : null} onMarcar={marcar} onSelecionar={(id) => setSel(Number(id))} bloqueado={!atual} /></Suspense>
        <p className="border-t bg-card/70 px-3 py-2 text-xs text-muted-foreground">Clique no rosto para marcar o ponto. Arraste para girar. Clique num ponto para editar.</p>
      </div>
      <aside className="grid h-fit gap-4">
        <section className="grid gap-3 rounded-xl border bg-card p-4">
          {!produtos.length ? <p className="text-sm text-muted-foreground">Cadastre em Serviços e link um procedimento com preço por unidade (U, ml ou frasco) para marcar pontos.</p> : (
            <>
              <div className="grid gap-1.5">
                <Label>Produto</Label>
                <div className="flex flex-wrap gap-1.5">
                  {produtos.map((p, i) => (
                    <button key={p.id} type="button" onClick={() => { setProduto(p.id); setDose(doseInicial(p.unidade)); }} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", atual?.id === p.id && "border-primary bg-accent font-semibold")}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: CORES[i % CORES.length] }} /> {p.nome}
                    </button>
                  ))}
                </div>
                {atual && <p className="text-xs text-muted-foreground">{brl(atual.preco)} por {atual.unidade}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-dose">Quantidade por ponto ({atual?.unidade})</Label>
                <Input id="f-dose" inputMode="decimal" className="w-28" value={dose} onChange={(e) => setDose(e.target.value)} />
              </div>
            </>
          )}
        </section>
        <section className="grid gap-2 rounded-xl border bg-card p-4">
          <p className="font-semibold">Pontos marcados ({rascunho.length})</p>
          <ul className="grid max-h-64 gap-1 overflow-y-auto text-sm">
            {rascunho.map((i, k) => (
              <li key={k} className={cn("flex items-center gap-2 rounded px-1.5 py-1", sel === k && "bg-accent")}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: corDe(i.servico_id) }} />
                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setSel(k)}>{i.regiao}</button>
                <Input aria-label="Quantidade" className="h-7 w-16" inputMode="decimal" value={String(i.quantidade)}
                  onChange={(e) => setRascunho(rascunho.map((x, n) => (n === k ? { ...x, quantidade: Number(e.target.value.replace(",", ".")) || 0 } : x)))} />
                <span className="w-11 shrink-0 text-xs text-muted-foreground">{i.unidade}</span>
                <button type="button" onClick={() => { setRascunho(rascunho.filter((_, n) => n !== k)); setSel(null); }} aria-label="Remover ponto" className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
          {Object.keys(porRegiao).length > 0 && (
            <div className="rounded-lg bg-muted/50 p-2 text-xs">
              {Object.entries(porRegiao).map(([k, v]) => <p key={k}>{k}: <b>{Math.round(v * 10) / 10}</b></p>)}
            </div>
          )}
          <p className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><span>{brl(total)}</span></p>
          <Button onClick={onSalvarOrcamento} disabled={!rascunho.length} data-testid="orcamento-criar">Criar orçamento</Button>
        </section>
      </aside>
    </div>
  );
}
