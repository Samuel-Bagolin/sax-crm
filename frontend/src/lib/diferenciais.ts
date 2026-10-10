import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { ImovelTipo } from "@/lib/types";

// ---------------------------------------------------------------- plano

export type Recurso = "match" | "automacoes" | "propostas" | "portais" | "proprietario" | "google" | "assinatura" | "chat" | "site";

export interface PlanoAtual {
  chave: string;
  nome: string;
  preco: number | null;
  preco_mensal?: number | null;
  preco_anual?: number | null;
  ativo?: boolean;
  ordem?: number;
  implantacao: number | null;
  usuarios: number | null;
  imoveis: number | null;
  modulos: string[];
  recursos: Recurso[];
  resumo: string;
  uso_usuarios: number;
  uso_imoveis: number;
}

export type PlanoCatalogo = Omit<PlanoAtual, "uso_usuarios" | "uso_imoveis">;

export type TipoAdicional = "recurso" | "usuarios" | "imoveis" | "servico";

export interface Adicional {
  chave: string;
  nome: string;
  descricao: string;
  tipo: TipoAdicional;
  recurso: Recurso | null;
  quantidade_por_unidade: number;
  preco_mensal: number;
  preco_anual: number | null;
  ativo: boolean;
}

export interface CatalogoPlanos {
  planos: PlanoCatalogo[];
  adicionais?: Adicional[];
  recursos: Record<Recurso, string>;
  modulos?: Record<string, string>;
  tipos_adicional?: Record<TipoAdicional, string>;
}

export function useCatalogoCompleto() {
  return useQuery({ queryKey: ["planos", "todos"], queryFn: () => apiGet<CatalogoPlanos>("/planos?todos=true") });
}

export function usePlano() {
  const q = useQuery({ queryKey: ["plano"], queryFn: () => apiGet<PlanoAtual>("/plano"), staleTime: 5 * 60_000 });
  const tem = (r: Recurso) => !q.data || q.data.recursos.includes(r);
  return { ...q, tem };
}

export function useCatalogoPlanos(enabled = true) {
  return useQuery({ queryKey: ["planos"], queryFn: () => apiGet<CatalogoPlanos>("/planos"), staleTime: 30 * 60_000, enabled });
}

// ---------------------------------------------------------------- match e vitrine

export interface PerfilBusca {
  finalidade: "venda" | "locacao";
  tipos: ImovelTipo[];
  cidades: string[];
  bairros: string[];
  valor_min: number | null;
  valor_max: number | null;
  quartos_min: number | null;
  vagas_min: number | null;
  area_min: number | null;
  observacao: string | null;
}

export interface ImovelCard {
  id: string;
  codigo: string;
  titulo: string;
  tipo: ImovelTipo;
  finalidade: string;
  status: string;
  bairro: string | null;
  cidade: string;
  quartos: number;
  suites: number;
  vagas: number;
  area_util: number | null;
  valor: number | null;
  foto_url: string | null;
}

export interface Compativel {
  imovel: ImovelCard;
  score: number;
  motivos: string[];
  alertas: string[];
  enviado_em: string | null;
  reacao: Reacao | null;
}

export type Reacao = "gostei" | "nao_gostei" | "quero_visitar";

export const REACAO: Record<Reacao, { rotulo: string; cor: string }> = {
  gostei: { rotulo: "Gostou", cor: "text-hoje" },
  quero_visitar: { rotulo: "Quer visitar", cor: "text-primary" },
  nao_gostei: { rotulo: "Descartou", cor: "text-muted-foreground" },
};

export interface Vitrine {
  id: string;
  negocio_id: string;
  imovel_ids: string[];
  mensagem: string | null;
  criado_por_nome: string | null;
  criado_em: string;
  visualizada_em: string | null;
  reacoes: { imovel_id: string; reacao: Reacao; comentario: string | null; em: string }[];
  ativa: boolean;
  token: string | null;
}

export interface Interessado {
  negocio_id: string;
  nome: string;
  cliente_nome: string | null;
  corretor_nome: string | null;
  score: number;
  motivos: string[];
  alertas: string[];
}

// ---------------------------------------------------------------- propostas

export type FormaPagamento = "avista" | "financiamento" | "fgts" | "permuta" | "parcelado" | "consorcio";

export const FORMAS_PAGAMENTO: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: "avista", rotulo: "À vista" },
  { valor: "financiamento", rotulo: "Financiamento" },
  { valor: "fgts", rotulo: "FGTS" },
  { valor: "permuta", rotulo: "Permuta" },
  { valor: "parcelado", rotulo: "Parcelado direto" },
  { valor: "consorcio", rotulo: "Consórcio" },
];

export type StatusProposta = "enviada" | "aceita" | "recusada" | "contraproposta" | "expirada" | "cancelada";

export const STATUS_PROPOSTA: Record<StatusProposta, { rotulo: string; classe: string }> = {
  enviada: { rotulo: "Aguardando resposta", classe: "bg-sem-atividade/15 text-[#8a5a00] dark:text-sem-atividade" },
  aceita: { rotulo: "Aceita", classe: "bg-hoje/15 text-hoje" },
  recusada: { rotulo: "Recusada", classe: "bg-atrasada/10 text-atrasada" },
  contraproposta: { rotulo: "Contraproposta", classe: "bg-primary/10 text-primary" },
  expirada: { rotulo: "Expirada", classe: "bg-muted text-muted-foreground" },
  cancelada: { rotulo: "Cancelada", classe: "bg-muted text-muted-foreground" },
};

export interface Proposta {
  id: string;
  numero: string;
  negocio_id: string;
  imovel_id: string | null;
  imovel_titulo: string | null;
  tipo: "proposta" | "contraproposta";
  autor: "cliente" | "proprietario";
  valor: number;
  formas_pagamento: FormaPagamento[];
  sinal: number | null;
  valor_financiado: number | null;
  condicoes: string | null;
  validade: string | null;
  status: StatusProposta;
  parent_id: string | null;
  observacao_resposta: string | null;
  respondida_em: string | null;
  criado_por_nome: string | null;
  created_at: string;
  valor_pedido: number | null;
  desconto_pct: number | null;
}

// ---------------------------------------------------------------- fotos e portais

export interface FotoImovel {
  id: string;
  url: string;
  ordem: number;
  tamanho: number;
}

export interface PortaisConfig {
  liberado: boolean;
  feed_url: string | null;
  leads_url: string | null;
  publicados: number;
  prontos: number;
  carteira: number;
  pendencias: { imovel_id: string; codigo: string; titulo: string; faltando: string[]; bloqueia: boolean }[];
  feed_acessado_em: string | null;
  leads_30d: number;
  aviso: string | null;
}

/** Endereço completo para copiar/colar fora do sistema (os links públicos são relativos ao domínio). */
export function urlCompleta(caminho: string | null | undefined): string {
  if (!caminho) return "";
  return caminho.startsWith("http") ? caminho : `${window.location.origin}${caminho}`;
}

/** Reduz a foto no navegador (lado maior 1600 px, JPEG 82%) antes de enviar. */
export async function reduzirFoto(arquivo: File, lado = 1600): Promise<File> {
  if (!arquivo.type.startsWith("image/")) return arquivo;
  const bitmap = await createImageBitmap(arquivo).catch(() => null);
  if (!bitmap) return arquivo;
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
  if (!blob) return arquivo;
  return new File([blob], arquivo.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** Tempo legível a partir de minutos ("12 min", "3 h 05", "2 d"). */
export function duracaoCurta(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")}`;
  return `${Math.round(min / 60 / 24)} d`;
}
