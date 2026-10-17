import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, Star } from "lucide-react";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { cn } from "@/lib/utils";

export type TipoPergunta = "nps" | "nota" | "escolha" | "multipla" | "sim_nao" | "texto";
export interface Pergunta { id: string; tipo: TipoPergunta; titulo: string; obrigatoria: boolean; opcoes: string[] }
interface FormPublico {
  nome: string; descricao: string | null; perguntas: Pergunta[]; ja_respondido: boolean; pessoal: boolean; nome_cliente: string | null;
  marca: { empresa_nome: string; cor_primaria: string };
}
type Valor = number | string | string[] | undefined;

/** Uma pergunta, usada na página pública e na prévia do editor. */
export function CampoPergunta({ p, valor, onChange, cor }: { p: Pergunta; valor: Valor; onChange: (v: Valor) => void; cor: string }) {
  if (p.tipo === "nps") {
    return (
      <div>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
          {Array.from({ length: 11 }, (_, n) => (
            <button key={n} type="button" onClick={() => onChange(n)} aria-pressed={valor === n}
              className={cn("h-11 rounded-lg border text-sm font-semibold transition", valor === n ? "text-white" : "bg-white text-slate-700 hover:bg-slate-50")}
              style={valor === n ? { background: cor, borderColor: cor } : undefined} data-testid={`nps-${n}`}>{n}</button>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-xs text-slate-500"><span>Nada provável</span><span>Muito provável</span></div>
      </div>
    );
  }
  if (p.tipo === "nota") {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} de 5`} className="p-1">
            <Star className="h-9 w-9" style={{ color: typeof valor === "number" && n <= valor ? "#f59e0b" : "#cbd5e1" }} fill={typeof valor === "number" && n <= valor ? "#f59e0b" : "none"} />
          </button>
        ))}
      </div>
    );
  }
  if (p.tipo === "escolha" || p.tipo === "sim_nao") {
    const opcoes = p.tipo === "sim_nao" ? ["Sim", "Não"] : p.opcoes;
    return (
      <div className="flex flex-wrap gap-2">
        {opcoes.map((o) => (
          <button key={o} type="button" onClick={() => onChange(o)} className={cn("rounded-full border px-4 py-2 text-sm", valor === o ? "text-white" : "bg-white text-slate-700 hover:bg-slate-50")}
            style={valor === o ? { background: cor, borderColor: cor } : undefined}>{o}</button>
        ))}
      </div>
    );
  }
  if (p.tipo === "multipla") {
    const lista = Array.isArray(valor) ? valor : [];
    return (
      <div className="grid gap-2">
        {p.opcoes.map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={lista.includes(o)} onChange={(e) => onChange(e.target.checked ? [...lista, o] : lista.filter((x) => x !== o))} /> {o}
          </label>
        ))}
      </div>
    );
  }
  return <textarea className="min-h-24 w-full rounded-lg border bg-white p-3 text-sm text-slate-800" maxLength={2000} value={typeof valor === "string" ? valor : ""} onChange={(e) => onChange(e.target.value)} />;
}

/** Página pública da pesquisa (/f/:token). Sem login. */
export default function ResponderFormulario() {
  const { token = "" } = useParams();
  const q = useQuery({ queryKey: ["form-publico", token], queryFn: () => apiGet<FormPublico>(`/publico/formularios/${token}`), retry: false });
  const [resp, setResp] = useState<Record<string, Valor>>({});
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const enviar = useMutation({
    mutationFn: () => apiPost(`/publico/formularios/${token}`, { respostas: resp, nome: nome.trim() || null } as never),
    onError: (e) => setErro(detalheErro(e) ?? "Não foi possível enviar. Tente de novo."),
  });
  const d = q.data;
  const cor = d?.marca.cor_primaria || "#4a03a2";

  if (q.isLoading) return <div className="grid min-h-svh place-items-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (!d) return <div className="grid min-h-svh place-items-center bg-slate-50 p-6 text-center text-slate-600">Esta pesquisa não está disponível. O link pode ter sido trocado ou a pesquisa foi encerrada.</div>;

  const concluido = enviar.isSuccess || d.ja_respondido;
  return (
    <div className="min-h-svh bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="rounded-2xl p-5 text-white" style={{ background: cor }}>
          <p className="text-sm opacity-90">{d.marca.empresa_nome}</p>
          <h1 className="text-xl font-semibold">{d.nome}</h1>
          {d.descricao && <p className="mt-1 text-sm opacity-90">{d.descricao}</p>}
        </div>
        {concluido ? (
          <div className="rounded-2xl border bg-white p-8 text-center" data-testid="form-obrigado">
            <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: cor }} />
            <p className="mt-3 text-lg font-semibold">Obrigado pela resposta!</p>
            <p className="text-sm text-slate-500">{d.ja_respondido && !enviar.isSuccess ? "Esta pesquisa já foi respondida." : "Sua opinião chegou para a equipe."}</p>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErro(null); enviar.mutate(); }}>
            {d.pessoal && d.nome_cliente && <p className="text-sm text-slate-600">Olá, {d.nome_cliente.split(" ")[0]}!</p>}
            {d.perguntas.map((p, i) => (
              <div key={p.id} className="space-y-3 rounded-2xl border bg-white p-5">
                <p className="font-medium">{i + 1}. {p.titulo}{p.obrigatoria && <span className="text-red-500"> *</span>}</p>
                <CampoPergunta p={p} cor={cor} valor={resp[p.id]} onChange={(v) => setResp((r) => ({ ...r, [p.id]: v }))} />
              </div>
            ))}
            {!d.pessoal && (
              <div className="space-y-2 rounded-2xl border bg-white p-5">
                <p className="font-medium">Seu nome <span className="text-sm font-normal text-slate-500">(opcional)</span></p>
                <input className="h-10 w-full rounded-lg border px-3 text-sm" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} />
              </div>
            )}
            {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
            <button type="submit" disabled={enviar.isPending} className="h-12 w-full rounded-xl font-semibold text-white disabled:opacity-60" style={{ background: cor }} data-testid="form-enviar">
              {enviar.isPending ? "Enviando..." : "Enviar resposta"}
            </button>
          </form>
        )}
        <p className="text-center text-xs text-slate-400">Pesquisa feita com SAX CRM</p>
      </div>
    </div>
  );
}
