"""Programa de indicação com cashback, válido em todas as lojas (unidades) da empresa.

Como funciona:
- Cliente vira afiliado e recebe um código (ex.: ANA-7K2) e um link do site com `?ref=CODIGO`.
- Quem compra pela primeira vez informando um código fica ligado a esse afiliado (`indicado_por`).
  A primeira indicação vale para sempre: outro código depois não troca o afiliado.
- Cada compra registrada (em qualquer loja) gera crédito:
  - para o afiliado: `pct_indicacao` do valor pago, nas `compras_indicacao` primeiras compras do indicado (0 = todas);
  - para o próprio cliente: `pct_compra` do valor pago (0 desliga).
- O crédito só pode ser usado em compras seguintes, até `max_pct_uso` do valor de cada compra, e vence em
  `validade_dias`. O uso consome primeiro o crédito que vence antes.
- Estornar a compra devolve o cashback usado e cancela o que ainda não foi usado do cashback gerado.

Coleções: `cb_compras` (compras registradas) e `cb_movimentos` (créditos e usos). O saldo é a soma do
`restante` dos créditos não vencidos.
"""

from __future__ import annotations

import secrets
import unicodedata
from datetime import date, timedelta

from pydantic import BaseModel, Field

from lib.db import db
from models.common import new_id, now_utc

ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sem 0/O e 1/I para não confundir no balcão


class CashbackConfig(BaseModel):
    ativo: bool = False
    pct_indicacao: float = Field(default=5.0, ge=0, le=50)
    compras_indicacao: int = Field(default=2, ge=0, le=100)  # 0 = todas as compras do indicado
    pct_compra: float = Field(default=0.0, ge=0, le=50)
    validade_dias: int = Field(default=90, ge=7, le=730)
    max_pct_uso: float = Field(default=50.0, ge=1, le=100)
    autocadastro_site: bool = True  # "Indique e ganhe" no site


async def carregar_config() -> CashbackConfig:
    doc = await db.configuracoes.find_one({"id": "singleton"}, {"cashback": 1}) or {}
    return CashbackConfig(**(doc.get("cashback") or {}))


def hoje() -> date:
    from lib.agenda_online import agora_local

    return agora_local().date()


def so_digitos(v: str | None) -> str:
    return "".join(c for c in (v or "") if c.isdigit())


def brl(v: float) -> str:
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def normalizar_codigo(c: str | None) -> str:
    return "".join(ch for ch in (c or "").upper().strip() if ch.isalnum() or ch == "-")[:20]


async def gerar_codigo(nome: str) -> str:
    base = unicodedata.normalize("NFD", (nome or "").split(" ")[0].upper())
    base = "".join(c for c in base if c.isalpha() and c.isascii())[:6] or "AMIGO"
    for _ in range(20):
        codigo = f"{base}-{''.join(secrets.choice(ALFABETO) for _ in range(3))}"
        if not await db.pessoas.find_one({"afiliado_codigo": codigo}, {"id": 1}):
            return codigo
    return f"{base}-{secrets.token_hex(3).upper()}"


async def tornar_afiliado(pessoa: dict) -> str:
    if pessoa.get("afiliado_codigo"):
        return pessoa["afiliado_codigo"]
    codigo = await gerar_codigo(pessoa.get("nome") or "")
    await db.pessoas.update_one({"id": pessoa["id"]}, {"$set": {"afiliado_codigo": codigo, "afiliado_desde": now_utc()}})
    pessoa["afiliado_codigo"] = codigo
    return codigo


async def afiliado_pelo_codigo(codigo: str | None) -> dict | None:
    c = normalizar_codigo(codigo)
    if not c:
        return None
    return await db.pessoas.find_one({"afiliado_codigo": c})


async def cliente_por_telefone(telefone: str | None) -> dict | None:
    t = so_digitos(telefone)
    if len(t) < 10:
        return None
    p = await db.pessoas.find_one({"telefone_digitos": t})
    if not p and t.startswith("55") and len(t) > 11:
        p = await db.pessoas.find_one({"telefone_digitos": t[2:]})
    return p


async def criar_cliente(nome: str, telefone: str | None, criado_por: str | None = None) -> dict:
    from models.pessoas import Pessoa

    p = Pessoa(nome=nome.strip(), papeis=["cliente"], telefone=(telefone or "").strip() or None).model_dump()
    p["telefone_digitos"] = so_digitos(telefone) or None
    p["criado_por_id"] = criado_por
    await db.pessoas.insert_one(p)
    return p


async def creditos_validos(pessoa_id: str) -> list[dict]:
    hj = hoje().isoformat()
    docs = await db.cb_movimentos.find({"pessoa_id": pessoa_id, "tipo": "credito"}).to_list(2000)
    vivos = [d for d in docs if float(d.get("restante") or 0) > 0.004 and (d.get("validade") or "") >= hj]
    vivos.sort(key=lambda d: (d.get("validade") or "", d.get("created_at") or now_utc()))
    return vivos


async def saldo(pessoa_id: str) -> dict:
    vivos = await creditos_validos(pessoa_id)
    limite = (hoje() + timedelta(days=30)).isoformat()
    total = round(sum(float(d["restante"]) for d in vivos), 2)
    a_vencer = round(sum(float(d["restante"]) for d in vivos if d["validade"] <= limite), 2)
    return {"saldo": total, "a_vencer_30d": a_vencer, "proximo_vencimento": vivos[0]["validade"] if vivos else None}


async def _credito(pessoa_id: str, valor: float, origem: str, compra: dict, cfg: CashbackConfig, descricao: str) -> dict | None:
    valor = round(valor, 2)
    if valor < 0.01:
        return None
    doc = {"id": new_id(), "pessoa_id": pessoa_id, "tipo": "credito", "origem": origem, "valor": valor, "restante": valor,
           "validade": (hoje() + timedelta(days=cfg.validade_dias)).isoformat(), "compra_id": compra["id"],
           "unidade_id": compra.get("unidade_id"), "descricao": descricao, "created_at": now_utc(), "por": compra.get("por")}
    await db.cb_movimentos.insert_one(doc)
    return doc


class ErroCashback(Exception):
    def __init__(self, mensagem: str, status: int = 422):
        self.mensagem, self.status = mensagem, status


async def registrar_compra(*, cliente: dict, valor: float, usar: float, unidade: dict | None, codigo: str | None,
                           descricao: str | None, por: str) -> dict:
    cfg = await carregar_config()
    if not cfg.ativo:
        raise ErroCashback("O programa de cashback está desligado. O gestor liga em Afiliados > Configurar.", 409)
    valor, usar = round(float(valor), 2), round(float(usar or 0), 2)
    if valor <= 0:
        raise ErroCashback("Informe o valor da compra.")
    avisos: list[str] = []
    anteriores = [c for c in await db.cb_compras.find({"cliente_id": cliente["id"]}).to_list(5000) if not c.get("estornada")]

    # indicação: só cliente sem compra anterior entra com código; a primeira indicação vale para sempre
    codigo = normalizar_codigo(codigo)
    if codigo:
        afiliado = await afiliado_pelo_codigo(codigo)
        if not afiliado:
            raise ErroCashback(f"Código de indicação {codigo} não encontrado.")
        if afiliado["id"] == cliente["id"]:
            raise ErroCashback("O cliente não pode usar o próprio código de indicação.")
        if cliente.get("indicado_por") and cliente["indicado_por"] != afiliado["id"]:
            avisos.append("Este cliente já foi indicado por outra pessoa. A primeira indicação continua valendo.")
        elif not cliente.get("indicado_por"):
            if anteriores:
                avisos.append("Indicação vale só para quem ainda não tinha comprado. O código não foi aplicado.")
            else:
                await db.pessoas.update_one({"id": cliente["id"]}, {"$set": {"indicado_por": afiliado["id"], "indicado_por_codigo": codigo,
                                                                            "indicado_em": now_utc()}})
                cliente["indicado_por"] = afiliado["id"]

    # uso do saldo
    if usar > 0:
        vivos = await creditos_validos(cliente["id"])
        disponivel = round(sum(float(d["restante"]) for d in vivos), 2)
        teto = round(valor * cfg.max_pct_uso / 100, 2)
        if usar > disponivel + 0.001:
            raise ErroCashback(f"O cliente tem R$ {brl(disponivel)} de cashback disponível.")
        if usar > teto + 0.001:
            raise ErroCashback(f"Nesta compra dá para usar até {cfg.max_pct_uso:g}% do valor (R$ {brl(teto)}).")
    compra = {"id": new_id(), "cliente_id": cliente["id"], "cliente_nome": cliente.get("nome"),
              "unidade_id": (unidade or {}).get("id"), "unidade_nome": (unidade or {}).get("nome"), "valor": valor, "cashback_usado": usar,
              "valor_pago": round(valor - usar, 2), "descricao": (descricao or "").strip()[:200] or None, "afiliado_id": None,
              "debitos": [], "creditos": [], "estornada": False, "data": hoje().isoformat(), "created_at": now_utc(), "por": por}
    restante_usar = usar
    if usar > 0:
        for cred in vivos:
            if restante_usar <= 0.004:
                break
            tirar = round(min(float(cred["restante"]), restante_usar), 2)
            await db.cb_movimentos.update_one({"id": cred["id"]}, {"$set": {"restante": round(float(cred["restante"]) - tirar, 2)}})
            compra["debitos"].append({"credito_id": cred["id"], "valor": tirar})
            restante_usar = round(restante_usar - tirar, 2)
        await db.cb_movimentos.insert_one({"id": new_id(), "pessoa_id": cliente["id"], "tipo": "uso", "origem": "resgate", "valor": usar,
                                           "compra_id": compra["id"], "unidade_id": compra["unidade_id"], "descricao": "Usado na compra",
                                           "created_at": now_utc(), "por": por})

    base = compra["valor_pago"]
    if cfg.pct_compra > 0:
        c = await _credito(cliente["id"], base * cfg.pct_compra / 100, "compra", compra, cfg, f"{cfg.pct_compra:g}% da compra")
        if c:
            compra["creditos"].append({"id": c["id"], "pessoa_id": cliente["id"], "valor": c["valor"], "origem": "compra"})
    if cliente.get("indicado_por") and cfg.pct_indicacao > 0:
        n = len(anteriores) + 1
        if cfg.compras_indicacao == 0 or n <= cfg.compras_indicacao:
            c = await _credito(cliente["indicado_por"], base * cfg.pct_indicacao / 100, "indicacao", compra, cfg,
                               f"{cfg.pct_indicacao:g}% da {n}ª compra de {(cliente.get('nome') or 'indicado').split(' ')[0]}")
            if c:
                compra["afiliado_id"] = cliente["indicado_por"]
                compra["creditos"].append({"id": c["id"], "pessoa_id": cliente["indicado_por"], "valor": c["valor"], "origem": "indicacao"})
    await db.cb_compras.insert_one(compra)
    return {**compra, "avisos": avisos}


async def estornar(compra: dict, por: str) -> dict:
    if compra.get("estornada"):
        raise ErroCashback("Esta compra já foi estornada.", 409)
    for d in compra.get("debitos") or []:
        cred = await db.cb_movimentos.find_one({"id": d["credito_id"]})
        if cred:
            await db.cb_movimentos.update_one({"id": cred["id"]}, {"$set": {"restante": round(float(cred.get("restante") or 0) + d["valor"], 2)}})
    perdido = 0.0
    for c in compra.get("creditos") or []:
        cred = await db.cb_movimentos.find_one({"id": c["id"]})
        if cred:
            usado = round(float(cred["valor"]) - float(cred.get("restante") or 0), 2)
            perdido += usado
            await db.cb_movimentos.update_one({"id": cred["id"]}, {"$set": {"restante": 0, "estornado": True}})
    await db.cb_compras.update_one({"id": compra["id"]}, {"$set": {"estornada": True, "estornada_em": now_utc(), "estornada_por": por}})
    aviso = f"R$ {brl(perdido)} do cashback desta compra já tinha sido usado e não volta." if perdido > 0.004 else None
    return {"ok": True, "aviso": aviso}
