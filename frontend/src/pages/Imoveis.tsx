import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Bath,
  BedDouble,
  Building2,
  Car,
  Eye,
  LayoutGrid,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Ruler,
  Search,
  Table as TableIcon,
  Trash2,
} from "lucide-react";
import { apiDelete, apiGet, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { IMOVEL_FINALIDADE, IMOVEL_STATUS, IMOVEL_TIPO } from "@/lib/constants";
import type { Imovel, ImovelStatus, ImovelTipo, Pessoa } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PropertyModal from "@/components/imoveis/PropertyModal";
import PropertyDetailSheet from "@/components/imoveis/PropertyDetailSheet";
import { StatusImovelBadge } from "@/components/shared/badges";
import { SiteBadge } from "@/components/site/SiteStatusPicker";
import { cn } from "@/lib/utils";

const TODOS = "__todos__";

export default function Imoveis() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>(TODOS);
  const [tipo, setTipo] = useState<string>(TODOS);
  const [visao, setVisao] = useState<"tabela" | "cards">("tabela");
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Imovel | null>(null);
  const [fichaId, setFichaId] = useState<string | null>(null);

  const imoveisQ = useQuery({ queryKey: ["imoveis"], queryFn: () => apiGet<Imovel[]>("/imoveis") });
  const pessoasQ = useQuery({ queryKey: ["pessoas"], queryFn: () => apiGet<Pessoa[]>("/pessoas") });

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("novo") === "1") {
      setEditando(null);
      setModalAberto(true);
      setSearchParams({}, { replace: true });
    } else if (searchParams.get("id")) {
      setFichaId(searchParams.get("id"));
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const imoveis = imoveisQ.data ?? [];
  const pessoas = pessoasQ.data ?? [];
  const pessoaById = new Map(pessoas.map((p) => [p.id, p]));

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return imoveis.filter((i) => {
      const casa = !q || [i.codigo, i.titulo, i.bairro, i.cidade, i.endereco].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      );
      return (
        casa &&
        (status === TODOS || i.status === status) &&
        (tipo === TODOS || i.tipo === tipo)
      );
    });
  }, [imoveis, busca, status, tipo]);

  const excluir = useMutation({
    mutationFn: (id: string) => apiDelete(`/imoveis/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["imoveis"] });
      toast.success("Imóvel excluído.");
    },
    onError: (e) => toast.error("Não foi possível excluir o imóvel.", { description: detalheErro(e) }),
  });

  const abrirNovo = () => {
    setEditando(null);
    setModalAberto(true);
  };

  const abrirEdicao = (imovel: Imovel) => {
    setEditando(imovel);
    setModalAberto(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por código, título, bairro, cidade ou endereço..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            data-testid="imovel-busca-input"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" data-testid="imovel-status-select">
              <SelectValue>{status === TODOS ? "Todos os status" : IMOVEL_STATUS[status as ImovelStatus].label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os status</SelectItem>
              {(Object.keys(IMOVEL_STATUS) as ImovelStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {IMOVEL_STATUS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="w-40" data-testid="imovel-tipo-filtro-select">
              <SelectValue>{tipo === TODOS ? "Todos os tipos" : IMOVEL_TIPO[tipo as ImovelTipo]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os tipos</SelectItem>
              {(Object.keys(IMOVEL_TIPO) as ImovelTipo[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {IMOVEL_TIPO[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex overflow-hidden rounded-md border">
            <button
              className={cn(
                "flex h-9 w-9 items-center justify-center transition-colors",
                visao === "tabela" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setVisao("tabela")}
              data-testid="imovel-view-table"
              aria-label="Visualização em tabela"
            >
              <TableIcon className="h-4 w-4" />
            </button>
            <button
              className={cn(
                "flex h-9 w-9 items-center justify-center transition-colors",
                visao === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setVisao("cards")}
              data-testid="imovel-view-cards"
              aria-label="Visualização em cartões"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          <Button onClick={abrirNovo} data-testid="btn-new-property">
            <Plus className="h-4 w-4" /> Novo Imóvel
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground" data-testid="imoveis-count">
        {imoveisQ.isLoading
          ? "Carregando imóveis…"
          : `${filtrados.length} imóvel(is) encontrado(s)`}
      </p>

      {!imoveisQ.isLoading && filtrados.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Nenhum imóvel encontrado</p>
          <p className="mt-1 text-xs text-muted-foreground">Ajuste os filtros ou cadastre um novo imóvel.</p>
          <Button className="mt-4" variant="outline" size="sm" onClick={abrirNovo}>
            <Plus className="h-4 w-4" /> Cadastrar imóvel
          </Button>
        </div>
      )}

      {visao === "tabela" && filtrados.length > 0 && (
        <div className="rounded-lg border bg-card" data-testid="imoveis-tabela">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Imóvel</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Proprietário</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((i) => (
                <TableRow key={i.id} data-testid={`imovel-row-${i.id}`} className="transition-colors hover:bg-muted/40">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-14 shrink-0 overflow-hidden rounded bg-muted">
                        {i.foto_url ? (
                          <img src={i.foto_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted-foreground">
                            <Building2 className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{i.titulo}</p>
                        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <span className="font-mono font-semibold text-primary" data-testid={`imovel-codigo-${i.id}`}>
                            {i.codigo || "—"}
                          </span>
                          · <MapPin className="h-3 w-3" /> {i.bairro ? `${i.bairro} · ` : ""}
                          {i.cidade}
                          {i.estado ? `/${i.estado}` : ""}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{IMOVEL_TIPO[i.tipo]}</p>
                    <p className="text-xs text-muted-foreground">{IMOVEL_FINALIDADE[i.finalidade]}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusImovelBadge status={i.status} />
                      <SiteBadge status={i.site_status} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">
                      {i.proprietario_id ? (pessoaById.get(i.proprietario_id)?.nome ?? "—") : "—"}
                    </p>
                  </TableCell>
                  <TableCell className="text-right">
                    <p className="font-mono text-sm font-semibold">
                      {brl(i.valor_venda ?? i.valor_aluguel)}
                    </p>
                    {i.valor_venda != null && i.valor_aluguel != null && (
                      <p className="font-mono text-[11px] text-muted-foreground">aluguel {brl(i.valor_aluguel)}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Ficha completa"
                        onClick={() => setFichaId(i.id)}
                        data-testid={`imovel-ver-ficha-${i.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon-xs" data-testid={`imovel-actions-${i.id}`} />
                          }
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setFichaId(i.id)} data-testid={`imovel-menu-ficha-${i.id}`}>
                            <Eye className="h-4 w-4" /> Ficha completa
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => abrirEdicao(i)} data-testid={`imovel-menu-editar-${i.id}`}>
                            <Pencil className="h-4 w-4" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => excluir.mutate(i.id)}
                            data-testid={`imovel-excluir-${i.id}`}
                          >
                            <Trash2 className="h-4 w-4" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {visao === "cards" && filtrados.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3" data-testid="imoveis-cards">
          {filtrados.map((i) => (
            <Card key={i.id} className="overflow-hidden pt-0" data-testid={`imovel-card-${i.id}`}>
              <div className="relative h-40 w-full bg-muted">
                {i.foto_url ? (
                  <img src={i.foto_url} alt={i.titulo} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <Building2 className="h-8 w-8" />
                  </div>
                )}
                <div className="absolute left-3 top-3 flex gap-1">
                  <StatusImovelBadge status={i.status} />
                  <SiteBadge status={i.site_status} />
                </div>
              </div>
              <CardContent className="p-5">
                <p className="font-mono text-xs font-semibold text-primary" data-testid={`imovel-card-codigo-${i.id}`}>
                  {i.codigo || "—"}
                </p>
                <p className="font-heading text-base font-bold tracking-tight">{i.titulo}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" /> {i.bairro ? `${i.bairro} · ` : ""}
                  {i.cidade}
                  {i.estado ? `/${i.estado}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {i.quartos > 0 && (
                    <span className="flex items-center gap-1">
                      <BedDouble className="h-3.5 w-3.5" /> {i.quartos} qts
                    </span>
                  )}
                  {i.suites > 0 && (
                    <span className="flex items-center gap-1">
                      <Bath className="h-3.5 w-3.5" /> {i.suites} suítes
                    </span>
                  )}
                  {i.vagas > 0 && (
                    <span className="flex items-center gap-1">
                      <Car className="h-3.5 w-3.5" /> {i.vagas} vagas
                    </span>
                  )}
                  {i.area_util != null && (
                    <span className="flex items-center gap-1">
                      <Ruler className="h-3.5 w-3.5" /> {i.area_util} m²
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-sm font-semibold">{brl(i.valor_venda ?? i.valor_aluguel)}</p>
                    {i.valor_venda != null && i.valor_aluguel != null && (
                      <p className="font-mono text-[11px] text-muted-foreground">
                        aluguel {brl(i.valor_aluguel)}/mês
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-xs" onClick={() => setFichaId(i.id)} data-testid={`imovel-card-ficha-${i.id}`}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon-xs" data-testid={`imovel-card-actions-${i.id}`} />}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => abrirEdicao(i)}>
                          <Pencil className="h-4 w-4" /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => excluir.mutate(i.id)}>
                          <Trash2 className="h-4 w-4" /> Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PropertyModal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        imovel={editando}
        pessoas={pessoas}
      />
      <PropertyDetailSheet
        imovelId={fichaId}
        onClose={() => setFichaId(null)}
        onEditar={(imovel) => {
          setFichaId(null);
          abrirEdicao(imovel);
        }}
      />
    </div>
  );
}
