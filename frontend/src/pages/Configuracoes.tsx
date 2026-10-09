import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, History, KeyRound, Palette, Puzzle, Send, Smartphone } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import type { Configuracao, ConfigLog } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PALETAS_MENU, variaveisMenu } from "@/lib/coresMenu";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const MODULOS = [
  { chave: "dashboard", rotulo: "Visão Geral", fixo: true },
  { chave: "imoveis", rotulo: "Imóveis", fixo: false },
  { chave: "crm", rotulo: "CRM & Funil", fixo: false },
  { chave: "agenda", rotulo: "Agenda de Visitas", fixo: false },
  { chave: "contratos", rotulo: "Contratos", fixo: false },
  { chave: "financeiro", rotulo: "Financeiro", fixo: false },
  { chave: "usuarios", rotulo: "Consultores & Acessos", fixo: true },
];

export default function Configuracoes() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["config"], queryFn: () => apiGet<Configuracao>("/configuracoes") });
  const { data: historico } = useQuery({
    queryKey: ["config", "historico"],
    queryFn: () => apiGet<ConfigLog[]>("/configuracoes/historico"),
  });
  const [form, setForm] = useState<Configuracao | null>(null);
  const [logoVersao, setLogoVersao] = useState(0);
  const temLogo = !!data?.logo_mime;

  const invalidarConfig = () => {
    qc.invalidateQueries({ queryKey: ["config"] });
    qc.invalidateQueries({ queryKey: ["config", "publica"] });
    qc.invalidateQueries({ queryKey: ["config", "historico"] });
  };

  const salvarLogo = useMutation({
    mutationFn: (payload: { base64: string; mime: string }) =>
      apiPut<Configuracao>("/configuracoes/logo", payload),
    onSuccess: () => {
      setLogoVersao((v) => v + 1);
      invalidarConfig();
      toast.success("Logotipo atualizado.");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível enviar o logotipo."),
  });

  const removerLogo = useMutation({
    mutationFn: () => apiDelete<Configuracao>("/configuracoes/logo"),
    onSuccess: () => {
      setLogoVersao((v) => v + 1);
      invalidarConfig();
      toast.success("Logotipo removido.");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível remover o logotipo."),
  });

  const enviarLogo = (arquivo: File) => {
    if (arquivo.size > 512 * 1024) {
      toast.error("O logotipo deve ter no máximo 512 KB.");
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => {
      const base64 = String(leitor.result).split(",")[1] ?? "";
      salvarLogo.mutate({ base64, mime: arquivo.type || "image/png" });
    };
    leitor.readAsDataURL(arquivo);
  };

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const set = <K extends keyof Configuracao>(k: K, v: Configuracao[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const salvar = useMutation({
    mutationFn: () =>
      apiPut<Configuracao>("/configuracoes", {
        nome_software: form!.nome_software,
        slogan: form!.slogan,
        modulos_ativos: form!.modulos_ativos,
        titulos_modulos: form!.titulos_modulos,
        cor_painel: form!.cor_painel,
        cor_fonte: form!.cor_fonte,
        cor_primaria: form!.cor_primaria,
        cor_menu: form!.cor_menu,
        cor_menu_destaque: form!.cor_menu_destaque,
        imagem_fundo_login: form!.imagem_fundo_login || null,
        email_remetente_nome: form!.email_remetente_nome,
        email_resposta: form!.email_resposta || null,
        whatsapp_numero: form!.whatsapp_numero || null,
        whatsapp_phone_id: form!.whatsapp_phone_id || null,
        whatsapp_token: form!.whatsapp_token || null,
        site_url: form!.site_url || null,
        site_webhook_ativo: form!.site_webhook_ativo,
      }),
    onSuccess: (c) => {
      setForm(c);
      invalidarConfig();
      toast.success("Configuração salva. As mudanças já valem para todos os usuários.");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar a configuração."),
  });

  const regerar = useMutation({
    mutationFn: () => apiPost<Configuracao>("/configuracoes/api-key"),
    onSuccess: (c) => {
      setForm(c);
      qc.invalidateQueries({ queryKey: ["config"] });
      toast.success("Nova chave de API gerada. A anterior deixou de funcionar.");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível gerar a chave."),
  });

  if (!form) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="config-carregando">
        Carregando configuração...
      </p>
    );
  }

  const alternarModulo = (chave: string, ligado: boolean) => {
    const atuais = new Set(form.modulos_ativos);
    if (ligado) atuais.add(chave);
    else atuais.delete(chave);
    set("modulos_ativos", Array.from(atuais));
  };

  const webhook = `${window.location.origin}/api/site/leads`;
  const copiar = (texto: string, rotulo: string) => {
    void navigator.clipboard?.writeText(texto);
    toast.success(`${rotulo} copiado.`);
  };

  return (
    <div className="space-y-6" data-testid="configuracoes-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">
            Configurador do sistema
          </p>
          <h2 className="font-heading text-2xl font-bold tracking-tight">{form.nome_software}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Exclusivo do Administrador de Sistema
            {form.atualizado_por ? ` · última alteração por ${form.atualizado_por}` : ""}
          </p>
        </div>
        <Button onClick={() => salvar.mutate()} disabled={salvar.isPending} data-testid="config-salvar-button">
          {salvar.isPending ? "Salvando..." : "Salvar configuração"}
        </Button>
      </div>

      <Tabs defaultValue="identidade">
        <TabsList>
          <TabsTrigger value="identidade" data-testid="config-tab-identidade">
            <Palette className="h-4 w-4" /> Identidade
          </TabsTrigger>
          <TabsTrigger value="modulos" data-testid="config-tab-modulos">
            <Puzzle className="h-4 w-4" /> Módulos
          </TabsTrigger>
          <TabsTrigger value="comunicacao" data-testid="config-tab-comunicacao">
            <Send className="h-4 w-4" /> Comunicação
          </TabsTrigger>
          <TabsTrigger value="site" data-testid="config-tab-site">
            <KeyRound className="h-4 w-4" /> Site
          </TabsTrigger>
          <TabsTrigger value="historico" data-testid="config-tab-historico">
            <History className="h-4 w-4" /> Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="identidade" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Marca e aparência</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="config-nome">Nome do software *</Label>
                  <Input
                    id="config-nome"
                    value={form.nome_software}
                    onChange={(e) => set("nome_software", e.target.value)}
                    data-testid="config-nome-input"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="config-slogan">Slogan</Label>
                  <Input
                    id="config-slogan"
                    value={form.slogan}
                    onChange={(e) => set("slogan", e.target.value)}
                    data-testid="config-slogan-input"
                  />
                </div>
              </div>

              <div className="grid gap-3 rounded-lg border p-4" data-testid="config-cores-menu">
                <div>
                  <p className="text-sm font-semibold">Cores do menu lateral</p>
                  <p className="text-xs text-muted-foreground">
                    Escolha uma combinação pronta ou defina as suas. O texto do menu ajusta o contraste sozinho.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {PALETAS_MENU.map((p) => {
                    const ativa = form.cor_menu?.toLowerCase() === p.fundo && form.cor_menu_destaque?.toLowerCase() === p.destaque;
                    return (
                      <button
                        key={p.nome}
                        type="button"
                        onClick={() => {
                          set("cor_menu", p.fundo);
                          set("cor_menu_destaque", p.destaque);
                        }}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                          ativa ? "border-primary ring-2 ring-primary/20" : "hover:bg-muted",
                        )}
                        data-testid={`paleta-menu-${p.nome}`}
                      >
                        <span className="flex h-5 w-8 overflow-hidden rounded border">
                          <span className="h-full w-2/3" style={{ background: p.fundo }} />
                          <span className="h-full w-1/3" style={{ background: p.destaque }} />
                        </span>
                        {p.nome}
                      </button>
                    );
                  })}
                </div>
                <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <CorCampo id="config-cor-menu" rotulo="Fundo do menu" valor={form.cor_menu ?? ""} onChange={(v) => set("cor_menu", v)} />
                  <CorCampo
                    id="config-cor-menu-destaque"
                    rotulo="Destaque do menu (item ativo e contadores)"
                    valor={form.cor_menu_destaque ?? ""}
                    onChange={(v) => set("cor_menu_destaque", v)}
                  />
                  <PreviaMenu fundo={form.cor_menu} destaque={form.cor_menu_destaque} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <CorCampo
                  id="config-cor-primaria"
                  rotulo="Cor dos botões e links"
                  valor={form.cor_primaria}
                  onChange={(v) => set("cor_primaria", v)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="config-logo">Logotipo da imobiliária (PNG, JPG ou WEBP · até 512 KB)</Label>
                <div className="flex flex-wrap items-center gap-3">
                  {temLogo && (
                    <img
                      src={`/api/configuracoes/logo?v=${logoVersao}`}
                      alt="Logotipo atual"
                      className="h-14 w-14 rounded-md border object-contain p-1"
                      data-testid="config-logo-preview"
                    />
                  )}
                  <Input
                    id="config-logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="max-w-xs"
                    onChange={(e) => {
                      const arquivo = e.target.files?.[0];
                      if (arquivo) enviarLogo(arquivo);
                      e.target.value = "";
                    }}
                    data-testid="config-logo-input"
                  />
                  {temLogo && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removerLogo.mutate()}
                      disabled={removerLogo.isPending}
                      data-testid="config-logo-remover-button"
                    >
                      Remover logotipo
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Aparece no menu lateral, na tela de login e no topo dos e-mails enviados aos
                  clientes e corretores.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="config-fundo">Imagem de fundo da tela inicial (URL https)</Label>
                <Input
                  id="config-fundo"
                  placeholder="https://..."
                  value={form.imagem_fundo_login ?? ""}
                  onChange={(e) => set("imagem_fundo_login", e.target.value)}
                  data-testid="config-fundo-input"
                />
                {form.imagem_fundo_login && (
                  <img
                    src={form.imagem_fundo_login}
                    alt="Pré-visualização do fundo"
                    className="mt-1 h-28 w-full rounded-md object-cover"
                    data-testid="config-fundo-preview"
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="modulos" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Módulos disponíveis e títulos</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {MODULOS.map((m) => (
                <div
                  key={m.chave}
                  className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                  data-testid={`config-modulo-${m.chave}`}
                >
                  <label className="flex min-w-48 items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={form.modulos_ativos.includes(m.chave)}
                      disabled={m.fixo}
                      onCheckedChange={(c) => alternarModulo(m.chave, c === true)}
                      data-testid={`config-modulo-check-${m.chave}`}
                    />
                    {m.rotulo}
                    {m.fixo && <span className="text-[11px] text-muted-foreground">(sempre ativo)</span>}
                  </label>
                  <Input
                    className="max-w-xs"
                    value={form.titulos_modulos[m.chave] ?? ""}
                    placeholder={`Título exibido para ${m.rotulo}`}
                    onChange={(e) =>
                      set("titulos_modulos", { ...form.titulos_modulos, [m.chave]: e.target.value })
                    }
                    data-testid={`config-titulo-${m.chave}`}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="comunicacao" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">E-mail enviado aos clientes</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="config-remetente">Nome do remetente</Label>
                <Input
                  id="config-remetente"
                  value={form.email_remetente_nome}
                  onChange={(e) => set("email_remetente_nome", e.target.value)}
                  data-testid="config-remetente-input"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="config-resposta">E-mail de resposta</Label>
                <Input
                  id="config-resposta"
                  placeholder="contato@suaimobiliaria.com.br"
                  value={form.email_resposta ?? ""}
                  onChange={(e) => set("email_resposta", e.target.value)}
                  data-testid="config-resposta-input"
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                O envio usa a infraestrutura gerenciada da Emergent: o endereço de origem é fixo e o
                nome acima é o que o cliente vê.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Smartphone className="h-4 w-4" /> WhatsApp
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="config-wa-numero">Número (com DDI)</Label>
                <Input
                  id="config-wa-numero"
                  placeholder="+55 11 99999-0000"
                  value={form.whatsapp_numero ?? ""}
                  onChange={(e) => set("whatsapp_numero", e.target.value)}
                  data-testid="config-wa-numero-input"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="config-wa-id">Phone Number ID</Label>
                <Input
                  id="config-wa-id"
                  value={form.whatsapp_phone_id ?? ""}
                  onChange={(e) => set("whatsapp_phone_id", e.target.value)}
                  data-testid="config-wa-id-input"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="config-wa-token">Token</Label>
                <Input
                  id="config-wa-token"
                  type="password"
                  value={form.whatsapp_token ?? ""}
                  onChange={(e) => set("whatsapp_token", e.target.value)}
                  data-testid="config-wa-token-input"
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-3">
                Nesta etapa os dados ficam guardados para a integração — nenhuma mensagem de
                WhatsApp é enviada ainda.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="site" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Integração automática com o site</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="config-site-url">URL do site</Label>
                <Input
                  id="config-site-url"
                  placeholder="https://suaimobiliaria.com.br"
                  value={form.site_url ?? ""}
                  onChange={(e) => set("site_url", e.target.value)}
                  data-testid="config-site-url-input"
                />
              </div>

              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={form.site_webhook_ativo}
                  onCheckedChange={(c) => set("site_webhook_ativo", c === true)}
                  data-testid="config-site-ativo-check"
                />
                Receber leads do site automaticamente
              </label>

              <div className="grid gap-2">
                <Label>Endpoint do webhook (POST)</Label>
                <div className="flex gap-2">
                  <Input readOnly value={webhook} className="font-mono text-xs" data-testid="config-webhook-url" />
                  <Button variant="outline" size="icon" onClick={() => copiar(webhook, "Endereço")} aria-label="Copiar endpoint">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Chave de API (header X-API-Key)</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={form.site_api_key ?? ""}
                    className="font-mono text-xs"
                    data-testid="config-api-key"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copiar(form.site_api_key ?? "", "Chave")}
                    aria-label="Copiar chave"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => regerar.mutate()}
                    disabled={regerar.isPending}
                    data-testid="config-regerar-key-button"
                  >
                    Gerar nova
                  </Button>
                </div>
              </div>

              <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-[11px] leading-relaxed">
{`curl -X POST ${webhook} \\
  -H "X-API-Key: ${form.site_api_key ?? ""}" \\
  -H "Content-Type: application/json" \\
  -d '{"nome":"Fulano","email":"fulano@email.com","telefone":"11999990000","codigo_imovel":"AP-0001","mensagem":"Quero visitar"}'`}
              </pre>
              <p className="text-xs text-muted-foreground">
                Cada chamada cria o cliente no cadastro único e um lead no estágio "Novo", já
                vinculado ao imóvel quando o código é informado.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="historico" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quem mudou o quê e quando</CardTitle>
            </CardHeader>
            <CardContent>
              {(historico ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="config-historico-vazio">
                  Nenhuma alteração registrada ainda.
                </p>
              ) : (
                <div className="space-y-2" data-testid="config-historico-lista">
                  {(historico ?? []).map((h) => (
                    <div
                      key={h.id}
                      className="rounded-md border p-3 text-sm transition-colors duration-150 hover:bg-accent/40"
                      data-testid={`config-historico-${h.id}`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-semibold">{h.campo}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(h.em).toLocaleString("pt-BR")} · {h.usuario}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="line-through">{h.de ?? "—"}</span> →{" "}
                        <span className="font-medium text-foreground">{h.para ?? "—"}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PreviaMenu({ fundo, destaque }: { fundo: string; destaque: string }) {
  const v = variaveisMenu(fundo, destaque);
  if (!v) return <div className="h-[92px] w-[64px] rounded-md border bg-muted" />;
  return (
    <div
      className="flex h-[92px] w-[64px] flex-col items-center gap-1.5 rounded-md border p-2"
      style={{ background: v["--sidebar"] }}
      aria-label="Prévia do menu"
    >
      <span className="text-[11px] font-black" style={{ color: v["--sidebar-primary"] }}>SAX</span>
      <span className="relative h-4 w-full rounded" style={{ background: v["--sidebar-accent"] }}>
        <span className="absolute inset-y-0.5 left-0 w-[2px] rounded" style={{ background: v["--sidebar-primary"] }} />
      </span>
      <span className="h-1.5 w-8 rounded" style={{ background: v["--sidebar-foreground"], opacity: 0.6 }} />
      <span className="h-1.5 w-8 rounded" style={{ background: v["--sidebar-foreground"], opacity: 0.6 }} />
    </div>
  );
}

function CorCampo({
  id,
  rotulo,
  valor,
  onChange,
}: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(valor) ? valor : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border"
          aria-label={rotulo}
          data-testid={`${id}-picker`}
        />
        <Input id={id} value={valor} onChange={(e) => onChange(e.target.value)} data-testid={`${id}-input`} />
      </div>
    </div>
  );
}
