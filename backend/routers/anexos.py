"""Prints e fotos anexados aos negócios (evidência de contato, conversa de WhatsApp, pedido).

Quem vê: quem anexou, administração e gestão (perfis admin). Os demais da equipe não veem,
nem o supervisor, mesmo enxergando o negócio. A imagem chega reduzida pelo navegador e fica em
coleção própria (`anexos`), fora do documento do negócio, dentro do limite de 1 MB do Firestore.

Na importação da planilha, cada print do Google Drive vira um `anexos_pendentes` (nome do arquivo,
atividade e autor). O arquivo em si entra depois por `/plataforma/empresas/{id}/importar-print`.
"""

import base64
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from lib.auth import Principal, authorize, require
from lib.db import db
from models.common import new_id, now_utc, utc_aware
from models.crm import AnexoIn

router = APIRouter(tags=["anexos"])

LIMITE = 900 * 1024  # bytes da imagem (o documento inteiro precisa caber em 1 MB)
MAX_POR_ATIVIDADE = 5
MAX_POR_NEGOCIO = 60
_ASSINATURAS = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG": "image/png", b"RIFF": "image/webp"}
# atividades que provam contato ou reunião: com `print_obrigatorio`, só concluem com print
TIPOS_COM_PRINT = {"ligacao", "whatsapp", "email", "visita", "reuniao", "almoco"}


class AnexoNegocioIn(AnexoIn):
    atividade_id: str | None = None


class Anexo(BaseModel):
    id: str
    negocio_id: str | None = None
    atividade_id: str | None = None
    atividade_assunto: str | None = None
    nome: str
    mime: str
    tamanho: int
    autor_nome: str | None = None
    autor_pessoa_id: str | None = None
    url: str
    created_at: datetime


def decodificar(item: AnexoIn | dict) -> tuple[bytes, str]:
    b64 = (item.base64 if isinstance(item, AnexoIn) else item["base64"]).split(",")[-1]
    try:
        dados = base64.b64decode(b64, validate=False)
    except Exception:
        raise HTTPException(422, "Imagem inválida")
    if len(dados) > LIMITE:
        raise HTTPException(413, "Print acima de 900 KB. Envie de novo: o sistema reduz a imagem antes de mandar.")
    for prefixo, mime in _ASSINATURAS.items():
        if dados.startswith(prefixo) and (mime != "image/webp" or dados[8:12] == b"WEBP"):
            return dados, mime
    raise HTTPException(415, "Envie a imagem em JPG, PNG ou WEBP")


def pode_ver(principal: Principal, doc: dict) -> bool:
    return principal.is_admin or (bool(principal.pessoa_id) and doc.get("autor_pessoa_id") == principal.pessoa_id) \
        or doc.get("autor_usuario_id") == principal.usuario_id


async def gravar(itens: list, *, negocio_id: str | None, atividade: dict | None, principal: Principal | None = None,
                 autor_pessoa_id: str | None = None, autor_nome: str | None = None, extra: dict | None = None) -> list[str]:
    """Valida tudo antes de gravar qualquer coisa: ou entram todos, ou nenhum."""
    prontos = [(i.nome if isinstance(i, AnexoIn) else i["nome"], *decodificar(i)) for i in itens]
    ids = []
    for nome, dados, mime in prontos:
        aid = new_id()
        await db.anexos.insert_one({
            "id": aid, "negocio_id": negocio_id, "atividade_id": (atividade or {}).get("id"),
            "atividade_assunto": (atividade or {}).get("assunto"), "nome": nome.strip()[:200], "mime": mime, "dados": dados,
            "tamanho": len(dados), "autor_usuario_id": principal.usuario_id if principal else None,
            "autor_pessoa_id": principal.pessoa_id if principal else autor_pessoa_id,
            "autor_nome": principal.nome if principal else autor_nome, "created_at": now_utc(), **(extra or {}),
        })
        ids.append(aid)
    return ids


async def exigir_print(atividade: dict, novos: int = 0) -> None:
    """Com `crm.print_obrigatorio`, contato e reunião ligados a um negócio só concluem com print."""
    if atividade.get("tipo") not in TIPOS_COM_PRINT or not atividade.get("negocio_id"):
        return
    from lib.crm import carregar_crm_config

    if not (await carregar_crm_config()).print_obrigatorio:
        return
    if novos or (atividade.get("id") and await db.anexos.count_documents({"atividade_id": atividade["id"]})):
        return
    raise HTTPException(422, "Anexe o print do contato para concluir esta atividade.")


def _saida(d: dict) -> Anexo:
    return Anexo(id=d["id"], negocio_id=d.get("negocio_id"), atividade_id=d.get("atividade_id"), atividade_assunto=d.get("atividade_assunto"),
                 nome=d.get("nome") or "print", mime=d.get("mime") or "image/jpeg", tamanho=d.get("tamanho") or 0,
                 autor_nome=d.get("autor_nome"), autor_pessoa_id=d.get("autor_pessoa_id"), url=f"/api/anexos/{d['id']}",
                 created_at=utc_aware(d.get("created_at")) or now_utc())


async def _negocio(negocio_id: str, principal: Principal) -> dict:
    neg = await db.leads.find_one({"id": negocio_id}, {"id": 1, "corretor_id": 1, "praca": 1, "supervisao_id": 1, "unidade_id": 1, "nome": 1})
    if not neg:
        raise HTTPException(404, "Negócio não encontrado")
    authorize(principal, "lead:read", neg)
    return neg


@router.get("/leads/{negocio_id}/anexos", response_model=List[Anexo])
async def listar(negocio_id: str, principal: Principal = Depends(require("lead:read"))):
    await _negocio(negocio_id, principal)
    docs = await db.anexos.find({"negocio_id": negocio_id}, {"dados": 0}).to_list(MAX_POR_NEGOCIO * 2)
    docs.sort(key=lambda d: utc_aware(d.get("created_at")) or now_utc(), reverse=True)
    return [_saida(d) for d in docs if pode_ver(principal, d)]


@router.post("/leads/{negocio_id}/anexos", response_model=Anexo, status_code=201)
async def anexar_no_negocio(negocio_id: str, input: AnexoNegocioIn, principal: Principal = Depends(require("atividade:write"))):
    await _negocio(negocio_id, principal)
    if await db.anexos.count_documents({"negocio_id": negocio_id}) >= MAX_POR_NEGOCIO:
        raise HTTPException(422, f"Cada negócio guarda até {MAX_POR_NEGOCIO} prints")
    atividade = None
    if input.atividade_id:
        atividade = await db.atividades.find_one({"id": input.atividade_id, "negocio_id": negocio_id})
        if not atividade:
            raise HTTPException(404, "Atividade não encontrada neste negócio")
    [aid] = await gravar([input], negocio_id=negocio_id, atividade=atividade, principal=principal)
    return _saida(await db.anexos.find_one({"id": aid}, {"dados": 0}))


@router.post("/atividades/{atividade_id}/anexos", response_model=Anexo, status_code=201)
async def anexar_na_atividade(atividade_id: str, input: AnexoIn, principal: Principal = Depends(require("atividade:write"))):
    atividade = await db.atividades.find_one({"id": atividade_id})
    if not atividade:
        raise HTTPException(404, "Atividade não encontrada")
    authorize(principal, "atividade:write", atividade)
    if await db.anexos.count_documents({"atividade_id": atividade_id}) >= MAX_POR_ATIVIDADE:
        raise HTTPException(422, f"Cada atividade guarda até {MAX_POR_ATIVIDADE} prints")
    [aid] = await gravar([input], negocio_id=atividade.get("negocio_id"), atividade=atividade, principal=principal)
    return _saida(await db.anexos.find_one({"id": aid}, {"dados": 0}))


@router.get("/anexos/{anexo_id}")
async def imagem(anexo_id: str, principal: Principal = Depends(require("lead:read"))):
    doc = await db.anexos.find_one({"id": anexo_id})
    if not doc or not pode_ver(principal, doc):
        raise HTTPException(404, "Print não encontrado")
    return Response(bytes(doc["dados"]), media_type=doc.get("mime", "image/jpeg"),
                    headers={"Cache-Control": "private, max-age=3600", "Content-Disposition": f'inline; filename="{anexo_id}"'})


@router.delete("/anexos/{anexo_id}", status_code=204)
async def excluir(anexo_id: str, principal: Principal = Depends(require("atividade:write"))):
    doc = await db.anexos.find_one({"id": anexo_id}, {"dados": 0})
    if not doc or not pode_ver(principal, doc):
        raise HTTPException(404, "Print não encontrado")
    await db.anexos.delete_one({"id": anexo_id})
    return None
