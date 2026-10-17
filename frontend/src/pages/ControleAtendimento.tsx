import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, FileText, Loader2, Users } from "lucide-react";
import { apiGet } from "@/lib/api";
import { useProfissionais } from "@/lib/atendimentos";
import { useSegmento } from "@/lib/segmento";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EvolucaoSessao, PRESENCA, type Presenca } from "@/components/atendimentos/Sessao";
import { cn } from "@/lib/utils";

type Evol = "feita" | "feita_fora_do_prazo" | "pendente" | "atrasada" | null;
interface Linha {
  agendamento_id: string; data: string; inicio: string; fim: string; status: string; profissional_id: string; profissional_nome: string; servicos: string[];
  grupo: boolean; paciente_id: string; paciente_nome: string; presenca: Presenca | null; presenca_marcada: boolean; evolucao: Evol; evolucao_id: string | null;
  evolucao_em: string | null; prazo: string;
}
interface Resumo { sessoes: number; atendimentos: number; presentes: number; faltas: number; sem_presenca: number; feita: number; feita_fora_do_prazo: number; pendente: number; atrasada: number; no_prazo_pct: number | null }

const EVOL: Record<Exclude<Evol, null>, { t: string; cor: string }> = {
  feita: { t: "No prazo", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  feita_fora_do_prazo: { t: "Fora do prazo", cor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  pendente: { t: "Pendente", cor: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  atrasada: { t: "Atrasada", cor: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};
type Filtro = "todos" | "pendentes" | "atrasadas" | "sem_presenca" | "faltas";

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function br(d: string) { return d.split("-").reverse().slice(0, 2).join("/"); }

export function useEvolucoesPendentes(ativo: boolean) {
  return useQuery({ queryKey: ["evolucoes-pendentes"], queryFn: () => apiGet<{ pendentes: number; atrasadas: number }>("/sessoes/controle/pendentes"), enabled: ativo, refetchInterval: 300_000 });
}

/** Controle de atendimento: presença por paciente e evolução em até 24 h, por profissional. */
export default function ControleAtendimento() {
  const hoje = new Date();
  const seg = useSegmento();
  const { isAdmin, principal } = useAuth();
  const profs = useProfissionais(true);
  const [inicio, setInicio] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));
  const [fim, setFim] = useState(iso(hoje));
  const [prof, setProf] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [evoluir, setEvoluir] = useState<{ agendamento_id: string; paciente_id: string; paciente_nome: string; data: string } | null>(null);
  const q = useQuery({
    queryKey: ["controle", inicio, fim, prof],
    queryFn: () => apiGet<{ resumo: Resumo; linhas: Linha[] }>(`/sessoes/controle/lista?inicio=${inicio}&fim=${fim}${prof ? `&profissional_id=${prof}` : ""}`),
  });
  const linhas = useMemo(() => (q.data?.linhas ?? []).filter((l) => ({
    todos: true, pendentes: l.evolucao === "pendente" || l.evolucao === "atrasada", atrasadas: l.evolucao === "atrasada",
    sem_presenca: l.presenca === null, faltas: l.presenca === "falta" || l.presenca === "falta_justificada",
  })[filtro]).reverse(), [q.data, filtro]);
  const r = q.data?.resumo;
  const porProf = useMemo(() => {
    const m: Record<string, { nome: string; presentes: number; feitas: number; noPrazo: number; atrasadas: number; pendentes: number }> = {};
    for (const l of q.data?.linhas ?? []) {
      const x = (m[l.profissional_id] ??= { nome: l.profissional_nome, presentes: 0, feitas: 0, noPrazo: 0, atrasadas: 0, pendentes: 0 });
      if (l.presenca === "presente") x.presentes++;
      if (l.evolucao === "feita") { x.feitas++; x.noPrazo++; }
      if (l.evolucao === "feita_fora_do_prazo") x.feitas++;
      if (l.evolucao === "atrasada") x.atrasadas++;
      if (l.evolucao === "pendente") x.pendentes++;
    }
    return Object.values(m).sort((a, b) => b.atrasadas - a.atrasadas || a.nome.localeCompare(b.nome));
  }, [q.data]);

  return (
    <div className="space-y-4" data-testid="controle-atendimento">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Cada {seg.termos.cliente.toLowerCase()} presente precisa de evolução no prontuário em até 24 horas depois do fim da sessão. Só sessão com presença e evolução entra na folha do {seg.termos.profissional.toLowerCase()}.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><span className="text-xs text-muted-foreground">De</span><Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-40" /></div>
        <div className="grid gap-1"><span className="text-xs text-muted-foreground">Até</span><Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-40" /></div>
        {isAdmin && (
          <div className="grid gap-1"><span className="text-xs text-muted-foreground">{seg.termos.profissional}</span>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={prof} onChange={(e) => setProf(e.target.value)}>
              <option value="">Todos</option>{(profs.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
        )}
      </div>
      {!r ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[["Sessões", r.sessoes, `${r.atendimentos} ${seg.termos.clientes.toLowerCase()}`], ["Presenças", r.presentes, `${r.faltas} falta(s), ${r.sem_presenca} sem marcar`],
              ["Evolução no prazo", r.no_prazo_pct == null ? "-" : `${r.no_prazo_pct}%`, `${r.feita} no prazo, ${r.feita_fora_do_prazo} fora`],
              ["Pendentes", r.pendente, "dentro das 24 h"], ["Atrasadas", r.atrasada, "passaram de 24 h"]].map(([t, v, d], i) => (
              <div key={t as string} className={cn("rounded-xl border bg-card p-3", i === 4 && Number(v) > 0 && "border-red-300 dark:border-red-900")}>
                <p className="text-xs text-muted-foreground">{t}</p><p className={cn("text-2xl font-semibold", i === 4 && Number(v) > 0 && "text-red-600")} data-testid={`controle-${i}`}>{v}</p><p className="text-xs text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
          {isAdmin && porProf.length > 1 && (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2 pl-3">{seg.termos.profissional}</th><th className="p-2">Presenças</th><th className="p-2">Evoluções</th><th className="p-2">No prazo</th><th className="p-2">Pendentes</th><th className="p-2">Atrasadas</th></tr></thead>
                <tbody>{porProf.map((p) => (
                  <tr key={p.nome} className="border-t"><td className="p-2 pl-3 font-medium">{p.nome}</td><td className="p-2">{p.presentes}</td><td className="p-2">{p.feitas}</td>
                    <td className="p-2">{p.feitas + p.atrasadas ? `${Math.round((p.noPrazo * 100) / (p.feitas + p.atrasadas))}%` : "-"}</td><td className="p-2">{p.pendentes}</td>
                    <td className={cn("p-2", p.atrasadas && "font-semibold text-red-600")}>{p.atrasadas}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="inline-flex flex-wrap rounded-lg border bg-card p-0.5 text-sm">
            {([["todos", "Todos"], ["pendentes", `Falta evolução (${r.pendente + r.atrasada})`], ["atrasadas", `Atrasadas (${r.atrasada})`], ["sem_presenca", `Sem presença (${r.sem_presenca})`], ["faltas", `Faltas (${r.faltas})`]] as [Filtro, string][]).map(([k, t]) => (
              <button key={k} type="button" onClick={() => setFiltro(k)} className={cn("rounded-md px-3 py-1", filtro === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")} data-testid={`controle-filtro-${k}`}>{t}</button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2 pl-3">Sessão</th><th className="p-2">{seg.termos.cliente}</th><th className="p-2">{seg.termos.profissional}</th><th className="p-2">Presença</th><th className="p-2">Evolução</th><th className="p-2" /></tr></thead>
              <tbody>
                {linhas.map((l) => {
                  const podeEscrever = (isAdmin || l.profissional_id === principal?.usuario_id) && (l.evolucao === "pendente" || l.evolucao === "atrasada");
                  return (
                    <tr key={`${l.agendamento_id}-${l.paciente_id}`} className="border-t" data-testid="controle-linha">
                      <td className="p-2 pl-3"><span className="font-medium">{br(l.data)} {l.inicio}</span><span className="block text-xs text-muted-foreground">{l.servicos.join(", ")}{l.grupo && <span className="ml-1 inline-flex items-center gap-0.5"><Users className="h-3 w-3" /> grupo</span>}</span></td>
                      <td className="p-2"><Link to={`/pacientes/${l.paciente_id}`} className="hover:underline">{l.paciente_nome}</Link></td>
                      <td className="p-2">{l.profissional_nome}</td>
                      <td className="p-2">{l.presenca ? <span className={cn("rounded-full px-2 py-0.5 text-xs", l.presenca === "presente" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300")}>{PRESENCA[l.presenca].t}</span> : <span className="text-xs text-muted-foreground">Não marcada</span>}</td>
                      <td className="p-2">{l.evolucao ? <span className={cn("rounded-full px-2 py-0.5 text-xs", EVOL[l.evolucao].cor)}>{EVOL[l.evolucao].t}</span> : <span className="text-xs text-muted-foreground">Não se aplica</span>}
                        {l.evolucao === "pendente" && <span className="block text-xs text-muted-foreground">até {new Date(l.prazo).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}</td>
                      <td className="p-2 text-right">{podeEscrever && <Button size="sm" variant={l.evolucao === "atrasada" ? "default" : "outline"} onClick={() => setEvoluir({ agendamento_id: l.agendamento_id, paciente_id: l.paciente_id, paciente_nome: l.paciente_nome, data: l.data })} data-testid="controle-evoluir"><FileText className="h-4 w-4" /> Escrever</Button>}</td>
                    </tr>
                  );
                })}
                {linhas.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">Nada neste filtro.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      <EvolucaoSessao alvo={evoluir} onClose={() => setEvoluir(null)} />
    </div>
  );
}

/** Aviso na agenda: evoluções que faltam de quem está logado. */
export function AvisoEvolucoes() {
  const seg = useSegmento();
  const q = useEvolucoesPendentes(seg.prontuario);
  const d = q.data;
  if (!d || (!d.pendentes && !d.atrasadas)) return null;
  return (
    <Link to="/controle-atendimento" className={cn("flex items-center gap-2 rounded-lg border p-3 text-sm", d.atrasadas ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" : "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200")} data-testid="aviso-evolucoes">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{d.atrasadas ? `${d.atrasadas} evolução(ões) passaram do prazo de 24 h. ` : ""}{d.pendentes ? `${d.pendentes} para escrever hoje. ` : ""}<b>Abrir controle de atendimento</b></span>
    </Link>
  );
}
