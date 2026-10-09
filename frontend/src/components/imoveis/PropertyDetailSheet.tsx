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
import { IMOVEL_FINALIDADE, IMOVEL_TIPO, LEAD_ESTAGIO_LABEL, TRANSACAO_TIPO } from "@/lib/constants";
import type { Imovel, ImovelDetalhe } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StatusImovelBadge } from "@/components/shared/badges";
import { FotosGaleria, InteressadosImovel, PropostasImovel, RelatorioProprietarioCard } from "@/components/imoveis/ImovelExtras";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePlano } from "@/lib/diferenciais";
import { Link } from "react-router-dom";

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
  const { tem } = usePlano();

  return (
    <Sheet open={!!imovelId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetTitle className="sr-only">Ficha do imóvel</SheetTitle>
        {!imovel ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground" data-testid="property-detail-loading">
            {q.isLoading ? "Carregando ficha..." : "Não foi possível carregar a ficha do imóvel."}
          </div>
        ) : (
          <div className="flex flex-col gap-5" data-testid="property-detail-sheet">
            <div className="relative h-48 w-full overflow-hidden rounded-lg bg-muted">
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

            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-semibold text-primary" data-testid="property-codigo">
                  {imovel.codigo || "Sem código"}
                </p>
                <h2 className="font-heading text-xl font-bold tracking-tight">{imovel.titulo}</h2>
                <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {imovel.endereco}
                    {imovel.bairro ? `, ${imovel.bairro}` : ""}, {imovel.cidade}
                    {imovel.estado ? `/${imovel.estado}` : ""}
                  </span>
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onEditar(imovel)} data-testid="property-edit-button">
                <Pencil className="h-4 w-4" /> Editar
              </Button>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3" data-testid="property-values-card">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {imovel.valor_venda ? <Valor rotulo="Venda" valor={imovel.valor_venda} destaque /> : null}
                {imovel.valor_aluguel ? <Valor rotulo="Aluguel" valor={imovel.valor_aluguel} destaque /> : null}
                {imovel.condominio ? <Valor rotulo="Condomínio" valor={imovel.condominio} /> : null}
                {imovel.iptu ? <Valor rotulo="IPTU" valor={imovel.iptu} /> : null}
                {!imovel.valor_venda && !imovel.valor_aluguel && <p className="text-sm text-muted-foreground">Valores não informados.</p>}
              </div>
              <div className="flex gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><BedDouble className="h-4 w-4" /> {imovel.quartos}</span>
                <span className="flex items-center gap-1"><Bath className="h-4 w-4" /> {imovel.banheiros ?? 0}</span>
                <span className="flex items-center gap-1"><Car className="h-4 w-4" /> {imovel.vagas}</span>
                {imovel.area_util ? <span className="flex items-center gap-1"><Ruler className="h-4 w-4" /> {imovel.area_util} m²</span> : null}
              </div>
            </div>

            <Tabs defaultValue="resumo">
              <TabsList className="w-full">
                <TabsTrigger value="resumo">Resumo</TabsTrigger>
                <TabsTrigger value="fotos">Fotos</TabsTrigger>
                <TabsTrigger value="negocios">Negócios ({imovel.leads.length})</TabsTrigger>
                <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
              </TabsList>

              <TabsContent value="resumo" className="mt-4 flex flex-col gap-4">
                <div className="rounded-lg border p-4" data-testid="property-owner-card">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-muted-foreground">Proprietário</p>
                    {imovel.proprietario && (
                      <Link to={`/proprietarios/${imovel.proprietario.id}`} className="text-xs font-medium text-primary hover:underline">
                        Ver ficha do proprietário
                      </Link>
                    )}
                  </div>
                  {imovel.proprietario ? (
                    <div className="mt-2 flex flex-col gap-1 text-sm">
                      <p className="flex items-center gap-2 font-semibold">
                        <User className="h-4 w-4 text-primary" /> {imovel.proprietario.nome}
                      </p>
                      {imovel.proprietario.cpf_cnpj && <p className="text-xs text-muted-foreground">CPF/CNPJ {imovel.proprietario.cpf_cnpj}</p>}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                        {imovel.proprietario.telefone && <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {imovel.proprietario.telefone}</span>}
                        {imovel.proprietario.email && <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> {imovel.proprietario.email}</span>}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">Nenhum proprietário vinculado. Use Editar para escolher ou cadastrar.</p>
                  )}
                </div>
                {tem("proprietario") && <RelatorioProprietarioCard imovelId={imovel.id} codigo={imovel.codigo} />}
                {imovel.descricao && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">Descrição</p>
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{imovel.descricao}</p>
                  </div>
                )}
                <dl className="grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm sm:grid-cols-3">
                  <Info rotulo="Tipo" valor={IMOVEL_TIPO[imovel.tipo]} />
                  <Info rotulo="Finalidade" valor={IMOVEL_FINALIDADE[imovel.finalidade]} />
                  <Info rotulo="Suítes" valor={String(imovel.suites)} />
                  <Info rotulo="Área útil" valor={imovel.area_util ? `${imovel.area_util} m²` : "Não informada"} />
                  <Info rotulo="Área total" valor={imovel.area_total ? `${imovel.area_total} m²` : "Não informada"} />
                  <Info rotulo="CEP" valor={imovel.cep || "Não informado"} />
                </dl>
              </TabsContent>

              <TabsContent value="fotos" className="mt-4">
                <FotosGaleria imovelId={imovel.id} />
              </TabsContent>

              <TabsContent value="negocios" className="mt-4 flex flex-col gap-4">
                {tem("match") && <InteressadosImovel imovelId={imovel.id} />}
                {tem("propostas") && <PropostasImovel imovelId={imovel.id} />}
                <section>
                  <p className="text-xs font-semibold text-muted-foreground">Leads e negócios deste imóvel ({imovel.leads.length})</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {imovel.leads.length === 0 && <p className="text-sm text-muted-foreground">Nenhum negócio para este imóvel ainda.</p>}
                    {imovel.leads.map((l) => (
                      <Link key={l.id} to={`/negocios/${l.id}`} className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/40">
                        <div>
                          <p className="text-sm font-medium">{l.nome}</p>
                          <p className="text-xs text-muted-foreground">
                            {LEAD_ESTAGIO_LABEL[l.estagio]}, {diasAtras(l.created_at)}
                          </p>
                        </div>
                        <span className="font-mono text-xs font-medium">{brl(l.valor_estimado)}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="financeiro" className="mt-4 flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/40 p-4" data-testid="property-rendimento-card">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Já rendeu (recebido)</p>
                    <p className="font-mono text-sm font-semibold text-emerald-600" data-testid="property-rendimento-recebido">{brl(imovel.rendimento_recebido)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">A receber</p>
                    <p className="font-mono text-sm font-semibold">{brl(imovel.rendimento_a_receber)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Despesas pagas</p>
                    <p className="font-mono text-sm font-semibold text-red-600">{brl(imovel.despesas_pagas)}</p>
                  </div>
                </div>

                <section data-testid="property-contrato-card">
                  <p className="text-xs font-semibold text-muted-foreground">Contrato vigente</p>
                  {imovel.contrato_vigente ? (
                    <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-sm font-bold" data-testid="property-contrato-numero">{imovel.contrato_vigente.numero}</p>
                        <Badge variant="default" className="text-[10px]">{imovel.contrato_vigente.tipo === "venda" ? "Venda" : "Locação"}</Badge>
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <FileSignature className="h-3.5 w-3.5" />
                        Vigência {dataBR(imovel.contrato_vigente.inicio)}
                        {imovel.contrato_vigente.fim ? ` até ${dataBR(imovel.contrato_vigente.fim)}` : ""}
                        {imovel.contrato_vigente.cliente_nome ? `, ${imovel.contrato_vigente.cliente_nome}` : ""}
                      </p>
                      <div className="mt-3 grid grid-cols-3 gap-3">
                        <Valor rotulo="Valor do contrato" valor={imovel.contrato_vigente.valor} destaque />
                        <Valor rotulo="Total gerado" valor={imovel.contrato_vigente.total_gerado} />
                        <Valor rotulo="Já recebido" valor={imovel.contrato_vigente.total_recebido} destaque />
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {imovel.contrato_vigente.parcelas_pagas} de {imovel.contrato_vigente.parcelas} parcela(s) paga(s)
                        {imovel.contrato_vigente.corretor_nome ? `, corretor ${imovel.contrato_vigente.corretor_nome}` : ""}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground" data-testid="property-contrato-vazio">Nenhum contrato ativo para este imóvel.</p>
                  )}
                </section>

                <section>
                  <p className="text-xs font-semibold text-muted-foreground">Lançamentos financeiros ({imovel.transacoes.length})</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {imovel.transacoes.length === 0 && <p className="text-sm text-muted-foreground">Nenhum lançamento vinculado.</p>}
                    {imovel.transacoes.map((t) => (
                      <div key={t.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{t.descricao}</p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarDays className="h-3 w-3" /> {dataBR(t.vencimento)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{TRANSACAO_TIPO[t.tipo]}</Badge>
                          <span className={t.tipo === "receber" ? "font-mono text-xs font-semibold text-emerald-600" : "font-mono text-xs font-semibold text-red-600"}>
                            {t.tipo === "receber" ? "+" : "−"} {brl(t.valor)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </TabsContent>
            </Tabs>

            <p className="pb-2 text-xs text-muted-foreground">
              <Eye className="mr-1 inline h-3 w-3" />
              Cadastrado em {dataHoraBR(imovel.created_at)}, atualizado em {dataHoraBR(imovel.updated_at)}
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
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
