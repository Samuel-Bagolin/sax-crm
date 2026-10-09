"""Links públicos (vitrine do cliente, relatório do proprietário, feed dos portais).

O token é aleatório e só o SHA-256 dele fica no banco de CONTROLE (`links_publicos`), junto do
banco da empresa. Assim uma URL pública resolve a empresa sem login e um vazamento do banco não
revela links válidos. Revogar = apagar o índice.
"""

import hashlib
import secrets

from fastapi import HTTPException

from lib.db import controle, definir_empresa, empresa_atual_db
from models.common import now_utc


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def criar(tipo: str, ref: str, substituir: bool = False) -> str:
    """Cria um link para (tipo, ref) na empresa atual. `substituir` revoga os anteriores."""
    if substituir:
        await revogar(tipo, ref)
    token = secrets.token_urlsafe(24)
    await controle.links_publicos.insert_one({
        "_id": digest(token), "tipo": tipo, "ref": ref, "db_name": empresa_atual_db(), "em": now_utc(),
    })
    return token


async def revogar(tipo: str, ref: str) -> None:
    await controle.links_publicos.delete_many({"tipo": tipo, "ref": ref, "db_name": empresa_atual_db()})


async def existe(tipo: str, ref: str) -> bool:
    return bool(await controle.links_publicos.find_one({"tipo": tipo, "ref": ref, "db_name": empresa_atual_db()}))


async def resolver(token: str, tipo: str) -> str:
    """Valida o token, entra no banco da empresa e devolve a referência. 404 genérico se inválido."""
    if not token or len(token) < 20 or len(token) > 80:
        raise HTTPException(404, "Link inválido")
    indice = await controle.links_publicos.find_one({"_id": digest(token), "tipo": tipo})
    if not indice:
        raise HTTPException(404, "Link inválido ou substituído")
    if indice.get("db_name"):
        empresa = await controle.empresas.find_one({"db_name": indice["db_name"]}, {"ativo": 1})
        if not empresa or not empresa.get("ativo", True):
            raise HTTPException(404, "Link indisponível")
    definir_empresa(indice.get("db_name"))
    return indice["ref"]


async def marca_publica() -> dict:
    """Nome, cor e logo da imobiliária para as páginas públicas."""
    from lib.db import db

    config = await db.configuracoes.find_one({"id": "singleton"}, {"cor_primaria": 1, "logo_base64": 1, "nome_software": 1, "telefone": 1}) or {}
    empresa = await controle.empresas.find_one({"db_name": empresa_atual_db()}, {"nome": 1}) if empresa_atual_db() else None
    from routers.assinaturas import _cor

    cor = _cor(config)
    return {
        "empresa_nome": (empresa or {}).get("nome") or config.get("nome_software") or "Imobiliária",
        "cor_primaria": cor,
        "tem_logo": bool(config.get("logo_base64")),
    }
