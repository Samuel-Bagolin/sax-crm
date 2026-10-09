"""Documentos do negócio e do contrato: enviar do computador, escolher no Google Drive, abrir,
compartilhar com o cliente pelo Drive e salvar o contrato assinado no Drive.

Armazenamento: se o usuário conectou o Google, o arquivo vai para a pasta "SAX CRM/<negócio>" no
Drive DELE; sem Google, fica no próprio CRM (até 8 MB). O CRM guarda só o vínculo e os metadados.
"""

import base64
import re
from datetime import datetime
from typing import List, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, EmailStr, Field

from lib import google
from lib.auth import Principal, authorize, require
from lib.crm import registrar
from lib.db import db
from models.common import new_id, now_utc, utc_aware

router = APIRouter(tags=["documentos"])

# No Vercel o corpo de uma requisição é limitado a 4,5 MB; num servidor contínuo os limites são maiores.
_SERVERLESS = bool(__import__("os").environ.get("VERCEL"))
LIMITE_CRM = (4 if _SERVERLESS else 8) * 1024 * 1024
LIMITE_DRIVE = (4 if _SERVERLESS else 25) * 1024 * 1024
TIPOS_PERMITIDOS = re.compile(r"^(application/pdf|image/(png|jpeg|webp|heic)|application/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|zip)|text/plain|application/vnd\.google-apps\.[a-z]+)$")


class Documento(BaseModel):
    id: str = Field(default_factory=new_id)
    negocio_id: str | None = None
    contrato_id: str | None = None
    nome: str
    mime: str
    tamanho: int | None = None
    armazenamento: Literal["drive", "crm"]
    drive_file_id: str | None = None
    drive_link: str | None = None
    drive_dono: str | None = None  # usuario_id de quem tem o arquivo no Drive
    criado_por: str | None = None
    criado_por_nome: str | None = None
    compartilhado_com: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=now_utc)


class DriveInput(BaseModel):
    file_id: str = Field(min_length=5, max_length=200)
    negocio_id: str | None = None
    contrato_id: str | None = None


class CompartilharInput(BaseModel):
    email: EmailStr
    mensagem: str = Field(default="", max_length=900)


def _doc(d: dict) -> Documento:
    data = {k: v for k, v in d.items() if k in Documento.model_fields}
    data["created_at"] = utc_aware(data.get("created_at"))
    return Documento(**data)


async def _alvo(principal: Principal, negocio_id: str | None, contrato_id: str | None) -> tuple[dict | None, dict | None]:
    if not negocio_id and not contrato_id:
        raise HTTPException(422, "Informe o negócio ou o contrato")
    negocio = contrato = None
    if negocio_id:
        negocio = await db.leads.find_one({"id": negocio_id})
        if not negocio:
            raise HTTPException(404, "Negócio não encontrado")
        authorize(principal, "lead:read", negocio)
    if contrato_id:
        contrato = await db.contratos.find_one({"id": contrato_id})
        if not contrato:
            raise HTTPException(404, "Contrato não encontrado")
        authorize(principal, "contrato:read", contrato)
    return negocio, contrato


async def _carregar(doc_id: str, principal: Principal) -> dict:
    d = await db.documentos.find_one({"id": doc_id})
    if not d:
        raise HTTPException(404, "Documento não encontrado")
    await _alvo(principal, d.get("negocio_id"), d.get("contrato_id"))
    return d


def _nome_pasta(negocio: dict | None, contrato: dict | None) -> str:
    base = (contrato or {}).get("numero") or (negocio or {}).get("nome") or "Documentos"
    return re.sub(r"[\\/:*?\"<>|']", " ", base)[:80].strip() or "Documentos"


async def _pasta_drive(usuario_id: str, negocio: dict | None, contrato: dict | None) -> str:
    raiz = await google.pasta(usuario_id, "SAX CRM")
    return await google.pasta(usuario_id, _nome_pasta(negocio, contrato), raiz)


@router.get("/documentos", response_model=List[Documento])
async def listar(negocio_id: str | None = None, contrato_id: str | None = None, principal: Principal = Depends(require("lead:read"))):
    await _alvo(principal, negocio_id, contrato_id)
    filtro = {"negocio_id": negocio_id} if negocio_id else {"contrato_id": contrato_id}
    if negocio_id:
        # documentos do contrato gerado a partir do negócio também aparecem no negócio
        contratos = [c["id"] async for c in db.contratos.find({"lead_id": negocio_id}, {"id": 1})]
        filtro = {"$or": [{"negocio_id": negocio_id}, {"contrato_id": {"$in": contratos}}]}
    docs = await db.documentos.find(filtro, {"conteudo": 0}).sort("created_at", -1).to_list(500)
    return [_doc(d) for d in docs]


@router.post("/documentos/upload", response_model=Documento, status_code=201)
async def upload(
    arquivo: UploadFile = File(...),
    negocio_id: str | None = Form(None),
    contrato_id: str | None = Form(None),
    principal: Principal = Depends(require("lead:read")),
):
    negocio, contrato = await _alvo(principal, negocio_id, contrato_id)
    mime = (arquivo.content_type or "application/octet-stream").lower()
    if not TIPOS_PERMITIDOS.match(mime):
        raise HTTPException(415, "Tipo de arquivo não aceito. Envie PDF, imagem, Word, Excel ou ZIP.")
    conteudo = await arquivo.read(LIMITE_DRIVE + 1)
    nome = re.sub(r"[\r\n]", " ", arquivo.filename or "documento")[:200]
    tem_google = bool(await google.conta(principal.usuario_id))
    doc = Documento(negocio_id=negocio_id, contrato_id=contrato_id, nome=nome, mime=mime, tamanho=len(conteudo),
                    armazenamento="drive" if tem_google else "crm", criado_por=principal.usuario_id, criado_por_nome=principal.nome)
    registro = doc.model_dump()
    if tem_google:
        if len(conteudo) > LIMITE_DRIVE:
            raise HTTPException(413, f"Arquivo acima de {LIMITE_DRIVE // (1024 * 1024)} MB. Envie direto pelo Google Drive e use “Do Google Drive”.")
        pasta = await _pasta_drive(principal.usuario_id, negocio, contrato)
        meta = await google.enviar_arquivo(principal.usuario_id, nome, mime, conteudo, pasta)
        registro.update(drive_file_id=meta["id"], drive_link=meta.get("webViewLink"), drive_dono=principal.usuario_id)
    else:
        if len(conteudo) > LIMITE_CRM:
            raise HTTPException(413, f"Arquivo acima de {LIMITE_CRM // (1024 * 1024)} MB. Envie pelo Google Drive e use “Do Google Drive”.")
        registro["conteudo"] = base64.b64encode(conteudo).decode()
    await db.documentos.insert_one(registro)
    if negocio_id:
        await registrar(negocio_id, "campo", f"Documento anexado: {nome}", principal)
    return _doc(registro)


@router.post("/documentos/drive", response_model=Documento, status_code=201)
async def do_drive(input: DriveInput, principal: Principal = Depends(require("lead:read"))):
    """Vincula um arquivo escolhido no seletor do Google Drive (o Drive concede acesso ao app)."""
    await _alvo(principal, input.negocio_id, input.contrato_id)
    meta = await google.metadados(principal.usuario_id, input.file_id)
    doc = Documento(negocio_id=input.negocio_id, contrato_id=input.contrato_id, nome=meta.get("name", "Arquivo do Drive")[:200],
                    mime=meta.get("mimeType", "application/octet-stream"), tamanho=int(meta["size"]) if meta.get("size") else None,
                    armazenamento="drive", drive_file_id=meta["id"], drive_link=meta.get("webViewLink"), drive_dono=principal.usuario_id,
                    criado_por=principal.usuario_id, criado_por_nome=principal.nome)
    await db.documentos.insert_one(doc.model_dump())
    if input.negocio_id:
        await registrar(input.negocio_id, "campo", f"Documento do Google Drive vinculado: {doc.nome}", principal)
    return doc


@router.get("/documentos/{doc_id}/abrir")
async def abrir(doc_id: str, principal: Principal = Depends(require("lead:read"))):
    d = await db.documentos.find_one({"id": doc_id})
    if not d:
        raise HTTPException(404, "Documento não encontrado")
    await _alvo(principal, d.get("negocio_id"), d.get("contrato_id"))
    if d["armazenamento"] == "drive":
        if not d.get("drive_link"):
            raise HTTPException(404, "Link do Drive indisponível")
        return RedirectResponse(d["drive_link"])
    nome = re.sub(r'[^\w.\- ]', "_", d["nome"])
    return Response(base64.b64decode(d["conteudo"]), media_type=d["mime"],
                    headers={"Content-Disposition": f'inline; filename="{nome}"', "Cache-Control": "private, no-store"})


@router.post("/documentos/{doc_id}/enviar-drive", response_model=Documento)
async def enviar_para_drive(doc_id: str, principal: Principal = Depends(require("lead:read"))):
    d = await _carregar(doc_id, principal)
    if d["armazenamento"] == "drive":
        return _doc(d)
    negocio, contrato = await _alvo(principal, d.get("negocio_id"), d.get("contrato_id"))
    pasta = await _pasta_drive(principal.usuario_id, negocio, contrato)
    meta = await google.enviar_arquivo(principal.usuario_id, d["nome"], d["mime"], base64.b64decode(d["conteudo"]), pasta)
    await db.documentos.update_one({"id": doc_id}, {"$set": {"armazenamento": "drive", "drive_file_id": meta["id"],
                                                               "drive_link": meta.get("webViewLink"), "drive_dono": principal.usuario_id},
                                                      "$unset": {"conteudo": ""}})
    return _doc(await db.documentos.find_one({"id": doc_id}, {"conteudo": 0}))


@router.post("/documentos/{doc_id}/compartilhar", response_model=Documento)
async def compartilhar(doc_id: str, input: CompartilharInput, principal: Principal = Depends(require("lead:read"))):
    """Compartilha pelo Google Drive (somente leitura). O Google envia o e-mail com o link ao cliente."""
    d = await _carregar(doc_id, principal)
    if d["armazenamento"] != "drive" or not d.get("drive_file_id"):
        raise HTTPException(409, "Envie o arquivo para o Google Drive antes de compartilhar")
    dono = d.get("drive_dono") or principal.usuario_id
    if dono != principal.usuario_id and not principal.is_admin:
        raise HTTPException(403, "Só quem enviou o arquivo ao Drive pode compartilhá-lo")
    msg = input.mensagem.strip() or f"{principal.nome} compartilhou um documento com você."
    await google.compartilhar(dono, d["drive_file_id"], str(input.email), msg)
    await db.documentos.update_one({"id": doc_id}, {"$addToSet": {"compartilhado_com": str(input.email).lower()}})
    if d.get("negocio_id"):
        await registrar(d["negocio_id"], "campo", f"Documento {d['nome']} compartilhado com {input.email}", principal)
    return _doc(await db.documentos.find_one({"id": doc_id}, {"conteudo": 0}))


@router.delete("/documentos/{doc_id}", status_code=204)
async def excluir(doc_id: str, principal: Principal = Depends(require("lead:read"))):
    d = await _carregar(doc_id, principal)
    if d.get("criado_por") != principal.usuario_id and not principal.is_admin:
        raise HTTPException(403, "Só quem anexou ou o gestor pode remover")
    await db.documentos.delete_one({"id": doc_id})  # no Drive o arquivo continua com o dono
    return None


@router.post("/contratos/{contrato_id}/drive", response_model=Documento, status_code=201)
async def contrato_no_drive(contrato_id: str, principal: Principal = Depends(require("assinatura:manage"))):
    """Salva o PDF atual do contrato (com página de assinaturas e auditoria) no Drive do usuário."""
    from routers.assinaturas import _pdf
    negocio, contrato = await _alvo(principal, None, contrato_id)
    pdf = await _pdf(contrato)
    status = contrato.get("assinatura_status") or "rascunho"
    nome = f"{contrato['numero']} - {'assinado' if status == 'assinado' else 'para assinatura'}.pdf"
    pasta = await _pasta_drive(principal.usuario_id, None, contrato)
    meta = await google.enviar_arquivo(principal.usuario_id, nome, "application/pdf", pdf, pasta)
    doc = Documento(contrato_id=contrato_id, negocio_id=contrato.get("lead_id"), nome=nome, mime="application/pdf", tamanho=len(pdf),
                    armazenamento="drive", drive_file_id=meta["id"], drive_link=meta.get("webViewLink"), drive_dono=principal.usuario_id,
                    criado_por=principal.usuario_id, criado_por_nome=principal.nome)
    await db.documentos.insert_one(doc.model_dump())
    return doc
