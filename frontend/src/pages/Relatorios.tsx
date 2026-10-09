import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { duracaoCurta } from "@/lib/diferenciais";
import { Info } from "lucide-react";
import { apiGet } from "@/lib/api";
import { brl, brlCompacto } from "@/lib/format";
import { corDoMembro, isoLocal, useEquipe, useFunis } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import Avatar from "@/components/shared/Avatar";
import FunilTrapezios from "@/components/crm/FunilTrapezios";
import type { Relatorio } from "@/lib/relatorio";
import { cn } from "@/lib/utils";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
// Paleta categórica validada (claro/escuro) para "Por que perdemos": ordem fixa, nunca reciclada.
const CATEGORIAS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

function periodos() {
  const hoje = new Date();
  const lista: { id: string; rotulo: string; inicio: string | null; fim: string | null }[] = [];
  for (let k = 0; k < 12; k++) {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() - k, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() - k + 1, 0);
    lista.push({
      id: `m${k}`,
      rotulo: `${k === 0 ? "Este mês" : MESES[ini.getMonth()][0].toUpperCase() + MESES[ini.getMonth()].slice(1)} ${k === 0 ? "" : ini.getFullYear()}`.trim(),
      inicio: isoLocal(ini),
      fim: isoLocal(fim),
    });
  }
  const dias = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n + 1);
    return isoLocal(d);
  };
  lista.splice(1, 0, { id: "d30", rotulo: "Últimos 30 dias", inicio: dias(30), fim: isoLocal(hoje) }, { id: "d90", rotulo: "Últimos 90 dias", inicio: dias(90), fim: isoLocal(hoje) });
  lista.push({ id: "tudo", rotulo: "Desde o início", inicio: null, fim: null });
  return lista;
}

function Kpi({ rotulo, valor, detalhe, destaque }: { rotulo: string; valor: string; detalhe?: string; destaque?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", destaque && "border-primary/40")}>
      <p className="text-sm text-muted-foreground">{rotulo}</p>
      <p className={cn("num mt-1 whitespace-nowrap text-[clamp(20px,2.2vw,28px)] font-bold leading-tight tracking-tight", destaque && "text-primary")}>{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

function Pizza({ fatias }: { fatias: Relatorio["motivos_perda"] }) {
  const total = fatias.reduce((s, f) => s + f.qtd, 0);
  const [ativo, setAtivo] = useState<number | null>(null);
  if (!total) return <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma perda no período.</p>;
  // até 5 motivos + "Outros", para nunca reciclar cor
  const principais = fatias.slice(0, 5);
  const resto = fatias.slice(5).reduce((s, f) => s + f.qtd, 0);
  const lista = resto ? [...principais, { rotulo: "Outros", qtd: resto, valor: 0 }] : principais;
  let acum = 0;
  const R = 40;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <svg viewBox="0 0 100 100" className="h-40 w-40 shrink-0 -rotate-90" role="img" aria-label="Motivos de perda">
        {lista.map((f, i) => {
          const frac = f.qtd / total;
          const el = (
            <circle
              key={f.rotulo}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={CATEGORIAS[i]}
              strokeWidth={ativo === i ? 20 : 17}
              strokeDasharray={`${Math.max(frac * C - 1.2, 0.5)} ${C}`}
              strokeDashoffset={-acum * C}
              onMouseEnter={() => setAtivo(i)}
              onMouseLeave={() => setAtivo(null)}
              className="cursor-default transition-[stroke-width]"
            >
              <title>{`${f.rotulo}: ${f.qtd} (${Math.round(frac * 100)}%)`}</title>
            </circle>
          );
          acum += frac;
          return el;
        })}
      </svg>
      <ul className="w-full space-y-1.5 text-sm">
        {lista.map((f, i) => (
          <li
            key={f.rotulo}
            className={cn("flex items-center gap-2 rounded px-1", ativo === i && "bg-muted")}
            onMouseEnter={() => setAtivo(i)}
            onMouseLeave={() => setAtivo(null)}
          >
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: CATEGORIAS[i] }} />
            <span className="min-w-0 flex-1 truncate">{f.rotulo}</span>
            <span className="num font-semibold">{f.qtd}</span>
            <span className="num w-10 text-right text-muted-foreground">{Math.round((f.qtd / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SerieMensal({ serie }: { serie: Relatorio["serie_mensal"] }) {
  const max = Math.max(1, ...serie.map((s) => Math.max(s.criados, s.ganhos)));
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[var(--funil-3)]" /> Criados
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-hoje" /> Ganhos
        </span>
      </div>
      <div className="grid h-40 grid-cols-6 items-end gap-3 border-b">
        {serie.map((s) => {
          const [y, m] = s.mes.split("-").map(Number);
          return (
            <div key={s.mes} className="flex h-full flex-col justify-end" title={`${MESES[m - 1]}/${y}: ${s.criados} criados, ${s.ganhos} ganhos (${brl(s.valor)})`}>
              <div className="flex h-full items-end justify-center gap-[2px]">
                <div className="w-1/3 max-w-5 rounded-t-[4px] bg-[var(--funil-3)]" style={{ height: `${(s.criados / max) * 100}%` }} />
                <div className="w-1/3 max-w-5 rounded-t-[4px] bg-hoje" style={{ height: `${(s.ganhos / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 grid grid-cols-6 gap-3 text-center text-[11px] text-muted-foreground">
        {serie.map((s) => (
          <span key={s.mes}>{MESES[Number(s.mes.slice(5)) - 1].slice(0, 3)}</span>
        ))}
      </div>
    </div>
  );
}

interface LinhaAtendimento {
  rotulo: string;
  leads: number;
  respondidos: number;
  dentro_sla: number;
  mediana_min: number | null;
  convertidos: number;
}
interface Atendimento {
  sla_min: number | null;
  leads: number;
  respondidos: number;
  dentro_sla: number;
  pct_dentro_sla: number | null;
  mediana_min: number | null;
  media_min: number | null;
  aguardando: number;
  aguardando_fora_sla: number;
  convertidos: number;
  por_responsavel: LinhaAtendimento[];
  por_origem: LinhaAtendimento[];
}

/** SLA do primeiro atendimento: o indicador que mais move conversão de lead. */
function BlocoAtendimento({ consulta }: { consulta: string }) {
  const { data: a } = useQuery({ queryKey: ["relatorio-atendimento", consulta], queryFn: () => apiGet<Atendimento>(`/relatorios/atendimento?${consulta}`) });
  if (!a || !a.leads) return null;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "—");
  const Tabela = ({ titulo, linhas }: { titulo: string; linhas: LinhaAtendimento[] }) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 font-medium">{titulo}</th>
            <th className="px-3 py-2 text-right font-medium">Leads</th>
            <th className="px-3 py-2 text-right font-medium">Tempo mediano</th>
            <th className="px-3 py-2 text-right font-medium">No prazo</th>
            <th className="px-4 py-2 text-right font-medium">Viraram negócio</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className="border-b last:border-0">
              <td className="px-4 py-2">{l.rotulo}</td>
              <td className="num px-3 py-2 text-right">{l.leads}</td>
              <td className="num px-3 py-2 text-right">{duracaoCurta(l.mediana_min)}</td>
              <td className="num px-3 py-2 text-right font-semibold">{a.sla_min ? pct(l.dentro_sla, l.respondidos) : "—"}</td>
              <td className="num px-4 py-2 text-right">{pct(l.convertidos, l.leads)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <section className="overflow-hidden rounded-lg border bg-card" data-testid="relatorio-atendimento">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">Velocidade de atendimento</h2>
        <p className="text-xs text-muted-foreground">
          Tempo entre o lead chegar e o primeiro contato registrado{a.sla_min ? `. Meta (SLA): ${a.sla_min} min` : ". Defina um SLA em Configurar CRM"}.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {[
          ["Tempo mediano", duracaoCurta(a.mediana_min), `média ${duracaoCurta(a.media_min)}`],
          ["Dentro do SLA", a.pct_dentro_sla != null ? `${a.pct_dentro_sla.toLocaleString("pt-BR")}%` : "—", `${a.dentro_sla} de ${a.respondidos} respondidos`],
          ["Aguardando contato", String(a.aguardando), a.aguardando_fora_sla ? `${a.aguardando_fora_sla} fora do prazo` : "todos no prazo"],
          ["Viraram negócio", pct(a.convertidos, a.leads), `${a.convertidos} de ${a.leads} leads`],
        ].map(([r, v, d]) => (
          <div key={r} className="bg-card p-4">
            <p className="text-sm text-muted-foreground">{r}</p>
            <p className={cn("num mt-1 text-2xl font-bold", r === "Aguardando contato" && a.aguardando_fora_sla > 0 && "text-atrasada")}>{v}</p>
            <p className="text-xs text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>
      <div className="grid border-t lg:grid-cols-2 lg:divide-x">
        <Tabela titulo="Responsável" linhas={a.por_responsavel} />
        <Tabela titulo="Origem" linhas={a.por_origem} />
      </div>
    </section>
  );
}

export default function Relatorios() {
  const { isAdmin } = useAuth();
  const { data: funis = [] } = useFunis();
  const { data: equipe = [] } = useEquipe();
  const lista = useMemo(periodos, []);
  const [periodo, setPeriodo] = useState("m0");
  const [funilId, setFunilId] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const p = lista.find((x) => x.id === periodo)!;
  const funil = funis.find((f) => f.id === funilId) ?? funis.find((f) => f.padrao) ?? funis[0];

  const q = new URLSearchParams();
  if (funil) q.set("funil_id", funil.id);
  if (p.inicio) q.set("inicio", p.inicio);
  if (p.fim) q.set("fim", p.fim);
  if (responsavel) q.set("corretor_id", responsavel);
  const qAtendimento = new URLSearchParams(q);
  qAtendimento.delete("funil_id");
  const { data: r, isLoading } = useQuery({
    queryKey: ["relatorio", q.toString()],
    queryFn: () => apiGet<Relatorio>(`/relatorios/funil?${q.toString()}`),
    enabled: !!funil,
  });

  const membro = (pid: string | null) => (pid ? equipe.find((m) => m.pessoa_id === pid) : undefined);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm font-semibold" aria-label="Período" data-testid="rel-periodo">
          {lista.map((x) => (
            <option key={x.id} value={x.id}>
              {x.rotulo}
            </option>
          ))}
        </select>
        <select value={funil?.id ?? ""} onChange={(e) => setFunilId(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm" aria-label="Funil">
          {funis.map((f) => (
            <option key={f.id} value={f.id}>
              Funil {f.nome}
            </option>
          ))}
        </select>
        {isAdmin && (
          <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm" aria-label="Responsável">
            <option value="">Toda a equipe</option>
            {equipe
              .filter((m) => m.pessoa_id)
              .map((m) => (
                <option key={m.usuario_id} value={m.pessoa_id!}>
                  {m.nome}
                </option>
              ))}
          </select>
        )}
      </div>
      <p className="flex items-start gap-2 rounded-lg border bg-accent/50 px-3 py-2 text-xs text-accent-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Funil e conversão contam os negócios <strong>criados</strong> no período, pela etapa mais avançada que já alcançaram (voltar um card não muda o
          número). Vendas contam pela data do ganho e perdas pela data da perda.
        </span>
      </p>

      {isLoading || !r ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="rel-kpis">
            <Kpi rotulo="Negócios criados" valor={String(r.criados)} detalhe={`${r.leads_recebidos} leads recebidos, ${r.leads_convertidos} convertidos`} />
            <Kpi rotulo="Conversão" valor={r.conversao != null ? `${r.conversao}%` : "—"} detalhe={`${r.ganhos_coorte} ganho(s) entre os criados`} destaque />
            <Kpi rotulo="Vendido" valor={brlCompacto(r.valor_ganho)} detalhe={`${r.ganhos} ganho(s)${r.ticket_medio ? `, ticket ${brlCompacto(r.ticket_medio)}` : ""}`} />
            <Kpi rotulo="Ciclo médio" valor={r.ciclo_medio_dias != null ? `${r.ciclo_medio_dias} dias` : "—"} detalhe="da criação ao ganho" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi rotulo="Em andamento agora" valor={brlCompacto(r.valor_aberto)} detalhe={`${r.abertos} negócio(s)`} />
            <Kpi rotulo="Previsão ponderada" valor={brlCompacto(r.valor_ponderado)} detalhe="valor x probabilidade da etapa" />
            <Kpi rotulo="Perdidos" valor={String(r.perdidos)} detalhe={r.motivos_perda[0] ? `principal: ${r.motivos_perda[0].rotulo}` : "nenhum"} />
            <Kpi
              rotulo="Lead até virar negócio"
              valor={r.tempo_lead_negocio_horas != null ? (r.tempo_lead_negocio_horas < 48 ? `${r.tempo_lead_negocio_horas}h` : `${Math.round(r.tempo_lead_negocio_horas / 24)} dias`) : "—"}
              detalhe="tempo médio de qualificação"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <section className="rounded-lg border bg-card p-4 sm:p-5">
              <h2 className="mb-1 font-semibold">Funil {r.funil_nome}</h2>
              <p className="mb-4 text-xs text-muted-foreground">Quantos negócios criados no período chegaram a cada etapa.</p>
              {r.criados ? <FunilTrapezios etapas={r.funil} /> : <p className="py-10 text-center text-sm text-muted-foreground">Nenhum negócio criado no período.</p>}
            </section>
            <div className="space-y-4">
              <section className="rounded-lg border bg-card p-4 sm:p-5">
                <h2 className="mb-4 font-semibold">Por que perdemos</h2>
                <Pizza fatias={r.motivos_perda} />
              </section>
              <section className="rounded-lg border bg-card p-4 sm:p-5">
                <h2 className="mb-3 font-semibold">Últimos 6 meses</h2>
                <SerieMensal serie={r.serie_mensal} />
              </section>
            </div>
          </div>

          <section className="overflow-hidden rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 font-semibold">Por responsável</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-4 py-2 font-medium">Responsável</th>
                    <th className="px-3 py-2 text-right font-medium">Criados</th>
                    <th className="px-3 py-2 text-right font-medium">Ganhos</th>
                    <th className="px-3 py-2 text-right font-medium">Perdidos</th>
                    <th className="px-3 py-2 text-right font-medium">Conversão</th>
                    <th className="px-3 py-2 text-right font-medium">Vendido</th>
                    <th className="px-3 py-2 text-right font-medium">Atividades feitas</th>
                    <th className="px-4 py-2 text-right font-medium">Em andamento</th>
                  </tr>
                </thead>
                <tbody>
                  {r.responsaveis.map((l) => {
                    const m = membro(l.pessoa_id);
                    return (
                      <tr key={l.pessoa_id ?? "sem"} className="border-b last:border-0">
                        <td className="px-4 py-2">
                          <span className="flex items-center gap-2">
                            {m ? (
                              <Avatar nome={m.nome} usuarioId={m.usuario_id} temFoto={m.tem_foto} versao={m.foto_v} cor={corDoMembro(m)} tamanho="xs" />
                            ) : (
                              <span className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/50" />
                            )}
                            {l.nome}
                          </span>
                        </td>
                        <td className="num px-3 py-2 text-right">{l.criados}</td>
                        <td className="num px-3 py-2 text-right">{l.ganhos}</td>
                        <td className="num px-3 py-2 text-right">{l.perdidos}</td>
                        <td className="num px-3 py-2 text-right font-semibold">{l.conversao != null ? `${l.conversao}%` : "—"}</td>
                        <td className="num px-3 py-2 text-right">{brl(l.valor_ganho)}</td>
                        <td className="num px-3 py-2 text-right">{l.atividades_feitas}</td>
                        <td className="num px-4 py-2 text-right">{l.abertos}</td>
                      </tr>
                    );
                  })}
                  {!r.responsaveis.length && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        Sem movimento no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <BlocoAtendimento consulta={qAtendimento.toString()} />

          <section className="overflow-hidden rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 font-semibold">Por origem</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-4 py-2 font-medium">Origem</th>
                    <th className="px-3 py-2 text-right font-medium">Negócios criados</th>
                    <th className="px-3 py-2 text-right font-medium">Ganhos</th>
                    <th className="px-3 py-2 text-right font-medium">Conversão</th>
                    <th className="px-4 py-2 text-right font-medium">Vendido</th>
                  </tr>
                </thead>
                <tbody>
                  {r.origens.map((o) => {
                    const [nome, ganhos] = o.rotulo.split("|");
                    const g = Number(ganhos) || 0;
                    return (
                      <tr key={o.rotulo} className="border-b last:border-0">
                        <td className="px-4 py-2">{nome}</td>
                        <td className="num px-3 py-2 text-right">{o.qtd}</td>
                        <td className="num px-3 py-2 text-right">{g}</td>
                        <td className="num px-3 py-2 text-right font-semibold">{o.qtd ? `${Math.round((g / o.qtd) * 1000) / 10}%` : "—"}</td>
                        <td className="num px-4 py-2 text-right">{brl(o.valor)}</td>
                      </tr>
                    );
                  })}
                  {!r.origens.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        Sem negócios criados no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
