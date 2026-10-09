import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OpcaoCombo {
  valor: string;
  rotulo: string;
  detalhe?: string | null;
}

/** Seleção com busca (lista longa de clientes/imóveis). `onCriar` permite cadastrar na hora. */
export default function Combo({
  opcoes,
  valor,
  onChange,
  placeholder = "Selecionar…",
  vazio = "Nenhum resultado",
  onCriar,
  rotuloCriar = "Cadastrar",
  permitirLimpar = true,
  id,
  testid,
}: {
  opcoes: OpcaoCombo[];
  valor: string | null;
  onChange: (valor: string | null) => void;
  placeholder?: string;
  vazio?: string;
  onCriar?: (texto: string) => void;
  rotuloCriar?: string;
  permitirLimpar?: boolean;
  id?: string;
  testid?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const [ativo, setAtivo] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const atual = opcoes.find((o) => o.valor === valor);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  const filtradas = useMemo(() => {
    const t = termo.trim().toLowerCase();
    const lista = t
      ? opcoes.filter((o) => o.rotulo.toLowerCase().includes(t) || (o.detalhe ?? "").toLowerCase().includes(t))
      : opcoes;
    return lista.slice(0, 60);
  }, [opcoes, termo]);

  const escolher = (v: string | null) => {
    onChange(v);
    setAberto(false);
    setTermo("");
  };

  return (
    <div ref={caixa} className="relative">
      {aberto ? (
        <input
          id={id}
          autoFocus
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setAtivo(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setAberto(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAtivo((a) => Math.min(a + 1, filtradas.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setAtivo((a) => Math.max(a - 1, 0));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtradas[ativo]) escolher(filtradas[ativo].valor);
              else if (onCriar && termo.trim()) {
                onCriar(termo.trim());
                setAberto(false);
                setTermo("");
              }
            }
          }}
          placeholder="Digite para buscar"
          className="h-8 w-full rounded-lg border border-ring bg-transparent px-2.5 text-sm outline-none ring-3 ring-ring/30"
          data-testid={testid ? `${testid}-busca` : undefined}
        />
      ) : (
        <button
          id={id}
          type="button"
          onClick={() => setAberto(true)}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm hover:border-ring/60 dark:bg-input/30"
          data-testid={testid}
        >
          <span className={cn("flex-1 truncate", !atual && "text-muted-foreground")}>{atual ? atual.rotulo : placeholder}</span>
          {atual && permitirLimpar ? (
            <X
              className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      )}
      {aberto && (
        <div className="absolute left-0 right-0 top-9 z-50 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg scroll-fino">
          {filtradas.map((o, i) => (
            <button
              key={o.valor}
              type="button"
              onMouseEnter={() => setAtivo(i)}
              onClick={() => escolher(o.valor)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                i === ativo ? "bg-accent text-accent-foreground" : "",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.rotulo}</span>
                {o.detalhe && <span className="block truncate text-xs text-muted-foreground">{o.detalhe}</span>}
              </span>
              {o.valor === valor && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>
          ))}
          {filtradas.length === 0 && !onCriar && <p className="px-2 py-2 text-sm text-muted-foreground">{vazio}</p>}
          {onCriar && termo.trim() && (
            <button
              type="button"
              onClick={() => {
                onCriar(termo.trim());
                setAberto(false);
                setTermo("");
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" /> {rotuloCriar} “{termo.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
