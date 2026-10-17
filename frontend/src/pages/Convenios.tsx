import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2, Plus, ShieldAlert } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { useProfissionais, useServicos } from "@/lib/atendimentos";
import { urlApi } from "@/lib/suporte";
import { useSegmento } from "@/lib/segmento";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Combo from "@/components/shared/Combo";
import { cn } from "@/lib/utils";

interface Convenio {
  id: string; nome: string; registro_ans: string; codigo_prestador: string | null; cnes: string | null; versao_tiss: string; codigo_tabela: string;
  tipo_atendimento: string | null; regime_atendimento: string; tabela: { servico_id: string; codigo: string; descricao: string | null; valor: number }[];
  portal: string | null; observacoes: string | null; ativo: boolean;
}
type Situacao = "solicitada" | "autorizada" | "negada" | "esgotada" | "vencida";
interface Guia {
  id: string; convenio_id: string; convenio_nome: string; paciente_id: string; paciente_nome: string; numero_carteira: string; servico_id: string | null;
  status: "solicitada" | "autorizada" | "negada"; numero_operadora: string | null; senha: string | null; data_solicitacao: string | null; data_autorizacao: string | null;
  validade: string | null; sessoes_autorizadas: number; usadas: number; saldo: number; situacao: Situacao; vence_em_dias: number | null; alerta: boolean;
  numero_prestador: string; indicacao_clinica: string | null; observacoes: string | null;
}
interface Lote {
  id: string; numero: number; convenio_id: string; convenio_nome: string; inicio: string; fim: string; guias: number; sessoes: number; total: number;
  status: "aberto" | "enviado" | "pago" | "pago_com_glosa"; protocolo?: string | null; recebido: number | null; glosa: number | null; motivo_glosa?: string | null;
  itens: { paciente_nome: string; data: string; codigo: string; descricao: string; valor: number; numero_guia: string }[];
}

const SIT: Record<Situacao, { t: string; cor: string }> = {
  solicitada: { t: "Solicitada", cor: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  autorizada: { t: "Autorizada", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  negada: { t: "Negada", cor: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  esgotada: { t: "Sessões usadas", cor: "bg-muted text-muted-foreground" },
  vencida: { t: "Vencida", cor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
};
const LOTE: Record<Lote["status"], string> = { aberto: "Aberto", enviado: "Enviado", pago: "Pago", pago_com_glosa: "Pago com glosa" };
const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const br = (d: string | null) => (d ? d.split("-").reverse().join("/") : "-");
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Convênios: guias com saldo de sessões, faturamento em lote com XML TISS e cadastro das operadoras. */
export default function Convenios() {
  const { isAdmin } = useAuth();
  const [aba, setAba] = useState<"guias" | "faturamento" | "operadoras">("guias");
  const convs = useQuery({ queryKey: ["convenios"], queryFn: () => apiGet<Convenio[]>("/convenios") });
  return (
    <div className="space-y-4" data-testid="convenios">
      <div className="inline-flex rounded-lg border bg-card p-0.5" role="tablist">
        {([["guias", "Guias"], ...(isAdmin ? [["faturamento", "Faturamento"], ["operadoras", "Operadoras"]] : [])] as [typeof aba, string][]).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", aba === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")} data-testid={`conv-aba-${k}`}>{t}</button>
        ))}
      </div>
      {(convs.data ?? []).length === 0 && aba !== "operadoras" && (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Cadastre a primeira operadora{isAdmin ? " na aba Operadoras" : " (peça ao gestor)"} para lançar guias.</p>
      )}
      {aba === "guias" && <Guias convenios={convs.data ?? []} />}
      {aba === "faturamento" && <Faturamento convenios={convs.data ?? []} />}
      {aba === "operadoras" && <Operadoras convenios={convs.data ?? []} />}
    </div>
  );
}

function Guias({ convenios }: { convenios: Convenio[] }) {
  const q = useQuery({ queryKey: ["guias"], queryFn: () => apiGet<Guia[]>("/convenios/guias") });
  const [editar, setEditar] = useState<Guia | "nova" | null>(null);
  const [filtro, setFiltro] = useState<"ativas" | "alerta" | "todas">("ativas");
  const lista = (q.data ?? []).filter((g) => filtro === "todas" || (filtro === "alerta" ? g.alerta : ["autorizada", "solicitada"].includes(g.situacao)));
  const alertas = (q.data ?? []).filter((g) => g.alerta).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
          {([["ativas", "Ativas"], ["alerta", `Vencendo ou acabando (${alertas})`], ["todas", "Todas"]] as const).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setFiltro(k)} className={cn("rounded-md px-3 py-1", filtro === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{t}</button>
          ))}
        </div>
        <Button size="sm" onClick={() => setEditar("nova")} disabled={!convenios.length} data-testid="guia-nova"><Plus className="h-4 w-4" /> Nova guia</Button>
      </div>
      <p className="text-xs text-muted-foreground">Cada presença marcada numa sessão coberta pela guia consome uma sessão. Guia cadastrada depois da sessão consome as presenças que ela cobre.</p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2 pl-3">Paciente</th><th className="p-2">Operadora</th><th className="p-2">Senha / guia</th><th className="p-2">Validade</th><th className="p-2">Sessões</th><th className="p-2">Situação</th></tr></thead>
          <tbody>
            {lista.map((g) => (
              <tr key={g.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setEditar(g)} data-testid="guia-linha">
                <td className="p-2 pl-3 font-medium">{g.paciente_nome}<span className="block text-xs font-normal text-muted-foreground">carteira {g.numero_carteira}</span></td>
                <td className="p-2">{g.convenio_nome}</td>
                <td className="p-2">{g.senha || g.numero_operadora || "-"}<span className="block text-xs text-muted-foreground">nº {g.numero_prestador}</span></td>
                <td className={cn("p-2", g.alerta && g.vence_em_dias != null && g.vence_em_dias <= 7 && "font-medium text-amber-700 dark:text-amber-400")}>{br(g.validade)}</td>
                <td className="p-2"><span className={cn(g.alerta && g.saldo <= 2 && "font-semibold text-amber-700 dark:text-amber-400")}>{g.usadas} de {g.sessoes_autorizadas}</span><div className="mt-1 h-1.5 w-24 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${Math.min(100, (g.usadas * 100) / g.sessoes_autorizadas)}%` }} /></div></td>
                <td className="p-2"><span className={cn("rounded-full px-2 py-0.5 text-xs", SIT[g.situacao].cor)}>{SIT[g.situacao].t}</span>{g.alerta && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-amber-600" />}</td>
              </tr>
            ))}
            {!q.isLoading && lista.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhuma guia aqui.</td></tr>}
          </tbody>
        </table>
      </div>
      {editar && <GuiaDialog guia={editar === "nova" ? null : editar} convenios={convenios} onFechar={() => setEditar(null)} />}
    </div>
  );
}

function GuiaDialog({ guia, convenios, onFechar }: { guia: Guia | null; convenios: Convenio[]; onFechar: () => void }) {
  const qc = useQueryClient();
  const seg = useSegmento();
  const servicos = useServicos();
  const pacientes = useQuery({ queryKey: ["pacientes-lista"], queryFn: () => apiGet<{ id: string; nome: string; telefone: string | null; carteiras?: { convenio_id: string; numero: string }[] }[]>("/pacientes") });
  const [f, setF] = useState({
    convenio_id: guia?.convenio_id ?? convenios[0]?.id ?? "", paciente_id: guia?.paciente_id ?? "", numero_carteira: guia?.numero_carteira ?? "", servico_id: guia?.servico_id ?? "",
    status: guia?.status ?? "autorizada", numero_operadora: guia?.numero_operadora ?? "", senha: guia?.senha ?? "", data_solicitacao: guia?.data_solicitacao ?? "",
    data_autorizacao: guia?.data_autorizacao ?? hojeIso(), validade: guia?.validade ?? "", sessoes_autorizadas: String(guia?.sessoes_autorizadas ?? 10),
    indicacao_clinica: guia?.indicacao_clinica ?? "", observacoes: guia?.observacoes ?? "",
  });
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f, servico_id: f.servico_id || null, numero_operadora: f.numero_operadora || null, senha: f.senha || null, data_solicitacao: f.data_solicitacao || null,
        data_autorizacao: f.data_autorizacao || null, validade: f.validade || null, sessoes_autorizadas: Number(f.sessoes_autorizadas) || 1,
        indicacao_clinica: f.indicacao_clinica || null, observacoes: f.observacoes || null };
      return guia ? apiPut<Guia>(`/convenios/guias/${guia.id}`, corpo) : apiPost<Guia>("/convenios/guias", corpo);
    },
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ["guias"] }); toast.success(g.usadas ? `Guia salva. ${g.usadas} sessão(ões) já consumida(s).` : "Guia salva."); onFechar(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Confira os campos."),
  });
  const remover = useMutation({
    mutationFn: () => apiDelete(`/convenios/guias/${guia!.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["guias"] }); toast.success("Guia excluída."); onFechar(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir."),
  });
  const escolherPaciente = (id: string | null) => {
    const p = (pacientes.data ?? []).find((x) => x.id === id);
    const cart = p?.carteiras?.find((c) => c.convenio_id === f.convenio_id)?.numero;
    setF({ ...f, paciente_id: id ?? "", numero_carteira: cart ?? f.numero_carteira });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{guia ? `Guia ${guia.numero_prestador}` : "Nova guia"}</DialogTitle><DialogDescription>Dados da autorização que a operadora liberou.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label>Operadora</Label><select className={sel} value={f.convenio_id} disabled={!!guia} onChange={(e) => setF({ ...f, convenio_id: e.target.value })}>{convenios.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>
          <div className="grid gap-1.5"><Label>{seg.termos.cliente}</Label>
            {guia ? <Input value={guia.paciente_nome} disabled /> : <Combo opcoes={(pacientes.data ?? []).map((p) => ({ valor: p.id, rotulo: p.nome, detalhe: p.telefone }))} valor={f.paciente_id || null} onChange={escolherPaciente} placeholder="Buscar" testid="guia-paciente" />}
          </div>
          <div className="grid gap-1.5"><Label>Número da carteirinha</Label><Input value={f.numero_carteira} onChange={(e) => setF({ ...f, numero_carteira: e.target.value })} data-testid="guia-carteira" /></div>
          <div className="grid gap-1.5"><Label>Serviço coberto</Label><select className={sel} value={f.servico_id} onChange={(e) => setF({ ...f, servico_id: e.target.value })}><option value="">Qualquer serviço</option>{(servicos.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></div>
          <div className="grid gap-1.5"><Label>Situação</Label><select className={sel} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Guia["status"] })}><option value="solicitada">Solicitada (aguardando)</option><option value="autorizada">Autorizada</option><option value="negada">Negada</option></select></div>
          <div className="grid gap-1.5"><Label>Sessões autorizadas</Label><Input inputMode="numeric" value={f.sessoes_autorizadas} onChange={(e) => setF({ ...f, sessoes_autorizadas: e.target.value.replace(/\D/g, "") })} data-testid="guia-sessoes" /></div>
          <div className="grid gap-1.5"><Label>Senha</Label><Input value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} data-testid="guia-senha" /></div>
          <div className="grid gap-1.5"><Label>Nº da guia na operadora</Label><Input value={f.numero_operadora} onChange={(e) => setF({ ...f, numero_operadora: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label>Autorizada em</Label><Input type="date" value={f.data_autorizacao} onChange={(e) => setF({ ...f, data_autorizacao: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label>Validade da senha</Label><Input type="date" value={f.validade} onChange={(e) => setF({ ...f, validade: e.target.value })} data-testid="guia-validade" /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label>Indicação clínica</Label><Input value={f.indicacao_clinica} maxLength={500} onChange={(e) => setF({ ...f, indicacao_clinica: e.target.value })} /></div>
        </div>
        {guia && <p className="text-sm text-muted-foreground">{guia.usadas} de {guia.sessoes_autorizadas} sessões usadas.</p>}
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          {guia && !guia.usadas ? <Button variant="ghost" className="text-destructive" onClick={() => { if (window.confirm("Excluir a guia?")) remover.mutate(); }}>Excluir</Button> : <span />}
          <div className="flex gap-2"><Button variant="outline" onClick={onFechar}>Fechar</Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !f.paciente_id || f.numero_carteira.length < 3} data-testid="guia-salvar">{salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Faturamento({ convenios }: { convenios: Convenio[] }) {
  const qc = useQueryClient();
  const hoje = new Date();
  const [f, setF] = useState({ convenio_id: convenios[0]?.id ?? "", inicio: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`, fim: hojeIso() });
  const [ver, setVer] = useState<Lote | null>(null);
  const lotes = useQuery({ queryKey: ["lotes"], queryFn: () => apiGet<Lote[]>("/convenios/lotes") });
  const conta = useQuery({ queryKey: ["a-faturar", f], queryFn: () => apiGet<{ sessoes: number; pacientes: number }>(`/convenios/a-faturar?convenio_id=${f.convenio_id}&inicio=${f.inicio}&fim=${f.fim}`), enabled: !!f.convenio_id });
  const criar = useMutation({
    mutationFn: () => apiPost<Lote>("/convenios/lotes", { ...f, convenio_id: f.convenio_id || convenios[0]?.id }),
    onSuccess: (l) => { qc.invalidateQueries({ queryKey: ["lotes"] }); qc.invalidateQueries({ queryKey: ["a-faturar"] }); toast.success(`Lote ${l.numero} criado com ${l.sessoes} sessões.`); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar o lote."),
  });
  const baixarXml = async (l: Lote) => {
    const r = await fetch(urlApi(`/api/convenios/lotes/${l.id}/xml`), { credentials: "include" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast.error(j.detail ?? "Não foi possível gerar o XML."); return; }
    const blob = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `lote-${String(l.numero).padStart(5, "0")}.xml`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>O XML segue o Padrão TISS 4.03.00 (guia SP/SADT), mas não passa por validação oficial aqui. Antes do primeiro envio real, suba o arquivo no portal da operadora ou num validador TISS e ajuste o que ela pedir na configuração da operadora.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
        <div className="grid gap-1"><span className="text-xs text-muted-foreground">Operadora</span><select className={cn(sel, "w-52")} value={f.convenio_id} onChange={(e) => setF({ ...f, convenio_id: e.target.value })}>{convenios.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>
        <div className="grid gap-1"><span className="text-xs text-muted-foreground">De</span><Input type="date" className="w-40" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></div>
        <div className="grid gap-1"><span className="text-xs text-muted-foreground">Até</span><Input type="date" className="w-40" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} /></div>
        <Button onClick={() => criar.mutate()} disabled={criar.isPending || !conta.data?.sessoes} data-testid="lote-criar">{criar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Criar lote</Button>
        <span className="text-sm text-muted-foreground">{conta.data ? `${conta.data.sessoes} sessão(ões) de ${conta.data.pacientes} paciente(s) a faturar` : ""}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2 pl-3">Lote</th><th className="p-2">Operadora</th><th className="p-2">Período</th><th className="p-2">Sessões</th><th className="p-2">Total</th><th className="p-2">Situação</th><th className="p-2" /></tr></thead>
          <tbody>
            {(lotes.data ?? []).map((l) => (
              <tr key={l.id} className="border-t" data-testid="lote-linha">
                <td className="p-2 pl-3 font-medium">{l.numero}</td><td className="p-2">{l.convenio_nome}</td><td className="p-2">{br(l.inicio)} a {br(l.fim)}</td><td className="p-2">{l.sessoes}</td>
                <td className="p-2">{brl(l.total)}{l.glosa ? <span className="block text-xs text-red-600">glosa {brl(l.glosa)}</span> : null}</td>
                <td className="p-2">{LOTE[l.status]}{l.protocolo ? <span className="block text-xs text-muted-foreground">protocolo {l.protocolo}</span> : null}</td>
                <td className="p-2 text-right"><div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => baixarXml(l)} data-testid="lote-xml"><Download className="h-4 w-4" /> XML</Button>
                  <Button size="sm" variant="ghost" onClick={() => setVer(l)}>Abrir</Button></div></td>
              </tr>
            ))}
            {(lotes.data ?? []).length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nenhum lote ainda.</td></tr>}
          </tbody>
        </table>
      </div>
      {ver && <LoteDialog lote={ver} onFechar={() => setVer(null)} />}
    </div>
  );
}

function LoteDialog({ lote, onFechar }: { lote: Lote; onFechar: () => void }) {
  const qc = useQueryClient();
  const [protocolo, setProtocolo] = useState("");
  const [rec, setRec] = useState({ valor: String(lote.total), data: hojeIso(), motivo_glosa: "" });
  const pronto = () => { qc.invalidateQueries({ queryKey: ["lotes"] }); qc.invalidateQueries({ queryKey: ["a-faturar"] }); onFechar(); };
  const enviar = useMutation({ mutationFn: () => apiPost(`/convenios/lotes/${lote.id}/enviado`, { protocolo: protocolo || null }), onSuccess: () => { toast.success("Lote marcado como enviado."); pronto(); }, onError: (e) => toast.error(detalheErro(e) ?? "Erro") });
  const receber = useMutation({ mutationFn: () => apiPost(`/convenios/lotes/${lote.id}/recebido`, { valor: Number(rec.valor.replace(",", ".")) || 0, data: rec.data, motivo_glosa: rec.motivo_glosa || null }), onSuccess: () => { toast.success("Recebimento lançado no Financeiro."); pronto(); }, onError: (e) => toast.error(detalheErro(e) ?? "Erro") });
  const desfazer = useMutation({ mutationFn: () => apiDelete(`/convenios/lotes/${lote.id}`), onSuccess: () => { toast.success("Lote desfeito. As sessões voltam para a fila."); pronto(); }, onError: (e) => toast.error(detalheErro(e) ?? "Erro") });
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Lote {lote.numero} · {lote.convenio_nome}</DialogTitle><DialogDescription>{lote.sessoes} sessões em {lote.guias} guia(s), {brl(lote.total)}.</DialogDescription></DialogHeader>
        <ul className="max-h-60 divide-y overflow-y-auto text-sm">{lote.itens.map((i, n) => <li key={n} className="flex justify-between gap-2 py-1"><span>{br(i.data)} · {i.paciente_nome} · {i.codigo} <span className="text-xs text-muted-foreground">guia {i.numero_guia}</span></span><span>{brl(i.valor)}</span></li>)}</ul>
        {lote.status === "aberto" && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
            <div className="grid flex-1 gap-1"><Label>Protocolo da operadora (opcional)</Label><Input value={protocolo} onChange={(e) => setProtocolo(e.target.value)} /></div>
            <Button onClick={() => enviar.mutate()} disabled={enviar.isPending}>Marcar enviado</Button>
            <Button variant="ghost" className="text-destructive" onClick={() => { if (window.confirm("Desfazer o lote? As sessões voltam para faturar.")) desfazer.mutate(); }}>Desfazer</Button>
          </div>
        )}
        {(lote.status === "enviado" || lote.status === "aberto") && (
          <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
            <div className="grid gap-1"><Label>Valor recebido</Label><Input inputMode="decimal" value={rec.valor} onChange={(e) => setRec({ ...rec, valor: e.target.value })} /></div>
            <div className="grid gap-1"><Label>Data</Label><Input type="date" value={rec.data} onChange={(e) => setRec({ ...rec, data: e.target.value })} /></div>
            <div className="grid gap-1 sm:col-span-2"><Label>Motivo da glosa (se recebeu menos)</Label><Input value={rec.motivo_glosa} onChange={(e) => setRec({ ...rec, motivo_glosa: e.target.value })} /></div>
            <Button className="sm:col-span-2" onClick={() => receber.mutate()} disabled={receber.isPending}>Registrar recebimento</Button>
          </div>
        )}
        {lote.motivo_glosa && <p className="text-sm text-red-600">Glosa: {lote.motivo_glosa}</p>}
      </DialogContent>
    </Dialog>
  );
}

function Operadoras({ convenios }: { convenios: Convenio[] }) {
  const qc = useQueryClient();
  const servicos = useServicos();
  const profs = useProfissionais(true);
  const modelos = useQuery({ queryKey: ["convenios-modelos"], queryFn: () => apiGet<{ operadoras: { chave: string; nome: string; registro_ans: string }[]; conselhos: Record<string, string> }>("/convenios/modelos") });
  const tissProfs = useQuery({ queryKey: ["convenios-profs"], queryFn: () => apiGet<{ usuario_id: string; nome: string; registro: string | null; tiss: { conselho: string; numero_conselho: string; uf: string; cbos: string } | null }[]>("/convenios/profissionais") });
  const vazio = { nome: "", registro_ans: "", codigo_prestador: "", cnes: "", versao_tiss: "4.03.00", codigo_tabela: "22", tipo_atendimento: "", regime_atendimento: "01", tabela: [] as Convenio["tabela"], portal: "", observacoes: "", ativo: true };
  const [f, setF] = useState<(typeof vazio & { id?: string }) | null>(null);
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f!, codigo_prestador: f!.codigo_prestador || null, cnes: f!.cnes || null, tipo_atendimento: f!.tipo_atendimento || null, portal: f!.portal || null, observacoes: f!.observacoes || null,
        tabela: f!.tabela.filter((t) => t.codigo).map((t) => ({ ...t, valor: Number(t.valor) || 0 })) };
      delete (corpo as { id?: string }).id;
      return f!.id ? apiPut(`/convenios/${f!.id}`, corpo) : apiPost("/convenios", corpo);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["convenios"] }); setF(null); toast.success("Operadora salva."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Confira os campos."),
  });
  const salvarProf = useMutation({
    mutationFn: (v: { id: string; conselho: string; numero_conselho: string; uf: string; cbos: string }) => apiPut(`/convenios/profissionais/${v.id}`, { conselho: v.conselho, numero_conselho: v.numero_conselho, uf: v.uf.toUpperCase(), cbos: v.cbos }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["convenios-profs"] }); toast.success("Dados TISS salvos."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Confira conselho, número, UF (2 letras) e CBO (6 dígitos)."),
  });
  const valorTab = (sid: string) => f?.tabela.find((t) => t.servico_id === sid);
  const mudarTab = (sid: string, m: Partial<Convenio["tabela"][number]>) => setF((x) => x && ({ ...x, tabela: [...x.tabela.filter((t) => t.servico_id !== sid), { servico_id: sid, codigo: "", descricao: null, valor: 0, ...valorTab(sid), ...m }] }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setF({ ...vazio })} data-testid="op-nova"><Plus className="h-4 w-4" /> Operadora</Button>
        {(modelos.data?.operadoras ?? []).filter((m) => !convenios.some((c) => c.registro_ans === m.registro_ans)).map((m) => (
          <Button key={m.chave} size="sm" variant="outline" onClick={() => setF({ ...vazio, nome: m.nome, registro_ans: m.registro_ans })} data-testid={`op-modelo-${m.chave}`}><Plus className="h-4 w-4" /> {m.nome}</Button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {convenios.map((c) => (
          <button key={c.id} type="button" onClick={() => setF({ ...vazio, ...c, codigo_prestador: c.codigo_prestador ?? "", cnes: c.cnes ?? "", tipo_atendimento: c.tipo_atendimento ?? "", portal: c.portal ?? "", observacoes: c.observacoes ?? "" })}
            className="rounded-xl border bg-card p-4 text-left hover:bg-muted/40">
            <p className="font-medium">{c.nome}</p>
            <p className="text-xs text-muted-foreground">ANS {c.registro_ans} · TISS {c.versao_tiss} · {c.tabela.length} serviço(s) na tabela{c.codigo_prestador ? ` · prestador ${c.codigo_prestador}` : " · falta o código do prestador"}</p>
          </button>
        ))}
      </div>
      <div className="rounded-xl border bg-card p-4">
        <p className="font-medium">Dados TISS dos profissionais</p>
        <p className="mb-2 text-xs text-muted-foreground">Vão na guia como executante. Conselho pela tabela de domínio da TISS; CBO de 6 dígitos (ex.: o da sua ocupação no cadastro do conselho).</p>
        <div className="grid gap-2">
          {(tissProfs.data ?? []).map((p) => <TissProf key={p.usuario_id} p={p} conselhos={modelos.data?.conselhos ?? {}} onSalvar={(v) => salvarProf.mutate({ id: p.usuario_id, ...v })} />)}
          {(profs.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Ninguém marcado como quem atende.</p>}
        </div>
      </div>
      {f && (
        <Dialog open onOpenChange={(o) => !o && setF(null)}>
          <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader><DialogTitle>{f.id ? f.nome : "Nova operadora"}</DialogTitle><DialogDescription>Registro ANS, código que a operadora deu para a clínica e o valor de cada serviço.</DialogDescription></DialogHeader>
            {f.registro_ans === "005711" && <p className="rounded-md bg-muted p-2 text-xs">Bradesco Saúde: registro ANS 005711. Confira no seu contrato o código de prestador, a tabela e os códigos TUSS que ela paga para cada terapia.</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1 sm:col-span-2"><Label>Nome</Label><Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} data-testid="op-nome" /></div>
              <div className="grid gap-1"><Label>Registro ANS (6 dígitos)</Label><Input value={f.registro_ans} maxLength={6} onChange={(e) => setF({ ...f, registro_ans: e.target.value.replace(/\D/g, "") })} data-testid="op-ans" /></div>
              <div className="grid gap-1"><Label>Código do prestador</Label><Input value={f.codigo_prestador} onChange={(e) => setF({ ...f, codigo_prestador: e.target.value })} data-testid="op-prestador" /></div>
              <div className="grid gap-1"><Label>CNES (7 dígitos)</Label><Input value={f.cnes} maxLength={7} onChange={(e) => setF({ ...f, cnes: e.target.value.replace(/\D/g, "") })} /></div>
              <div className="grid gap-1"><Label>Versão TISS</Label><Input value={f.versao_tiss} onChange={(e) => setF({ ...f, versao_tiss: e.target.value })} /></div>
              <div className="grid gap-1"><Label>Tipo de atendimento</Label><Input value={f.tipo_atendimento} maxLength={2} placeholder="Tabela de domínio" onChange={(e) => setF({ ...f, tipo_atendimento: e.target.value.replace(/\D/g, "") })} /></div>
              <div className="grid gap-1"><Label>Código da tabela</Label><Input value={f.codigo_tabela} maxLength={2} onChange={(e) => setF({ ...f, codigo_tabela: e.target.value.replace(/\D/g, "") })} /></div>
              <div className="grid gap-1"><Label>Portal da operadora</Label><Input value={f.portal} placeholder="https://" onChange={(e) => setF({ ...f, portal: e.target.value })} /></div>
            </div>
            <div className="grid gap-2">
              <Label>Tabela: código TUSS e valor por serviço</Label>
              {(servicos.data ?? []).filter((s) => s.ativo).map((s) => {
                const t = valorTab(s.id);
                return (
                  <div key={s.id} className="grid grid-cols-[1fr_120px_110px] items-center gap-2 text-sm" data-testid="op-tabela">
                    <span className="truncate">{s.nome}</span>
                    <Input placeholder="Código" value={t?.codigo ?? ""} onChange={(e) => mudarTab(s.id, { codigo: e.target.value.replace(/\D/g, ""), descricao: s.nome })} />
                    <Input placeholder="Valor" inputMode="decimal" value={t?.valor ? String(t.valor) : ""} onChange={(e) => mudarTab(s.id, { valor: Number(e.target.value.replace(",", ".")) || 0 })} />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setF(null)}>Fechar</Button><Button onClick={() => salvar.mutate()} disabled={salvar.isPending || f.nome.length < 2 || f.registro_ans.length !== 6} data-testid="op-salvar">Salvar</Button></div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function TissProf({ p, conselhos, onSalvar }: { p: { nome: string; registro: string | null; tiss: { conselho: string; numero_conselho: string; uf: string; cbos: string } | null }; conselhos: Record<string, string>; onSalvar: (v: { conselho: string; numero_conselho: string; uf: string; cbos: string }) => void }) {
  const [v, setV] = useState(p.tiss ?? { conselho: "09", numero_conselho: (p.registro ?? "").replace(/\D/g, ""), uf: "", cbos: "" });
  return (
    <div className="grid grid-cols-2 items-end gap-2 text-sm sm:grid-cols-[1.4fr_1fr_1fr_70px_110px_auto]">
      <span className="col-span-2 truncate font-medium sm:col-span-1">{p.nome}{!p.tiss && <span className="ml-1 text-xs text-amber-600">pendente</span>}</span>
      <select className={sel} value={v.conselho} onChange={(e) => setV({ ...v, conselho: e.target.value })}>{Object.entries(conselhos).map(([k, t]) => <option key={k} value={k}>{k} {t}</option>)}</select>
      <Input placeholder="Número" value={v.numero_conselho} onChange={(e) => setV({ ...v, numero_conselho: e.target.value })} />
      <Input placeholder="UF" maxLength={2} value={v.uf} onChange={(e) => setV({ ...v, uf: e.target.value.toUpperCase() })} />
      <Input placeholder="CBO" maxLength={6} value={v.cbos} onChange={(e) => setV({ ...v, cbos: e.target.value.replace(/\D/g, "") })} />
      <Button size="sm" variant="outline" onClick={() => onSalvar(v)}>Salvar</Button>
    </div>
  );
}
