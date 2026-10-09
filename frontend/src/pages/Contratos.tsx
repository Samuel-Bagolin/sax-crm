import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FileSignature, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { dataBR } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import type { ContratoBase, ContratoDetalhe } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import ContratoModal from "@/components/contratos/ContratoModal";
import AssinaturaPanel from "@/components/contratos/AssinaturaPanel";
import DocumentosPainel from "@/components/shared/DocumentosPainel";
import { PenLine } from "lucide-react";

const ASSINATURA: Record<string, { rotulo: string; cls: string }> = {
  rascunho: { rotulo: "Não enviado", cls: "text-muted-foreground" },
  aguardando: { rotulo: "Aguardando", cls: "text-sem-atividade" },
  assinado: { rotulo: "Assinado", cls: "text-hoje" },
  recusado: { rotulo: "Recusado", cls: "text-atrasada" },
};

const STATUS_LABEL: Record<string, string> = {
  ativo: "Ativo",
  encerrado: "Encerrado",
  cancelado: "Cancelado",
};

export default function Contratos() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const [modalAberto, setModalAberto] = useState(params.get("novo") === "1");
  const [abertoId, setAbertoId] = useState<string | null>(params.get("id"));
  const [assinaturaId, setAssinaturaId] = useState<string | null>(null);

  const { data: contratos = [], isLoading } = useQuery({
    queryKey: ["contratos"],
    queryFn: () => apiGet<ContratoBase[]>("/contratos"),
  });

  const { data: detalhe } = useQuery({
    queryKey: ["contrato", abertoId],
    queryFn: () => apiGet<ContratoDetalhe>(`/contratos/${abertoId}`),
    enabled: !!abertoId,
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["contratos"] });
    qc.invalidateQueries({ queryKey: ["contrato", abertoId] });
    qc.invalidateQueries({ queryKey: ["transacoes"] });
    qc.invalidateQueries({ queryKey: ["resumo"] });
  };

  const reprocessar = useMutation({
    mutationFn: (id: string) => apiPost(`/contratos/${id}/reprocessar`, {}),
    onSuccess: () => { invalidar(); toast.success("Parcelas conferidas e financeiro concluído."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível reprocessar."),
  });

  const encerrar = useMutation({
    mutationFn: (id: string) => apiPatch<ContratoBase>(`/contratos/${id}`, { status: "encerrado" }),
    onSuccess: () => {
      invalidar();
      toast.success("Contrato encerrado. Parcelas futuras pendentes foram canceladas e preservadas no histórico.");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível encerrar o contrato."),
  });

  const excluir = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/contratos/${id}`),
    onSuccess: () => {
      setAbertoId(null);
      invalidar();
      toast.success("Contrato cancelado; histórico preservado.");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir o contrato."),
  });

  const fecharModal = () => {
    setModalAberto(false);
    if (params.get("novo")) {
      params.delete("novo");
      params.delete("lead");
      setParams(params, { replace: true });
    }
  };

  const ativos = contratos.filter((c) => c.status === "ativo");

  return (
    <div className="space-y-6" data-testid="contratos-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">
            {ativos.length} contrato(s) ativo(s)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="contratos-total">
            {isLoading ? "Carregando..." : `${contratos.length} contrato(s) na carteira`}
          </p>
        </div>
        <Button size="sm" onClick={() => setModalAberto(true)} data-testid="contratos-novo-button">
          <Plus className="h-4 w-4" />
          Novo contrato
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Carteira de contratos</CardTitle>
        </CardHeader>
        <CardContent>
          {contratos.length === 0 ? (
            <div className="flex flex-col items-start gap-2 py-8">
              <FileSignature className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Nenhum contrato ainda. Feche um lead no funil e transforme-o em contrato.
              </p>
            </div>
          ) : (
            <Table data-testid="contratos-tabela">
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Parcelas</TableHead>
                  <TableHead>Assinatura</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contratos.map((c) => (
                  <TableRow
                    key={c.id}
                    onClick={() => setAbertoId(c.id)}
                    className="cursor-pointer transition-colors duration-150 hover:bg-accent/50"
                    data-testid={`contrato-row-${c.id}`}
                  >
                    <TableCell className="font-mono text-xs font-semibold">{c.numero}</TableCell>
                    <TableCell>{c.tipo === "venda" ? "Venda" : "Locação"}</TableCell>
                    <TableCell className="text-sm">
                      {dataBR(c.inicio)} {c.fim ? `– ${dataBR(c.fim)}` : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{brl(c.valor)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{c.parcelas}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAssinaturaId(c.id);
                        }}
                        className={`flex items-center gap-1 text-xs font-medium hover:underline ${ASSINATURA[c.assinatura_status ?? "rascunho"]?.cls ?? ""}`}
                      >
                        <PenLine className="h-3.5 w-3.5" />
                        {ASSINATURA[c.assinatura_status ?? "rascunho"]?.rotulo}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.status === "ativo" ? "default" : "secondary"}>
                        {STATUS_LABEL[c.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!abertoId} onOpenChange={(o) => !o && setAbertoId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle data-testid="contrato-detalhe-numero">
              {detalhe ? `${detalhe.numero}, ${detalhe.tipo === "venda" ? "venda" : "locação"}` : "Contrato"}
            </SheetTitle>
            <SheetDescription>
              {detalhe?.imovel_titulo ?? ""}
              {detalhe?.cliente_nome ? ` · Cliente: ${detalhe.cliente_nome}` : ""}
            </SheetDescription>
          </SheetHeader>

          {detalhe && (
            <div className="space-y-5 p-4">
              {detalhe.status === "ativo" && ["erro", "pendente"].includes(detalhe.financeiro_status) && (
                <div className="rounded-md border p-3 text-sm">
                  <p>Geração financeira pendente. Confira os dados e retome a operação.</p>
                  <Button className="mt-2" disabled={reprocessar.isPending} onClick={() => reprocessar.mutate(detalhe.id)}>Retomar geração de parcelas</Button>
                </div>
              )}
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
                <PenLine className="h-5 w-5 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Assinatura eletrônica</p>
                  <p className={`text-xs ${ASSINATURA[detalhe.assinatura_status ?? "rascunho"]?.cls ?? ""}`}>
                    {ASSINATURA[detalhe.assinatura_status ?? "rascunho"]?.rotulo}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setAbertoId(null);
                    setAssinaturaId(detalhe.id);
                  }}
                  data-testid="abrir-assinatura"
                >
                  {detalhe.assinatura_status === "assinado" ? "Ver assinaturas" : "Enviar para assinar"}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Vigência</p>
                  <p className="font-medium">
                    {dataBR(detalhe.inicio)} {detalhe.fim ? `– ${dataBR(detalhe.fim)}` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Proprietário</p>
                  <p className="font-medium">{detalhe.proprietario_nome ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Corretor</p>
                  <p className="font-medium">{detalhe.corretor_nome ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total gerado</p>
                  <p className="font-mono font-semibold" data-testid="contrato-detalhe-total">
                    {brl(detalhe.total_gerado)}
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">
                  Parcelas geradas ({detalhe.transacoes.length})
                </p>
                <div className="space-y-2">
                  {detalhe.transacoes.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                      data-testid={`contrato-parcela-${t.id}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{t.descricao}</p>
                        <p className="text-xs text-muted-foreground">
                          Venc. {dataBR(t.vencimento)} · {t.status === "pago" ? "Pago" : t.status === "cancelado" ? "Cancelado" : t.vencido ? "Vencido" : "Pendente"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{brl(t.valor)}</span>
                        {t.status === "pago" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(`/api/transacoes/${t.id}/recibo`, "_blank")}
                            data-testid={`contrato-recibo-${t.id}`}
                          >
                            Recibo
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <DocumentosPainel contratoId={detalhe.id} />

              {isAdmin && (
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => encerrar.mutate(detalhe.id)}
                    disabled={detalhe.status !== "ativo" || encerrar.isPending}
                    data-testid="contrato-encerrar-button"
                  >
                    Encerrar contrato
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => excluir.mutate(detalhe.id)}
                    disabled={excluir.isPending}
                    data-testid="contrato-excluir-button"
                  >
                    Cancelar contrato
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ContratoModal
        open={modalAberto}
        onClose={fecharModal}
        leadInicial={params.get("lead")}
        onCriado={(c) => setAssinaturaId(c.id)}
      />
      <AssinaturaPanel
        contratoId={assinaturaId}
        onClose={() => {
          setAssinaturaId(null);
          qc.invalidateQueries({ queryKey: ["contratos"] });
          qc.invalidateQueries({ queryKey: ["contrato"] });
        }}
      />
    </div>
  );
}
