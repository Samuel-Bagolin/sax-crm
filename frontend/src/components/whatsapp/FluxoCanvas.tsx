import { useCallback, useMemo, useRef, useState } from "react";
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Panel, Position, ReactFlow, ReactFlowProvider,
  applyNodeChanges, getSmoothStepPath, useReactFlow,
  type Connection, type Edge, type EdgeChange, type EdgeProps, type FinalConnectionState, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { AlertTriangle, Copy, Flag, LayoutGrid, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSegmento } from "@/lib/segmento";
import {
  COM_DEPOIS, TIPOS, duplicar, passoVazio, problemas, rotulosLink, semPasso, type Fluxo, type Passo, type TipoPasso,
} from "@/components/whatsapp/fluxo";

/* Desenho do fluxo, no estilo dos construtores de chatbot: cada passo é um bloco. Para ligar, arraste da
   bolinha da direita (opção do menu ou "depois") e solte em qualquer parte de outro bloco. Soltar no vazio
   abre a lista para criar o próximo passo ali mesmo. O 1º passo é o início. */

const LARG = 300;
const ALT = 200;

type DadosPasso = {
  passo: Passo; indice: number; avisos: string[]; rotuloLink: string;
  onDuplicar: (id: string) => void; onRemover: (id: string) => void; podeRemover: boolean;
};
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
    pos[p.id] = { x: col * (LARG + 80), y: lin * ALT };
  }
  return pos;
}

const alca = "!h-4 !w-4 !border-[3px] !border-background";

function BlocoPasso({ data, selected }: NodeProps<NoPasso>) {
  const { passo: p, indice, avisos } = data;
  const T = TIPOS[p.tipo];
  return (
    <div className={cn("group w-[260px] rounded-xl border-2 bg-card text-card-foreground shadow-sm transition-shadow",
      selected ? "border-primary shadow-lg ring-4 ring-primary/15" : avisos.length ? "border-amber-400/70" : "border-border hover:shadow-md")}
      data-testid="canvas-bloco">
      {indice > 0 && <Handle type="target" position={Position.Left} className={cn(alca, "!bg-muted-foreground")} />}
      <div className="flex items-center gap-2 rounded-t-[10px] px-3 py-2 text-white" style={{ background: T.cor }}>
        <T.icone className="h-4 w-4 shrink-0" />
        <span className="truncate text-xs font-semibold uppercase tracking-wide">{T.rotulo}</span>
        <span className="ml-auto flex items-center gap-1">
          {indice === 0 && <span className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-bold"><Flag className="h-3 w-3" /> Início</span>}
          <button type="button" title="Duplicar" aria-label="Duplicar passo" onClick={(e) => { e.stopPropagation(); data.onDuplicar(p.id); }}
            className="nodrag hidden rounded p-0.5 hover:bg-black/20 group-hover:block"><Copy className="h-3.5 w-3.5" /></button>
          {data.podeRemover && (
            <button type="button" title="Remover" aria-label="Remover passo" onClick={(e) => { e.stopPropagation(); data.onRemover(p.id); }}
              className="nodrag hidden rounded p-0.5 hover:bg-black/20 group-hover:block"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </span>
      </div>
      <p className={cn("line-clamp-3 whitespace-pre-wrap px-3 py-2 text-xs", !p.texto && "italic text-muted-foreground")}>
        {p.texto || (p.tipo === "transferir" || p.tipo === "encerrar" ? "Sem texto" : "Escreva a mensagem")}
      </p>
      {p.tipo === "link" && (
        <p className="truncate border-t px-3 py-1.5 text-[11px] font-medium" style={{ color: T.cor }}>
          {p.link_tipo === "url" ? (p.url || "Sem endereço") : data.rotuloLink}
        </p>
      )}
      {p.tipo === "transferir" && (
        <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          {p.destino_tipo === "pessoa" ? "Para uma pessoa" : p.destino_tipo === "setor" ? "Para um setor" : "Para a fila da equipe"}
        </p>
      )}
      {p.tipo === "menu" && (
        <ul className="border-t">
          {p.opcoes.map((o, k) => (
            <li key={k} className="relative border-b px-3 py-1.5 pr-6 text-xs last:border-b-0 last:rounded-b-[10px]">
              <b className="text-primary">{k + 1}.</b> {o.rotulo || <span className="italic text-muted-foreground">opção sem texto</span>}
              <Handle type="source" id={`op${k}`} position={Position.Right} className={alca} style={{ background: T.cor }} />
            </li>
          ))}
        </ul>
      )}
      {COM_DEPOIS.includes(p.tipo) && (
        <div className="relative border-t px-3 py-1.5 pr-6 text-right text-[11px] text-muted-foreground">
          depois
          <Handle type="source" id="prox" position={Position.Right} className={alca} style={{ background: T.cor }} />
        </div>
      )}
      {avisos.length > 0 && (
        <p className="flex items-start gap-1 rounded-b-[10px] border-t bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/60 dark:text-amber-200" title={avisos.join("\n")}>
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" /> {avisos[0]}{avisos.length > 1 ? ` (+${avisos.length - 1})` : ""}
        </p>
      )}
    </div>
  );
}

/** Ligação com o número da opção e um botão para desligar. */
function Ligacao(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, label, data, selected } = props;
  const [caminho, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14 });
  return (
    <>
      <BaseEdge id={id} path={caminho} markerEnd={markerEnd} style={{ ...style, strokeWidth: selected ? 3 : 2 }} interactionWidth={24} />
      <EdgeLabelRenderer>
        <div className="nodrag nopan pointer-events-auto absolute flex items-center gap-0.5" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
          {label && <span className="rounded-full bg-card px-1.5 text-[10px] font-bold shadow-sm ring-1 ring-border">{label}</span>}
          <button type="button" aria-label="Desligar" title="Desligar" data-testid="ligacao-desligar"
            onClick={() => (data as { desligar: (id: string) => void }).desligar(id)}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm ring-1 ring-border hover:bg-destructive hover:text-white">
            <X className="h-3 w-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const tiposNo = { passo: BlocoPasso };
const tiposLigacao = { ligacao: Ligacao };

type Props = { f: Fluxo; setF: (fn: (x: Fluxo) => Fluxo) => void; selecionado: string | null; setSelecionado: (id: string | null) => void };

function Desenho({ f, setF, selecionado, setSelecionado }: Props) {
  const { resolvedTheme } = useTheme();
  const seg = useSegmento();
  const rf = useReactFlow();
  const caixa = useRef<HTMLDivElement>(null);
  const soltouEm = useRef(0);  // o clique que fecha o arraste cai no fundo: não pode desfazer a escolha
  const [soltar, setSoltar] = useState<{ x: number; y: number; flow: { x: number; y: number }; origem: string; alca: string } | null>(null);
  const auto = useMemo(() => organizar(f), [f]);
  const avisos = useMemo(() => problemas(f), [f]);
  const rotulos = rotulosLink(seg.termos);

  const remover = useCallback((id: string) => { setF((x) => (x.passos.length > 1 ? semPasso(x, id) : x)); setSelecionado(null); }, [setF, setSelecionado]);
  const copiar = useCallback((id: string) => {
    const r = duplicar(f, id);
    if (!r) return;
    setF(() => r.fluxo);
    setSelecionado(r.novo.id);
  }, [f, setF, setSelecionado]);

  const nodes: NoPasso[] = useMemo(() => f.passos.map((p, i) => ({
    id: p.id, type: "passo", position: p.pos ?? auto[p.id], selected: p.id === selecionado,
    data: { passo: p, indice: i, avisos: avisos[p.id] ?? [], rotuloLink: rotulos[p.link_tipo ?? "agenda"], onDuplicar: copiar, onRemover: remover, podeRemover: f.passos.length > 1 },
  })), [f, auto, selecionado, avisos, rotulos, copiar, remover]);

  const ligar = useCallback((origem: string, alca: string | null | undefined, destino: string | null) => {
    setF((x) => ({ ...x, passos: x.passos.map((p) => {
      if (p.id !== origem) return p;
      if (alca === "prox") return { ...p, proximo: destino };
      const k = Number((alca ?? "").replace("op", ""));
      return Number.isNaN(k) ? p : { ...p, opcoes: p.opcoes.map((o, z) => (z === k ? { ...o, proximo: destino } : o)) };
    }) }));
  }, [setF]);
  const desligar = useCallback((edgeId: string) => { const [o, a] = edgeId.split("|"); ligar(o, a, null); }, [ligar]);

  const edges: Edge[] = useMemo(() => f.passos.flatMap((p) => {
    const cor = TIPOS[p.tipo].cor;
    const base = { type: "ligacao", markerEnd: { type: MarkerType.ArrowClosed, color: cor }, style: { stroke: cor }, data: { desligar } };
    const lista: Edge[] = [];
    if (COM_DEPOIS.includes(p.tipo) && p.proximo) lista.push({ id: `${p.id}|prox`, source: p.id, sourceHandle: "prox", target: p.proximo, ...base });
    if (p.tipo === "menu") p.opcoes.forEach((o, k) => o.proximo && lista.push({ id: `${p.id}|op${k}`, source: p.id, sourceHandle: `op${k}`, target: o.proximo, label: String(k + 1), ...base }));
    return lista;
  }), [f, desligar]);

  const onNodesChange = useCallback((changes: NodeChange<NoPasso>[]) => {
    for (const c of changes) if (c.type === "select" && c.selected) setSelecionado(c.id);
    if (changes.some((c) => c.type === "position")) {
      const movidos = applyNodeChanges(changes.filter((c) => c.type === "position"), nodes);
      const pos = Object.fromEntries(movidos.map((n) => [n.id, n.position]));
      setF((x) => ({ ...x, passos: x.passos.map((p) => (pos[p.id] ? { ...p, pos: { x: Math.round(pos[p.id].x), y: Math.round(pos[p.id].y) } } : p)) }));
    }
    const tirar = changes.filter((c) => c.type === "remove").map((c) => c.id);
    if (tirar.length) setF((x) => tirar.reduce((acc, id) => (acc.passos.length > 1 ? semPasso(acc, id) : acc), x));
  }, [nodes, setF, setSelecionado]);

  const onConnect = useCallback((c: Connection) => { if (c.source !== c.target) ligar(c.source, c.sourceHandle, c.target); }, [ligar]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const c of changes) if (c.type === "remove") desligar(c.id);
  }, [desligar]);

  /** Soltou fora de uma alça: em cima de um bloco, liga nele; no vazio, oferece criar o próximo passo ali. */
  const onConnectEnd = useCallback((evento: MouseEvent | TouchEvent, estado: FinalConnectionState) => {
    soltouEm.current = Date.now();
    if (estado.isValid || !estado.fromNode || !estado.fromHandle) return;
    const ponto = "changedTouches" in evento ? evento.changedTouches[0] : evento;
    const alvo = document.elementsFromPoint(ponto.clientX, ponto.clientY)
      .map((el) => (el as HTMLElement).closest?.(".react-flow__node") as HTMLElement | null).find(Boolean);
    const destino = alvo?.dataset.id;
    if (destino && destino !== estado.fromNode.id) {
      ligar(estado.fromNode.id, estado.fromHandle.id, destino);
      return;
    }
    if (destino) return;
    const r = caixa.current!.getBoundingClientRect();
    setSoltar({ x: ponto.clientX - r.left, y: ponto.clientY - r.top, flow: rf.screenToFlowPosition({ x: ponto.clientX, y: ponto.clientY }),
      origem: estado.fromNode.id, alca: estado.fromHandle.id ?? "prox" });
  }, [ligar, rf]);

  const criarAqui = (tipo: TipoPasso) => {
    if (!soltar) return;
    const novo = { ...passoVazio(tipo), pos: { x: Math.round(soltar.flow.x), y: Math.round(soltar.flow.y - 30) } };
    setF((x) => ({ ...x, passos: [...x.passos, novo] }));
    ligar(soltar.origem, soltar.alca, novo.id);
    setSelecionado(novo.id);
    setSoltar(null);
  };

  const adicionar = (tipo: TipoPasso) => {
    // ao lado do bloco escolhido (ou do último), sem cair em cima de outro
    const ref = f.passos.find((x) => x.id === selecionado) ?? f.passos[f.passos.length - 1];
    const base = ref ? (ref.pos ?? auto[ref.id]) : { x: 0, y: 0 };
    let pos = { x: base.x + LARG + 80, y: base.y };
    const ocupado = (q: { x: number; y: number }) => f.passos.some((x) => { const o = x.pos ?? auto[x.id]; return Math.abs(o.x - q.x) < LARG && Math.abs(o.y - q.y) < ALT - 30; });
    for (let k = 0; k < 30 && ocupado(pos); k++) pos = { x: pos.x, y: pos.y + ALT };
    const novo = { ...passoVazio(tipo), pos };
    setTimeout(() => rf.setCenter(pos.x + 130, pos.y + 60, { zoom: Math.max(rf.getZoom(), 0.8), duration: 300 }), 50);
    setF((x) => ({ ...x, passos: [...x.passos, novo] }));
    setSelecionado(novo.id);
  };
  const reorganizar = () => {
    setF((x) => { const pos = organizar(x); return { ...x, passos: x.passos.map((p) => ({ ...p, pos: pos[p.id] })) }; });
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50);
  };

  return (
    <div ref={caixa} className="relative h-full w-full">
      <ReactFlow<NoPasso, Edge> nodes={nodes} edges={edges} nodeTypes={tiposNo} edgeTypes={tiposLigacao}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onConnectEnd={onConnectEnd}
        onPaneClick={() => { if (Date.now() - soltouEm.current < 400) return; setSelecionado(null); setSoltar(null); }}
        fitView fitViewOptions={{ padding: 0.15, maxZoom: 1, minZoom: 0.8 }}
        minZoom={0.2} maxZoom={1.5} connectionRadius={36} snapToGrid snapGrid={[20, 20]}
        colorMode={resolvedTheme === "dark" ? "dark" : "light"} deleteKeyCode={["Backspace", "Delete"]} proOptions={{ hideAttribution: true }}>
        <Background gap={20} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" />

        <Panel position="top-left" className="flex flex-wrap gap-1.5">
          {(Object.keys(TIPOS) as TipoPasso[]).map((t) => {
            const T = TIPOS[t];
            return (
              <Button key={t} size="sm" variant="outline" className="bg-card shadow-sm" onClick={() => adicionar(t)} title={T.ajuda} data-testid={`canvas-add-${t}`}>
                <Plus className="h-3.5 w-3.5" /><T.icone className="h-3.5 w-3.5" style={{ color: T.cor }} /> {T.rotulo}
              </Button>
            );
          })}
          <Button size="sm" variant="outline" className="bg-card shadow-sm" onClick={reorganizar} data-testid="canvas-organizar"><LayoutGrid className="h-3.5 w-3.5" /> Organizar</Button>
        </Panel>
      </ReactFlow>
      {soltar && (
        <div className="absolute z-10 grid w-56 gap-0.5 rounded-lg border bg-popover p-1 text-sm shadow-xl" style={{ left: Math.min(soltar.x, (caixa.current?.clientWidth ?? 400) - 230), top: soltar.y }}
          data-testid="canvas-soltar">
          <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">Criar o próximo passo aqui</p>
          {(Object.keys(TIPOS) as TipoPasso[]).map((t) => {
            const T = TIPOS[t];
            return (
              <button key={t} type="button" onClick={() => criarAqui(t)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted" data-testid={`soltar-${t}`}>
                <T.icone className="h-4 w-4" style={{ color: T.cor }} /> {T.rotulo}
              </button>
            );
          })}
          <button type="button" onClick={() => setSoltar(null)} className="rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted">Cancelar</button>
        </div>
      )}
    </div>
  );
}

export function FluxoCanvas(props: Props) {
  return (
    <div className="h-full min-h-[420px] overflow-hidden bg-muted/30" data-testid="fluxo-canvas">
      <ReactFlowProvider><Desenho {...props} /></ReactFlowProvider>
    </div>
  );
}
