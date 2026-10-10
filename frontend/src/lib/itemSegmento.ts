import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { useSegmento } from "@/lib/segmento";

/* O que o cliente quer comprar no negócio: imóvel na imobiliária, veículo na loja. Nos segmentos de
   atendimento não há item no negócio (o que se vende fica no orçamento). Um lugar só para as telas
   de Leads, Negócio e detalhe usarem o campo e o texto certos. */

export interface ItemOpcao {
  id: string;
  titulo: string;
  detalhe: string;
  valor: number | null;
  foto_url: string | null;
  link: string;
}

interface ImovelLite { id: string; titulo: string; codigo?: string | null; bairro?: string | null; cidade?: string | null; valor_venda?: number | null; valor_aluguel?: number | null; foto_url?: string | null }
interface VeiculoLite { id: string; titulo: string; codigo: string; km: number; cor: string | null; preco_venda: number | null; foto_url: string | null; status: string }

export function useItemSegmento(enabled = true) {
  const seg = useSegmento();
  const tipo: "imovel" | "veiculo" | null = seg.imobiliaria ? "imovel" : seg.veiculos ? "veiculo" : null;
  const q = useQuery({
    queryKey: [tipo === "veiculo" ? "veiculos" : "imoveis", "opcoes"],
    queryFn: async (): Promise<ItemOpcao[]> => {
      if (tipo === "veiculo") {
        const lista = await apiGet<VeiculoLite[]>("/veiculos");
        return lista
          .filter((v) => v.status !== "vendido")
          .map((v) => ({ id: v.id, titulo: v.titulo, detalhe: [v.codigo, v.km ? `${v.km.toLocaleString("pt-BR")} km` : null, v.cor].filter(Boolean).join(", "),
            valor: v.preco_venda, foto_url: v.foto_url, link: `/veiculos?id=${v.id}` }));
      }
      const lista = await apiGet<ImovelLite[]>("/imoveis");
      return lista.map((i) => ({ id: i.id, titulo: i.titulo, detalhe: [i.codigo, i.bairro, i.cidade].filter(Boolean).join(", "),
        valor: i.valor_venda ?? i.valor_aluguel ?? null, foto_url: i.foto_url ?? null, link: `/imoveis?id=${i.id}` }));
    },
    enabled: enabled && !!tipo,
    staleTime: 60_000,
  });
  return {
    tipo,
    /** Campo do negócio/lead que guarda o item. */
    campo: tipo === "veiculo" ? ("veiculo_id" as const) : tipo === "imovel" ? ("imovel_id" as const) : null,
    rotulo: tipo === "veiculo" ? "Veículo de interesse" : "Imóvel de interesse",
    nome: tipo === "veiculo" ? "veículo" : "imóvel",
    busca: tipo === "veiculo" ? "Buscar por modelo, código ou cor" : "Buscar por título, código ou bairro",
    opcoes: q.data ?? [],
    carregando: q.isLoading,
  };
}
