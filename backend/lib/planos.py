"""Planos comerciais, adicionais e limites por imobiliária.

O catálogo (planos e adicionais) vive no banco de CONTROLE e é editado pelo Administrador de Sistema
na tela Empresas. Na primeira execução ele nasce com os quatro planos de referência abaixo.

Cada empresa guarda a chave do plano e, em `comercial`, as condições negociadas: periodicidade
(mensal ou anual), adicionais contratados (vários, com quantidade), desconto e taxa de instalação.
Adicionais do tipo recurso liberam a funcionalidade; os de usuários/imóveis somam ao limite.

Empresas criadas antes dos planos ficam como "legado" (sem limite e com todos os recursos) até o
administrador de sistema aplicar um plano. Nenhuma imobiliária em operação perde acesso.

`PLANOS` e `ADICIONAIS` são dicionários de módulo atualizados no lugar por `carregar_catalogo()`,
então quem importou continua vendo a versão atual.
"""

import time

from fastapi import HTTPException

from lib.db import controle, db, empresa_atual_db

RECURSOS = {
    "match": "Imóveis compatíveis e vitrine para o cliente",
    "automacoes": "Automações e SLA de atendimento",
    "propostas": "Propostas e contrapropostas",
    "portais": "Publicação em portais (ZAP, VivaReal, OLX) e leads dos portais",
    "proprietario": "Relatório do proprietário por link",
    "google": "Google Agenda e Google Drive",
    "assinatura": "Assinatura eletrônica de contratos",
    "chat": "Chat da equipe",
}

TIPOS_ADICIONAL = {
    "recurso": "Libera uma funcionalidade",
    "usuarios": "Usuários extras",
    "imoveis": "Imóveis extras na carteira",
    "servico": "Serviço (treinamento, migração, suporte)",
}

_BASE = ["dashboard", "imoveis", "crm", "agenda", "usuarios"]

PLANOS_PADRAO: dict[str, dict] = {
    "essencial": {
        "nome": "Essencial", "preco_mensal": 99, "preco_anual": None, "usuarios": 1, "imoveis": 300, "implantacao": 0,
        "modulos": _BASE, "recursos": ["chat"], "ordem": 1, "ativo": True,
        "resumo": "CRM, imóveis, funil, agenda, leads e indicadores",
    },
    "profissional": {
        "nome": "Profissional", "preco_mensal": 249, "preco_anual": None, "usuarios": 5, "imoveis": 1000, "implantacao": 499,
        "modulos": _BASE, "recursos": ["chat", "match", "automacoes", "propostas", "proprietario"], "ordem": 2, "ativo": True,
        "resumo": "Distribuição, propostas, vitrine para o cliente, relatórios e automações",
    },
    "business": {
        "nome": "Business", "preco_mensal": 499, "preco_anual": None, "usuarios": 10, "imoveis": 3000, "implantacao": 999,
        "modulos": _BASE + ["contratos", "financeiro"], "recursos": list(RECURSOS), "ordem": 3, "ativo": True,
        "resumo": "Contratos, assinatura, comissões, financeiro, portais e Google",
    },
    "enterprise": {
        "nome": "Enterprise", "preco_mensal": 999, "preco_anual": None, "usuarios": None, "imoveis": None, "implantacao": 2500,
        "modulos": _BASE + ["contratos", "financeiro"], "recursos": list(RECURSOS), "ordem": 4, "ativo": True,
        "resumo": "Sem limites, múltiplas unidades e implantação consultiva",
    },
}
LEGADO = {
    "nome": "Legado (sem limites)", "preco": None, "preco_mensal": None, "preco_anual": None, "usuarios": None, "imoveis": None,
    "implantacao": None, "modulos": _BASE + ["contratos", "financeiro"], "recursos": list(RECURSOS),
    "resumo": "Empresa anterior aos planos", "ativo": True, "ordem": 99,
}

PLANOS: dict[str, dict] = {}
ADICIONAIS: dict[str, dict] = {}
_carregado_em = 0.0
TTL_SEGUNDOS = 60


def _completar(p: dict) -> dict:
    p = {**p}
    p.setdefault("preco_mensal", p.get("preco"))
    p["preco"] = p.get("preco_mensal")  # compatibilidade com telas antigas
    p.setdefault("preco_anual", None)
    p.setdefault("ativo", True)
    p.setdefault("ordem", 50)
    return p


async def carregar_catalogo(forcar: bool = False) -> None:
    """Lê planos e adicionais do banco de controle (com cache curto). Semeia o catálogo padrão."""
    global _carregado_em
    if not forcar and PLANOS and time.monotonic() - _carregado_em < TTL_SEGUNDOS:
        return
    docs = await controle.planos_catalogo.find({}).to_list(None)
    if not docs:
        for chave, p in PLANOS_PADRAO.items():
            try:
                await controle.planos_catalogo.insert_one({"_id": chave, "chave": chave, **p})
            except Exception:
                pass  # outra instância semeou ao mesmo tempo
        docs = await controle.planos_catalogo.find({}).to_list(None)
    novos = {d["chave"]: _completar({k: v for k, v in d.items() if k != "_id"}) for d in docs}
    adicionais = {d["chave"]: {k: v for k, v in d.items() if k != "_id"} for d in await controle.adicionais.find({}).to_list(None)}
    PLANOS.clear()
    PLANOS.update(dict(sorted(novos.items(), key=lambda kv: (kv[1].get("ordem", 50), kv[1].get("nome", "")))))
    ADICIONAIS.clear()
    ADICIONAIS.update(dict(sorted(adicionais.items(), key=lambda kv: kv[1].get("nome", ""))))
    _carregado_em = time.monotonic()


def _catalogo_ou_padrao() -> dict[str, dict]:
    return PLANOS or {k: _completar(v) for k, v in PLANOS_PADRAO.items()}


def plano_de(empresa: dict | None) -> dict:
    """Plano efetivo: catálogo + adicionais contratados + limites personalizados."""
    if not empresa:
        return {**LEGADO, "chave": "legado"}
    catalogo = _catalogo_ou_padrao()
    chave = empresa.get("plano") if empresa.get("plano_aplicado") else "legado"
    base = catalogo.get(chave) or LEGADO
    plano = {**base, "chave": chave if chave in catalogo else "legado", "recursos": list(base["recursos"]), "modulos": list(base["modulos"])}
    if plano["chave"] != "legado":
        for item in (empresa.get("comercial") or {}).get("adicionais") or []:
            ad = ADICIONAIS.get(item.get("chave"))
            if not ad:
                continue
            qtd = max(1, int(item.get("quantidade") or 1))
            if ad["tipo"] == "recurso" and ad.get("recurso") and ad["recurso"] not in plano["recursos"]:
                plano["recursos"].append(ad["recurso"])
            elif ad["tipo"] in ("usuarios", "imoveis") and plano.get(ad["tipo"]) is not None:
                plano[ad["tipo"]] += int(ad.get("quantidade_por_unidade") or 1) * qtd
    extra = empresa.get("limites_personalizados") or {}
    for campo in ("usuarios", "imoveis"):
        if campo in extra:
            plano[campo] = extra[campo]
    if extra.get("recursos_extras"):
        plano["recursos"] = sorted(set(plano["recursos"]) | set(extra["recursos_extras"]))
    return plano


def _preco(item: dict, periodicidade: str) -> float:
    """Preço do período: anual usa o preço anual cadastrado; sem ele, 12 vezes o mensal."""
    mensal = float(item.get("preco_mensal") or item.get("preco") or 0)
    if periodicidade == "anual":
        anual = item.get("preco_anual")
        return float(anual) if anual is not None else round(mensal * 12, 2)
    return mensal


def valores_comerciais(empresa: dict) -> dict | None:
    """Quanto a empresa paga, com base no plano, adicionais, periodicidade e desconto negociado."""
    if not empresa.get("plano_aplicado"):
        return None
    catalogo = _catalogo_ou_padrao()
    plano = catalogo.get(empresa.get("plano"))
    if not plano:
        return None
    com = empresa.get("comercial") or {}
    periodo = com.get("periodicidade") or "mensal"
    linhas = [{"descricao": f"Plano {plano['nome']}", "quantidade": 1, "unitario": _preco(plano, periodo), "total": _preco(plano, periodo)}]
    for item in com.get("adicionais") or []:
        ad = ADICIONAIS.get(item.get("chave"))
        if not ad:
            continue
        qtd = max(1, int(item.get("quantidade") or 1))
        unit = _preco(ad, periodo)
        linhas.append({"descricao": ad["nome"], "quantidade": qtd, "unitario": unit, "total": round(unit * qtd, 2)})
    subtotal = round(sum(l["total"] for l in linhas), 2)
    tipo, valor = com.get("desconto_tipo"), float(com.get("desconto_valor") or 0)
    desconto = round(subtotal * min(valor, 100) / 100, 2) if tipo == "percentual" else round(min(valor, subtotal), 2) if tipo == "valor" else 0.0
    total = round(subtotal - desconto, 2)
    taxa = com.get("taxa_instalacao")
    return {
        "periodicidade": periodo,
        "linhas": linhas,
        "subtotal": subtotal,
        "desconto": desconto,
        "total": total,
        "equivalente_mensal": round(total / 12, 2) if periodo == "anual" else total,
        "taxa_instalacao": float(taxa) if taxa is not None else float(plano.get("implantacao") or 0),
        "taxa_instalacao_parcelas": int(com.get("taxa_instalacao_parcelas") or 1),
    }


async def plano_atual() -> dict:
    await carregar_catalogo()
    nome = empresa_atual_db()
    empresa = await controle.empresas.find_one({"db_name": nome}) if nome else None
    return plano_de(empresa)


async def recurso_liberado(chave: str) -> bool:
    return chave in (await plano_atual())["recursos"]


async def exigir_recurso(chave: str) -> None:
    plano = await plano_atual()
    if chave not in plano["recursos"]:
        nomes = [p["nome"] for p in PLANOS.values() if chave in p["recursos"] and p.get("ativo", True)]
        raise HTTPException(402, f"{RECURSOS.get(chave, chave)} não faz parte do plano {plano['nome']}. "
                                 f"Disponível a partir do plano {nomes[0] if nomes else 'Enterprise'}.")


async def uso_atual() -> dict:
    return {
        "usuarios": await db.usuarios.count_documents({"ativo": {"$ne": False}, "papel": {"$ne": "sysadmin"}}),
        "imoveis": await db.imoveis.count_documents({"status": {"$nin": ["vendido", "alugado"]}}),
    }


async def exigir_limite(campo: str, acrescimo: int = 1) -> None:
    """Bloqueia a criação além do limite do plano (usuários ativos ou imóveis em carteira)."""
    plano = await plano_atual()
    limite = plano.get(campo)
    if limite is None:
        return
    atual = (await uso_atual())[campo]
    if atual + acrescimo > limite:
        rotulo = {"usuarios": "usuários ativos", "imoveis": "imóveis em carteira"}[campo]
        raise HTTPException(402, f"O plano {plano['nome']} permite {limite} {rotulo} e vocês já têm {atual}. "
                                 "Fale com o suporte para ampliar o plano.")
