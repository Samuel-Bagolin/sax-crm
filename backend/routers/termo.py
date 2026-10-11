"""Termo de adesão: leitura pública, aceite do gestor no primeiro acesso e comprovante em PDF.

Regras em `lib/termo_aceite.py`. O registro de aceite fica no banco de controle (`termos_aceite`),
um por empresa e versão, e nunca é alterado depois de gravado.
"""

import logging
from html import escape

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from lib import termo_aceite as ta
from lib.auth import Principal, principal_atual, require
from lib.db import controle
from models.common import now_utc, utc_aware
from models.pessoas import cnpj_valido, cpf_valido, formatar_documento

logger = logging.getLogger(__name__)
router = APIRouter(tags=["termo"])


def _ip(request: Request) -> str:
    # Mesmo critério das assinaturas de contrato: o último item do X-Forwarded-For é o do ingress confiável.
    encaminhado = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
    return encaminhado or (request.client.host if request.client else "desconhecido")


def _digitos(v: str | None) -> str:
    return "".join(ch for ch in (v or "") if ch.isdigit())


async def _empresa(empresa_id: str | None) -> dict:
    if not empresa_id:
        raise HTTPException(403, "Entre em uma empresa")
    e = await controle.empresas.find_one({"id": empresa_id})
    if not e:
        raise HTTPException(404, "Empresa não encontrada")
    return e


def _id(empresa_id: str, versao: str = ta.VERSAO) -> str:
    return f"{empresa_id}:{versao}"


def _pode_aceitar(principal: Principal) -> bool:
    """Só o gestor da própria empresa. Suporte (administrador de sistema dentro da empresa) nunca aceita."""
    return principal.papel == "admin" and not principal.suporte and bool(principal.empresa_id)


@router.get("/publico/termo")
async def termo_publico():
    """Texto vigente, para ler antes de contratar (link no cadastro)."""
    c = await ta.contratada()
    return {"versao": ta.VERSAO, "vigencia": ta.VIGENCIA, "texto": ta.texto(c), "configurado": ta.configurada(c)}


@router.get("/termo")
async def situacao(principal: Principal = Depends(principal_atual)):
    """O que a tela precisa para decidir se mostra o termo antes de liberar o sistema."""
    if not principal.empresa_id:
        return {"exigir": False}
    c = await ta.contratada()
    e = await _empresa(principal.empresa_id)
    registro = await controle[ta.COLECAO].find_one({"_id": _id(e["id"])})
    exigir = ta.configurada(c) and _pode_aceitar(principal) and not registro
    saida = {"exigir": exigir, "versao": ta.VERSAO, "aceite": ta.resumo(registro), "pode_aceitar": _pode_aceitar(principal)}
    if exigir:
        doc = ta.documento_da_empresa(e)
        saida.update(texto=ta.texto(c, {"nome": e.get("nome"), "documento": doc}), hash_versao=ta.hash_versao(c),
                     empresa_nome=e.get("nome"), documento=doc,
                     sugestao_nome=principal.nome, email=principal.email)
    return saida


class AceiteIn(BaseModel):
    hash_versao: str = Field(min_length=64, max_length=64)
    nome: str = Field(min_length=5, max_length=120)
    cpf: str = Field(min_length=11, max_length=14)
    cargo: str = Field(min_length=2, max_length=60)
    documento: str | None = Field(default=None, max_length=20)  # CPF/CNPJ da contratante, se a empresa ainda não tem
    li_e_aceito: bool
    uso_empresarial: bool
    ciente_sem_reembolso: bool
    tempo_leitura_s: int | None = Field(default=None, ge=0, le=86_400)


@router.post("/termo/aceitar")
async def aceitar(input: AceiteIn, request: Request, principal: Principal = Depends(principal_atual)):
    if not _pode_aceitar(principal):
        raise HTTPException(403, "Só o gestor da empresa aceita o termo. O acesso de suporte não aceita em nome do cliente.")
    if not (input.li_e_aceito and input.uso_empresarial and input.ciente_sem_reembolso):
        raise HTTPException(422, "Marque as três confirmações para aceitar o termo.")
    if len(input.nome.strip().split()) < 2:
        raise HTTPException(422, "Informe o nome completo.")
    cpf = _digitos(input.cpf)
    if len(cpf) != 11 or not cpf_valido(cpf):
        raise HTTPException(422, "CPF inválido. Confira os números.")
    c = await ta.contratada()
    if not ta.configurada(c):
        raise HTTPException(409, "O termo ainda não está disponível. Fale com o suporte.")
    if input.hash_versao != ta.hash_versao(c):
        raise HTTPException(409, "O termo foi atualizado enquanto você lia. Recarregue a página e leia a versão nova.")
    e = await _empresa(principal.empresa_id)
    existente = await controle[ta.COLECAO].find_one({"_id": _id(e["id"])})
    if existente:
        return {"ok": True, "aceite": ta.resumo(existente)}

    documento = ta.documento_da_empresa(e)
    if not documento:
        d = _digitos(input.documento)
        if not ((len(d) == 14 and cnpj_valido(d)) or (len(d) == 11 and cpf_valido(d))):
            raise HTTPException(422, "Informe o CNPJ da empresa (ou o CPF, se contratou como profissional).")
        documento = formatar_documento(d)
    contratante = {"nome": e.get("nome"), "documento": documento}
    texto = ta.texto(c, contratante)
    agora = now_utc()
    agora = agora.replace(microsecond=agora.microsecond // 1000 * 1000)  # o Firestore guarda milissegundos
    registro = {
        "_id": _id(e["id"]), "empresa_id": e["id"], "empresa_nome": e.get("nome"), "empresa_documento": documento,
        "versao": ta.VERSAO, "vigencia": ta.VIGENCIA, "texto": texto, "hash": ta.sha256(texto), "hash_versao": input.hash_versao,
        "contratada": c, "usuario_id": principal.usuario_id, "email": principal.email,
        "nome": " ".join(input.nome.split()), "cpf": formatar_documento(cpf), "cargo": input.cargo.strip(),
        "ip": _ip(request), "navegador": (request.headers.get("user-agent") or "")[:300],
        "confirmacoes": ["Li e aceito o termo", "Contratação para uso empresarial (B2B)", "Ciente de que não há reembolso"],
        "tempo_leitura_s": input.tempo_leitura_s, "em": agora,
    }
    try:
        await controle[ta.COLECAO].insert_one(registro)
    except DuplicateKeyError:  # clique duplo ou duas abas: vale o primeiro
        return {"ok": True, "aceite": ta.resumo(await controle[ta.COLECAO].find_one({"_id": _id(e["id"])}))}
    mudar = {"termo_aceite": ta.resumo(registro), "updated_at": agora}
    if not e.get("cnpj") and len(_digitos(documento)) == 14:
        mudar["cnpj"] = documento
    await controle.empresas.update_one({"id": e["id"]}, {"$set": mudar})
    logger.info("termo %s aceito: empresa %s por %s", ta.VERSAO, e.get("slug"), principal.email)
    await _enviar_copia(registro)
    return {"ok": True, "aceite": ta.resumo(registro)}


async def _enviar_copia(r: dict) -> None:
    """Cópia por e-mail para quem aceitou. Falha de e-mail não desfaz o aceite."""
    try:
        from lib.email import send_email
        from lib.pdf import _fmt_dt

        corpo = "".join(f"<p>{escape(linha)}</p>" for linha in r["texto"].replace("# ", "").replace("## ", "").split("\n\n") if linha.strip())
        html = (f"<p>Olá, {escape(r['nome'].split()[0])}.</p>"
                f"<p>Registramos o aceite do Termo de Adesão do SAX CRM (versão {escape(r['versao'])}) em nome de "
                f"<b>{escape(r['empresa_nome'] or '')}</b>.</p>"
                f"<p>Data e hora: {escape(_fmt_dt(utc_aware(r['em'])))} (horário de Brasília)<br>IP: {escape(r['ip'])}<br>"
                f"Código de integridade (SHA-256): {escape(r['hash'])}</p>"
                "<p>Guarde este e-mail. O comprovante em PDF fica em Assinatura, no sistema.</p><hr>" + corpo)
        await send_email(to=r["email"], subject="Seu aceite do Termo de Adesão do SAX CRM", html=html)
    except Exception:
        logger.exception("cópia do termo por e-mail falhou (aceite mantido)")


def _pdf(r: dict) -> bytes:
    from lib.pdf import gerar_contrato_pdf

    em = utc_aware(r["em"])
    signatario = {"nome_assinado": r["nome"], "papel": r.get("cargo") or "Representante",
                  "cpf_informado": r.get("cpf"), "status": "Aceitou", "assinado_em": em, "ip": r.get("ip")}
    eventos = [
        {"em": em, "texto": f"Termo versão {r['versao']} aceito por {r['nome']} ({r['email']}), CPF {r.get('cpf')}", "ip": r.get("ip")},
        {"em": em, "texto": f"Representando a CONTRATANTE {r.get('empresa_nome')}, CPF/CNPJ {r.get('empresa_documento')}"},
        {"em": em, "texto": "Confirmações marcadas: " + "; ".join(r.get("confirmacoes") or [])},
        {"em": em, "texto": f"Navegador: {r.get('navegador') or 'não informado'}"},
        {"em": em, "texto": f"Código de integridade do texto aceito (SHA-256): {r['hash']}"},
    ]
    if r.get("tempo_leitura_s") is not None:
        eventos.append({"em": em, "texto": f"Tempo com o termo aberto antes do aceite: {r['tempo_leitura_s']} segundos"})
    return gerar_contrato_pdf(empresa="SAX CRM", numero=f"Termo v{r['versao']}", titulo="Termo de Adesão", texto=r["texto"],
                              hash_documento=r["hash"], signatarios=[signatario], eventos=eventos, cor_primaria="#4a03a2")


def _resposta_pdf(r: dict) -> Response:
    nome = f"termo-aceite-{r['empresa_id'][:8]}-v{r['versao']}.pdf"
    return Response(_pdf(r), media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={nome}"})


@router.get("/termo/comprovante.pdf")
async def comprovante_da_empresa(versao: str = ta.VERSAO, principal: Principal = Depends(require("assinatura_plataforma:manage"))):
    r = await controle[ta.COLECAO].find_one({"_id": _id(principal.empresa_id or "", versao)})
    if not r:
        raise HTTPException(404, "Nenhum aceite registrado para esta versão")
    return _resposta_pdf(r)


# ------------------------------------------------------------------ plano de controle (Administrador de Sistema)


class ContratadaIn(BaseModel):
    razao_social: str = Field(min_length=3, max_length=120)
    cnpj: str = Field(min_length=14, max_length=20)
    endereco: str = Field(min_length=10, max_length=200)
    cidade_uf: str = Field(min_length=4, max_length=60)
    email: str = Field(min_length=5, max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@router.get("/plataforma/contratada")
async def ver_contratada(principal: Principal = Depends(require("empresa:manage"))):
    c = await ta.contratada()
    return {**c, "configurada": ta.configurada(c), "versao": ta.VERSAO,
            "aceites": await controle[ta.COLECAO].count_documents({"versao": ta.VERSAO})}


@router.put("/plataforma/contratada")
async def salvar_contratada(input: ContratadaIn, principal: Principal = Depends(require("empresa:manage"))):
    d = _digitos(input.cnpj)
    if len(d) != 14 or not cnpj_valido(d):
        raise HTTPException(422, "CNPJ da contratada inválido.")
    dados = {**{k: " ".join(str(v).split()) for k, v in input.model_dump().items()}, "cnpj": formatar_documento(d)}
    atual = await ta.contratada()
    if ta.configurada(atual) and atual != {k: dados[k] for k in ta.CAMPOS_CONTRATADA}:
        # Mudar a contratada muda o texto: quem aceitou a versão atual aceitou com os dados antigos (ficam no registro).
        logger.warning("dados da contratada alterados por %s", principal.email)
    await controle.plataforma.update_one({"_id": ta.DOC_CONTRATADA}, {"$set": {**dados, "atualizado_em": now_utc(),
                                                                                "atualizado_por": principal.email}}, upsert=True)
    return {**dados, "configurada": True}


@router.get("/plataforma/termos/{empresa_id}")
async def aceites_da_empresa(empresa_id: str, principal: Principal = Depends(require("empresa:manage"))):
    regs = await controle[ta.COLECAO].find({"empresa_id": empresa_id}).to_list(50)
    regs.sort(key=lambda r: utc_aware(r["em"]), reverse=True)
    return [{**ta.resumo(r), "ip": r.get("ip"), "cpf": r.get("cpf"), "navegador": r.get("navegador")} for r in regs]


@router.get("/plataforma/termos/{empresa_id}/comprovante.pdf")
async def comprovante_admin(empresa_id: str, versao: str = ta.VERSAO, principal: Principal = Depends(require("empresa:manage"))):
    r = await controle[ta.COLECAO].find_one({"_id": _id(empresa_id, versao)})
    if not r:
        raise HTTPException(404, "Esta empresa não aceitou esta versão do termo")
    return _resposta_pdf(r)
