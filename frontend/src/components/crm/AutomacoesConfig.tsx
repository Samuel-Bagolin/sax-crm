import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { apiPut, detalheErro } from "@/lib/api";
import { ATIVIDADE, TIPOS_ATIVIDADE, useCrmConfig, useFunis } from "@/lib/crm";
import type { Automacao, CrmConfig, GatilhoAutomacao, TipoAtividade } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const GATILHOS: { v: GatilhoAutomacao; rotulo: string; ajuda: string }[] = [
  { v: "lead_novo", rotulo: "Chegou um lead novo", ajuda: "Site, portais, formulário ou cadastro manual." },
  { v: "entrou_etapa", rotulo: "Negócio entrou na etapa", ajuda: "Ao arrastar no funil ou ao registrar uma proposta." },
  { v: "negocio_parado", rotulo: "Negócio parado", ajuda: "Passou do limite de dias da etapa e não tem atividade pendente. Verificado a cada 10 minutos." },
  { v: "negocio_ganho", rotulo: "Negócio ganho", ajuda: "Ótimo para pós-venda e pedido de indicação." },
  { v: "negocio_perdido", rotulo: "Negócio perdido", ajuda: "Para tentar recuperar o cliente mais à frente." },
];

function novaRegra(): Automacao {
  return { id: crypto.randomUUID(), nome: "", ativo: true, gatilho: "entrou_etapa", funil_id: null, etapa_id: null, tipo_atividade: "ligacao", assunto: "", prazo_dias: 1, notas: null };
}

export default function AutomacoesConfig() {
  const qc = useQueryClient();
  const { data: config } = useCrmConfig();
  const { data: funis = [] } = useFunis();
  const [editando, setEditando] = useState<Automacao | null>(null);
  const [sla, setSla] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: (parcial: Partial<CrmConfig> & { sem_sla?: boolean }) => apiPut<CrmConfig>("/crm/config", parcial),
    onSuccess: (c) => {
      qc.setQueryData(["crm-config"], c);
      setEditando(null);
      toast.success("Automações salvas");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  if (!config) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;

  const regras = config.automacoes;
  const gravar = (lista: Automacao[]) => salvar.mutate({ automacoes: lista });
  const etapaNome = (a: Automacao) => {
    for (const f of funis) {
      const e = f.etapas.find((x) => x.id === a.etapa_id);
      if (e) return `${e.nome} (${f.nome})`;
    }
    return "etapa removida";
  };
  const descricao = (a: Automacao) => {
    const g = GATILHOS.find((x) => x.v === a.gatilho)!;
    const quando = a.gatilho === "entrou_etapa" ? `Entrou em ${etapaNome(a)}` : g.rotulo;
    const funil = a.funil_id && a.gatilho !== "entrou_etapa" ? ` no funil ${funis.find((f) => f.id === a.funil_id)?.nome ?? ""}` : "";
    const prazo = a.prazo_dias === 0 ? (a.gatilho === "lead_novo" && config.sla_primeiro_contato_min ? "dentro do SLA" : "no mesmo dia") : `em ${a.prazo_dias} dia${a.prazo_dias > 1 ? "s" : ""}`;
    return `${quando}${funil} → ${ATIVIDADE[a.tipo_atividade]?.label ?? "Atividade"} “${a.assunto}” ${prazo}`;
  };
  const slaAtual = sla ?? String(config.sla_primeiro_contato_min ?? "");

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <section className="rounded-lg border bg-card">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Zap className="h-4 w-4 text-sax" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold">Automações de follow-up</h3>
            <p className="text-xs text-muted-foreground">Cada regra cria uma atividade para o responsável. Nada é enviado ao cliente sem o corretor.</p>
          </div>
          <Button size="sm" onClick={() => setEditando(novaRegra())}>
            <Plus className="h-3.5 w-3.5" /> Nova regra
          </Button>
        </header>
        <ul className="divide-y">
          {regras.map((a) => {
            const Icone = ATIVIDADE[a.tipo_atividade]?.icon ?? Zap;
            return (
              <li key={a.id} className={cn("flex items-center gap-3 px-4 py-3", !a.ativo && "opacity-55")}>
                <Checkbox checked={a.ativo} onCheckedChange={(v) => gravar(regras.map((x) => (x.id === a.id ? { ...x, ativo: !!v } : x)))} aria-label={`Ativar ${a.nome}`} />
                <Icone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">{descricao(a)}</p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setEditando(a)} aria-label={`Editar ${a.nome}`}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => gravar(regras.filter((x) => x.id !== a.id))} aria-label={`Excluir ${a.nome}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
          {!regras.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma automação. Comece pelo primeiro contato com lead novo.</li>}
        </ul>
      </section>

      <section className="h-fit rounded-lg border bg-card p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Clock className="h-4 w-4 text-muted-foreground" /> SLA do primeiro atendimento
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Tempo máximo entre o lead chegar e alguém falar com ele. Lead respondido nos primeiros minutos converte muito mais. A caixa de entrada mostra a contagem regressiva e o relatório mostra o % dentro do prazo.
        </p>
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="sla-min">Minutos</Label>
            <Input id="sla-min" inputMode="numeric" value={slaAtual} onChange={(e) => setSla(e.target.value.replace(/\D/g, ""))} placeholder="sem SLA" />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              const n = Number(slaAtual);
              salvar.mutate(n > 0 ? { sla_primeiro_contato_min: n } : { sem_sla: true });
              setSla(null);
            }}
          >
            Salvar
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {[5, 15, 30, 60].map((m) => (
            <button key={m} type="button" onClick={() => setSla(String(m))} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">
              {m} min
            </button>
          ))}
        </div>
      </section>

      <Dialog open={!!editando} onOpenChange={(v) => !v && setEditando(null)}>
        {editando && (
          <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{regras.some((r) => r.id === editando.id) ? "Editar automação" : "Nova automação"}</DialogTitle>
              <DialogDescription>Quando acontecer, o CRM cria a atividade na agenda do responsável.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="au-nome">Nome</Label>
                <Input id="au-nome" value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} placeholder="Ex.: Follow-up da proposta" />
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Quando</span>
                <div className="grid gap-1.5">
                  {GATILHOS.map((g) => (
                    <button
                      key={g.v}
                      type="button"
                      onClick={() => setEditando({ ...editando, gatilho: g.v })}
                      className={cn("rounded-md border px-3 py-2 text-left", editando.gatilho === g.v ? "border-primary bg-primary/5" : "hover:bg-muted")}
                    >
                      <p className="text-sm font-medium">{g.rotulo}</p>
                      <p className="text-xs text-muted-foreground">{g.ajuda}</p>
                    </button>
                  ))}
                </div>
              </div>
              {editando.gatilho !== "lead_novo" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="au-funil">Funil</Label>
                    <select
                      id="au-funil"
                      value={editando.funil_id ?? ""}
                      onChange={(e) => setEditando({ ...editando, funil_id: e.target.value || null, etapa_id: null })}
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">Qualquer funil</option>
                      {funis.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                  {editando.gatilho === "entrou_etapa" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="au-etapa">Etapa</Label>
                      <select
                        id="au-etapa"
                        value={editando.etapa_id ?? ""}
                        onChange={(e) => setEditando({ ...editando, etapa_id: e.target.value || null })}
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      >
                        <option value="">Escolha…</option>
                        {funis
                          .filter((f) => !editando.funil_id || f.id === editando.funil_id)
                          .flatMap((f) => f.etapas.map((e) => ({ f, e })))
                          .map(({ f, e }) => (
                            <option key={e.id} value={e.id}>
                              {e.nome}
                              {editando.funil_id ? "" : ` (${f.nome})`}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Criar a atividade</span>
                <div className="flex flex-wrap gap-1.5">
                  {TIPOS_ATIVIDADE.map((t) => (
                    <button
                      key={t.tipo}
                      type="button"
                      onClick={() => setEditando({ ...editando, tipo_atividade: t.tipo as TipoAtividade })}
                      className={cn("flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs", editando.tipo_atividade === t.tipo ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}
                    >
                      <t.icon className="h-3.5 w-3.5" /> {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                <div className="space-y-1.5">
                  <Label htmlFor="au-assunto">Assunto</Label>
                  <Input id="au-assunto" value={editando.assunto} onChange={(e) => setEditando({ ...editando, assunto: e.target.value })} placeholder="Ligar para saber o que achou da proposta" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="au-prazo">Prazo (dias)</Label>
                  <Input id="au-prazo" inputMode="numeric" value={editando.prazo_dias} onChange={(e) => setEditando({ ...editando, prazo_dias: Math.min(365, Number(e.target.value.replace(/\D/g, "")) || 0) })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="au-notas">Roteiro para o corretor (opcional)</Label>
                <Textarea id="au-notas" rows={2} value={editando.notas ?? ""} onChange={(e) => setEditando({ ...editando, notas: e.target.value || null })} placeholder="O que falar, que documento pedir…" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
              <Button
                disabled={!editando.nome.trim() || !editando.assunto.trim() || (editando.gatilho === "entrou_etapa" && !editando.etapa_id) || salvar.isPending}
                onClick={() => {
                  const regra = { ...editando, nome: editando.nome.trim(), assunto: editando.assunto.trim(), funil_id: editando.gatilho === "lead_novo" ? null : editando.funil_id };
                  gravar(regras.some((r) => r.id === regra.id) ? regras.map((r) => (r.id === regra.id ? regra : r)) : [...regras, regra]);
                }}
              >
                Salvar regra
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
