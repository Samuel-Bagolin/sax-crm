import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Bot, FlaskConical, List, Loader2, MousePointerClick, Plus, Save, Trash2, Workflow, X } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSegmento } from "@/lib/segmento";
import { usePessoasEquipe, type Conexao, type Setor } from "@/components/whatsapp/NumerosWhatsApp";
import {
  PassoCampos, TIPOS, passoVazio, problemas, semPasso, useOpcoesLink, type Fluxo, type Gatilho, type OpcoesLink, type Passo, type TipoPasso,
} from "@/components/whatsapp/fluxo";
import { FluxoCanvas, organizar } from "@/components/whatsapp/FluxoCanvas";
import { SimuladorFluxo } from "@/components/whatsapp/SimuladorFluxo";

type OpcaoExemplo = [rotulo: string, tipo: "transferir" | "encerrar" | "agenda" | "catalogo", resposta: string];
const EXEMPLOS: Record<string, { saudacao: string; pergunta: string; opcoes: OpcaoExemplo[] }> = {
  imobiliaria: { saudacao: "Olá! Obrigado por falar com a gente.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Ver imóveis à venda e para alugar", "catalogo", "Veja os imóveis disponíveis: {link}"],
    ["Comprar ou alugar um imóvel", "transferir", "Perfeito! Já vou te passar para um dos nossos corretores."],
    ["Anunciar meu imóvel", "transferir", "Ótimo! Um corretor vai falar com você sobre a avaliação do imóvel."],
    ["Já sou cliente", "transferir", "Certo! Alguém da equipe vai te atender em instantes."]] },
  veiculos: { saudacao: "Olá! Obrigado por falar com a gente.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Ver o estoque", "catalogo", "Veja os veículos disponíveis: {link}"],
    ["Quero comprar um veículo", "transferir", "Show! Já vou te passar para um dos nossos vendedores."],
    ["Quero vender ou dar meu carro na troca", "transferir", "Certo! Um vendedor vai avaliar o seu carro com você."],
    ["Financiamento", "transferir", "Beleza! Vamos simular o financiamento com você."]] },
  odontologia: { saudacao: "Olá! Obrigado por falar com a clínica.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Agendar uma avaliação", "agenda", "Perfeito! Escolha o melhor horário aqui: {link}"],
    ["Já sou paciente", "transferir", "Certo! A recepção vai te atender em instantes."],
    ["Estou com dor (urgência)", "transferir", "Entendido. Vamos priorizar o seu atendimento agora."]] },
  terapia: { saudacao: "Olá! Que bom que você entrou em contato.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Agendar a primeira consulta", "agenda", "Perfeito! Escolha o melhor horário aqui: {link}"],
    ["Já sou paciente", "transferir", "Certo! Vamos te atender em instantes."],
    ["Valores e convênios", "transferir", "Um momento, vamos te passar as informações."]] },
  barbearia: { saudacao: "Fala! Valeu por chamar a gente.", pergunta: "O que você precisa? Responda com o número:", opcoes: [
    ["Agendar um horário", "agenda", "Beleza! Escolha o barbeiro e o horário aqui: {link}"],
    ["Clube de assinantes", "transferir", "Show! Vamos te explicar como funciona o clube."],
    ["Endereço e horário de funcionamento", "encerrar", "[Coloque aqui o endereço e o horário da barbearia.]"]] },
  estetica: { saudacao: "Olá! Obrigado por falar com a gente.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Agendar uma avaliação", "agenda", "Perfeito! Escolha o melhor horário aqui: {link}"],
    ["Já sou cliente", "transferir", "Certo! Vamos te atender em instantes."],
    ["Valores dos procedimentos", "transferir", "Um momento, a equipe vai te passar os valores."]] },
  comercio: { saudacao: "Olá! Que bom ter você por aqui.", pergunta: "Como podemos ajudar? Responda com o número:", opcoes: [
    ["Ver o cardápio", "catalogo", "Olha o nosso cardápio: {link}"],
    ["Fazer um pedido", "transferir", "Delícia! Já vou te passar para a loja montar o seu pedido."],
    ["Encomenda para evento", "transferir", "Que legal! Nossa equipe de eventos vai falar com você."],
    ["Quero revender", "transferir", "Ótimo! Nosso time de revenda vai te chamar."],
    ["Endereço e horário", "encerrar", "[Coloque aqui o endereço e o horário das lojas.]"]] },
};

function exemplo(segmento: string, op?: OpcoesLink): Fluxo {
  const e = EXEMPLOS[segmento] ?? EXEMPLOS.imobiliaria;
  // opção de link só entra se a agenda online ou o site já estão no ar; senão vira "passar para a equipe"
  const opcoes = e.opcoes.filter(([, tipo]) => tipo !== "catalogo" || op?.catalogo);
  const finais = opcoes.map(([, tipo, resposta]): Passo => {
    if (tipo === "agenda" && op?.agenda) return { ...passoVazio("link"), link_tipo: "agenda", texto: resposta };
    if (tipo === "catalogo") return { ...passoVazio("link"), link_tipo: "catalogo", texto: resposta };
    if (tipo === "agenda") return { ...passoVazio("transferir"), texto: "Perfeito! Já vou te passar para a recepção marcar o melhor horário." };
    return { ...passoVazio(tipo), texto: resposta };
  });
  const menu = { ...passoVazio("menu"), texto: e.pergunta, opcoes: opcoes.map(([rotulo], i) => ({ rotulo, proximo: finais[i].id })) };
  const ola = { ...passoVazio("mensagem"), texto: e.saudacao, proximo: menu.id };
  const fim = { ...passoVazio("encerrar"), texto: "Qualquer dúvida, é só chamar." };
  const comFim = finais.map((p) => (p.tipo === "link" ? { ...p, proximo: fim.id } : p));
  return { nome: "Boas-vindas", ativo: true, gatilho: "nova_conversa", palavras: [], conexoes: [],
    passos: [ola, menu, ...comFim, ...(comFim.some((p) => p.tipo === "link") ? [fim] : [])] };
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
  // o exemplo usa a agenda e o catálogo: espera saber se estão no ar antes de montar
  const { data: opLink, isPending: carregandoLink, isError: erroLink } = useOpcoesLink();

  return (
    <div className="grid content-start gap-4 overflow-y-auto">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold"><Bot className="h-5 w-5 text-primary" /> Fluxos de resposta</h2>
          <p className="text-sm text-muted-foreground">O robô responde na hora, mostra um menu e passa o cliente para a pessoa ou o setor certo. Quando alguém da equipe responde, o robô para.</p>
        </div>
        <Button onClick={() => setEditando(q.data?.length ? { ...exemplo(seg.chave, opLink), nome: "", gatilho: "palavra_chave", passos: [passoVazio("mensagem")] } : exemplo(seg.chave, opLink))} disabled={carregandoLink && !erroLink} data-testid="fluxo-novo"><Plus className="h-4 w-4" /> Novo fluxo</Button>
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
                  {f.gatilho === "nova_conversa" ? "Responde toda conversa nova" : f.gatilho === "profissional" ? `Quando citam um ${seg.termos.profissional.toLowerCase()}` : `Palavras: ${f.palavras.join(", ")}`}
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

/** Editor em tela cheia: desenho (ou lista) no meio, o passo escolhido à direita e o teste do fluxo ao lado. */
function EditorFluxo({ inicial, conexoes, setores, onClose }: { inicial: Fluxo; conexoes: Conexao[]; setores: Setor[]; onClose: () => void }) {
  const qc = useQueryClient();
  const seg = useSegmento();
  const pessoas = usePessoasEquipe();
  const [f, setFluxo] = useState<Fluxo>(() => JSON.parse(JSON.stringify(inicial)));
  const [palavras, setPalavras] = useState(inicial.palavras.join(", "));
  const [modo, setModo] = useState<"desenho" | "lista">(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "lista" : "desenho"));
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [testando, setTestando] = useState(false);
  const [mexeu, setMexeu] = useState(false);
  const setF = (fn: (x: Fluxo) => Fluxo) => { setFluxo(fn); setMexeu(true); };
  const avisos = useMemo(() => problemas(f), [f]);
  const qtdAvisos = Object.values(avisos).reduce((n, l) => n + l.length, 0);

  const fechar = () => { if (!mexeu || window.confirm("Sair sem salvar as mudanças do fluxo?")) onClose(); };
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "Escape" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) fechar();
    };
    window.addEventListener("keydown", tecla);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", tecla); document.body.style.overflow = ""; };
  });

  const salvar = useMutation({
    mutationFn: () => {
      // passos ainda sem posição ficam onde o desenho os organizou
      const auto = organizar(f);
      const corpo = { ...f, passos: f.passos.map((p) => ({ ...p, pos: p.pos ?? auto[p.id] })), palavras: palavras.split(",").map((p) => p.trim()).filter(Boolean) };
      return f.id ? apiPut<Fluxo>(`/whatsapp/fluxos/${f.id}`, corpo) : apiPost<Fluxo>("/whatsapp/fluxos", corpo);
    },
    onSuccess: (salvo) => {
      qc.invalidateQueries({ queryKey: ["wa", "fluxos"] });
      toast.success("Fluxo salvo.");
      setFluxo((x) => ({ ...x, id: salvo?.id ?? x.id }));
      setMexeu(false);
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar o fluxo."),
  });

  const i = f.passos.findIndex((p) => p.id === selecionado);
  const atual = i >= 0 ? f.passos[i] : null;
  const mudar = (id: string, x: Partial<Passo>) => setF((v) => ({ ...v, passos: v.passos.map((q) => (q.id === id ? { ...q, ...x } : q)) }));
  const nomeDe = (tipo: "pessoa" | "setor", id: string | null) =>
    (tipo === "pessoa" ? pessoas.find((p) => p.id === id)?.nome : setores.find((s) => s.id === id)?.nome) ?? "(não escolhido)";
  const gatilhoTexto: Record<Gatilho, string> = {
    nova_conversa: "Toda conversa nova",
    palavra_chave: "Quando a mensagem tiver uma palavra-chave",
    profissional: `Quando o cliente citar o nome de um ${seg.termos.profissional.toLowerCase()}`,
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={f.id ? "Editar fluxo" : "Novo fluxo"} data-testid="editor-fluxo">
      {/* cabeçalho: o que é o fluxo e quando começa */}
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
        <Button variant="ghost" size="icon-sm" onClick={fechar} aria-label="Fechar"><X className="h-5 w-5" /></Button>
        <Input value={f.nome} onChange={(e) => setF((x) => ({ ...x, nome: e.target.value }))} maxLength={60} placeholder="Nome do fluxo (ex.: Boas-vindas)"
          className="h-9 w-full font-semibold sm:w-56" aria-label="Nome do fluxo" data-testid="fluxo-nome" />
        <select value={f.gatilho} onChange={(e) => setF((x) => ({ ...x, gatilho: e.target.value as Gatilho }))} aria-label="Quando começa"
          className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm sm:w-auto sm:max-w-xs" data-testid="fluxo-gatilho">
          {(Object.keys(gatilhoTexto) as Gatilho[]).map((g) => <option key={g} value={g}>{gatilhoTexto[g]}</option>)}
        </select>
        {f.gatilho === "palavra_chave" && (
          <Input value={palavras} onChange={(e) => { setPalavras(e.target.value); setMexeu(true); }} placeholder="Palavras, separadas por vírgula"
            className="h-9 w-full sm:w-64" aria-label="Palavras-chave" />
        )}
        {conexoes.length > 1 && (
          <details className="relative">
            <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border px-3 text-sm">
              {f.conexoes.length ? `${f.conexoes.length} número(s)` : "Todos os números"}
            </summary>
            <div className="absolute z-20 mt-1 grid w-60 gap-1 rounded-lg border bg-popover p-2 shadow-xl">
              {conexoes.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                  <input type="checkbox" className="accent-[var(--primary)]" checked={f.conexoes.includes(c.id)}
                    onChange={(e) => setF((x) => ({ ...x, conexoes: e.target.checked ? [...x.conexoes, c.id] : x.conexoes.filter((y) => y !== c.id) }))} />
                  {c.nome}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">Nenhum marcado: vale para todos.</p>
            </div>
          </details>
        )}
        <span className="hidden flex-1 sm:block" />
        <div className="inline-flex rounded-lg border p-0.5 text-sm" role="tablist">
          {([["desenho", Workflow, "Desenhar"], ["lista", List, "Lista"]] as const).map(([v, Icone, rot]) => (
            <button key={v} type="button" role="tab" aria-selected={modo === v} onClick={() => setModo(v)} data-testid={`fluxo-modo-${v}`}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium", modo === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Icone className="h-4 w-4" /> {rot}
            </button>
          ))}
        </div>
        <Button variant={testando ? "default" : "outline"} size="sm" onClick={() => setTestando((t) => !t)} data-testid="fluxo-testar">
          <FlaskConical className="h-4 w-4" /> Testar
        </Button>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-[var(--primary)]" checked={f.ativo} onChange={(e) => setF((x) => ({ ...x, ativo: e.target.checked }))} /> Ligado</label>
        <Button onClick={() => salvar.mutate()} disabled={f.nome.trim().length < 2 || salvar.isPending} data-testid="fluxo-salvar"
          title={f.nome.trim().length < 2 ? "Dê um nome ao fluxo" : undefined}>
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
        </Button>
      </header>
      {qtdAvisos > 0 && (
        <button type="button" onClick={() => { const id = Object.keys(avisos)[0]; setSelecionado(id); }}
          className="border-b bg-amber-50 px-4 py-1.5 text-left text-xs text-amber-900 hover:underline dark:bg-amber-950/50 dark:text-amber-200" data-testid="fluxo-avisos">
          {qtdAvisos} ponto(s) para revisar nos blocos marcados em amarelo. Clique para ir ao primeiro.
        </button>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {modo === "desenho" ? (
            <FluxoCanvas f={f} setF={setF} selecionado={selecionado} setSelecionado={setSelecionado} />
          ) : (
            <ListaPassos f={f} setF={setF} setores={setores} pessoas={pessoas} avisos={avisos} />
          )}
        </main>
        {(modo === "desenho" || testando) && (
          <aside className="hidden w-[360px] shrink-0 flex-col border-l bg-card md:flex" data-testid="fluxo-lateral">
            {testando ? (
              <div className="flex min-h-0 flex-1 flex-col p-3"><SimuladorFluxo f={f} nomeDe={nomeDe} /></div>
            ) : atual ? (
              <div className="grid content-start gap-2 overflow-y-auto p-3" data-testid="canvas-painel">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white" style={{ background: TIPOS[atual.tipo].cor }}>{i + 1}</span>
                  <select value={atual.tipo} onChange={(e) => mudar(atual.id, { ...passoVazio(e.target.value as TipoPasso), id: atual.id, texto: atual.texto, pos: atual.pos })}
                    className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm font-medium" aria-label="Tipo do passo">
                    {(Object.keys(TIPOS) as TipoPasso[]).map((t) => <option key={t} value={t}>{TIPOS[t].rotulo}</option>)}
                  </select>
                  <Button size="icon-sm" variant="ghost" className="text-destructive" disabled={f.passos.length === 1}
                    onClick={() => { setF((x) => semPasso(x, atual.id)); setSelecionado(null); }} aria-label="Remover passo"><Trash2 className="h-4 w-4" /></Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => setSelecionado(null)} aria-label="Fechar painel"><X className="h-4 w-4" /></Button>
                </div>
                <p className="text-xs text-muted-foreground">{TIPOS[atual.tipo].ajuda}</p>
                {avisos[atual.id] && (
                  <ul className="list-disc rounded-md bg-amber-50 py-1.5 pl-6 pr-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                    {avisos[atual.id].map((a) => <li key={a}>{a}</li>)}
                  </ul>
                )}
                <PassoCampos f={f} p={atual} i={i} mudar={(x) => mudar(atual.id, x)} setores={setores} pessoas={pessoas} compacto />
                {i > 0 ? (
                  <Button size="sm" variant="ghost" className="w-fit" onClick={() => setF((x) => ({ ...x, passos: [atual, ...x.passos.filter((q) => q.id !== atual.id)] }))}>
                    Começar o fluxo por aqui
                  </Button>
                ) : <p className="text-xs font-medium text-primary">Este é o primeiro passo do fluxo.</p>}
              </div>
            ) : (
              <div className="grid content-start gap-3 p-4 text-sm text-muted-foreground">
                <p className="flex items-center gap-2 font-medium text-foreground"><MousePointerClick className="h-4 w-4" /> Clique num bloco para editar</p>
                <ul className="grid list-disc gap-1.5 pl-5">
                  <li>Puxe a bolinha da direita de um bloco e solte em outro para ligar.</li>
                  <li>Solte no vazio para criar o próximo passo já ligado.</li>
                  <li>O "x" no meio da linha desliga. Delete apaga o bloco escolhido.</li>
                  <li>Use <b>Enviar link</b> para mandar a agenda, o catálogo ou um {seg.termos.item.toLowerCase()}.</li>
                  <li>Clique em <b>Testar</b> para conversar com o robô antes de ligar.</li>
                </ul>
              </div>
            )}
          </aside>
        )}
      </div>
      {/* no celular o passo escolhido abre por baixo */}
      {modo === "desenho" && atual && !testando && (
        <div className="max-h-[55vh] overflow-y-auto border-t bg-card p-3 md:hidden">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold">{TIPOS[atual.tipo].rotulo}
            <Button size="icon-sm" variant="ghost" onClick={() => setSelecionado(null)} aria-label="Fechar"><X className="h-4 w-4" /></Button></div>
          <div className="grid gap-2"><PassoCampos f={f} p={atual} i={i} mudar={(x) => mudar(atual.id, x)} setores={setores} pessoas={pessoas} compacto /></div>
        </div>
      )}
      {testando && (
        <div className="flex h-[60vh] flex-col border-t bg-card p-2 md:hidden"><SimuladorFluxo f={f} nomeDe={nomeDe} /></div>
      )}
    </div>
  );
}

function ListaPassos({ f, setF, setores, pessoas, avisos }: {
  f: Fluxo; setF: (fn: (x: Fluxo) => Fluxo) => void; setores: Setor[]; pessoas: { id: string; nome: string }[]; avisos: Record<string, string[]>;
}) {
  const mudarPasso = (i: number, p: Partial<Passo>) => setF((x) => ({ ...x, passos: x.passos.map((q, k) => (k === i ? { ...q, ...p } : q)) }));
  const mover = (i: number, d: -1 | 1) => setF((x) => {
    const ps = [...x.passos]; const j = i + d;
    if (j < 0 || j >= ps.length) return x;
    [ps[i], ps[j]] = [ps[j], ps[i]];
    return { ...x, passos: ps };
  });
  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4">
      <ol className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-3" data-testid="fluxo-passos">
        {f.passos.map((p, i) => {
          const T = TIPOS[p.tipo];
          return (
            <li key={p.id} className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border bg-card p-3", i === 0 && "border-primary/50", avisos[p.id] && "border-amber-400/70")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: T.cor }}>{i + 1}</span>
                <select value={p.tipo} onChange={(e) => mudarPasso(i, { ...passoVazio(e.target.value as TipoPasso), id: p.id, texto: p.texto, pos: p.pos })}
                  className="h-8 rounded-md border bg-background px-2 text-sm font-medium" aria-label={`Tipo do passo ${i + 1}`}>
                  {(Object.keys(TIPOS) as TipoPasso[]).map((t) => <option key={t} value={t}>{TIPOS[t].rotulo}</option>)}
                </select>
                {i === 0 && <span className="text-xs font-medium text-primary">Início</span>}
                <span className="flex-1" />
                <Button size="icon-sm" variant="ghost" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir"><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon-sm" variant="ghost" onClick={() => mover(i, 1)} disabled={i === f.passos.length - 1} aria-label="Descer"><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => setF((x) => semPasso(x, p.id))} disabled={f.passos.length === 1} aria-label="Remover passo"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <p className="text-xs text-muted-foreground">{T.ajuda}</p>
              {avisos[p.id] && <p className="text-xs text-amber-700 dark:text-amber-300">{avisos[p.id].join(" · ")}</p>}
              <PassoCampos f={f} p={p} i={i} mudar={(x) => mudarPasso(i, x)} setores={setores} pessoas={pessoas} />
            </li>
          );
        })}
      </ol>
      <div className="mx-auto mt-3 flex max-w-3xl flex-wrap gap-2">
        {(Object.keys(TIPOS) as TipoPasso[]).map((t) => (
          <Button key={t} size="sm" variant="outline" onClick={() => setF((x) => ({ ...x, passos: [...x.passos, passoVazio(t)] }))}><Plus className="h-4 w-4" /> {TIPOS[t].rotulo}</Button>
        ))}
      </div>
    </div>
  );
}
