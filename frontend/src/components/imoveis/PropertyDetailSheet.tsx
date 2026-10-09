import { useQuery } from "@tanstack/react-query";
import {
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  Car,
  Eye,
  FileSignature,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Ruler,
  User,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { brl, dataBR, dataHoraBR, diasAtras } from "@/lib/format";
import { LEAD_ESTAGIO_LABEL, TRANSACAO_TIPO } from "@/lib/constants";
import type { Imovel, ImovelDetalhe } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StatusImovelBadge } from "@/components/shared/badges";
import ImovelExtras, { FotosGaleria } from "@/components/imoveis/ImovelExtras";

export default function PropertyDetailSheet({
  imovelId,
  onClose,
  onEditar,
}: {
  imovelId: string | null;
  onClose: () => void;
  onEditar: (imovel: Imovel) => void;
}) {
  const q = useQuery({
    queryKey: ["imovel", imovelId],
    queryFn: () => apiGet<ImovelDetalhe>(`/imoveis/${imovelId}`),
    enabled: !!imovelId,
  });

  const imovel = q.data;

  return (
    <Sheet open={!!imovelId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetTitle className="sr-only">Ficha do imóvel</SheetTitle>
        {!imovel ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground" data-testid="property-detail-loading">
            {q.isLoading ? "Carregando ficha..." : "Não foi possível carregar a ficha do imóvel."}
          </div>
        ) : (
          <div className="flex flex-col gap-5" data-testid="property-detail-sheet">
            <div className="relative h-44 w-full overflow-hidden rounded-lg bg-muted">
              {imovel.foto_url ? (
                <img src={imovel.foto_url} alt={imovel.titulo} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Building2 className="h-10 w-10" />
                </div>
              )}
              <div className="absolute left-3 top-3 flex gap-1.5">
                <StatusImovelBadge status={imovel.status} />
                {imovel.publicar_portais && <span className="rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">Nos portais</span>}
              </div>
            </div>

            <FotosGaleria imovelId={imovel.id} />

            <div>
              <p className="font-mono text-xs font-semibold text-primary" data-testid="property-codigo">
                {imovel.codigo || "—"}
              </p>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="font-heading text-xl font-bold tracking-tight">{imovel.titulo}</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEditar(imovel)}
                  data-testid="property-edit-button"
                >
                  <Pencil className="h-4 w-4" /> Editar
                </Button>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {imovel.endereco}
                {imovel.bairro ? ` — ${imovel.bairro}` : ""} · {imovel.cidade}
                {imovel.estado ? `/${imovel.estado}` : ""}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Spec icon={BedDouble} rotulo="Quartos" valor={String(imovel.quartos)} />
              <Spec icon={Bath} rotulo="Suítes / banh." valor={`${imovel.suites} / ${imovel.banheiros ?? 0}`} />
              <Spec icon={Car} rotulo="Vagas" valor={String(imovel.vagas)} />
              <Spec
                icon={Ruler}
                rotulo="Área útil"
                valor={imovel.area_util ? `${imovel.area_util} m²` : "—"}
              />
            </div>

            <div className="rounded-lg border bg-muted/40 p-4" data-testid="property-values-card">
              <p className="text-xs font-semibold text-muted-foreground">Valores</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Valor rotulo="Venda" valor={imovel.valor_venda} destaque />
                <Valor rotulo="Aluguel" valor={imovel.valor_aluguel} destaque />
                <Valor rotulo="IPTU" valor={imovel.iptu} />
                <Valor rotulo="Condomínio" valor={imovel.condominio} />
              </div>
            </div>

            {imovel.descricao && <p className="text-sm leading-relaxed text-muted-foreground">{imovel.descricao}</p>}

            <div className="rounded-lg border p-4" data-testid="property-owner-card">
              <p className="text-xs font-semibold text-muted-foreground">
                Proprietário
              </p>
              {imovel.proprietario ? (
                <div className="mt-3 flex flex-col gap-1.5 text-sm">
                  <p className="flex items-center gap-2 font-semibold">
                    <User className="h-4 w-4 text-primary" /> {imovel.proprietario.nome}
                  </p>
                  {imovel.proprietario.cpf_cnpj && (
                    <p className="font-mono text-xs text-muted-foreground">CPF/CNPJ: {imovel.proprietario.cpf_cnpj}</p>
                  )}
                  {imovel.proprietario.telefone && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-4 w-4" /> {imovel.proprietario.telefone}
                    </p>
                  )}
                  {imovel.proprietario.email && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-4 w-4" /> {imovel.proprietario.email}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">Nenhum proprietário vinculado.</p>
              )}
            </div>

            <ImovelExtras imovelId={imovel.id} codigo={imovel.codigo} />

            <div className="border-t" />

            <section data-testid="property-contrato-card">
              <p className="text-xs font-semibold text-muted-foreground">
                Contrato vigente
              </p>
              {imovel.contrato_vigente ? (
                <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-sm font-bold" data-testid="property-contrato-numero">
                      {imovel.contrato_vigente.numero}
                    </p>
                    <Badge variant="default" className="text-[10px]">
                      {imovel.contrato_vigente.tipo === "venda" ? "Venda" : "Locação"}
                    </Badge>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FileSignature className="h-3.5 w-3.5" />
                    Vigência {dataBR(imovel.contrato_vigente.inicio)}
                    {imovel.contrato_vigente.fim ? ` – ${dataBR(imovel.contrato_vigente.fim)}` : ""}
                    {imovel.contrato_vigente.cliente_nome
                      ? ` · ${imovel.contrato_vigente.cliente_nome}`
                      : ""}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <Valor rotulo="Valor do contrato" valor={imovel.contrato_vigente.valor} destaque />
                    <Valor rotulo="Total gerado" valor={imovel.contrato_vigente.total_gerado} />
                    <Valor rotulo="Já recebido" valor={imovel.contrato_vigente.total_recebido} destaque />
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {imovel.contrato_vigente.parcelas_pagas} de {imovel.contrato_vigente.parcelas}{" "}
                    parcela(s) paga(s)
                    {imovel.contrato_vigente.corretor_nome
                      ? ` · corretor ${imovel.contrato_vigente.corretor_nome}`
                      : ""}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground" data-testid="property-contrato-vazio">
                  Nenhum contrato ativo para este imóvel.
                </p>
              )}

              <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg border bg-muted/40 p-4" data-testid="property-rendimento-card">
                <div>
                  <p className="text-[11px] text-muted-foreground">Já rendeu (recebido)</p>
                  <p className="font-mono text-sm font-semibold text-emerald-600" data-testid="property-rendimento-recebido">
                    {brl(imovel.rendimento_recebido)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">A receber</p>
                  <p className="font-mono text-sm font-semibold">{brl(imovel.rendimento_a_receber)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Despesas pagas</p>
                  <p className="font-mono text-sm font-semibold text-red-600">
                    {brl(imovel.despesas_pagas)}
                  </p>
                </div>
              </div>
            </section>

            <section>
              <p className="text-xs font-semibold text-muted-foreground">
                Leads relacionados ({imovel.leads.length})
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {imovel.leads.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum lead para este imóvel ainda.</p>
                )}
                {imovel.leads.map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{l.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {LEAD_ESTAGIO_LABEL[l.estagio]} · {diasAtras(l.created_at)}
                      </p>
                    </div>
                    <span className="font-mono text-xs font-medium">{brl(l.valor_estimado)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <p className="text-xs font-semibold text-muted-foreground">
                Lançamentos financeiros ({imovel.transacoes.length})
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {imovel.transacoes.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum lançamento vinculado.</p>
                )}
                {imovel.transacoes.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.descricao}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarDays className="h-3 w-3" /> {dataBR(t.vencimento)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {TRANSACAO_TIPO[t.tipo]}
                      </Badge>
                      <span
                        className={
                          t.tipo === "receber"
                            ? "font-mono text-xs font-semibold text-emerald-600"
                            : "font-mono text-xs font-semibold text-red-600"
                        }
                      >
                        {t.tipo === "receber" ? "+" : "−"} {brl(t.valor)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <p className="pb-2 text-xs text-muted-foreground">
              <Eye className="mr-1 inline h-3 w-3" />
              Cadastrado em {dataHoraBR(imovel.created_at)} · atualizado em {dataHoraBR(imovel.updated_at)}
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Spec({
  icon: Icon,
  rotulo,
  valor,
}: {
  icon: typeof BedDouble;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-1.5 font-heading text-sm font-bold">{valor}</p>
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
    </div>
  );
}

function Valor({ rotulo, valor, destaque }: { rotulo: string; valor: number | null; destaque?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <p
        className={
          destaque
            ? "font-mono text-sm font-semibold tracking-tight"
            : "font-mono text-sm text-muted-foreground"
        }
      >
        {brl(valor)}
      </p>
    </div>
  );
}
