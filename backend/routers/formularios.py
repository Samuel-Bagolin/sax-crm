"""Formulários, pesquisas e NPS: gestor cria e vê resultados; cliente responde pelo link público (lib/formularios.py)."""

from __future__ import annotations

from typing import Any, List, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from lib import formularios as F
from lib import links
from lib.auth import Principal, require
from lib.db import controle, db, definir_empresa
from models.common import new_id, now_utc

router = APIRouter(prefix="/formularios", tags=["formularios"])
publico_router = APIRouter(prefix="/publico/formularios", tags=["publico"])
GERIR = "pesquisa:gerir"


def _iso(v) -> str | None:
    return v.isoformat() if hasattr(v, "isoformat") else v


class PerguntaIn(BaseModel):
    id: str = Field(min_length=1, max_length=20, pattern=r"^[a-zA-Z0-9_-]+$")
    tipo: Literal["nps", "nota", "escolha", "multipla", "sim_nao", "texto"]
    titulo: str = Field(min_length=2, max_length=300)
    obrigatoria: bool = True
    opcoes: List[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _opcoes(self):
        self.opcoes = [o.strip()[:120] for o in self.opcoes if o.strip()]
        if self.tipo in ("escolha", "multipla") and len(self.opcoes) < 2:
            raise ValueError(f"A pergunta \"{self.titulo}\" precisa de pelo menos duas opções")
        return self


class FormularioIn(BaseModel):
    nome: str = Field(min_length=2, max_length=100)
    descricao: str | None = Field(default=None, max_length=600)
    perguntas: List[PerguntaIn] = Field(min_length=1, max_length=30)
    ativo: bool = True
    auto_apos_atendimento: bool = False
    intervalo_dias: int = Field(default=30, ge=1, le=365)
    conexao_id: str | None = Field(default=None, max_length=60)
    mensagem_whatsapp: str | None = Field(default=None, max_length=600)
    alerta_nota_ate: int = Field(default=6, ge=0, le=9)
    alerta_pessoa_id: str | None = Field(default=None, max_length=60)

    @model_validator(mode="after")
    def _ids(self):
        ids = [p.id for p in self.perguntas]
        if len(set(ids)) != len(ids):
            raise ValueError("Perguntas repetidas")
        return self


class NovoIn(BaseModel):
    modelo: Literal["nps", "satisfacao", "vazio"] = "nps"


def _saida(f: dict) -> dict:
    return {"id": f["id"], "nome": f.get("nome"), "descricao": f.get("descricao"), "perguntas": f.get("perguntas") or [], "ativo": bool(f.get("ativo")),
            "auto_apos_atendimento": bool(f.get("auto_apos_atendimento")), "intervalo_dias": f.get("intervalo_dias") or 30,
            "conexao_id": f.get("conexao_id"), "mensagem_whatsapp": f.get("mensagem_whatsapp") or F.MENSAGEM_PADRAO,
            "alerta_nota_ate": f.get("alerta_nota_ate", 6), "alerta_pessoa_id": f.get("alerta_pessoa_id"),
            "link": F.url_publica(f["token"]) if f.get("token") else None, "respostas": int(f.get("respostas") or 0),
            "criado_em": _iso(f.get("criado_em"))}


async def _form(fid: str) -> dict:
    f = await db.formularios.find_one({"id": fid})
    if not f:
        raise HTTPException(404, "Formulário não encontrado")
    return f


@router.get("")
async def listar(principal: Principal = Depends(require(GERIR))):
    return [_saida(f) for f in await db.formularios.find({}).sort("criado_em", -1).to_list(100)]


@router.post("", status_code=201)
async def criar(input: NovoIn, principal: Principal = Depends(require(GERIR))):
    cfg = await db.configuracoes.find_one({"id": "singleton"}, {"nome_software": 1}) or {}
    fid = new_id()
    base = F.modelo(input.modelo, cfg.get("nome_software") or "")
    token = await links.criar("form", fid)
    doc = {"_id": fid, "id": fid, **base, "ativo": True, "auto_apos_atendimento": False, "intervalo_dias": 30, "alerta_nota_ate": 6,
           "alerta_pessoa_id": principal.pessoa_id, "token": token, "respostas": 0, "empresa_nome": cfg.get("nome_software") or "",
           "criado_em": now_utc(), "criado_por": principal.nome}
    await db.formularios.insert_one(doc)
    return _saida(doc)


@router.put("/{fid}")
async def editar(fid: str, input: FormularioIn, principal: Principal = Depends(require(GERIR))):
    f = await _form(fid)
    if input.conexao_id and not await db.wa_conexoes.find_one({"id": input.conexao_id}, {"id": 1}):
        raise HTTPException(422, "Número de WhatsApp não encontrado")
    if input.alerta_pessoa_id and not await db.pessoas.find_one({"id": input.alerta_pessoa_id}, {"id": 1}):
        raise HTTPException(422, "Escolha quem recebe o alerta")
    dados = input.model_dump()
    if f.get("respostas"):
        # com respostas, não muda o tipo de uma pergunta existente (o resultado ficaria misturado)
        antigos = {p["id"]: p["tipo"] for p in f.get("perguntas") or []}
        if any(p["id"] in antigos and antigos[p["id"]] != p["tipo"] for p in dados["perguntas"]):
            raise HTTPException(409, "Este formulário já tem respostas: crie uma pergunta nova em vez de mudar o tipo.")
    if dados["auto_apos_atendimento"]:  # um só formulário automático
        await db.formularios.update_many({"auto_apos_atendimento": True, "id": {"$ne": fid}}, {"$set": {"auto_apos_atendimento": False}})
    await db.formularios.update_one({"id": fid}, {"$set": {**dados, "atualizado_em": now_utc()}})
    return _saida({**f, **dados})


@router.delete("/{fid}", status_code=204)
async def remover(fid: str, principal: Principal = Depends(require(GERIR))):
    f = await _form(fid)
    if f.get("respostas"):
        raise HTTPException(409, "Este formulário já tem respostas. Desative em vez de excluir.")
    await links.revogar("form", fid)
    await db.formularios.delete_one({"id": fid})


@router.post("/{fid}/novo-link")
async def novo_link(fid: str, principal: Principal = Depends(require(GERIR))):
    """Troca o link público (o anterior para de funcionar)."""
    f = await _form(fid)
    token = await links.criar("form", fid, substituir=True)
    await db.formularios.update_one({"id": fid}, {"$set": {"token": token}})
    return _saida({**f, "token": token})


@router.get("/{fid}/resultado")
async def resultado(fid: str, principal: Principal = Depends(require(GERIR))):
    f = await _form(fid)
    rs = await db.formulario_respostas.find({"formulario_id": fid}).sort("em", -1).to_list(5000)
    perguntas = []
    for p in f.get("perguntas") or []:
        vals = [r["respostas"].get(p["id"]) for r in rs if r.get("respostas", {}).get(p["id"]) not in (None, "", [])]
        item: dict[str, Any] = {"id": p["id"], "tipo": p["tipo"], "titulo": p["titulo"], "respondidas": len(vals)}
        if p["tipo"] == "nps":
            notas = [v for v in vals if isinstance(v, int)]
            item["nps"] = F.calcular_nps(notas)
            item["distribuicao"] = [sum(1 for n in notas if n == i) for i in range(11)]
        elif p["tipo"] == "nota":
            notas = [v for v in vals if isinstance(v, int)]
            item["media"] = round(sum(notas) / len(notas), 2) if notas else None
            item["distribuicao"] = [sum(1 for n in notas if n == i) for i in range(1, 6)]
        elif p["tipo"] in ("escolha", "sim_nao", "multipla"):
            opcoes = p.get("opcoes") or ["Sim", "Não"]
            cont = {o: 0 for o in opcoes}
            for v in vals:
                for o in (v if isinstance(v, list) else [v]):
                    cont[o] = cont.get(o, 0) + 1
            item["contagem"] = [{"opcao": k, "qtd": q} for k, q in cont.items()]
        else:
            item["textos"] = [{"texto": v, "nome": r.get("nome"), "em": _iso(r.get("em"))} for r, v in
                              [(r, r["respostas"].get(p["id"])) for r in rs] if isinstance(v, str) and v.strip()][:60]
        perguntas.append(item)
    por_prof: dict[str, list[int]] = {}
    tipo_nota = next((p["tipo"] for p in f.get("perguntas") or [] if p["tipo"] in ("nps", "nota")), None)
    for r in rs:
        if r.get("profissional_nome") and isinstance(r.get("nota"), int):
            por_prof.setdefault(r["profissional_nome"], []).append(r["nota"])
    profissionais = [{"nome": k, **(F.calcular_nps(v) if tipo_nota == "nps" else {"total": len(v), "media": round(sum(v) / len(v), 2)})}
                     for k, v in sorted(por_prof.items())]
    return {"formulario": _saida(f), "total": len(rs), "perguntas": perguntas, "profissionais": profissionais,
            "respostas": [{"id": r["id"], "nome": r.get("nome"), "em": _iso(r.get("em")), "nota": r.get("nota"), "baixa": bool(r.get("baixa")),
                           "tratada": bool(r.get("tratada")), "origem": r.get("origem"), "profissional_nome": r.get("profissional_nome"),
                           "respostas": r.get("respostas") or {}} for r in rs[:300]]}


@router.post("/respostas/{rid}/tratar")
async def tratar(rid: str, principal: Principal = Depends(require(GERIR))):
    r = await db.formulario_respostas.update_one({"id": rid}, {"$set": {"tratada": True, "tratada_por": principal.nome, "tratada_em": now_utc()}})
    if not r.matched_count:
        raise HTTPException(404, "Resposta não encontrada")
    return {"ok": True}


# ------------------------------------------------------------------ público


async def _resolver(token: str) -> tuple[dict, dict | None]:
    if not token or len(token) < 20 or len(token) > 80:
        raise HTTPException(404, "Link inválido")
    indice = await controle.links_publicos.find_one({"_id": links.digest(token)})
    if not indice or indice.get("tipo") not in ("form", "form_convite"):
        raise HTTPException(404, "Link inválido ou substituído")
    await links.resolver(token, indice["tipo"])  # confere empresa ativa e entra no banco dela
    convite = None
    if indice["tipo"] == "form_convite":
        convite = await db.formulario_convites.find_one({"id": indice["ref"]})
        if not convite:
            raise HTTPException(404, "Link inválido")
        fid = convite["formulario_id"]
    else:
        fid = indice["ref"]
    f = await db.formularios.find_one({"id": fid})
    if not f or not f.get("ativo"):
        raise HTTPException(404, "Esta pesquisa foi encerrada")
    return f, convite


@publico_router.get("/{token}")
async def ver_publico(token: str):
    f, convite = await _resolver(token)
    marca = await links.marca_publica()
    definir_empresa(None)
    return {"nome": f.get("nome"), "descricao": f.get("descricao"), "perguntas": f.get("perguntas") or [], "marca": marca,
            "ja_respondido": bool(convite and convite.get("usado")), "pessoal": bool(convite),
            "nome_cliente": (convite or {}).get("nome")}


class RespostaIn(BaseModel):
    respostas: dict[str, Any] = Field(default_factory=dict)
    nome: str | None = Field(default=None, max_length=120)


def _validar(f: dict, dados: dict) -> dict:
    limpo: dict[str, Any] = {}
    for p in f.get("perguntas") or []:
        v = dados.get(p["id"])
        t = p["tipo"]
        if v in (None, "", []):
            if p.get("obrigatoria"):
                raise HTTPException(422, f"Responda: {p['titulo']}")
            continue
        if t in ("nps", "nota"):
            lo, hi = (0, 10) if t == "nps" else (1, 5)
            if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
                raise HTTPException(422, f"Nota inválida em: {p['titulo']}")
        elif t == "escolha":
            if v not in (p.get("opcoes") or []):
                raise HTTPException(422, f"Escolha uma opção em: {p['titulo']}")
        elif t == "multipla":
            if not isinstance(v, list) or not v or any(x not in (p.get("opcoes") or []) for x in v):
                raise HTTPException(422, f"Escolha as opções em: {p['titulo']}")
            v = list(dict.fromkeys(v))
        elif t == "sim_nao":
            if v not in ("Sim", "Não"):
                raise HTTPException(422, f"Responda sim ou não em: {p['titulo']}")
        else:
            if not isinstance(v, str):
                raise HTTPException(422, f"Texto inválido em: {p['titulo']}")
            v = v.strip()[:2000]
        limpo[p["id"]] = v
    return limpo


@publico_router.post("/{token}", status_code=201)
async def responder(token: str, input: RespostaIn):
    f, convite = await _resolver(token)
    try:
        dados = _validar(f, input.respostas)
        if convite:  # link pessoal: uma resposta só
            r = await db.formulario_convites.update_one({"id": convite["id"], "usado": False}, {"$set": {"usado": True, "usado_em": now_utc()}})
            if r.modified_count != 1:
                raise HTTPException(409, "Esta pesquisa já foi respondida. Obrigado!")
        tipo, valor = F.nota_principal(f, dados)
        rid = new_id()
        doc = {"_id": rid, "id": rid, "formulario_id": f["id"], "respostas": dados, "em": now_utc(), "nota": valor, "tipo_nota": tipo,
               "nome": (convite or {}).get("nome") or ((input.nome or "").strip() or None), "pessoa_id": (convite or {}).get("pessoa_id"),
               "convite_id": (convite or {}).get("id"), "origem": (convite or {}).get("origem") or "link",
               "agendamento_id": (convite or {}).get("agendamento_id"), "profissional_id": (convite or {}).get("profissional_id"),
               "profissional_nome": (convite or {}).get("profissional_nome"), "baixa": F.baixa(f, tipo, valor), "tratada": False}
        await db.formulario_respostas.insert_one(doc)
        await db.formularios.update_one({"id": f["id"]}, {"$inc": {"respostas": 1}})
        if doc["baixa"]:
            try:
                await F.alertar(f, doc, tipo, valor)
            except Exception:
                pass
        return {"ok": True}
    finally:
        definir_empresa(None)
