import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Building2, CalendarCheck, CalendarClock, Globe, Heart, Loader2, MessageCircle, Send, Users, XCircle } from "lucide-react";
import { apiGet } from "@/lib/api";
import { brl, dataBR } from "@/lib/format";
import { linkWhatsapp } from "@/lib/crm";

interface Relatorio {
  empresa_nome: string;
  cor_primaria: string;
  tem_logo: boolean;
  proprietario_nome: string | null;
  codigo: string;
  titulo: string;
  bairro: string | null;
  cidade: string;
  finalidade: string;
  status: string;
  valor: number | null;
  foto_url: string | null;
  dias_no_mercado: number;
  visitas_realizadas: number;
  visitas_agendadas: number;
  interessados: number;
  vitrines: number;
  reacoes_positivas: number;
  publicado_portais: boolean;
  propostas: { data: string; valor: number; situacao: string; autor: string }[];
  visitas: { data: string; status: string; retorno: string | null }[];
  corretor_nome: string | null;
  corretor_telefone: string | null;
  gerado_em: string;
}

const STATUS: Record<string, string> = { captado: "Em preparação", publicado: "Anunciado", vendido: "Vendido", alugado: "Alugado" };

export default function RelatorioProprietario() {
  const { token = "" } = useParams();
  const { data, isLoading, error } = useQuery({ queryKey: ["relatorio-proprietario", token], queryFn: () => apiGet<Relatorio>(`/publico/proprietario/${token}`), retry: false });

  useEffect(() => {
    if (data) document.title = `Seu imóvel ${data.codigo}, ${data.empresa_nome}`;
  }, [data]);

  if (isLoading)
    return (
      <div className="flex min-h-svh items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  if (error || !data)
    return (
      <div className="flex min-h-svh items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto mb-3 h-10 w-10 text-slate-400" />
          <h1 className="text-lg font-semibold text-slate-900">Link indisponível</h1>
          <p className="mt-2 text-sm text-slate-600">Peça um novo link do relatório à imobiliária.</p>
        </div>
      </div>
    );

  const cor = data.cor_primaria;
  const whats = linkWhatsapp(data.corretor_telefone, `Olá${data.corretor_nome ? ` ${data.corretor_nome.split(" ")[0]}` : ""}, vi o relatório do imóvel ${data.codigo}.`);
  const pl = (n: number, um: string, varios: string) => (n === 1 ? um : varios);
  const indicadores = [
    { icone: CalendarCheck, valor: data.visitas_realizadas, rotulo: pl(data.visitas_realizadas, "visita realizada", "visitas realizadas") },
    { icone: CalendarClock, valor: data.visitas_agendadas, rotulo: pl(data.visitas_agendadas, "visita agendada", "visitas agendadas") },
    { icone: Users, valor: data.interessados, rotulo: pl(data.interessados, "cliente com perfil compatível", "clientes com perfil compatível") },
    { icone: Send, valor: data.vitrines, rotulo: pl(data.vitrines, "envio para clientes", "envios para clientes") },
    { icone: Heart, valor: data.reacoes_positivas, rotulo: pl(data.reacoes_positivas, "cliente demonstrou interesse", "clientes demonstraram interesse") },
  ];
  const maior = data.propostas.reduce<number | null>((m, p) => (m == null || p.valor > m ? p.valor : m), null);

  return (
    <div className="min-h-svh bg-slate-50 pb-24 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {data.tem_logo ? (
            <img src={`/api/publico/proprietario/${token}/logo`} alt="" className="h-9 w-9 rounded object-contain" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-md text-sm font-bold text-white" style={{ backgroundColor: cor }}>
              {data.empresa_nome.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{data.empresa_nome}</p>
            <p className="text-xs text-slate-500">Relatório do proprietário</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-3 py-5 sm:px-4">
        <section className="px-1">
          <p className="text-sm text-slate-600">Olá{data.proprietario_nome ? `, ${data.proprietario_nome}` : ""}. Este é o andamento do seu imóvel.</p>
        </section>
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          {data.foto_url ? (
            <img src={data.foto_url} alt="" className="aspect-[16/9] w-full object-cover" />
          ) : (
            <div className="flex aspect-[16/9] items-center justify-center bg-slate-100">
              <Building2 className="h-10 w-10 text-slate-300" />
            </div>
          )}
          <div className="space-y-1 p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Cód. {data.codigo} · {[data.bairro, data.cidade].filter(Boolean).join(", ")}
            </p>
            <h1 className="text-xl font-semibold leading-snug">{data.titulo}</h1>
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-2xl font-bold tabular-nums" style={{ color: cor }}>
                {data.valor ? brl(data.valor) : "—"}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{STATUS[data.status] ?? data.status}</span>
              <span className="text-sm text-slate-500">há {data.dias_no_mercado} dias conosco</span>
            </p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {indicadores.map((i) => (
            <div key={i.rotulo} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
              <i.icone className="h-4 w-4 text-slate-400" />
              <p className="mt-1 text-2xl font-bold tabular-nums">{i.valor}</p>
              <p className="text-xs leading-tight text-slate-600">{i.rotulo}</p>
            </div>
          ))}
          <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
            <Globe className="h-4 w-4 text-slate-400" />
            <p className="mt-1 text-sm font-semibold">{data.publicado_portais ? "Anunciado nos portais" : "Ainda não anunciado"}</p>
            <p className="text-xs leading-tight text-slate-600">{data.publicado_portais ? "ZAP Imóveis, VivaReal e OLX" : "Fale com o corretor"}</p>
          </div>
        </section>

        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Propostas recebidas</h2>
          {data.propostas.length ? (
            <ul className="divide-y">
              {data.propostas.map((p, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold tabular-nums">
                      {brl(p.valor)}
                      {p.valor === maior && data.propostas.length > 1 && <span className="ml-2 rounded bg-emerald-50 px-1.5 text-[11px] font-semibold text-emerald-700">maior</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {dataBR(p.data)} · {p.autor}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-slate-600">{p.situacao}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-slate-500">Nenhuma proposta até agora.</p>
          )}
        </section>

        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Visitas</h2>
          {data.visitas.length ? (
            <ol className="divide-y">
              {data.visitas.map((v, i) => (
                <li key={i} className="px-4 py-3">
                  <p className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{dataBR(v.data)}</span>
                    <span className={v.status === "Agendada" ? "text-xs font-semibold" : "text-xs text-slate-500"} style={v.status === "Agendada" ? { color: cor } : undefined}>
                      {v.status}
                    </span>
                  </p>
                  {v.retorno && <p className="mt-1 text-sm leading-relaxed text-slate-700">“{v.retorno}”</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-4 py-4 text-sm text-slate-500">Nenhuma visita registrada ainda.</p>
          )}
        </section>
        <p className="px-1 text-center text-xs text-slate-500">
          Atualizado em {new Date(data.gerado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}. Os dados dos interessados ficam protegidos pela imobiliária.
        </p>
      </main>
      {whats && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur">
          <a href={whats} target="_blank" rel="noreferrer" className="mx-auto flex h-12 max-w-2xl items-center justify-center gap-2 rounded-xl bg-[#25d366] text-sm font-semibold text-[#073b1e]">
            <MessageCircle className="h-5 w-5" /> Falar com {data.corretor_nome?.split(" ")[0] ?? "o corretor"}
          </a>
        </div>
      )}
    </div>
  );
}
