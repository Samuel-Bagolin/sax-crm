"""Documentos da clínica: PDF do orçamento, PDF do prontuário, receituário/atestado/declaração e arquivos do prontuário.

Prontuário, documentos clínicos e arquivos são dado de saúde: mesma regra do prontuário (`_acessa_saude` em
routers/pacientes.py: quem atende o paciente e o gestor; suporte nunca) e toda exportação ou abertura fica em
`prontuario_acessos`.
- `documentos_clinicos`: receituário, atestado, declaração de comparecimento, encaminhamento ou livre. O texto não muda
  depois de emitido (reimprime igual); para corrigir, emita outro.
- `prontuario_arquivos`: exames, laudos e fotos (PDF ou imagem até 3 MB; o Vercel recebe até ~4,5 MB por requisição).
"""

from __future__ import annotations

import base64
import binascii
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from lib import pdf_clinica
from lib.agenda_online import agora_local
from lib.auth import Principal, require
from lib.db import controle, db, empresa_atual_db
from models.common import new_id, now_utc
from routers.pacientes import SUPORTE_SEM_PRONTUARIO, _acessa_saude, _paciente

router = APIRouter(prefix="/pacientes", tags=["pacientes"])

LIMITE_ARQUIVO = 3 * 1024 * 1024
MIME_OK = re.compile(r"^(application/pdf|image/(png|jpeg|webp))$")
TITULOS = {"receituario": "Receituário", "atestado": "Atestado", "declaracao": "Declaração de comparecimento",
           "encaminhamento": "Encaminhamento", "livre": "Documento"}
TIPOS_PRONT = {"evolucao": "Evolução", "avaliacao": "Avaliação", "anotacao": "Anotação", "plano_terapeutico": "Plano terapêutico"}


async def _empresa() -> dict:
    cfg = await db.configuracoes.find_one({"id": "singleton"}, {"nome_software": 1, "cor_primaria": 1, "logo_base64": 1, "telefone": 1}) or {}
    emp = await controle.empresas.find_one({"db_name": empresa_atual_db()}, {"nome": 1}) if empresa_atual_db() else None
    return {"nome": cfg.get("nome_software") or (emp or {}).get("nome") or "Clínica", "cor": cfg.get("cor_primaria") or "#4a03a2",
            "logo": cfg.get("logo_base64"), "contato": cfg.get("telefone")}


async def _exigir_saude(principal: Principal, pid: str) -> dict:
    p = await _paciente(pid)
    if not await _acessa_saude(principal, pid):
        raise HTTPException(403, SUPORTE_SEM_PRONTUARIO if principal.suporte else "Restrito ao profissional que atende o paciente e ao gestor")
    return p


async def _registrar(pid: str, principal: Principal, acao: str) -> None:
    await db.prontuario_acessos.insert_one({"id": new_id(), "paciente_id": pid, "usuario_id": principal.usuario_id, "usuario_nome": principal.nome,
                                            "em": now_utc(), "acao": acao})


def _pdf(conteudo: bytes, nome: str) -> Response:
    return Response(content=conteudo, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{nome}"'})


async def _profissional(usuario_id: str | None) -> dict:
    u = await db.usuarios.find_one({"id": usuario_id}, {"nome": 1, "registro": 1, "especialidade": 1, "creci": 1}) if usuario_id else None
    return {"nome": (u or {}).get("nome"), "registro": (u or {}).get("registro") or (u or {}).get("creci"), "cargo": (u or {}).get("especialidade")}


# ------------------------------------------------------------------ orçamento


@router.get("/{pid}/tratamentos/{tid}/pdf")
async def orcamento_pdf(pid: str, tid: str, principal: Principal = Depends(require("paciente:read"))):
    from lib.segmentos import COM_PRONTUARIO

    p = await _paciente(pid)
    if principal.segmento in COM_PRONTUARIO and not await _acessa_saude(principal, pid):
        raise HTTPException(403, "Plano de tratamento restrito a quem atende o paciente e ao gestor")
    t = await db.planos_tratamento.find_one({"id": tid, "paciente_id": pid})
    if not t:
        raise HTTPException(404, "Orçamento não encontrado")
    conteudo = pdf_clinica.orcamento(empresa=await _empresa(), paciente=p, t=t, profissional=await _profissional(t.get("profissional_id")),
                                     odonto=t.get("tipo") == "odonto")
    return _pdf(conteudo, f"orcamento-{tid[:8]}.pdf")


# ------------------------------------------------------------------ prontuário


@router.get("/{pid}/prontuario/pdf")
async def prontuario_pdf(pid: str, inicio: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"), fim: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
                         principal: Principal = Depends(require("prontuario:read"))):
    p = await _exigir_saude(principal, pid)
    await _registrar(pid, principal, "pdf_prontuario")
    regs = [r for r in await db.prontuario.find({"paciente_id": pid}).to_list(3000) if (not inicio or (r.get("data") or "") >= inicio) and (not fim or (r.get("data") or "") <= fim)]
    regs.sort(key=lambda r: (r.get("data") or "", r.get("created_at") or now_utc()))
    ficha = await db.fichas.find_one({"paciente_id": pid}) or {}
    blocos: list = [("par", [("Paciente", p.get("nome")), ("Nascimento", (p.get("data_nascimento") or "")[8:10] + "/" + (p.get("data_nascimento") or "")[5:7] + "/" + (p.get("data_nascimento") or "")[:4] if p.get("data_nascimento") else None),
                             ("CPF", p.get("cpf_cnpj")), ("Telefone", p.get("telefone"))])]
    anam = {k: v for k, v in (ficha.get("anamnese") or {}).items() if v not in (None, "", False)}
    if anam:
        blocos.append(("h2", "Anamnese"))
        blocos.append(("texto", "\n".join(f"{k.replace('_', ' ').capitalize()}: {'Sim' if v is True else v}" for k, v in anam.items())))
    if ficha.get("alertas"):
        blocos += [("h2", "Alertas"), ("texto", ", ".join(map(str, ficha["alertas"])))]
    blocos.append(("h2", f"Registros ({len(regs)})"))
    if not regs:
        blocos.append(("texto", "Nenhum registro no período."))
    for r in regs:
        data = r.get("data") or ""
        cab = f"{data[8:10]}/{data[5:7]}/{data[:4]} · {TIPOS_PRONT.get(r.get('tipo'), 'Registro')} · {r.get('autor_nome') or ''}"
        if r.get("agendamento_id") and r.get("no_prazo") is False:
            cab += " · registrado fora do prazo de 24 h"
        blocos += [("peq", cab), ("texto", r.get("texto") or "")]
        for a in r.get("adendos") or []:
            em = a.get("em")
            blocos.append(("peq", f"Adendo de {a.get('autor_nome') or ''} em {em.strftime('%d/%m/%Y %H:%M') if hasattr(em, 'strftime') else ''}: {a.get('texto') or ''}"))
        blocos.append(("espaco", 2))
    periodo = f" de {inicio[8:]}/{inicio[5:7]}/{inicio[:4]}" if inicio else ""
    periodo += f" até {fim[8:]}/{fim[5:7]}/{fim[:4]}" if fim else ""
    conteudo = pdf_clinica.montar(empresa=(e := await _empresa())["nome"], titulo="Prontuário", cor_primaria=e["cor"], logo_base64=e["logo"], contato=e["contato"],
                                  subtitulo=f"{p.get('nome')}{periodo} · emitido por {principal.nome}",
                                  blocos=blocos, assinatura=None,
                                  rodape="Documento confidencial com dados de saúde (LGPD). Uso restrito ao paciente e aos profissionais que o atendem.")
    return _pdf(conteudo, f"prontuario-{pid[:8]}.pdf")


# ------------------------------------------------------------------ receituário, atestado e declarações


class DocumentoIn(BaseModel):
    tipo: Literal["receituario", "atestado", "declaracao", "encaminhamento", "livre"]
    titulo: str | None = Field(default=None, max_length=80)
    texto: str = Field(min_length=5, max_length=8000)
    data: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    cidade: str | None = Field(default=None, max_length=80)


def _saida_doc(d: dict) -> dict:
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in d.items() if k != "_id"}


@router.get("/{pid}/documentos-clinicos")
async def documentos(pid: str, principal: Principal = Depends(require("prontuario:read"))):
    await _exigir_saude(principal, pid)
    docs = await db.documentos_clinicos.find({"paciente_id": pid}).sort("created_at", -1).to_list(500)
    return [_saida_doc(d) for d in docs]


@router.post("/{pid}/documentos-clinicos", status_code=201)
async def emitir(pid: str, input: DocumentoIn, principal: Principal = Depends(require("prontuario:write"))):
    p = await _exigir_saude(principal, pid)
    did = new_id()
    prof = await _profissional(principal.usuario_id)
    d = {"_id": did, "id": did, "paciente_id": pid, "paciente_nome": p.get("nome"), "tipo": input.tipo,
         "titulo": (input.titulo or TITULOS[input.tipo]).strip(), "texto": input.texto.strip(), "data": input.data or agora_local().date().isoformat(),
         "cidade": (input.cidade or "").strip() or None, "autor_id": principal.usuario_id, "autor_nome": principal.nome,
         "autor_registro": prof.get("registro"), "autor_cargo": prof.get("cargo"), "created_at": now_utc()}
    await db.documentos_clinicos.insert_one(d)
    return _saida_doc(d)


@router.get("/{pid}/documentos-clinicos/{did}/pdf")
async def documento_pdf(pid: str, did: str, principal: Principal = Depends(require("prontuario:read"))):
    p = await _exigir_saude(principal, pid)
    d = await db.documentos_clinicos.find_one({"id": did, "paciente_id": pid})
    if not d:
        raise HTTPException(404, "Documento não encontrado")
    await _registrar(pid, principal, f"pdf_{d['tipo']}")
    e = await _empresa()
    data = d["data"]
    meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
    local_data = f"{d['cidade'] + ', ' if d.get('cidade') else ''}{int(data[8:10])} de {meses[int(data[5:7]) - 1]} de {data[:4]}."
    blocos: list = [("par", [("Paciente", p.get("nome")), ("CPF", p.get("cpf_cnpj"))]), ("espaco", 4)]
    blocos.append(("grande", d["texto"]))
    conteudo = pdf_clinica.montar(empresa=e["nome"], titulo=d["titulo"], cor_primaria=e["cor"], logo_base64=e["logo"], contato=e["contato"],
                                  subtitulo=f"Emitido em {data[8:10]}/{data[5:7]}/{data[:4]}", blocos=blocos,
                                  assinatura={"nome": d.get("autor_nome"), "cargo": d.get("autor_cargo"), "registro": d.get("autor_registro"),
                                              "local_data": local_data})
    return _pdf(conteudo, f"{d['tipo']}-{did[:8]}.pdf")


# ------------------------------------------------------------------ arquivos do prontuário


class ArquivoIn(BaseModel):
    nome: str = Field(min_length=1, max_length=160)
    mime: str = Field(min_length=3, max_length=80)
    base64: str = Field(min_length=8, max_length=4_300_000)
    descricao: str | None = Field(default=None, max_length=300)


@router.get("/{pid}/arquivos")
async def arquivos(pid: str, principal: Principal = Depends(require("prontuario:read"))):
    await _exigir_saude(principal, pid)
    docs = await db.prontuario_arquivos.find({"paciente_id": pid}, {"conteudo": 0}).sort("created_at", -1).to_list(500)
    return [_saida_doc({k: v for k, v in d.items() if k != "conteudo"}) for d in docs]


@router.post("/{pid}/arquivos", status_code=201)
async def anexar(pid: str, input: ArquivoIn, principal: Principal = Depends(require("prontuario:write"))):
    await _exigir_saude(principal, pid)
    if not MIME_OK.match(input.mime):
        raise HTTPException(422, "Envie PDF ou imagem (PNG, JPG ou WEBP)")
    try:
        bruto = base64.b64decode(input.base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "Arquivo inválido")
    if len(bruto) > LIMITE_ARQUIVO:
        raise HTTPException(413, "Arquivo maior que 3 MB. Reduza ou divida o arquivo.")
    assinaturas = {"application/pdf": b"%PDF", "image/png": b"\x89PNG", "image/jpeg": b"\xff\xd8"}
    if input.mime in assinaturas and not bruto.startswith(assinaturas[input.mime]):
        raise HTTPException(422, "O conteúdo não confere com o tipo do arquivo")
    aid = new_id()
    nome = re.sub(r"[^\w.\- ]", "_", input.nome)[:160]
    d = {"_id": aid, "id": aid, "paciente_id": pid, "nome": nome, "mime": input.mime, "tamanho": len(bruto), "descricao": input.descricao,
         "conteudo": input.base64, "autor_id": principal.usuario_id, "autor_nome": principal.nome, "created_at": now_utc()}
    await db.prontuario_arquivos.insert_one(d)
    return _saida_doc({k: v for k, v in d.items() if k != "conteudo"})


@router.get("/{pid}/arquivos/{aid}")
async def abrir_arquivo(pid: str, aid: str, principal: Principal = Depends(require("prontuario:read"))):
    await _exigir_saude(principal, pid)
    d = await db.prontuario_arquivos.find_one({"id": aid, "paciente_id": pid})
    if not d:
        raise HTTPException(404, "Arquivo não encontrado")
    await _registrar(pid, principal, "arquivo")
    return Response(content=base64.b64decode(d["conteudo"]), media_type=d["mime"],
                    headers={"Content-Disposition": f'inline; filename="{d["nome"]}"', "Cache-Control": "private, no-store"})


@router.delete("/{pid}/arquivos/{aid}", status_code=204)
async def remover_arquivo(pid: str, aid: str, principal: Principal = Depends(require("prontuario:write"))):
    await _exigir_saude(principal, pid)
    d = await db.prontuario_arquivos.find_one({"id": aid, "paciente_id": pid}, {"autor_id": 1})
    if not d:
        raise HTTPException(404, "Arquivo não encontrado")
    if not principal.is_admin and d.get("autor_id") != principal.usuario_id:
        raise HTTPException(403, "Só quem anexou ou o gestor remove")
    await db.prontuario_arquivos.delete_one({"id": aid})
