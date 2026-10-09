"""Match cliente ↔ imóvel e vitrine para o cliente.

- Perfil de busca no negócio (o que o cliente procura).
- Imóveis compatíveis com nota e motivos; clientes compatíveis na ficha do imóvel.
- Vitrine: o corretor escolhe imóveis e manda UM link. O cliente vê fotos e dados (sem endereço
  exato nem proprietário) e marca "gostei", "não é pra mim" ou "quero visitar". Cada reação volta
  para o histórico do negócio; "quero visitar" já cria a atividade para o corretor.
"""

from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from lib import links
from lib.auth import Principal, authorize, filtro_do_principal, require
from lib.crm import registrar
from lib.dates import today_iso
from lib.db import db
from lib.match import perfil_do_imovel, perfil_vazio, pontuar, valor_do_imovel
from lib.planos import exigir_recurso
from models.common import new_id, now_utc, utc_aware
from models.crm import Atividade

router = APIRouter(tags=["match"])
publico_router = APIRouter(prefix="/publico/vitrine", tags=["publico"])

TipoImovel = Literal["apartamento", "casa", "terreno", "comercial"]


class PerfilBusca(BaseModel):
    finalidade: Literal["venda", "locacao"] = "venda"
    tipos: List[TipoImovel] = Field(default_factory=list, max_length=4)
    cidades: List[str] = Field(default_factory=list, max_length=10)
    bairros: List[str] = Field(default_factory=list, max_length=30)
    valor_min: float | None = Field(default=None, ge=0)
    valor_max: float | None = Field(default=None, ge=0)
    quartos_min: int | None = Field(default=None, ge=0, le=20)
    vagas_min: int | None = Field(default=None, ge=0, le=20)
    area_min: float | None = Field(default=None, ge=0)
    observacao: str | None = Field(default=None, max_length=1000)


class PerfilResposta(BaseModel):
    perfil: PerfilBusca | None
    sugestao: PerfilBusca | None = None  # a partir do imóvel de interesse, quando não há perfil


class ImovelCard(BaseModel):
    id: str
    codigo: str
    titulo: str
    tipo: str
    finalidade: str
    status: str
    bairro: str | None = None
    cidade: str
    quartos: int = 0
    suites: int = 0
    vagas: int = 0
    area_util: float | None = None
    valor: float | None = None
    foto_url: str | None = None


class Compativel(BaseModel):
    imovel: ImovelCard
    score: int
    motivos: List[str]
    alertas: List[str]
    enviado_em: str | None = None
    reacao: str | None = None


class Interessado(BaseModel):
    negocio_id: str
    nome: str
    cliente_nome: str | None = None
    corretor_nome: str | None = None
    score: int
    motivos: List[str]
    alertas: List[str]


class NovaVitrine(BaseModel):
    imovel_ids: List[str] = Field(min_length=1, max_length=20)
    mensagem: str | None = Field(default=None, max_length=1000)


class ReacaoItem(BaseModel):
    imovel_id: str
    reacao: Literal["gostei", "nao_gostei", "quero_visitar"]
    comentario: str | None = None
    em: str


class Vitrine(BaseModel):
    id: str
    negocio_id: str
    imovel_ids: List[str]
    mensagem: str | None = None
    criado_por_nome: str | None = None
    criado_em: str
    visualizada_em: str | None = None
    reacoes: List[ReacaoItem] = Field(default_factory=list)
    ativa: bool = True
    token: str | None = None  # só na criação


# ------------------------------------------------------------------ auxiliares


def _card(imovel: dict, finalidade: str | None = None) -> ImovelCard:
    return ImovelCard(
        id=imovel["id"], codigo=imovel.get("codigo") or "", titulo=imovel["titulo"], tipo=imovel["tipo"],
        finalidade=imovel["finalidade"], status=imovel.get("status", "captado"), bairro=imovel.get("bairro"),
        cidade=imovel.get("cidade", ""), quartos=imovel.get("quartos") or 0, suites=imovel.get("suites") or 0,
        vagas=imovel.get("vagas") or 0, area_util=imovel.get("area_util"), valor=valor_do_imovel(imovel, finalidade),
        foto_url=imovel.get("foto_url"),
    )


async def _negocio(negocio_id: str, principal: Principal, acao: str = "lead:read") -> dict:
    doc = await db.leads.find_one({"id": negocio_id})
    if not doc:
        raise HTTPException(404, "Negócio não encontrado")
    authorize(principal, acao, doc)
    return doc


def _iso(dt) -> str | None:
    dt = utc_aware(dt)
    return dt.isoformat() if dt else None


def _vitrine(d: dict) -> Vitrine:
    return Vitrine(
        id=d["id"], negocio_id=d["negocio_id"], imovel_ids=d["imovel_ids"], mensagem=d.get("mensagem"),
        criado_por_nome=d.get("criado_por_nome"), criado_em=_iso(d["criado_em"]), visualizada_em=_iso(d.get("visualizada_em")),
        reacoes=[ReacaoItem(**{**r, "em": _iso(r["em"])}) for r in d.get("reacoes", [])], ativa=d.get("ativa", True),
    )


# ------------------------------------------------------------------ perfil e compatíveis


@router.get("/leads/{negocio_id}/perfil", response_model=PerfilResposta)
async def ler_perfil(negocio_id: str, principal: Principal = Depends(require("lead:read"))):
    n = await _negocio(negocio_id, principal)
    if n.get("perfil_busca"):
        return PerfilResposta(perfil=PerfilBusca(**n["perfil_busca"]))
    imovel = await db.imoveis.find_one({"id": n.get("imovel_id")}) if n.get("imovel_id") else None
    return PerfilResposta(perfil=None, sugestao=PerfilBusca(**perfil_do_imovel(imovel)) if imovel else None)


@router.put("/leads/{negocio_id}/perfil", response_model=PerfilBusca)
async def salvar_perfil(negocio_id: str, input: PerfilBusca, principal: Principal = Depends(require("lead:update"))):
    await _negocio(negocio_id, principal, "lead:update")
    if input.valor_min and input.valor_max and input.valor_min > input.valor_max:
        raise HTTPException(422, "Valor mínimo maior que o máximo")
    limpo = input.model_dump()
    for k in ("cidades", "bairros"):
        vistos, lista = set(), []
        for v in limpo[k]:
            v = v.strip()[:80]
            if v and v.lower() not in vistos:
                vistos.add(v.lower())
                lista.append(v)
        limpo[k] = lista
    await db.leads.update_one({"id": negocio_id}, {"$set": {"perfil_busca": limpo, "updated_at": now_utc()}})
    await registrar(negocio_id, "match", "Perfil de busca do cliente atualizado", principal)
    return PerfilBusca(**limpo)


async def _enviados(negocio_id: str) -> dict[str, tuple[str, str | None]]:
    """imovel_id → (enviado_em, última reação)."""
    saida: dict[str, tuple[str, str | None]] = {}
    async for v in db.vitrines.find({"negocio_id": negocio_id}).sort("criado_em", 1):
        for iid in v["imovel_ids"]:
            saida[iid] = (_iso(v["criado_em"]), saida.get(iid, (None, None))[1])
        for r in v.get("reacoes", []):
            saida[r["imovel_id"]] = (saida.get(r["imovel_id"], (_iso(v["criado_em"]), None))[0], r["reacao"])
    return saida


@router.get("/leads/{negocio_id}/compativeis", response_model=List[Compativel])
async def compativeis(negocio_id: str, limite: int = 30, principal: Principal = Depends(require("lead:read"))):
    await exigir_recurso("match")
    n = await _negocio(negocio_id, principal)
    perfil = n.get("perfil_busca")
    if perfil_vazio(perfil):
        return []
    enviados = await _enviados(negocio_id)
    resultado = []
    async for im in db.imoveis.find({"status": {"$nin": ["vendido", "alugado"]}}):
        nota = pontuar(perfil, im)
        if nota and nota["score"] >= 40:
            env = enviados.get(im["id"], (None, None))
            resultado.append(Compativel(imovel=_card(im, perfil.get("finalidade")), enviado_em=env[0], reacao=env[1], **nota))
    resultado.sort(key=lambda c: (-c.score, c.imovel.valor or 0))
    return resultado[: max(1, min(limite, 100))]


@router.get("/imoveis/{imovel_id}/interessados", response_model=List[Interessado])
async def interessados(imovel_id: str, principal: Principal = Depends(require("imovel:read"))):
    await exigir_recurso("match")
    im = await db.imoveis.find_one({"id": imovel_id})
    if not im:
        raise HTTPException(404, "Imóvel não encontrado")
    filtro = {"status": "aberto", "perfil_busca": {"$ne": None}, **filtro_do_principal(principal, "leads")}
    saida = []
    async for n in db.leads.find(filtro):
        nota = pontuar(n["perfil_busca"], im)
        if not nota or nota["score"] < 60:
            continue
        cliente = await db.pessoas.find_one({"id": n.get("cliente_id")}, {"nome": 1}) if n.get("cliente_id") else None
        corretor = await db.pessoas.find_one({"id": n.get("corretor_id")}, {"nome": 1}) if n.get("corretor_id") else None
        saida.append(Interessado(negocio_id=n["id"], nome=n["nome"], cliente_nome=(cliente or {}).get("nome"),
                                 corretor_nome=(corretor or {}).get("nome"), **nota))
    saida.sort(key=lambda i: -i.score)
    return saida[:50]


async def avisar_novos_compativeis(imovel_id: str) -> int:
    """Imóvel novo/atualizado: registra no histórico dos negócios abertos com nota ≥ 75 (uma vez por par)."""
    from lib.planos import recurso_liberado

    if not await recurso_liberado("match"):
        return 0
    im = await db.imoveis.find_one({"id": imovel_id})
    if not im or im.get("status") in ("vendido", "alugado"):
        return 0
    avisados = 0
    async for n in db.leads.find({"status": "aberto", "perfil_busca": {"$ne": None}}):
        nota = pontuar(n["perfil_busca"], im)
        if not nota or nota["score"] < 75:
            continue
        r = await db.match_avisos.update_one({"_id": f"{n['id']}:{imovel_id}"}, {"$setOnInsert": {"em": now_utc()}}, upsert=True)
        if r.upserted_id is None:
            continue
        await registrar(n["id"], "match", f"Imóvel compatível disponível: {im.get('codigo')} · {im['titulo']} ({nota['score']}%)")
        avisados += 1
    return avisados


# ------------------------------------------------------------------ vitrine (interno)


@router.post("/leads/{negocio_id}/vitrines", response_model=Vitrine, status_code=201)
async def criar_vitrine(negocio_id: str, input: NovaVitrine, principal: Principal = Depends(require("lead:update"))):
    await exigir_recurso("match")
    n = await _negocio(negocio_id, principal, "lead:update")
    ids = list(dict.fromkeys(input.imovel_ids))
    encontrados = {d["id"]: d async for d in db.imoveis.find({"id": {"$in": ids}}, {"id": 1, "codigo": 1, "status": 1})}
    faltando = [i for i in ids if i not in encontrados]
    if faltando:
        raise HTTPException(422, "Imóvel não encontrado na seleção")
    vid = new_id()
    doc = {"id": vid, "negocio_id": n["id"], "imovel_ids": ids, "mensagem": (input.mensagem or "").strip() or None,
           "criado_por": principal.usuario_id, "criado_por_nome": principal.nome, "corretor_id": n.get("corretor_id"),
           "criado_em": now_utc(), "visualizada_em": None, "reacoes": [], "ativa": True}
    await db.vitrines.insert_one(doc)
    token = await links.criar("vitrine", vid)
    codigos = ", ".join(encontrados[i].get("codigo") or "?" for i in ids)
    await registrar(n["id"], "vitrine", f"Vitrine enviada com {len(ids)} imóvel(is): {codigos}", principal)
    v = _vitrine(doc)
    v.token = token
    return v


@router.get("/leads/{negocio_id}/vitrines", response_model=List[Vitrine])
async def listar_vitrines(negocio_id: str, principal: Principal = Depends(require("lead:read"))):
    await _negocio(negocio_id, principal)
    return [_vitrine(d) async for d in db.vitrines.find({"negocio_id": negocio_id}).sort("criado_em", -1)]


@router.post("/vitrines/{vitrine_id}/novo-link", response_model=Vitrine)
async def novo_link(vitrine_id: str, principal: Principal = Depends(require("lead:update"))):
    """O token não é guardado; para reenviar, gera-se um novo e o anterior deixa de valer."""
    d = await db.vitrines.find_one({"id": vitrine_id})
    if not d:
        raise HTTPException(404, "Vitrine não encontrada")
    await _negocio(d["negocio_id"], principal, "lead:update")
    await db.vitrines.update_one({"id": vitrine_id}, {"$set": {"ativa": True}})
    v = _vitrine({**d, "ativa": True})
    v.token = await links.criar("vitrine", vitrine_id, substituir=True)
    return v


@router.delete("/vitrines/{vitrine_id}", status_code=204)
async def desativar_vitrine(vitrine_id: str, principal: Principal = Depends(require("lead:update"))):
    d = await db.vitrines.find_one({"id": vitrine_id})
    if not d:
        raise HTTPException(404, "Vitrine não encontrada")
    await _negocio(d["negocio_id"], principal, "lead:update")
    await links.revogar("vitrine", vitrine_id)
    await db.vitrines.update_one({"id": vitrine_id}, {"$set": {"ativa": False}})
    return None


# ------------------------------------------------------------------ vitrine (página pública)


class ImovelVitrine(BaseModel):
    id: str
    codigo: str
    titulo: str
    tipo: str
    finalidade: str
    bairro: str | None = None
    cidade: str
    quartos: int = 0
    suites: int = 0
    banheiros: int = 0
    vagas: int = 0
    area_util: float | None = None
    valor: float | None = None
    condominio: float | None = None
    iptu: float | None = None
    descricao: str | None = None
    fotos: List[str] = Field(default_factory=list)
    disponivel: bool = True
    reacao: str | None = None


class VitrinePublica(BaseModel):
    empresa_nome: str
    cor_primaria: str
    tem_logo: bool
    cliente_nome: str | None = None
    corretor_nome: str | None = None
    corretor_telefone: str | None = None
    mensagem: str | None = None
    finalidade: str = "venda"
    imoveis: List[ImovelVitrine]


class ReacaoInput(BaseModel):
    imovel_id: str
    reacao: Literal["gostei", "nao_gostei", "quero_visitar"]
    comentario: str | None = Field(default=None, max_length=500)


async def _vitrine_publica(token: str) -> dict:
    vid = await links.resolver(token, "vitrine")
    v = await db.vitrines.find_one({"id": vid})
    if not v or not v.get("ativa", True):
        raise HTTPException(404, "Link indisponível")
    return v


@publico_router.get("/{token}", response_model=VitrinePublica)
async def abrir_vitrine(token: str):
    v = await _vitrine_publica(token)
    n = await db.leads.find_one({"id": v["negocio_id"]}) or {}
    finalidade = (n.get("perfil_busca") or {}).get("finalidade") or "venda"
    if not v.get("visualizada_em"):
        await db.vitrines.update_one({"id": v["id"]}, {"$set": {"visualizada_em": now_utc()}})
        if n:
            await registrar(n["id"], "vitrine", "O cliente abriu a vitrine de imóveis")
    from routers.fotos_imovel import listar as listar_fotos, url_publica

    reacoes = {r["imovel_id"]: r["reacao"] for r in v.get("reacoes", [])}
    imoveis = []
    for iid in v["imovel_ids"]:
        im = await db.imoveis.find_one({"id": iid})
        if not im:
            continue
        fotos = [url_publica(f["id"]) for f in await listar_fotos(iid)] or ([im["foto_url"]] if im.get("foto_url") else [])
        imoveis.append(ImovelVitrine(
            id=iid, codigo=im.get("codigo") or "", titulo=im["titulo"], tipo=im["tipo"], finalidade=im["finalidade"],
            bairro=im.get("bairro"), cidade=im.get("cidade", ""), quartos=im.get("quartos") or 0, suites=im.get("suites") or 0,
            banheiros=im.get("banheiros") or 0, vagas=im.get("vagas") or 0, area_util=im.get("area_util"),
            valor=valor_do_imovel(im, finalidade), condominio=im.get("condominio"), iptu=im.get("iptu"),
            descricao=im.get("descricao"), fotos=fotos, disponivel=im.get("status") not in ("vendido", "alugado"),
            reacao=reacoes.get(iid),
        ))
    cliente = await db.pessoas.find_one({"id": n.get("cliente_id")}, {"nome": 1}) if n.get("cliente_id") else None
    corretor = await db.pessoas.find_one({"id": v.get("corretor_id") or n.get("corretor_id")}, {"nome": 1, "telefone": 1}) if (v.get("corretor_id") or n.get("corretor_id")) else None
    usuario = await db.usuarios.find_one({"pessoa_id": (corretor or {}).get("id")}, {"telefone": 1}) if corretor else None
    if not corretor:
        usuario = await db.usuarios.find_one({"id": v.get("criado_por")}, {"nome": 1, "telefone": 1})
    return VitrinePublica(
        **await links.marca_publica(), cliente_nome=((cliente or {}).get("nome") or "").split(" ")[0] or None,
        corretor_nome=(corretor or usuario or {}).get("nome"),
        corretor_telefone=(usuario or {}).get("telefone") or (corretor or {}).get("telefone"),
        mensagem=v.get("mensagem"), finalidade=finalidade, imoveis=imoveis,
    )


@publico_router.post("/{token}/reacao", status_code=204)
async def reagir(token: str, input: ReacaoInput):
    v = await _vitrine_publica(token)
    if input.imovel_id not in v["imovel_ids"]:
        raise HTTPException(404, "Imóvel não faz parte desta seleção")
    comentario = (input.comentario or "").strip() or None
    await db.vitrines.update_one({"id": v["id"]}, {"$pull": {"reacoes": {"imovel_id": input.imovel_id}}})
    await db.vitrines.update_one({"id": v["id"]}, {"$push": {"reacoes": {"imovel_id": input.imovel_id, "reacao": input.reacao,
                                                                       "comentario": comentario, "em": now_utc()}}})
    im = await db.imoveis.find_one({"id": input.imovel_id}, {"codigo": 1, "titulo": 1}) or {}
    n = await db.leads.find_one({"id": v["negocio_id"]})
    if not n:
        return Response(status_code=204)
    rotulo = {"gostei": "gostou de", "nao_gostei": "descartou", "quero_visitar": "quer visitar"}[input.reacao]
    texto = f"Cliente {rotulo} {im.get('codigo', '')} · {im.get('titulo', '')}" + (f" — “{comentario}”" if comentario else "")
    await registrar(n["id"], "vitrine", texto)
    if input.reacao == "quero_visitar":
        chave = f"vitrine-visita:{v['id']}:{input.imovel_id}"
        r = await db.automacoes_execucoes.update_one({"_id": chave}, {"$setOnInsert": {"em": now_utc()}}, upsert=True)
        if r.upserted_id is not None:
            a = Atividade(tipo="visita", assunto=f"Agendar visita pedida pelo cliente: {im.get('codigo', '')}", data=today_iso(),
                          negocio_id=n["id"], pessoa_id=n.get("cliente_id"), imovel_id=input.imovel_id,
                          corretor_id=n.get("corretor_id"), notas=comentario, created_by="vitrine")
            await db.atividades.insert_one(a.model_dump())
    return Response(status_code=204)


@publico_router.get("/{token}/logo")
async def logo_vitrine(token: str):
    await _vitrine_publica(token)
    return await logo_empresa()


async def logo_empresa() -> Response:
    import base64

    config = await db.configuracoes.find_one({"id": "singleton"}, {"logo_base64": 1, "logo_mime": 1}) or {}
    if not config.get("logo_base64"):
        raise HTTPException(404, "Sem logotipo")
    return Response(base64.b64decode(config["logo_base64"]), media_type=config.get("logo_mime") or "image/png",
                    headers={"Cache-Control": "public, max-age=3600"})
