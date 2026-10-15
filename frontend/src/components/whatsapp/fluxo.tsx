import { useQuery } from "@tanstack/react-query";
import { Bot, GitBranch, Link2, MessageSquare, Plus, Square, Trash2, UserRound } from "lucide-react";
import { apiGet } from "@/lib/api";
import { useSegmento } from "@/lib/segmento";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Setor } from "@/components/whatsapp/NumerosWhatsApp";

/* Tipos e campos de um passo do fluxo do WhatsApp, usados pela lista, pelo desenho e pelo teste. */

export type TipoPasso = "mensagem" | "menu" | "link" | "transferir" | "encerrar";
export type TipoLink = "agenda" | "agenda_profissional" | "agenda_citado" | "catalogo" | "item" | "url";
export interface Opcao { rotulo: string; proximo: string | null }
export interface Passo {
  id: string; tipo: TipoPasso; texto: string; opcoes: Opcao[]; proximo: string | null;
  destino_tipo: "pessoa" | "setor" | "fila" | null; destino_id: string | null; pos?: { x: number; y: number } | null;
  link_tipo?: TipoLink | null; url?: string | null;
}
export type Gatilho = "nova_conversa" | "palavra_chave" | "profissional";
export interface Fluxo { id?: string; nome: string; ativo: boolean; gatilho: Gatilho; palavras: string[]; conexoes: string[]; passos: Passo[] }

export const TIPOS: Record<TipoPasso, { rotulo: string; icone: typeof Bot; ajuda: string; cor: string }> = {
  mensagem: { rotulo: "Mensagem", icone: MessageSquare, ajuda: "Manda o texto e segue para o próximo passo.", cor: "#3b82f6" },
  menu: { rotulo: "Menu de opções", icone: GitBranch, ajuda: "Manda as opções numeradas e espera o cliente responder. Cada opção leva a um passo.", cor: "#ff7a00" },
  link: { rotulo: "Enviar link", icone: Link2, ajuda: "Manda o link da agenda, do catálogo, de um item ou outro endereço, e segue.", cor: "#8b5cf6" },
  transferir: { rotulo: "Passar para a equipe", icone: UserRound, ajuda: "Passa a conversa para uma pessoa, um setor ou a fila. O robô para aqui.", cor: "#16a34a" },
  encerrar: { rotulo: "Encerrar", icone: Square, ajuda: "Manda o texto (se houver) e termina o fluxo.", cor: "#71717a" },
};

/** Passos que seguem para outro pelo "depois" (alça única). */
export const COM_DEPOIS: TipoPasso[] = ["mensagem", "link"];

export interface OpcoesLink {
  agenda: string | null;
  profissionais: { id: string; nome: string; url: string | null }[];
  catalogo: string | null;
  itens: { id: string; nome: string; tipo: string }[];
}

export function useOpcoesLink() {
  return useQuery({ queryKey: ["wa", "opcoes-link"], queryFn: () => apiGet<OpcoesLink>("/whatsapp/fluxos/opcoes-link"), staleTime: 60_000 });
}

export function rotulosLink(termos: { profissional: string; item: string; itens: string }): Record<TipoLink, string> {
  return {
    agenda: "Agenda online (todos)",
    agenda_profissional: `Agenda de um ${termos.profissional.toLowerCase()}`,
    agenda_citado: `Agenda de quem o cliente citar`,
    catalogo: `Catálogo do site (${termos.itens.toLowerCase()})`,
    item: `Um ${termos.item.toLowerCase()} do site`,
    url: "Outro link (Instagram, cardápio, formulário…)",
  };
}

let seq = 0;
export const novoId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;
export const passoVazio = (tipo: TipoPasso): Passo => ({
  id: novoId(), tipo, texto: tipo === "link" ? "Aqui está: {link}" : "", proximo: null, destino_tipo: tipo === "transferir" ? "fila" : null, destino_id: null,
  opcoes: tipo === "menu" ? [{ rotulo: "", proximo: null }, { rotulo: "", proximo: null }] : [],
  link_tipo: tipo === "link" ? "agenda" : null, url: null,
});

/** Tira o passo e solta tudo que apontava para ele. */
export function semPasso(f: Fluxo, id: string): Fluxo {
  const limpa = (v: string | null) => (v === id ? null : v);
  return { ...f, passos: f.passos.filter((p) => p.id !== id).map((p) => ({ ...p, proximo: limpa(p.proximo), opcoes: p.opcoes.map((o) => ({ ...o, proximo: limpa(o.proximo) })) })) };
}

/** Cópia do passo, sem as ligações de saída (para não duplicar caminho sem querer). */
export function duplicar(f: Fluxo, id: string): { fluxo: Fluxo; novo: Passo } | null {
  const p = f.passos.find((x) => x.id === id);
  if (!p) return null;
  const novo: Passo = { ...p, id: novoId(), proximo: null, opcoes: p.opcoes.map((o) => ({ ...o, proximo: null })),
    pos: p.pos ? { x: p.pos.x + 40, y: p.pos.y + 40 } : null };
  return { fluxo: { ...f, passos: [...f.passos, novo] }, novo };
}

export function tituloPasso(f: Fluxo, id: string | null): string {
  const k = f.passos.findIndex((p) => p.id === id);
  return k < 0 ? "" : `${k + 1}. ${TIPOS[f.passos[k].tipo].rotulo}${f.passos[k].texto ? `: ${f.passos[k].texto.slice(0, 30)}` : ""}`;
}

/** O que falta em cada passo (o servidor recusa ou o cliente fica sem resposta). */
export function problemas(f: Fluxo): Record<string, string[]> {
  const saida: Record<string, string[]> = {};
  const alcancados = new Set<string>();
  const fila = f.passos[0] ? [f.passos[0].id] : [];
  while (fila.length) {
    const id = fila.shift()!;
    if (alcancados.has(id)) continue;
    alcancados.add(id);
    const p = f.passos.find((x) => x.id === id);
    if (p) for (const prox of [p.proximo, ...p.opcoes.map((o) => o.proximo)]) if (prox) fila.push(prox);
  }
  for (const p of f.passos) {
    const lista: string[] = [];
    if ((p.tipo === "mensagem" || p.tipo === "menu") && !p.texto.trim()) lista.push("Escreva a mensagem");
    if (p.tipo === "menu") {
      if (p.opcoes.length < 2) lista.push("Coloque pelo menos 2 opções");
      p.opcoes.forEach((o, k) => {
        if (!o.rotulo.trim()) lista.push(`Opção ${k + 1} sem texto`);
        else if (!o.proximo) lista.push(`Opção ${k + 1} não leva a nenhum passo`);
      });
    }
    if (p.tipo === "transferir" && p.destino_tipo !== "fila" && !p.destino_id) lista.push(p.destino_tipo === "setor" ? "Escolha o setor" : "Escolha a pessoa");
    if (p.tipo === "link") {
      if (!p.link_tipo) lista.push("Escolha o link");
      if (p.link_tipo === "url" && !/^https?:\/\/\S+\.\S+$/.test(p.url ?? "")) lista.push("Link precisa começar com https://");
      if ((p.link_tipo === "agenda_profissional" || p.link_tipo === "item") && !p.destino_id) lista.push(p.link_tipo === "item" ? "Escolha o item" : "Escolha quem atende");
    }
    if (!alcancados.has(p.id)) lista.push("Nenhum passo leva até aqui");
    if (lista.length) saida[p.id] = lista;
  }
  return saida;
}

/** Texto, opções, link, para onde segue e destino da transferência de um passo. */
export function PassoCampos({ f, p, i, mudar, setores, pessoas, compacto = false }: {
  f: Fluxo; p: Passo; i: number; mudar: (x: Partial<Passo>) => void; setores: Setor[]; pessoas: { id: string; nome: string }[]; compacto?: boolean;
}) {
  const destinos = f.passos.filter((d) => d.id !== p.id);
  const sel = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
  return (
    <>
      <textarea value={p.texto} onChange={(e) => mudar({ texto: e.target.value })} rows={p.tipo === "menu" ? 2 : 3} maxLength={1500}
        placeholder={p.tipo === "menu" ? "Como podemos ajudar? Responda com o número:" : p.tipo === "mensagem" ? "Olá! Obrigado por falar com a gente."
          : p.tipo === "link" ? "Escolha o melhor horário: {link}" : "Texto opcional"}
        className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm" aria-label={`Texto do passo ${i + 1}`} data-testid="passo-texto" />
      {p.tipo === "link" && <CamposLink p={p} mudar={mudar} />}
      {p.tipo === "menu" && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg bg-muted/50 p-2">
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
      {COM_DEPOIS.includes(p.tipo) && (
        <select value={p.proximo ?? ""} onChange={(e) => mudar({ proximo: e.target.value || null })} className={sel} aria-label="Depois">
          <option value="">Depois: termina aqui</option>
          {destinos.map((d) => <option key={d.id} value={d.id}>Depois: {tituloPasso(f, d.id)}</option>)}
        </select>
      )}
      {p.tipo === "transferir" && (
        <div className="flex flex-col gap-2">
          <select value={p.destino_tipo ?? "fila"} onChange={(e) => mudar({ destino_tipo: e.target.value as Passo["destino_tipo"], destino_id: null })}
            className={sel} aria-label="Passar para">
            <option value="fila">Fila da equipe (quem responder primeiro)</option>
            <option value="setor">Um setor</option>
            <option value="pessoa">Uma pessoa</option>
          </select>
          {p.destino_tipo === "setor" && (
            <select value={p.destino_id ?? ""} onChange={(e) => mudar({ destino_id: e.target.value || null })} className={sel} aria-label="Setor">
              <option value="">Escolha o setor</option>
              {setores.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          )}
          {p.destino_tipo === "pessoa" && (
            <select value={p.destino_id ?? ""} onChange={(e) => mudar({ destino_id: e.target.value || null })} className={sel} aria-label="Pessoa">
              <option value="">Escolha a pessoa</option>
              {pessoas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          )}
        </div>
      )}
    </>
  );
}

function CamposLink({ p, mudar }: { p: Passo; mudar: (x: Partial<Passo>) => void }) {
  const seg = useSegmento();
  const { data: op } = useOpcoesLink();
  const rotulos = rotulosLink(seg.termos);
  const sel = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
  const falta: Partial<Record<TipoLink, string>> = op ? {
    agenda: op.agenda ? "" : "ligue a agenda online", agenda_profissional: op.agenda ? "" : "ligue a agenda online",
    agenda_citado: op.agenda ? "" : "ligue a agenda online", catalogo: op.catalogo ? "" : "publique o site", item: op.catalogo ? "" : "publique o site",
  } : {};
  const tipo = p.link_tipo ?? "agenda";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg bg-muted/50 p-2 text-sm" data-testid="passo-link">
      <select value={tipo} onChange={(e) => mudar({ link_tipo: e.target.value as TipoLink, destino_id: null, url: null })} className={sel} aria-label="Qual link">
        {(Object.keys(rotulos) as TipoLink[]).map((t) => (
          <option key={t} value={t} disabled={!!falta[t]}>{rotulos[t]}{falta[t] ? ` (${falta[t]})` : ""}</option>
        ))}
      </select>
      {tipo === "agenda_profissional" && (
        <select value={p.destino_id ?? ""} onChange={(e) => mudar({ destino_id: e.target.value || null })} className={sel} aria-label="Quem atende">
          <option value="">Escolha {seg.termos.profissional.toLowerCase()}</option>
          {(op?.profissionais ?? []).map((x) => <option key={x.id} value={x.id} disabled={!x.url}>{x.nome}{x.url ? "" : " (sem agenda online)"}</option>)}
        </select>
      )}
      {tipo === "item" && (
        <select value={p.destino_id ?? ""} onChange={(e) => mudar({ destino_id: e.target.value || null })} className={sel} aria-label="Item">
          <option value="">Escolha o {seg.termos.item.toLowerCase()}</option>
          {(op?.itens ?? []).map((x) => <option key={x.id} value={x.id}>{x.tipo}: {x.nome}</option>)}
        </select>
      )}
      {tipo === "url" && (
        <Input value={p.url ?? ""} onChange={(e) => mudar({ url: e.target.value })} placeholder="https://" inputMode="url" aria-label="Endereço do link" data-testid="passo-url" />
      )}
      <p className="text-xs text-muted-foreground">
        {tipo === "agenda_citado" && `Se a mensagem do cliente citar o nome de um ${seg.termos.profissional.toLowerCase()}, vai a agenda dele; senão, a de todos. `}
        {"Use {link} onde o link deve aparecer (sem {link}, ele vai no fim)"}
        {tipo === "agenda_profissional" || tipo === "agenda_citado" || tipo === "item" ? " e {nome} para o nome." : "."}
      </p>
    </div>
  );
}
