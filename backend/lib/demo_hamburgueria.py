"""Empresa de demonstração "[DEMO] Chapa Quente Hamburgueria" (segmento comércio).

Segunda demonstração de restaurante (a primeira é a do Pudim, `lib/demo_pudim.py`). Cria uma empresa
separada, com banco próprio, e preenche com dados FICTÍCIOS: duas lojas em Curitiba, equipe, funis de
eventos e de empresas/convênios, leads do Instagram e do WhatsApp com temperatura, clientes, cardápio no
site, financeiro de uma hamburgueria, fluxo de boas-vindas no WhatsApp que manda o link do cardápio e
programa de afiliados com cashback.

Nomes de pessoas, empresas, telefones e valores são inventados. Nenhum dado real de cliente.
"""

from __future__ import annotations

import secrets
from datetime import date, timedelta

from lib.auth import hash_senha
from lib.db import client, controle, nome_banco_empresa
from models.common import new_id, now_utc

SLUG = "demo-chapa-quente"
NOME = "[DEMO] Chapa Quente Hamburgueria"
SLUG_SITE = "chapa-quente-demo"
DOMINIO_EMAIL = "chapaquentedemo.exemplo.com"
WHATSAPP_DEMO = "5541991998738"  # número da SAX, para o clique funcionar na apresentação

LOJAS = [("Chapa Quente Batel", "Batel", True), ("Chapa Quente Água Verde", "Água Verde", False)]

# nome, e-mail (prefixo), cargo, loja (bairro) ou None, cor
EQUIPE = [
    ("Rafael Moura", "rafael", "Gerente", None, "#dc2626"),
    ("Aline Costa", "aline", "Atendente de eventos", "Batel", "#ea580c"),
    ("Gustavo Lima", "gustavo", "Atendente", "Água Verde", "#2563eb"),
]

# nome, tipo (pf/pj), responsável, bairro
CLIENTES = [
    ("Construtora Alicerce", "pj", "Renata Prado", "Batel"),
    ("Clínica Sorriso Livre", "pj", "Dr. Caio Martins", "Água Verde"),
    ("Escritório Lima e Associados", "pj", "Patrícia Lima", "Batel"),
    ("Academia Corpo em Ação", "pj", "Marcelo Souza", "Água Verde"),
    ("Juliana Ferraz", "pf", None, "Batel"),
    ("Thiago Andrade", "pf", None, "Água Verde"),
]

# (negócio, cliente ou None, loja, funil, etapa (índice) ou "ganho"/"perdido", valor, dias atrás, temperatura, origem)
NEGOCIOS = [
    ("Confraternização Construtora Alicerce", "Construtora Alicerce", "Batel", "evt", 3, 4800, 6, "quente", "Indicação"),
    ("Aniversário 30 anos Juliana", "Juliana Ferraz", "Batel", "evt", "ganho", 1650, 20, "quente", "Instagram"),
    ("Formatura turma de Direito", None, "Água Verde", "evt", 1, 7200, 3, "morno", "Instagram"),
    ("Chá revelação Thiago e Bia", "Thiago Andrade", "Água Verde", "evt", 2, 980, 5, "quente", "WhatsApp"),
    ("Food truck no casamento Ana e Pedro", None, "Batel", "evt", 0, 9500, 1, "morno", "Site"),
    ("Festa junina Escola Pequeno Príncipe", None, "Água Verde", "evt", "perdido", 3100, 15, "frio", "Google"),
    ("Almoço corporativo Clínica Sorriso Livre", "Clínica Sorriso Livre", "Água Verde", "emp", 2, 2600, 8, "quente", "Indicação"),
    ("Convênio Escritório Lima e Associados", "Escritório Lima e Associados", "Batel", "emp", "ganho", 1900, 28, "morno", "Loja física"),
    ("Parceria Academia Corpo em Ação", "Academia Corpo em Ação", "Água Verde", "emp", 1, 1200, 4, "morno", "Instagram"),
    ("Coffee break Coworking Centro", None, "Batel", "emp", 0, 850, 2, "frio", "Google"),
]

# Leads que acabaram de chegar (caixa de entrada)
ENTRADAS = [
    ("Bruna Carvalho", "Instagram", "Quero fazer o aniversário do meu filho aí, umas 25 pessoas. Tem cardápio infantil?", 0, "quente"),
    ("Leonardo Pires", "WhatsApp", "Vocês fazem hambúrguer para evento da empresa? Seríamos 80 pessoas.", 0, "quente"),
    ("Sabrina Telles", "Site", "Gostaria de saber se fazem food truck para casamento em São José dos Pinhais.", 1, "morno"),
    ("Felipe Moreira", "iFood e apps de entrega", "Pedi pelo app e queria saber do desconto para pedidos grandes.", 1, "morno"),
    ("Carla Nogueira", "Google", "Vocês têm opção vegana?", 2, "frio"),
]

CARDAPIO = [
    # nome, descrição, categoria, preço, destaque, ordem
    ("Chapa Clássico", "Blend bovino 160 g, queijo prato, alface, tomate e molho da casa no pão brioche.", "Hambúrgueres", 32.9, True, 1),
    ("Smash Duplo", "Dois smash de 90 g, cheddar derretido, cebola caramelizada e picles.", "Hambúrgueres", 36.9, True, 2),
    ("Bacon Supremo", "Blend 180 g, bacon crocante, cheddar, cebola crispy e barbecue.", "Hambúrgueres", 39.9, False, 3),
    ("Frango Crocante", "Sobrecoxa empanada, maionese de ervas, alface e tomate.", "Hambúrgueres", 31.9, False, 4),
    ("Veggie da Horta", "Hambúrguer de grão-de-bico, queijo, rúcula e tomate seco.", "Hambúrgueres", 33.9, False, 5),
    ("Combo Clássico", "Chapa Clássico, batata média e refrigerante lata.", "Combos", 46.9, True, 10),
    ("Combo Família", "4 hambúrgueres clássicos, 2 batatas grandes e 1 refrigerante 2 L.", "Combos", 149.9, False, 11),
    ("Batata rústica", "Porção com alecrim e maionese da casa.", "Porções", 22.9, False, 20),
    ("Onion rings", "Anéis de cebola empanados com molho barbecue.", "Porções", 24.9, False, 21),
    ("Milkshake de Ovomaltine", "500 ml.", "Bebidas e sobremesas", 21.9, False, 30),
    ("Refrigerante lata", "350 ml.", "Bebidas e sobremesas", 6.9, False, 31),
    ("Kit festa (por pessoa)", "Mini hambúrgueres, batata e refrigerante à vontade. A partir de 20 pessoas.", "Eventos", 49.9, False, 40),
]

FUNIS = [
    ("Eventos e festas", True, [("Pedido recebido", 15, 1), ("Orçamento enviado", 40, 2), ("Degustação ou visita", 60, 4),
                                ("Sinal pago", 85, 3), ("Evento confirmado", 95, 7)]),
    ("Empresas e convênios", False, [("Primeiro contato", 15, 2), ("Apresentação do cardápio", 40, 4),
                                     ("Proposta enviada", 65, 5), ("Contrato em fechamento", 85, 5)]),
]


def _tel(i: int) -> str:
    return f"(41) 9{8100 + i:04d}-{2000 + i * 53 % 7000:04d}"


async def existe() -> bool:
    return bool(await controle.empresas.find_one({"slug": SLUG}, {"id": 1}))


async def criar(por: str) -> dict:
    """Cria a empresa de demonstração. Devolve id, e-mails e a senha gerada (mostrada uma vez)."""
    from lib import cashback as cb
    from lib.crm import garantir_crm
    from lib.db import definir_empresa
    from lib.planos import PLANOS, carregar_catalogo
    from lib.tenant import indexar_usuario, provisionar_empresa
    from models.crm import Etapa, Funil
    from models.empresas import Empresa
    from models.pessoas import Pessoa
    from models.usuarios import Usuario
    from routers.cadastro import somar_periodo

    if await existe():
        raise ValueError("A demonstração da hamburgueria já existe. Exclua a empresa antiga antes de criar de novo.")
    await carregar_catalogo()
    plano = "comercio_enterprise"
    if plano not in PLANOS:
        raise ValueError("Plano do segmento comércio não encontrado")

    db_name = nome_banco_empresa(SLUG)
    banco = client[db_name]
    senha = "Chapa-" + secrets.token_urlsafe(6)
    agora = now_utc()
    hoje = date.today()

    def quando(dias: float):
        return agora - timedelta(days=dias)

    # ---------------------------------------------------------------- gestor e empresa
    gestor = Usuario(nome="Marcos Chapa", email=f"gestor@{DOMINIO_EMAIL}", senha_hash=hash_senha(senha), papel="admin",
                     cargo="Sócio").model_dump()
    gestor["activation_required"] = False
    empresa = Empresa(nome=NOME, slug=SLUG, db_name=db_name, segmento="comercio", plano=plano, plano_aplicado=True,
                      modulos=list(PLANOS[plano]["modulos"]), observacoes="Demonstração com dados fictícios")
    await indexar_usuario(gestor["email"], empresa.id, db_name)
    empresa.site_api_key = await provisionar_empresa(nome=NOME, db_name=db_name, admin=gestor, segmento="comercio")
    doc_empresa = empresa.model_dump()
    doc_empresa["demo_apresentacao"] = True  # dados fictícios: o termo de adesão não se aplica
    doc_empresa["assinatura"] = {
        "gateway": "demonstracao", "demo": True, "status": "ativa", "periodicidade": "mensal",
        "valor": float(PLANOS[plano].get("preco_mensal") or 0), "plano": plano, "cartao_final": "0000",
        "cartao_bandeira": "Demonstração", "criada_em": agora, "liberada_por": por,
        "proximo_vencimento": somar_periodo(hoje, False).isoformat(),
    }
    await controle.empresas.insert_one(doc_empresa)
    await banco.configuracoes.update_one({"id": "singleton"}, {"$set": {
        "slogan": "Hambúrguer na chapa, do jeito certo", "cor_primaria": "#b91c1c", "atualizado_por": "Demonstração"}})

    # funis da hamburgueria no lugar dos de revenda (padrão do segmento)
    await banco.funis.delete_many({})
    funis = []
    for ordem, (nome, padrao, etapas) in enumerate(FUNIS):
        funis.append(Funil(nome=nome, ordem=ordem, padrao=padrao,
                           etapas=[Etapa(nome=n, probabilidade=p, dias_parado=d) for n, p, d in etapas]).model_dump())
    await banco.funis.insert_many(funis)
    await garantir_crm(banco, "comercio")
    await banco.configuracoes.update_one({"id": "singleton"}, {"$set": {
        "crm.distribuicao": "manual", "crm.ordenar_por_temperatura": True,
        "crm.regras_temperatura": [{"origem": "Indicação", "temperatura": "quente"}, {"origem": "Google", "temperatura": "frio"}],
        "crm.etiquetas": ["Aniversário", "Corporativo", "Casamento", "Formatura", "Convênio", "Delivery", "VIP"],
    }})

    # ---------------------------------------------------------------- lojas
    lojas: dict[str, dict] = {}
    await banco.unidades.delete_many({})
    for nome, bairro, principal in LOJAS:
        u = {"id": new_id(), "nome": nome, "principal": principal, "ativa": True, "endereco": f"{bairro}, Curitiba", "cidade": "Curitiba",
             "telefone": None, "whatsapp": WHATSAPP_DEMO, "created_at": agora}
        await banco.unidades.insert_one(u)
        lojas[bairro] = u

    # ---------------------------------------------------------------- equipe
    equipe: dict[str, str] = {}
    emails = [gestor["email"]]
    for nome, prefixo, cargo, bairro, cor in EQUIPE:
        email = f"{prefixo}@{DOMINIO_EMAIL}"
        p = Pessoa(nome=nome, papeis=["corretor"], email=email, cidade="Curitiba").model_dump()
        u = Usuario(nome=nome, email=email, senha_hash=hash_senha(senha), papel="corretor", pessoa_id=p["id"], cargo=cargo, cor=cor,
                    unidade_id=lojas[bairro]["id"] if bairro else None).model_dump()
        await banco.pessoas.insert_one(p)
        await banco.usuarios.insert_one(u)
        await indexar_usuario(email, empresa.id, db_name)
        equipe[bairro or "geral"] = p["id"]
        emails.append(email)

    # ---------------------------------------------------------------- clientes
    clientes: dict[str, str] = {}
    for i, (nome, tipo, responsavel, bairro) in enumerate(CLIENTES):
        p = Pessoa(nome=nome, papeis=["cliente"], tipo_pessoa=tipo, nome_fantasia=nome if tipo == "pj" else None,
                   responsavel_nome=responsavel, telefone=_tel(i), cidade="Curitiba", bairro=bairro,
                   observacoes="Dados fictícios de demonstração").model_dump()
        p["telefone_digitos"] = "".join(c for c in p["telefone"] if c.isdigit())
        p["created_at"] = quando(70 - i * 6)
        await banco.pessoas.insert_one(p)
        clientes[nome] = p["id"]

    # ---------------------------------------------------------------- negócios
    por_nome = {f["nome"]: f for f in funis}
    negocios: dict[str, dict] = {}
    for nome, cliente, bairro, funil_k, etapa, valor, dias, temp, origem in NEGOCIOS:
        funil = por_nome["Eventos e festas" if funil_k == "evt" else "Empresas e convênios"]
        etapas = funil["etapas"]
        fechado = etapa if isinstance(etapa, str) else None
        pos = len(etapas) - 1 if fechado == "ganho" else (1 if fechado == "perdido" else etapa)
        loja = lojas[bairro]
        doc = {
            "id": new_id(), "nome": nome, "cliente_id": clientes.get(cliente) if cliente else None,
            "corretor_id": equipe.get(bairro) or equipe["geral"], "origem": origem, "estagio": fechado or "novo",
            "valor_estimado": float(valor), "observacoes": "Dados fictícios de demonstração.", "funil_id": funil["id"],
            "etapa_id": etapas[pos]["id"], "status": fechado or "aberto", "etapa_desde": quando(max(dias - 1, 0)),
            "motivo_perda": "Data indisponível" if fechado == "perdido" else None,
            "previsao_fechamento": (hoje + timedelta(days=5 + dias % 12)).isoformat() if not fechado else None,
            "etiquetas": [], "entrada_id": None, "etapas_alcancadas": [e["id"] for e in etapas[:pos + 1]], "temperatura": temp,
            "unidade_id": loja["id"], "created_at": quando(dias), "updated_at": quando(max(dias - 1, 0)),
            "closed_at": quando(1 + dias % 5) if fechado else None,
        }
        await banco.leads.insert_one(doc)
        negocios[nome] = doc

    # ---------------------------------------------------------------- agenda da equipe
    for nome, tipo, assunto, dia, hora, dur in [
        ("Confraternização Construtora Alicerce", "ligacao", "Confirmar número de convidados com a Renata", 0, "10:30", 15),
        ("Chá revelação Thiago e Bia", "whatsapp", "Mandar opções de kit festa para o Thiago", 0, "15:00", 15),
        ("Almoço corporativo Clínica Sorriso Livre", "reuniao", "Degustação na Clínica Sorriso Livre", 1, "12:00", 60),
        ("Formatura turma de Direito", "email", "Enviar orçamento da formatura", 1, "09:00", 20),
        ("Parceria Academia Corpo em Ação", "reuniao", "Apresentar cardápio fit para a academia", 2, "18:00", 45),
        ("Food truck no casamento Ana e Pedro", "ligacao", "Primeiro contato com a Ana sobre o food truck", -1, "11:00", 15),
    ]:
        n = negocios[nome]
        await banco.atividades.insert_one({
            "id": new_id(), "tipo": tipo, "assunto": assunto, "data": (hoje + timedelta(days=dia)).isoformat(), "hora": hora,
            "duracao_min": dur, "negocio_id": n["id"], "entrada_id": None, "pessoa_id": n.get("cliente_id"), "imovel_id": None,
            "corretor_id": n["corretor_id"], "notas": None, "concluida": False, "concluida_em": None, "created_by": "Demonstração",
            "created_at": agora, "updated_at": agora,
        })

    # ---------------------------------------------------------------- caixa de entrada
    for i, (nome, origem, msg, dias, temp) in enumerate(ENTRADAS):
        criado = quando(dias + 0.1 * i)
        sem_dono = i % 2 == 0
        await banco.entradas.insert_one({
            "id": new_id(), "nome": nome, "telefone": _tel(30 + i), "email": None, "origem": origem, "interesse": "outro",
            "mensagem": msg, "imovel_id": None, "veiculo_id": None, "cliente_id": None,
            "corretor_id": None if sem_dono else equipe["Batel"], "valor_estimado": None, "etiquetas": [], "temperatura": temp,
            "status": "novo" if dias < 2 else "em_contato", "negocio_id": None, "motivo_descarte": None,
            "primeiro_contato_em": None if dias < 2 else criado + timedelta(minutes=12),
            "atribuido_em": None if sem_dono else criado, "na_fila": sem_dono, "fila_desde": criado if sem_dono else None,
            "devolvido_de": None, "portal_lead_id": None, "created_at": criado, "updated_at": criado,
        })

    # ---------------------------------------------------------------- financeiro
    contas = {c["codigo"]: c["id"] for c in await banco.plano_contas.find({}).to_list(200)}

    async def lanc(descricao, tipo, valor, codigo, dias, pago, pessoa=None):
        venc = hoje - timedelta(days=dias)
        await banco.transacoes.insert_one({
            "id": new_id(), "descricao": descricao, "tipo": tipo, "valor": round(float(valor), 2),
            "plano_conta_id": contas.get(codigo) or contas.get("1.1.1"), "imovel_id": None, "pessoa_id": pessoa, "corretor_id": None,
            "evento_id": None, "cancelado_em": None, "contrato_id": None, "agendamento_id": None, "tratamento_id": None,
            "veiculo_id": None, "forma_pagamento": "Pix" if tipo == "receber" else "Boleto", "vencimento": venc.isoformat(),
            "pagamento": venc.isoformat() if pago else None, "status": "pago" if pago else "pendente", "vencido": False,
            "created_at": now_utc(),
        })

    for desc, valor, codigo, dias, pago, pessoa in [
        ("Vendas no salão - semana", 14280, "1.1.1", 7, True, None),
        ("iFood e apps de entrega - semana", 9870, "1.1.2", 7, True, None),
        ("Aniversário 30 anos Juliana (sinal 50%)", 825, "1.1.3", 18, True, "Juliana Ferraz"),
        ("Aniversário 30 anos Juliana (restante)", 825, "1.1.3", 12, True, "Juliana Ferraz"),
        ("Convênio Escritório Lima e Associados - mês", 1900, "1.1.4", -5, False, "Escritório Lima e Associados"),
        ("Carne bovina e blend - fornecedor", 6420, "2.4.1", 6, True, None),
        ("Pães brioche - padaria parceira", 1980, "2.4.1", 4, True, None),
        ("Embalagens e sacolas", 760, "2.4.2", 3, True, None),
        ("Taxas de apps de entrega", 1480, "2.4.3", -2, False, None),
        ("Motoboys - semana", 1120, "2.4.4", -3, False, None),
    ]:
        await lanc(desc, "receber" if codigo.startswith("1") else "pagar", valor, codigo, dias, pago, clientes.get(pessoa) if pessoa else None)

    # ---------------------------------------------------------------- site com cardápio
    await controle.sites_index.delete_many({"_id": SLUG_SITE})
    await controle.sites_index.insert_one({"_id": SLUG_SITE, "db_name": db_name, "em": agora})
    await banco.site_imobiliaria.update_one({"id": "singleton"}, {"$set": {
        "id": "singleton", "ativo": True, "slug": SLUG_SITE, "nome": "Chapa Quente Hamburgueria (demonstração)",
        "titulo": "Hambúrguer na chapa, do jeito certo",
        "subtitulo": "Peça pelo WhatsApp, chame a gente para o seu evento ou feche um convênio para a sua empresa.",
        "sobre": "Hamburgueria artesanal com duas lojas em Curitiba. Este site é uma demonstração do SAX CRM com dados fictícios.",
        "cor_primaria": "#b91c1c", "cor_destaque": "#f59e0b", "cor_cabecalho": "#1c1917", "cor_texto_cabecalho": "#fef3c7",
        "cor_fundo": "#fffbeb", "fonte": "moderna", "titulo_catalogo": "Cardápio", "layout_catalogo": "grade",
        "mostrar_precos": True, "mostrar_agendamento": False, "mostrar_sobre": True, "whatsapp": WHATSAPP_DEMO,
        "mensagem_whatsapp": "Olá! Vi o cardápio no site e quero fazer um pedido.", "telefone": "", "email": "",
        "endereco": "Batel e Água Verde, Curitiba", "creci": "", "horario": "Terça a domingo, das 18h às 23h30",
        "instagram": "", "facebook": "", "tem_logo": False, "tem_capa": False, "midia_v": 0, "dominio": None,
        "atualizado_em": agora, "atualizado_por": "Demonstração",
    }}, upsert=True)
    for nome, desc, cat, preco, destaque, ordem in CARDAPIO:
        await banco.site_itens.insert_one({
            "id": new_id(), "tipo": "produto", "nome": nome, "descricao": desc, "categoria": cat, "preco": preco,
            "preco_a_partir": cat == "Eventos", "duracao_min": None, "ativo": True, "destaque": destaque,
            "ordem": ordem, "tem_foto": False, "foto_v": 0, "created_at": agora,
        })

    # ---------------------------------------------------------------- WhatsApp: setor de eventos e fluxo com o link do cardápio
    eventos_id = new_id()
    usuarios_eventos = await banco.usuarios.find({"pessoa_id": equipe["Batel"]}, {"id": 1}).to_list(5)
    await banco.wa_setores.insert_one({"id": eventos_id, "nome": "Eventos", "membros": [u["id"] for u in usuarios_eventos], "criado_em": agora})
    passo = lambda **k: {"opcoes": [], "proximo": None, "destino_tipo": None, "destino_id": None, "link_tipo": None, "url": None, **k}  # noqa: E731
    await banco.wa_fluxos.insert_one({
        "id": new_id(), "nome": "Boas-vindas", "ativo": True, "gatilho": "nova_conversa", "palavras": [], "conexoes": [],
        "passos": [
            passo(id="ola", tipo="mensagem", texto="Fala! Aqui é a Chapa Quente Hamburgueria.", proximo="menu", pos={"x": 0, "y": 0}),
            passo(id="menu", tipo="menu", texto="O que você precisa? Responda com o número:", pos={"x": 380, "y": 0}, opcoes=[
                {"rotulo": "Ver o cardápio", "proximo": "cardapio"}, {"rotulo": "Fazer um pedido", "proximo": "pedido"},
                {"rotulo": "Evento ou festa", "proximo": "evento"}, {"rotulo": "Endereço e horário", "proximo": "lojas"}]),
            passo(id="cardapio", tipo="link", link_tipo="catalogo", texto="Olha o nosso cardápio: {link}", proximo="depois",
                  pos={"x": 760, "y": -60}),
            passo(id="depois", tipo="mensagem", texto="Quando escolher, é só mandar o pedido aqui.", pos={"x": 1140, "y": -60}),
            passo(id="pedido", tipo="transferir", texto="Bora! Já vou te passar para a loja montar o seu pedido.", destino_tipo="fila",
                  pos={"x": 760, "y": 160}),
            passo(id="evento", tipo="transferir", texto="Show! Nossa equipe de eventos vai falar com você.", destino_tipo="setor",
                  destino_id=eventos_id, pos={"x": 760, "y": 360}),
            passo(id="lojas", tipo="encerrar", pos={"x": 760, "y": 560},
                  texto="Estamos no Batel e no Água Verde, de terça a domingo, das 18h às 23h30."),
        ],
        "atualizado_em": agora, "criado_por": "Demonstração",
    })

    # ---------------------------------------------------------------- afiliados e cashback
    definir_empresa(db_name)
    try:
        await banco.configuracoes.update_one({"id": "singleton"}, {"$set": {"cashback": cb.CashbackConfig(
            ativo=True, pct_indicacao=5, compras_indicacao=2, pct_compra=5, validade_dias=60, max_pct_uso=30).model_dump()}})
        afiliado = await cb.cliente_por_telefone("(41) 99876-3301") or await cb.criar_cliente("Juliana Ferraz", "(41) 99876-3301")
        await cb.tornar_afiliado(afiliado)
        for nome_cli, tel, bairro, valor in [("Pedro Henrique", "(41) 99712-4401", "Batel", 93.80),
                                             ("Larissa Melo", "(41) 99712-4402", "Água Verde", 149.90)]:
            cli = await cb.criar_cliente(nome_cli, tel)
            await cb.registrar_compra(cliente=cli, valor=valor, usar=0, unidade=lojas[bairro], codigo=afiliado["afiliado_codigo"],
                                      descricao="Demonstração", por="Demonstração")
    finally:
        definir_empresa(None)

    return {"empresa_id": empresa.id, "nome": NOME, "emails": emails, "senha": senha, "site": SLUG_SITE}
