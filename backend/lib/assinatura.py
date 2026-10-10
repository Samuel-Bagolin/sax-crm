"""Assinatura da plataforma: validação do cartão, cartão de demonstração e situação de cobrança.

Situações (`empresa.assinatura.status`):
- ativa: pagamento em dia (ou empresa de demonstração).
- atrasada: o Asaas avisou cobrança vencida. A empresa continua usando durante a carência.
- cancelada: assinatura encerrada. O acesso vale até `acesso_ate`, se houver.
Bloqueio é calculado na hora (sem robô): atrasada há mais de CARENCIA_DIAS ou cancelada e vencida.
Empresas criadas pelo painel (sem `assinatura`) nunca são bloqueadas por aqui.
"""

from __future__ import annotations

import hmac
import re
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException

from lib.db import controle

CARENCIA_DIAS = 10


def so_digitos(v: str | None) -> str:
    return re.sub(r"\D", "", v or "")


def luhn(numero: str) -> bool:
    if not numero.isdigit() or not 13 <= len(numero) <= 19:
        return False
    soma = 0
    for i, ch in enumerate(reversed(numero)):
        d = int(ch)
        if i % 2:
            d *= 2
            if d > 9:
                d -= 9
        soma += d
    return soma % 10 == 0


def validar_cartao(numero: str, mes: str, ano: str, cvv: str, nome: str) -> dict:
    """Confere formato, dígito verificador e validade. Mensagens nunca repetem o número."""
    numero, mes, ano, cvv = so_digitos(numero), so_digitos(mes), so_digitos(ano), so_digitos(cvv)
    if not luhn(numero):
        raise HTTPException(422, "Número do cartão inválido. Confira os dígitos.")
    if len(ano) == 2:
        ano = "20" + ano
    if not (mes.isdigit() and 1 <= int(mes) <= 12 and len(ano) == 4):
        raise HTTPException(422, "Validade do cartão inválida. Use mês e ano, por exemplo 08/29.")
    hoje = date.today()
    if (int(ano), int(mes)) < (hoje.year, hoje.month) or int(ano) > hoje.year + 20:
        raise HTTPException(422, "Cartão vencido. Use outro cartão.")
    if not 3 <= len(cvv) <= 4:
        raise HTTPException(422, "Código de segurança (CVV) inválido.")
    nome = re.sub(r"\s+", " ", (nome or "").strip())
    if len(nome) < 3:
        raise HTTPException(422, "Informe o nome impresso no cartão.")
    return {"numero": numero, "mes": mes.zfill(2), "ano": ano, "cvv": cvv, "nome": nome[:80]}


def gerar_numero_demo() -> str:
    """16 dígitos começando por 9 (faixa que nenhuma bandeira usa) e com dígito verificador válido."""
    base = "9" + "".join(secrets.choice("0123456789") for _ in range(14))
    for dv in "0123456789":
        if luhn(base + dv):
            return base + dv
    return gerar_numero_demo()


async def eh_cartao_demo(numero: str) -> bool:
    doc = await controle.plataforma.find_one({"_id": "pagamentos"}, {"cartao_demo": 1, "cartao_demo_ativo": 1}) or {}
    demo = doc.get("cartao_demo")
    if not demo or not doc.get("cartao_demo_ativo", True):
        return False
    return hmac.compare_digest(so_digitos(numero), demo)


def _dt(v) -> datetime | None:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str) and v:
        try:
            d = datetime.fromisoformat(v)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def bloqueio(assinatura: dict | None) -> str | None:
    """Motivo do bloqueio da empresa, ou None se o acesso está liberado."""
    if not assinatura or assinatura.get("demo"):
        return None
    agora = datetime.now(timezone.utc)
    st = assinatura.get("status")
    if st == "atrasada":
        desde = _dt(assinatura.get("atraso_desde"))
        if desde and agora - desde > timedelta(days=CARENCIA_DIAS):
            return "Pagamento da assinatura em atraso. Atualize o cartão para voltar a usar o sistema."
    if st == "cancelada":
        ate = _dt(assinatura.get("acesso_ate"))
        if not ate or agora > ate:
            return "A assinatura foi cancelada. Assine de novo para voltar a usar o sistema."
    return None


def resumo_publico(assinatura: dict | None) -> dict | None:
    """O que a tela pode ver da assinatura (sem ids do gateway)."""
    if not assinatura:
        return None
    return {
        "status": assinatura.get("status"),
        "demo": bool(assinatura.get("demo")),
        "periodicidade": assinatura.get("periodicidade"),
        "valor": assinatura.get("valor"),
        "cartao_final": assinatura.get("cartao_final"),
        "cartao_bandeira": assinatura.get("cartao_bandeira"),
        "proximo_vencimento": assinatura.get("proximo_vencimento"),
        "atraso_desde": assinatura.get("atraso_desde"),
        "acesso_ate": assinatura.get("acesso_ate"),
        "bloqueio": bloqueio(assinatura),
        "carencia_dias": CARENCIA_DIAS,
    }
