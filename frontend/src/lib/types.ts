// Espelho manual dos modelos Pydantic (backend/models) — manter em sincronia a cada edição.
// Nada infere através da fronteira HTTP: cada interface aqui é a declaração do contrato.

export type Papel = "cliente" | "corretor" | "proprietario";
export type ImovelTipo = "apartamento" | "casa" | "terreno" | "comercial";
export type ImovelFinalidade = "venda" | "locacao" | "ambos";
export type ImovelStatus = "captado" | "publicado" | "vendido" | "alugado";
export type LeadEstagio = "novo" | "atendimento" | "visita" | "proposta" | "ganho" | "perdido";
export type PlanoTipo = "receita" | "despesa";
export type TransacaoTipo = "receber" | "pagar";
export type TransacaoStatus = "pendente" | "pago" | "cancelado";

export interface Pessoa {
  id: string;
  nome: string;
  papeis: Papel[];
  cpf_cnpj: string | null;
  telefone: string | null;
  email: string | null;
  created_at: string;
}

export interface Imovel {
  id: string;
  codigo: string;
  titulo: string;
  tipo: ImovelTipo;
  finalidade: ImovelFinalidade;
  status: ImovelStatus;
  endereco: string;
  bairro: string | null;
  cidade: string;
  estado: string | null;
  cep: string | null;
  area_util: number | null;
  area_total: number | null;
  quartos: number;
  suites: number;
  vagas: number;
  valor_venda: number | null;
  valor_aluguel: number | null;
  iptu: number | null;
  condominio: number | null;
  proprietario_id: string | null;
  descricao: string | null;
  foto_url: string | null;
  banheiros: number;
  publicar_portais: boolean;
  destaque_portal: "STANDARD" | "PREMIUM" | "SUPER_PREMIUM";
  created_at: string;
  updated_at: string;
}

export type StatusNegocio = "aberto" | "ganho" | "perdido";

export interface Lead {
  id: string;
  nome: string;
  cliente_id: string | null;
  imovel_id: string | null;
  corretor_id: string | null;
  origem: string;
  estagio: LeadEstagio;
  valor_estimado: number | null;
  observacoes: string | null;
  funil_id: string | null;
  etapa_id: string | null;
  status: StatusNegocio;
  etapa_desde: string | null;
  motivo_perda: string | null;
  previsao_fechamento: string | null;
  etiquetas: string[];
  entrada_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface OrigemCount {
  origem: string;
  total: number;
}

export interface LeadMetricas {
  total_leads: number;
  leads_abertos: number;
  tempo_medio_fechamento_dias: number | null;
  taxa_conversao: number | null;
  por_estagio: Record<string, number>;
  origens: OrigemCount[];
  valor_aberto: number;
  valor_ponderado: number;
  ganhos_valor: number;
  ganhos_mes: number;
  perdidos_mes: number;
  motivos_perda: OrigemCount[];
}

export interface PlanoConta {
  id: string;
  codigo: string;
  nome: string;
  tipo: PlanoTipo;
  conta_pai_id: string | null;
  created_at: string;
}

export interface TransacaoFinanceira {
  id: string;
  descricao: string;
  tipo: TransacaoTipo;
  valor: number;
  plano_conta_id: string;
  imovel_id: string | null;
  pessoa_id: string | null;
  corretor_id: string | null;
  contrato_id: string | null;
  vencimento: string; // YYYY-MM-DD
  pagamento: string | null; // YYYY-MM-DD quando realizado
  status: TransacaoStatus;
  vencido: boolean; // derivado no servidor
  created_at: string;
}

// --- Identidade e perfis (espelho de backend/lib/auth.py e models/usuarios.py) ---

export interface Empresa {
  id: string;
  nome: string;
  slug: string;
  db_name: string;
  cnpj: string | null;
  plano: string;
  ativo: boolean;
  modulos: string[];
  site_api_key: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmpresaResumo extends Empresa {
  plano_aplicado: boolean;
  plano_nome: string | null;
  plano_preco: number | null;
  limite_usuarios: number | null;
  limite_imoveis: number | null;
  usuarios_ativos: number;
  imoveis_carteira: number;
  usuarios: number;
  imoveis: number;
  leads: number;
  contratos: number;
  convite_enviado: boolean;
}

export interface UsoEmpresa {
  empresa_id: string;
  nome: string;
  slug: string;
  plano: string;
  ativo: boolean;
  criada_em: string;
  ultimo_acesso: string | null;
  usuarios: number;
  usuarios_ativos: number;
  corretores: number;
  imoveis: number;
  imoveis_publicados: number;
  leads: number;
  leads_30d: number;
  contratos: number;
  contratos_ativos: number;
  visitas: number;
  transacoes: number;
  receita_contratada: number;
  armazenamento_mb: number;
}

export interface Ambiente {
  ambiente: string;
  producao: boolean;
  rotulo: string;
  empresas_ativas: number;
}

export type Papel2 = "sysadmin" | "admin" | "corretor";

export interface ConfiguracaoPublica {
  nome_software: string;
  slogan: string;
  modulos_ativos: string[];
  titulos_modulos: Record<string, string>;
  cor_painel: string;
  cor_fonte: string;
  cor_primaria: string;
  imagem_fundo_login: string | null;
  tem_logo: boolean;
}

export interface ConfigLog {
  id: string;
  campo: string;
  de: string | null;
  para: string | null;
  usuario: string;
  em: string;
}

export interface Configuracao extends ConfiguracaoPublica {
  id: string;
  email_remetente_nome: string;
  email_resposta: string | null;
  whatsapp_numero: string | null;
  whatsapp_phone_id: string | null;
  whatsapp_token: string | null;
  site_url: string | null;
  site_api_key: string | null;
  site_webhook_ativo: boolean;
  logo_mime: string | null;
  atualizado_em: string;
  atualizado_por: string | null;
}

export interface Principal {
  usuario_id: string;
  nome: string;
  email: string;
  papel: Papel2;
  pessoa_id: string | null;
  empresa_id: string | null;
  empresa_nome: string | null;
  suporte: boolean;
  ambiente: string;
  tem_foto: boolean;
  foto_v: number;
  telefone: string | null;
}

export interface UsuarioPublico {
  id: string;
  nome: string;
  email: string;
  papel: Papel2;
  pessoa_id: string | null;
  ativo: boolean;
  telefone: string | null;
  cargo: string | null;
  creci: string | null;
  cor: string | null;
  tem_foto: boolean;
  foto_v: number;
  created_at: string;
}

export interface MinhasComissoes {
  comissoes_recebidas: number;
  comissoes_a_receber: number;
  total_leads: number;
  leads_ganhos: number;
}

export interface FluxoMes {
  mes: string; // YYYY-MM
  receitas: number;
  despesas: number;
  saldo: number;
}

export interface DreImovel {
  imovel_id: string;
  titulo: string;
  receitas: number;
  despesas: number;
  resultado: number;
  a_receber: number;
  a_pagar: number;
}

export interface ResumoFinanceiro {
  a_receber_pendente: number;
  a_pagar_pendente: number;
  recebido_mes: number;
  pago_mes: number;
  fluxo_mensal: FluxoMes[];
  dre_imoveis: DreImovel[];
}

// --- Agenda de visitas (espelho de backend/models/agenda.py) ---

export type VisitaStatus = "agendada" | "realizada" | "cancelada";

export interface Visita {
  id: string;
  titulo: string;
  data: string; // YYYY-MM-DD
  hora: string; // HH:MM
  duracao_min: number;
  lead_id: string | null;
  imovel_id: string | null;
  cliente_id: string | null;
  corretor_id: string | null;
  local: string | null;
  observacoes: string | null;
  feedback_proprietario: string | null;
  status: VisitaStatus;
  lembrete_enviado_em: string | null;
  lembrete_cliente_em: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvisoVisitas {
  amanha: string;
  total_amanha: number;
  total_hoje: number;
  visitas_amanha: Visita[];
  visitas_hoje: Visita[];
}

export interface LembreteResultado {
  data_alvo: string;
  visitas_encontradas: number;
  emails_enviados: number;
  detalhes: string[];
}

export interface ContratoBase {
  financeiro_status: string;
  id: string;
  numero: string;
  tipo: ContratoTipo;
  lead_id: string | null;
  imovel_id: string;
  cliente_id: string | null;
  proprietario_id: string | null;
  corretor_id: string | null;
  valor: number;
  comissao_pct: number;
  taxa_admin_pct: number;
  inicio: string;
  fim: string | null;
  parcelas: number;
  dia_vencimento: number;
  status: ContratoStatus;
  assinatura_status: AssinaturaStatus;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export type AssinaturaStatus = "rascunho" | "aguardando" | "assinado" | "recusado";

export type ContratoTipo = "venda" | "locacao";
export type ContratoStatus = "ativo" | "encerrado" | "cancelado";

export interface ContratoDetalhe extends ContratoBase {
  imovel_titulo: string | null;
  cliente_nome: string | null;
  proprietario_nome: string | null;
  corretor_nome: string | null;
  total_gerado: number;
  total_recebido: number;
  transacoes: TransacaoFinanceira[];
}

export interface ContratoVigente {
  id: string;
  numero: string;
  tipo: ContratoTipo;
  valor: number;
  inicio: string;
  fim: string | null;
  parcelas: number;
  cliente_nome: string | null;
  corretor_nome: string | null;
  total_gerado: number;
  total_recebido: number;
  parcelas_pagas: number;
}

export interface ImovelDetalhe extends Imovel {
  proprietario: Pessoa | null;
  transacoes: TransacaoFinanceira[];
  leads: Lead[];
  contrato_vigente: ContratoVigente | null;
  rendimento_recebido: number;
  rendimento_a_receber: number;
  despesas_pagas: number;
}

// --- CRM estilo Pipedrive (espelho de backend/models/crm.py e assinaturas.py) ---

export interface Etapa {
  id: string;
  nome: string;
  probabilidade: number;
  dias_parado: number | null;
  cor: string | null;
}

export interface Funil {
  id: string;
  nome: string;
  ordem: number;
  padrao: boolean;
  etapas: Etapa[];
  created_at: string;
}

export interface CrmConfig {
  origens: string[];
  motivos_perda: string[];
  etiquetas: string[];
  distribuicao: "manual" | "rodizio";
  exige_motivo_perda: boolean;
  sla_primeiro_contato_min: number | null;
  automacoes: Automacao[];
}

export type GatilhoAutomacao = "lead_novo" | "entrou_etapa" | "negocio_parado" | "negocio_ganho" | "negocio_perdido";

export interface Automacao {
  id: string;
  nome: string;
  ativo: boolean;
  gatilho: GatilhoAutomacao;
  funil_id: string | null;
  etapa_id: string | null;
  tipo_atividade: TipoAtividade;
  assunto: string;
  prazo_dias: number;
  notas: string | null;
}

export type SituacaoAtividade = "atrasada" | "hoje" | "futura" | "nenhuma";

export interface NegocioResumo {
  id: string;
  nome: string;
  valor_estimado: number | null;
  funil_id: string | null;
  etapa_id: string | null;
  status: StatusNegocio;
  estagio: LeadEstagio;
  cliente_id: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  imovel_id: string | null;
  imovel_titulo: string | null;
  imovel_codigo: string | null;
  corretor_id: string | null;
  corretor_nome: string | null;
  corretor_usuario_id: string | null;
  corretor_tem_foto: boolean;
  corretor_cor: string | null;
  origem: string | null;
  etiquetas: string[];
  previsao_fechamento: string | null;
  etapa_desde: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  motivo_perda: string | null;
  proxima_atividade: string | null;
  proxima_atividade_assunto: string | null;
  proxima_atividade_tipo: TipoAtividade | null;
  situacao_atividade: SituacaoAtividade;
  parado: boolean;
  contrato_id: string | null;
}

export interface NegocioDetalhe {
  negocio: Lead;
  resumo: NegocioResumo;
  cliente: Pessoa | null;
  funil_nome: string | null;
  etapas: { id: string; nome: string; probabilidade: number; dias_parado: number | null }[];
}

export type InteresseEntrada = "compra" | "locacao" | "venda" | "outro";
export type StatusEntrada = "novo" | "em_contato" | "convertido" | "descartado";

export interface Entrada {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  origem: string;
  interesse: InteresseEntrada;
  mensagem: string | null;
  imovel_id: string | null;
  cliente_id: string | null;
  corretor_id: string | null;
  valor_estimado: number | null;
  etiquetas: string[];
  status: StatusEntrada;
  negocio_id: string | null;
  motivo_descarte: string | null;
  primeiro_contato_em: string | null;
  portal_lead_id: string | null;
  created_at: string;
  updated_at: string;
}

export type TipoAtividade = "ligacao" | "whatsapp" | "email" | "reuniao" | "visita" | "tarefa" | "prazo" | "almoco";

export interface Atividade {
  id: string;
  tipo: TipoAtividade;
  assunto: string;
  data: string;
  hora: string | null;
  duracao_min: number;
  negocio_id: string | null;
  entrada_id: string | null;
  pessoa_id: string | null;
  imovel_id: string | null;
  corretor_id: string | null;
  notas: string | null;
  concluida: boolean;
  concluida_em: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventoHistorico {
  id: string;
  negocio_id: string;
  tipo:
    | "criado"
    | "etapa"
    | "status"
    | "nota"
    | "atividade"
    | "campo"
    | "contrato"
    | "visita"
    | "assinatura"
    | "proposta"
    | "vitrine"
    | "match"
    | "automacao"
    | "documento";
  texto: string;
  autor: string | null;
  autor_id: string | null;
  fixado: boolean;
  em: string;
}

export interface MembroEquipe {
  usuario_id: string;
  pessoa_id: string | null;
  nome: string;
  email: string | null;
  papel: Papel2;
  telefone: string | null;
  cargo: string | null;
  cor: string | null;
  tem_foto: boolean;
  foto_v: number;
  ativo: boolean;
  negocios_abertos: number;
  valor_aberto: number;
  ganhos_mes: number;
  valor_ganho_mes: number;
  atividades_hoje: number;
  atividades_atrasadas: number;
  visitas_semana: number;
}

export interface ResultadoBusca {
  tipo: "negocio" | "pessoa" | "imovel" | "entrada" | "contrato";
  id: string;
  titulo: string;
  subtitulo: string | null;
}

export type PapelSignatario = "comprador" | "vendedor" | "locatario" | "locador" | "fiador" | "testemunha" | "imobiliaria" | "corretor" | "outro";

export interface Signatario {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  cpf: string | null;
  papel: PapelSignatario;
  token: string | null;
  status: "pendente" | "visualizado" | "assinado" | "recusado";
  visualizado_em: string | null;
  assinado_em: string | null;
  recusado_em: string | null;
  motivo_recusa: string | null;
  ip: string | null;
  user_agent: string | null;
  nome_assinado: string | null;
  cpf_informado: string | null;
  assinatura_tipo: "desenho" | "digitada" | null;
  tem_assinatura: boolean;
  enviado_em: string | null;
}

export interface DocumentoContrato {
  titulo: string;
  texto: string;
  hash: string | null;
  modelo_id: string | null;
  atualizado_em: string | null;
}

export interface PainelAssinatura {
  contrato_id: string;
  numero: string;
  status: AssinaturaStatus;
  documento: DocumentoContrato | null;
  signatarios: Signatario[];
  eventos: { em: string; texto: string; ip: string | null }[];
  bloqueado: boolean;
}

export interface DocumentoPublico {
  empresa_nome: string;
  cor_primaria: string;
  tem_logo: boolean;
  empresa_slug: string | null;
  contrato_numero: string;
  titulo: string;
  texto: string;
  hash: string;
  signatario: Signatario;
  signatarios: { nome: string; papel: string; status: string; assinado_em: string | null }[];
  concluido: boolean;
}

export interface ModeloContrato {
  id: string;
  nome: string;
  tipo: "venda" | "locacao" | "outro";
  texto: string;
  created_at: string;
  updated_at: string;
}
