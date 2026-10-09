import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Building2, FileSignature, Handshake, Inbox, Loader2, Search, User } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { ResultadoBusca } from "@/lib/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ICONE = { negocio: Handshake, pessoa: User, imovel: Building2, entrada: Inbox, contrato: FileSignature };
const GRUPO = { negocio: "Negócios", entrada: "Leads", pessoa: "Pessoas", imovel: "Imóveis", contrato: "Contratos" };

function destino(r: ResultadoBusca): string {
  switch (r.tipo) {
    case "negocio":
      return `/negocios/${r.id}`;
    case "entrada":
      return `/leads?id=${r.id}`;
    case "contrato":
      return `/contratos?id=${r.id}`;
    case "imovel":
      return `/imoveis?id=${r.id}`;
    default:
      return `/crm?busca=${encodeURIComponent(r.titulo)}&status=todos`;
  }
}

export default function BuscaGlobal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [termo, setTermo] = useState("");
  const [atrasado, setAtrasado] = useState("");
  const [ativo, setAtivo] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setAtrasado(termo.trim()), 180);
    return () => clearTimeout(t);
  }, [termo]);

  useEffect(() => {
    if (open) {
      setTermo("");
      setAtivo(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  const { data = [], isFetching } = useQuery({
    queryKey: ["busca", atrasado],
    queryFn: () => apiGet<ResultadoBusca[]>(`/busca?q=${encodeURIComponent(atrasado)}`),
    enabled: atrasado.length >= 2,
  });

  const ordenados = useMemo(() => {
    const ordem = ["negocio", "entrada", "pessoa", "imovel", "contrato"];
    return [...data].sort((a, b) => ordem.indexOf(a.tipo) - ordem.indexOf(b.tipo));
  }, [data]);

  const abrir = (r: ResultadoBusca) => {
    onOpenChange(false);
    navigate(destino(r));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Buscar no CRM</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={input}
            value={termo}
            onChange={(e) => {
              setTermo(e.target.value);
              setAtivo(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAtivo((a) => Math.min(a + 1, ordenados.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAtivo((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && ordenados[ativo]) {
                abrir(ordenados[ativo]);
              }
            }}
            placeholder="Buscar negócio, cliente, telefone, imóvel ou contrato…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            data-testid="busca-global-input"
          />
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2 scroll-fino">
          {atrasado.length < 2 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Digite ao menos 2 letras.</p>
          ) : ordenados.length === 0 && !isFetching ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nada encontrado para “{atrasado}”.</p>
          ) : (
            ordenados.map((r, i) => {
              const Icone = ICONE[r.tipo];
              const novoGrupo = i === 0 || ordenados[i - 1].tipo !== r.tipo;
              return (
                <div key={`${r.tipo}-${r.id}`}>
                  {novoGrupo && <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">{GRUPO[r.tipo]}</p>}
                  <button
                    type="button"
                    onMouseEnter={() => setAtivo(i)}
                    onClick={() => abrir(r)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
                      i === ativo ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                  >
                    <Icone className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{r.titulo}</span>
                    {r.subtitulo && <span className="truncate text-xs text-muted-foreground">{r.subtitulo}</span>}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
