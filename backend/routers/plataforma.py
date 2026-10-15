"""Administração da plataforma (Administrador de Sistema): pagamentos, cartão de demonstração,
painel de empresas por segmento e webhook do Asaas."""

import hmac
import logging
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from lib import asaas
from lib.assinatura import bloqueio, gerar_numero_demo
from lib.auth import Principal, require
from lib.db import controle
from lib.planos import carregar_catalogo, plano_de, valores_comerciais
from lib.segmentos import CATEGORIAS, SEGMENTOS, segmento_de
from models.common import now_utc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/plataforma", tags=["plataforma"])
webhook_router = APIRouter(prefix="/webhooks", tags=["webhooks"])


class PagamentosIn(BaseModel):
    asaas_api_key: str | None = Field(default=None, max_length=300)  # vazio = mantém a atual
    ambiente: str = "sandbox"
    remover_chave: bool = False


def _mascarar(chave: str | None) -> str | None:
    if not chave:
        return None
    return chave[:6] + "…" + chave[-4:] if len(chave) > 12 else "…"


async def _painel_pagamentos() -> dict:
    cfg = await asaas.config()
    token = await asaas.garantir_webhook_token()
    import os

    base = os.environ.get("APP_URL", "").rstrip("/")
    return {
        "configurado": bool(cfg["chave"]), "chave_mascarada": _mascarar(cfg["chave"]), "chave_por_env": cfg["chave_por_env"],
        "ambiente": cfg["ambiente"], "webhook_url": f"{base}/api/webhooks/asaas" if base else "/api/webhooks/asaas",
        "webhook_token": token, "cartao_demo": cfg.get("cartao_demo"), "cartao_demo_ativo": bool(cfg.get("cartao_demo_ativo", True)) and bool(cfg.get("cartao_demo")),
    }


@router.get("/pagamentos")
async def ver_pagamentos(principal: Principal = Depends(require("empresa:manage"))):
    return await _painel_pagamentos()


@router.put("/pagamentos")
async def salvar_pagamentos(input: PagamentosIn, principal: Principal = Depends(require("empresa:manage"))):
    if input.ambiente not in asaas.URLS:
        raise HTTPException(422, "Ambiente inválido")
    dados: dict = {"ambiente": input.ambiente, "atualizado_em": now_utc(), "atualizado_por": principal.email}
    if input.remover_chave:
        dados["asaas_api_key"] = None
    elif input.asaas_api_key and input.asaas_api_key.strip():
        chave = input.asaas_api_key.strip()
        if not chave.startswith("$aact_"):
            raise HTTPException(422, "Chave do Asaas inválida. Ela começa com $aact_ (Integrações > Chaves de API no Asaas).")
        dados["asaas_api_key"] = chave
    await controle.plataforma.update_one({"_id": asaas.DOC_CONFIG}, {"$set": dados}, upsert=True)
    logger.info("pagamentos atualizados por %s (ambiente %s)", principal.email, input.ambiente)
    return await _painel_pagamentos()


@router.post("/pagamentos/testar")
async def testar_pagamentos(principal: Principal = Depends(require("empresa:manage"))):
    try:
        saldo = await asaas.testar()
    except asaas.ErroAsaas as e:
        raise asaas.http(e)
    return {"ok": True, "saldo": saldo.get("balance")}


@router.get("/links-pagamento")
async def ver_links_pagamento(principal: Principal = Depends(require("empresa:manage"))):
    from lib import links_pagamento

    return await links_pagamento.painel()


@router.post("/links-pagamento/gerar")
async def gerar_links_pagamento(principal: Principal = Depends(require("empresa:manage"))):
    """Cria ou atualiza no Asaas os links de pagamento dos planos (um lote por chamada)."""
    from lib import links_pagamento

    return await links_pagamento.sincronizar()


@router.post("/cartao-demo")
async def gerar_cartao_demo(principal: Principal = Depends(require("empresa:manage"))):
    """Gera (ou troca) o cartão de demonstração. O anterior deixa de funcionar na hora."""
    numero = gerar_numero_demo()
    await controle.plataforma.update_one({"_id": asaas.DOC_CONFIG}, {"$set": {
        "cartao_demo": numero, "cartao_demo_ativo": True, "cartao_demo_em": now_utc(), "cartao_demo_por": principal.email}}, upsert=True)
    logger.info("cartão de demonstração trocado por %s", principal.email)
    return await _painel_pagamentos()


@router.put("/cartao-demo")
async def ativar_cartao_demo(ativo: bool, principal: Principal = Depends(require("empresa:manage"))):
    await controle.plataforma.update_one({"_id": asaas.DOC_CONFIG}, {"$set": {"cartao_demo_ativo": ativo}}, upsert=True)
    return await _painel_pagamentos()


class DemonstracaoIn(BaseModel):
    ativo: bool = True


@router.post("/empresas/{empresa_id}/demonstracao")
async def demonstracao(empresa_id: str, input: DemonstracaoIn, principal: Principal = Depends(require("empresa:manage"))):
    """Marca uma empresa já existente como paga com o cartão de demonstração (sem cobrança), ou tira a marca.

    Serve para as contas de teste do dono da plataforma. Empresa com assinatura real no Asaas não muda aqui."""
    from datetime import date

    from lib.assinatura import resumo_publico
    from routers.cadastro import somar_periodo

    await carregar_catalogo()
    e = await controle.empresas.find_one({"id": empresa_id})
    if not e:
        raise HTTPException(404, "Empresa não encontrada")
    atual = e.get("assinatura") or {}
    if atual.get("gateway") == "asaas" and atual.get("status") != "cancelada":
        raise HTTPException(409, "Esta empresa tem assinatura paga no Asaas. Cancele a assinatura antes de usar a demonstração.")
    if not input.ativo:
        if not atual.get("demo"):
            raise HTTPException(409, "Esta empresa não está em demonstração.")
        await controle.empresas.update_one({"id": empresa_id}, {"$set": {"assinatura": None, "updated_at": now_utc()}})
        logger.info("demonstração encerrada: empresa %s por %s", e.get("slug"), principal.email)
        return {"ok": True, "assinatura": None}
    cfg = await asaas.config()
    numero = cfg.get("cartao_demo")
    if not numero or not cfg.get("cartao_demo_ativo", True):
        raise HTTPException(409, "Gere e ative o cartão de demonstração em Pagamentos antes de liberar a empresa.")
    plano = plano_de(e)
    valor = float(plano.get("preco_mensal") or 0)
    assinatura = {"gateway": "demonstracao", "demo": True, "status": "ativa", "periodicidade": "mensal", "valor": round(valor, 2),
                  "plano": plano.get("chave"), "cartao_final": str(numero)[-4:], "cartao_bandeira": "Demonstração",
                  "criada_em": now_utc(), "proximo_vencimento": somar_periodo(date.today(), False).isoformat(),
                  "liberada_por": principal.email}
    await controle.empresas.update_one({"id": empresa_id}, {"$set": {"assinatura": assinatura, "updated_at": now_utc()}})
    logger.info("demonstração liberada: empresa %s por %s", e.get("slug"), principal.email)
    return {"ok": True, "assinatura": resumo_publico(assinatura)}


# ------------------------------------------------------------------ painel por segmento


@router.get("/painel")
async def painel(principal: Principal = Depends(require("empresa:manage"))):
    """Quantas empresas por categoria e segmento, quantas pagando, em demonstração, em atraso, e a receita mensal."""
    await carregar_catalogo()
    por_seg: dict[str, dict] = {k: {"segmento": k, "nome": v["nome"], "categoria": v["categoria"], "ativas": 0, "pagantes": 0,
                                    "demonstracao": 0, "atrasadas": 0, "bloqueadas": 0, "inativas": 0, "mrr": 0.0, "novas_30d": 0}
                                for k, v in SEGMENTOS.items()}
    agora = datetime.now(timezone.utc)
    async for e in controle.empresas.find({}):
        s = por_seg[segmento_de(e)]
        if not e.get("ativo", True):
            s["inativas"] += 1
            continue
        s["ativas"] += 1
        criada = e.get("created_at")
        if isinstance(criada, datetime) and (agora - (criada if criada.tzinfo else criada.replace(tzinfo=timezone.utc))).days <= 30:
            s["novas_30d"] += 1
        ass = e.get("assinatura") or {}
        if ass.get("demo"):
            s["demonstracao"] += 1
            continue
        if bloqueio(ass):
            s["bloqueadas"] += 1
        elif ass.get("status") == "atrasada":
            s["atrasadas"] += 1
        valores = valores_comerciais(e) if e.get("plano_aplicado") else None
        if valores and ass.get("status") != "cancelada":
            s["pagantes"] += 1
            s["mrr"] += float(valores["equivalente_mensal"] or 0)
    categorias = []
    for ck, cn in CATEGORIAS.items():
        segs = [v for v in por_seg.values() if v["categoria"] == ck]
        for v in segs:
            v["mrr"] = round(v["mrr"], 2)
        categorias.append({"categoria": ck, "nome": cn, "segmentos": segs,
                           "ativas": sum(v["ativas"] for v in segs), "mrr": round(sum(v["mrr"] for v in segs), 2)})
    pendentes = await controle.cadastros.find({"status": {"$in": ["pago_sem_conta", "cancelado_apos_falha"]}}).to_list(50)
    return {"categorias": categorias, "total_ativas": sum(c["ativas"] for c in categorias),
            "mrr_total": round(sum(c["mrr"] for c in categorias), 2),
            "cadastros_com_problema": [{"protocolo": p["_id"][:8], "email": p.get("email"), "status": p["status"],
                                        "segmento": p.get("segmento"), "em": p.get("em")} for p in pendentes]}


# ------------------------------------------------------------------ webhook do Asaas


def _data(v) -> str | None:
    return str(v)[:10] if v else None


@webhook_router.post("/asaas")
async def webhook_asaas(request: Request):
    """Recebe eventos de cobrança. Autenticado pelo token no cabeçalho asaas-access-token.

    O id do evento só é registrado depois do processamento: se algo falhar no meio, o reenvio do
    Asaas é processado de novo. As gravações mexem só nos campos da assinatura que mudaram, para
    não desfazer uma troca de cartão ou cancelamento feitos ao mesmo tempo pela tela."""
    token = await asaas.garantir_webhook_token()
    if not hmac.compare_digest(request.headers.get("asaas-access-token", ""), token):
        raise HTTPException(401, "Token inválido")
    try:
        evento = await request.json()
    except Exception:
        raise HTTPException(400, "JSON inválido")
    eid, tipo = str(evento.get("id") or ""), str(evento.get("event") or "")
    if eid and await controle.asaas_eventos.find_one({"_id": eid}, {"_id": 1}):
        return {"ok": True, "duplicado": True}  # o Asaas entrega "pelo menos uma vez"
    pagamento = evento.get("payment") or {}
    assinatura_id = pagamento.get("subscription") or (evento.get("subscription") or {}).get("id")
    empresa = await controle.empresas.find_one({"asaas_assinatura_id": assinatura_id}) if assinatura_id else None
    resultado = {"ok": True}
    if not empresa:
        if assinatura_id:
            logger.warning("webhook asaas %s: assinatura %s sem empresa", tipo, assinatura_id)
        resultado["ignorado"] = True
    else:
        ass = empresa.get("assinatura") or {}
        if pagamento.get("id"):
            await controle.faturas.update_one({"_id": pagamento["id"]}, {"$set": {
                "_id": pagamento["id"], "empresa_id": empresa["id"], "valor": pagamento.get("value"), "status": pagamento.get("status"),
                "vencimento": _data(pagamento.get("dueDate")), "pago_em": _data(pagamento.get("confirmedDate") or pagamento.get("paymentDate")),
                "link": pagamento.get("invoiceUrl"), "atualizado_em": now_utc()}}, upsert=True)
        mudar: dict = {}
        venc = _data(pagamento.get("dueDate"))
        if tipo == "PAYMENT_CREATED" and venc and venc > (ass.get("proximo_vencimento") or ""):
            mudar["assinatura.proximo_vencimento"] = venc
        elif tipo in ("PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"):
            if venc:
                from datetime import date

                from routers.cadastro import somar_periodo

                prox = somar_periodo(date.fromisoformat(venc), ass.get("periodicidade") == "anual").isoformat()
                if prox > (ass.get("proximo_vencimento") or ""):
                    mudar["assinatura.proximo_vencimento"] = prox
            mudar["assinatura.ultimo_pagamento"] = _data(pagamento.get("confirmedDate") or pagamento.get("paymentDate"))
            if ass.get("status") != "cancelada":  # cobrança antiga paga não reativa assinatura cancelada
                mudar.update({"assinatura.status": "ativa", "assinatura.atraso_desde": None})
        elif tipo == "PAYMENT_OVERDUE" and ass.get("status") != "cancelada":
            mudar["assinatura.status"] = "atrasada"
            if ass.get("status") != "atrasada":
                mudar["assinatura.atraso_desde"] = now_utc()
        elif tipo in ("PAYMENT_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED") and ass.get("status") != "cancelada":
            mudar["assinatura.status"] = "atrasada"
            if not ass.get("atraso_desde"):
                mudar["assinatura.atraso_desde"] = now_utc()
        elif tipo in ("SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"):
            mudar["assinatura.status"] = "cancelada"
            if not ass.get("acesso_ate"):
                mudar["assinatura.acesso_ate"] = ass.get("proximo_vencimento")
        if mudar:
            mudar["updated_at"] = now_utc()
            await controle.empresas.update_one({"id": empresa["id"]}, {"$set": mudar})
            logger.info("webhook asaas %s: empresa %s atualizada", tipo, empresa.get("slug"))
    if eid:
        try:
            await controle.asaas_eventos.insert_one({"_id": eid, "evento": tipo, "em": now_utc()})
        except Exception:
            pass
    return resultado


# ------------------------------------------------------------------ empresas de demonstração


@router.post("/demos/pudim", status_code=201)
async def criar_demo_pudim(principal: Principal = Depends(require("empresa:manage"))):
    """Cria a empresa "[DEMO] O Pudim Perfeito" (comércio) com dados fictícios para apresentação.

    Devolve os acessos da equipe de demonstração e a senha gerada, mostrada só nesta resposta."""
    from lib import demo_pudim

    try:
        r = await demo_pudim.criar(principal.email)
    except ValueError as e:
        raise HTTPException(409, str(e))
    logger.info("demonstração do Pudim criada por %s", principal.email)
    return r


class ImportarPlanilhaIn(BaseModel):
    arquivo_base64: str = Field(min_length=10, max_length=12_000_000)
    simular: bool = True
    novos_links: bool = False  # gera link novo para quem foi importado antes e ainda não ativou


@router.post("/empresas/{empresa_id}/importar-revendas")
async def importar_revendas(empresa_id: str, input: ImportarPlanilhaIn, principal: Principal = Depends(require("empresa:manage"))):
    """Traz o CRM Revendas & Eventos (planilha Google) para a empresa. `simular` mostra o que vai entrar sem gravar."""
    import base64

    from lib import importar_revendas as imp

    e = await controle.empresas.find_one({"id": empresa_id})
    if not e:
        raise HTTPException(404, "Empresa não encontrada")
    try:
        conteudo = base64.b64decode(input.arquivo_base64.split(",")[-1], validate=False)
    except Exception:
        raise HTTPException(422, "Arquivo inválido")
    try:
        r = await imp.importar(e, conteudo, simular=input.simular, por=principal.nome, novos_links=input.novos_links)
    except imp.ErroPlanilha as err:
        raise HTTPException(422, str(err))
    finally:
        from lib.db import definir_empresa

        definir_empresa(None)
    if not input.simular:
        logger.info("planilha CRM Revendas importada em %s por %s: %s", e.get("slug"), principal.email, r["contagens"])
    return r


class PrintIn(BaseModel):
    nome: str = Field(min_length=1, max_length=300)
    base64: str = Field(min_length=10, max_length=1_400_000)


def _nome_print(nome: str) -> str:
    import unicodedata

    return unicodedata.normalize("NFC", nome.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]).strip().lower()


@router.get("/empresas/{empresa_id}/prints-pendentes")
async def prints_pendentes(empresa_id: str, principal: Principal = Depends(require("empresa:manage"))):
    from lib.db import client

    e = await controle.empresas.find_one({"id": empresa_id})
    if not e:
        raise HTTPException(404, "Empresa não encontrada")
    banco = client[e["db_name"]]
    return {"pendentes": await banco.anexos_pendentes.count_documents({}),
            "trazidos": await banco.anexos.count_documents({"drive_id": {"$ne": None}})}


@router.post("/empresas/{empresa_id}/importar-print")
async def importar_print(empresa_id: str, input: PrintIn, principal: Principal = Depends(require("empresa:manage"))):
    """Um arquivo da pasta de anexos do Google Drive por vez: casa pelo nome (ou pelo ID do arquivo) com o print
    que a planilha ligou a uma atividade e guarda como anexo daquele negócio, com o mesmo autor."""
    from lib.db import client, definir_empresa
    from routers.anexos import gravar

    e = await controle.empresas.find_one({"id": empresa_id})
    if not e:
        raise HTTPException(404, "Empresa não encontrada")
    banco = client[e["db_name"]]
    alvo = _nome_print(input.nome)
    base = alvo.rsplit(".", 1)[0]
    pend = None
    async for p in banco.anexos_pendentes.find({}):
        if (p.get("nome") and _nome_print(p["nome"]) == alvo) or (p.get("drive_id") or "").lower() in (alvo, base):
            pend = p
            break
    if not pend:
        ja = await banco.anexos.find_one({"nome_original": input.nome.strip()}, {"id": 1})
        return {"ok": False, "motivo": "já estava no sistema" if ja else "não está ligado a nenhuma atividade da planilha"}
    definir_empresa(e["db_name"])
    try:
        atividade = await banco.atividades.find_one({"id": pend.get("atividade_id")}, {"id": 1, "assunto": 1}) or \
            {"id": pend.get("atividade_id"), "assunto": pend.get("atividade_assunto")}
        [aid] = await gravar([{"nome": pend.get("nome") or input.nome, "base64": input.base64}], negocio_id=pend.get("negocio_id"),
                             atividade=atividade, autor_pessoa_id=pend.get("autor_pessoa_id"), autor_nome=pend.get("autor_nome"),
                             extra={"drive_id": pend.get("drive_id"), "nome_original": input.nome.strip()})
        await banco.anexos_pendentes.delete_one({"id": pend["id"]})
    finally:
        definir_empresa(None)
    return {"ok": True, "anexo_id": aid, "restantes": await banco.anexos_pendentes.count_documents({})}


class LimparDemoIn(BaseModel):
    confirmar: str = Field(min_length=1, max_length=80)  # o identificador (slug) da empresa
    nome: str = Field(min_length=2, max_length=80)


@router.post("/empresas/{empresa_id}/limpar-demonstracao")
async def limpar_demonstracao(empresa_id: str, input: LimparDemoIn, principal: Principal = Depends(require("empresa:manage"))):
    """Empresa de demonstração vira empresa real: apaga os dados fictícios e troca o nome. Só para `demo_apresentacao`."""
    from lib import demo_pudim

    e = await controle.empresas.find_one({"id": empresa_id})
    if not e:
        raise HTTPException(404, "Empresa não encontrada")
    if not e.get("demo_apresentacao"):
        raise HTTPException(409, "Esta empresa não é de demonstração: nada foi apagado.")
    if input.confirmar.strip() != e.get("slug"):
        raise HTTPException(422, "Confirmação não corresponde ao identificador da empresa")
    r = await demo_pudim.limpar(e, input.nome.strip(), principal.nome)
    logger.warning("dados de demonstração apagados em %s por %s: %s", e.get("slug"), principal.email, r["apagados"])
    return r


# ------------------------------------------------------------------ planilha de dados (qualquer empresa)


class ImportarDadosEmpresaIn(BaseModel):
    arquivo_base64: str = Field(min_length=10, max_length=4_400_000)
    simular: bool = True


async def _empresa_dados(empresa_id: str) -> dict:
    e = await controle.empresas.find_one({"id": empresa_id})
    if not e:
        raise HTTPException(404, "Empresa não encontrada")
    return e


@router.get("/empresas/{empresa_id}/dados/modelo")
async def dados_modelo(empresa_id: str, principal: Principal = Depends(require("empresa:manage"))):
    from lib import dados_planilha as dp
    from lib.db import client
    from routers.dados import arquivo

    e = await _empresa_dados(empresa_id)
    return arquivo(await dp.modelo(client[e["db_name"]], segmento_de(e)), f"Modelo de dados {e.get('nome') or e.get('slug')}.xlsx")


@router.get("/empresas/{empresa_id}/dados/exportar")
async def dados_exportar(empresa_id: str, principal: Principal = Depends(require("empresa:manage"))):
    from lib import dados_planilha as dp
    from lib.db import client
    from routers.dados import arquivo

    e = await _empresa_dados(empresa_id)
    conteudo = await dp.exportar(client[e["db_name"]], segmento_de(e))
    logger.info("dados exportados de %s por %s", e.get("slug"), principal.email)
    return arquivo(conteudo, f"Dados {e.get('nome') or e.get('slug')}.xlsx")


@router.post("/empresas/{empresa_id}/dados/importar")
async def dados_importar(empresa_id: str, input: ImportarDadosEmpresaIn, principal: Principal = Depends(require("empresa:manage"))):
    from lib import dados_planilha as dp
    from lib.db import client, definir_empresa
    from routers.dados import decodificar

    e = await _empresa_dados(empresa_id)
    definir_empresa(e["db_name"])
    try:
        r = await dp.importar(client[e["db_name"]], segmento_de(e), decodificar(input.arquivo_base64), simular=input.simular,
                              por=f"{principal.nome} (SAX)", por_usuario_id=None)
    except dp.ErroPlanilha as err:
        raise HTTPException(422, str(err))
    finally:
        definir_empresa(None)
    if not input.simular:
        logger.info("dados importados em %s por %s: %s", e.get("slug"), principal.email, r["contagens"])
    return r
