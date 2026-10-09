import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Building2, KeyRound, Phone, Plus, Search, User } from "lucide-react";
import { apiGet } from "@/lib/api";
import { brlCompacto } from "@/lib/format";
import type { ProprietarioResumo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProprietarioForm from "@/components/proprietarios/ProprietarioForm";
import { cn } from "@/lib/utils";

export default function Proprietarios() {
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<"todos" | "pf" | "pj">("todos");
  const [novo, setNovo] = useState(false);
  const { data = [], isLoading } = useQuery({ queryKey: ["proprietarios"], queryFn: () => apiGet<ProprietarioResumo[]>("/proprietarios") });

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return data.filter(
      (p) =>
        (tipo === "todos" || (p.tipo_pessoa ?? "pf") === tipo) &&
        (!t || [p.nome, p.nome_fantasia, p.cpf_cnpj, p.email, p.telefone].some((v) => (v ?? "").toLowerCase().includes(t))),
    );
  }, [data, busca, tipo]);

  const totalImoveis = data.reduce((s, p) => s + p.qtd_imoveis, 0);
  const totalAlugados = data.reduce((s, p) => s + p.qtd_alugados, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} data-testid="proprietario-busca" />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Filtrar por tipo">
            {([
              ["todos", "Todos"],
              ["pf", "Pessoa física"],
              ["pj", "Pessoa jurídica"],
            ] as const).map(([v, r]) => (
              <button
                key={v}
                type="button"
                aria-pressed={tipo === v}
                onClick={() => setTipo(v)}
                className={cn("flex-1 whitespace-nowrap rounded px-3 py-1.5 text-sm", tipo === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
              >
                {r}
              </button>
            ))}
          </div>
          <Button onClick={() => setNovo(true)} data-testid="btn-novo-proprietario">
            <Plus className="h-4 w-4" /> Novo proprietário
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {data.length} proprietário(s) com {totalImoveis} imóvel(is), {totalAlugados} alugado(s).
      </p>

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : !lista.length ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <KeyRound className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">{data.length ? "Nenhum proprietário encontrado com esse filtro." : "Nenhum proprietário cadastrado."}</p>
          {!data.length && (
            <Button onClick={() => setNovo(true)}>
              <Plus className="h-4 w-4" /> Cadastrar o primeiro
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="lista-proprietarios">
          {lista.map((p) => (
            <li key={p.id}>
              <Link to={`/proprietarios/${p.id}`} className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/30">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                    {(p.tipo_pessoa ?? "pf") === "pj" ? <Building2 className="h-5 w-5" /> : <User className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {(p.tipo_pessoa ?? "pf") === "pj" ? "Pessoa jurídica" : "Pessoa física"}
                      {p.cpf_cnpj ? `, ${p.cpf_cnpj}` : ""}
                    </p>
                  </div>
                </div>
                {p.telefone && (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" /> {p.telefone}
                  </p>
                )}
                <div className="mt-auto grid grid-cols-3 gap-2 border-t pt-3 text-center">
                  <div>
                    <p className="num text-lg font-bold">{p.qtd_imoveis}</p>
                    <p className="text-[11px] text-muted-foreground">Imóveis</p>
                  </div>
                  <div>
                    <p className="num text-lg font-bold">{p.qtd_alugados}</p>
                    <p className="text-[11px] text-muted-foreground">Alugados</p>
                  </div>
                  <div>
                    <p className="num truncate text-sm font-bold leading-7">{p.valor_carteira ? brlCompacto(p.valor_carteira) : "-"}</p>
                    <p className="text-[11px] text-muted-foreground">À venda</p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ProprietarioForm open={novo} onClose={() => setNovo(false)} />
    </div>
  );
}
