"""Clientes e pacientes dos segmentos de atendimento: ficha, anamnese, prontuário, odontograma,
mapa facial e planos de tratamento (orçamentos).

Prontuário é dado de saúde (LGPD, dado sensível):
- Lê quem escreveu, o gestor e o profissional que atende o paciente (tem agendamento com ele).
- Cada leitura do prontuário fica registrada em `prontuario_acessos`.
- Evolução pode ser corrigida pelo autor por 24 horas; depois disso só com adendo (o texto original
  não muda), como pede a boa prática de prontuário.

Plano de tratamento (odontologia e estética) vira negócio no funil "Orçamentos" quando apresentado,
ganho quando aprovado (gera as parcelas no Financeiro) e perdido quando recusado. Assim o CRM mostra
os orçamentos parados para follow-up.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from lib.agenda_online import agora_local
from lib.auth import Principal, require
from lib.db import db
from lib.integrity import split_money
from models.common import new_id, now_utc, utc_aware

router = APIRouter(prefix="/pacientes", tags=["pacientes"])

PAPEIS_ATENDIDOS = ["paciente", "cliente"]


def _limpo(d: dict | None) -> dict | None:
    return {k: v for k, v in d.items() if k != "_id"} if d else None


async def _paciente(pid: str) -> dict:
    p = await db.pessoas.find_one({"id": pid})
    if not p:
        raise HTTPException(404, "Cadastro não encontrado")
    return p


async def _atende(principal: Principal, paciente_id: str) -> bool:
    """Gestor sempre. Profissional só se atende de fato este paciente: precisa estar marcado como
    quem atende e ter um atendimento confirmado, em andamento ou concluído com ele, ou um agendamento
    feito por outra pessoa (recepção, gestor ou o próprio paciente pelo link). Um agendamento que o
    profissional criou para si mesmo e ninguém confirmou não abre o prontuário."""
    if principal.is_admin:
        return True
    eu = await db.usuarios.find_one({"id": principal.usuario_id}, {"atende": 1})
    if not (eu or {}).get("atende"):
        return False
    p = await db.pessoas.find_one({"id": paciente_id}, {"criado_por_id": 1})
    if (p or {}).get("criado_por_id") == principal.usuario_id:
        return True  # cadastro feito por este profissional (ex.: orçamento de paciente novo): ninguém mais tem histórico nele
    async for a in db.agendamentos.find({"cliente_id": paciente_id, "profissional_id": principal.usuario_id},
                                        {"status": 1, "criado_por_id": 1}):
        if a.get("status") in ("confirmado", "em_atendimento", "concluido"):
            return True
        if a.get("status") == "agendado" and a.get("criado_por_id") != principal.usuario_id:
            return True
    return False


async def _exigir_atende(principal: Principal, paciente_id: str) -> None:
    if not await _atende(principal, paciente_id):
        raise HTTPException(403, "Só o profissional que atende este paciente ou o gestor faz isso")


# ------------------------------------------------------------------ lista e ficha


@router.get("")
async def listar(busca: str | None = Query(None, max_length=80), principal: Principal = Depends(require("paciente:read"))):
    docs = await db.pessoas.find({"papeis": {"$in": PAPEIS_ATENDIDOS}}).to_list(5000)
    if busca:
        t = busca.lower().strip()
        docs = [p for p in docs if t in " ".join(str(p.get(k) or "") for k in ("nome", "telefone", "email", "cpf_cnpj")).lower()]
    docs.sort(key=lambda p: p.get("nome", "").lower())
    return [{"id": p["id"], "nome": p["nome"], "telefone": p.get("telefone"), "email": p.get("email"),
             "data_nascimento": p.get("data_nascimento"), "ultimo_atendimento": p.get("ultimo_atendimento"),
             "cpf_cnpj": p.get("cpf_cnpj")} for p in docs[:2000]]


class PacienteIn(BaseModel):
    nome: str = Field(min_length=2, max_length=200)
    telefone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=200)
    cpf_cnpj: str | None = Field(default=None, max_length=20)
    data_nascimento: str | None = Field(default=None, max_length=10)
    profissao: str | None = Field(default=None, max_length=120)
    cep: str | None = Field(default=None, max_length=10)
    logradouro: str | None = Field(default=None, max_length=200)
    numero: str | None = Field(default=None, max_length=20)
    bairro: str | None = Field(default=None, max_length=120)
    cidade: str | None = Field(default=None, max_length=120)
    estado: str | None = Field(default=None, max_length=2)
    observacoes: str | None = Field(default=None, max_length=2000)


@router.post("", status_code=201)
async def criar(input: PacienteIn, principal: Principal = Depends(require("paciente:write"))):
    from lib.assinatura import so_digitos
    from models.pessoas import Pessoa, cpf_valido, formatar_documento

    doc = so_digitos(input.cpf_cnpj)
    if doc and not (len(doc) == 11 and cpf_valido(doc)):
        raise HTTPException(422, "CPF inválido")
    if doc and await db.pessoas.find_one({"documento_digitos": doc}, {"id": 1}):
        raise HTTPException(409, "Já existe um cadastro com este CPF")
    papel = "paciente" if principal.segmento in ("terapia", "odontologia") else "cliente"
    p = Pessoa(**{**input.model_dump(), "cpf_cnpj": formatar_documento(doc) if doc else None, "papeis": [papel]}).model_dump()
    p["telefone_digitos"] = so_digitos(input.telefone) or None
    p["documento_digitos"] = doc or None
    p["criado_por_id"] = principal.usuario_id
    await db.pessoas.insert_one(p)
    return _limpo(p)


# ------------------------------------------------------------------ orçamentos (tela direta)


@router.get("/orcamentos/lista")
async def listar_orcamentos(status: str | None = None, principal: Principal = Depends(require("tratamento:read"))):
    """Todos os orçamentos (planos de tratamento). O gestor vê todos; o profissional, os dele."""
    filtro: dict = {} if principal.is_admin else {"profissional_id": principal.usuario_id}
    if status:
        filtro["status"] = status
    docs = await db.planos_tratamento.find(filtro).to_list(2000)
    docs.sort(key=lambda t: t.get("created_at") or now_utc(), reverse=True)
    return [{k: t.get(k) for k in ("id", "paciente_id", "paciente_nome", "titulo", "tipo", "status", "total", "parcelas", "profissional_nome",
                                   "created_at", "negocio_id")} for t in docs]


@router.get("/orcamentos/buscar")
async def buscar_para_orcamento(q: str = Query(min_length=2, max_length=80), principal: Principal = Depends(require("tratamento:read"))):
    """Procura quem vai receber o orçamento: pacientes e leads ainda não cadastrados como paciente.
    Busca por nome, telefone ou CPF."""
    from lib.assinatura import so_digitos

    t = q.lower().strip()
    dig = so_digitos(q)
    saida = []
    async for p in db.pessoas.find({"papeis": {"$in": PAPEIS_ATENDIDOS}}):
        texto = " ".join(str(p.get(k) or "") for k in ("nome", "email")).lower()
        if t in texto or (dig and len(dig) >= 4 and (dig in (p.get("telefone_digitos") or "") or dig in (p.get("documento_digitos") or ""))):
            saida.append({"tipo": "paciente", "id": p["id"], "nome": p["nome"], "telefone": p.get("telefone"), "cpf": p.get("cpf_cnpj")})
        if len(saida) >= 8:
            break
    filtro_e = {"status": {"$in": ["novo", "em_contato"]}, "cliente_id": None}
    if not principal.is_admin:
        filtro_e["corretor_id"] = principal.pessoa_id or "__sem_vinculo__"
    async for e in db.entradas.find(filtro_e):
        tel = so_digitos(e.get("telefone"))
        if t in (e.get("nome") or "").lower() or (dig and len(dig) >= 4 and dig in tel):
            saida.append({"tipo": "lead", "id": e["id"], "nome": e["nome"], "telefone": e.get("telefone"), "cpf": None})
        if len(saida) >= 12:
            break
    return saida


class PacienteOrcamento(BaseModel):
    """Quem recebe o orçamento: um lead existente (vira paciente) ou alguém novo (vira paciente e lead)."""
    entrada_id: str | None = None
    nome: str | None = Field(default=None, max_length=200)
    telefone: str | None = Field(default=None, max_length=30)
    cpf_cnpj: str | None = Field(default=None, max_length=20)


@router.post("/orcamentos/paciente", status_code=201)
async def paciente_para_orcamento(input: PacienteOrcamento, principal: Principal = Depends(require("paciente:write"))):
    from lib.assinatura import so_digitos
    from models.crm import Entrada
    from models.pessoas import Pessoa, cpf_valido, formatar_documento

    doc = so_digitos(input.cpf_cnpj)
    if doc and not (len(doc) == 11 and cpf_valido(doc)):
        raise HTTPException(422, "CPF inválido")
    if doc:
        existente = await db.pessoas.find_one({"documento_digitos": doc})
        if existente:
            return {"paciente": _limpo(existente), "lead_criado": False, "ja_existia": True}
    entrada = None
    if input.entrada_id:
        entrada = await db.entradas.find_one({"id": input.entrada_id})
        if not entrada or (not principal.is_admin and entrada.get("corretor_id") not in (principal.pessoa_id, None)):
            raise HTTPException(404, "Lead não encontrado")
    nome = (input.nome or (entrada or {}).get("nome") or "").strip()
    if len(nome) < 2:
        raise HTTPException(422, "Informe o nome")
    telefone = (input.telefone or (entrada or {}).get("telefone") or "").strip() or None
    papel = "paciente" if principal.segmento in ("terapia", "odontologia") else "cliente"
    p = Pessoa(nome=nome, telefone=telefone, email=(entrada or {}).get("email"), cpf_cnpj=formatar_documento(doc) if doc else None,
               papeis=[papel]).model_dump()
    p.update(telefone_digitos=so_digitos(telefone) or None, documento_digitos=doc or None, criado_por_id=principal.usuario_id)
    await db.pessoas.insert_one(p)
    lead_criado = False
    if entrada:
        await db.entradas.update_one({"id": entrada["id"]}, {"$set": {"cliente_id": p["id"], "status": "em_contato",
                                                                      "primeiro_contato_em": entrada.get("primeiro_contato_em") or now_utc(), "updated_at": now_utc()}})
    else:
        # Não estava em lugar nenhum: entra em Leads para o comercial acompanhar.
        e = Entrada(nome=nome, telefone=telefone, origem="Orçamento", interesse="outro", cliente_id=p["id"],
                    corretor_id=principal.pessoa_id, status="em_contato", primeiro_contato_em=now_utc(),
                    mensagem="Cadastrado ao criar um orçamento").model_dump()
        e["atribuido_em"] = now_utc() if principal.pessoa_id else None
        await db.entradas.insert_one(e)
        lead_criado = True
    return {"paciente": _limpo(p), "lead_criado": lead_criado, "ja_existia": False}


@router.put("/{paciente_id}")
async def editar(paciente_id: str, input: PacienteIn, principal: Principal = Depends(require("paciente:write"))):
    from lib.assinatura import so_digitos
    from models.pessoas import cpf_valido, formatar_documento

    await _paciente(paciente_id)
    doc = so_digitos(input.cpf_cnpj)
    if doc and not (len(doc) == 11 and cpf_valido(doc)):
        raise HTTPException(422, "CPF inválido")
    if doc and await db.pessoas.find_one({"documento_digitos": doc, "id": {"$ne": paciente_id}}, {"id": 1}):
        raise HTTPException(409, "Já existe um cadastro com este CPF")
    dados = {**input.model_dump(), "cpf_cnpj": formatar_documento(doc) if doc else None, "telefone_digitos": so_digitos(input.telefone) or None,
             "documento_digitos": doc or None, "updated_at": now_utc()}
    await db.pessoas.update_one({"id": paciente_id}, {"$set": dados})
    return _limpo(await db.pessoas.find_one({"id": paciente_id}))


@router.get("/{paciente_id}")
async def ficha(paciente_id: str, principal: Principal = Depends(require("paciente:read"))):
    p = await _paciente(paciente_id)
    ag = await db.agendamentos.find({"cliente_id": paciente_id}).to_list(500)
    ag.sort(key=lambda a: (a["data"], a["inicio"]), reverse=True)
    trat = await db.planos_tratamento.find({"paciente_id": paciente_id}).to_list(100)
    trat.sort(key=lambda t: t.get("created_at") or now_utc(), reverse=True)
    from lib.segmentos import COM_PRONTUARIO

    pode = await _atende(principal, paciente_id)
    # Em clínicas, anamnese, alertas, odontograma e planos de tratamento são dado de saúde: só quem atende.
    clinico_liberado = pode or principal.segmento not in COM_PRONTUARIO
    ficha_doc = (await db.fichas.find_one({"paciente_id": paciente_id}) or {}) if clinico_liberado else {}
    if not clinico_liberado:
        trat = []
    financeiro = None
    if principal.is_admin:
        tx = await db.transacoes.find({"pessoa_id": paciente_id, "tipo": "receber", "status": {"$ne": "cancelado"}}).to_list(1000)
        financeiro = {"pago": round(sum(t["valor"] for t in tx if t["status"] == "pago"), 2),
                      "a_receber": round(sum(t["valor"] for t in tx if t["status"] == "pendente"), 2),
                      "parcelas": [{k: t.get(k) for k in ("id", "descricao", "valor", "vencimento", "pagamento", "status")} for t in sorted(tx, key=lambda x: x["vencimento"])]}
    hoje = agora_local().date().isoformat()
    concluidos = [a for a in ag if a["status"] == "concluido"]
    return {
        "paciente": _limpo(p),
        "anamnese": ficha_doc.get("anamnese") or {},
        "alertas": ficha_doc.get("alertas") or [],
        "odontograma": ficha_doc.get("odontograma") or {},
        "agendamentos": [{k: a.get(k) for k in ("id", "data", "inicio", "fim", "status", "profissional_nome", "servicos", "valor", "valor_cobrado")} for a in ag[:100]],
        "proximo": next((a for a in sorted(ag, key=lambda a: (a["data"], a["inicio"])) if a["data"] >= hoje and a["status"] in ("agendado", "confirmado")), None),
        "tratamentos": [_limpo(t) for t in trat],
        "resumo": {"atendimentos": len(concluidos), "faltas": sum(1 for a in ag if a["status"] == "faltou"),
                   "gasto_total": round(sum(float(a.get("valor_cobrado") or 0) for a in concluidos), 2),
                   "primeiro": concluidos[-1]["data"] if concluidos else None, "ultimo": concluidos[0]["data"] if concluidos else None},
        "financeiro": financeiro,
        "pode_prontuario": pode,
        "dados_clinicos": clinico_liberado,
    }


class AnamneseIn(BaseModel):
    respostas: dict[str, str | bool | None] = Field(default_factory=dict)
    alertas: List[str] = Field(default_factory=list, max_length=20)  # alergias e condições que aparecem em destaque


@router.put("/{paciente_id}/anamnese")
async def salvar_anamnese(paciente_id: str, input: AnamneseIn, principal: Principal = Depends(require("prontuario:write"))):
    await _paciente(paciente_id)
    if not await _atende(principal, paciente_id):
        raise HTTPException(403, "Só o profissional que atende este paciente ou o gestor altera a anamnese")
    respostas = {k[:60]: (v[:2000] if isinstance(v, str) else v) for k, v in list(input.respostas.items())[:80]}
    await db.fichas.update_one({"paciente_id": paciente_id}, {"$set": {
        "paciente_id": paciente_id, "anamnese": respostas, "alertas": [a[:80] for a in input.alertas],
        "anamnese_em": now_utc(), "anamnese_por": principal.nome}}, upsert=True)
    return {"ok": True}


# ------------------------------------------------------------------ prontuário


class EvolucaoIn(BaseModel):
    texto: str = Field(min_length=2, max_length=20_000)
    tipo: Literal["evolucao", "avaliacao", "anotacao", "plano_terapeutico"] = "evolucao"
    agendamento_id: str | None = None
    data: str | None = None


@router.get("/{paciente_id}/prontuario")
async def prontuario(paciente_id: str, principal: Principal = Depends(require("prontuario:read"))):
    await _paciente(paciente_id)
    if not await _atende(principal, paciente_id):
        raise HTTPException(403, "Prontuário restrito ao profissional que atende o paciente e ao gestor")
    await db.prontuario_acessos.insert_one({"id": new_id(), "paciente_id": paciente_id, "usuario_id": principal.usuario_id,
                                            "usuario_nome": principal.nome, "em": now_utc()})
    docs = await db.prontuario.find({"paciente_id": paciente_id}).to_list(2000)
    docs.sort(key=lambda d: (d.get("data") or "", utc_aware(d["created_at"])), reverse=True)
    agora = datetime.now(timezone.utc)
    return [{**_limpo(d), "pode_editar": d["autor_id"] == principal.usuario_id and agora - utc_aware(d["created_at"]) < timedelta(hours=24)}
            for d in docs]


@router.post("/{paciente_id}/prontuario", status_code=201)
async def nova_evolucao(paciente_id: str, input: EvolucaoIn, principal: Principal = Depends(require("prontuario:write"))):
    await _paciente(paciente_id)
    if not await _atende(principal, paciente_id):
        raise HTTPException(403, "Só o profissional que atende este paciente ou o gestor escreve no prontuário")
    d = {"id": new_id(), "paciente_id": paciente_id, "tipo": input.tipo, "texto": input.texto.strip(), "agendamento_id": input.agendamento_id,
         "data": input.data or agora_local().date().isoformat(), "autor_id": principal.usuario_id, "autor_nome": principal.nome,
         "adendos": [], "created_at": now_utc()}
    await db.prontuario.insert_one(d)
    return _limpo(d)


class AdendoIn(BaseModel):
    texto: str = Field(min_length=2, max_length=10_000)


@router.put("/{paciente_id}/prontuario/{evolucao_id}")
async def corrigir_evolucao(paciente_id: str, evolucao_id: str, input: AdendoIn, principal: Principal = Depends(require("prontuario:write"))):
    d = await db.prontuario.find_one({"id": evolucao_id, "paciente_id": paciente_id})
    if not d:
        raise HTTPException(404, "Registro não encontrado")
    if d["autor_id"] != principal.usuario_id:
        raise HTTPException(403, "Só quem escreveu pode corrigir. Use um adendo.")
    if datetime.now(timezone.utc) - utc_aware(d["created_at"]) >= timedelta(hours=24):
        raise HTTPException(409, "Passaram 24 horas: o registro não muda mais. Use um adendo.")
    await db.prontuario.update_one({"id": evolucao_id}, {"$set": {"texto": input.texto.strip(), "editado_em": now_utc()},
                                                         "$push": {"versoes": {"texto": d["texto"], "em": now_utc()}}})
    return {"ok": True}


@router.post("/{paciente_id}/prontuario/{evolucao_id}/adendo", status_code=201)
async def adendo(paciente_id: str, evolucao_id: str, input: AdendoIn, principal: Principal = Depends(require("prontuario:write"))):
    if not await _atende(principal, paciente_id):
        raise HTTPException(403, "Prontuário restrito")
    d = await db.prontuario.find_one({"id": evolucao_id, "paciente_id": paciente_id})
    if not d:
        raise HTTPException(404, "Registro não encontrado")
    item = {"texto": input.texto.strip(), "autor_nome": principal.nome, "em": now_utc()}
    await db.prontuario.update_one({"id": evolucao_id}, {"$push": {"adendos": item}})
    return item


# ------------------------------------------------------------------ odontograma


ESTADOS_DENTE = {"higido", "carie", "restaurado", "ausente", "implante", "canal", "coroa", "extracao", "fratura", "selante", "protese"}
DENTES = {f"{q}{n}" for q in (1, 2, 3, 4) for n in range(1, 9)} | {f"{q}{n}" for q in (5, 6, 7, 8) for n in range(1, 6)}
FACES = {"V", "L", "M", "D", "O"}


class DenteIn(BaseModel):
    estado: str = "higido"
    faces: dict[str, str] = Field(default_factory=dict)
    nota: str | None = Field(default=None, max_length=300)


@router.put("/{paciente_id}/odontograma/{dente}")
async def salvar_dente(paciente_id: str, dente: str, input: DenteIn, principal: Principal = Depends(require("tratamento:write"))):
    await _exigir_atende(principal, paciente_id)
    await _paciente(paciente_id)
    if dente not in DENTES:
        raise HTTPException(422, "Dente inválido (numeração FDI)")
    if input.estado not in ESTADOS_DENTE or any(f not in FACES or e not in ESTADOS_DENTE for f, e in input.faces.items()):
        raise HTTPException(422, "Situação do dente inválida")
    await db.fichas.update_one({"paciente_id": paciente_id}, {"$set": {
        "paciente_id": paciente_id, f"odontograma.{dente}": {**input.model_dump(), "em": now_utc().isoformat(), "por": principal.nome}}}, upsert=True)
    return {"ok": True}


# ------------------------------------------------------------------ planos de tratamento (orçamentos)


class ItemTratamento(BaseModel):
    id: str | None = None
    servico_id: str | None = None
    descricao: str = Field(min_length=2, max_length=160)
    dente: str | None = None  # odontologia (FDI)
    faces: List[str] = Field(default_factory=list)
    regiao: str | None = Field(default=None, max_length=60)  # estética: região do rosto
    ponto: List[float] | None = None  # estética: coordenada no rosto 3D (x, y, z)
    quantidade: float = Field(default=1, gt=0, le=10_000)  # unidades de toxina, ml de preenchedor, sessões
    unidade: str = Field(default="un", max_length=10)
    valor_unitario: float = Field(ge=0, le=10_000_000)
    status: Literal["planejado", "realizado"] = "planejado"


class TratamentoIn(BaseModel):
    tipo: Literal["odonto", "facial", "geral"] = "geral"
    titulo: str = Field(min_length=2, max_length=120)
    itens: List[ItemTratamento] = Field(min_length=1, max_length=200)
    desconto: float = Field(default=0, ge=0, le=10_000_000)
    parcelas: int = Field(default=1, ge=1, le=36)
    primeira_parcela: str | None = None
    observacoes: str | None = Field(default=None, max_length=2000)
    validade_dias: int = Field(default=15, ge=1, le=180)


def _totais(itens: list[dict], desconto: float) -> tuple[float, float]:
    bruto = round(sum(i["quantidade"] * i["valor_unitario"] for i in itens), 2)
    return bruto, round(max(0.0, bruto - min(desconto, bruto)), 2)


def _validar_itens(tipo: str, itens: list[ItemTratamento]) -> list[dict]:
    saida = []
    for i in itens:
        if tipo == "odonto" and i.dente and i.dente not in DENTES:
            raise HTTPException(422, f"Dente {i.dente} inválido")
        if any(f not in FACES for f in i.faces):
            raise HTTPException(422, "Face do dente inválida")
        if i.ponto is not None and len(i.ponto) != 3:
            raise HTTPException(422, "Ponto do rosto inválido")
        d = i.model_dump()
        d["id"] = i.id or new_id()
        d["valor"] = round(i.quantidade * i.valor_unitario, 2)
        saida.append(d)
    return saida


@router.post("/{paciente_id}/tratamentos", status_code=201)
async def criar_tratamento(paciente_id: str, input: TratamentoIn, principal: Principal = Depends(require("tratamento:write"))):
    await _exigir_atende(principal, paciente_id)
    p = await _paciente(paciente_id)
    itens = _validar_itens(input.tipo, input.itens)
    bruto, total = _totais(itens, input.desconto)
    t = {"id": new_id(), "paciente_id": paciente_id, "paciente_nome": p["nome"], **input.model_dump(exclude={"itens"}), "itens": itens,
         "subtotal": bruto, "total": total, "status": "rascunho", "profissional_id": principal.usuario_id, "profissional_nome": principal.nome,
         "negocio_id": None, "created_at": now_utc(), "updated_at": now_utc()}
    await db.planos_tratamento.insert_one(t)
    return _limpo(t)


@router.put("/{paciente_id}/tratamentos/{tratamento_id}")
async def editar_tratamento(paciente_id: str, tratamento_id: str, input: TratamentoIn, principal: Principal = Depends(require("tratamento:write"))):
    await _exigir_atende(principal, paciente_id)
    t = await db.planos_tratamento.find_one({"id": tratamento_id, "paciente_id": paciente_id})
    if not t:
        raise HTTPException(404, "Plano de tratamento não encontrado")
    if t["status"] in ("aprovado", "concluido"):
        raise HTTPException(409, "Plano aprovado não muda de valor. Crie um novo plano para o complemento.")
    itens = _validar_itens(input.tipo, input.itens)
    bruto, total = _totais(itens, input.desconto)
    dados = {**input.model_dump(exclude={"itens"}), "itens": itens, "subtotal": bruto, "total": total, "updated_at": now_utc()}
    await db.planos_tratamento.update_one({"id": tratamento_id}, {"$set": dados})
    if t.get("negocio_id"):
        await db.leads.update_one({"id": t["negocio_id"]}, {"$set": {"valor_estimado": total, "updated_at": now_utc()}})
    return _limpo({**t, **dados})


async def _funil_orcamentos() -> tuple[dict, dict] | None:
    funil = await db.funis.find_one({"padrao": True}) or await db.funis.find_one({})
    if not funil or not funil.get("etapas"):
        return None
    etapas = funil["etapas"]
    return funil, (etapas[1] if len(etapas) > 1 else etapas[0])


class Acao(BaseModel):
    acao: Literal["apresentar", "aprovar", "recusar"]
    motivo: str | None = Field(default=None, max_length=200)
    forma_pagamento: str | None = Field(default=None, max_length=40)


@router.post("/{paciente_id}/tratamentos/{tratamento_id}/acao")
async def acao_tratamento(paciente_id: str, tratamento_id: str, input: Acao, principal: Principal = Depends(require("tratamento:write"))):
    await _exigir_atende(principal, paciente_id)
    t = await db.planos_tratamento.find_one({"id": tratamento_id, "paciente_id": paciente_id})
    if not t:
        raise HTTPException(404, "Plano de tratamento não encontrado")
    dados: dict = {"updated_at": now_utc()}
    if input.acao == "apresentar":
        if t["status"] not in ("rascunho", "apresentado"):
            raise HTTPException(409, "Este plano já foi decidido")
        dados.update(status="apresentado", apresentado_em=now_utc())
        if not t.get("negocio_id"):
            alvo = await _funil_orcamentos()
            if alvo:
                funil, etapa = alvo
                from lib.crm import estagio_legado

                prof = await db.usuarios.find_one({"id": t["profissional_id"]}, {"pessoa_id": 1}) or {}
                lead = {"id": new_id(), "nome": f"{t['titulo']} | {t['paciente_nome']}"[:200], "cliente_id": paciente_id, "imovel_id": None,
                        "corretor_id": prof.get("pessoa_id"), "origem": "Orçamento", "valor_estimado": t["total"], "observacoes": None,
                        "funil_id": funil["id"], "etapa_id": etapa["id"], "status": "aberto", "etapa_desde": now_utc(),
                        "etapas_alcancadas": [e["id"] for e in funil["etapas"][: funil["etapas"].index(etapa) + 1]],
                        "estagio": estagio_legado(funil, etapa["id"], "aberto"), "etiquetas": [], "motivo_perda": None,
                        "previsao_fechamento": None, "entrada_id": None, "created_at": now_utc(), "updated_at": now_utc(), "closed_at": None,
                        "tratamento_id": t["id"]}
                await db.leads.insert_one(lead)
                dados["negocio_id"] = lead["id"]
                # O lead da caixa de entrada desta pessoa vira o negócio do orçamento.
                await db.entradas.update_many({"cliente_id": paciente_id, "status": {"$in": ["novo", "em_contato"]}},
                                              {"$set": {"status": "convertido", "negocio_id": lead["id"], "updated_at": now_utc()}})
    elif input.acao == "aprovar":
        if t["status"] in ("aprovado", "concluido"):
            raise HTTPException(409, "Plano já aprovado")
        if t["status"] == "recusado":
            raise HTTPException(409, "Plano recusado. Crie um novo plano.")
        conta = await db.plano_contas.find_one({"codigo": "1.1.1"}) or await db.plano_contas.find_one({"tipo": "receita"})
        if not conta:
            raise HTTPException(409, "Cadastre uma conta de receita no plano de contas")
        primeira = t.get("primeira_parcela") or agora_local().date().isoformat()
        from datetime import date

        try:
            base = date.fromisoformat(str(primeira)[:10])
        except ValueError:
            raise HTTPException(422, "Data da primeira parcela inválida. Edite o plano e use o formato AAAA-MM-DD.")
        dados.update(status="aprovado", aprovado_em=now_utc(), aprovado_por=principal.nome)
        # Aprova primeiro, com condição no status: dois cliques ao mesmo tempo não geram parcelas em dobro.
        reservado = await db.planos_tratamento.update_one({"id": tratamento_id, "status": {"$in": ["rascunho", "apresentado"]}}, {"$set": dados})
        if reservado.modified_count != 1:
            raise HTTPException(409, "Plano já aprovado")
        try:
            valores = split_money(t["total"], int(t.get("parcelas") or 1)) if t["total"] > 0 else []
            for n, v in enumerate(valores):
                mes = base.month - 1 + n
                venc = base.replace(year=base.year + mes // 12, month=mes % 12 + 1, day=min(base.day, 28))
                await db.transacoes.insert_one({
                    "id": new_id(), "descricao": f"{t['titulo']} | {t['paciente_nome']} ({n + 1}/{len(valores)})"[:300], "tipo": "receber",
                    "valor": v, "plano_conta_id": conta["id"], "imovel_id": None, "pessoa_id": paciente_id, "corretor_id": None,
                    "evento_id": None, "contrato_id": None, "tratamento_id": t["id"], "vencimento": venc.isoformat(), "pagamento": None,
                    "status": "pendente", "forma_pagamento": input.forma_pagamento, "vencido": False, "cancelado_em": None, "created_at": now_utc()})
        except Exception:
            await db.transacoes.delete_many({"tratamento_id": t["id"]})
            await db.planos_tratamento.update_one({"id": tratamento_id}, {"$set": {"status": t["status"], "aprovado_em": None, "aprovado_por": None}})
            raise
        if t.get("negocio_id"):
            await db.leads.update_one({"id": t["negocio_id"]}, {"$set": {"status": "ganho", "estagio": "ganho", "closed_at": now_utc(), "updated_at": now_utc()}})
        return _limpo({**t, **dados})
    else:
        if t["status"] in ("aprovado", "concluido"):
            raise HTTPException(409, "Plano já aprovado. Cancele as parcelas no Financeiro se o paciente desistiu.")
        dados.update(status="recusado", motivo_recusa=input.motivo)
        r = await db.planos_tratamento.update_one({"id": tratamento_id, "status": {"$in": ["rascunho", "apresentado", "recusado"]}}, {"$set": dados})
        if r.modified_count != 1:
            raise HTTPException(409, "Plano já aprovado. Cancele as parcelas no Financeiro se o paciente desistiu.")
        if t.get("negocio_id"):
            await db.leads.update_one({"id": t["negocio_id"]}, {"$set": {"status": "perdido", "estagio": "perdido", "motivo_perda": input.motivo or "Sem motivo",
                                                                         "closed_at": now_utc(), "updated_at": now_utc()}})
    if input.acao == "apresentar":
        await db.planos_tratamento.update_one({"id": tratamento_id, "status": {"$in": ["rascunho", "apresentado"]}}, {"$set": dados})
    return _limpo({**t, **dados})


@router.post("/{paciente_id}/tratamentos/{tratamento_id}/itens/{item_id}/realizar")
async def realizar_item(paciente_id: str, tratamento_id: str, item_id: str, principal: Principal = Depends(require("tratamento:write"))):
    await _exigir_atende(principal, paciente_id)
    t = await db.planos_tratamento.find_one({"id": tratamento_id, "paciente_id": paciente_id})
    if not t:
        raise HTTPException(404, "Plano de tratamento não encontrado")
    if t["status"] not in ("aprovado",):
        raise HTTPException(409, "Aprove o plano antes de registrar procedimentos realizados")
    itens = t["itens"]
    alvo = next((i for i in itens if i["id"] == item_id), None)
    if not alvo:
        raise HTTPException(404, "Item não encontrado")
    alvo.update(status="realizado", realizado_em=agora_local().date().isoformat(), realizado_por=principal.nome)
    concluido = all(i["status"] == "realizado" for i in itens)
    dados = {"itens": itens, "updated_at": now_utc(), **({"status": "concluido", "concluido_em": now_utc()} if concluido else {})}
    await db.planos_tratamento.update_one({"id": tratamento_id}, {"$set": dados})
    if t.get("tipo") == "odonto" and alvo.get("dente"):
        mapa = {"restaura": "restaurado", "canal": "canal", "extra": "ausente", "implante": "implante", "coroa": "coroa", "selante": "selante", "protese": "protese"}
        estado = next((v for k, v in mapa.items() if k in alvo["descricao"].lower()), None)
        if estado:
            await db.fichas.update_one({"paciente_id": paciente_id}, {"$set": {"paciente_id": paciente_id, f"odontograma.{alvo['dente']}": {
                "estado": estado, "faces": {f: estado for f in alvo.get("faces") or []}, "nota": alvo["descricao"], "em": now_utc().isoformat(), "por": principal.nome}}}, upsert=True)
    return _limpo({**t, **dados})


@router.delete("/{paciente_id}/tratamentos/{tratamento_id}", status_code=204)
async def excluir_tratamento(paciente_id: str, tratamento_id: str, principal: Principal = Depends(require("tratamento:write"))):
    await _exigir_atende(principal, paciente_id)
    t = await db.planos_tratamento.find_one({"id": tratamento_id, "paciente_id": paciente_id})
    if not t:
        raise HTTPException(404, "Plano de tratamento não encontrado")
    if t["status"] in ("aprovado", "concluido"):
        raise HTTPException(409, "Plano aprovado não pode ser excluído")
    if t.get("negocio_id"):
        await db.leads.delete_one({"id": t["negocio_id"], "status": "aberto"})
    await db.planos_tratamento.delete_one({"id": tratamento_id})
    return Response(status_code=204)
