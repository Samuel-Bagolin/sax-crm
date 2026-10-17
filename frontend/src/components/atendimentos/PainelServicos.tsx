import { Minus, Plus, Trash2 } from "lucide-react";
import { brl } from "@/lib/format";
import { useServicos } from "@/lib/atendimentos";
import type { ItemTratamento } from "@/lib/pacientes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Orçamento sem odontograma nem mapa facial (terapias): escolhe os serviços e a quantidade de sessões. */
export default function PainelServicos({ rascunho, setRascunho, onSalvarOrcamento }: { rascunho: ItemTratamento[]; setRascunho: (i: ItemTratamento[]) => void; onSalvarOrcamento: () => void }) {
  const servicos = useServicos();
  const ativos = (servicos.data ?? []).filter((s) => s.ativo);
  const add = (id: string) => {
    const s = ativos.find((x) => x.id === id);
    if (!s) return;
    const ja = rascunho.find((i) => i.servico_id === id);
    setRascunho(ja ? rascunho.map((i) => (i.servico_id === id ? { ...i, quantidade: i.quantidade + 1 } : i))
      : [...rascunho, { servico_id: s.id, descricao: s.nome, quantidade: 1, unidade: "un", valor_unitario: s.preco }]);
  };
  const mudar = (k: number, m: Partial<ItemTratamento>) => setRascunho(rascunho.map((i, j) => (j === k ? { ...i, ...m } : i)));
  const total = rascunho.reduce((a, i) => a + i.quantidade * i.valor_unitario, 0);
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4" data-testid="painel-servicos">
      <div className="flex flex-wrap gap-1.5">
        {ativos.map((s) => (
          <button key={s.id} type="button" onClick={() => add(s.id)} className="rounded-full border px-3 py-1 text-sm hover:bg-muted" data-testid="orc-servico">
            <Plus className="mr-1 inline h-3.5 w-3.5" />{s.nome} <span className="text-muted-foreground">{brl(s.preco)}</span>
          </button>
        ))}
        {!ativos.length && <p className="text-sm text-muted-foreground">Cadastre os serviços em Agenda &gt; Configurar agenda.</p>}
      </div>
      {rascunho.length > 0 && (
        <ul className="grid gap-2">
          {rascunho.map((i, k) => (
            <li key={k} className="grid grid-cols-[1fr_auto_110px_auto] items-center gap-2 text-sm">
              <Input value={i.descricao} onChange={(e) => mudar(k, { descricao: e.target.value })} />
              <span className="flex items-center gap-1">
                <Button type="button" size="icon" variant="ghost" aria-label="Menos" onClick={() => mudar(k, { quantidade: Math.max(1, i.quantidade - 1) })}><Minus className="h-4 w-4" /></Button>
                <span className="w-16 text-center">{i.quantidade} {i.quantidade === 1 ? "sessão" : "sessões"}</span>
                <Button type="button" size="icon" variant="ghost" aria-label="Mais" onClick={() => mudar(k, { quantidade: i.quantidade + 1 })}><Plus className="h-4 w-4" /></Button>
              </span>
              <Input inputMode="decimal" value={String(i.valor_unitario)} onChange={(e) => mudar(k, { valor_unitario: Number(e.target.value.replace(",", ".")) || 0 })} aria-label="Valor por sessão" />
              <Button type="button" size="icon" variant="ghost" aria-label="Remover" onClick={() => setRascunho(rascunho.filter((_, j) => j !== k))}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between border-t pt-3">
        <span className="font-semibold">Total {brl(total)}</span>
        <Button onClick={onSalvarOrcamento} disabled={!rascunho.length} data-testid="orcamento-criar">Criar orçamento</Button>
      </div>
    </div>
  );
}
