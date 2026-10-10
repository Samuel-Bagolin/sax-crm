import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, FileText, Inbox, Plus, Search, UserPlus, UserRound } from "lucide-react";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { brl, dataBR } from "@/lib/format";
import { useSegmento } from "@/lib/segmento";
import { usePlano } from "@/lib/diferenciais";
import type { FichaPaciente, ItemTratamento } from "@/lib/pacientes";
import PainelOdonto from "@/components/odonto/PainelOdonto";
import PainelFacial from "@/components/estetica/PainelFacial";
import { NovoOrcamento } from "@/pages/PacienteDetalhe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface OrcamentoLinha {
  id: string;
  paciente_id: string;
  paciente_nome: string;
  titulo: string;
  tipo: string;
  status: "rascunho" | "apresentado" | "aprovado" | "recusado" | "concluido";
  total: number;
  parcelas: number;
  profissional_nome: string;
  created_at: string;
}
interface Achado { tipo: "paciente" | "lead"; id: string; nome: string; telefone: string | null; cpf: string | null }

const STATUS: Record<OrcamentoLinha["status"], { rotulo: string; classe: string }> = {
  rascunho: { rotulo: "Rascunho", classe: "bg-muted text-muted-foreground" },
  apresentado: { rotulo: "Apresentado", classe: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  aprovado: { rotulo: "Aprovado", classe: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  recusado: { rotulo: "Recusado", classe: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
  concluido: { rotulo: "Concluído", classe: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
};

export default function Orcamentos() {
  const [novo, setNovo] = useState(false);
  return novo ? <CriarOrcamento onVoltar={() => setNovo(false)} /> : <Lista onNovo={() => setNovo(true)} />;
}

function Lista({ onNovo }: { onNovo: () => void }) {
  const seg = useSegmento();
  const [filtro, setFiltro] = useState<string>("");
  const q = useQuery({ queryKey: ["orcamentos", filtro], queryFn: () => apiGet<OrcamentoLinha[]>(`/pacientes/orcamentos/lista${filtro ? `?status=${filtro}` : ""}`) });
  const lista = q.data ?? [];
  const soma = (st: string) => lista.filter((o) => o.status === st).reduce((a, o) => a + o.total, 0);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {[["", "Todos"], ["rascunho", "Rascunho"], ["apresentado", "Apresentados"], ["aprovado", "Aprovados"], ["recusado", "Recusados"]].map(([v, r]) => (
            <button key={v} type="button" onClick={() => setFiltro(v)}
              className={cn("rounded-full border px-3 py-1 text-sm", filtro === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{r}</button>
          ))}
        </div>
        <Link to="/crm" className="ml-auto text-sm text-muted-foreground hover:text-foreground">Ver funil</Link>
        <Button onClick={onNovo} data-testid="novo-orcamento"><Plus className="h-4 w-4" /> Novo orçamento</Button>
      </div>
      {!filtro && lista.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Resumo rotulo="Em aberto" valor={brl(soma("rascunho") + soma("apresentado"))} />
          <Resumo rotulo="Aprovados" valor={brl(soma("aprovado") + soma("concluido"))} />
          <Resumo rotulo="Recusados" valor={brl(soma("recusado"))} />
          <Resumo rotulo="Conversão" valor={`${Math.round((lista.filter((o) => ["aprovado", "concluido"].includes(o.status)).length / Math.max(1, lista.filter((o) => o.status !== "rascunho").length)) * 100)}%`} />
        </div>
      )}
      <div className="overflow-hidden rounded-xl border bg-card">
        {q.isLoading ? <div className="h-40 animate-pulse bg-muted/40" /> : !lista.length ? (
          <div className="p-10 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 font-medium">Nenhum orçamento {filtro ? "nesta situação" : "ainda"}.</p>
            <p className="text-sm text-muted-foreground">Crie o primeiro: escolha o {seg.termos.cliente.toLowerCase()} e marque os procedimentos {seg.odonto ? "no odontograma" : "no mapa facial"}.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {lista.map((o) => (
              <li key={o.id}>
                <Link to={`/pacientes/${o.paciente_id}?aba=orcamentos`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{o.paciente_nome}</p>
                    <p className="truncate text-xs text-muted-foreground">{o.titulo}, {o.profissional_nome}, {dataBR(String(o.created_at).slice(0, 10))}</p>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS[o.status].classe)}>{STATUS[o.status].rotulo}</span>
                  <span className="num w-28 text-right font-semibold">{brl(o.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="num mt-1 text-xl font-bold">{valor}</p>
    </div>
  );
}

/** Novo orçamento direto: escolhe paciente ou lead (ou cadastra na hora) e marca no odontograma ou no rosto. */
function CriarOrcamento({ onVoltar }: { onVoltar: () => void }) {
  const seg = useSegmento();
  const { tem } = usePlano();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [pacienteId, setPacienteId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<ItemTratamento[]>([]);
  const [criando, setCriando] = useState<"odonto" | "facial" | null>(null);
  const ficha = useQuery({ queryKey: ["ficha", pacienteId], queryFn: () => apiGet<FichaPaciente>(`/pacientes/${pacienteId}`), enabled: !!pacienteId });
  const tipo: "odonto" | "facial" = seg.odonto ? "odonto" : "facial";
  const libera = seg.odonto ? tem("odontograma") : tem("mapa_facial");

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onVoltar} aria-label="Voltar"><ArrowLeft className="h-5 w-5" /></Button>
        <div>
          <h2 className="text-lg font-semibold">Novo orçamento</h2>
          <p className="text-sm text-muted-foreground">{pacienteId && ficha.data ? `Para ${ficha.data.paciente.nome}` : `Primeiro, para quem é o orçamento.`}</p>
        </div>
        {pacienteId && <Button variant="outline" size="sm" className="ml-auto" onClick={() => { setPacienteId(null); setRascunho([]); }}>Trocar {seg.termos.cliente.toLowerCase()}</Button>}
      </div>

      {!pacienteId ? (
        <EscolherPaciente onEscolhido={setPacienteId} />
      ) : !ficha.data ? (
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      ) : !libera ? (
        <p className="rounded-xl border p-6 text-sm">O {seg.odonto ? "odontograma 3D" : "mapa facial 3D"} não faz parte do plano atual. Veja os planos em Assinatura.</p>
      ) : tipo === "odonto" ? (
        <PainelOdonto pacienteId={pacienteId} odontograma={ficha.data.odontograma} rascunho={rascunho} setRascunho={setRascunho} onSalvarOrcamento={() => setCriando("odonto")} />
      ) : (
        <PainelFacial rascunho={rascunho} setRascunho={setRascunho} onSalvarOrcamento={() => setCriando("facial")} />
      )}

      {pacienteId && (
        <NovoOrcamento
          tipo={criando}
          pacienteId={pacienteId}
          itens={rascunho}
          onClose={() => setCriando(null)}
          onCriado={() => {
            qc.invalidateQueries({ queryKey: ["orcamentos"] });
            navigate(`/pacientes/${pacienteId}?aba=orcamentos`);
          }}
        />
      )}
    </div>
  );
}

function EscolherPaciente({ onEscolhido }: { onEscolhido: (id: string) => void }) {
  const seg = useSegmento();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [novo, setNovo] = useState<{ nome: string; telefone: string; cpf: string } | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setTermo(busca.trim()), 300);
    return () => window.clearTimeout(t);
  }, [busca]);
  // Carrega a lista uma vez e filtra aqui: buscar no servidor a cada letra leria o banco inteiro de novo (o Firestore cobra por leitura).
  const pacientes = useQuery({ queryKey: ["pacientes-lista"], queryFn: () => apiGet<{ id: string; nome: string; telefone: string | null; cpf_cnpj?: string | null }[]>("/pacientes") });
  const leads = useQuery({ queryKey: ["entradas", "ativos"], queryFn: () => apiGet<{ id: string; nome: string; telefone: string | null; cliente_id?: string | null }[]>("/entradas") });
  const achados = useMemo(() => {
    if (termo.length < 2) return { data: [] as Achado[], isLoading: false };
    const t = termo.toLowerCase();
    const dig = termo.replace(/\D/g, "");
    const bate = (nome: string, tel?: string | null, doc?: string | null) =>
      nome.toLowerCase().includes(t) || (dig.length >= 4 && ((tel ?? "").replace(/\D/g, "").includes(dig) || (doc ?? "").replace(/\D/g, "").includes(dig)));
    const ps: Achado[] = (pacientes.data ?? []).filter((p) => bate(p.nome, p.telefone, p.cpf_cnpj)).slice(0, 8)
      .map((p) => ({ tipo: "paciente", id: p.id, nome: p.nome, telefone: p.telefone, cpf: p.cpf_cnpj ?? null }));
    const ls: Achado[] = (leads.data ?? []).filter((e) => !e.cliente_id && bate(e.nome, e.telefone)).slice(0, 6)
      .map((e) => ({ tipo: "lead", id: e.id, nome: e.nome, telefone: e.telefone, cpf: null }));
    return { data: [...ps, ...ls], isLoading: pacientes.isLoading || leads.isLoading };
  }, [termo, pacientes.data, leads.data, pacientes.isLoading, leads.isLoading]);
  const cadastrar = useMutation({
    mutationFn: (corpo: { entrada_id?: string; nome?: string; telefone?: string | null; cpf_cnpj?: string | null }) =>
      apiPost<{ paciente: { id: string; nome: string }; lead_criado: boolean; ja_existia: boolean }>("/pacientes/orcamentos/paciente", corpo),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["entradas"] });
      qc.invalidateQueries({ queryKey: ["pacientes-lista"] });
      if (r.ja_existia) toast.info(`${r.paciente.nome} já tinha cadastro com este CPF. Seguimos com ele.`);
      else if (r.lead_criado) toast.success(`${r.paciente.nome} cadastrado e incluído em Leads.`);
      else toast.success(`Lead ${r.paciente.nome} agora é ${seg.termos.cliente.toLowerCase()}.`);
      onEscolhido(r.paciente.id);
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível cadastrar"),
  });
  const lista = achados.data ?? [];
  const pareceDoc = busca.replace(/\D/g, "").length === 11;

  if (novo) {
    return (
      <section className="grid max-w-xl gap-3 rounded-xl border bg-card p-5">
        <p className="font-semibold">Cadastrar e criar o orçamento</p>
        <p className="text-sm text-muted-foreground">A pessoa entra como {seg.termos.cliente.toLowerCase()} e também em Leads, para o comercial acompanhar a decisão.</p>
        <div className="grid gap-1.5"><Label htmlFor="np-nome">Nome</Label><Input id="np-nome" autoFocus value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} data-testid="orc-novo-nome" /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="np-tel">WhatsApp</Label><Input id="np-tel" inputMode="tel" value={novo.telefone} onChange={(e) => setNovo({ ...novo, telefone: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="np-cpf">CPF</Label><Input id="np-cpf" inputMode="numeric" value={novo.cpf} onChange={(e) => setNovo({ ...novo, cpf: e.target.value })} placeholder="Opcional" /></div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setNovo(null)}>Voltar</Button>
          <Button onClick={() => cadastrar.mutate({ nome: novo.nome.trim(), telefone: novo.telefone.trim() || null, cpf_cnpj: novo.cpf.trim() || null })}
            disabled={novo.nome.trim().length < 2 || cadastrar.isPending} data-testid="orc-novo-salvar">Cadastrar e continuar</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="grid max-w-2xl gap-3 rounded-xl border bg-card p-5">
      <Label htmlFor="orc-busca">Buscar {seg.termos.cliente.toLowerCase()} ou lead</Label>
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input id="orc-busca" autoFocus className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, WhatsApp ou CPF" data-testid="orc-busca" />
      </div>
      {termo.length >= 2 && (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {lista.map((a) => (
            <li key={`${a.tipo}-${a.id}`}>
              <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50" disabled={cadastrar.isPending}
                onClick={() => (a.tipo === "paciente" ? onEscolhido(a.id) : cadastrar.mutate({ entrada_id: a.id }))} data-testid={`orc-achado-${a.id}`}>
                {a.tipo === "paciente" ? <UserRound className="h-4 w-4 text-primary" /> : <Inbox className="h-4 w-4 text-[#ff7a00]" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[a.telefone, a.cpf].filter(Boolean).join(", ") || "Sem contato"}</span>
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{a.tipo === "paciente" ? seg.termos.cliente : "Lead"}</span>
              </button>
            </li>
          ))}
          {!achados.isLoading && !lista.length && <li className="px-3 py-3 text-sm text-muted-foreground">Ninguém encontrado com "{termo}".</li>}
        </ul>
      )}
      <Button variant="outline" className="w-fit" onClick={() => setNovo({ nome: pareceDoc ? "" : busca.trim(), telefone: "", cpf: pareceDoc ? busca.trim() : "" })} data-testid="orc-cadastrar">
        <UserPlus className="h-4 w-4" /> Cadastrar {seg.termos.cliente.toLowerCase()} novo
      </Button>
    </section>
  );
}
