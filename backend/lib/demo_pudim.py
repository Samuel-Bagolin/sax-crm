"""Empresa de demonstração "[DEMO] O Pudim Perfeito" (segmento comércio).

Cria uma empresa separada, com banco próprio, e preenche com dados FICTÍCIOS para apresentação:
lojas em Curitiba, São Paulo e Brasília, equipe por loja, leads do formulário do Meta (revenda e
eventos), negócios nos dois funis, clientes, cardápio no site, lançamentos no financeiro com a
comissão de 7% nos dois primeiros pedidos e um fluxo de boas-vindas no WhatsApp.

Nomes de pessoas, restaurantes, telefones e valores são inventados. Nenhum dado real de cliente.
"""

from __future__ import annotations

import secrets
from datetime import date, timedelta

from lib.db import client, controle, nome_banco_empresa
from lib.auth import hash_senha
from models.common import new_id, now_utc

SLUG = "demo-pudim-perfeito"
NOME = "[DEMO] O Pudim Perfeito"
SLUG_SITE = "pudim-perfeito-demo"
DOMINIO_EMAIL = "pudimdemo.exemplo.com"

LOJAS = [
    ("Loja Curitiba", "Curitiba", True),
    ("Loja São Paulo", "São Paulo", False),
    ("Loja Brasília", "Brasília", False),
]

# nome, e-mail (prefixo), cargo, cidade, cor
EQUIPE = [
    ("Marina Duarte", "marina", "Gerente de Expansão", None, "#7c3aed"),
    ("Caio Fernandes", "caio", "Supervisor de Lojas", "São Paulo", "#2563eb"),
    ("Bianca Rocha", "bianca", "Líder de Loja", "Curitiba", "#db2777"),
    ("Diego Martins", "diego", "Líder de Loja", "Brasília", "#059669"),
]

# restaurante, responsável, cidade
CLIENTES = [
    ("Bistrô Alecrim", "Fernanda Lopes", "Curitiba"),
    ("Café da Praça", "Roberto Nunes", "Curitiba"),
    ("Empório Serra Verde", "Juliana Prado", "Curitiba"),
    ("Cantina Bella Nonna", "Paulo Ricci", "São Paulo"),
    ("Padaria Pão Dourado", "Sandra Melo", "São Paulo"),
    ("Restaurante Sabor da Terra", "André Campos", "São Paulo"),
    ("Café Cerrado", "Lívia Torres", "Brasília"),
    ("Restaurante Ipê Amarelo", "Marcos Vidal", "Brasília"),
]

# (restaurante, cidade, funil, índice da etapa ou "ganho"/"perdido", valor, dias atrás, etiquetas)
NEGOCIOS = [
    ("Bistrô Alecrim", "Curitiba", "rev", "ganho", 1890, 40, ["Revenda", "Recorrente"]),
    ("Café da Praça", "Curitiba", "rev", 4, 1250, 25, ["Revenda"]),
    ("Empório Serra Verde", "Curitiba", "rev", 3, 980, 9, ["Revenda"]),
    ("Lanchonete Ponto Certo", "Curitiba", "rev", 1, 640, 3, ["Revenda"]),
    ("Cantina Bella Nonna", "São Paulo", "rev", "ganho", 2400, 33, ["Revenda", "VIP"]),
    ("Padaria Pão Dourado", "São Paulo", "rev", 2, 1500, 6, ["Revenda"]),
    ("Restaurante Sabor da Terra", "São Paulo", "rev", 0, 900, 1, ["Revenda"]),
    ("Doceria Flor de Sal", "São Paulo", "rev", "perdido", 700, 18, ["Revenda"]),
    ("Café Cerrado", "Brasília", "rev", 3, 1100, 8, ["Revenda"]),
    ("Restaurante Ipê Amarelo", "Brasília", "rev", 1, 1300, 2, ["Revenda"]),
    ("Casamento Ana e Rafael", "Curitiba", "evt", 2, 2800, 12, ["Evento"]),
    ("Confraternização Construtora Horizonte", "São Paulo", "evt", 1, 3600, 4, ["Evento", "Corporativo"]),
    ("Aniversário 15 anos Laura", "Brasília", "evt", 0, 1200, 1, ["Evento"]),
    ("Coffee break Clínica Vida", "Curitiba", "evt", 3, 950, 5, ["Evento", "Corporativo"]),
]

# Leads que acabaram de chegar pelo formulário do Meta (caixa de entrada)
ENTRADAS = [
    ("Rafaela Costa", "Hamburgueria Brasa", "Curitiba", "Revenda", "Quero revender pudim na minha hamburgueria. Qual o pedido mínimo?", 0),
    ("Thiago Moreira", "Café Aroma", "São Paulo", "Revenda", "Tenho uma cafeteria e quero saber valores para revenda.", 0),
    ("Camila Ribeiro", None, "Brasília", "Evento", "Casamento para 120 pessoas em dezembro. Fazem mini pudins?", 1),
    ("Eduardo Pires", "Restaurante Dona Benta", "Curitiba", "Revenda", "Vi o anúncio no Instagram. Como funciona a revenda?", 1),
    ("Patrícia Gomes", None, "São Paulo", "Evento", "Aniversário de empresa, umas 60 pessoas.", 2),
    ("Lucas Almeida", "Mercado Bom Preço", "Brasília", "Revenda", "Quero colocar no balcão de sobremesas do mercado.", 3),
]

CARDAPIO = [
    # nome, descrição, categoria, preço, destaque, ordem
    ("Pudim tradicional (inteiro)", "O clássico de leite condensado, sem furinhos, com calda de caramelo. Serve 10 fatias.", "Pudins inteiros", 89.9, True, 1),
    ("Pudim de doce de leite (inteiro)", "Massa cremosa com doce de leite e calda caramelizada. Serve 10 fatias.", "Pudins inteiros", 99.9, True, 2),
    ("Pudim de chocolate belga (inteiro)", "Feito com chocolate belga 54%. Serve 10 fatias.", "Pudins inteiros", 109.9, False, 3),
    ("Pudim de café (inteiro)", "Leve toque de café coado com calda de caramelo. Serve 10 fatias.", "Pudins inteiros", 99.9, False, 4),
    ("Fatia de pudim tradicional", "A fatia individual para comer na loja ou levar.", "Fatias", 14.9, False, 10),
    ("Fatia de pudim de doce de leite", "Fatia individual com calda extra.", "Fatias", 16.9, False, 11),
    ("Mini pudins (caixa com 12)", "Ideal para festas, casamentos e coffee break.", "Eventos", 119.9, True, 20),
    ("Mesa de pudins para eventos", "Montagem com sabores variados. Valor por pessoa, a partir de 50 convidados.", "Eventos", 12.9, False, 21),
    ("Caixa revenda tradicional (10 potes)", "Potes individuais de 120 g, embalagem pronta para o balcão.", "Revenda", 129.0, False, 30),
    ("Caixa revenda sortida (10 potes)", "Tradicional, doce de leite e chocolate. Potes de 120 g.", "Revenda", 139.0, False, 31),
]


DDD = {"Curitiba": "41", "São Paulo": "11", "Brasília": "61"}


def _tel(i: int, cidade: str = "Curitiba") -> str:
    return f"({DDD.get(cidade, '41')}) 9{8000 + i:04d}-{1000 + i * 37 % 9000:04d}"


async def criar(por: str) -> dict:
    """Cria a empresa de demonstração. Devolve id, e-mails e a senha gerada (mostrada uma vez)."""
    from lib.crm import garantir_crm
    from lib.planos import PLANOS, carregar_catalogo
    from lib.tenant import indexar_usuario, provisionar_empresa
    from models.empresas import Empresa
    from models.pessoas import Pessoa
    from models.usuarios import Usuario

    if await controle.empresas.find_one({"slug": SLUG}):
        raise ValueError("A demonstração do Pudim já existe. Exclua a empresa antiga antes de criar de novo.")
    await carregar_catalogo()
    plano = "comercio_enterprise"
    if plano not in PLANOS:
        raise ValueError("Plano do segmento comércio não encontrado")

    db_name = nome_banco_empresa(SLUG)
    banco = client[db_name]
    senha = "Pudim-" + secrets.token_urlsafe(6)
    agora = now_utc()

    def quando(dias: float):
        return agora - timedelta(days=dias)

    # ---------------------------------------------------------------- gestor e empresa
    gestor = Usuario(nome="Kelly Andrade", email=f"gestor@{DOMINIO_EMAIL}", senha_hash=hash_senha(senha), papel="admin",
                     cargo="Diretoria").model_dump()
    gestor["activation_required"] = False
    empresa = Empresa(nome=NOME, slug=SLUG, db_name=db_name, segmento="comercio", plano=plano, plano_aplicado=True,
                      modulos=list(PLANOS[plano]["modulos"]), observacoes="Demonstração com dados fictícios")
    await indexar_usuario(gestor["email"], empresa.id, db_name)
    api_key = await provisionar_empresa(nome=NOME, db_name=db_name, admin=gestor, segmento="comercio")
    empresa.site_api_key = api_key
    from routers.cadastro import somar_periodo

    doc_empresa = empresa.model_dump()
    doc_empresa["demo_apresentacao"] = True  # dados fictícios: o termo de adesão não se aplica
    doc_empresa["assinatura"] = {
        "gateway": "demonstracao", "demo": True, "status": "ativa", "periodicidade": "mensal",
        "valor": float(PLANOS[plano].get("preco_mensal") or 0), "plano": plano, "cartao_final": "0000",
        "cartao_bandeira": "Demonstração", "criada_em": agora, "liberada_por": por,
        "proximo_vencimento": somar_periodo(date.today(), False).isoformat(),
    }
    await controle.empresas.insert_one(doc_empresa)
    await banco.configuracoes.update_one({"id": "singleton"}, {"$set": {
        "slogan": "Pudim de verdade, do jeito que a vovó fazia", "cor_primaria": "#b45309", "atualizado_por": "Demonstração"}})
    await garantir_crm(banco, "comercio")
    await banco.configuracoes.update_one({"id": "singleton"}, {"$set": {"crm.distribuicao": "manual"}})

    # ---------------------------------------------------------------- lojas
    lojas: dict[str, str] = {}
    await banco.unidades.delete_many({})
    for nome, cidade, principal in LOJAS:
        uid = new_id()
        lojas[cidade] = uid
        await banco.unidades.insert_one({"id": uid, "nome": nome, "principal": principal, "ativa": True, "endereco": None,
                                         "cidade": cidade, "telefone": None, "whatsapp": None, "created_at": agora})

    # ---------------------------------------------------------------- equipe
    equipe: dict[str, str] = {}  # cidade (ou "geral") -> pessoa_id do responsável
    emails = [gestor["email"]]
    for nome, prefixo, cargo, cidade, cor in EQUIPE:
        email = f"{prefixo}@{DOMINIO_EMAIL}"
        p = Pessoa(nome=nome, papeis=["corretor"], email=email, cidade=cidade).model_dump()
        u = Usuario(nome=nome, email=email, senha_hash=hash_senha(senha), papel="corretor", pessoa_id=p["id"],
                    cargo=cargo, cor=cor).model_dump()
        await banco.pessoas.insert_one(p)
        await banco.usuarios.insert_one(u)
        await indexar_usuario(email, empresa.id, db_name)
        equipe[cidade or "geral"] = p["id"]
        emails.append(email)

    def dono(cidade: str) -> str:
        return equipe.get(cidade) or equipe["geral"]

    # ---------------------------------------------------------------- clientes
    clientes: dict[str, str] = {}
    for i, (restaurante, responsavel, cidade) in enumerate(CLIENTES):
        p = Pessoa(nome=restaurante, papeis=["cliente"], tipo_pessoa="pj", nome_fantasia=restaurante,
                   responsavel_nome=responsavel, telefone=_tel(i, cidade), cidade=cidade,
                   observacoes="Cliente de revenda (dados fictícios)").model_dump()
        p["telefone_digitos"] = "".join(c for c in p["telefone"] if c.isdigit())
        p["created_at"] = quando(60 - i * 5)
        await banco.pessoas.insert_one(p)
        clientes[restaurante] = p["id"]

    # ---------------------------------------------------------------- negócios
    hoje = date.today()
    negocios: dict[str, dict] = {}
    funis = {f["nome"]: f for f in await banco.funis.find({}).to_list(10)}
    rev, evt = funis.get("Revenda"), funis.get("Eventos e encomendas")
    for nome, cidade, funil_k, etapa, valor, dias, etiquetas in NEGOCIOS:
        funil = rev if funil_k == "rev" else evt
        etapas = funil["etapas"]
        ganho_perdido = etapa if isinstance(etapa, str) else None
        pos = len(etapas) - 1 if ganho_perdido == "ganho" else (1 if ganho_perdido == "perdido" else etapa)
        doc = {
            "id": new_id(), "nome": nome, "cliente_id": clientes.get(nome), "corretor_id": dono(cidade),
            "origem": "Formulário do Meta (Lead Ads)" if dias < 20 else "Indicação", "estagio": "novo",
            "valor_estimado": float(valor), "observacoes": f"{cidade}. Dados fictícios de demonstração.",
            "funil_id": funil["id"], "etapa_id": etapas[pos]["id"], "status": ganho_perdido or "aberto",
            "etapa_desde": quando(max(dias - 2, 0)), "motivo_perda": "Preço" if ganho_perdido == "perdido" else None,
            "previsao_fechamento": (date.today() + timedelta(days=7 + dias % 10)).isoformat() if not ganho_perdido else None,
            "etiquetas": etiquetas, "entrada_id": None, "etapas_alcancadas": [e["id"] for e in etapas[:pos + 1]],
            "created_at": quando(dias), "updated_at": quando(max(dias - 2, 0)),
            "closed_at": quando(1 + dias % 6) if ganho_perdido else None,  # fechados neste mês: o ranking aparece
        }
        if ganho_perdido:
            doc["estagio"] = ganho_perdido
        await banco.leads.insert_one(doc)
        negocios[nome] = doc

    # ---------------------------------------------------------------- agenda da equipe (hoje e próximos dias)
    for nome, tipo, assunto, dia, hora, dur in [
        ("Padaria Pão Dourado", "reuniao", "Degustação na Padaria Pão Dourado", 0, "10:00", 60),
        ("Café Cerrado", "ligacao", "Confirmar primeiro pedido do Café Cerrado", 0, "14:30", 15),
        ("Empório Serra Verde", "whatsapp", "Mandar tabela de revenda para o Empório Serra Verde", 0, "16:00", 15),
        ("Casamento Ana e Rafael", "reuniao", "Prova de sabores: casamento Ana e Rafael", 1, "11:00", 45),
        ("Confraternização Construtora Horizonte", "email", "Enviar orçamento da confraternização", 1, "09:30", 20),
        ("Restaurante Ipê Amarelo", "reuniao", "Apresentação do cardápio de revenda", 2, "15:00", 60),
        ("Coffee break Clínica Vida", "tarefa", "Separar 4 caixas de mini pudins para entrega", 3, "08:00", 30),
        ("Lanchonete Ponto Certo", "ligacao", "Retomar contato com a Lanchonete Ponto Certo", -1, "10:00", 15),
    ]:
        n = negocios[nome]
        await banco.atividades.insert_one({
            "id": new_id(), "tipo": tipo, "assunto": assunto, "data": (hoje + timedelta(days=dia)).isoformat(), "hora": hora,
            "duracao_min": dur, "negocio_id": n["id"], "entrada_id": None, "pessoa_id": n.get("cliente_id"), "imovel_id": None,
            "corretor_id": n["corretor_id"], "notas": None, "concluida": False, "concluida_em": None, "created_by": "Demonstração",
            "created_at": agora, "updated_at": agora,
        })

    # ---------------------------------------------------------------- caixa de entrada (Meta Lead Ads)
    for i, (nome, restaurante, cidade, tipo, msg, dias) in enumerate(ENTRADAS):
        criado = quando(dias + 0.1 * i)
        sem_dono = i % 3 == 0
        await banco.entradas.insert_one({
            "id": new_id(), "nome": nome, "telefone": _tel(20 + i, cidade), "email": None, "origem": "Formulário do Meta (Lead Ads)",
            "interesse": "outro", "mensagem": f"{msg}" + (f" ({restaurante}, {cidade})" if restaurante else f" ({cidade})"),
            "imovel_id": None, "veiculo_id": None, "cliente_id": None, "corretor_id": None if sem_dono else dono(cidade),
            "valor_estimado": None, "etiquetas": [tipo], "status": "novo" if dias < 2 else "em_contato", "negocio_id": None,
            "motivo_descarte": None, "primeiro_contato_em": None if dias < 2 else criado + timedelta(minutes=25),
            "atribuido_em": None if sem_dono else criado, "na_fila": sem_dono, "fila_desde": criado if sem_dono else None,
            "devolvido_de": None, "portal_lead_id": None, "created_at": criado, "updated_at": criado,
        })

    # ---------------------------------------------------------------- financeiro (pedidos e comissão de 7%)
    contas = {c["codigo"]: c["id"] for c in await banco.plano_contas.find({}).to_list(200)}

    async def lanc(descricao, tipo, valor, codigo, dias, pago, pessoa=None, corretor=None):
        venc = hoje - timedelta(days=dias)
        await banco.transacoes.insert_one({
            "id": new_id(), "descricao": descricao, "tipo": tipo, "valor": round(float(valor), 2),
            "plano_conta_id": contas.get(codigo) or contas.get("1.1.1"), "imovel_id": None, "pessoa_id": pessoa,
            "corretor_id": corretor, "evento_id": None, "cancelado_em": None, "contrato_id": None, "agendamento_id": None,
            "tratamento_id": None, "veiculo_id": None, "forma_pagamento": "Pix" if tipo == "receber" else "Transferência",
            "vencimento": venc.isoformat(), "pagamento": venc.isoformat() if pago else None,
            "status": "pago" if pago else "pendente", "vencido": False, "created_at": now_utc(),
        })

    proximo_10 = date(hoje.year + (hoje.month == 12), hoje.month % 12 + 1, 10) if hoje.day >= 10 else hoje.replace(day=10)
    dias_ate_dia_10 = (proximo_10 - hoje).days  # comissão paga no dia 10
    pedidos = [("Bistrô Alecrim", "Curitiba", 1890, 30), ("Bistrô Alecrim", "Curitiba", 1640, 12),
               ("Cantina Bella Nonna", "São Paulo", 2400, 24), ("Café da Praça", "Curitiba", 1250, 6)]
    contagem: dict[str, int] = {}
    for cliente, cidade, valor, dias in pedidos:
        contagem[cliente] = contagem.get(cliente, 0) + 1
        n = contagem[cliente]
        await lanc(f"Pedido de revenda {n} - {cliente}", "receber", valor, "1.1.4", dias, dias > 10, pessoa=clientes.get(cliente))
        if n <= 2:  # regra da casa: 7% nos dois primeiros pedidos de cada cliente
            await lanc(f"Comissão 7% ({n}º pedido) - {cliente}", "pagar", valor * 0.07, "2.3.1", -dias_ate_dia_10, False,
                       corretor=dono(cidade))
    for desc, valor, codigo, dias, pago in [
        ("Vendas no balcão - semana", 6840, "1.1.1", 7, True), ("Delivery e apps - semana", 3920, "1.1.2", 7, True),
        ("Encomenda Casamento Ana e Rafael (sinal 50%)", 1400, "1.1.3", 3, True),
        ("Leite condensado e ovos", 3150, "2.4.1", 9, True), ("Embalagens e potes 120 g", 980, "2.4.2", 5, True),
        ("Taxas de apps de entrega", 640, "2.4.3", 2, False), ("Motoboy - entregas da semana", 420, "2.4.4", -3, False),
    ]:
        await lanc(desc, "receber" if codigo.startswith("1") else "pagar", valor, codigo, dias, pago)

    # ---------------------------------------------------------------- site com cardápio
    await controle.sites_index.delete_many({"_id": SLUG_SITE})
    await controle.sites_index.insert_one({"_id": SLUG_SITE, "db_name": db_name, "em": agora})
    await banco.site_imobiliaria.update_one({"id": "singleton"}, {"$set": {
        "id": "singleton", "ativo": True, "slug": SLUG_SITE, "nome": "O Pudim Perfeito (demonstração)",
        "titulo": "Pudim de verdade, do jeito que a vovó fazia",
        "subtitulo": "Peça pelo WhatsApp, encomende para o seu evento ou leve nossos pudins para o seu restaurante.",
        "sobre": "Somos uma rede de lojas de pudim em Curitiba, São Paulo e Brasília. Este site é uma demonstração do SAX CRM com dados fictícios.",
        "cor_primaria": "#b45309", "cor_destaque": "#f59e0b", "cor_cabecalho": "#3b1d0e", "cor_texto_cabecalho": "#fef3c7",
        "cor_fundo": "#fffbeb", "fonte": "elegante", "titulo_catalogo": "Cardápio", "layout_catalogo": "grade",
        "mostrar_precos": True, "mostrar_agendamento": False, "mostrar_sobre": True, "whatsapp": "5541991998738",
        "mensagem_whatsapp": "Olá! Vi o cardápio no site e quero fazer um pedido.", "telefone": "", "email": "",
        "endereco": "Curitiba, São Paulo e Brasília", "creci": "", "horario": "Todos os dias, das 10h às 20h",
        "instagram": "", "facebook": "", "tem_logo": False, "tem_capa": False, "midia_v": 0, "dominio": None,
        "atualizado_em": agora, "atualizado_por": "Demonstração",
    }}, upsert=True)
    for nome, desc, cat, preco, destaque, ordem in CARDAPIO:
        await banco.site_itens.insert_one({
            "id": new_id(), "tipo": "produto", "nome": nome, "descricao": desc, "categoria": cat, "preco": preco,
            "preco_a_partir": cat == "Eventos" and "pessoa" in desc, "duracao_min": None, "ativo": True, "destaque": destaque,
            "ordem": ordem, "tem_foto": False, "foto_v": 0, "created_at": agora,
        })

    # ---------------------------------------------------------------- WhatsApp: setores e fluxo de boas-vindas
    setores = {}
    for nome, membros in [("Revenda", [equipe["geral"]]), ("Eventos", [equipe["São Paulo"]])]:
        sid = new_id()
        setores[nome] = sid
        usuarios = await banco.usuarios.find({"pessoa_id": {"$in": membros}}, {"id": 1}).to_list(10)
        await banco.wa_setores.insert_one({"id": sid, "nome": nome, "membros": [u["id"] for u in usuarios], "criado_em": agora})
    await banco.wa_fluxos.insert_one({
        "id": new_id(), "nome": "Boas-vindas", "ativo": True, "gatilho": "nova_conversa", "palavras": [], "conexoes": [],
        "passos": [
            {"id": "ola", "tipo": "mensagem", "texto": "Olá! Que bom ter você no O Pudim Perfeito.", "opcoes": [], "proximo": "menu",
             "destino_tipo": None, "destino_id": None},
            {"id": "menu", "tipo": "menu", "texto": "Como podemos ajudar? Responda com o número:", "proximo": None,
             "destino_tipo": None, "destino_id": None, "opcoes": [
                 {"rotulo": "Fazer um pedido", "proximo": "pedido"}, {"rotulo": "Encomenda para evento", "proximo": "evento"},
                 {"rotulo": "Quero revender", "proximo": "revenda"}, {"rotulo": "Endereço e horário", "proximo": "lojas"}]},
            {"id": "pedido", "tipo": "transferir", "texto": "Delícia! Já vou te passar para a loja montar o seu pedido.", "opcoes": [],
             "proximo": None, "destino_tipo": "fila", "destino_id": None},
            {"id": "evento", "tipo": "transferir", "texto": "Que legal! Nossa equipe de eventos vai falar com você.", "opcoes": [],
             "proximo": None, "destino_tipo": "setor", "destino_id": setores["Eventos"]},
            {"id": "revenda", "tipo": "transferir", "texto": "Ótimo! Nosso time de revenda vai te chamar.", "opcoes": [],
             "proximo": None, "destino_tipo": "setor", "destino_id": setores["Revenda"]},
            {"id": "lojas", "tipo": "encerrar", "opcoes": [], "proximo": None, "destino_tipo": None, "destino_id": None,
             "texto": "Estamos em Curitiba, São Paulo e Brasília, todos os dias das 10h às 20h. Para pedir, é só mandar mensagem aqui."},
        ],
        "atualizado_em": agora, "criado_por": "Demonstração",
    })

    return {"empresa_id": empresa.id, "nome": NOME, "emails": emails, "senha": senha, "site": SLUG_SITE}
