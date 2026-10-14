import { useCallback, useMemo } from "react";
import {
  Background, Controls, Handle, MarkerType, Panel, Position, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { Flag, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Setor } from "@/components/whatsapp/NumerosWhatsApp";
import { PassoCampos, TIPOS, passoVazio, semPasso, type Fluxo, type Passo, type TipoPasso } from "@/components/whatsapp/fluxo";

/* Desenho do fluxo, no estilo dos construtores de chatbot: cada passo é um bloco; arraste da bolinha
   da direita (opção do menu ou "depois") até outro bloco para ligar. O 1º passo é o início. */

const LARG = 300;
const ALT = 190;

type DadosPasso = { passo: Passo; indice: number; f: Fluxo };
type NoPasso = Node<DadosPasso, "passo">;

/** Organiza em colunas a partir do início (cada coluna é um nível do caminho do cliente). */
export function organizar(f: Fluxo): Record<string, { x: number; y: number }> {
  const nivel = new Map<string, number>();
  const fila: string[] = [];
  if (f.passos[0]) { nivel.set(f.passos[0].id, 0); fila.push(f.passos[0].id); }
  while (fila.length) {
    const id = fila.shift()!;
    const p = f.passos.find((x) => x.id === id);
    if (!p) continue;
    for (const prox of [p.proximo, ...p.opcoes.map((o) => o.proximo)]) {
      if (prox && !nivel.has(prox)) { nivel.set(prox, nivel.get(id)! + 1); fila.push(prox); }
    }
  }
  const soltos = Math.max(0, ...nivel.values()) + 1;
  const linhas = new Map<number, number>();
  const pos: Record<string, { x: number; y: number }> = {};
  for (const p of f.passos) {
    const col = nivel.get(p.id) ?? soltos;
    const lin = linhas.get(col) ?? 0;
    linhas.set(col, lin + 1);
    pos[p.id] = { x: col * (LARG + 90), y: lin * ALT };
  }
  return pos;
}

function BlocoPasso({ data, selected }: NodeProps<NoPasso>) {
  const { passo: p, indice } = data;
  const T = TIPOS[p.tipo];
  return (
    <div className={cn("w-[260px] rounded-xl border-2 bg-card text-card-foreground shadow-sm", selected ? "border-primary shadow-lg" : "border-border")}
      data-testid="canvas-bloco">
      {indice > 0 && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-background !bg-muted-foreground" />}
      <div className="flex items-center gap-2 rounded-t-[10px] px-3 py-2 text-white" style={{ background: T.cor }}>
        <T.icone className="h-4 w-4 shrink-0" />
        <span className="truncate text-xs font-semibold uppercase tracking-wide">{T.rotulo}</span>
        {indice === 0 && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-bold"><Flag className="h-3 w-3" /> Início</span>}
      </div>
      <p className={cn("line-clamp-3 whitespace-pre-wrap px-3 py-2 text-xs", !p.texto && "italic text-muted-foreground")}>
        {p.texto || (p.tipo === "transferir" ? "Sem texto" : "Escreva a mensagem")}
      </p>
      {p.tipo === "transferir" && (
        <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          {p.destino_tipo === "pessoa" ? "Para uma pessoa" : p.destino_tipo === "setor" ? "Para um setor" : "Para a fila da equipe"}
        </p>
      )}
      {p.tipo === "menu" && (
        <ul className="border-t">
          {p.opcoes.map((o, k) => (
            <li key={k} className="relative border-b px-3 py-1.5 pr-5 text-xs last:border-b-0 last:rounded-b-[10px]">
              <b className="text-primary">{k + 1}.</b> {o.rotulo || <span className="italic text-muted-foreground">opção sem texto</span>}
              <Handle type="source" id={`op${k}`} position={Position.Right} className="!h-3 !w-3 !border-2 !border-background" style={{ background: T.cor }} />
            </li>
          ))}
        </ul>
      )}
      {p.tipo === "mensagem" && (
        <div className="relative border-t px-3 py-1.5 pr-5 text-right text-[11px] text-muted-foreground">
          depois
          <Handle type="source" id="prox" position={Position.Right} className="!h-3 !w-3 !border-2 !border-background" style={{ background: T.cor }} />
        </div>
      )}
    </div>
  );
}

const tiposNo = { passo: BlocoPasso };

function Desenho({ f, setF, selecionado, setSelecionado, setores, pessoas }: {
  f: Fluxo; setF: (fn: (x: Fluxo) => Fluxo) => void; selecionado: string | null; setSelecionado: (id: string | null) => void;
  setores: Setor[]; pessoas: { id: string; nome: string }[];
}) {
  const { resolvedTheme } = useTheme();
  const rf = useReactFlow();
  const auto = useMemo(() => organizar(f), [f]);
  const nodes: NoPasso[] = useMemo(() => f.passos.map((p, i) => ({
    id: p.id, type: "passo", position: p.pos ?? auto[p.id], data: { passo: p, indice: i, f }, selected: p.id === selecionado,
  })), [f, auto, selecionado]);
  const edges: Edge[] = useMemo(() => f.passos.flatMap((p) => {
    const cor = TIPOS[p.tipo].cor;
    const base = { type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: cor }, style: { stroke: cor, strokeWidth: 2 } };
    const lista: Edge[] = [];
    if (p.tipo === "mensagem" && p.proximo) lista.push({ id: `${p.id}|prox`, source: p.id, sourceHandle: "prox", target: p.proximo, ...base });
    if (p.tipo === "menu") p.opcoes.forEach((o, k) => o.proximo && lista.push({ id: `${p.id}|op${k}`, source: p.id, sourceHandle: `op${k}`, target: o.proximo, label: String(k + 1), ...base }));
    return lista;
  }), [f]);

  const onNodesChange = useCallback((changes: NodeChange<NoPasso>[]) => {
    for (const c of changes) if (c.type === "select" && c.selected) setSelecionado(c.id);
    const movidos = applyNodeChanges(changes.filter((c) => c.type === "position"), nodes);
    if (changes.some((c) => c.type === "position")) {
      const pos = Object.fromEntries(movidos.map((n) => [n.id, n.position]));
      setF((x) => ({ ...x, passos: x.passos.map((p) => (pos[p.id] ? { ...p, pos: { x: Math.round(pos[p.id].x), y: Math.round(pos[p.id].y) } } : p)) }));
    }
    const tirar = changes.filter((c) => c.type === "remove").map((c) => c.id);
    if (tirar.length) setF((x) => tirar.reduce((acc, id) => (acc.passos.length > 1 ? semPasso(acc, id) : acc), x));
  }, [nodes, setF, setSelecionado]);

  const ligar = useCallback((origem: string, alca: string | null | undefined, destino: string | null) => {
    setF((x) => ({ ...x, passos: x.passos.map((p) => {
      if (p.id !== origem) return p;
      if (alca === "prox") return { ...p, proximo: destino };
      const k = Number((alca ?? "").replace("op", ""));
      return Number.isNaN(k) ? p : { ...p, opcoes: p.opcoes.map((o, z) => (z === k ? { ...o, proximo: destino } : o)) };
    }) }));
  }, [setF]);

  const onConnect = useCallback((c: Connection) => { if (c.source !== c.target) ligar(c.source, c.sourceHandle, c.target); }, [ligar]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const c of changes) if (c.type === "remove") { const [o, a] = c.id.split("|"); ligar(o, a, null); }
  }, [ligar]);

  const adicionar = (tipo: TipoPasso) => {
    // ao lado do bloco escolhido (ou do último), sem cair em cima de outro
    const ref = f.passos.find((x) => x.id === selecionado) ?? f.passos[f.passos.length - 1];
    const base = ref ? (ref.pos ?? auto[ref.id]) : { x: 0, y: 0 };
    let pos = { x: base.x + LARG + 90, y: base.y };
    const ocupado = (q: { x: number; y: number }) => f.passos.some((x) => { const o = x.pos ?? auto[x.id]; return Math.abs(o.x - q.x) < LARG && Math.abs(o.y - q.y) < ALT - 30; });
    for (let k = 0; k < 30 && ocupado(pos); k++) pos = { x: pos.x, y: pos.y + ALT };
    const novo = { ...passoVazio(tipo), pos };
    setTimeout(() => rf.setCenter(pos.x + 130, pos.y + 60, { zoom: rf.getZoom(), duration: 300 }), 50);
    setF((x) => ({ ...x, passos: [...x.passos, novo] }));
    setSelecionado(novo.id);
  };
  const reorganizar = () => {
    setF((x) => { const pos = organizar(x); return { ...x, passos: x.passos.map((p) => ({ ...p, pos: pos[p.id] })) }; });
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50);
  };

  return (
    <ReactFlow<NoPasso, Edge> nodes={nodes} edges={edges} nodeTypes={tiposNo} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      onConnect={onConnect} onPaneClick={() => setSelecionado(null)} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.2} maxZoom={1.5}
      colorMode={resolvedTheme === "dark" ? "dark" : "light"} deleteKeyCode={["Backspace", "Delete"]} proOptions={{ hideAttribution: true }}>
      <Background gap={18} size={1.2} />
      <Controls showInteractive={false} />
      <Panel position="top-left" className="flex flex-wrap gap-1.5">
        {(Object.keys(TIPOS) as TipoPasso[]).map((t) => {
          const T = TIPOS[t];
          return (
            <Button key={t} size="sm" variant="outline" className="bg-card shadow-sm" onClick={() => adicionar(t)} data-testid={`canvas-add-${t}`}>
              <Plus className="h-3.5 w-3.5" /><T.icone className="h-3.5 w-3.5" style={{ color: T.cor }} /> {T.rotulo}
            </Button>
          );
        })}
        <Button size="sm" variant="outline" className="bg-card shadow-sm" onClick={reorganizar}><LayoutGrid className="h-3.5 w-3.5" /> Organizar</Button>
      </Panel>
      <Panel position="bottom-right" className="rounded-md bg-card/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
        Arraste da bolinha até outro bloco para ligar. Clique na linha e aperte Delete para desligar.
      </Panel>
      {selecionado && (() => {
        const i = f.passos.findIndex((p) => p.id === selecionado);
        const p = f.passos[i];
        if (!p) return null;
        const mudar = (x: Partial<Passo>) => setF((v) => ({ ...v, passos: v.passos.map((q) => (q.id === p.id ? { ...q, ...x } : q)) }));
        return (
          <Panel position="top-right" className="!m-2 grid max-h-[calc(100%-1rem)] w-[320px] max-w-[calc(100%-1rem)] overflow-x-hidden content-start gap-2 overflow-y-auto rounded-xl border bg-card p-3 shadow-xl" data-testid="canvas-painel">
            <div className="flex items-center gap-2">
              <select value={p.tipo} onChange={(e) => mudar({ ...passoVazio(e.target.value as TipoPasso), id: p.id, texto: p.texto, pos: p.pos })}
                className="h-8 flex-1 rounded-md border bg-background px-2 text-sm font-medium" aria-label="Tipo do passo">
                {(Object.keys(TIPOS) as TipoPasso[]).map((t) => <option key={t} value={t}>{TIPOS[t].rotulo}</option>)}
              </select>
              <Button size="icon-sm" variant="ghost" className="text-destructive" disabled={f.passos.length === 1}
                onClick={() => { setF((x) => semPasso(x, p.id)); setSelecionado(null); }} aria-label="Remover passo"><Trash2 className="h-4 w-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">{TIPOS[p.tipo].ajuda}</p>
            <PassoCampos f={f} p={p} i={i} mudar={mudar} setores={setores} pessoas={pessoas} compacto />
            {i > 0 ? (
              <Button size="sm" variant="ghost" className="w-fit" onClick={() => setF((x) => ({ ...x, passos: [p, ...x.passos.filter((q) => q.id !== p.id)] }))}>
                <Flag className="h-3.5 w-3.5" /> Começar o fluxo por aqui
              </Button>
            ) : <p className="text-xs font-medium text-primary">Este é o primeiro passo do fluxo.</p>}
          </Panel>
        );
      })()}
    </ReactFlow>
  );
}

export function FluxoCanvas(props: Parameters<typeof Desenho>[0]) {
  return (
    <div className="h-[62vh] min-h-[420px] overflow-hidden rounded-xl border bg-muted/30" data-testid="fluxo-canvas">
      <ReactFlowProvider><Desenho {...props} /></ReactFlowProvider>
    </div>
  );
}
