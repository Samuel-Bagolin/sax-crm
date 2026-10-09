"""Assinatura eletrônica de contratos por link + modelos de contrato.

Fluxo: gera o documento a partir de um modelo → cadastra os signatários → cada um recebe um
link único (`/assinar/<token>`) → abre, lê, desenha/digita a assinatura e aceita → o sistema
registra data/hora, IP, navegador e o hash SHA-256 do texto. Quando todos assinam, o contrato
fica "assinado" e o PDF traz a página de assinaturas e a trilha de auditoria.

O link é público (sem login). O token identifica a empresa pelo índice no banco de CONTROLE,
então nenhum dado de outra empresa é alcançável.
"""

import base64
import binascii
import hashlib
import re
import secrets
from datetime import datetime
from html import escape
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from lib.auth import Principal, authorize, require
from lib.crm import registrar
from lib.db import controle, db, definir_empresa, empresa_atual_db
from lib.integrity import audit
from lib.modelos_padrao import MODELOS_PADRAO, VARIAVEIS
from lib.pdf import gerar_contrato_pdf
from models.assinaturas import (
    AssinarInput, DocumentoContrato, DocumentoInput, DocumentoPublico, EventoAssinatura, GerarDocumentoInput,
    ModeloContrato, ModeloInput, PainelAssinatura, RecusarInput, Signatario, SignatarioInput, SignatarioPublico,
)
from models.common import now_utc, utc_aware

router = APIRouter(tags=["assinaturas"])
publico_router = APIRouter(prefix="/assinatura", tags=["assinaturas-publico"])

PAPEL_LABEL = {
    "comprador": "Comprador(a)", "vendedor": "Vendedor(a)", "locatario": "Locatário(a)", "locador": "Locador(a)",
    "fiador": "Fiador(a)", "testemunha": "Testemunha", "imobiliaria": "Imobiliária", "corretor": "Corretor(a)", "outro": "Signatário(a)",
}


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _hash_texto(titulo: str, texto: str) -> str:
    return hashlib.sha256(f"{titulo}\n\n{texto}".encode("utf-8")).hexdigest()


def _brl(v) -> str:
    if v is None:
        return "—"
    return "R$ " + f"{float(v):,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _data(iso: str | None) -> str:
    return f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}" if iso else "—"


COR_SAX = "#4a03a2"


def _cor(config: dict) -> str:
    """Cor da marca no link e no PDF; padrões antigos do sistema viram o roxo SAX."""
    cor = (config.get("cor_primaria") or "").lower()
    return COR_SAX if not cor or cor in ("#0b6b5a", "#0284c7", "#5b2bd0") else cor


def _ip(request: Request) -> str:
    # Mesmo critério do rate limit: o peer da conexão; o ingress confiável pode repassar X-Forwarded-For.
    # O último item é o que o ingress confiável acrescentou; os anteriores podem vir do cliente.
    encaminhado = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
    return encaminhado or (request.client.host if request.client else "desconhecido")


def _sig(doc: dict) -> Signatario:
    data = {k: v for k, v in doc.items() if k in Signatario.model_fields}
    for k in ("visualizado_em", "assinado_em", "recusado_em", "enviado_em"):
        data[k] = utc_aware(data.get(k))
    data["tem_assinatura"] = bool(doc.get("assinatura_png"))
    return Signatario(**data)


def _status(contrato: dict) -> str:
    sigs = contrato.get("signatarios") or []
    if not sigs or not (contrato.get("documento") or {}).get("texto"):
        return "rascunho"
    if any(s.get("status") == "recusado" for s in sigs):
        return "recusado"
    if all(s.get("status") == "assinado" for s in sigs):
        return "assinado"
    return "aguardando"


def _bloqueado(contrato: dict) -> bool:
    return any(s.get("status") == "assinado" for s in contrato.get("signatarios") or [])


def _painel(contrato: dict) -> PainelAssinatura:
    doc = contrato.get("documento")
    documento = None
    if doc:
        documento = DocumentoContrato(**{**doc, "atualizado_em": utc_aware(doc.get("atualizado_em"))})
    return PainelAssinatura(
        contrato_id=contrato["id"], numero=contrato["numero"], status=_status(contrato), documento=documento,
        signatarios=[_sig(s) for s in contrato.get("signatarios") or []],
        eventos=[EventoAssinatura(em=utc_aware(e["em"]), texto=e["texto"], ip=e.get("ip")) for e in contrato.get("assinatura_eventos") or []],
        bloqueado=_bloqueado(contrato),
    )


async def _contrato(contrato_id: str, principal: Principal) -> dict:
    doc = await db.contratos.find_one({"id": contrato_id})
    if not doc:
        raise HTTPException(404, "Contrato não encontrado")
    authorize(principal, "contrato:read", doc)
    return doc


async def _evento(contrato_id: str, texto: str, ip: str | None = None) -> None:
    await db.contratos.update_one({"id": contrato_id}, {"$push": {"assinatura_eventos": {"em": now_utc(), "texto": texto, "ip": ip}}})


async def _atualizar_status(contrato_id: str) -> dict:
    doc = await db.contratos.find_one({"id": contrato_id})
    status = _status(doc)
    if status != doc.get("assinatura_status"):
        await db.contratos.update_one({"id": contrato_id}, {"$set": {"assinatura_status": status, "updated_at": now_utc()}})
        if status == "assinado":
            await _evento(contrato_id, "Documento assinado por todas as partes")
            if doc.get("lead_id"):
                await registrar(doc["lead_id"], "assinatura", f"Contrato {doc['numero']} assinado por todas as partes")
        doc = await db.contratos.find_one({"id": contrato_id})
    return doc


# ================================================================== modelos de contrato


def _modelo(doc: dict) -> ModeloContrato:
    data = {k: v for k, v in doc.items() if k in ModeloContrato.model_fields}
    data["created_at"] = utc_aware(data.get("created_at"))
    data["updated_at"] = utc_aware(data.get("updated_at"))
    return ModeloContrato(**data)


@router.get("/modelos-contrato", response_model=List[ModeloContrato])
async def list_modelos(principal: Principal = Depends(require("modelo:read"))):
    if await db.modelos_contrato.count_documents({}) == 0:
        await db.modelos_contrato.insert_many([ModeloContrato(nome=n, tipo=t, texto=x).model_dump() for n, t, x in MODELOS_PADRAO])
    return [_modelo(d) for d in await db.modelos_contrato.find({}).sort("nome", 1).to_list(None)]


@router.get("/modelos-contrato/variaveis")
async def variaveis(principal: Principal = Depends(require("modelo:read"))):
    return [{"chave": k, "descricao": d} for k, d in VARIAVEIS]


@router.post("/modelos-contrato", response_model=ModeloContrato, status_code=201)
async def criar_modelo(input: ModeloInput, principal: Principal = Depends(require("modelo:write"))):
    modelo = ModeloContrato(**input.model_dump())
    await db.modelos_contrato.insert_one(modelo.model_dump())
    return modelo


@router.put("/modelos-contrato/{modelo_id}", response_model=ModeloContrato)
async def editar_modelo(modelo_id: str, input: ModeloInput, principal: Principal = Depends(require("modelo:write"))):
    if not await db.modelos_contrato.find_one({"id": modelo_id}):
        raise HTTPException(404, "Modelo não encontrado")
    await db.modelos_contrato.update_one({"id": modelo_id}, {"$set": {**input.model_dump(), "updated_at": now_utc()}})
    return _modelo(await db.modelos_contrato.find_one({"id": modelo_id}))


@router.delete("/modelos-contrato/{modelo_id}", status_code=204)
async def excluir_modelo(modelo_id: str, principal: Principal = Depends(require("modelo:write"))):
    await db.modelos_contrato.delete_one({"id": modelo_id})
    return None


async def _variaveis_contrato(contrato: dict) -> dict[str, str]:
    async def pessoa(pid):
        return (await db.pessoas.find_one({"id": pid})) if pid else None

    cliente, prop, corretor = await pessoa(contrato.get("cliente_id")), await pessoa(contrato.get("proprietario_id")), await pessoa(contrato.get("corretor_id"))
    imovel = await db.imoveis.find_one({"id": contrato.get("imovel_id")}) or {}
    config = await db.configuracoes.find_one({"id": "singleton"}, {"nome_software": 1}) or {}
    empresa = await controle.empresas.find_one({"db_name": empresa_atual_db()}, {"nome": 1}) if empresa_atual_db() else None
    endereco = ", ".join(x for x in (imovel.get("endereco"), imovel.get("bairro"), imovel.get("cidade"), imovel.get("estado"), imovel.get("cep")) if x)
    hoje = now_utc().strftime("%Y-%m-%d")
    return {
        "empresa_nome": (empresa or {}).get("nome") or config.get("nome_software") or "Imobiliária",
        "contrato_numero": contrato.get("numero", ""),
        "data_hoje": _data(hoje),
        "cliente_nome": (cliente or {}).get("nome") or "____________",
        "cliente_cpf": (cliente or {}).get("cpf_cnpj") or "____________",
        "cliente_email": (cliente or {}).get("email") or "____________",
        "cliente_telefone": (cliente or {}).get("telefone") or "____________",
        "proprietario_nome": (prop or {}).get("nome") or "____________",
        "proprietario_cpf": (prop or {}).get("cpf_cnpj") or "____________",
        "corretor_nome": (corretor or {}).get("nome") or "____________",
        "imovel_codigo": imovel.get("codigo") or "—",
        "imovel_titulo": imovel.get("titulo") or "—",
        "imovel_endereco": endereco or "—",
        "imovel_cidade": imovel.get("cidade") or "____________",
        "valor": _brl(contrato.get("valor")),
        "comissao_pct": f"{contrato.get('comissao_pct', 0):g}".replace(".", ","),
        "taxa_admin_pct": f"{contrato.get('taxa_admin_pct', 0):g}".replace(".", ","),
        "inicio": _data(contrato.get("inicio")),
        "fim": _data(contrato.get("fim")),
        "dia_vencimento": str(contrato.get("dia_vencimento", "")),
        "parcelas": str(contrato.get("parcelas", "")),
    }


def _preencher(texto: str, valores: dict[str, str]) -> str:
    return re.sub(r"\{\{\s*([a-z_]+)\s*\}\}", lambda m: valores.get(m.group(1), m.group(0)), texto)


# ================================================================== painel do contrato (autenticado)


@router.get("/contratos/{contrato_id}/assinatura", response_model=PainelAssinatura)
async def painel(contrato_id: str, principal: Principal = Depends(require("assinatura:manage"))):
    return _painel(await _contrato(contrato_id, principal))


@router.post("/contratos/{contrato_id}/documento/gerar", response_model=PainelAssinatura)
async def gerar_documento(contrato_id: str, input: GerarDocumentoInput, principal: Principal = Depends(require("assinatura:manage"))):
    contrato = await _contrato(contrato_id, principal)
    if _bloqueado(contrato):
        raise HTTPException(409, "Documento já possui assinatura e não pode ser alterado")
    await list_modelos(principal)
    modelo = await db.modelos_contrato.find_one({"id": input.modelo_id})
    if not modelo:
        raise HTTPException(404, "Modelo não encontrado")
    texto = _preencher(modelo["texto"], await _variaveis_contrato(contrato))
    titulo = modelo["nome"]
    documento = {"titulo": titulo, "texto": texto, "hash": _hash_texto(titulo, texto), "modelo_id": modelo["id"], "atualizado_em": now_utc()}
    await db.contratos.update_one({"id": contrato_id}, {"$set": {"documento": documento}})
    await _evento(contrato_id, f"Documento gerado a partir do modelo “{titulo}” por {principal.nome}")
    return _painel(await _atualizar_status(contrato_id))


@router.put("/contratos/{contrato_id}/documento", response_model=PainelAssinatura)
async def salvar_documento(contrato_id: str, input: DocumentoInput, principal: Principal = Depends(require("assinatura:manage"))):
    contrato = await _contrato(contrato_id, principal)
    if _bloqueado(contrato):
        raise HTTPException(409, "Documento já possui assinatura e não pode ser alterado")
    anterior = (contrato.get("documento") or {})
    documento = {**anterior, "titulo": input.titulo.strip(), "texto": input.texto, "hash": _hash_texto(input.titulo.strip(), input.texto), "atualizado_em": now_utc()}
    await db.contratos.update_one({"id": contrato_id}, {"$set": {"documento": documento}})
    if anterior.get("hash") != documento["hash"]:
        await _evento(contrato_id, f"Texto do documento editado por {principal.nome}")
    return _painel(await _atualizar_status(contrato_id))


@router.post("/contratos/{contrato_id}/signatarios", response_model=PainelAssinatura)
async def adicionar_signatario(contrato_id: str, input: SignatarioInput, principal: Principal = Depends(require("assinatura:manage"))):
    contrato = await _contrato(contrato_id, principal)
    if len(contrato.get("signatarios") or []) >= 12:
        raise HTTPException(409, "Limite de 12 signatários por contrato")
    token = secrets.token_urlsafe(24)
    sig = Signatario(**input.model_dump(), token=token)
    sig.email = (sig.email or "").strip().lower() or None
    await controle.assinaturas_index.insert_one({"_id": _digest(token), "db_name": empresa_atual_db(), "contrato_id": contrato_id, "signatario_id": sig.id, "em": now_utc()})
    await db.contratos.update_one({"id": contrato_id}, {"$push": {"signatarios": {**sig.model_dump(), "assinatura_png": None}}})
    await _evento(contrato_id, f"Signatário adicionado: {sig.nome} ({PAPEL_LABEL[sig.papel]})")
    return _painel(await _atualizar_status(contrato_id))


@router.post("/contratos/{contrato_id}/signatarios/partes", response_model=PainelAssinatura)
async def adicionar_partes(contrato_id: str, principal: Principal = Depends(require("assinatura:manage"))):
    """Atalho: inclui cliente e proprietário do contrato como signatários (com papéis certos)."""
    contrato = await _contrato(contrato_id, principal)
    existentes = {(s.get("nome") or "").lower() for s in contrato.get("signatarios") or []}
    venda = contrato.get("tipo") == "venda"
    for campo, papel in (("cliente_id", "comprador" if venda else "locatario"), ("proprietario_id", "vendedor" if venda else "locador")):
        pessoa = await db.pessoas.find_one({"id": contrato.get(campo)}) if contrato.get(campo) else None
        if pessoa and pessoa["nome"].lower() not in existentes:
            await adicionar_signatario(contrato_id, SignatarioInput(nome=pessoa["nome"], email=pessoa.get("email"),
                                       telefone=pessoa.get("telefone"), cpf=pessoa.get("cpf_cnpj"), papel=papel), principal)
    return _painel(await _atualizar_status(contrato_id))


def _achar_sig(contrato: dict, sig_id: str) -> dict:
    for s in contrato.get("signatarios") or []:
        if s["id"] == sig_id:
            return s
    raise HTTPException(404, "Signatário não encontrado")


@router.delete("/contratos/{contrato_id}/signatarios/{sig_id}", response_model=PainelAssinatura)
async def remover_signatario(contrato_id: str, sig_id: str, principal: Principal = Depends(require("assinatura:manage"))):
    contrato = await _contrato(contrato_id, principal)
    sig = _achar_sig(contrato, sig_id)
    if sig.get("status") == "assinado":
        raise HTTPException(409, "Signatário que já assinou não pode ser removido")
    await db.contratos.update_one({"id": contrato_id}, {"$pull": {"signatarios": {"id": sig_id}}})
    if sig.get("token"):
        await controle.assinaturas_index.delete_one({"_id": _digest(sig["token"])})
    await _evento(contrato_id, f"Signatário removido: {sig['nome']}")
    return _painel(await _atualizar_status(contrato_id))


@router.post("/contratos/{contrato_id}/signatarios/{sig_id}/novo-link", response_model=PainelAssinatura)
async def novo_link(contrato_id: str, sig_id: str, principal: Principal = Depends(require("assinatura:manage"))):
    contrato = await _contrato(contrato_id, principal)
    sig = _achar_sig(contrato, sig_id)
    if sig.get("status") == "assinado":
        raise HTTPException(409, "Este signatário já assinou")
    if sig.get("token"):
        await controle.assinaturas_index.delete_one({"_id": _digest(sig["token"])})
    token = secrets.token_urlsafe(24)
    await controle.assinaturas_index.insert_one({"_id": _digest(token), "db_name": empresa_atual_db(), "contrato_id": contrato_id, "signatario_id": sig_id, "em": now_utc()})
    await db.contratos.update_one({"id": contrato_id, "signatarios.id": sig_id}, {"$set": {
        "signatarios.$.token": token, "signatarios.$.status": "pendente", "signatarios.$.recusado_em": None, "signatarios.$.motivo_recusa": None}})
    await _evento(contrato_id, f"Novo link gerado para {sig['nome']} (o anterior deixou de funcionar)")
    return _painel(await _atualizar_status(contrato_id))


@router.post("/contratos/{contrato_id}/signatarios/{sig_id}/enviado", response_model=PainelAssinatura)
async def marcar_enviado(contrato_id: str, sig_id: str, canal: str = "link", principal: Principal = Depends(require("assinatura:manage"))):
    contrato = await _contrato(contrato_id, principal)
    sig = _achar_sig(contrato, sig_id)
    await db.contratos.update_one({"id": contrato_id, "signatarios.id": sig_id}, {"$set": {"signatarios.$.enviado_em": now_utc()}})
    rotulo = {"whatsapp": "WhatsApp", "email": "e-mail", "link": "link copiado"}.get(canal, canal)
    await _evento(contrato_id, f"Link de assinatura enviado para {sig['nome']} via {rotulo}")
    return _painel(await db.contratos.find_one({"id": contrato_id}))


@router.post("/contratos/{contrato_id}/signatarios/{sig_id}/email", response_model=PainelAssinatura)
async def enviar_email(contrato_id: str, sig_id: str, principal: Principal = Depends(require("assinatura:manage"))):
    from lib.email import send_email
    from lib.invites import app_url

    contrato = await _contrato(contrato_id, principal)
    sig = _achar_sig(contrato, sig_id)
    if not sig.get("email"):
        raise HTTPException(422, "Signatário sem e-mail cadastrado")
    if not (contrato.get("documento") or {}).get("texto"):
        raise HTTPException(409, "Gere o documento antes de enviar")
    url = f"{app_url()}/assinar/{sig['token']}"
    variaveis = await _variaveis_contrato(contrato)
    html = (
        "<table role='presentation' width='100%'><tr><td style=\"padding:24px;font-family:Arial,sans-serif;color:#1c1c1c\">"
        f"<h2 style='margin:0 0 12px'>Documento para assinatura</h2>"
        f"<p>Olá {escape(sig['nome'])}, {escape(variaveis['empresa_nome'])} enviou o contrato <strong>{escape(contrato['numero'])}</strong> para você assinar.</p>"
        f"<p><a href='{url}' style='display:inline-block;background:#4a03a2;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none'>Ler e assinar o documento</a></p>"
        "<p style='font-size:12px;color:#888'>O link é pessoal. Nunca pedimos senhas ou dados de cartão por e-mail.</p>"
        "</td></tr></table>"
    )
    await send_email(to=sig["email"], subject=f"Assinatura do contrato {contrato['numero']}", html=html)
    return await marcar_enviado(contrato_id, sig_id, "email", principal)


async def _pdf(contrato: dict) -> bytes:
    documento = contrato.get("documento") or {}
    if not documento.get("texto"):
        raise HTTPException(409, "Contrato sem documento gerado")
    config = await db.configuracoes.find_one({"id": "singleton"}) or {}
    variaveis = await _variaveis_contrato(contrato)
    signatarios = []
    for s in contrato.get("signatarios") or []:
        png = None
        if s.get("assinatura_png"):
            try:
                png = base64.b64decode(s["assinatura_png"])
            except Exception:
                png = None
        rotulo_status = {"assinado": "Assinou", "pendente": "Pendente", "visualizado": "Abriu, não assinou", "recusado": "Recusou"}.get(s.get("status"), s.get("status"))
        signatarios.append({**s, "status": rotulo_status, "papel": PAPEL_LABEL.get(s.get("papel"), s.get("papel")), "png": png,
                            "assinado_em": utc_aware(s.get("assinado_em"))})
    eventos = [{**e, "em": utc_aware(e.get("em"))} for e in contrato.get("assinatura_eventos") or []]
    return gerar_contrato_pdf(
        empresa=variaveis["empresa_nome"], numero=contrato["numero"], titulo=documento.get("titulo", "Contrato"),
        texto=documento["texto"], hash_documento=documento.get("hash") or "", signatarios=signatarios, eventos=eventos,
        cor_primaria=_cor(config), logo_base64=config.get("logo_base64"),
    )


@router.get("/contratos/{contrato_id}/documento.pdf")
async def pdf_contrato(contrato_id: str, principal: Principal = Depends(require("assinatura:manage"))):
    contrato = await _contrato(contrato_id, principal)
    return Response(await _pdf(contrato), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={contrato['numero']}.pdf"})


# ================================================================== página pública de assinatura


async def _resolver(token: str) -> tuple[dict, dict]:
    if not token or len(token) < 20 or len(token) > 80:
        raise HTTPException(404, "Link inválido")
    indice = await controle.assinaturas_index.find_one({"_id": _digest(token)})
    if not indice:
        raise HTTPException(404, "Link inválido ou substituído")
    empresa = await controle.empresas.find_one({"db_name": indice["db_name"]}) if indice.get("db_name") else None
    if indice.get("db_name") and (not empresa or not empresa.get("ativo", True)):
        raise HTTPException(404, "Link indisponível")
    definir_empresa(indice.get("db_name"))
    contrato = await db.contratos.find_one({"id": indice["contrato_id"]})
    if not contrato:
        raise HTTPException(404, "Documento não encontrado")
    sig = next((s for s in contrato.get("signatarios") or [] if s["id"] == indice["signatario_id"] and s.get("token") == token), None)
    if not sig:
        raise HTTPException(404, "Link inválido ou substituído")
    if contrato.get("status") == "cancelado":
        raise HTTPException(410, "Este contrato foi cancelado")
    return contrato, sig


async def _documento_publico(contrato: dict, sig: dict) -> DocumentoPublico:
    documento = contrato.get("documento") or {}
    if not documento.get("texto"):
        raise HTTPException(409, "Documento ainda não está pronto para assinatura")
    config = await db.configuracoes.find_one({"id": "singleton"}, {"cor_primaria": 1, "logo_base64": 1, "nome_software": 1}) or {}
    empresa = await controle.empresas.find_one({"db_name": empresa_atual_db()}, {"nome": 1, "slug": 1}) if empresa_atual_db() else None
    publico = _sig(sig)
    publico.token = None
    return DocumentoPublico(
        empresa_nome=(empresa or {}).get("nome") or config.get("nome_software") or "Imobiliária",
        cor_primaria=_cor(config), tem_logo=bool(config.get("logo_base64")),
        empresa_slug=(empresa or {}).get("slug"), contrato_numero=contrato["numero"],
        titulo=documento.get("titulo", "Contrato"), texto=documento["texto"], hash=documento.get("hash") or "",
        signatario=publico,
        signatarios=[SignatarioPublico(nome=s["nome"], papel=PAPEL_LABEL.get(s.get("papel"), "Signatário"), status=s.get("status", "pendente"),
                                       assinado_em=utc_aware(s.get("assinado_em"))) for s in contrato.get("signatarios") or []],
        concluido=_status(contrato) == "assinado",
    )


@publico_router.get("/{token}", response_model=DocumentoPublico)
async def abrir(token: str, request: Request):
    contrato, sig = await _resolver(token)
    if sig.get("status") == "pendente":
        await db.contratos.update_one({"id": contrato["id"], "signatarios.id": sig["id"]}, {"$set": {
            "signatarios.$.status": "visualizado", "signatarios.$.visualizado_em": now_utc()}})
        await _evento(contrato["id"], f"{sig['nome']} abriu o documento", _ip(request))
        contrato, sig = await _resolver(token)
    return await _documento_publico(contrato, sig)


def _cpf_valido(cpf: str) -> bool:
    n = re.sub(r"\D", "", cpf)
    if len(n) != 11 or n == n[0] * 11:
        return False
    for i in (9, 10):
        soma = sum(int(n[j]) * ((i + 1) - j) for j in range(i))
        if (soma * 10 % 11) % 10 != int(n[i]):
            return False
    return True


@publico_router.post("/{token}/assinar", response_model=DocumentoPublico)
async def assinar(token: str, input: AssinarInput, request: Request):
    contrato, sig = await _resolver(token)
    if sig.get("status") == "assinado":
        raise HTTPException(409, "Você já assinou este documento")
    if sig.get("status") == "recusado":
        raise HTTPException(409, "Assinatura recusada anteriormente. Peça um novo link à imobiliária.")
    if not input.aceite:
        raise HTTPException(422, "É preciso concordar com os termos para assinar")
    if not _cpf_valido(input.cpf):
        raise HTTPException(422, "CPF inválido")
    conteudo = input.assinatura_png.split(",", 1)[1] if input.assinatura_png.startswith("data:") else input.assinatura_png
    try:
        bruto = base64.b64decode(conteudo, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "Assinatura inválida")
    if not bruto.startswith(b"\x89PNG\r\n\x1a\n") or len(bruto) > 400_000:
        raise HTTPException(422, "Assinatura inválida")
    documento = contrato.get("documento") or {}
    ip = _ip(request)
    cpf = re.sub(r"\D", "", input.cpf)
    cpf_fmt = f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}"
    res = await db.contratos.update_one(
        {"id": contrato["id"], "signatarios": {"$elemMatch": {"id": sig["id"], "token": token, "status": {"$in": ["pendente", "visualizado"]}}}},
        {"$set": {
            "signatarios.$.status": "assinado", "signatarios.$.assinado_em": now_utc(), "signatarios.$.ip": ip,
            "signatarios.$.user_agent": (request.headers.get("user-agent") or "")[:300],
            "signatarios.$.nome_assinado": input.nome.strip(), "signatarios.$.cpf_informado": cpf_fmt,
            "signatarios.$.assinatura_tipo": input.assinatura_tipo,
            "signatarios.$.assinatura_png": base64.b64encode(bruto).decode(),
            "signatarios.$.hash_assinado": documento.get("hash"),
        }})
    if not res.modified_count:
        raise HTTPException(409, "Assinatura já registrada")
    await _evento(contrato["id"], f"{input.nome.strip()} (CPF {cpf_fmt}) assinou o documento · hash {(documento.get('hash') or '')[:16]}…", ip)
    await _atualizar_status(contrato["id"])
    contrato, sig = await _resolver(token)
    return await _documento_publico(contrato, sig)


@publico_router.post("/{token}/recusar", response_model=DocumentoPublico)
async def recusar(token: str, input: RecusarInput, request: Request):
    contrato, sig = await _resolver(token)
    if sig.get("status") == "assinado":
        raise HTTPException(409, "Documento já assinado")
    await db.contratos.update_one({"id": contrato["id"], "signatarios.id": sig["id"]}, {"$set": {
        "signatarios.$.status": "recusado", "signatarios.$.recusado_em": now_utc(), "signatarios.$.motivo_recusa": input.motivo.strip()}})
    await _evento(contrato["id"], f"{sig['nome']} recusou a assinatura: {input.motivo.strip()}", _ip(request))
    await _atualizar_status(contrato["id"])
    contrato, sig = await _resolver(token)
    return await _documento_publico(contrato, sig)


@publico_router.get("/{token}/pdf")
async def pdf_publico(token: str):
    contrato, sig = await _resolver(token)
    if sig.get("status") != "assinado":
        raise HTTPException(403, "Disponível após a sua assinatura")
    return Response(await _pdf(contrato), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={contrato['numero']}.pdf"})


@publico_router.get("/{token}/logo")
async def logo_publico(token: str):
    await _resolver(token)
    config = await db.configuracoes.find_one({"id": "singleton"}, {"logo_base64": 1, "logo_mime": 1}) or {}
    if not config.get("logo_base64"):
        raise HTTPException(404, "Sem logotipo")
    return Response(base64.b64decode(config["logo_base64"]), media_type=config.get("logo_mime") or "image/png")
