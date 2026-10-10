import { useSegmento } from "@/lib/segmento";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { apiDelete, apiPatch, detalheErro } from "@/lib/api";
import { brl, dataBR } from "@/lib/format";
import { TRANSACAO_TIPO } from "@/lib/constants";
import type {
  Imovel,
  PlanoConta,
  ResumoFinanceiro,
  TransacaoFinanceira,
  TransacaoTipo,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import TransactionModal from "@/components/financeiro/TransactionModal";
import { cn } from "@/lib/utils";

const TODOS = "__todos__";

function BadgeStatus({ t }: { t: TransacaoFinanceira }) {
  if (t.status === "cancelado") return <Badge variant="outline">Cancelado</Badge>;
  if (t.status === "pago") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
      >
        {t.tipo === "receber" ? "Recebido" : "Pago"}
      </Badge>
    );
  }
  if (t.vencido) {
    return (
      <Badge
        variant="outline"
        className="border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      >
        Vencido
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
    >
      Pendente
    </Badge>
  );
}

function ResumoChip({
  teste,
  icon,
  label,
  valor,
}: {
  teste: string;
  icon: ReactNode;
  label: string;
  valor: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4" data-testid={teste}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">{icon}</div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-sm font-semibold">{valor}</p>
      </div>
    </div>
  );
}

export default function LancamentosTab({
  transacoes,
  contas,
  imoveis,
  resumo,
  carregando,
  abrirNovo,
  onConsumirNovo,
  somenteLeitura = false,
}: {
  transacoes: TransacaoFinanceira[];
  contas: PlanoConta[];
  imoveis: Imovel[];
  resumo: ResumoFinanceiro | undefined;
  carregando: boolean;
  abrirNovo: boolean;
  onConsumirNovo: () => void;
  somenteLeitura?: boolean;
}) {
  const seg = useSegmento();
  const qc = useQueryClient();
  const [filtroTipo, setFiltroTipo] = useState<string>(TODOS);
  const [filtroStatus, setFiltroStatus] = useState<string>(TODOS);
  const [modal, setModal] = useState<{ aberto: boolean; transacao: TransacaoFinanceira | null }>({
    aberto: false,
    transacao: null,
  });

  useEffect(() => {
    if (abrirNovo) {
      setModal({ aberto: true, transacao: null });
      onConsumirNovo();
    }
  }, [abrirNovo, onConsumirNovo]);

  const contaById = new Map(contas.map((c) => [c.id, c]));
  const imovelById = new Map(imoveis.map((i) => [i.id, i]));

  const quitar = useMutation({
    mutationFn: (t: TransacaoFinanceira) => apiPatch<TransacaoFinanceira>(`/transacoes/${t.id}`, { status: "pago" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transacoes"] });
      qc.invalidateQueries({ queryKey: ["resumo"] });
      toast.success("Lançamento quitado!");
    },
    onError: (e) => toast.error("Não foi possível quitar o lançamento.", { description: detalheErro(e) }),
  });

  const excluirTx = useMutation({
    mutationFn: (id: string) => apiDelete(`/transacoes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transacoes"] });
      qc.invalidateQueries({ queryKey: ["resumo"] });
      toast.success("Lançamento cancelado; histórico preservado.");
    },
    onError: (e) => toast.error("Não foi possível excluir.", { description: detalheErro(e) }),
  });

  const lista = transacoes
    .filter((t) => filtroTipo === TODOS || t.tipo === filtroTipo)
    .filter((t) => {
      if (filtroStatus === TODOS) return true;
      if (filtroStatus === "vencido") return t.status === "pendente" && t.vencido;
      return t.status === filtroStatus;
    });

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {!somenteLeitura && (
          <>
            <ResumoChip
              teste="financeiro-chip-a-receber"
              icon={<ArrowUpRight className="h-4 w-4 text-emerald-600" />}
              label="A receber (pendente)"
              valor={brl(resumo?.a_receber_pendente ?? null)}
            />
            <ResumoChip
              teste="financeiro-chip-a-pagar"
              icon={<ArrowDownRight className="h-4 w-4 text-red-600" />}
              label="A pagar (pendente)"
              valor={brl(resumo?.a_pagar_pendente ?? null)}
            />
            <ResumoChip
              teste="financeiro-chip-recebido-mes"
              icon={<ArrowUpRight className="h-4 w-4 text-emerald-600" />}
              label="Recebido no mês"
              valor={brl(resumo?.recebido_mes ?? null)}
            />
            <ResumoChip
              teste="financeiro-chip-pago-mes"
              icon={<ArrowDownRight className="h-4 w-4 text-red-600" />}
              label="Pago no mês"
              valor={brl(resumo?.pago_mes ?? null)}
            />
          </>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filtroTipo} onValueChange={setFiltroTipo}>
          <SelectTrigger className="w-44" data-testid="transacoes-filtro-tipo-select">
            <SelectValue>
              {filtroTipo === TODOS ? "Todos os tipos" : TRANSACAO_TIPO[filtroTipo as TransacaoTipo]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os tipos</SelectItem>
            <SelectItem value="receber">A Receber</SelectItem>
            <SelectItem value="pagar">A Pagar</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroStatus} onValueChange={setFiltroStatus}>
          <SelectTrigger className="w-44" data-testid="transacoes-filtro-status-select">
            <SelectValue>
              {filtroStatus === TODOS
                ? "Todos os status"
                : filtroStatus === "vencido"
                  ? "Vencidos"
                  : filtroStatus === "pago"
                    ? "Pago / Recebido"
                    : "Pendentes"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os status</SelectItem>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="vencido">Vencidos</SelectItem>
            <SelectItem value="pago">Pago / Recebido</SelectItem>
          </SelectContent>
        </Select>
        {!somenteLeitura && (
          <Button className="ml-auto" onClick={() => setModal({ aberto: true, transacao: null })} data-testid="btn-new-transaction">
            <Plus className="h-4 w-4" /> Novo Lançamento
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-card" data-testid="transacoes-tabela">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Categoria</TableHead>
              {seg.imobiliaria && <TableHead>Imóvel</TableHead>}
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {carregando && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Carregando lançamentos…
                </TableCell>
              </TableRow>
            )}
            {!carregando && lista.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Nenhum lançamento encontrado para os filtros atuais.
                </TableCell>
              </TableRow>
            )}
            {lista.map((t) => {
              const conta = contaById.get(t.plano_conta_id);
              const imovel = t.imovel_id ? imovelById.get(t.imovel_id) : undefined;
              return (
                <TableRow key={t.id} data-testid={`transacao-row-${t.id}`} className="transition-colors hover:bg-muted/40">
                  <TableCell>
                    <p className="max-w-64 truncate text-sm font-medium">{t.descricao}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-xs">{conta ? `${conta.codigo} · ${conta.nome}` : "—"}</p>
                  </TableCell>
                  {seg.imobiliaria && (
                    <TableCell>
                      <p className="max-w-44 truncate text-xs text-muted-foreground">{imovel ? imovel.titulo : "Sem imóvel"}</p>
                    </TableCell>
                  )}
                  <TableCell>
                    <p className="text-xs">{dataBR(t.vencimento)}</p>
                    {t.pagamento && <p className="text-[11px] text-muted-foreground">pago em {dataBR(t.pagamento)}</p>}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={cn(
                        "font-mono text-sm font-semibold",
                        t.tipo === "receber" ? "text-emerald-600" : "text-red-600",
                      )}
                    >
                      {t.tipo === "receber" ? "+" : "−"} {brl(t.valor)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <BadgeStatus t={t} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {t.status === "pago" && (
                        <Button
                          variant="outline"
                          size="icon-xs"
                          onClick={() => window.open(`/api/transacoes/${t.id}/recibo`, "_blank")}
                          data-testid={`transacao-recibo-${t.id}`}
                          title="Baixar recibo em PDF"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      )}
                      {!somenteLeitura && t.status === "pendente" && (
                        <Button
                          variant="outline"
                          size="icon-xs"
                          onClick={() => quitar.mutate(t)}
                          data-testid={`transacao-quitar-${t.id}`}
                          title="Marcar como pago/recebido"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      {!somenteLeitura && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon-xs" data-testid={`transacao-menu-${t.id}`} />}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setModal({ aberto: true, transacao: t })}>
                              <Pencil className="h-4 w-4" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => excluirTx.mutate(t.id)}
                              data-testid={`transacao-excluir-${t.id}`}
                            >
                              <Trash2 className="h-4 w-4" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <TransactionModal
        open={modal.aberto}
        onClose={() => setModal({ aberto: false, transacao: null })}
        transacao={modal.transacao}
        contas={contas}
        imoveis={imoveis}
      />
    </div>
  );
}
