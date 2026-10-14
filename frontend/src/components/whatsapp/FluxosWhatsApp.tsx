import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Bot, GitBranch, Loader2, MessageSquare, Plus, Send, Square, Trash2, UserRound } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useSegmento } from "@/lib/segmento";
import { usePessoasEquipe, type Conexao, type Setor } from "@/components/whatsapp/NumerosWhatsApp";

type TipoPasso = "mensagem" | "menu" | "transferir" | "encerrar";
interface Opcao { rotulo: string; proximo: string | null }
interface Passo { id: string; tipo: TipoPasso; texto: string; opcoes: Opcao[]; proximo: string | null; destino_tipo: "pessoa" | "setor" | "fila" | null; destino_id: string | null }
interface Fluxo { id?: string; nome: string; ativo: boolean; gatilho: "nova_conversa" | "palavra_chave"; palavras: string[]; conexoes: string[]; passos: Passo[] }

const TIPOS: Record<TipoPasso, { rotulo: string; icone: typeof Bot; ajuda: string }> = {
  mensagem: { rotulo: "Mensagem", icone: MessageSquare, ajuda: "Manda o texto e segue para o próximo passo." },
  menu: { rotulo: "Menu de opções", icone: GitBranch, ajuda: "Manda as opções numeradas e espera o cliente responder." },
  transferir: { rotulo: "Passar para a equipe", icone: UserRound, ajuda: "Passa a conversa para uma pessoa, um setor ou a fila." },
  encerrar: { rotulo: "Encerrar", icone: Square, ajuda: "Manda o texto (se houver) e termina o fluxo." },
};

let seq = 0;
const novoId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;
const passoVazio = (tipo: TipoPasso): Passo => ({
  id: novoId(), tipo, texto: "", proximo: null, destino_tipo: tipo === "transferir" ? "fila" : null, destino_id: null,
  opcoes: tipo === "menu" ? [{ rotulo: "", proximo: null }, { rotulo: "", proximo: null }] : [],
});

type OpcaoExemplo = [rotulo: string, tipo: "transferir" | "encerrar", resposta: string];
const EXEMPLOS: Record<string, { saudacao: string; pergunta: string; opcoes: OpcaoExemplo[] }> = {
  imobiliaria: { saudacao: "Olá! Obrigado por falar com a gente.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Comprar ou alugar um imóvel", "transferir", "Perfeito! Já vou te passar para um dos nossos corretores."],
    ["Anunciar meu imóvel", "transferir", "Ótimo! Um corretor vai falar com você sobre a avaliação do imóvel."],
    ["Já sou cliente", "transferir", "Certo! Alguém da equipe vai te atender em instantes."]] },
  veiculos: { saudacao: "Olá! Obrigado por falar com a gente.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Quero comprar um veículo", "transferir", "Show! Já vou te passar para um dos nossos vendedores."],
    ["Quero vender ou dar meu carro na troca", "transferir", "Certo! Um vendedor vai avaliar o seu carro com você."],
    ["Financiamento", "transferir", "Beleza! Vamos simular o financiamento com você."]] },
  odontologia: { saudacao: "Olá! Obrigado por falar com a clínica.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Agendar uma avaliação", "transferir", "Perfeito! Já vou te passar para a recepção marcar o melhor horário."],
    ["Já sou paciente", "transferir", "Certo! A recepção vai te atender em instantes."],
    ["Estou com dor (urgência)", "transferir", "Entendido. Vamos priorizar o seu atendimento agora."]] },
  terapia: { saudacao: "Olá! Que bom que você entrou em contato.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Agendar a primeira consulta", "transferir", "Perfeito! Já vou te passar para a recepção."],
    ["Já sou paciente", "transferir", "Certo! Vamos te atender em instantes."],
    ["Valores e convênios", "transferir", "Um momento, vamos te passar as informações."]] },
  barbearia: { saudacao: "Fala! Valeu por chamar a gente.", pergunta: "O que você precisa? Responda com o número:", opcoes: [
    ["Agendar um horário", "transferir", "Beleza! Já vou te passar para a recepção."],
    ["Clube de assinantes", "transferir", "Show! Vamos te explicar como funciona o clube."],
    ["Endereço e horário de funcionamento", "encerrar", "[Coloque aqui o endereço e o horário da barbearia.]"]] },
  estetica: { saudacao: "Olá! Obrigado por falar com a gente.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Agendar uma avaliação", "transferir", "Perfeito! Já vou te passar para a recepção."],
    ["Já sou cliente", "transferir", "Certo! Vamos te atender em instantes."],
    ["Valores dos procedimentos", "transferir", "Um momento, a equipe vai te passar os valores."]] },
  comercio: { saudacao: "Olá! Que bom ter você por aqui.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Fazer um pedido", "transferir", "Delícia! Já vou te passar para a loja montar o seu pedido."],
    ["Encomenda para evento", "transferir", "Que legal! Nossa equipe de eventos vai falar com você."],
    ["Quero revender", "transferir", "Ótimo! Nosso time de revenda vai te chamar."],
    ["Endereço e horário", "encerrar", "[Coloque aqui o endereço e o horário das lojas.]"]] },
};

function exemplo(segmento: string): Fluxo {
  const e = EXEMPLOS[segmento] ?? EXEMPLOS.imobiliaria;
  const finais = e.opcoes.map(([, tipo, resposta]) => ({ ...passoVazio(tipo), texto: resposta }));
  const menu = { ...passoVazio("menu"), texto: e.pergunta, opcoes: e.opcoes.map(([rotulo], i) => ({ rotulo, proximo: finais[i].id })) };
  const ola = { ...passoVazio("mensagem"), texto: e.saudacao, proximo: menu.id };
  return { nome: "Boas-vindas", ativo: true, gatilho: "nova_conversa", palavras: [], conexoes: [], passos: [ola, menu, ...finais] };
}

/** Fluxos de resposta automática: o robô atende primeiro e passa para a equipe. Só o gestor edita. */
export function FluxosWhatsApp({ conexoes, setores }: { conexoes: Conexao[]; setores: Setor[] }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wa", "fluxos"], queryFn: () => apiGet<Fluxo[]>("/whatsapp/fluxos") });
  const [editando, setEditando] = useState<Fluxo | null>(null);
  const salvarAtivo = useMutation({
    mutationFn: (f: Fluxo) => apiPut(`/whatsapp/fluxos/${f.id}`, { ...f, ativo: !f.ativo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa", "fluxos"] }),
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível mudar o fluxo."),
  });
  const remover = useMutation({
    mutationFn: (id: string) => apiDelete(`/whatsapp/fluxos/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wa", "fluxos"] }); toast.success("Fluxo removido."); },
  });
  const nomeNumero = Object.fromEntries(conexoes.map((c) => [c.id, c.nome]));
  const seg = useSegmento();

  return (
    <div className="grid content-start gap-4 overflow-y-auto">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold"><Bot className="h-5 w-5 text-primary" /> Fluxos de resposta</h2>
          <p className="text-sm text-muted-foreground">O robô responde na hora, mostra um menu e passa o cliente para a pessoa ou o setor certo. Quando alguém da equipe responde, o robô para.</p>
        </div>
        <Button onClick={() => setEditando(q.data?.length ? { ...exemplo(seg.chave), nome: "", passos: [passoVazio("mensagem")] } : exemplo(seg.chave))} data-testid="fluxo-novo"><Plus className="h-4 w-4" /> Novo fluxo</Button>
      </section>

      {!q.data?.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhum fluxo ainda. O primeiro já vem com um exemplo de boas-vindas para você ajustar.
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {q.data.map((f) => (
            <li key={f.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid="fluxo-item">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.nome}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {f.gatilho === "nova_conversa" ? "Responde toda conversa nova" : `Palavras: ${f.palavras.join(", ")}`}
                  {" · "}{f.conexoes.length ? f.conexoes.map((id) => nomeNumero[id] ?? "número").join(", ") : "todos os números"}
                  {" · "}{f.passos.length} passo(s)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" onClick={() => salvarAtivo.mutate(f)} className={cn("rounded-full px-2.5 py-1 text-xs font-semibold",
                  f.ativo ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
                  {f.ativo ? "Ligado" : "Desligado"}
                </button>
                <Button size="sm" variant="outline" onClick={() => setEditando(f)}>Editar</Button>
                <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Remover ${f.nome}`}
                  onClick={() => window.confirm(`Remover o fluxo ${f.nome}?`) && remover.mutate(f.id!)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editando && <EditorFluxo inicial={editando} conexoes={conexoes} setores={setores} onClose={() => setEditando(null)} />}
    </div>
  );
}

function EditorFluxo({ inicial, conexoes, setores, onClose }: { inicial: Fluxo; conexoes: Conexao[]; setores: Setor[]; onClose: () => void }) {
  const qc = useQueryClient();
  const pessoas = usePessoasEquipe();
  const [f, setF] = useState<Fluxo>(() => JSON.parse(JSON.stringify(inicial)));
  const [palavras, setPalavras] = useState(inicial.palavras.join(", "));
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f, palavras: palavras.split(",").map((p) => p.trim()).filter(Boolean) };
      return f.id ? apiPut(`/whatsapp/fluxos/${f.id}`, corpo) : apiPost("/whatsapp/fluxos", corpo);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wa", "fluxos"] }); toast.success("Fluxo salvo."); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar o fluxo."),
  });
  const mudarPasso = (i: number, p: Partial<Passo>) => setF((x) => ({ ...x, passos: x.passos.map((q, k) => (k === i ? { ...q, ...p } : q)) }));
  const mover = (i: number, d: -1 | 1) => setF((x) => {
    const ps = [...x.passos]; const j = i + d;
    if (j < 0 || j >= ps.length) return x;
    [ps[i], ps[j]] = [ps[j], ps[i]];
    return { ...x, passos: ps };
  });
  const tirar = (i: number) => setF((x) => {
    const id = x.passos[i].id;
    const limpa = (v: string | null) => (v === id ? null : v);
    return { ...x, passos: x.passos.filter((_, k) => k !== i).map((p) => ({ ...p, proximo: limpa(p.proximo), opcoes: p.opcoes.map((o) => ({ ...o, proximo: limpa(o.proximo) })) })) };
  });
  const titulo = (id: string | null) => {
    const k = f.passos.findIndex((p) => p.id === id);
    return k < 0 ? "" : `${k + 1}. ${TIPOS[f.passos[k].tipo].rotulo}${f.passos[k].texto ? `: ${f.passos[k].texto.slice(0, 30)}` : ""}`;
  };
  const destinos = (atual: string) => f.passos.filter((p) => p.id !== atual);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{f.id ? "Editar fluxo" : "Novo fluxo"}</DialogTitle>
          <DialogDescription>O fluxo começa no passo 1. Use o menu para o cliente escolher e “Passar para a equipe” para terminar com uma pessoa.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="fx-nome">Nome do fluxo</Label>
              <Input id="fx-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} maxLength={60} placeholder="Boas-vindas" data-testid="fluxo-nome" /></div>
            <div className="grid gap-1.5"><Label htmlFor="fx-gatilho">Quando começa</Label>
              <select id="fx-gatilho" value={f.gatilho} onChange={(e) => setF({ ...f, gatilho: e.target.value as Fluxo["gatilho"] })} className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm">
                <option value="nova_conversa">Toda conversa nova</option>
                <option value="palavra_chave">Quando a mensagem tiver uma palavra-chave</option>
              </select></div>
          </div>
          {f.gatilho === "palavra_chave" && (
            <div className="grid gap-1.5"><Label htmlFor="fx-palavras">Palavras-chave (separe por vírgula)</Label>
              <Input id="fx-palavras" value={palavras} onChange={(e) => setPalavras(e.target.value)} placeholder="endereço, horário, boleto" /></div>
          )}
          {conexoes.length > 1 && (
            <div className="grid gap-1.5"><Label>Números</Label>
              <div className="flex flex-wrap gap-2">
                {conexoes.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
                    <input type="checkbox" className="accent-[var(--primary)]" checked={f.conexoes.includes(c.id)}
                      onChange={(e) => setF({ ...f, conexoes: e.target.checked ? [...f.conexoes, c.id] : f.conexoes.filter((x) => x !== c.id) })} />
                    {c.nome}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Nenhum marcado: vale para todos os números.</p>
            </div>
          )}

          <ol className="grid gap-3" data-testid="fluxo-passos">
            {f.passos.map((p, i) => {
              const T = TIPOS[p.tipo];
              return (
                <li key={p.id} className={cn("grid gap-2 rounded-xl border p-3", i === 0 && "border-primary/50")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                    <T.icone className="h-4 w-4 text-muted-foreground" />
                    <select value={p.tipo} onChange={(e) => mudarPasso(i, { ...passoVazio(e.target.value as TipoPasso), id: p.id, texto: p.texto })}
                      className="h-8 rounded-md border bg-background px-2 text-sm font-medium" aria-label={`Tipo do passo ${i + 1}`}>
                      {(Object.keys(TIPOS) as TipoPasso[]).map((t) => <option key={t} value={t}>{TIPOS[t].rotulo}</option>)}
                    </select>
                    {i === 0 && <span className="text-xs font-medium text-primary">Início</span>}
                    <span className="flex-1" />
                    <Button size="icon-sm" variant="ghost" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir"><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => mover(i, 1)} disabled={i === f.passos.length - 1} aria-label="Descer"><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => tirar(i)} disabled={f.passos.length === 1} aria-label="Remover passo"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{T.ajuda}</p>
                  <textarea value={p.texto} onChange={(e) => mudarPasso(i, { texto: e.target.value })} rows={2} maxLength={1500}
                    placeholder={p.tipo === "menu" ? "Como podemos ajudar? Responda com o número:" : p.tipo === "mensagem" ? "Olá! Obrigado por falar com a gente." : "Texto opcional"}
                    className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm" aria-label={`Texto do passo ${i + 1}`} />

                  {p.tipo === "menu" && (
                    <div className="grid gap-2 rounded-lg bg-muted/50 p-2">
                      {p.opcoes.map((o, k) => (
                        <div key={k} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <span className="w-6 text-sm font-semibold text-muted-foreground">{k + 1}.</span>
                          <Input value={o.rotulo} onChange={(e) => mudarPasso(i, { opcoes: p.opcoes.map((x, z) => (z === k ? { ...x, rotulo: e.target.value } : x)) })}
                            maxLength={60} placeholder="Texto da opção" className="sm:flex-1" aria-label={`Opção ${k + 1}`} />
                          <select value={o.proximo ?? ""} onChange={(e) => mudarPasso(i, { opcoes: p.opcoes.map((x, z) => (z === k ? { ...x, proximo: e.target.value || null } : x)) })}
                            className="h-9 rounded-md border bg-background px-2 text-sm sm:w-64" aria-label={`Destino da opção ${k + 1}`}>
                            <option value="">Vai para…</option>
                            {destinos(p.id).map((d) => <option key={d.id} value={d.id}>{titulo(d.id)}</option>)}
                          </select>
                          <Button size="icon-sm" variant="ghost" onClick={() => mudarPasso(i, { opcoes: p.opcoes.filter((_, z) => z !== k) })} disabled={p.opcoes.length <= 2} aria-label="Tirar opção"><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      ))}
                      {p.opcoes.length < 10 && (
                        <Button size="sm" variant="ghost" className="w-fit" onClick={() => mudarPasso(i, { opcoes: [...p.opcoes, { rotulo: "", proximo: null }] })}><Plus className="h-4 w-4" /> Opção</Button>
                      )}
                    </div>
                  )}
                  {p.tipo === "mensagem" && (
                    <select value={p.proximo ?? ""} onChange={(e) => mudarPasso(i, { proximo: e.target.value || null })} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Depois">
                      <option value="">Depois: termina aqui</option>
                      {destinos(p.id).map((d) => <option key={d.id} value={d.id}>Depois: {titulo(d.id)}</option>)}
                    </select>
                  )}
                  {p.tipo === "transferir" && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select value={p.destino_tipo ?? "fila"} onChange={(e) => mudarPasso(i, { destino_tipo: e.target.value as Passo["destino_tipo"], destino_id: null })}
                        className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Passar para">
                        <option value="fila">Fila da equipe (quem responder primeiro)</option>
                        <option value="setor">Um setor</option>
                        <option value="pessoa">Uma pessoa</option>
                      </select>
                      {p.destino_tipo === "setor" && (
                        <select value={p.destino_id ?? ""} onChange={(e) => mudarPasso(i, { destino_id: e.target.value || null })} className="h-9 flex-1 rounded-md border bg-background px-2 text-sm" aria-label="Setor">
                          <option value="">Escolha o setor</option>
                          {setores.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                        </select>
                      )}
                      {p.destino_tipo === "pessoa" && (
                        <select value={p.destino_id ?? ""} onChange={(e) => mudarPasso(i, { destino_id: e.target.value || null })} className="h-9 flex-1 rounded-md border bg-background px-2 text-sm" aria-label="Pessoa">
                          <option value="">Escolha a pessoa</option>
                          {pessoas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TIPOS) as TipoPasso[]).map((t) => (
              <Button key={t} size="sm" variant="outline" onClick={() => setF({ ...f, passos: [...f.passos, passoVazio(t)] })}><Plus className="h-4 w-4" /> {TIPOS[t].rotulo}</Button>
            ))}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--primary)]" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ligado</label>
            <span className="flex-1" />
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => salvar.mutate()} disabled={f.nome.trim().length < 2 || salvar.isPending} data-testid="fluxo-salvar">
              {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Salvar fluxo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
