import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3, Building, Download, LogIn, Mail, Plus, ShieldCheck, Upload } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import type { Ambiente, EmpresaResumo, UsoEmpresa } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCatalogoPlanos } from "@/lib/diferenciais";
import { cn } from "@/lib/utils";

function Uso({ rotulo, uso, limite }: { rotulo: string; uso: number; limite: number | null }) {
  const cheio = limite != null && uso >= limite;
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span className="text-muted-foreground">{rotulo}</span>
        <span className={cn("num font-semibold", cheio && "text-atrasada")}>
          {uso}
          {limite != null ? `/${limite}` : ""}
        </span>
      </div>
      {limite != null && (
        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full", cheio ? "bg-atrasada" : "bg-primary")} style={{ width: `${Math.min(100, (uso / limite) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export default function Empresas() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const [usoAberto, setUsoAberto] = useState<string | null>(null);
  const { data: catalogo } = useCatalogoPlanos();
  const [form, setForm] = useState({
    plano: "profissional",
    nome: "",
    slug: "",
    cnpj: "",
    admin_nome: "",
    admin_email: "",
    admin_senha: "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: empresas = [], isLoading } = useQuery({
    queryKey: ["empresas"],
    queryFn: () => apiGet<EmpresaResumo[]>("/empresas"),
  });
  const { data: ambiente } = useQuery({
    queryKey: ["ambiente"],
    queryFn: () => apiGet<Ambiente>("/empresas/ambiente"),
  });

  const criar = useMutation({
    mutationFn: () =>
      apiPost<EmpresaResumo>("/empresas", {
        nome: form.nome.trim(),
        slug: form.slug.trim() || null,
        cnpj: form.cnpj.trim() || null,
        admin_nome: form.admin_nome.trim(),
        admin_email: form.admin_email.trim(),
        admin_senha: form.admin_senha.trim() || null,
        plano: form.plano,
        enviar_convite: true,
      }),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ["empresas"] });
      qc.invalidateQueries({ queryKey: ["uso-empresas"] });
      setModal(false);
      setForm({ plano: "profissional", nome: "", slug: "", cnpj: "", admin_nome: "", admin_email: "", admin_senha: "" });
      toast.success(`Empresa ${e.nome} criada`, {
        description: e.convite_enviado
          ? `Link de ativação enfileirado para ${form.admin_email}`
          : `Banco próprio: ${e.db_name}. Convite não enviado — confira o e-mail do gestor.`,
      });
    },
    onError: (err) => toast.error(detalheErro(err) ?? "Não foi possível criar a empresa."),
  });

  const alternar = useMutation({
    mutationFn: (e: EmpresaResumo) => apiPatch(`/empresas/${e.id}`, { ativo: !e.ativo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["empresas"] });
      toast.success("Situação da empresa atualizada.");
    },
    onError: (err) => toast.error(detalheErro(err) ?? "Não foi possível atualizar."),
  });

  const mudarPlano = useMutation({
    mutationFn: ({ e, plano }: { e: EmpresaResumo; plano: string }) => apiPatch(`/empresas/${e.id}`, { plano }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["empresas"] });
      toast.success("Plano atualizado. Módulos e limites aplicados.");
    },
    onError: (err) => toast.error(detalheErro(err) ?? "Não foi possível mudar o plano."),
  });

  const excluir = useMutation({
    mutationFn: (e: EmpresaResumo) => apiDelete(`/empresas/${e.id}?confirmar=${e.slug}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["empresas"] });
      toast.success("Empresa e banco de dados excluídos.");
    },
    onError: (err) => toast.error(detalheErro(err) ?? "Não foi possível excluir."),
  });

  const acessar = useMutation({
    mutationFn: (e: EmpresaResumo) => apiPost(`/empresas/${e.id}/acessar`),
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast.success("Você entrou na empresa (modo suporte).");
      window.location.href = "/";
    },
    onError: (err) => toast.error(detalheErro(err) ?? "Não foi possível entrar na empresa."),
  });

  const reenviar = useMutation({
    mutationFn: (e: EmpresaResumo) => apiPost<{ enviado: boolean; email: string }>(`/empresas/${e.id}/reenviar-convite`),
    onSuccess: (r) => toast.success(`Novo link de ativação enfileirado para ${r.email}.`),
    onError: (err) => toast.error(detalheErro(err) ?? "Não foi possível reenviar o convite."),
  });

  const baixarBackup = (e: EmpresaResumo) => {
    window.open(`/api/empresas/${e.id}/backup`, "_blank");
    toast.success(`Backup de ${e.nome} sendo gerado.`);
  };

  const restaurar = useMutation({
    mutationFn: ({ empresa, conteudo }: { empresa: EmpresaResumo; conteudo: unknown }) =>
      apiPost<{ restaurado: Record<string, number> }>(`/empresas/${empresa.id}/restaurar`, conteudo),
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      const total = Object.values(r.restaurado).reduce((a, b) => a + b, 0);
      toast.success(`Backup restaurado: ${total} registro(s).`);
    },
    onError: (err) => toast.error(detalheErro(err) ?? "Não foi possível restaurar o backup."),
  });

  const escolherArquivo = (empresa: EmpresaResumo, arquivo: File) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const conteudo = JSON.parse(String(leitor.result));
        if (!window.confirm(`Restaurar o backup em ${empresa.nome}? Os dados atuais serão substituídos.`)) return;
        restaurar.mutate({ empresa, conteudo });
      } catch {
        toast.error("Arquivo inválido: envie o JSON gerado pelo próprio sistema.");
      }
    };
    leitor.readAsText(arquivo);
  };

  const { data: uso = [] } = useQuery({
    queryKey: ["uso-empresas"],
    queryFn: () => apiGet<UsoEmpresa[]>("/empresas/uso"),
  });
  const usoDa = (id: string) => uso.find((u) => u.empresa_id === id);

  return (
    <div className="space-y-6" data-testid="empresas-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">
            Plano de controle
          </p>
          <h2 className="font-heading text-2xl font-bold tracking-tight">Empresas</h2>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="empresas-total">
            {isLoading
              ? "Carregando..."
              : `${empresas.length} empresa(s) · cada uma com banco de dados próprio · ambiente ${ambiente?.rotulo ?? "—"}`}
          </p>
        </div>
        <Button size="sm" onClick={() => setModal(true)} data-testid="empresa-nova-button">
          <Plus className="h-4 w-4" />
          Nova empresa
        </Button>
      </div>

      {empresas.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="empresas-receita">
          {(() => {
            const ativas = empresas.filter((e) => e.ativo);
            const mrr = ativas.reduce((s, e) => s + (e.plano_aplicado ? (e.plano_preco ?? 0) : 0), 0);
            const legado = ativas.filter((e) => !e.plano_aplicado).length;
            const noLimite = ativas.filter(
              (e) => (e.limite_usuarios != null && e.usuarios_ativos >= e.limite_usuarios) || (e.limite_imoveis != null && e.imoveis_carteira >= e.limite_imoveis),
            ).length;
            return [
              ["Receita mensal (planos)", brl(mrr), `${ativas.length - legado} empresa(s) com plano`],
              ["Ticket médio", ativas.length - legado ? brl(mrr / (ativas.length - legado)) : "—", "por empresa com plano"],
              ["No limite do plano", String(noLimite), "oportunidade de upgrade"],
              ["Sem plano (legado)", String(legado), "aplicar um plano"],
            ].map(([r, v, d]) => (
              <div key={r} className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">{r}</p>
                <p className="num text-xl font-semibold">{v}</p>
                <p className="text-[11px] text-muted-foreground">{d}</p>
              </div>
            ));
          })()}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {empresas.map((e) => (
          <Card
            key={e.id}
            className="transition-shadow duration-200 hover:shadow-md"
            data-testid={`empresa-card-${e.slug}`}
          >
            <CardHeader className="pb-3">
              <CardTitle className="flex items-start justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <Building className="h-4 w-4 text-primary" />
                  {e.nome}
                </span>
                <Badge variant={e.ativo ? "default" : "secondary"}>
                  {e.ativo ? "Ativa" : "Inativa"}
                </Badge>
              </CardTitle>
              <p className="font-mono text-xs text-muted-foreground">
                {e.slug} · {e.db_name}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 rounded-md border p-2.5" data-testid={`empresa-plano-${e.slug}`}>
                <div className="flex items-center gap-2">
                  <select
                    value={e.plano_aplicado ? e.plano : "legado"}
                    onChange={(ev) => {
                      if (window.confirm(`Mudar ${e.nome} para o plano ${ev.target.selectedOptions[0].text}? Os módulos da empresa serão ajustados ao plano.`))
                        mudarPlano.mutate({ e, plano: ev.target.value });
                    }}
                    className="h-8 flex-1 rounded-md border bg-background px-2 text-sm font-medium"
                    aria-label={`Plano de ${e.nome}`}
                  >
                    {catalogo?.planos.map((p) => (
                      <option key={p.chave} value={p.chave}>
                        {p.nome}
                      </option>
                    ))}
                    <option value="legado">Legado (sem limites)</option>
                  </select>
                  <span className="num text-sm font-semibold">{e.plano_aplicado && e.plano_preco ? `${brl(e.plano_preco)}/mês` : "—"}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Uso rotulo="Usuários ativos" uso={e.usuarios_ativos} limite={e.limite_usuarios} />
                  <Uso rotulo="Imóveis em carteira" uso={e.imoveis_carteira} limite={e.limite_imoveis} />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  ["Usuários", e.usuarios],
                  ["Imóveis", e.imoveis],
                  ["Leads", e.leads],
                  ["Contratos", e.contratos],
                ].map(([rotulo, valor]) => (
                  <div key={String(rotulo)} className="rounded-md bg-muted/50 p-2">
                    <p className="font-mono text-sm font-bold">{valor}</p>
                    <p className="text-[10px] text-muted-foreground">{rotulo}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => acessar.mutate(e)}
                  disabled={!e.ativo || acessar.isPending}
                  data-testid={`empresa-acessar-${e.slug}`}
                >
                  <LogIn className="h-4 w-4" /> Entrar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUsoAberto(usoAberto === e.id ? null : e.id)}
                  data-testid={`empresa-uso-${e.slug}`}
                >
                  <BarChart3 className="h-4 w-4" /> Uso
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reenviar.mutate(e)}
                  disabled={reenviar.isPending}
                  data-testid={`empresa-convite-${e.slug}`}
                >
                  <Mail className="h-4 w-4" /> Reenviar convite
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => baixarBackup(e)}
                  data-testid={`empresa-backup-${e.slug}`}
                >
                  <Download className="h-4 w-4" /> Backup
                </Button>
                <label
                  className={buttonVariants({ variant: "outline", size: "sm" }) + " cursor-pointer"}
                  data-testid={`empresa-restaurar-${e.slug}`}
                >
                  <Upload className="h-4 w-4" /> Restaurar
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(ev) => {
                      const arquivo = ev.target.files?.[0];
                      if (arquivo) escolherArquivo(e, arquivo);
                      ev.target.value = "";
                    }}
                  />
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => alternar.mutate(e)}
                  data-testid={`empresa-alternar-${e.slug}`}
                >
                  {e.ativo ? "Desativar" : "Ativar"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(`Excluir ${e.nome} e TODO o banco de dados dela?`)) excluir.mutate(e);
                  }}
                  data-testid={`empresa-excluir-${e.slug}`}
                >
                  Excluir
                </Button>
              </div>

              {usoAberto === e.id && (
                <div
                  className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs"
                  data-testid={`empresa-uso-painel-${e.slug}`}
                >
                  <p className="font-semibold text-muted-foreground">
                    Uso e plano
                  </p>
                  {(() => {
                    const u = usoDa(e.id);
                    if (!u) return <p className="text-muted-foreground">Carregando...</p>;
                    const linhas: [string, string][] = [
                      ["Plano", u.plano],
                      ["Usuários ativos", `${u.usuarios_ativos} de ${u.usuarios} (${u.corretores} corretores)`],
                      ["Imóveis", `${u.imoveis} (${u.imoveis_publicados} publicados)`],
                      ["Leads", `${u.leads} (${u.leads_30d} nos últimos 30 dias)`],
                      ["Contratos", `${u.contratos_ativos} ativos de ${u.contratos}`],
                      ["Visitas agendadas", String(u.visitas)],
                      ["Lançamentos financeiros", String(u.transacoes)],
                      ["Receita contratada", brl(u.receita_contratada)],
                      ["Armazenamento", `${u.armazenamento_mb.toFixed(2)} MB`],
                      [
                        "Último acesso",
                        u.ultimo_acesso ? new Date(u.ultimo_acesso).toLocaleString("pt-BR") : "nunca",
                      ],
                      ["Criada em", new Date(u.criada_em).toLocaleDateString("pt-BR")],
                    ];
                    return (
                      <div className="grid gap-1">
                        {linhas.map(([rotulo, valor]) => (
                          <div key={rotulo} className="flex items-baseline justify-between gap-2">
                            <span className="text-muted-foreground">{rotulo}</span>
                            <span className="font-medium">{valor}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Isolamento e conformidade
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>· Cada empresa tem um banco de dados próprio — nenhuma consulta cruza empresas.</p>
          <p>· A empresa vem do token de sessão, nunca de um campo da tela.</p>
          <p>· O acesso de suporte fica registrado e exibe faixa de aviso enquanto está ativo.</p>
          <p>· Excluir uma empresa apaga o banco dela, mediante confirmação do identificador.</p>
        </CardContent>
      </Card>

      <Dialog open={modal} onOpenChange={(o) => !o && setModal(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova empresa</DialogTitle>
            <DialogDescription>
              Cria o banco de dados exclusivo da empresa, o plano de contas padrão e o primeiro
              gestor.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <span className="text-sm font-medium">Plano</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {catalogo?.planos.map((p) => (
                  <button
                    key={p.chave}
                    type="button"
                    onClick={() => set("plano", p.chave)}
                    className={cn("rounded-md border p-2 text-left", form.plano === p.chave ? "border-primary ring-2 ring-primary/20" : "hover:bg-muted")}
                    data-testid={`empresa-plano-opcao-${p.chave}`}
                  >
                    <p className="text-sm font-semibold">{p.nome}</p>
                    <p className="num text-xs">{p.preco ? `${brl(p.preco)}/mês` : "sob consulta"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {p.usuarios ? `${p.usuarios} usuário${p.usuarios > 1 ? "s" : ""}` : "Usuários ilimitados"}, {p.imoveis ? `${p.imoveis} imóveis` : "imóveis ilimitados"}
                    </p>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{catalogo?.planos.find((p) => p.chave === form.plano)?.resumo}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="empresa-nome">Nome *</Label>
                <Input
                  id="empresa-nome"
                  value={form.nome}
                  onChange={(e) => set("nome", e.target.value)}
                  data-testid="empresa-nome-input"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="empresa-slug">Identificador (opcional)</Label>
                <Input
                  id="empresa-slug"
                  placeholder="gerado do nome"
                  value={form.slug}
                  onChange={(e) => set("slug", e.target.value)}
                  data-testid="empresa-slug-input"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="empresa-cnpj">CNPJ</Label>
              <Input
                id="empresa-cnpj"
                value={form.cnpj}
                onChange={(e) => set("cnpj", e.target.value)}
                data-testid="empresa-cnpj-input"
              />
            </div>
            <div className="border-t pt-3">
              <p className="mb-3 text-sm font-semibold">Primeiro gestor da empresa</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="empresa-admin-nome">Nome *</Label>
                  <Input
                    id="empresa-admin-nome"
                    value={form.admin_nome}
                    onChange={(e) => set("admin_nome", e.target.value)}
                    data-testid="empresa-admin-nome-input"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="empresa-admin-email">E-mail *</Label>
                  <Input
                    id="empresa-admin-email"
                    type="email"
                    value={form.admin_email}
                    onChange={(e) => set("admin_email", e.target.value)}
                    data-testid="empresa-admin-email-input"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="empresa-admin-senha">Senha (opcional)</Label>
                  <Input
                    id="empresa-admin-senha"
                    type="password"
                    placeholder="deixe vazio: enviamos link de ativação"
                    value={form.admin_senha}
                    onChange={(e) => set("admin_senha", e.target.value)}
                    data-testid="empresa-admin-senha-input"
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Ao criar a empresa, um link de ativação é enfileirado para o gestor definir sua senha.
                Informe uma senha acima apenas se quiser definir você mesmo.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(false)} data-testid="empresa-cancel-button">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!form.nome.trim() || !form.admin_nome.trim() || !form.admin_email.trim()) {
                  toast.error("Preencha o nome da empresa, o nome e o e-mail do gestor.");
                  return;
                }
                if (form.admin_senha.trim() && form.admin_senha.trim().length < 6) {
                  toast.error("Se informar senha, use ao menos 6 caracteres.");
                  return;
                }
                criar.mutate();
              }}
              disabled={criar.isPending}
              data-testid="empresa-submit-button"
            >
              {criar.isPending ? "Criando..." : "Criar empresa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
