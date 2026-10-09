import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Clock,
  MapPin,
  SquareKanban,
  Users,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiGet } from "@/lib/api";
import { brl, brlCompacto, mesLabel } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import type { Imovel, Lead, LeadMetricas, MinhasComissoes, ResumoFinanceiro } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusImovelBadge } from "@/components/shared/badges";
import { cn } from "@/lib/utils";
import MeuDia from "@/components/crm/MeuDia";
import FunilTrapezios from "@/components/crm/FunilTrapezios";
import type { Relatorio } from "@/lib/relatorio";
import { isoLocal } from "@/lib/crm";

const CORES = ["#1f6f5c", "#b8862f", "#4f7cac", "#8a5a9e", "#c25b3f", "#2f8f9d", "#6b7f2a"];

function StatCard({
  titulo,
  valor,
  sub,
  icon: Icon,
  teste,
  tinta,
}: {
  titulo: string;
  valor: string;
  sub?: string;
  icon: typeof Building2;
  teste: string;
  tinta: string;
}) {
  return (
    <Card data-testid={teste}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-muted-foreground">{titulo}</p>
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tinta)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-2 truncate font-heading text-2xl font-bold tracking-tight">{valor}</p>
        {sub && <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { isAdmin } = useAuth();
  const imoveisQ = useQuery({ queryKey: ["imoveis"], queryFn: () => apiGet<Imovel[]>("/imoveis") });
  const leadsQ = useQuery({ queryKey: ["leads"], queryFn: () => apiGet<Lead[]>("/leads") });
  const metricasQ = useQuery({ queryKey: ["metricas"], queryFn: () => apiGet<LeadMetricas>("/leads/metricas") });
  // Fluxo de caixa é do gestor; o corretor vê o resumo das próprias comissões.
  const resumoQ = useQuery({
    queryKey: ["resumo"],
    queryFn: () => apiGet<ResumoFinanceiro>("/resumo"),
    enabled: isAdmin,
  });
  const comissoesQ = useQuery({
    queryKey: ["minhas-comissoes"],
    queryFn: () => apiGet<MinhasComissoes>("/minhas-comissoes"),
    enabled: !isAdmin,
  });

  const inicioMes = isoLocal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const { data: funilMes } = useQuery({
    queryKey: ["metricas", "dashboard", inicioMes],
    queryFn: () => apiGet<Relatorio>(`/relatorios/funil?inicio=${inicioMes}`),
  });
  const imoveis = imoveisQ.data ?? [];
  const leads = leadsQ.data ?? [];
  const metricas = metricasQ.data;
  const resumo = resumoQ.data;
  const comissoes = comissoesQ.data;

  const captados = imoveis.filter((i) => i.status === "captado").length;
  const publicados = imoveis.filter((i) => i.status === "publicado").length;
  const ativos = captados + publicados;
  const leadsAbertos = leads.filter((l) => (l.status ?? "aberto") === "aberto");

  const origens = metricas?.origens ?? [];

  return (
    <div className="flex flex-col gap-6">
      <MeuDia />
      <section
        data-testid="dashboard-kpis"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-4"
      >
        <StatCard
          titulo="Imóveis ativos"
          valor={imoveisQ.isLoading ? "…" : String(ativos)}
          sub={`${captados} captados · ${publicados} publicados`}
          icon={Building2}
          teste="kpi-imoveis-ativos"
          tinta="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
        />
        <StatCard
          titulo="Negócios em andamento"
          valor={metricasQ.isLoading ? "…" : String(leadsAbertos.length)}
          sub={metricas ? `${brlCompacto(metricas.valor_aberto)} em negociação` : ""}
          icon={Users}
          teste="kpi-leads-abertos"
          tinta="bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
        />
        <StatCard
          titulo={isAdmin ? "A receber (pendente)" : "Comissões a receber"}
          valor={
            isAdmin
              ? resumoQ.isLoading
                ? "…"
                : brl(resumo?.a_receber_pendente ?? null)
              : comissoesQ.isLoading
                ? "…"
                : brl(comissoes?.comissoes_a_receber ?? null)
          }
          sub={isAdmin ? "Contas a receber em aberto" : "Comissões dos seus negócios"}
          icon={ArrowUpRight}
          teste="kpi-a-receber"
          tinta="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        />
        <StatCard
          titulo={isAdmin ? "A pagar (pendente)" : "Comissões recebidas"}
          valor={
            isAdmin
              ? resumoQ.isLoading
                ? "…"
                : brl(resumo?.a_pagar_pendente ?? null)
              : comissoesQ.isLoading
                ? "…"
                : brl(comissoes?.comissoes_recebidas ?? null)
          }
          sub={isAdmin ? "Contas a pagar em aberto" : `${comissoes?.leads_ganhos ?? 0} negócio(s) fechado(s)`}
          icon={ArrowDownRight}
          teste="kpi-a-pagar"
          tinta={
            isAdmin
              ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          }
        />
      </section>

      <section className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        {isAdmin && (
          <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Fluxo de caixa — últimos 6 meses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64" data-testid="dashboard-cashflow-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={resumo?.fluxo_mensal ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.25)" />
                  <XAxis
                    dataKey="mes"
                    tickFormatter={(m) => mesLabel(String(m))}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => brlCompacto(Number(v))}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    width={76}
                  />
                  <Tooltip
                    formatter={(value, name) => [brl(Number(value)), String(name)]}
                    labelFormatter={(label) => mesLabel(String(label))}
                  />
                  <Legend />
                  <Bar dataKey="receitas" name="Receitas" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="despesas" name="Despesas" fill="#dc2626" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="saldo" name="Saldo" stroke="#0284c7" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        )}

        <Card className={isAdmin ? "" : "lg:col-span-3"}>
          <CardHeader>
            <CardTitle className="text-base">Origem dos leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64" data-testid="dashboard-origin-chart">
              {origens.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Sem leads cadastrados ainda.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={origens}
                      dataKey="total"
                      nameKey="origem"
                      innerRadius={48}
                      outerRadius={78}
                      paddingAngle={2}
                    >
                      {origens.map((_, i) => (
                        <Cell key={i} fill={CORES[i % CORES.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${String(value)} lead(s)`, String(name)]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Funil do mês</CardTitle>
            <Link
              to="/relatorios"
              data-testid="dashboard-link-crm"
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <SquareKanban className="h-3.5 w-3.5" /> Ver relatório
            </Link>
          </CardHeader>
          <CardContent>
            {funilMes?.criados ? (
              <FunilTrapezios etapas={funilMes.funil} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Nenhum negócio criado este mês.</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">Negócios criados este mês no funil {funilMes?.funil_nome}, pela etapa mais avançada que alcançaram.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Imóveis na carteira</CardTitle>
            <Link
              to="/imoveis"
              data-testid="dashboard-link-imoveis"
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <Building2 className="h-3.5 w-3.5" /> Ver todos
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {imoveisQ.isLoading && <p className="text-sm text-muted-foreground">Carregando imóveis…</p>}
            {!imoveisQ.isLoading && imoveis.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum imóvel cadastrado ainda.</p>
            )}
            {imoveis.slice(0, 5).map((i) => (
              <div key={i.id} className="flex items-center gap-3 rounded-md border p-2 transition-colors hover:bg-muted/40">
                <div className="h-10 w-14 shrink-0 overflow-hidden rounded bg-muted">
                  {i.foto_url ? (
                    <img src={i.foto_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <Building2 className="h-4 w-4" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.titulo}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {i.bairro ? `${i.bairro} · ` : ""}
                    {i.cidade}
                  </p>
                </div>
                <StatusImovelBadge status={i.status} />
                <span className="hidden w-24 shrink-0 text-right font-mono text-xs font-semibold sm:block">
                  {brlCompacto(i.valor_venda ?? i.valor_aluguel)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3" data-testid="dashboard-tempo-fechamento">
          <Clock className="h-4 w-4 text-primary" />
          <div>
            <p className="text-[11px] text-muted-foreground">Tempo médio p/ fechar</p>
            <p className="font-mono text-sm font-semibold">
              {metricas?.tempo_medio_fechamento_dias != null ? `${metricas.tempo_medio_fechamento_dias} dias` : "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3" data-testid="dashboard-taxa-conversao">
          <SquareKanban className="h-4 w-4 text-primary" />
          <div>
            <p className="text-[11px] text-muted-foreground">Taxa de conversão</p>
            <p className="font-mono text-sm font-semibold">
              {metricas?.taxa_conversao != null ? `${metricas.taxa_conversao}%` : "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3" data-testid="dashboard-recebido-mes">
          <ArrowUpRight className="h-4 w-4 text-emerald-600" />
          <div>
            <p className="text-[11px] text-muted-foreground">
              {isAdmin ? "Recebido no mês" : "Comissões recebidas"}
            </p>
            <p className="font-mono text-sm font-semibold">
              {isAdmin ? brl(resumo?.recebido_mes ?? null) : brl(comissoes?.comissoes_recebidas ?? null)}
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3" data-testid="dashboard-pago-mes">
            <ArrowDownRight className="h-4 w-4 text-red-600" />
            <div>
              <p className="text-[11px] text-muted-foreground">Pago no mês</p>
              <p className="font-mono text-sm font-semibold">{brl(resumo?.pago_mes ?? null)}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
