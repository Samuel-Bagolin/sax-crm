"""Planos comerciais e limites por imobiliária (Fase 4 da pesquisa de mercado).

O catálogo segue a hipótese da pesquisa (Essencial R$ 99 · Profissional R$ 249 · Business R$ 499 ·
Enterprise R$ 999+). Preços e limites são referência comercial e podem ser ajustados aqui sem
migração: o banco guarda só a chave do plano e, se houver, limites personalizados da empresa.

Empresas criadas antes dos planos ficam como "legado" (sem limite e com todos os recursos) até o
administrador de sistema aplicar um plano — nenhuma imobiliária em operação perde acesso.
"""

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

_BASE = ["dashboard", "imoveis", "crm", "agenda", "usuarios"]

PLANOS: dict[str, dict] = {
    "essencial": {
        "nome": "Essencial", "preco": 99, "usuarios": 1, "imoveis": 300, "implantacao": 0,
        "modulos": _BASE, "recursos": ["chat"],
        "resumo": "CRM, imóveis, funil, agenda, leads e indicadores",
    },
    "profissional": {
        "nome": "Profissional", "preco": 249, "usuarios": 5, "imoveis": 1000, "implantacao": 499,
        "modulos": _BASE, "recursos": ["chat", "match", "automacoes", "propostas", "proprietario"],
        "resumo": "Distribuição, propostas, vitrine para o cliente, relatórios e automações",
    },
    "business": {
        "nome": "Business", "preco": 499, "usuarios": 10, "imoveis": 3000, "implantacao": 999,
        "modulos": _BASE + ["contratos", "financeiro"], "recursos": list(RECURSOS),
        "resumo": "Contratos, assinatura, comissões, financeiro, portais e Google",
    },
    "enterprise": {
        "nome": "Enterprise", "preco": 999, "usuarios": None, "imoveis": None, "implantacao": 2500,
        "modulos": _BASE + ["contratos", "financeiro"], "recursos": list(RECURSOS),
        "resumo": "Sem limites, múltiplas unidades e implantação consultiva",
    },
}
LEGADO = {
    "nome": "Legado (sem limites)", "preco": None, "usuarios": None, "imoveis": None, "implantacao": None,
    "modulos": _BASE + ["contratos", "financeiro"], "recursos": list(RECURSOS), "resumo": "Empresa anterior aos planos",
}


def plano_de(empresa: dict | None) -> dict:
    """Plano efetivo: catálogo + limites personalizados. Sem empresa (banco de controle) = sem limites."""
    if not empresa:
        return {**LEGADO, "chave": "legado"}
    chave = empresa.get("plano") if empresa.get("plano_aplicado") else "legado"
    base = PLANOS.get(chave) or LEGADO
    plano = {**base, "chave": chave if chave in PLANOS else "legado"}
    extra = empresa.get("limites_personalizados") or {}
    for campo in ("usuarios", "imoveis"):
        if campo in extra:
            plano[campo] = extra[campo]
    if extra.get("recursos_extras"):
        plano["recursos"] = sorted(set(plano["recursos"]) | set(extra["recursos_extras"]))
    return plano


async def plano_atual() -> dict:
    nome = empresa_atual_db()
    empresa = await controle.empresas.find_one({"db_name": nome}) if nome else None
    return plano_de(empresa)


async def recurso_liberado(chave: str) -> bool:
    return chave in (await plano_atual())["recursos"]


async def exigir_recurso(chave: str) -> None:
    plano = await plano_atual()
    if chave not in plano["recursos"]:
        nomes = [p["nome"] for p in PLANOS.values() if chave in p["recursos"]]
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
