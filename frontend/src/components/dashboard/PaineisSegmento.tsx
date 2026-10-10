import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, Car, Globe, MessageCircle, Plus, TrendingUp, Users } from "lucide-react";
import { apiGet } from "@/lib/api";
import { brl, brlCompacto } from "@/lib/format";
import { STATUS_AG, type Agendamento } from "@/lib/atendimentos";
import { useSegmento } from "@/lib/segmento";
import { useAuth } from "@/lib/useAuth";
import { cn } from "@/lib/utils";
import PainelOcupacao from "@/components/barbearia/PainelOcupacao";

function Kpi({ rotulo, valor, detalhe, icone: Icone, alerta }: { rotulo: string; valor: string; detalhe?: string; icone: typeof Users; alerta?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-4", alerta && "border-amber-300")}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rotulo}</p>
        <Icone className="h-4 w-4 text-primary" />
      </div>
      <p className="num mt-2 truncate text-2xl font-bold">{valor}</p>
      {detalhe && <p className="mt-0.5 truncate text-xs text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

interface Resumo {
  hoje: Agendamento[];
  proximos_7_dias: number;
  mes: { agendados: number; concluidos: number; faltas: number; taxa_falta: number; faturado: number; ticket_medio: number | null; online: number };
}

/** Visão geral de barbearia, clínicas, dentista e estética: o dia de hoje e o mês. */
export function PainelAtendimento() {
  const seg = useSegmento();
  const { principal } = useAuth();
  const r = useQuery({ queryKey: ["atendimentos-resumo"], queryFn: () => apiGet<Resumo>("/atendimentos/resumo") });
  const retorno = useQuery({ queryKey: ["retorno"], queryFn: () => apiGet<unknown[]>("/atendimentos/retorno") });
  const d = r.data;
  const primeiroNome = principal?.nome.split(" ")[0];
  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">Olá, {primeiroNome}</h2>
          <p className="text-sm text-muted-foreground">{d ? `${d.hoje.length} ${seg.termos.atendimentos.toLowerCase()} hoje, ${d.proximos_7_dias} nos próximos 7 dias.` : "Carregando a agenda."}</p>
        </div>
        <Link to="/atendimentos" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4" /> Abrir agenda</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icone={TrendingUp} rotulo="Faturado no mês" valor={d ? brl(d.mes.faturado) : "-"} detalhe={d?.mes.ticket_medio ? `ticket médio ${brl(d.mes.ticket_medio)}` : undefined} />
        <Kpi icone={CalendarClock} rotulo={`${seg.termos.atendimentos} concluídos`} valor={String(d?.mes.concluidos ?? "-")} detalhe={d ? `${d.mes.agendados} agendados no mês` : undefined} />
        <Kpi icone={AlertTriangle} rotulo="Faltas" valor={d ? `${d.mes.taxa_falta}%` : "-"} detalhe={d ? `${d.mes.faltas} no mês` : undefined} alerta={!!d && d.mes.taxa_falta > 10} />
        <Kpi icone={Globe} rotulo="Agendados pelo link" valor={String(d?.mes.online ?? "-")} detalhe="no mês" />
      </div>
      <PainelOcupacao />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
        <section className="rounded-xl border bg-card">
          <p className="border-b px-4 py-3 font-semibold">Agenda de hoje</p>
          {!d?.hoje.length ? <p className="p-6 text-sm text-muted-foreground">Nada agendado para hoje.</p> : (
            <ul className="divide-y">
              {d.hoje.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-12 font-semibold">{a.inicio}</span>
                  <Link to={`/pacientes/${a.cliente_id}`} className="min-w-0 flex-1 truncate hover:underline">{a.cliente_nome}<span className="text-muted-foreground">, {a.servicos.map((s) => s.nome).join(", ")}</span></Link>
                  <span className="hidden truncate text-xs text-muted-foreground sm:block">{a.profissional_nome}</span>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", STATUS_AG[a.status].classe)}>{STATUS_AG[a.status].rotulo}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="grid h-fit gap-3 rounded-xl border bg-card p-4">
          <p className="font-semibold">Para chamar de volta</p>
          <p className="num text-3xl font-bold">{retorno.data?.length ?? "-"}</p>
          <p className="text-sm text-muted-foreground">{seg.termos.clientes} que não voltam há um tempo e estão sem horário marcado.</p>
          <Link to="/pacientes" className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted"><MessageCircle className="h-4 w-4" /> Ver lista</Link>
        </section>
      </div>
    </div>
  );
}

interface ResumoV {
  em_estoque: number;
  disponiveis: number;
  reservados: number;
  preparacao: number;
  valor_estoque: number;
  dias_medio: number | null;
  parados: number;
  vendidos_mes: number;
  faturamento_mes: number;
  giro_medio_vendidos: number | null;
  custo_estoque?: number;
  margem_mes?: number;
}

/** Visão geral da loja de veículos: estoque, giro e vendas do mês. */
export function PainelVeiculos() {
  const { isAdmin, principal } = useAuth();
  const r = useQuery({ queryKey: ["veiculos-resumo"], queryFn: () => apiGet<ResumoV>("/veiculos/resumo") });
  const d = r.data;
  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">Olá, {principal?.nome.split(" ")[0]}</h2>
          <p className="text-sm text-muted-foreground">{d ? `${d.em_estoque} veículos no estoque, ${d.vendidos_mes} vendidos no mês.` : "Carregando o estoque."}</p>
        </div>
        <Link to="/veiculos" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"><Car className="h-4 w-4" /> Ver estoque</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icone={Car} rotulo="Em estoque" valor={String(d?.em_estoque ?? "-")} detalhe={d ? `${d.disponiveis} disponíveis, ${d.preparacao} em preparação` : undefined} />
        <Kpi icone={TrendingUp} rotulo="Vendas no mês" valor={d ? brlCompacto(d.faturamento_mes) : "-"} detalhe={isAdmin && d?.margem_mes != null ? `margem ${brlCompacto(d.margem_mes)}` : `${d?.vendidos_mes ?? 0} veículo(s)`} />
        <Kpi icone={CalendarClock} rotulo="Giro médio" valor={d?.giro_medio_vendidos != null ? `${d.giro_medio_vendidos} dias` : "-"} detalhe={d?.dias_medio != null ? `estoque atual: ${d.dias_medio} dias em média` : undefined} />
        <Kpi icone={AlertTriangle} rotulo="Parados há 60+ dias" valor={String(d?.parados ?? "-")} detalhe="revise preço ou anúncio" alerta={!!d?.parados} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/leads" className="rounded-xl border bg-card p-4 hover:bg-accent/30"><p className="font-semibold">Leads</p><p className="text-sm text-muted-foreground">Contatos do site e dos portais</p></Link>
        <Link to="/crm" className="rounded-xl border bg-card p-4 hover:bg-accent/30"><p className="font-semibold">Negócios</p><p className="text-sm text-muted-foreground">Funil de vendas da equipe</p></Link>
        <Link to="/meu-site" className="rounded-xl border bg-card p-4 hover:bg-accent/30"><p className="font-semibold">Site da loja</p><p className="text-sm text-muted-foreground">Estoque publicado e WhatsApp</p></Link>
      </div>
    </div>
  );
}
