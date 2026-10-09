import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Building2, Check, Copy, Eye, Link2, MessageCircle, RefreshCw, Send, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brlCompacto, dataHoraBR } from "@/lib/format";
import { linkWhatsapp } from "@/lib/crm";
import { REACAO, urlCompleta, type Compativel, type PerfilBusca, type Vitrine } from "@/lib/diferenciais";
import type { ImovelTipo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const TIPOS: { valor: ImovelTipo; rotulo: string }[] = [
  { valor: "apartamento", rotulo: "Apartamento" },
  { valor: "casa", rotulo: "Casa" },
  { valor: "terreno", rotulo: "Terreno" },
  { valor: "comercial", rotulo: "Comercial" },
];

const PERFIL_VAZIO: PerfilBusca = {
  finalidade: "venda",
  tipos: [],
  cidades: [],
  bairros: [],
  valor_min: null,
  valor_max: null,
  quartos_min: null,
  vagas_min: null,
  area_min: null,
  observacao: null,
};

function resumoPerfil(p: PerfilBusca): string[] {
  const partes: string[] = [p.finalidade === "locacao" ? "Locação" : "Compra"];
  if (p.tipos.length) partes.push(p.tipos.map((t) => TIPOS.find((x) => x.valor === t)?.rotulo).join(", "));
  if (p.bairros.length) partes.push(p.bairros.join(", "));
  else if (p.cidades.length) partes.push(p.cidades.join(", "));
  if (p.valor_min && p.valor_max) partes.push(`${brlCompacto(p.valor_min)} a ${brlCompacto(p.valor_max)}`);
  else if (p.valor_max) partes.push(`até ${brlCompacto(p.valor_max)}`);
  if (p.quartos_min) partes.push(`${p.quartos_min}+ quartos`);
  if (p.vagas_min) partes.push(`${p.vagas_min}+ vagas`);
  if (p.area_min) partes.push(`${p.area_min}+ m²`);
  return partes;
}

function Nota({ score }: { score: number }) {
  const cor = score >= 85 ? "text-hoje" : score >= 70 ? "text-primary" : "text-[#a26a00] dark:text-sem-atividade";
  return (
    <span className={cn("num flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-full border-2 text-xs font-bold leading-none", cor)} style={{ borderColor: "currentColor" }} title="Compatibilidade com o perfil do cliente">
      {score}
      <span className="text-[8px] font-medium opacity-80">%</span>
    </span>
  );
}

function ListaTexto({ valor, onChange, placeholder, id }: { valor: string[]; onChange: (v: string[]) => void; placeholder: string; id: string }) {
  const [texto, setTexto] = useState("");
  const adicionar = () => {
    const novos = texto
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && !valor.some((v) => v.toLowerCase() === t.toLowerCase()));
    if (novos.length) onChange([...valor, ...novos]);
    setTexto("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1">
      {valor.map((v) => (
        <span key={v} className="flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs font-medium">
          {v}
          <button type="button" aria-label={`Remover ${v}`} onClick={() => onChange(valor.filter((x) => x !== v))}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            adicionar();
          } else if (e.key === "Backspace" && !texto && valor.length) onChange(valor.slice(0, -1));
        }}
        onBlur={adicionar}
        placeholder={valor.length ? "" : placeholder}
        className="min-w-[120px] flex-1 bg-transparent py-1 text-sm outline-none"
      />
    </div>
  );
}

function numero(v: string): number | null {
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return v.trim() && Number.isFinite(n) ? n : null;
}

function PerfilDialog({ aberto, inicial, onFechar, onSalvar, salvando }: { aberto: boolean; inicial: PerfilBusca; onFechar: () => void; onSalvar: (p: PerfilBusca) => void; salvando: boolean }) {
  const [p, setP] = useState<PerfilBusca>(inicial);
  const [chave, setChave] = useState(inicial);
  if (chave !== inicial) {
    setChave(inicial);
    setP(inicial);
  }
  const campoNumero = (k: "valor_min" | "valor_max" | "area_min", rotulo: string, ph: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`pf-${k}`}>{rotulo}</Label>
      <Input id={`pf-${k}`} inputMode="numeric" placeholder={ph} value={p[k] ?? ""} onChange={(e) => setP({ ...p, [k]: numero(e.target.value) })} />
    </div>
  );
  const contador = (k: "quartos_min" | "vagas_min", rotulo: string) => (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{rotulo}</span>
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setP({ ...p, [k]: n || null })}
            className={cn("h-8 flex-1 rounded-md border text-sm", (p[k] ?? 0) === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {n === 0 ? "Tanto faz" : `${n}+`}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>O que o cliente procura</DialogTitle>
          <DialogDescription>O CRM cruza este perfil com a carteira e avisa quando entrar um imóvel compatível.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-1 rounded-md bg-muted p-1">
            {(["venda", "locacao"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setP({ ...p, finalidade: f })} className={cn("h-8 flex-1 rounded text-sm font-medium", p.finalidade === f ? "bg-card shadow-sm" : "text-muted-foreground")}>
                {f === "venda" ? "Comprar" : "Alugar"}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Tipo de imóvel</span>
            <div className="flex flex-wrap gap-1.5">
              {TIPOS.map((t) => {
                const marcado = p.tipos.includes(t.valor);
                return (
                  <button
                    key={t.valor}
                    type="button"
                    onClick={() => setP({ ...p, tipos: marcado ? p.tipos.filter((x) => x !== t.valor) : [...p.tipos, t.valor] })}
                    className={cn("h-8 rounded-full border px-3 text-sm", marcado ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}
                  >
                    {t.rotulo}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pf-cidades">Cidades</Label>
              <ListaTexto id="pf-cidades" valor={p.cidades} onChange={(v) => setP({ ...p, cidades: v })} placeholder="Curitiba, São José…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-bairros">Bairros preferidos</Label>
              <ListaTexto id="pf-bairros" valor={p.bairros} onChange={(v) => setP({ ...p, bairros: v })} placeholder="Batel, Água Verde…" />
            </div>
            {campoNumero("valor_min", "Valor mínimo (R$)", "ex.: 400000")}
            {campoNumero("valor_max", "Valor máximo (R$)", "ex.: 800000")}
          </div>
          {contador("quartos_min", "Quartos")}
          {contador("vagas_min", "Vagas")}
          {campoNumero("area_min", "Área útil mínima (m²)", "ex.: 70")}
          <div className="space-y-1.5">
            <Label htmlFor="pf-obs">Observações</Label>
            <Textarea id="pf-obs" rows={2} value={p.observacao ?? ""} onChange={(e) => setP({ ...p, observacao: e.target.value || null })} placeholder="Perto de escola, aceita permuta, andar alto…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => onSalvar(p)} disabled={salvando} data-testid="perfil-salvar">
            Salvar perfil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Imóveis compatíveis com o cliente + envio da vitrine por link. */
export default function CompativeisPainel({ negocioId, clienteNome, clienteTelefone, corretorNome }: { negocioId: string; clienteNome?: string | null; clienteTelefone?: string | null; corretorNome?: string | null }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [enviar, setEnviar] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const { data: perfilResp } = useQuery({ queryKey: ["perfil-busca", negocioId], queryFn: () => apiGet<{ perfil: PerfilBusca | null; sugestao: PerfilBusca | null }>(`/leads/${negocioId}/perfil`) });
  const perfil = perfilResp?.perfil ?? null;
  const { data: lista = [], isLoading } = useQuery({
    queryKey: ["compativeis", negocioId],
    queryFn: () => apiGet<Compativel[]>(`/leads/${negocioId}/compativeis`),
    enabled: !!perfil,
  });
  const { data: vitrines = [] } = useQuery({ queryKey: ["vitrines", negocioId], queryFn: () => apiGet<Vitrine[]>(`/leads/${negocioId}/vitrines`) });

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["compativeis", negocioId] });
    qc.invalidateQueries({ queryKey: ["vitrines", negocioId] });
    qc.invalidateQueries({ queryKey: ["historico", negocioId] });
  };
  const salvarPerfil = useMutation({
    mutationFn: (p: PerfilBusca) => apiPut<PerfilBusca>(`/leads/${negocioId}/perfil`, p),
    onSuccess: () => {
      setEditando(false);
      qc.invalidateQueries({ queryKey: ["perfil-busca", negocioId] });
      atualizar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar o perfil"),
  });
  const criarVitrine = useMutation({
    mutationFn: () => apiPost<Vitrine>(`/leads/${negocioId}/vitrines`, { imovel_ids: selecionados, mensagem: mensagem.trim() || null }),
    onSuccess: (v) => {
      setLink(urlCompleta(`/vitrine/${v.token}`));
      setSelecionados([]);
      atualizar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar a vitrine"),
  });
  const novoLink = useMutation({
    mutationFn: (id: string) => apiPost<Vitrine>(`/vitrines/${id}/novo-link`),
    onSuccess: (v) => {
      setLink(urlCompleta(`/vitrine/${v.token}`));
      setEnviar(true);
      atualizar();
    },
  });
  const desativar = useMutation({ mutationFn: (id: string) => apiDelete(`/vitrines/${id}`), onSuccess: atualizar });

  const primeiroNome = clienteNome?.split(" ")[0] ?? "";
  const textoWhats = (url: string) =>
    `Olá${primeiroNome ? ` ${primeiroNome}` : ""}! Separei alguns imóveis com o seu perfil. Dá uma olhada e me diz quais você gostou: ${url}${corretorNome ? `\n${corretorNome.split(" ")[0]}` : ""}`;
  const visiveis = verTodos ? lista : lista.slice(0, 6);

  return (
    <section className="rounded-lg border bg-card" data-testid="compativeis">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h3 className="flex flex-1 items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-sax" /> Imóveis para este cliente
          {lista.length > 0 && <span className="font-normal text-muted-foreground">({lista.length})</span>}
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setEditando(true)} data-testid="perfil-editar">
          <SlidersHorizontal className="h-3.5 w-3.5" /> {perfil ? "Perfil de busca" : "Definir perfil"}
        </Button>
      </header>

      {!perfil ? (
        <div className="space-y-3 px-4 py-5 text-center">
          <p className="text-sm text-muted-foreground">Diga o que o cliente procura e o CRM mostra os imóveis da carteira que combinam, com nota e motivo.</p>
          <div className="flex flex-wrap justify-center gap-2">
            {perfilResp?.sugestao && (
              <Button size="sm" onClick={() => salvarPerfil.mutate(perfilResp.sugestao!)} disabled={salvarPerfil.isPending}>
                Usar o imóvel de interesse como base
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
              Preencher perfil
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 border-b bg-muted/30 px-4 py-2">
            {resumoPerfil(perfil).map((t) => (
              <span key={t} className="rounded-full bg-card px-2 py-0.5 text-xs font-medium ring-1 ring-border">
                {t}
              </span>
            ))}
          </div>
          {isLoading ? (
            <div className="m-4 h-20 animate-pulse rounded bg-muted" />
          ) : !lista.length ? (
            <p className="px-4 py-5 text-center text-sm text-muted-foreground">Nenhum imóvel da carteira combina com este perfil agora. Quando entrar um, ele aparece no histórico do negócio.</p>
          ) : (
            <ul className="divide-y">
              {visiveis.map((c) => {
                const marcado = selecionados.includes(c.imovel.id);
                return (
                  <li key={c.imovel.id} className={cn("flex items-start gap-3 px-4 py-3", marcado && "bg-accent/50")}>
                    <Checkbox
                      checked={marcado}
                      onCheckedChange={(v) => setSelecionados((s) => (v ? [...s, c.imovel.id] : s.filter((x) => x !== c.imovel.id)))}
                      className="mt-3"
                      aria-label={`Selecionar ${c.imovel.titulo}`}
                    />
                    {c.imovel.foto_url ? (
                      <img src={c.imovel.foto_url} alt="" className="h-14 w-20 shrink-0 rounded-md bg-muted object-cover" />
                    ) : (
                      <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Building2 className="h-5 w-5 text-muted-foreground/60" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <a href={`/imoveis?id=${c.imovel.id}`} className="block truncate text-sm font-semibold hover:text-primary">
                        {c.imovel.titulo}
                      </a>
                      <p className="truncate text-xs text-muted-foreground">
                        {[c.imovel.codigo, c.imovel.bairro, c.imovel.cidade].filter(Boolean).join(" · ")}
                        <span className="num ml-2 font-semibold text-foreground">{brlCompacto(c.imovel.valor)}</span>
                      </p>
                      <p className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs">
                        {c.motivos.map((m) => (
                          <span key={m} className="flex items-center gap-0.5 text-hoje">
                            <Check className="h-3 w-3" /> {m}
                          </span>
                        ))}
                        {c.alertas.map((m) => (
                          <span key={m} className="flex items-center gap-0.5 text-[#a26a00] dark:text-sem-atividade">
                            <AlertTriangle className="h-3 w-3" /> {m}
                          </span>
                        ))}
                      </p>
                      {(c.enviado_em || c.reacao) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {c.enviado_em && `Enviado em ${dataHoraBR(c.enviado_em)}`}
                          {c.reacao && <span className={cn("ml-2 font-semibold", REACAO[c.reacao].cor)}>{REACAO[c.reacao].rotulo}</span>}
                        </p>
                      )}
                    </div>
                    <Nota score={c.score} />
                  </li>
                );
              })}
            </ul>
          )}
          {lista.length > 6 && (
            <button type="button" onClick={() => setVerTodos(!verTodos)} className="w-full border-t py-2 text-xs font-medium text-primary hover:bg-muted/50">
              {verTodos ? "Mostrar menos" : `Ver todos os ${lista.length}`}
            </button>
          )}
          {selecionados.length > 0 && (
            <div className="sticky bottom-0 flex items-center gap-2 border-t bg-card px-4 py-2.5">
              <span className="flex-1 text-sm">
                <strong>{selecionados.length}</strong> selecionado(s)
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSelecionados([])}>
                Limpar
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setLink(null);
                  setMensagem("");
                  setEnviar(true);
                }}
                data-testid="vitrine-enviar"
              >
                <Send className="h-3.5 w-3.5" /> Enviar ao cliente
              </Button>
            </div>
          )}
        </>
      )}

      {vitrines.length > 0 && (
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Vitrines enviadas</p>
          <ul className="space-y-2">
            {vitrines.map((v) => {
              const contagem = (r: string) => v.reacoes.filter((x) => x.reacao === r).length;
              return (
                <li key={v.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", !v.ativa && "opacity-55")}>
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">
                    {v.imovel_ids.length} imóve{v.imovel_ids.length > 1 ? "is" : "l"} em {dataHoraBR(v.criado_em)}
                  </span>
                  <span className={cn("flex items-center gap-1 text-xs", v.visualizada_em ? "text-hoje" : "text-muted-foreground")}>
                    <Eye className="h-3 w-3" /> {v.visualizada_em ? "Aberta" : "Não aberta"}
                  </span>
                  {contagem("quero_visitar") > 0 && <span className="text-xs font-semibold text-primary">{contagem("quero_visitar")} quer visitar</span>}
                  {contagem("gostei") > 0 && <span className="text-xs font-semibold text-hoje">{contagem("gostei")} gostou</span>}
                  {contagem("nao_gostei") > 0 && <span className="text-xs text-muted-foreground">{contagem("nao_gostei")} descartado</span>}
                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => novoLink.mutate(v.id)} title="Gera um novo link (o anterior deixa de valer)">
                      <RefreshCw className="h-3 w-3" /> Reenviar
                    </Button>
                    {v.ativa && (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => desativar.mutate(v.id)}>
                        Desativar
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <PerfilDialog
        aberto={editando}
        inicial={perfil ?? perfilResp?.sugestao ?? PERFIL_VAZIO}
        onFechar={() => setEditando(false)}
        onSalvar={(p) => salvarPerfil.mutate(p)}
        salvando={salvarPerfil.isPending}
      />

      <Dialog open={enviar} onOpenChange={(v) => !v && setEnviar(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{link ? "Vitrine pronta" : `Enviar ${selecionados.length} imóve${selecionados.length > 1 ? "is" : "l"}`}</DialogTitle>
            <DialogDescription>
              {link
                ? "O cliente vê fotos e dados, sem o endereço exato, e marca o que gostou. Cada resposta aparece no histórico."
                : "O cliente recebe um link com os imóveis escolhidos e responde ali mesmo."}
            </DialogDescription>
          </DialogHeader>
          {link ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm" data-testid="vitrine-link">
                  {link}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copiar link"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link);
                    toast.success("Link copiado");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <DialogFooter className="gap-2">
                <a href={link} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium hover:bg-muted">
                  Ver como o cliente
                </a>
                {linkWhatsapp(clienteTelefone, textoWhats(link)) && (
                  <a
                    href={linkWhatsapp(clienteTelefone, textoWhats(link))!}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#25d366] px-3 text-sm font-semibold text-[#073b1e] hover:brightness-95"
                  >
                    <MessageCircle className="h-4 w-4" /> Enviar no WhatsApp
                  </a>
                )}
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="vitrine-msg">Recado para o cliente (opcional)</Label>
                <Textarea id="vitrine-msg" rows={3} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Separei estas opções no perfil que conversamos. O da Vila Mariana aceita financiamento." />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setEnviar(false)}>
                  Cancelar
                </Button>
                <Button onClick={() => criarVitrine.mutate()} disabled={criarVitrine.isPending} data-testid="vitrine-criar">
                  Gerar link
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
