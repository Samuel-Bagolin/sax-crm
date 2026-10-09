import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Building2, Link2, Mail, MessageCircle, Pencil, Phone, Unlink, User } from "lucide-react";
import { apiDelete, apiGet, apiPut, detalheErro } from "@/lib/api";
import { brl, dataBR } from "@/lib/format";
import { linkWhatsapp } from "@/lib/crm";
import { IMOVEL_FINALIDADE, IMOVEL_TIPO } from "@/lib/constants";
import { useAuth } from "@/lib/useAuth";
import type { FichaProprietario, Imovel, ImovelDoProprietario, Pessoa } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Combo from "@/components/shared/Combo";
import { StatusImovelBadge } from "@/components/shared/badges";
import ProprietarioForm from "@/components/proprietarios/ProprietarioForm";
import { cn } from "@/lib/utils";

function Indicador({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: "verde" | "vermelho" }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={cn("num mt-1 text-base font-bold [overflow-wrap:anywhere] sm:text-xl", tom === "verde" && "text-emerald-600", tom === "vermelho" && "text-red-600")}>{valor}</p>
    </div>
  );
}

function LinhaImovel({ im, verFinanceiro, onDesvincular }: { im: ImovelDoProprietario; verFinanceiro: boolean; onDesvincular: () => void }) {
  const loc = im.locacao;
  return (
    <li className="rounded-lg border bg-card" data-testid="proprietario-imovel">
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <div className="h-24 w-full shrink-0 overflow-hidden rounded-md bg-muted sm:w-32">
          {im.foto_url ? <img src={im.foto_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><Building2 className="h-6 w-6" /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-primary">{im.codigo}</span>
            <StatusImovelBadge status={im.status} />
            {im.publicar_portais && <span className="rounded border px-1.5 text-[11px] text-muted-foreground">Nos portais</span>}
          </div>
          <Link to={`/imoveis?id=${im.id}`} className="mt-1 block truncate font-semibold hover:text-primary">{im.titulo}</Link>
          <p className="text-sm text-muted-foreground">
            {IMOVEL_TIPO[im.tipo]}, {IMOVEL_FINALIDADE[im.finalidade].toLowerCase()}
            {im.bairro ? `, ${im.bairro}` : ""}, {im.cidade}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {im.valor_venda ? <span>Venda <b className="num">{brl(im.valor_venda)}</b></span> : null}
            {im.valor_aluguel ? <span>Aluguel <b className="num">{brl(im.valor_aluguel)}</b></span> : null}
            {im.contrato_venda && <span className="text-muted-foreground">Vendido pelo contrato {im.contrato_venda}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-1 sm:flex-col sm:items-end">
          <Button variant="ghost" size="sm" onClick={onDesvincular} className="text-muted-foreground">
            <Unlink className="h-3.5 w-3.5" /> Desvincular
          </Button>
        </div>
      </div>

      {(loc || verFinanceiro) && (
        <div className="grid gap-4 border-t bg-muted/30 p-4 md:grid-cols-2">
          {loc ? (
            <div className="text-sm">
              <p className="font-semibold">Locação {loc.numero}</p>
              <p className="text-muted-foreground">
                {loc.inquilino ? `Inquilino ${loc.inquilino}, ` : ""}aluguel de {brl(loc.aluguel)} desde {dataBR(loc.inicio)}
                {loc.fim ? ` até ${dataBR(loc.fim)}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  {loc.meses_pagos} de {loc.meses_total} meses pagos
                </span>
                {loc.meses_em_atraso > 0 && (
                  <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">{loc.meses_em_atraso} em atraso</span>
                )}
                {loc.proximo_vencimento && <span className="text-xs text-muted-foreground">Próximo vencimento {dataBR(loc.proximo_vencimento)}</span>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sem contrato de locação ativo.</p>
          )}
          {verFinanceiro && (
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-[11px] text-muted-foreground">Aluguel recebido</dt>
                <dd className="num font-semibold">{brl(im.aluguel_recebido ?? 0)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Lucro da imobiliária</dt>
                <dd className="num font-semibold text-emerald-600">{brl(im.lucro_imobiliaria ?? 0)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Despesas</dt>
                <dd className="num font-semibold text-red-600">{brl(im.despesas ?? 0)}</dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  if (!valor) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-medium">{valor}</dd>
    </div>
  );
}

function Dados({ p }: { p: Pessoa }) {
  const pj = p.tipo_pessoa === "pj";
  const endereco = [p.logradouro && `${p.logradouro}${p.numero ? `, ${p.numero}` : ""}`, p.complemento, p.bairro, p.cidade && `${p.cidade}${p.estado ? `/${p.estado}` : ""}`, p.cep]
    .filter(Boolean)
    .join(", ");
  const grupos: [string, [string, string | null | undefined][]][] = [
    ["Identificação", pj
      ? [["Razão social", p.nome], ["Nome fantasia", p.nome_fantasia], ["CNPJ", p.cpf_cnpj], ["Inscrição estadual", p.inscricao_estadual], ["Responsável legal", p.responsavel_nome], ["CPF do responsável", p.responsavel_cpf]]
      : [["Nome", p.nome], ["CPF", p.cpf_cnpj], ["RG", p.rg], ["Nascimento", p.data_nascimento ? dataBR(p.data_nascimento) : null], ["Estado civil", p.estado_civil], ["Profissão", p.profissao], ["Nacionalidade", p.nacionalidade]]],
    ["Contato", [["WhatsApp", p.telefone], ["Outro telefone", p.telefone2], ["E-mail", p.email], ["Endereço", endereco]]],
    ["Dados para repasse", [["Banco", p.banco], ["Agência", p.agencia], ["Conta", p.conta && `${p.conta}${p.tipo_conta ? ` (${p.tipo_conta === "poupanca" ? "poupança" : "corrente"})` : ""}`], ["Pix", p.pix]]],
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {grupos.map(([titulo, itens]) => (
        <section key={titulo} className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">{titulo}</h3>
          {itens.some(([, v]) => v) ? (
            <dl className="grid gap-3">{itens.map(([r, v]) => <Dado key={r} rotulo={r} valor={v} />)}</dl>
          ) : (
            <p className="text-sm text-muted-foreground">Não informado.</p>
          )}
        </section>
      ))}
      {p.observacoes && (
        <section className="rounded-lg border bg-card p-4 md:col-span-3">
          <h3 className="mb-2 text-sm font-semibold">Observações</h3>
          <p className="whitespace-pre-line text-sm">{p.observacoes}</p>
        </section>
      )}
    </div>
  );
}

export default function ProprietarioDetalhe() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [editar, setEditar] = useState(false);
  const [vincular, setVincular] = useState(false);
  const [imovelEscolhido, setImovelEscolhido] = useState<string | null>(null);
  const chave = ["proprietario", id];
  const { data, isLoading, isError } = useQuery({ queryKey: chave, queryFn: () => apiGet<FichaProprietario>(`/proprietarios/${id}`) });
  const { data: imoveis = [] } = useQuery({ queryKey: ["imoveis"], queryFn: () => apiGet<Imovel[]>("/imoveis"), enabled: vincular });

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: chave });
    qc.invalidateQueries({ queryKey: ["proprietarios"] });
    qc.invalidateQueries({ queryKey: ["imoveis"] });
  };
  const vinc = useMutation({
    mutationFn: (imovelId: string) => apiPut(`/proprietarios/${id}/imoveis/${imovelId}`),
    onSuccess: () => {
      toast.success("Imóvel vinculado");
      setVincular(false);
      setImovelEscolhido(null);
      atualizar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível vincular"),
  });
  const desvinc = useMutation({
    mutationFn: (imovelId: string) => apiDelete(`/proprietarios/${id}/imoveis/${imovelId}`),
    onSuccess: () => {
      toast.success("Imóvel desvinculado");
      atualizar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível desvincular"),
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  if (isError || !data)
    return (
      <div className="rounded-lg border p-8 text-center">
        <p className="font-medium">Proprietário não encontrado.</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate("/proprietarios")}>Voltar para a lista</Button>
      </div>
    );

  const p = data.proprietario;
  const pj = p.tipo_pessoa === "pj";
  const whats = linkWhatsapp(p.telefone, `Olá ${p.nome.split(" ")[0]}!`);
  const atual = imovelEscolhido ? imoveis.find((i) => i.id === imovelEscolhido) : null;

  return (
    <div className="flex flex-col gap-6">
      <Link to="/proprietarios" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Proprietários
      </Link>

      <header className="flex flex-col gap-4 rounded-xl border bg-card p-5 md:flex-row md:items-center">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
          {pj ? <Building2 className="h-7 w-7" /> : <User className="h-7 w-7" />}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-2xl font-bold tracking-tight" data-testid="proprietario-titulo">{p.nome}</h1>
          <p className="text-sm text-muted-foreground">
            {pj ? "Pessoa jurídica" : "Pessoa física"}
            {p.cpf_cnpj ? `, ${pj ? "CNPJ" : "CPF"} ${p.cpf_cnpj}` : ""}
            {pj && p.nome_fantasia ? `, ${p.nome_fantasia}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {p.telefone && <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{p.telefone}</span>}
            {p.email && <a href={`mailto:${p.email}`} className="flex items-center gap-1.5 hover:text-primary"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{p.email}</a>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {whats && (
            <a href={whats} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#25d366] px-3 text-sm font-semibold text-[#073b1e]">
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
          )}
          <Button variant="outline" onClick={() => setEditar(true)} data-testid="proprietario-editar">
            <Pencil className="h-4 w-4" /> Editar
          </Button>
          <Button onClick={() => setVincular(true)} data-testid="proprietario-vincular">
            <Link2 className="h-4 w-4" /> Vincular imóvel
          </Button>
        </div>
      </header>

      <div className={cn("grid gap-3", data.totais ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2")}>
        <Indicador rotulo="Imóveis" valor={String(data.imoveis.length)} />
        <Indicador rotulo="À venda na carteira" valor={brl(data.valor_carteira)} />
        {data.totais && (
          <>
            <Indicador rotulo="Aluguel recebido" valor={brl(data.totais.aluguel_recebido)} />
            <Indicador rotulo="Lucro da imobiliária" valor={brl(data.totais.lucro_imobiliaria)} tom="verde" />
            <Indicador rotulo="Despesas dos imóveis" valor={brl(data.totais.despesas)} tom="vermelho" />
          </>
        )}
      </div>

      <Tabs defaultValue="imoveis">
        <TabsList>
          <TabsTrigger value="imoveis">Imóveis ({data.imoveis.length})</TabsTrigger>
          <TabsTrigger value="dados">Dados cadastrais</TabsTrigger>
        </TabsList>
        <TabsContent value="imoveis" className="mt-4">
          {data.imoveis.length ? (
            <ul className="grid gap-3">
              {data.imoveis.map((im) => (
                <LinhaImovel key={im.id} im={im} verFinanceiro={isAdmin} onDesvincular={() => desvinc.mutate(im.id)} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">Nenhum imóvel vinculado a este proprietário.</p>
              <Button variant="outline" onClick={() => setVincular(true)}>
                <Link2 className="h-4 w-4" /> Vincular imóvel
              </Button>
            </div>
          )}
          {data.totais && (
            <p className="mt-3 text-xs text-muted-foreground">
              Aluguel recebido conta os meses de locação já quitados. Lucro da imobiliária soma comissões e taxas de administração pagas. Despesas somam as contas pagas lançadas no financeiro com o imóvel.
            </p>
          )}
        </TabsContent>
        <TabsContent value="dados" className="mt-4">
          <Dados p={p} />
        </TabsContent>
      </Tabs>

      <ProprietarioForm open={editar} onClose={() => setEditar(false)} pessoa={p} />

      <Dialog open={vincular} onOpenChange={(o) => !o && setVincular(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular imóvel</DialogTitle>
            <DialogDescription>Escolha um imóvel já cadastrado. Se ele tiver outro proprietário, o vínculo passa para {p.nome.split(" ")[0]}.</DialogDescription>
          </DialogHeader>
          <Combo
            opcoes={imoveis.filter((i) => i.proprietario_id !== id).map((i) => ({ valor: i.id, rotulo: `${i.codigo} ${i.titulo}`, detalhe: [i.bairro, i.cidade, i.proprietario_id ? "já tem proprietário" : "sem proprietário"].filter(Boolean).join(", ") }))}
            valor={imovelEscolhido}
            onChange={setImovelEscolhido}
            placeholder="Buscar imóvel por código ou título"
            testid="vincular-imovel"
          />
          {atual?.proprietario_id && <p className="text-xs text-amber-700">Este imóvel já tem proprietário. Ao confirmar, o vínculo será trocado.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setVincular(false)}>Cancelar</Button>
            <Button disabled={!imovelEscolhido || vinc.isPending} onClick={() => imovelEscolhido && vinc.mutate(imovelEscolhido)}>
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
