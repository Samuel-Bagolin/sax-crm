import { Bot, GitBranch, MessageSquare, Plus, Square, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Setor } from "@/components/whatsapp/NumerosWhatsApp";

/* Tipos e campos de um passo do fluxo do WhatsApp, usados pela lista e pelo desenho (canvas). */

export type TipoPasso = "mensagem" | "menu" | "transferir" | "encerrar";
export interface Opcao { rotulo: string; proximo: string | null }
export interface Passo {
  id: string; tipo: TipoPasso; texto: string; opcoes: Opcao[]; proximo: string | null;
  destino_tipo: "pessoa" | "setor" | "fila" | null; destino_id: string | null; pos?: { x: number; y: number } | null;
}
export interface Fluxo { id?: string; nome: string; ativo: boolean; gatilho: "nova_conversa" | "palavra_chave"; palavras: string[]; conexoes: string[]; passos: Passo[] }

export const TIPOS: Record<TipoPasso, { rotulo: string; icone: typeof Bot; ajuda: string; cor: string }> = {
  mensagem: { rotulo: "Mensagem", icone: MessageSquare, ajuda: "Manda o texto e segue para o próximo passo.", cor: "#3b82f6" },
  menu: { rotulo: "Menu de opções", icone: GitBranch, ajuda: "Manda as opções numeradas e espera o cliente responder.", cor: "#ff7a00" },
  transferir: { rotulo: "Passar para a equipe", icone: UserRound, ajuda: "Passa a conversa para uma pessoa, um setor ou a fila.", cor: "#16a34a" },
  encerrar: { rotulo: "Encerrar", icone: Square, ajuda: "Manda o texto (se houver) e termina o fluxo.", cor: "#71717a" },
};

let seq = 0;
export const novoId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;
export const passoVazio = (tipo: TipoPasso): Passo => ({
  id: novoId(), tipo, texto: "", proximo: null, destino_tipo: tipo === "transferir" ? "fila" : null, destino_id: null,
  opcoes: tipo === "menu" ? [{ rotulo: "", proximo: null }, { rotulo: "", proximo: null }] : [],
});

/** Tira o passo e solta tudo que apontava para ele. */
export function semPasso(f: Fluxo, id: string): Fluxo {
  const limpa = (v: string | null) => (v === id ? null : v);
  return { ...f, passos: f.passos.filter((p) => p.id !== id).map((p) => ({ ...p, proximo: limpa(p.proximo), opcoes: p.opcoes.map((o) => ({ ...o, proximo: limpa(o.proximo) })) })) };
}

export function tituloPasso(f: Fluxo, id: string | null): string {
  const k = f.passos.findIndex((p) => p.id === id);
  return k < 0 ? "" : `${k + 1}. ${TIPOS[f.passos[k].tipo].rotulo}${f.passos[k].texto ? `: ${f.passos[k].texto.slice(0, 30)}` : ""}`;
}

/** Texto, opções, para onde segue e destino da transferência de um passo. */
export function PassoCampos({ f, p, i, mudar, setores, pessoas, compacto = false }: {
  f: Fluxo; p: Passo; i: number; mudar: (x: Partial<Passo>) => void; setores: Setor[]; pessoas: { id: string; nome: string }[]; compacto?: boolean;
}) {
  const destinos = f.passos.filter((d) => d.id !== p.id);
  return (
    <>
      <textarea value={p.texto} onChange={(e) => mudar({ texto: e.target.value })} rows={p.tipo === "menu" ? 2 : 3} maxLength={1500}
        placeholder={p.tipo === "menu" ? "Como podemos ajudar? Responda com o número:" : p.tipo === "mensagem" ? "Olá! Obrigado por falar com a gente." : "Texto opcional"}
        className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm" aria-label={`Texto do passo ${i + 1}`} />
      {p.tipo === "menu" && (
        <div className="grid gap-2 rounded-lg bg-muted/50 p-2">
          {p.opcoes.map((o, k) => (
            <div key={k} className={compacto ? "grid grid-cols-[1.25rem_1fr_auto] items-center gap-1.5 border-b pb-2 last-of-type:border-b-0" : "flex flex-col gap-2 sm:flex-row sm:items-center"}>
              <span className="w-6 text-sm font-semibold text-muted-foreground">{k + 1}.</span>
              <Input value={o.rotulo} onChange={(e) => mudar({ opcoes: p.opcoes.map((x, z) => (z === k ? { ...x, rotulo: e.target.value } : x)) })}
                maxLength={60} placeholder="Texto da opção" className={compacto ? "min-w-0" : "sm:flex-1"} aria-label={`Opção ${k + 1}`} />
              {compacto && <Button size="icon-sm" variant="ghost" onClick={() => mudar({ opcoes: p.opcoes.filter((_, z) => z !== k) })} disabled={p.opcoes.length <= 2} aria-label="Tirar opção"><Trash2 className="h-4 w-4" /></Button>}
              <select value={o.proximo ?? ""} onChange={(e) => mudar({ opcoes: p.opcoes.map((x, z) => (z === k ? { ...x, proximo: e.target.value || null } : x)) })}
                className={compacto ? "col-span-2 col-start-2 h-8 min-w-0 rounded-md border bg-background px-2 text-xs" : "h-9 min-w-0 rounded-md border bg-background px-2 text-sm sm:w-56"} aria-label={`Destino da opção ${k + 1}`}>
                <option value="">Vai para…</option>
                {destinos.map((d) => <option key={d.id} value={d.id}>{tituloPasso(f, d.id)}</option>)}
              </select>
              {!compacto && <Button size="icon-sm" variant="ghost" onClick={() => mudar({ opcoes: p.opcoes.filter((_, z) => z !== k) })} disabled={p.opcoes.length <= 2} aria-label="Tirar opção"><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
          {p.opcoes.length < 10 && (
            <Button size="sm" variant="ghost" className="w-fit" onClick={() => mudar({ opcoes: [...p.opcoes, { rotulo: "", proximo: null }] })}><Plus className="h-4 w-4" /> Opção</Button>
          )}
        </div>
      )}
      {p.tipo === "mensagem" && (
        <select value={p.proximo ?? ""} onChange={(e) => mudar({ proximo: e.target.value || null })} className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" aria-label="Depois">
          <option value="">Depois: termina aqui</option>
          {destinos.map((d) => <option key={d.id} value={d.id}>Depois: {tituloPasso(f, d.id)}</option>)}
        </select>
      )}
      {p.tipo === "transferir" && (
        <div className="flex flex-col gap-2">
          <select value={p.destino_tipo ?? "fila"} onChange={(e) => mudar({ destino_tipo: e.target.value as Passo["destino_tipo"], destino_id: null })}
            className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Passar para">
            <option value="fila">Fila da equipe (quem responder primeiro)</option>
            <option value="setor">Um setor</option>
            <option value="pessoa">Uma pessoa</option>
          </select>
          {p.destino_tipo === "setor" && (
            <select value={p.destino_id ?? ""} onChange={(e) => mudar({ destino_id: e.target.value || null })} className="h-9 flex-1 rounded-md border bg-background px-2 text-sm" aria-label="Setor">
              <option value="">Escolha o setor</option>
              {setores.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          )}
          {p.destino_tipo === "pessoa" && (
            <select value={p.destino_id ?? ""} onChange={(e) => mudar({ destino_id: e.target.value || null })} className="h-9 flex-1 rounded-md border bg-background px-2 text-sm" aria-label="Pessoa">
              <option value="">Escolha a pessoa</option>
              {pessoas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          )}
        </div>
      )}
    </>
  );
}
