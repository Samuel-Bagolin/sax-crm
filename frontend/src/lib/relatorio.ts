// Espelho de backend/routers/relatorios.py
export interface Relatorio {
  inicio: string | null;
  fim: string | null;
  funil_id: string;
  funil_nome: string;
  leads_recebidos: number;
  leads_convertidos: number;
  criados: number;
  ganhos_coorte: number;
  conversao: number | null;
  ganhos: number;
  valor_ganho: number;
  ticket_medio: number | null;
  perdidos: number;
  ciclo_medio_dias: number | null;
  abertos: number;
  valor_aberto: number;
  valor_ponderado: number;
  funil: { id: string; nome: string; alcancaram: number; taxa_do_anterior: number | null; taxa_do_total: number | null }[];
  motivos_perda: { rotulo: string; qtd: number; valor: number }[];
  origens: { rotulo: string; qtd: number; valor: number }[];
  responsaveis: {
    pessoa_id: string | null;
    nome: string;
    criados: number;
    ganhos: number;
    perdidos: number;
    valor_ganho: number;
    conversao: number | null;
    atividades_feitas: number;
    abertos: number;
  }[];
  tempo_lead_negocio_horas: number | null;
  serie_mensal: { mes: string; criados: number; ganhos: number; valor: number }[];
}

