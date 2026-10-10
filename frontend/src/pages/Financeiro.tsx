import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { useConfig } from "@/lib/useConfig";
import { apiGet } from "@/lib/api";
import { brl } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import type {
  Imovel,
  MinhasComissoes,
  PlanoConta,
  ResumoFinanceiro,
  TransacaoFinanceira,
} from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LancamentosTab from "@/components/financeiro/LancamentosTab";
import PlanoContasTab from "@/components/financeiro/PlanoContasTab";
import RelatoriosTab from "@/components/financeiro/RelatoriosTab";

export default function Financeiro() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin } = useAuth();

  const transacoesQ = useQuery({
    queryKey: ["transacoes"],
    queryFn: () => apiGet<TransacaoFinanceira[]>("/transacoes"),
  });
  const contasQ = useQuery({ queryKey: ["plano-contas"], queryFn: () => apiGet<PlanoConta[]>("/plano-contas") });
  const { moduloAtivo } = useConfig();
  const imoveisQ = useQuery({ queryKey: ["imoveis"], queryFn: () => apiGet<Imovel[]>("/imoveis"), enabled: moduloAtivo("imoveis") });

  // Fluxo de caixa e DRE são do gestor; o corretor recebe o resumo das próprias comissões.
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

  if (!isAdmin) {
    const c = comissoesQ.data;
    return (
      <div className="flex flex-col gap-5" data-testid="financeiro-corretor">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Chip teste="comissao-recebida" label="Comissões recebidas" valor={brl(c?.comissoes_recebidas ?? null)} />
          <Chip teste="comissao-a-receber" label="Comissões a receber" valor={brl(c?.comissoes_a_receber ?? null)} />
          <Chip teste="comissao-leads" label="Leads na carteira" valor={String(c?.total_leads ?? 0)} />
          <Chip teste="comissao-ganhos" label="Negócios fechados" valor={String(c?.leads_ganhos ?? 0)} />
        </section>

        <div
          className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/40 p-4"
          data-testid="financeiro-restrito-aviso"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            O fluxo de caixa da imobiliária, o plano de contas e o resultado por imóvel são
            exclusivos do gestor. Abaixo estão apenas as comissões dos seus negócios.
          </p>
        </div>

        <LancamentosTab
          transacoes={transacoesQ.data ?? []}
          contas={contasQ.data ?? []}
          imoveis={imoveisQ.data ?? []}
          resumo={undefined}
          carregando={transacoesQ.isLoading}
          abrirNovo={false}
          onConsumirNovo={() => undefined}
          somenteLeitura
        />
      </div>
    );
  }

  return (
    <Tabs defaultValue="lancamentos" className="flex flex-col gap-5">
      <TabsList>
        <TabsTrigger value="lancamentos" data-testid="financeiro-tab-lancamentos">
          Lançamentos
        </TabsTrigger>
        <TabsTrigger value="plano" data-testid="financeiro-tab-plano-contas">
          Plano de Contas
        </TabsTrigger>
        <TabsTrigger value="relatorios" data-testid="financeiro-tab-relatorios">
          Relatórios
        </TabsTrigger>
      </TabsList>

      <TabsContent value="lancamentos">
        <LancamentosTab
          transacoes={transacoesQ.data ?? []}
          contas={contasQ.data ?? []}
          imoveis={imoveisQ.data ?? []}
          resumo={resumoQ.data}
          carregando={transacoesQ.isLoading}
          abrirNovo={searchParams.get("novo") === "1"}
          onConsumirNovo={() => setSearchParams({}, { replace: true })}
        />
      </TabsContent>

      <TabsContent value="plano">
        <PlanoContasTab contas={contasQ.data ?? []} carregando={contasQ.isLoading} />
      </TabsContent>

      <TabsContent value="relatorios">
        <RelatoriosTab resumo={resumoQ.data} carregando={resumoQ.isLoading} />
      </TabsContent>
    </Tabs>
  );
}

function Chip({ teste, label, valor }: { teste: string; label: string; valor: string }) {
  return (
    <Card data-testid={teste}>
      <CardContent className="p-5">
        <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
        <p className="mt-1.5 truncate font-mono text-lg font-semibold">{valor}</p>
      </CardContent>
    </Card>
  );
}
