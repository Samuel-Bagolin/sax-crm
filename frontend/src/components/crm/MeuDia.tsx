import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, Inbox, Plus, Timer, Trophy } from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";
import { brlCompacto } from "@/lib/format";
import { ATIVIDADE, corDoMembro, dataCurta, isoLocal, useEquipe } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import type { Atividade, Entrada, NegocioResumo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/shared/Avatar";
import AtividadeModal from "@/components/crm/AtividadeModal";
import { cn } from "@/lib/utils";

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/** Abertura do painel: o que fazer hoje, o que está atrasado e o que está esfriando. */
export default function MeuDia() {
  const qc = useQueryClient();
  const { principal, isAdmin } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const [nova, setNova] = useState(false);
  const hoje = isoLocal(new Date());
  const meu = principal?.pessoa_id ? `&corretor_id=${principal.pessoa_id}` : "";
  const { data: pendentes = [] } = useQuery({
    queryKey: ["atividades", "meu-dia", hoje, principal?.pessoa_id],
    queryFn: () => apiGet<Atividade[]>(`/atividades?pendentes=true&fim=${hoje}${meu}`),
  });
  const { data: negocios = [] } = useQuery({ queryKey: ["kanban", "painel"], queryFn: () => apiGet<NegocioResumo[]>("/leads/kanban?status=aberto") });
  const { data: entradas = [] } = useQuery({ queryKey: ["entradas", "ativos"], queryFn: () => apiGet<Entrada[]>("/entradas") });

  const concluir = useMutation({
    mutationFn: (a: Atividade) => apiPatch(`/atividades/${a.id}`, { concluida: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["atividades"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["equipe"] });
    },
  });

  const minhas = pendentes.filter((a) => !principal?.pessoa_id || a.corretor_id === principal.pessoa_id);
  const atrasadas = minhas.filter((a) => a.data < hoje);
  const deHoje = minhas.filter((a) => a.data === hoje);
  const parados = negocios.filter((n) => n.parado);
  const semPasso = negocios.filter((n) => n.situacao_atividade === "nenhuma");
  const novos = entradas.filter((e) => e.status === "novo");
  const ranking = [...equipe].filter((m) => m.pessoa_id).sort((a, b) => b.valor_ganho_mes - a.valor_ganho_mes).slice(0, 5);

  return (
    <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-lg border bg-card">
        <header className="flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {saudacao()}, {principal?.nome.split(" ")[0]}
            </h2>
            <p className="text-sm text-muted-foreground">
              {deHoje.length} atividade(s) para hoje
              {atrasadas.length ? `, ${atrasadas.length} atrasada(s)` : ""}.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setNova(true)}>
            <Plus className="h-3.5 w-3.5" /> Atividade
          </Button>
        </header>
        <ul className="max-h-72 divide-y overflow-y-auto scroll-fino">
          {[...atrasadas, ...deHoje].map((a) => {
            const meta = ATIVIDADE[a.tipo];
            return (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <button
                  aria-label="Concluir"
                  onClick={() => concluir.mutate(a)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 text-transparent hover:border-hoje hover:text-hoje"
                >
                  <Check className="h-3 w-3" />
                </button>
                <meta.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {a.negocio_id ? (
                    <Link to={`/negocios/${a.negocio_id}`} className="hover:text-primary hover:underline">
                      {a.assunto}
                    </Link>
                  ) : (
                    a.assunto
                  )}
                </span>
                <span className={cn("shrink-0 text-xs", a.data < hoje ? "font-semibold text-atrasada" : "text-hoje")}>
                  {a.data < hoje ? dataCurta(a.data) : a.hora ?? "Hoje"}
                </span>
              </li>
            );
          })}
          {!atrasadas.length && !deHoje.length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Agenda de hoje livre. Bom momento para prospectar.</li>}
        </ul>
        <div className="grid grid-cols-3 border-t text-center">
          <Link to="/leads" className="px-2 py-3 hover:bg-muted/50">
            <p className="num flex items-center justify-center gap-1 text-lg font-semibold">
              <Inbox className="h-4 w-4 text-primary" />
              {novos.length}
            </p>
            <p className="text-xs text-muted-foreground">leads sem contato</p>
          </Link>
          <Link to="/crm" className="border-x px-2 py-3 hover:bg-muted/50">
            <p className="num flex items-center justify-center gap-1 text-lg font-semibold">
              <span className="h-2.5 w-2.5 rounded-full bg-sem-atividade" />
              {semPasso.length}
            </p>
            <p className="text-xs text-muted-foreground">negócios sem próximo passo</p>
          </Link>
          <Link to="/crm" className="px-2 py-3 hover:bg-muted/50">
            <p className={cn("num flex items-center justify-center gap-1 text-lg font-semibold", parados.length && "text-atrasada")}>
              <Timer className="h-4 w-4" />
              {parados.length}
            </p>
            <p className="text-xs text-muted-foreground">parados na etapa</p>
          </Link>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Trophy className="h-4 w-4 text-latao" />
          <h2 className="text-sm font-semibold">{isAdmin ? "Ranking do mês" : "Seu mês"}</h2>
        </header>
        <ol className="divide-y">
          {ranking.map((m, i) => {
            const max = Math.max(ranking[0]?.valor_ganho_mes ?? 0, 1);
            return (
              <li key={m.usuario_id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="num w-4 text-xs text-muted-foreground">{i + 1}</span>
                <Avatar nome={m.nome} usuarioId={m.usuario_id} temFoto={m.tem_foto} versao={m.foto_v} cor={corDoMembro(m)} tamanho="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.nome}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-latao" style={{ width: `${(m.valor_ganho_mes / max) * 100}%` }} />
                  </div>
                </div>
                <div className="text-right">
                  <p className="num text-sm font-semibold">{brlCompacto(m.valor_ganho_mes)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {m.ganhos_mes} ganho(s), {m.negocios_abertos} abertos
                  </p>
                </div>
              </li>
            );
          })}
          {!ranking.length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Cadastre a equipe para acompanhar o desempenho.</li>}
        </ol>
      </div>
      <AtividadeModal open={nova} onClose={() => setNova(false)} />
    </section>
  );
}
