"""Indicadores do funil (mesma regra do CRM Revendas): coorte para conversão e funil por alcance,
data do ganho para vendas, data da perda para perdas. Voltar um card de etapa não infla o relatório."""

import os
from datetime import datetime, time, timedelta
from typing import List
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from lib.auth import Principal, filtro_do_principal, require
from lib.db import db
from models.common import utc_aware

router = APIRouter(prefix="/relatorios", tags=["relatorios"])


class EtapaFunil(BaseModel):
    id: str
    nome: str
    alcancaram: int
    taxa_do_anterior: float | None = None
    taxa_do_total: float | None = None


class Fatia(BaseModel):
    rotulo: str
    qtd: int
    valor: float = 0


class LinhaResponsavel(BaseModel):
    pessoa_id: str | None
    nome: str
    criados: int = 0
    ganhos: int = 0
    perdidos: int = 0
    valor_ganho: float = 0
    conversao: float | None = None
    atividades_feitas: int = 0
    abertos: int = 0


class Relatorio(BaseModel):
    inicio: str | None
    fim: str | None
    funil_id: str
    funil_nome: str
    leads_recebidos: int = 0
    leads_convertidos: int = 0
    criados: int = 0
    ganhos_coorte: int = 0
    conversao: float | None = None
    ganhos: int = 0
    valor_ganho: float = 0
    ticket_medio: float | None = None
    perdidos: int = 0
    ciclo_medio_dias: float | None = None
    abertos: int = 0
    valor_aberto: float = 0
    valor_ponderado: float = 0
    funil: List[EtapaFunil] = Field(default_factory=list)
    motivos_perda: List[Fatia] = Field(default_factory=list)
    origens: List[Fatia] = Field(default_factory=list)
    responsaveis: List[LinhaResponsavel] = Field(default_factory=list)
    tempo_lead_negocio_horas: float | None = None
    serie_mensal: List[dict] = Field(default_factory=list)


def _tz():
    return ZoneInfo(os.environ.get("APP_TZ", "America/Sao_Paulo"))


def _faixa(inicio: str | None, fim: str | None):
    tz = _tz()
    ini = datetime.combine(datetime.fromisoformat(inicio).date(), time.min, tz) if inicio else None
    fi = datetime.combine(datetime.fromisoformat(fim).date(), time.max, tz) if fim else None
    return ini, fi


def _dentro(dt, ini, fi) -> bool:
    if dt is None:
        return False
    dt = utc_aware(dt)
    return (ini is None or dt >= ini) and (fi is None or dt <= fi)


def _pct(a: int, b: int) -> float | None:
    return round(a / b * 100, 1) if b else None


@router.get("/funil", response_model=Relatorio)
async def relatorio_funil(
    funil_id: str | None = None,
    inicio: str | None = Query(None, description="YYYY-MM-DD"),
    fim: str | None = Query(None, description="YYYY-MM-DD"),
    corretor_id: str | None = None,
    principal: Principal = Depends(require("lead:read")),
):
    try:
        ini, fi = _faixa(inicio, fim)
    except ValueError:
        raise HTTPException(422, "Use datas YYYY-MM-DD")
    funil = await (db.funis.find_one({"id": funil_id}) if funil_id else db.funis.find_one({"padrao": True}))
    if not funil:
        funil = await db.funis.find_one({})
    if not funil:
        raise HTTPException(404, "Nenhum funil configurado")
    etapas = funil.get("etapas", [])
    pos = {e["id"]: i for i, e in enumerate(etapas)}

    filtro = dict(filtro_do_principal(principal, "leads"))
    if corretor_id and principal.is_admin:
        filtro["corretor_id"] = corretor_id
    docs = await db.leads.find({**filtro, "funil_id": funil["id"]}).to_list(None)

    def status(d):
        return d.get("status") or (d.get("estagio") if d.get("estagio") in ("ganho", "perdido") else "aberto")

    def alcance(d) -> int:
        """Maior etapa já alcançada. Ganho = funil inteiro."""
        if status(d) == "ganho":
            return len(etapas) - 1
        idxs = [pos[e] for e in (d.get("etapas_alcancadas") or []) if e in pos]
        idxs.append(pos.get(d.get("etapa_id"), 0))
        return max(idxs)

    coorte = [d for d in docs if _dentro(d.get("created_at"), ini, fi)]
    ganhos = [d for d in docs if status(d) == "ganho" and _dentro(d.get("closed_at"), ini, fi)]
    perdidos = [d for d in docs if status(d) == "perdido" and _dentro(d.get("closed_at"), ini, fi)]
    abertos = [d for d in docs if status(d) == "aberto"]
    ganhos_coorte = sum(1 for d in coorte if status(d) == "ganho")
    decididos_coorte = sum(1 for d in coorte if status(d) in ("ganho", "perdido"))

    r = Relatorio(inicio=inicio, fim=fim, funil_id=funil["id"], funil_nome=funil["nome"])
    r.criados = len(coorte)
    r.ganhos_coorte = ganhos_coorte
    r.conversao = _pct(ganhos_coorte, len(coorte)) if len(coorte) else None
    r.ganhos = len(ganhos)
    r.valor_ganho = round(sum(d.get("valor_estimado") or 0 for d in ganhos), 2)
    r.ticket_medio = round(r.valor_ganho / r.ganhos, 2) if r.ganhos else None
    ciclos = [(utc_aware(d["closed_at"]) - utc_aware(d["created_at"])).total_seconds() / 86400 for d in ganhos if d.get("created_at")]
    r.ciclo_medio_dias = round(sum(ciclos) / len(ciclos), 1) if ciclos else None
    r.perdidos = len(perdidos)
    r.abertos = len(abertos)
    r.valor_aberto = round(sum(d.get("valor_estimado") or 0 for d in abertos), 2)
    r.valor_ponderado = round(sum((d.get("valor_estimado") or 0) * etapas[pos.get(d.get("etapa_id"), 0)].get("probabilidade", 0) / 100 for d in abertos if etapas), 2)

    # Funil por alcance da coorte, + a linha final "Ganho".
    total = len(coorte)
    anterior = None
    for i, e in enumerate(etapas):
        n = sum(1 for d in coorte if alcance(d) >= i)
        r.funil.append(EtapaFunil(id=e["id"], nome=e["nome"], alcancaram=n,
                                  taxa_do_anterior=_pct(n, anterior) if anterior is not None else None, taxa_do_total=_pct(n, total)))
        anterior = n
    r.funil.append(EtapaFunil(id="__ganho", nome="Ganho", alcancaram=ganhos_coorte,
                              taxa_do_anterior=_pct(ganhos_coorte, anterior or 0), taxa_do_total=_pct(ganhos_coorte, total)))

    motivos: dict[str, int] = {}
    for d in perdidos:
        m = (d.get("motivo_perda") or "Sem motivo").split(" — ")[0]
        motivos[m] = motivos.get(m, 0) + 1
    r.motivos_perda = sorted((Fatia(rotulo=k, qtd=v) for k, v in motivos.items()), key=lambda x: -x.qtd)

    origens: dict[str, list] = {}
    for d in coorte:
        o = d.get("origem") or "Não informado"
        origens.setdefault(o, [0, 0, 0.0])
        origens[o][0] += 1
        if status(d) == "ganho":
            origens[o][1] += 1
            origens[o][2] += d.get("valor_estimado") or 0
    r.origens = sorted((Fatia(rotulo=f"{k}|{v[1]}", qtd=v[0], valor=round(v[2], 2)) for k, v in origens.items()), key=lambda x: -x.qtd)

    # Caixa de entrada no período (lead → negócio)
    filtro_ent = {} if principal.is_admin else {"corretor_id": principal.pessoa_id or "__sem__"}
    if corretor_id and principal.is_admin:
        filtro_ent["corretor_id"] = corretor_id
    entradas = [e for e in await db.entradas.find(filtro_ent).to_list(None) if _dentro(e.get("created_at"), ini, fi)]
    r.leads_recebidos = len(entradas)
    r.leads_convertidos = sum(1 for e in entradas if e.get("status") == "convertido")
    neg_por_entrada = {d.get("entrada_id"): d for d in docs if d.get("entrada_id")}
    horas = [(utc_aware(neg_por_entrada[e["id"]]["created_at"]) - utc_aware(e["created_at"])).total_seconds() / 3600
             for e in entradas if e["id"] in neg_por_entrada]
    r.tempo_lead_negocio_horas = round(sum(horas) / len(horas), 1) if horas else None

    # Por responsável
    pessoas = {p["id"]: p["nome"] async for p in db.pessoas.find({"papeis": "corretor"}, {"id": 1, "nome": 1})}
    linhas: dict[str | None, LinhaResponsavel] = {}

    def linha(pid):
        if pid not in linhas:
            linhas[pid] = LinhaResponsavel(pessoa_id=pid, nome=pessoas.get(pid, "Sem responsável") if pid else "Sem responsável")
        return linhas[pid]

    for d in coorte:
        linha(d.get("corretor_id")).criados += 1
    for d in ganhos:
        lr = linha(d.get("corretor_id"))
        lr.ganhos += 1
        lr.valor_ganho += d.get("valor_estimado") or 0
    for d in perdidos:
        linha(d.get("corretor_id")).perdidos += 1
    for d in abertos:
        linha(d.get("corretor_id")).abertos += 1
    async for a in db.atividades.find({"concluida": True, **({"corretor_id": corretor_id} if corretor_id and principal.is_admin else filtro_do_principal(principal, "atividades"))}):
        if _dentro(a.get("concluida_em"), ini, fi) and a.get("corretor_id") in linhas:
            linhas[a["corretor_id"]].atividades_feitas += 1
    for pid, lr in linhas.items():
        ganhos_c = sum(1 for d in coorte if d.get("corretor_id") == pid and status(d) == "ganho")
        lr.conversao = _pct(ganhos_c, lr.criados) if lr.criados else None
        lr.valor_ganho = round(lr.valor_ganho, 2)
    r.responsaveis = sorted(linhas.values(), key=lambda x: (-x.valor_ganho, -x.criados))

    # Série dos últimos 6 meses (criados x ganhos), independe do período escolhido.
    hoje = datetime.now(_tz()).date().replace(day=1)
    meses = []
    for k in range(5, -1, -1):
        y, m = hoje.year, hoje.month - k
        while m <= 0:
            y, m = y - 1, m + 12
        meses.append(f"{y:04d}-{m:02d}")
    for mes in meses:
        def no_mes(dt):
            return dt is not None and utc_aware(dt).astimezone(_tz()).strftime("%Y-%m") == mes
        r.serie_mensal.append({
            "mes": mes,
            "criados": sum(1 for d in docs if no_mes(d.get("created_at"))),
            "ganhos": sum(1 for d in docs if status(d) == "ganho" and no_mes(d.get("closed_at"))),
            "valor": round(sum(d.get("valor_estimado") or 0 for d in docs if status(d) == "ganho" and no_mes(d.get("closed_at"))), 2),
        })
    return r


# ================================================================== atendimento (SLA do primeiro contato)


class LinhaAtendimento(BaseModel):
    rotulo: str
    leads: int = 0
    respondidos: int = 0
    dentro_sla: int = 0
    mediana_min: float | None = None
    convertidos: int = 0


class RelatorioAtendimento(BaseModel):
    sla_min: int | None
    leads: int = 0
    respondidos: int = 0
    dentro_sla: int = 0
    pct_dentro_sla: float | None = None
    mediana_min: float | None = None
    media_min: float | None = None
    aguardando: int = 0
    aguardando_fora_sla: int = 0
    convertidos: int = 0
    por_responsavel: List[LinhaAtendimento] = Field(default_factory=list)
    por_origem: List[LinhaAtendimento] = Field(default_factory=list)


def _mediana(valores: list[float]) -> float | None:
    if not valores:
        return None
    v = sorted(valores)
    m = len(v) // 2
    return round(v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2, 1)


@router.get("/atendimento", response_model=RelatorioAtendimento)
async def atendimento(inicio: str | None = Query(None), fim: str | None = Query(None), corretor_id: str | None = None,
                      principal: Principal = Depends(require("entrada:read"))):
    """Tempo até o primeiro contato com o lead (minutos corridos) e % dentro do SLA configurado."""
    from lib.crm import carregar_crm_config
    from models.common import now_utc

    sla = (await carregar_crm_config()).sla_primeiro_contato_min
    ini, fi = _faixa(inicio, fim)
    filtro: dict = dict(filtro_do_principal(principal, "entradas"))
    if corretor_id and principal.is_admin:
        filtro["corretor_id"] = corretor_id
    if ini or fi:
        filtro["created_at"] = {k: v for k, v in (("$gte", ini), ("$lte", fi)) if v}
    agora = now_utc()
    rel = RelatorioAtendimento(sla_min=sla)
    tempos: list[float] = []
    grupos: dict[tuple[str, str], dict] = {}
    nomes = {p["id"]: p["nome"] async for p in db.pessoas.find({"papeis": "corretor"}, {"id": 1, "nome": 1})}
    async for e in db.entradas.find(filtro):
        rel.leads += 1
        criado = utc_aware(e.get("created_at"))
        contato = utc_aware(e.get("primeiro_contato_em"))
        convertido = e.get("status") == "convertido"
        minutos = (contato - criado).total_seconds() / 60 if contato and criado else None
        dentro = minutos is not None and (sla is None or minutos <= sla)
        if minutos is not None:
            rel.respondidos += 1
            tempos.append(max(0.0, minutos))
            rel.dentro_sla += dentro
        elif e.get("status") == "novo":
            rel.aguardando += 1
            if sla and criado and (agora - criado).total_seconds() / 60 > sla:
                rel.aguardando_fora_sla += 1
        rel.convertidos += convertido
        for chave in (("r", nomes.get(e.get("corretor_id"), "Sem responsável")), ("o", e.get("origem") or "Sem origem")):
            g = grupos.setdefault(chave, {"leads": 0, "respondidos": 0, "dentro": 0, "tempos": [], "convertidos": 0})
            g["leads"] += 1
            g["convertidos"] += convertido
            if minutos is not None:
                g["respondidos"] += 1
                g["dentro"] += dentro
                g["tempos"].append(max(0.0, minutos))
    rel.mediana_min = _mediana(tempos)
    rel.media_min = round(sum(tempos) / len(tempos), 1) if tempos else None
    rel.pct_dentro_sla = round(rel.dentro_sla / rel.respondidos * 100, 1) if rel.respondidos else None
    for (tipo, rotulo), g in sorted(grupos.items(), key=lambda kv: -kv[1]["leads"]):
        linha = LinhaAtendimento(rotulo=rotulo, leads=g["leads"], respondidos=g["respondidos"], dentro_sla=g["dentro"],
                                 mediana_min=_mediana(g["tempos"]), convertidos=g["convertidos"])
        (rel.por_responsavel if tipo == "r" else rel.por_origem).append(linha)
    return rel
