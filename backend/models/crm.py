"""CRM estilo Pipedrive — funis configuráveis, caixa de entrada de leads, atividades e histórico."""

from datetime import datetime
from typing import List, Literal

from pydantic import BaseModel, Field

from models.common import new_id, now_utc
from models.validated import ISODate, ISOTime, Nonnegative

TipoAtividade = Literal["ligacao", "whatsapp", "email", "reuniao", "visita", "tarefa", "prazo", "almoco"]
TIPOS_ATIVIDADE = ["ligacao", "whatsapp", "email", "reuniao", "visita", "tarefa", "prazo", "almoco"]


# ------------------------------------------------------------------ funis e etapas


class Etapa(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = Field(min_length=1, max_length=80)
    probabilidade: int = Field(default=20, ge=0, le=100)
    dias_parado: int | None = Field(default=None, ge=1, le=365)  # "rotting": alerta após N dias
    cor: str | None = None


class Funil(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = Field(min_length=1, max_length=80)
    ordem: int = 0
    padrao: bool = False
    etapas: List[Etapa] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=now_utc)


class EtapaInput(BaseModel):
    id: str | None = None
    nome: str = Field(min_length=1, max_length=80)
    probabilidade: int = Field(default=20, ge=0, le=100)
    dias_parado: int | None = Field(default=None, ge=1, le=365)
    cor: str | None = None


class FunilInput(BaseModel):
    nome: str = Field(min_length=1, max_length=80)
    padrao: bool = False
    etapas: List[EtapaInput] = Field(min_length=1, max_length=20)


# ------------------------------------------------------------------ automações


GatilhoAutomacao = Literal["lead_novo", "entrou_etapa", "negocio_parado", "negocio_ganho", "negocio_perdido"]


class Automacao(BaseModel):
    """Regra "quando X acontecer, crie a atividade Y para o responsável em N dias"."""

    id: str = Field(default_factory=new_id)
    nome: str = Field(min_length=1, max_length=120)
    ativo: bool = True
    gatilho: GatilhoAutomacao
    funil_id: str | None = None  # None = qualquer funil
    etapa_id: str | None = None  # obrigatório para "entrou_etapa"
    tipo_atividade: TipoAtividade = "tarefa"
    assunto: str = Field(min_length=1, max_length=300)
    prazo_dias: int = Field(default=0, ge=0, le=365)
    notas: str | None = Field(default=None, max_length=2000)


# ------------------------------------------------------------------ configuração do CRM


class CrmConfig(BaseModel):
    origens: List[str] = Field(default_factory=list)
    motivos_perda: List[str] = Field(default_factory=list)
    etiquetas: List[str] = Field(default_factory=list)
    distribuicao: Literal["manual", "rodizio"] = "manual"
    exige_motivo_perda: bool = True
    sla_primeiro_contato_min: int | None = Field(default=30, ge=1, le=10080)  # None = sem SLA
    automacoes: List[Automacao] = Field(default_factory=list)
    automacoes_iniciadas: bool = False


class CrmConfigUpdate(BaseModel):
    origens: List[str] | None = None
    motivos_perda: List[str] | None = None
    etiquetas: List[str] | None = None
    distribuicao: Literal["manual", "rodizio"] | None = None
    exige_motivo_perda: bool | None = None
    sla_primeiro_contato_min: int | None = Field(default=None, ge=1, le=10080)
    sem_sla: bool | None = None  # true = desliga o SLA (None no campo acima significa "não alterar")
    automacoes: List[Automacao] | None = Field(default=None, max_length=50)


# ------------------------------------------------------------------ caixa de entrada (leads)


class Entrada(BaseModel):
    """Lead ainda não qualificado (Pipedrive: Leads Inbox). Vira negócio ao ser convertido."""

    id: str = Field(default_factory=new_id)
    nome: str = Field(min_length=1, max_length=200)
    telefone: str | None = None
    email: str | None = None
    origem: str = "Manual"
    interesse: Literal["compra", "locacao", "venda", "outro"] = "compra"
    mensagem: str | None = None
    imovel_id: str | None = None
    veiculo_id: str | None = None
    cliente_id: str | None = None
    corretor_id: str | None = None
    valor_estimado: Nonnegative | None = None
    etiquetas: List[str] = Field(default_factory=list)
    status: Literal["novo", "em_contato", "convertido", "descartado"] = "novo"
    negocio_id: str | None = None
    motivo_descarte: str | None = None
    primeiro_contato_em: datetime | None = None  # base do SLA de primeiro atendimento
    portal_lead_id: str | None = None  # id do lead no portal (evita duplicar em reenvios)
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class EntradaCreate(BaseModel):
    nome: str = Field(min_length=1, max_length=200)
    telefone: str | None = None
    email: str | None = None
    origem: str = "Manual"
    interesse: Literal["compra", "locacao", "venda", "outro"] = "compra"
    mensagem: str | None = None
    imovel_id: str | None = None
    corretor_id: str | None = None
    valor_estimado: Nonnegative | None = None
    etiquetas: List[str] = Field(default_factory=list)


class EntradaUpdate(BaseModel):
    nome: str | None = None
    telefone: str | None = None
    email: str | None = None
    origem: str | None = None
    interesse: Literal["compra", "locacao", "venda", "outro"] | None = None
    mensagem: str | None = None
    imovel_id: str | None = None
    corretor_id: str | None = None
    valor_estimado: Nonnegative | None = None
    etiquetas: List[str] | None = None
    status: Literal["novo", "em_contato", "descartado"] | None = None
    motivo_descarte: str | None = None


class ConverterEntrada(BaseModel):
    funil_id: str | None = None
    etapa_id: str | None = None
    titulo: str | None = None
    valor_estimado: Nonnegative | None = None
    corretor_id: str | None = None


# ------------------------------------------------------------------ atividades


class Atividade(BaseModel):
    id: str = Field(default_factory=new_id)
    tipo: TipoAtividade = "tarefa"
    assunto: str = Field(min_length=1, max_length=300)
    data: ISODate
    hora: ISOTime | None = None  # sem hora = atividade do dia
    duracao_min: int = Field(default=30, ge=5, le=1440)
    negocio_id: str | None = None
    entrada_id: str | None = None
    pessoa_id: str | None = None
    imovel_id: str | None = None
    corretor_id: str | None = None  # dono (pessoa_id do corretor)
    notas: str | None = None
    concluida: bool = False
    concluida_em: datetime | None = None
    created_by: str | None = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class AtividadeCreate(BaseModel):
    tipo: TipoAtividade = "tarefa"
    assunto: str = Field(min_length=1, max_length=300)
    data: ISODate
    hora: ISOTime | None = None
    duracao_min: int = Field(default=30, ge=5, le=1440)
    negocio_id: str | None = None
    entrada_id: str | None = None
    pessoa_id: str | None = None
    imovel_id: str | None = None
    corretor_id: str | None = None
    notas: str | None = None
    concluida: bool = False


class AtividadeUpdate(BaseModel):
    tipo: TipoAtividade | None = None
    assunto: str | None = Field(default=None, min_length=1, max_length=300)
    data: ISODate | None = None
    hora: ISOTime | None = None
    duracao_min: int | None = Field(default=None, ge=5, le=1440)
    negocio_id: str | None = None
    pessoa_id: str | None = None
    imovel_id: str | None = None
    corretor_id: str | None = None
    notas: str | None = None
    concluida: bool | None = None


# ------------------------------------------------------------------ histórico / notas


class EventoHistorico(BaseModel):
    id: str = Field(default_factory=new_id)
    negocio_id: str
    tipo: Literal["criado", "etapa", "status", "nota", "atividade", "campo", "contrato", "visita", "assinatura",
                  "proposta", "vitrine", "match", "automacao", "documento"]
    texto: str
    autor: str | None = None
    autor_id: str | None = None
    fixado: bool = False
    em: datetime = Field(default_factory=now_utc)


class NotaInput(BaseModel):
    texto: str = Field(min_length=1, max_length=5000)
    fixado: bool = False


class MoverInput(BaseModel):
    etapa_id: str
    funil_id: str | None = None


class PerderInput(BaseModel):
    motivo: str | None = Field(default=None, max_length=300)


# ------------------------------------------------------------------ equipe / busca


class MembroEquipe(BaseModel):
    usuario_id: str
    pessoa_id: str | None = None
    nome: str
    email: str | None = None
    papel: str
    telefone: str | None = None
    cargo: str | None = None
    cor: str | None = None
    tem_foto: bool = False
    foto_v: int = 0
    ativo: bool = True
    negocios_abertos: int = 0
    valor_aberto: float = 0
    ganhos_mes: int = 0
    valor_ganho_mes: float = 0
    atividades_hoje: int = 0
    atividades_atrasadas: int = 0
    visitas_semana: int = 0


class ResultadoBusca(BaseModel):
    tipo: Literal["negocio", "pessoa", "imovel", "entrada", "contrato"]
    id: str
    titulo: str
    subtitulo: str | None = None


class NegocioResumo(BaseModel):
    """Card do kanban: o negócio + nomes resolvidos + situação da próxima atividade."""

    id: str
    nome: str
    valor_estimado: float | None = None
    funil_id: str | None = None
    etapa_id: str | None = None
    status: str
    estagio: str
    cliente_id: str | None = None
    cliente_nome: str | None = None
    cliente_telefone: str | None = None
    imovel_id: str | None = None
    imovel_titulo: str | None = None
    imovel_codigo: str | None = None
    corretor_id: str | None = None
    corretor_nome: str | None = None
    corretor_usuario_id: str | None = None
    corretor_tem_foto: bool = False
    corretor_cor: str | None = None
    origem: str | None = None
    etiquetas: List[str] = Field(default_factory=list)
    previsao_fechamento: str | None = None
    etapa_desde: datetime | None = None
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None = None
    motivo_perda: str | None = None
    proxima_atividade: str | None = None  # data YYYY-MM-DD
    proxima_atividade_assunto: str | None = None
    proxima_atividade_tipo: str | None = None
    situacao_atividade: Literal["atrasada", "hoje", "futura", "nenhuma"] = "nenhuma"
    parado: bool = False
    contrato_id: str | None = None
