import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, BadgeCheck, FileText, GitBranch, Globe, ListChecks, Plus, Shuffle, Star, Trash2, X, Zap } from "lucide-react";
import AutomacoesConfig from "@/components/crm/AutomacoesConfig";
import PortaisConfig from "@/components/crm/PortaisConfig";
import PlanoUso from "@/components/shared/PlanoUso";
import { usePlano } from "@/lib/diferenciais";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { useCrmConfig, useFunis } from "@/lib/crm";
import type { CrmConfig, Etapa, Funil, ModeloContrato } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Aba = "funis" | "listas" | "distribuicao" | "automacoes" | "portais" | "modelos" | "plano";
type EtapaForm = Omit<Etapa, "id" | "cor"> & { id: string | null; cor: string | null };

function EditorFunil({ funil, onSalvo, onCancelar }: { funil: Funil | null; onSalvo: () => void; onCancelar: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(funil?.nome ?? "");
  const [padrao, setPadrao] = useState(funil?.padrao ?? false);
  const [etapas, setEtapas] = useState<EtapaForm[]>(
    funil?.etapas.map((e) => ({ ...e })) ?? [
      { id: null, nome: "Novo contato", probabilidade: 10, dias_parado: 3, cor: null },
      { id: null, nome: "Em atendimento", probabilidade: 30, dias_parado: 5, cor: null },
      { id: null, nome: "Proposta", probabilidade: 70, dias_parado: 7, cor: null },
    ],
  );
  const mudar = (i: number, campo: keyof EtapaForm, v: unknown) => setEtapas((l) => l.map((e, j) => (j === i ? { ...e, [campo]: v } : e)));
  const mover = (i: number, d: number) =>
    setEtapas((l) => {
      const n = [...l];
      const [x] = n.splice(i, 1);
      n.splice(i + d, 0, x);
      return n;
    });

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome: nome.trim(),
        padrao,
        etapas: etapas.map((e) => ({ id: e.id ?? undefined, nome: e.nome.trim(), probabilidade: Number(e.probabilidade) || 0, dias_parado: e.dias_parado ? Number(e.dias_parado) : null })),
      };
      return funil ? apiPut<Funil>(`/funis/${funil.id}`, corpo) : apiPost<Funil>("/funis", corpo);
    },
    onSuccess: () => {
      toast.success("Funil salvo");
      qc.invalidateQueries({ queryKey: ["funis"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      onSalvo();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar o funil"),
  });

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="fn-nome">Nome do funil</Label>
          <Input id="fn-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Lançamentos, Captação" />
        </div>
        <label className="flex h-8 items-center gap-2 text-sm">
          <Checkbox checked={padrao} onCheckedChange={(v) => setPadrao(!!v)} /> Funil padrão
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-16 pb-2 font-medium">Ordem</th>
              <th className="pb-2 font-medium">Etapa</th>
              <th className="w-32 pb-2 font-medium" title="Chance de fechar quando o negócio está nesta etapa">
                Probabilidade
              </th>
              <th className="w-36 pb-2 font-medium" title="Destaca o negócio em vermelho após N dias parado">
                Alerta de parado
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {etapas.map((e, i) => (
              <tr key={i} className="border-t">
                <td className="py-1.5">
                  <div className="flex">
                    <Button type="button" variant="ghost" size="icon-xs" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir">
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-xs" disabled={i === etapas.length - 1} onClick={() => mover(i, 1)} aria-label="Descer">
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
                <td className="py-1.5 pr-2">
                  <Input value={e.nome} onChange={(ev) => mudar(i, "nome", ev.target.value)} aria-label={`Nome da etapa ${i + 1}`} />
                </td>
                <td className="py-1.5 pr-2">
                  <div className="flex items-center gap-1">
                    <Input type="number" min={0} max={100} value={e.probabilidade} onChange={(ev) => mudar(i, "probabilidade", ev.target.value)} className="w-20" aria-label="Probabilidade" />%
                  </div>
                </td>
                <td className="py-1.5 pr-2">
                  <div className="flex items-center gap-1">
                    <Input type="number" min={1} max={365} value={e.dias_parado ?? ""} onChange={(ev) => mudar(i, "dias_parado", ev.target.value || null)} className="w-20" placeholder="—" aria-label="Dias para alerta" />
                    dias
                  </div>
                </td>
                <td>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={etapas.length <= 1} onClick={() => setEtapas((l) => l.filter((_, j) => j !== i))} aria-label="Remover etapa">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={etapas.length >= 20}
        onClick={() => setEtapas((l) => [...l, { id: null, nome: "Nova etapa", probabilidade: Math.min(95, (l.at(-1)?.probabilidade ?? 0) + 10), dias_parado: 7, cor: null }])}
      >
        <Plus className="h-3.5 w-3.5" /> Etapa
      </Button>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !nome.trim() || etapas.some((e) => !e.nome.trim())} data-testid="funil-salvar">
          Salvar funil
        </Button>
      </div>
    </div>
  );
}

function ListaEditavel({ titulo, descricao, itens, onChange }: { titulo: string; descricao: string; itens: string[]; onChange: (v: string[]) => void }) {
  const [novo, setNovo] = useState("");
  const adicionar = () => {
    const t = novo.trim();
    if (t && !itens.some((i) => i.toLowerCase() === t.toLowerCase())) onChange([...itens, t]);
    setNovo("");
  };
  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{descricao}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {itens.map((i) => (
          <span key={i} className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs">
            {i}
            <button onClick={() => onChange(itens.filter((x) => x !== i))} className="rounded-full p-0.5 hover:bg-muted" aria-label={`Remover ${i}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          adicionar();
        }}
      >
        <Input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Adicionar" className="h-8" />
        <Button type="submit" size="sm" variant="outline" className="h-8">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </form>
    </section>
  );
}

function Modelos() {
  const qc = useQueryClient();
  const { data: modelos = [] } = useQuery({ queryKey: ["modelos-contrato"], queryFn: () => apiGet<ModeloContrato[]>("/modelos-contrato") });
  const { data: variaveis = [] } = useQuery({ queryKey: ["modelos-variaveis"], queryFn: () => apiGet<{ chave: string; descricao: string }[]>("/modelos-contrato/variaveis") });
  const [sel, setSel] = useState<ModeloContrato | "novo" | null>(null);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<ModeloContrato["tipo"]>("venda");
  const [texto, setTexto] = useState("");
  const area = typeof document !== "undefined" ? (document.getElementById("modelo-texto") as HTMLTextAreaElement | null) : null;

  useEffect(() => {
    if (sel === "novo") {
      setNome("");
      setTipo("outro");
      setTexto("# TÍTULO DO CONTRATO\n\nContrato nº {{contrato_numero}}\n\n## 1. Das partes\n\n");
    } else if (sel) {
      setNome(sel.nome);
      setTipo(sel.tipo);
      setTexto(sel.texto);
    }
  }, [sel]);

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { nome: nome.trim(), tipo, texto };
      return sel === "novo" ? apiPost<ModeloContrato>("/modelos-contrato", corpo) : apiPut<ModeloContrato>(`/modelos-contrato/${(sel as ModeloContrato).id}`, corpo);
    },
    onSuccess: (m) => {
      toast.success("Modelo salvo");
      qc.invalidateQueries({ queryKey: ["modelos-contrato"] });
      setSel(m);
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => apiDelete(`/modelos-contrato/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modelos-contrato"] });
      setSel(null);
    },
  });

  const inserir = (chave: string) => {
    const marca = `{{${chave}}}`;
    if (area) {
      const ini = area.selectionStart ?? texto.length;
      const fim = area.selectionEnd ?? texto.length;
      setTexto(texto.slice(0, ini) + marca + texto.slice(fim));
      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(ini + marca.length, ini + marca.length);
      });
    } else setTexto(texto + marca);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="space-y-1.5">
        {modelos.map((m) => (
          <button
            key={m.id}
            onClick={() => setSel(m)}
            className={cn("flex w-full items-center gap-2 rounded-md border bg-card px-3 py-2 text-left text-sm", sel !== "novo" && sel?.id === m.id ? "border-primary" : "hover:bg-muted/50")}
          >
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 truncate">{m.nome}</span>
          </button>
        ))}
        <Button variant="outline" size="sm" className="w-full" onClick={() => setSel("novo")}>
          <Plus className="h-3.5 w-3.5" /> Modelo
        </Button>
      </div>
      {sel ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="md-nome">Nome</Label>
              <Input id="md-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="md-tipo">Uso</Label>
              <select id="md-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as ModeloContrato["tipo"])} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
                <option value="venda">Venda</option>
                <option value="locacao">Locação</option>
                <option value="outro">Geral</option>
              </select>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Clique para inserir um campo que será preenchido com os dados do contrato:</p>
            <div className="flex flex-wrap gap-1">
              {variaveis.map((v) => (
                <button key={v.chave} type="button" onClick={() => inserir(v.chave)} className="rounded-sm border bg-muted/40 px-1.5 py-0.5 text-[11px] hover:border-primary hover:text-primary" title={`{{${v.chave}}}`}>
                  {v.descricao}
                </button>
              ))}
            </div>
          </div>
          <Textarea id="modelo-texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={22} className="font-mono text-xs leading-relaxed" />
          <p className="text-xs text-muted-foreground">Use “# ” para o título e “## ” para seções. Linha em branco separa parágrafos.</p>
          <div className="flex justify-between gap-2">
            {sel !== "novo" ? (
              <Button variant="ghost" className="text-destructive" onClick={() => excluir.mutate(sel.id)}>
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || nome.trim().length < 2 || texto.trim().length < 20}>
              Salvar modelo
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-lg border border-dashed p-10 text-sm text-muted-foreground">Escolha um modelo para editar.</div>
      )}
    </div>
  );
}

export default function CrmConfig() {
  const qc = useQueryClient();
  const [aba, setAba] = useState<Aba>(() => (new URLSearchParams(window.location.search).get("aba") as Aba) || "funis");
  const { tem } = usePlano();
  const { data: funis = [] } = useFunis();
  const { data: config } = useCrmConfig();
  const [editando, setEditando] = useState<Funil | "novo" | null>(null);

  const salvarConfig = useMutation({
    mutationFn: (parcial: Partial<CrmConfig>) => apiPut<CrmConfig>("/crm/config", parcial),
    onSuccess: (c) => {
      qc.setQueryData(["crm-config"], c);
      toast.success("Configuração salva");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  const excluirFunil = useMutation({
    mutationFn: (id: string) => apiDelete(`/funis/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funis"] });
      toast.success("Funil excluído");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir"),
  });

  const abas: { v: Aba; rotulo: string; icone: typeof GitBranch }[] = [
    { v: "funis", rotulo: "Funis e etapas", icone: GitBranch },
    { v: "listas", rotulo: "Origens, motivos e etiquetas", icone: ListChecks },
    { v: "distribuicao", rotulo: "Distribuição de leads", icone: Shuffle },
    ...(tem("automacoes") ? [{ v: "automacoes" as Aba, rotulo: "Automações e SLA", icone: Zap }] : []),
    { v: "portais", rotulo: "Portais", icone: Globe },
    { v: "modelos", rotulo: "Modelos de contrato", icone: FileText },
    { v: "plano", rotulo: "Plano", icone: BadgeCheck },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 border-b">
        {abas.map((a) => (
          <button
            key={a.v}
            onClick={() => setAba(a.v)}
            className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm", aba === a.v ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            <a.icone className="h-4 w-4" />
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === "funis" &&
        (editando ? (
          <EditorFunil key={editando === "novo" ? "novo" : editando.id} funil={editando === "novo" ? null : editando} onSalvo={() => setEditando(null)} onCancelar={() => setEditando(null)} />
        ) : (
          <div className="space-y-3">
            {funis.map((f) => (
              <article key={f.id} className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="font-semibold">{f.nome}</h3>
                  {f.padrao && (
                    <span className="flex items-center gap-1 rounded-full bg-latao/15 px-2 text-xs">
                      <Star className="h-3 w-3" /> Padrão
                    </span>
                  )}
                  <div className="ml-auto flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => setEditando(f)}>
                      Editar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => excluirFunil.mutate(f.id)} aria-label={`Excluir funil ${f.nome}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex overflow-x-auto">
                  {f.etapas.map((e) => (
                    <div key={e.id} className="etapa-seta -ml-1 min-w-[130px] flex-1 bg-muted px-5 py-2 first:ml-0">
                      <p className="truncate text-xs font-medium">{e.nome}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {e.probabilidade}%{e.dias_parado ? `, alerta em ${e.dias_parado}d` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
            <Button variant="outline" onClick={() => setEditando("novo")}>
              <Plus className="h-4 w-4" /> Novo funil
            </Button>
          </div>
        ))}

      {aba === "listas" && config && (
        <div className="grid gap-4 lg:grid-cols-3">
          <ListaEditavel titulo="Origens de lead" descricao="De onde vêm os contatos. Alimenta o relatório de canais." itens={config.origens} onChange={(v) => salvarConfig.mutate({ origens: v })} />
          <ListaEditavel titulo="Motivos de perda" descricao="Escolhidos ao marcar um negócio como perdido." itens={config.motivos_perda} onChange={(v) => salvarConfig.mutate({ motivos_perda: v })} />
          <ListaEditavel titulo="Etiquetas" descricao="Marcadores rápidos nos cards do funil." itens={config.etiquetas} onChange={(v) => salvarConfig.mutate({ etiquetas: v })} />
          <label className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm lg:col-span-3">
            <Checkbox checked={config.exige_motivo_perda} onCheckedChange={(v) => salvarConfig.mutate({ exige_motivo_perda: !!v })} />
            Exigir motivo ao marcar negócio como perdido
          </label>
        </div>
      )}

      {aba === "distribuicao" && config && (
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          {(
            [
              ["manual", "Triagem do gestor", "Leads novos sem responsável ficam na caixa de entrada para o gestor distribuir."],
              ["rodizio", "Rodízio automático", "Cada lead novo (site, formulário ou cadastro) vai para o corretor ativo com menos leads."],
            ] as const
          ).map(([v, t, d]) => (
            <button
              key={v}
              onClick={() => salvarConfig.mutate({ distribuicao: v })}
              className={cn("rounded-lg border bg-card p-4 text-left", config.distribuicao === v ? "border-primary ring-2 ring-primary/20" : "hover:border-ring/50")}
            >
              <p className="font-semibold">{t}</p>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </button>
          ))}
        </div>
      )}

      {aba === "automacoes" && <AutomacoesConfig />}
      {aba === "portais" && <PortaisConfig />}
      {aba === "modelos" && <Modelos />}
      {aba === "plano" && <PlanoUso />}
    </div>
  );
}
