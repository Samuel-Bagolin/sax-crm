import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Loader2, UserPlus, X } from "lucide-react";
import { apiDelete, apiGet, apiPost, detalheErro } from "@/lib/api";
import { useSegmento } from "@/lib/segmento";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import Combo from "@/components/shared/Combo";
import { cn } from "@/lib/utils";

export type Presenca = "presente" | "falta" | "falta_justificada";
interface Participante { cliente_id: string; cliente_nome: string; presenca: Presenca | null; presenca_efetiva: Presenca | null; evolucao_id: string | null; justificativa?: string | null }
interface Sessao { id: string; data: string; inicio: string; fim: string; status: string; profissional_id: string; capacidade: number; participantes: Participante[] }

export const PRESENCA: Record<Presenca, { t: string; cor: string }> = {
  presente: { t: "Presente", cor: "bg-emerald-600 text-white border-emerald-600" },
  falta: { t: "Falta", cor: "bg-red-600 text-white border-red-600" },
  falta_justificada: { t: "Falta justificada", cor: "bg-amber-500 text-white border-amber-500" },
};

/** Escreve a evolução de um paciente ligada à sessão (prazo de 24 h depois do fim). */
export function EvolucaoSessao({ alvo, onClose }: { alvo: { agendamento_id: string; paciente_id: string; paciente_nome: string; data: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const salvar = useMutation({
    mutationFn: () => apiPost<{ no_prazo: boolean }>(`/pacientes/${alvo!.paciente_id}/prontuario`, { texto, tipo: "evolucao", agendamento_id: alvo!.agendamento_id, data: alvo!.data }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["sessao"] }); qc.invalidateQueries({ queryKey: ["controle"] }); qc.invalidateQueries({ queryKey: ["evolucoes-pendentes"] });
      toast.success(r.no_prazo ? "Evolução registrada no prontuário." : "Evolução registrada fora do prazo de 24 h.");
      setTexto(""); onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar."),
  });
  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Evolução de {alvo?.paciente_nome}</DialogTitle>
          <DialogDescription>Sessão de {alvo?.data.split("-").reverse().join("/")}. Vai para o prontuário; pode ser corrigida por 24 h, depois só com adendo.</DialogDescription>
        </DialogHeader>
        <Textarea rows={8} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Como foi a sessão, objetivos trabalhados, resposta do paciente, próximos passos." data-testid="evolucao-texto" />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || texto.trim().length < 2} data-testid="evolucao-salvar">
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar no prontuário
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pacientes da sessão, presença e evolução (dentro do detalhe do agendamento). */
export function PainelSessao({ agendamentoId }: { agendamentoId: string }) {
  const qc = useQueryClient();
  const seg = useSegmento();
  const { isAdmin, principal } = useAuth();
  const q = useQuery({ queryKey: ["sessao", agendamentoId], queryFn: () => apiGet<Sessao>(`/sessoes/${agendamentoId}`) });
  const clientes = useQuery({ queryKey: ["pacientes-lista"], queryFn: () => apiGet<{ id: string; nome: string; telefone: string | null }[]>("/pacientes") });
  const [incluir, setIncluir] = useState(false);
  const [evoluir, setEvoluir] = useState<{ agendamento_id: string; paciente_id: string; paciente_nome: string; data: string } | null>(null);
  const atualizar = (s: Sessao) => { qc.setQueryData(["sessao", agendamentoId], s); qc.invalidateQueries({ queryKey: ["agendamentos"] }); qc.invalidateQueries({ queryKey: ["controle"] }); };
  const presenca = useMutation({
    mutationFn: (v: { cliente_id: string; presenca: Presenca | null; justificativa?: string | null }) => apiPost<Sessao>(`/sessoes/${agendamentoId}/presenca`, v),
    onSuccess: atualizar,
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível marcar."),
  });
  const novo = useMutation({
    mutationFn: (v: { cliente_id?: string; cliente_nome?: string }) => apiPost<Sessao>(`/sessoes/${agendamentoId}/participantes`, v),
    onSuccess: (s) => { atualizar(s); setIncluir(false); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível incluir."),
  });
  const tirar = useMutation({
    mutationFn: (id: string) => apiDelete<Sessao>(`/sessoes/${agendamentoId}/participantes/${id}`),
    onSuccess: atualizar,
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível retirar."),
  });
  const s = q.data;
  if (!s) return null;
  const hoje = new Date();
  const ehHojeOuAntes = s.data <= `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const souQuemAtende = isAdmin || s.profissional_id === principal?.usuario_id;
  const ativa = s.status !== "cancelado";
  const ja = new Set(s.participantes.map((p) => p.cliente_id));
  return (
    <div className="grid gap-2 rounded-lg border p-3" data-testid="painel-sessao">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{s.capacidade > 1 ? `Grupo: ${s.participantes.length} de ${s.capacidade}` : "Presença"}</p>
        {s.capacidade > s.participantes.length && ativa && s.status !== "concluido" && (
          <Button size="sm" variant="ghost" onClick={() => setIncluir((v) => !v)} data-testid="sessao-incluir"><UserPlus className="h-4 w-4" /> Incluir</Button>
        )}
      </div>
      {incluir && (
        <Combo opcoes={(clientes.data ?? []).filter((c) => !ja.has(c.id)).map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: c.telefone }))} valor={null}
          onChange={(v) => v && novo.mutate({ cliente_id: v })} onCriar={(t) => novo.mutate({ cliente_nome: t })} rotuloCriar={`Cadastrar ${seg.termos.cliente.toLowerCase()}`}
          placeholder={`Buscar ${seg.termos.cliente.toLowerCase()}`} testid="sessao-combo" />
      )}
      <ul className="grid gap-2">
        {s.participantes.map((p) => (
          <li key={p.cliente_id} className="grid gap-1.5" data-testid="sessao-participante">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{p.cliente_nome}</span>
              <span className="flex shrink-0 gap-1">
                {seg.prontuario && souQuemAtende && p.presenca_efetiva === "presente" && (
                  p.evolucao_id
                    ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"><FileText className="h-3.5 w-3.5" /> Evolução feita</span>
                    : <Button size="sm" variant="outline" className="h-7" onClick={() => setEvoluir({ agendamento_id: s.id, paciente_id: p.cliente_id, paciente_nome: p.cliente_nome, data: s.data })} data-testid="sessao-evoluir"><FileText className="h-3.5 w-3.5" /> Evolução</Button>
                )}
                {s.participantes.length > 1 && !p.evolucao_id && ativa && (
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" title="Tirar da sessão" onClick={() => tirar.mutate(p.cliente_id)}><X className="h-3.5 w-3.5" /></button>
                )}
              </span>
            </div>
            {souQuemAtende && ativa && ehHojeOuAntes ? (
              <div className="flex flex-wrap gap-1">
                {(Object.keys(PRESENCA) as Presenca[]).map((k) => (
                  <button key={k} type="button" disabled={presenca.isPending || (!!p.evolucao_id && k !== "presente")}
                    onClick={() => {
                      if (p.presenca === k) return presenca.mutate({ cliente_id: p.cliente_id, presenca: null });
                      const just = k === "falta_justificada" ? window.prompt("Motivo da falta (opcional)") : null;
                      presenca.mutate({ cliente_id: p.cliente_id, presenca: k, justificativa: just });
                    }}
                    className={cn("rounded-full border px-2.5 py-0.5 text-xs disabled:opacity-50", p.presenca === k ? PRESENCA[k].cor : "text-muted-foreground hover:bg-muted")}
                    data-testid={`presenca-${k}`}>{PRESENCA[k].t}</button>
                ))}
                {!p.presenca && p.presenca_efetiva && <span className="text-xs text-muted-foreground">({PRESENCA[p.presenca_efetiva].t.toLowerCase()} pelo status)</span>}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">{p.presenca_efetiva ? PRESENCA[p.presenca_efetiva].t : ehHojeOuAntes ? "Sem presença marcada" : "Presença no dia da sessão"}</span>
            )}
          </li>
        ))}
      </ul>
      <EvolucaoSessao alvo={evoluir} onClose={() => setEvoluir(null)} />
    </div>
  );
}
