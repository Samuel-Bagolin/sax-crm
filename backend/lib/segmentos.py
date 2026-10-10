"""Segmentos atendidos pelo SAX CRM.

Cada empresa pertence a um segmento (`controle.empresas.segmento`). O segmento decide:
- os módulos que a empresa recebe e o menu que ela vê;
- o vocabulário da tela (cliente ou paciente, corretor ou barbeiro, imóvel ou veículo);
- o funil, as origens de lead e os motivos de perda criados no provisionamento;
- o catálogo de planos que aparece no cadastro e na tela de Planos.

Empresas criadas antes dos segmentos são imobiliárias. Nada aqui muda dados existentes.
"""

from __future__ import annotations

CATEGORIAS: dict[str, str] = {
    "vendas": "Vendas e estoque",
    "saude": "Saúde",
    "beleza": "Beleza e bem-estar",
}

# Módulos (áreas do menu). Os antigos continuam com o mesmo nome.
MODULOS_TODOS = [
    "dashboard", "imoveis", "veiculos", "atendimentos", "pacientes", "crm", "agenda",
    "contratos", "financeiro", "usuarios",
]

_FUNIL_IMOB = [
    ("Vendas", True, [("Novo contato", 10, 3), ("Em atendimento", 25, 5), ("Visita agendada", 45, 7),
                      ("Proposta enviada", 70, 7), ("Negociação e documentação", 85, 10)]),
    ("Locação", False, [("Novo contato", 10, 2), ("Qualificação", 30, 3), ("Visita", 50, 5),
                        ("Análise cadastral / garantia", 75, 5), ("Contrato", 90, 5)]),
]

SEGMENTOS: dict[str, dict] = {
    "imobiliaria": {
        "nome": "Imobiliária",
        "categoria": "vendas",
        "descricao": "Imóveis, funil de vendas e locação, portais, site e contratos.",
        "modulos": ["dashboard", "imoveis", "crm", "agenda", "contratos", "financeiro", "usuarios"],
        "termos": {"cliente": "Cliente", "clientes": "Clientes", "profissional": "Corretor", "profissionais": "Corretores",
                   "item": "Imóvel", "itens": "Imóveis", "unidade": "Unidade", "unidades": "Unidades",
                   "atendimento": "Visita", "atendimentos": "Visitas"},
        "funis": _FUNIL_IMOB,
        "origens": ["Site", "WhatsApp", "Portal ZAP", "VivaReal", "OLX", "Instagram / Facebook Ads",
                    "Indicação / Carteira", "Placa no Local", "Telefone"],
        "motivos_perda": ["Preço acima do orçamento", "Comprou com outra imobiliária", "Financiamento não aprovado",
                          "Desistiu da operação", "Sem retorno do cliente", "Imóvel indisponível", "Documentação pendente"],
        "etiquetas": ["Quente", "Investidor", "Primeiro imóvel", "Permuta", "Financiamento", "À vista"],
    },
    "veiculos": {
        "nome": "Loja de veículos",
        "categoria": "vendas",
        "descricao": "Estoque com custo e margem, site da loja, leads e funil de vendas.",
        "modulos": ["dashboard", "veiculos", "crm", "agenda", "contratos", "financeiro", "usuarios"],
        "termos": {"cliente": "Cliente", "clientes": "Clientes", "profissional": "Vendedor", "profissionais": "Vendedores",
                   "item": "Veículo", "itens": "Veículos", "unidade": "Loja", "unidades": "Lojas",
                   "atendimento": "Test drive", "atendimentos": "Test drives"},
        "funis": [("Vendas", True, [("Novo lead", 10, 1), ("Em atendimento", 25, 2), ("Test drive / visita", 45, 3),
                                    ("Proposta e avaliação da troca", 65, 4), ("Financiamento e documentação", 85, 5)])],
        "origens": ["Site", "WhatsApp", "Webmotors", "OLX", "iCarros", "Mercado Livre", "Instagram / Facebook Ads",
                    "Indicação", "Loja física", "Telefone"],
        "motivos_perda": ["Preço acima do orçamento", "Financiamento recusado", "Comprou em outra loja",
                          "Avaliação da troca abaixo do esperado", "Sem retorno do cliente", "Veículo vendido para outro cliente"],
        "etiquetas": ["Quente", "Tem troca", "Financiamento", "À vista", "Primeiro carro", "Frotista"],
    },
    "odontologia": {
        "nome": "Odontologia",
        "categoria": "saude",
        "descricao": "Agenda por dentista, odontograma 3D, plano de tratamento, orçamento e financeiro.",
        "modulos": ["dashboard", "atendimentos", "pacientes", "crm", "financeiro", "usuarios"],
        "termos": {"cliente": "Paciente", "clientes": "Pacientes", "profissional": "Dentista", "profissionais": "Dentistas",
                   "item": "Procedimento", "itens": "Procedimentos", "unidade": "Clínica", "unidades": "Clínicas",
                   "atendimento": "Consulta", "atendimentos": "Consultas"},
        "funis": [("Orçamentos", True, [("Avaliação agendada", 20, 3), ("Orçamento apresentado", 45, 5),
                                        ("Em negociação", 70, 7), ("Aguardando início", 90, 7)])],
        "origens": ["Agenda online", "WhatsApp", "Instagram / Facebook Ads", "Google", "Indicação de paciente",
                    "Convênio", "Telefone", "Passou na frente"],
        "motivos_perda": ["Valor acima do orçamento", "Fechou com outra clínica", "Vai pensar e não voltou",
                          "Medo ou insegurança", "Sem retorno do paciente", "Crédito não aprovado"],
        "etiquetas": ["Urgência", "Ortodontia", "Implante", "Estética", "Prótese", "Convênio"],
    },
    "terapia": {
        "nome": "Clínica terapêutica",
        "categoria": "saude",
        "descricao": "Psicologia e fonoaudiologia: agenda recorrente, link de agendamento, prontuário e financeiro.",
        "modulos": ["dashboard", "atendimentos", "pacientes", "financeiro", "usuarios"],
        "termos": {"cliente": "Paciente", "clientes": "Pacientes", "profissional": "Terapeuta", "profissionais": "Terapeutas",
                   "item": "Serviço", "itens": "Serviços", "unidade": "Clínica", "unidades": "Clínicas",
                   "atendimento": "Sessão", "atendimentos": "Sessões"},
        "funis": [("Primeiro contato", True, [("Contato recebido", 20, 2), ("Triagem", 40, 3),
                                              ("Avaliação agendada", 70, 5), ("Em decisão", 85, 7)])],
        "origens": ["Agenda online", "WhatsApp", "Indicação", "Instagram", "Google", "Escola", "Médico / encaminhamento", "Convênio"],
        "motivos_perda": ["Valor da sessão", "Horário indisponível", "Escolheu outro profissional", "Sem retorno", "Convênio não aceito"],
        "etiquetas": ["Infantil", "Adulto", "Casal", "Online", "Presencial", "Convênio"],
    },
    "barbearia": {
        "nome": "Barbearia",
        "categoria": "beleza",
        "descricao": "Link de agendamento por barbeiro, agenda do dia, comanda, comissão e retorno do cliente.",
        "modulos": ["dashboard", "atendimentos", "pacientes", "financeiro", "usuarios"],
        "termos": {"cliente": "Cliente", "clientes": "Clientes", "profissional": "Barbeiro", "profissionais": "Barbeiros",
                   "item": "Serviço", "itens": "Serviços", "unidade": "Unidade", "unidades": "Unidades",
                   "atendimento": "Atendimento", "atendimentos": "Atendimentos"},
        "funis": [("Clientes", True, [("Novo cliente", 30, 7), ("Primeiro corte", 60, 30), ("Cliente recorrente", 90, 45)])],
        "origens": ["Agenda online", "WhatsApp", "Instagram", "Indicação", "Passou na frente", "Google"],
        "motivos_perda": ["Mudou de barbearia", "Mudou de cidade", "Preço", "Horário", "Sem retorno"],
        "etiquetas": ["VIP", "Assinante", "Barba", "Infantil", "Pigmentação"],
    },
    "estetica": {
        "nome": "Estética",
        "categoria": "beleza",
        "descricao": "Mapa facial 3D de aplicação, orçamento, agenda online, pacotes e retorno de procedimento.",
        "modulos": ["dashboard", "atendimentos", "pacientes", "crm", "financeiro", "usuarios"],
        "termos": {"cliente": "Cliente", "clientes": "Clientes", "profissional": "Profissional", "profissionais": "Profissionais",
                   "item": "Procedimento", "itens": "Procedimentos", "unidade": "Clínica", "unidades": "Clínicas",
                   "atendimento": "Atendimento", "atendimentos": "Atendimentos"},
        "funis": [("Orçamentos", True, [("Avaliação agendada", 20, 3), ("Orçamento enviado", 45, 4),
                                        ("Em negociação", 70, 5), ("Procedimento agendado", 90, 7)])],
        "origens": ["Agenda online", "WhatsApp", "Instagram", "Indicação", "Google", "Facebook Ads"],
        "motivos_perda": ["Valor acima do esperado", "Fechou em outra clínica", "Medo do procedimento", "Sem retorno", "Vai deixar para depois"],
        "etiquetas": ["Toxina", "Preenchimento", "Bioestimulador", "Corporal", "Pacote", "Retorno"],
    },
}

SEGMENTO_PADRAO = "imobiliaria"

# Segmentos que usam agenda de atendimentos com link público (serviço + profissional + horário).
COM_AGENDA_ONLINE = {"barbearia", "terapia", "odontologia", "estetica"}
# Segmentos com prontuário clínico (dado de saúde, acesso restrito).
COM_PRONTUARIO = {"terapia", "odontologia", "estetica"}


def segmento_de(empresa: dict | None) -> str:
    seg = (empresa or {}).get("segmento") or SEGMENTO_PADRAO
    return seg if seg in SEGMENTOS else SEGMENTO_PADRAO


def info(segmento: str) -> dict:
    s = SEGMENTOS.get(segmento) or SEGMENTOS[SEGMENTO_PADRAO]
    return {
        "chave": segmento if segmento in SEGMENTOS else SEGMENTO_PADRAO,
        "nome": s["nome"],
        "categoria": s["categoria"],
        "categoria_nome": CATEGORIAS[s["categoria"]],
        "descricao": s["descricao"],
        "modulos": list(s["modulos"]),
        "termos": dict(s["termos"]),
        "agenda_online": segmento in COM_AGENDA_ONLINE,
        "prontuario": segmento in COM_PRONTUARIO,
    }


def catalogo_publico() -> list[dict]:
    return [info(k) for k in SEGMENTOS]


# ---------------------------------------------------------------- planos sugeridos por segmento
# Preços de referência levantados em 09/10/2026 nas páginas públicas dos líderes de cada mercado
# (AppBarber, Booksy, PsicoManager, iClinic, Simples Dental, Clinicorp, Belasis, AutoCerto, Revenda Mais).
# O anual sai com 20% de desconto. O administrador de sistema edita tudo na tela de Planos.

_TIERS = ("essencial", "profissional", "business", "enterprise")
_NOME_TIER = {"essencial": "Essencial", "profissional": "Profissional", "business": "Business", "enterprise": "Enterprise"}

PRECOS_SEGMENTO: dict[str, dict] = {
    # segmento: (preços mensais, usuários, itens no estoque, unidades, implantação)
    "veiculos": {"precos": (199, 449, 799, 1499), "usuarios": (2, 5, 10, None), "itens": (50, 100, 250, None),
                 "unidades": (1, 1, 3, None), "implantacao": (0, 499, 999, 2500)},
    "odontologia": {"precos": (129, 249, 399, 799), "usuarios": (2, 5, 10, None), "itens": (None,) * 4,
                    "unidades": (1, 1, 3, None), "implantacao": (0, 0, 499, 1500)},
    "terapia": {"precos": (59, 129, 249, 499), "usuarios": (1, 3, 10, None), "itens": (None,) * 4,
                "unidades": (1, 1, 3, None), "implantacao": (0, 0, 0, 999)},
    "barbearia": {"precos": (79, 149, 249, 499), "usuarios": (1, 5, 15, None), "itens": (None,) * 4,
                  "unidades": (1, 1, 3, None), "implantacao": (0, 0, 0, 999)},
    "estetica": {"precos": (129, 249, 449, 899), "usuarios": (2, 5, 10, None), "itens": (None,) * 4,
                 "unidades": (1, 1, 3, None), "implantacao": (0, 0, 499, 1500)},
}

_RECURSOS_TIER: dict[str, tuple[list[str], ...]] = {
    "veiculos": (["chat", "site"], ["chat", "site", "automacoes", "propostas"],
                 ["chat", "site", "automacoes", "propostas", "assinatura", "google"], None),
    "odontologia": (["chat", "agenda_online", "prontuario", "odontograma"],
                    ["chat", "agenda_online", "prontuario", "odontograma", "automacoes"],
                    ["chat", "agenda_online", "prontuario", "odontograma", "automacoes", "assinatura", "google"], None),
    "terapia": (["chat", "agenda_online", "prontuario"], ["chat", "agenda_online", "prontuario", "automacoes"],
                ["chat", "agenda_online", "prontuario", "automacoes", "assinatura", "google"], None),
    "barbearia": (["chat", "agenda_online"], ["chat", "agenda_online", "automacoes"],
                  ["chat", "agenda_online", "automacoes", "google"], None),
    "estetica": (["chat", "agenda_online", "prontuario", "mapa_facial"],
                 ["chat", "agenda_online", "prontuario", "mapa_facial", "automacoes"],
                 ["chat", "agenda_online", "prontuario", "mapa_facial", "automacoes", "assinatura", "google"], None),
}

_RESUMO_TIER = {
    "veiculos": ("Estoque, site da loja e funil de vendas", "Mais vendedores, automações e propostas",
                 "Até 3 lojas, contratos e assinatura eletrônica", "Lojas e estoque sem limite"),
    "odontologia": ("Agenda, odontograma 3D e orçamentos", "Até 5 profissionais e automações",
                    "Até 3 clínicas, contratos e Google Agenda", "Rede de clínicas sem limite"),
    "terapia": ("1 terapeuta, agenda online e prontuário", "Até 3 terapeutas e lembretes automáticos",
                "Até 10 terapeutas e 3 clínicas", "Clínicas e equipe sem limite"),
    "barbearia": ("1 barbeiro com link de agendamento", "Até 5 barbeiros, comissão e automações",
                  "Até 15 barbeiros e 3 unidades", "Rede e franquia sem limite"),
    "estetica": ("Agenda, mapa facial 3D e orçamentos", "Até 5 profissionais e automações",
                 "Até 3 clínicas, contratos e Google Agenda", "Rede de clínicas sem limite"),
}


def planos_sugeridos(todos_recursos: list[str]) -> dict[str, dict]:
    """Planos de referência dos segmentos novos. A imobiliária mantém os planos originais."""
    saida: dict[str, dict] = {}
    for seg, p in PRECOS_SEGMENTO.items():
        modulos = SEGMENTOS[seg]["modulos"]
        for i, tier in enumerate(_TIERS):
            mensal = p["precos"][i]
            recursos = _RECURSOS_TIER[seg][i]
            saida[f"{seg}_{tier}"] = {
                "nome": _NOME_TIER[tier], "segmento": seg, "preco_mensal": mensal,
                "preco_anual": round(mensal * 12 * 0.8, 2),
                "usuarios": p["usuarios"][i], "imoveis": p["itens"][i], "unidades": p["unidades"][i],
                "implantacao": p["implantacao"][i],
                "modulos": [m for m in modulos if m not in ("contratos",) or i >= 2],
                "recursos": list(todos_recursos) if recursos is None else recursos,
                "ordem": i + 1, "ativo": True, "resumo": _RESUMO_TIER[seg][i],
            }
    return saida


# Preço anual da imobiliária publicado nos folders (valor mensal na contratação anual x 12).
ANUAL_IMOBILIARIA = {"essencial": 899.88, "profissional": 2388.0, "business": 4788.0, "enterprise": 9588.0}
UNIDADES_IMOBILIARIA = {"essencial": 1, "profissional": 1, "business": 3, "enterprise": None}


def titulos_modulos(segmento: str) -> dict[str, str]:
    t = (SEGMENTOS.get(segmento) or SEGMENTOS[SEGMENTO_PADRAO])["termos"]
    return {
        "dashboard": "Visão Geral", "imoveis": "Imóveis", "veiculos": "Veículos", "crm": "CRM & Funil",
        "agenda": "Agenda", "atendimentos": "Agenda", "pacientes": t["clientes"], "contratos": "Contratos",
        "financeiro": "Financeiro", "usuarios": t["profissionais"] if segmento != "imobiliaria" else "Consultores",
    }


_CONTAS_COMUNS_DESPESA = [
    ("2", "Despesas", "despesa", None),
    ("2.1", "Marketing", "despesa", "2"),
    ("2.1.1", "Anúncios e redes sociais", "despesa", "2.1"),
    ("2.2", "Operacional", "despesa", "2"),
    ("2.2.1", "Aluguel", "despesa", "2.2"),
    ("2.2.2", "Água, luz e internet", "despesa", "2.2"),
    ("2.2.3", "Materiais e expediente", "despesa", "2.2"),
    ("2.3", "Pessoal", "despesa", "2"),
    ("2.3.1", "Comissões de profissionais", "despesa", "2.3"),
    ("2.3.2", "Salários e pró-labore", "despesa", "2.3"),
]

PLANO_CONTAS_SEGMENTO: dict[str, list[tuple]] = {
    "veiculos": [
        ("1", "Receitas", "receita", None), ("1.1", "Vendas", "receita", "1"),
        ("1.1.1", "Venda de veículos", "receita", "1.1"), ("1.1.2", "Comissão de financiamento", "receita", "1.1"),
        ("1.1.3", "Despachante e serviços", "receita", "1.1"),
        *_CONTAS_COMUNS_DESPESA,
        ("2.4", "Custo dos veículos", "despesa", "2"), ("2.4.1", "Compra de veículos", "despesa", "2.4"),
        ("2.4.2", "Preparação, funilaria e mecânica", "despesa", "2.4"), ("2.4.3", "Documentação e transferência", "despesa", "2.4"),
    ],
    "_servicos": [
        ("1", "Receitas", "receita", None), ("1.1", "Atendimentos", "receita", "1"),
        ("1.1.1", "Serviços e procedimentos", "receita", "1.1"), ("1.1.2", "Pacotes e planos", "receita", "1.1"),
        ("1.1.3", "Venda de produtos", "receita", "1.1"),
        *_CONTAS_COMUNS_DESPESA,
        ("2.4", "Insumos", "despesa", "2"), ("2.4.1", "Materiais e insumos", "despesa", "2.4"),
        ("2.4.2", "Laboratório e terceiros", "despesa", "2.4"),
    ],
}


def plano_contas(segmento: str) -> list[tuple] | None:
    """Plano de contas do segmento. None = o padrão da imobiliária (lib/tenant.py)."""
    if segmento == "imobiliaria":
        return None
    return PLANO_CONTAS_SEGMENTO.get(segmento) or PLANO_CONTAS_SEGMENTO["_servicos"]


# Serviços de partida para a agenda. Valores de exemplo: o cliente ajusta para a tabela dele.
SERVICOS_PADRAO: dict[str, list[dict]] = {
    "barbearia": [
        {"nome": "Corte", "duracao_min": 30, "preco": 45, "categoria": "Cabelo", "retorno_dias": 30},
        {"nome": "Barba", "duracao_min": 30, "preco": 35, "categoria": "Barba", "retorno_dias": 21},
        {"nome": "Corte e barba", "duracao_min": 60, "preco": 75, "categoria": "Combo", "retorno_dias": 30},
        {"nome": "Pigmentação", "duracao_min": 30, "preco": 40, "categoria": "Cabelo"},
        {"nome": "Sobrancelha", "duracao_min": 15, "preco": 15, "categoria": "Acabamento"},
        {"nome": "Corte infantil", "duracao_min": 30, "preco": 35, "categoria": "Cabelo", "retorno_dias": 30},
    ],
    "terapia": [
        {"nome": "Primeira consulta", "duracao_min": 60, "preco": 200, "categoria": "Avaliação"},
        {"nome": "Sessão de psicoterapia", "duracao_min": 50, "preco": 180, "categoria": "Psicologia"},
        {"nome": "Avaliação fonoaudiológica", "duracao_min": 60, "preco": 220, "categoria": "Fonoaudiologia"},
        {"nome": "Sessão de fonoterapia", "duracao_min": 45, "preco": 160, "categoria": "Fonoaudiologia"},
    ],
    "odontologia": [
        {"nome": "Avaliação", "duracao_min": 30, "preco": 0, "categoria": "Clínico geral"},
        {"nome": "Limpeza (profilaxia)", "duracao_min": 45, "preco": 200, "categoria": "Prevenção", "retorno_dias": 180},
        {"nome": "Restauração em resina", "duracao_min": 60, "preco": 250, "categoria": "Dentística"},
        {"nome": "Tratamento de canal", "duracao_min": 90, "preco": 900, "categoria": "Endodontia"},
        {"nome": "Extração simples", "duracao_min": 45, "preco": 300, "categoria": "Cirurgia"},
        {"nome": "Clareamento", "duracao_min": 60, "preco": 900, "categoria": "Estética"},
        {"nome": "Implante", "duracao_min": 120, "preco": 3500, "categoria": "Implantodontia"},
        {"nome": "Coroa", "duracao_min": 60, "preco": 1500, "categoria": "Prótese"},
        {"nome": "Selante", "duracao_min": 30, "preco": 120, "categoria": "Prevenção"},
    ],
    "estetica": [
        {"nome": "Avaliação", "duracao_min": 30, "preco": 0, "categoria": "Avaliação"},
        {"nome": "Toxina botulínica", "duracao_min": 45, "preco": 18, "categoria": "Injetáveis", "unidade": "U", "retorno_dias": 120},
        {"nome": "Ácido hialurônico", "duracao_min": 60, "preco": 1200, "categoria": "Injetáveis", "unidade": "ml", "retorno_dias": 270},
        {"nome": "Bioestimulador de colágeno", "duracao_min": 60, "preco": 2200, "categoria": "Injetáveis", "unidade": "frasco", "retorno_dias": 120},
        {"nome": "Limpeza de pele", "duracao_min": 60, "preco": 180, "categoria": "Facial", "retorno_dias": 45},
        {"nome": "Peeling", "duracao_min": 45, "preco": 250, "categoria": "Facial"},
    ],
}
