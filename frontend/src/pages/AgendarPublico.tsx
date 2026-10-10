import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarCheck, Check, Clock, Loader2, MapPin, UserRound } from "lucide-react";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Servico {
  id: string;
  nome: string;
  duracao_min: number;
  preco: number;
  categoria: string | null;
  descricao: string | null;
  profissionais: string[];
}
interface Profissional {
  id: string;
  nome: string;
  slug: string | null;
  especialidade: string | null;
  registro: string | null;
  foto_url: string | null;
}
interface Pagina {
  empresa: string;
  cor: string;
  logo_url: string | null;
  mensagem: string;
  pedir_email: boolean;
  janela_dias: number;
  termos: { profissional: string; profissionais: string; atendimento: string };
  segmento: string;
  servicos: Servico[];
  profissionais: Profissional[];
  unidades: { id: string; nome: string; endereco: string | null; cidade: string | null }[];
}
interface Reservado {
  token: string;
  data: string;
  inicio: string;
  fim: string;
  profissional: string;
  servico: string;
  preco: number;
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dataExtenso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][dt.getDay()]}, ${d} de ${["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][m - 1]}`;
}
function duracao(min: number) {
  return min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`;
}
function mascaraTelefone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function Iniciais({ nome, cor }: { nome: string; cor: string }) {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: cor }}>
      {nome.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase()}
    </span>
  );
}

export default function AgendarPublico() {
  const { slug = "", prof, token } = useParams();
  if (token) return <MinhaReserva slug={slug} token={token} />;
  return <Agendar slug={slug} profSlug={prof} />;
}

function Agendar({ slug, profSlug }: { slug: string; profSlug?: string }) {
  const q = useQuery({ queryKey: ["agenda-publica", slug], queryFn: () => apiGet<Pagina>(`/publico/agenda/${slug}`), retry: false });
  const p = q.data;
  const [servico, setServico] = useState<Servico | null>(null);
  const [profissional, setProfissional] = useState<string | "qualquer" | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [hora, setHora] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [obs, setObs] = useState("");
  const [isca, setIsca] = useState("");

  useEffect(() => {
    if (p) document.title = `Agendar | ${p.empresa}`;
    if (p && profSlug && !profissional) {
      const alvo = p.profissionais.find((x) => x.slug === profSlug);
      if (alvo) setProfissional(alvo.id);
    }
  }, [p, profSlug, profissional]);

  const profsDoServico = useMemo(
    () => (p && servico ? p.profissionais.filter((x) => !servico.profissionais.length || servico.profissionais.includes(x.id)) : []),
    [p, servico],
  );
  const dias = useMemo(() => {
    const hoje = new Date();
    return Array.from({ length: Math.min(p?.janela_dias ?? 14, 21) }, (_, i) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + i);
      return { iso: isoLocal(d), dia: d.getDate(), semana: DIAS[d.getDay()], mes: MESES[d.getMonth()] };
    });
  }, [p?.janela_dias]);

  const horarios = useQuery({
    queryKey: ["agenda-horarios", slug, servico?.id, profissional, dia],
    queryFn: () =>
      apiGet<{ horarios: { hora: string; profissionais: string[] }[] }>(
        `/publico/agenda/${slug}/horarios?servico_id=${servico!.id}&data=${dia}${profissional && profissional !== "qualquer" ? `&profissional_id=${profissional}` : ""}`,
      ),
    enabled: !!servico && !!profissional && !!dia,
  });

  const reservar = useMutation({
    mutationFn: () =>
      apiPost<Reservado>(`/publico/agenda/${slug}/reservar`, {
        servico_id: servico!.id, profissional_id: profissional === "qualquer" ? null : profissional, data: dia, inicio: hora,
        nome, telefone, email: email || null, observacao: obs || null, site: isca || null,
      }),
    onError: () => horarios.refetch(),
  });

  if (!p) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f5f6f8] p-6 text-center">
        {q.isLoading ? <Loader2 className="h-6 w-6 animate-spin text-slate-400" /> : (
          <div>
            <p className="text-lg font-semibold">Agenda indisponível</p>
            <p className="mt-1 text-sm text-slate-500">{detalheErro(q.error) ?? "Confira o link recebido."}</p>
          </div>
        )}
      </div>
    );
  }

  const cor = p.cor || "#4a03a2";
  const estilo = { "--c": cor } as CSSProperties;
  const profNome = profissional === "qualquer" ? `Qualquer ${p.termos.profissional.toLowerCase()}` : p.profissionais.find((x) => x.id === profissional)?.nome;

  if (reservar.data) {
    const r = reservar.data;
    const link = `${window.location.origin}/agendar/${slug}/reserva/${r.token}`;
    return (
      <div style={estilo} className="min-h-dvh bg-[#f5f6f8] px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-md rounded-3xl bg-white p-7 text-center shadow-sm">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-white" style={{ background: cor }}>
            <Check className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-bold">Horário reservado</h1>
          <p className="mt-1 text-slate-600">{p.empresa}</p>
          <div className="mt-6 space-y-2 rounded-2xl bg-[#f5f6f8] p-4 text-left text-[15px]">
            <p className="font-semibold">{r.servico}</p>
            <p className="flex items-center gap-2"><CalendarCheck className="h-4 w-4" style={{ color: cor }} /> {dataExtenso(r.data)}, {r.inicio}</p>
            <p className="flex items-center gap-2"><UserRound className="h-4 w-4" style={{ color: cor }} /> {r.profissional}</p>
          </div>
          <p className="mt-5 text-sm text-slate-600">Guarde este link para ver ou cancelar a reserva:</p>
          <a href={link} className="mt-1 block break-all text-sm font-semibold" style={{ color: cor }}>{link}</a>
        </div>
      </div>
    );
  }

  const passo = !servico ? 0 : !profissional ? 1 : !dia || !hora ? 2 : 3;
  const voltar = () => {
    if (passo === 3) setHora(null);
    else if (passo === 2) {
      if (profSlug) setServico(null);
      else setProfissional(null);
      setDia(null);
    } else if (passo === 1) setServico(null);
  };

  return (
    <div style={estilo} className="min-h-dvh bg-[#f5f6f8] text-slate-900">
      <header className="bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-4">
          {p.logo_url ? <img src={p.logo_url} alt="" className="h-11 w-11 rounded-xl object-contain" /> : <Iniciais nome={p.empresa} cor={cor} />}
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold">{p.empresa}</p>
            <p className="text-sm text-slate-500">Agendamento online</p>
          </div>
        </div>
        <div className="h-1" style={{ background: cor }} />
      </header>

      <main className="mx-auto max-w-xl px-4 pb-16 pt-5">
        {p.mensagem && passo === 0 && <p className="mb-4 rounded-2xl bg-white p-4 text-[15px] leading-relaxed text-slate-700">{p.mensagem}</p>}

        {(servico || profissional) && (
          <div className="mb-4 rounded-2xl bg-white p-4 text-sm">
            <button type="button" onClick={voltar} className="mb-2 inline-flex items-center gap-1 font-medium text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Voltar</button>
            {servico && <p className="font-semibold">{servico.nome}<span className="font-normal text-slate-500">, {duracao(servico.duracao_min)}, {brl(servico.preco)}</span></p>}
            {profNome && <p className="text-slate-600">{profNome}</p>}
            {dia && <p className="text-slate-600">{dataExtenso(dia)}{hora ? `, ${hora}` : ""}</p>}
          </div>
        )}

        {passo === 0 && (
          <section aria-labelledby="t-servico">
            <h1 id="t-servico" className="mb-3 text-xl font-bold">Escolha o serviço</h1>
            {!p.servicos.length && <p className="rounded-2xl bg-white p-5 text-slate-600">Nenhum serviço disponível online no momento.</p>}
            <ul className="space-y-2">
              {p.servicos.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setServico(s)} className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white p-4 text-left transition hover:ring-2 hover:ring-[var(--c)]" data-testid={`ag-servico-${s.nome}`}>
                    <span>
                      <span className="block font-semibold">{s.nome}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-sm text-slate-500"><Clock className="h-3.5 w-3.5" /> {duracao(s.duracao_min)}</span>
                      {s.descricao && <span className="mt-1 block text-sm text-slate-500">{s.descricao}</span>}
                    </span>
                    <span className="shrink-0 font-semibold">{s.preco ? brl(s.preco) : "Gratuito"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {passo === 1 && (
          <section aria-labelledby="t-prof">
            <h1 id="t-prof" className="mb-3 text-xl font-bold">Com quem?</h1>
            <ul className="space-y-2">
              {profsDoServico.length > 1 && (
                <li>
                  <button type="button" onClick={() => setProfissional("qualquer")} className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left hover:ring-2 hover:ring-[var(--c)]">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100"><UserRound className="h-5 w-5 text-slate-500" /></span>
                    <span className="font-semibold">Primeiro horário livre, com qualquer {p.termos.profissional.toLowerCase()}</span>
                  </button>
                </li>
              )}
              {profsDoServico.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => setProfissional(x.id)} className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left hover:ring-2 hover:ring-[var(--c)]" data-testid={`ag-prof-${x.nome}`}>
                    {x.foto_url ? <img src={x.foto_url} alt="" className="h-12 w-12 rounded-full object-cover" /> : <Iniciais nome={x.nome} cor={cor} />}
                    <span>
                      <span className="block font-semibold">{x.nome}</span>
                      {(x.especialidade || x.registro) && <span className="text-sm text-slate-500">{[x.especialidade, x.registro].filter(Boolean).join(", ")}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {passo === 2 && (
          <section aria-labelledby="t-dia">
            <h1 id="t-dia" className="mb-3 text-xl font-bold">Escolha o dia e o horário</h1>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2" role="listbox" aria-label="Dias">
              {dias.map((d) => (
                <button key={d.iso} type="button" role="option" aria-selected={dia === d.iso} onClick={() => { setDia(d.iso); setHora(null); }}
                  className={cn("flex w-16 shrink-0 flex-col items-center rounded-2xl py-2.5 text-sm", dia === d.iso ? "text-white" : "bg-white text-slate-700")}
                  style={dia === d.iso ? { background: cor } : undefined} data-testid={`ag-dia-${d.iso}`}>
                  <span className="text-xs capitalize opacity-80">{d.semana}</span>
                  <span className="text-xl font-bold leading-tight">{d.dia}</span>
                  <span className="text-xs opacity-80">{d.mes}</span>
                </button>
              ))}
            </div>
            {dia && (
              <div className="mt-4">
                {horarios.isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /> : horarios.data?.horarios.length ? (
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                    {horarios.data.horarios.map((h) => (
                      <button key={h.hora} type="button" onClick={() => setHora(h.hora)} className="rounded-xl bg-white py-2.5 text-[15px] font-semibold hover:ring-2 hover:ring-[var(--c)]" data-testid={`ag-hora-${h.hora}`}>
                        {h.hora}
                      </button>
                    ))}
                  </div>
                ) : <p className="rounded-2xl bg-white p-5 text-center text-slate-600">Sem horários livres neste dia. Tente outro.</p>}
              </div>
            )}
          </section>
        )}

        {passo === 3 && (
          <section aria-labelledby="t-dados">
            <h1 id="t-dados" className="mb-3 text-xl font-bold">Seus dados</h1>
            <form className="space-y-3 rounded-2xl bg-white p-4" onSubmit={(e) => { e.preventDefault(); reservar.mutate(); }}>
              <label className="block text-sm font-medium">Nome
                <input required value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none focus:border-[var(--c)]" data-testid="ag-nome" />
              </label>
              <label className="block text-sm font-medium">WhatsApp
                <input required value={telefone} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} inputMode="tel" autoComplete="tel" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none focus:border-[var(--c)]" data-testid="ag-telefone" />
              </label>
              {p.pedir_email && (
                <label className="block text-sm font-medium">E-mail
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none focus:border-[var(--c)]" />
                </label>
              )}
              <label className="block text-sm font-medium">Observação (opcional)
                <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-[15px] outline-none focus:border-[var(--c)]" />
              </label>
              <input tabIndex={-1} aria-hidden autoComplete="off" className="absolute -left-[9999px] h-0 w-0 opacity-0" value={isca} onChange={(e) => setIsca(e.target.value)} />
              {reservar.isError && <p className="text-sm text-red-600">{detalheErro(reservar.error) ?? "Não foi possível reservar. Tente outro horário."}</p>}
              <button type="submit" disabled={reservar.isPending || nome.trim().length < 2 || telefone.replace(/\D/g, "").length < 10}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold text-white disabled:opacity-50" style={{ background: cor }} data-testid="ag-confirmar">
                {reservar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar agendamento
              </button>
            </form>
          </section>
        )}

        {p.unidades.length > 0 && p.unidades[0].endereco && (
          <p className="mt-8 flex items-start gap-2 text-sm text-slate-500"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {[p.unidades[0].endereco, p.unidades[0].cidade].filter(Boolean).join(", ")}</p>
        )}
        <p className="mt-6 text-center text-xs text-slate-400">Agenda online por <Link to="/cadastro" className="underline">SAX CRM</Link></p>
      </main>
    </div>
  );
}

function MinhaReserva({ slug, token }: { slug: string; token: string }) {
  const q = useQuery({
    queryKey: ["reserva", token],
    queryFn: () => apiGet<{ status: string; data: string; inicio: string; profissional: string; servicos: string[]; cliente: string; empresa: string; pode_cancelar: boolean; cancelamento_horas: number }>(`/publico/agenda/${slug}/reserva/${token}`),
    retry: false,
  });
  const cancelar = useMutation({ mutationFn: () => apiPost(`/publico/agenda/${slug}/reserva/${token}/cancelar`), onSuccess: () => q.refetch() });
  const r = q.data;
  return (
    <div className="min-h-dvh bg-[#f5f6f8] px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-md rounded-3xl bg-white p-7">
        {!r ? (q.isLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : <p>Reserva não encontrada.</p>) : (
          <>
            <p className="text-sm text-slate-500">{r.empresa}</p>
            <h1 className="mt-1 text-2xl font-bold">{r.status === "cancelado" ? "Reserva cancelada" : "Sua reserva"}</h1>
            <div className="mt-5 space-y-1.5 text-[15px]">
              <p className="font-semibold">{r.servicos.join(", ")}</p>
              <p>{dataExtenso(r.data)}, {r.inicio}</p>
              <p>{r.profissional}</p>
            </div>
            {r.pode_cancelar && (
              <button type="button" onClick={() => cancelar.mutate()} disabled={cancelar.isPending} className="mt-6 h-11 w-full rounded-full border border-red-200 font-semibold text-red-600 hover:bg-red-50">
                Cancelar reserva
              </button>
            )}
            {!r.pode_cancelar && r.status !== "cancelado" && <p className="mt-6 text-sm text-slate-500">Cancelamento pelo link só até {r.cancelamento_horas} h antes. Fale com a equipe.</p>}
            {cancelar.isError && <p className="mt-2 text-sm text-red-600">{detalheErro(cancelar.error)}</p>}
            <Link to={`/agendar/${slug}`} className="mt-4 block text-center text-sm font-semibold text-slate-600 underline">Fazer novo agendamento</Link>
          </>
        )}
      </div>
    </div>
  );
}
