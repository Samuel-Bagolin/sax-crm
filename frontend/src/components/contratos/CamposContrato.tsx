import { useQuery } from "@tanstack/react-query";
import { Building2, Car, Handshake, Lock } from "lucide-react";
import { apiGet } from "@/lib/api";
import { brl } from "@/lib/format";
import { useEquipe } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import { useSegmento } from "@/lib/segmento";
import { Label } from "@/components/ui/label";

/* Campos comuns dos contratos (imobiliária e loja de veículos):
   - o produto que veio do negócio aparece travado (não dá para trocar por engano);
   - o responsável pode ser qualquer pessoa da equipe, inclusive o gestor. */

interface ImovelResumo { id: string; titulo: string; codigo?: string | null; bairro?: string | null; cidade?: string | null }
export interface VeiculoResumo {
  id: string; titulo: string; codigo?: string | null; placa?: string | null; preco_venda?: number | null; status?: string;
  consignado?: boolean; repasse_valor?: number | null; consignante?: { nome: string; telefone?: string | null; cpf_cnpj?: string | null } | null;
}

export function useProduto(tipo: "imovel" | "veiculo", id: string | null) {
  return useQuery({
    queryKey: [tipo === "veiculo" ? "veiculo" : "imovel", id],
    queryFn: () => apiGet<ImovelResumo | VeiculoResumo>(tipo === "veiculo" ? `/veiculos/${id}` : `/imoveis/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** Produto do negócio, travado. */
export function ProdutoDoNegocio({ tipo, id }: { tipo: "imovel" | "veiculo"; id: string }) {
  const q = useProduto(tipo, id);
  const p = q.data;
  const Icone = tipo === "veiculo" ? Car : Building2;
  const detalhe = p ? (tipo === "veiculo" ? [(p as VeiculoResumo).codigo, (p as VeiculoResumo).placa].filter(Boolean).join(", ")
    : [(p as ImovelResumo).codigo, (p as ImovelResumo).bairro, (p as ImovelResumo).cidade].filter(Boolean).join(", ")) : "";
  return (
    <div className="grid gap-2">
      <Label>{tipo === "veiculo" ? "Veículo do negócio" : "Imóvel do negócio"}</Label>
      <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5" data-testid="produto-do-negocio">
        <Icone className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{q.isLoading ? "Carregando..." : p?.titulo ?? "Não encontrado"}</p>
          {detalhe && <p className="truncate text-xs text-muted-foreground">{detalhe}</p>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"><Lock className="h-3 w-3" /> vem do negócio</span>
      </div>
    </div>
  );
}

/** Veículo consignado: mostra o dono, que entra no contrato como vendedor. */
export function AvisoConsignado({ veiculo }: { veiculo?: VeiculoResumo | null }) {
  if (!veiculo?.consignado) return null;
  const dono = veiculo.consignante;
  return (
    <div className="flex gap-3 rounded-lg border border-violet-300 bg-violet-50 p-3 text-sm text-violet-950 dark:bg-violet-950/30 dark:text-violet-100" data-testid="aviso-consignado">
      <Handshake className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="grid gap-0.5">
        <p className="font-semibold">Veículo em consignação</p>
        <p>Vendedor: <b>{dono?.nome ?? "dono não informado"}</b>{dono?.cpf_cnpj ? `, CPF/CNPJ ${dono.cpf_cnpj}` : ""}{dono?.telefone ? `, ${dono.telefone}` : ""}.</p>
        <p className="text-xs opacity-80">
          O contrato sai com o dono como vendedor e a loja como intermediária. Na venda, o repasse
          {veiculo.repasse_valor ? ` de ${brl(veiculo.repasse_valor)}` : ""} entra no Financeiro como conta a pagar.
        </p>
      </div>
    </div>
  );
}

/** Responsável pelo contrato: o gestor escolhe qualquer pessoa da equipe, inclusive ele mesmo. */
export function ResponsavelContrato({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const { isAdmin } = useAuth();
  const seg = useSegmento();
  const { data: equipe = [] } = useEquipe();
  if (!isAdmin) return null;
  const membros = equipe.filter((m) => m.pessoa_id && m.ativo !== false);
  return (
    <div className="grid gap-2">
      <Label htmlFor="ct-resp">Responsável</Label>
      <select id="ct-resp" value={valor} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm" data-testid="contrato-responsavel">
        <option value="">Eu mesmo</option>
        {membros.map((m) => <option key={m.usuario_id} value={m.pessoa_id!}>{m.nome}{m.papel === "admin" ? " (gestor)" : ` (${seg.termos.profissional.toLowerCase()})`}</option>)}
      </select>
    </div>
  );
}
