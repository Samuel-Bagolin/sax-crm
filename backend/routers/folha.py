"""Folha por profissional (clínicas e serviços): regra configurável por pessoa e fechamento do mês no Financeiro.

Regra em `usuarios.folha`:
- por_sessao: valor fixo por sessão válida;
- percentual: % do valor da sessão (cobrado, se concluída; senão o preço);
- fixo_mais_sessao: fixo mensal + valor por sessão.
Em grupo, `grupo_conta` diz se a sessão vale uma vez (por_sessao) ou uma por paciente presente (por_paciente).

Sessão válida = paciente presente E evolução no prontuário ligada à sessão (routers/sessoes.py). Sem evolução, a
sessão aparece como "aguardando evolução" e não entra no valor. Evolução fora do prazo entra, marcada.

Fechar o mês grava `folhas` (`_id` = AAAA-MM|usuario, retrato dos itens) e uma conta a pagar com id fixo
`folha-AAAA-MM-usuario` (conta 2.3.2): fechar de novo não duplica. Reabrir só se a conta não foi paga.
Quem tem regra de folha não recebe a comissão por atendimento da conclusão (não paga duas vezes).
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from lib.auth import Principal, require
from lib.db import db
from lib.integrity import percentage
from models.common import now_utc

router = APIRouter(prefix="/folha", tags=["folha"])

Modelo = Literal["por_sessao", "percentual", "fixo_mais_sessao"]


class RegraIn(BaseModel):
    modelo: Modelo | None = None  # None = sem folha
    valor_sessao: float = Field(default=0, ge=0, le=100_000)
    percentual: float = Field(default=0, ge=0, le=100)
    fixo_mensal: float = Field(default=0, ge=0, le=1_000_000)
    grupo_conta: Literal["por_sessao", "por_paciente"] = "por_sessao"

    @model_validator(mode="after")
    def _ok(self):
        if self.modelo == "percentual" and not self.percentual:
            raise ValueError("Informe o percentual")
        if self.modelo in ("por_sessao", "fixo_mais_sessao") and not self.valor_sessao and not self.fixo_mensal:
            raise ValueError("Informe o valor por sessão")
        return self


def _mes(mes: str) -> tuple[str, str]:
    try:
        a, m = int(mes[:4]), int(mes[5:7])
        assert len(mes) == 7 and mes[4] == "-" and 1 <= m <= 12
    except (ValueError, AssertionError):
        raise HTTPException(422, "Mês no formato AAAA-MM")
    return f"{a:04d}-{m:02d}-01", f"{a:04d}-{m:02d}-{monthrange(a, m)[1]:02d}"


def _regra(u: dict) -> dict | None:
    r = u.get("folha") or {}
    return r if r.get("modelo") else None


def calcular(regra: dict, linhas: list[dict]) -> dict:
    """Linhas do controle (uma por paciente e sessão) de um profissional -> itens e total."""
    validas = [l for l in linhas if l["presenca"] == "presente" and l["evolucao"] in ("feita", "feita_fora_do_prazo")]
    aguardando = [l for l in linhas if l["presenca"] == "presente" and l["evolucao"] in ("pendente", "atrasada")]
    por_ag: dict[str, list[dict]] = {}
    for l in validas:
        por_ag.setdefault(l["agendamento_id"], []).append(l)
    itens = []
    for aid, ls in por_ag.items():
        l0 = ls[0]
        unidades = len(ls) if (l0["grupo"] and regra.get("grupo_conta") == "por_paciente") else 1
        base = float(l0.get("valor_base") or 0)
        if regra["modelo"] == "percentual":
            valor = percentage(base, float(regra.get("percentual") or 0)) * unidades
        else:
            valor = float(regra.get("valor_sessao") or 0) * unidades
        itens.append({"agendamento_id": aid, "data": l0["data"], "inicio": l0["inicio"], "servicos": l0["servicos"], "grupo": l0["grupo"],
                      "pacientes": [l["paciente_nome"] for l in ls], "unidades": unidades, "base": round(base, 2), "valor": round(valor, 2),
                      "fora_do_prazo": any(l["evolucao"] == "feita_fora_do_prazo" for l in ls)})
    itens.sort(key=lambda i: (i["data"], i["inicio"] or ""))
    variavel = round(sum(i["valor"] for i in itens), 2)
    fixo = round(float(regra.get("fixo_mensal") or 0), 2) if regra["modelo"] == "fixo_mais_sessao" else 0.0
    return {"itens": itens, "sessoes": len(itens), "atendimentos": len(validas), "aguardando_evolucao": len(aguardando),
            "faltas": sum(1 for l in linhas if l["presenca"] in ("falta", "falta_justificada")), "variavel": variavel, "fixo": fixo,
            "total": round(variavel + fixo, 2)}


async def _linhas(inicio: str, fim: str, usuario_id: str) -> list[dict]:
    from routers.sessoes import linhas_controle

    linhas = await linhas_controle(inicio, fim, usuario_id)
    valores = {}
    ids = list({l["agendamento_id"] for l in linhas})
    for i in range(0, len(ids), 30):
        async for a in db.agendamentos.find({"id": {"$in": ids[i:i + 30]}}, {"id": 1, "valor": 1, "valor_cobrado": 1, "status": 1}):
            valores[a["id"]] = a.get("valor_cobrado") if a.get("status") == "concluido" and a.get("valor_cobrado") is not None else a.get("valor")
    for l in linhas:
        l["valor_base"] = valores.get(l["agendamento_id"]) or 0
    return linhas


def _saida_regra(u: dict) -> dict:
    r = u.get("folha") or {}
    return {"usuario_id": u["id"], "nome": u.get("nome"), "atende": bool(u.get("atende")), "comissao_pct": u.get("comissao_pct") or 0,
            "modelo": r.get("modelo"), "valor_sessao": r.get("valor_sessao") or 0, "percentual": r.get("percentual") or 0,
            "fixo_mensal": r.get("fixo_mensal") or 0, "grupo_conta": r.get("grupo_conta") or "por_sessao"}


@router.get("/regras")
async def regras(principal: Principal = Depends(require("usuario:manage"))):
    us = await db.usuarios.find({"atende": True}).to_list(300)
    return [_saida_regra(u) for u in sorted(us, key=lambda u: u.get("nome") or "")]


@router.put("/regras/{usuario_id}")
async def salvar_regra(usuario_id: str, input: RegraIn, principal: Principal = Depends(require("usuario:manage"))):
    u = await db.usuarios.find_one({"id": usuario_id})
    if not u:
        raise HTTPException(404, "Profissional não encontrado")
    regra = input.model_dump() if input.modelo else None
    await db.usuarios.update_one({"id": usuario_id}, {"$set": {"folha": regra}})
    return _saida_regra({**u, "folha": regra})


@router.get("")
async def folha(mes: str, principal: Principal = Depends(require("agendamento:read"))):
    inicio, fim = _mes(mes)
    filtro = {"atende": True} if principal.is_admin else {"id": principal.usuario_id}
    us = await db.usuarios.find(filtro).to_list(300)
    saida = []
    for u in sorted(us, key=lambda u: u.get("nome") or ""):
        fechada = await db.folhas.find_one({"_id": f"{mes}|{u['id']}"})
        regra = (fechada or {}).get("regra") or _regra(u)
        if not regra:
            if principal.is_admin:
                saida.append({"usuario_id": u["id"], "nome": u.get("nome"), "regra": None, "fechada": None})
            continue
        if fechada:
            calc = {k: fechada.get(k) for k in ("itens", "sessoes", "atendimentos", "aguardando_evolucao", "faltas", "variavel", "fixo", "total")}
            pago = await db.transacoes.find_one({"id": fechada.get("transacao_id")}, {"status": 1}) if fechada.get("transacao_id") else None
            info = {"em": fechada.get("fechada_em").isoformat() if fechada.get("fechada_em") else None, "por": fechada.get("fechada_por"),
                    "transacao_id": fechada.get("transacao_id"), "paga": (pago or {}).get("status") == "pago"}
        else:
            calc = calcular(regra, await _linhas(inicio, fim, u["id"]))
            info = None
        saida.append({"usuario_id": u["id"], "nome": u.get("nome"), "regra": regra, **calc, "fechada": info})
    return {"mes": mes, "profissionais": saida, "total": round(sum(p.get("total") or 0 for p in saida), 2)}


class FecharIn(BaseModel):
    usuario_ids: list[str] = Field(min_length=1, max_length=300)
    vencimento: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


@router.post("/{mes}/fechar")
async def fechar(mes: str, input: FecharIn, principal: Principal = Depends(require("usuario:manage"))):
    inicio, fim = _mes(mes)
    ano, m = int(mes[:4]), int(mes[5:7])
    venc = input.vencimento or (date(ano + (m == 12), 1 if m == 12 else m + 1, 5)).isoformat()
    conta = await db.plano_contas.find_one({"codigo": "2.3.2"}) or await db.plano_contas.find_one({"tipo": "despesa"})
    if not conta:
        raise HTTPException(409, "Cadastre uma conta de despesa no plano de contas")
    feitos, pulados = [], []
    for uid in input.usuario_ids:
        u = await db.usuarios.find_one({"id": uid})
        regra = _regra(u or {})
        if not u or not regra:
            pulados.append({"usuario_id": uid, "motivo": "Sem regra de folha"})
            continue
        if await db.folhas.find_one({"_id": f"{mes}|{uid}"}):
            pulados.append({"usuario_id": uid, "motivo": "Já fechada"})
            continue
        calc = calcular(regra, await _linhas(inicio, fim, uid))
        tid = f"folha-{mes}-{uid}"
        doc = {"_id": f"{mes}|{uid}", "mes": mes, "usuario_id": uid, "nome": u.get("nome"), "regra": regra, **calc,
               "transacao_id": tid if calc["total"] > 0 else None, "fechada_em": now_utc(), "fechada_por": principal.nome}
        try:
            await db.folhas.insert_one(doc)
        except Exception:
            pulados.append({"usuario_id": uid, "motivo": "Já fechada"})
            continue
        if calc["total"] > 0:
            try:
                await db.transacoes.insert_one({
                    "_id": tid, "id": tid, "descricao": f"Folha {mes[5:]}/{mes[:4]} | {u.get('nome')} ({calc['sessoes']} sessões)"[:300],
                    "tipo": "pagar", "valor": calc["total"], "plano_conta_id": conta["id"], "imovel_id": None, "pessoa_id": u.get("pessoa_id"),
                    "corretor_id": u.get("pessoa_id"), "evento_id": None, "contrato_id": None, "vencimento": venc, "pagamento": None,
                    "status": "pendente", "vencido": False, "cancelado_em": None, "folha": mes, "created_at": now_utc()})
            except Exception:
                pass  # id fixo: já lançada
        feitos.append({"usuario_id": uid, "total": calc["total"]})
    return {"fechadas": feitos, "puladas": pulados}


@router.post("/{mes}/reabrir/{usuario_id}")
async def reabrir(mes: str, usuario_id: str, principal: Principal = Depends(require("usuario:manage"))):
    _mes(mes)
    f = await db.folhas.find_one({"_id": f"{mes}|{usuario_id}"})
    if not f:
        raise HTTPException(404, "Folha não está fechada")
    if f.get("transacao_id"):
        t = await db.transacoes.find_one({"id": f["transacao_id"]})
        if t and t.get("status") == "pago":
            raise HTTPException(409, "A folha já foi paga no Financeiro. Estorne lá antes de reabrir.")
        await db.transacoes.delete_one({"id": f["transacao_id"], "status": {"$ne": "pago"}})
    await db.folhas.delete_one({"_id": f"{mes}|{usuario_id}"})
    return {"ok": True}
