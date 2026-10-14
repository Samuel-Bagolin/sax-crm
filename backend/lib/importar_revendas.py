"""Importa o "CRM Revendas & Eventos" (planilha Google do Apps Script) para uma empresa do SAX.

Lê o .xlsx baixado do Google Planilhas (ou o texto exportado com "## Sheet name:") e traz:
- LOJAS -> Unidades ("Curitiba - Batel"), USUARIOS -> Equipe com acesso por e-mail;
- FUNIS -> funis com as mesmas etapas; LEADS REVENDA/EVENTOS -> Leads e clientes;
- NEGOCIOS -> Negócios na etapa, com responsável, loja, supervisão e temperatura como etiquetas;
- ATIVIDADES -> Agenda; HISTORICO -> histórico do negócio.

Senhas NÃO são importadas (nem o hash da planilha): cada pessoa recebe um link de ativação e cria a sua.
Cada registro guarda o ID da planilha (`planilha_id`); importar de novo só traz o que ainda não veio.
"""

from __future__ import annotations

import csv
import io
import json
import re
import secrets
import unicodedata
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from lib.db import client, controle
from models.common import new_id, now_utc

FUSO = ZoneInfo("America/Sao_Paulo")
PRACAS = {"CURITIBA": "Curitiba", "SAO PAULO": "São Paulo", "BRASILIA": "Brasília"}
PERFIS = {  # perfil da planilha -> (papel no SAX, cargo)
    "diretoria": ("admin", "Diretoria"),
    "gerente_op": ("admin", "Gerente de Operações"),
    "gerente_exp": ("admin", "Gerente de Expansão"),
    "supervisor": ("corretor", "Supervisor de Lojas"),
    "lider": ("corretor", "Líder de Loja"),
}
TIPOS_ATIVIDADE = {"contato": "ligacao", "ligacao": "ligacao", "whatsapp": "whatsapp", "e-mail": "email", "email": "email",
                   "reuniao com proprietario": "reuniao", "reuniao": "reuniao", "degustacao": "reuniao", "visita": "visita"}
FEITAS = {"sucesso", "concluida", "concluído", "concluido", "feito", "feita", "realizada", "ok"}


class ErroPlanilha(Exception):
    pass


def _sem_acento(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t or "") if unicodedata.category(c) != "Mn").upper().strip()


def _praca(p: str | None) -> str | None:
    return PRACAS.get(_sem_acento(p or ""))


def _txt(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%d/%m/%Y %H:%M:%S")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def ler(conteudo: bytes) -> dict[str, list[list[str]]]:
    """Abas -> linhas (texto). Aceita .xlsx e o texto exportado com "## Sheet name:"."""
    if conteudo[:2] == b"PK":
        from openpyxl import load_workbook

        try:
            wb = load_workbook(io.BytesIO(conteudo), read_only=True, data_only=True)
        except Exception:
            raise ErroPlanilha("Não consegui abrir o arquivo. Baixe a planilha em Arquivo > Fazer download > Microsoft Excel (.xlsx).")
        abas = {ws.title.strip().upper(): [[_txt(c) for c in linha] for linha in ws.iter_rows(values_only=True)] for ws in wb.worksheets}
        wb.close()
        return abas
    try:
        texto = conteudo.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ErroPlanilha("Formato não reconhecido. Envie o .xlsx baixado do Google Planilhas.")
    if "## Sheet name:" not in texto:
        raise ErroPlanilha("Formato não reconhecido. Envie o .xlsx baixado do Google Planilhas.")
    abas: dict[str, list[list[str]]] = {}
    partes = re.split(r"^## Sheet name: *(.+)$", texto, flags=re.M)
    for i in range(1, len(partes), 2):
        abas[partes[i].strip().upper()] = [[c.strip() for c in linha] for linha in csv.reader(io.StringIO(partes[i + 1].strip("\n")))]
    return abas


def _tabela(abas: dict, nome: str) -> list[dict]:
    linhas = [l for l in abas.get(nome, []) if any(c for c in l)]
    if not linhas:
        return []
    cab = [c.strip() for c in linhas[0]]
    saida = []
    for l in linhas[1:]:
        d = {cab[i]: (l[i] if i < len(l) else "") for i in range(len(cab)) if cab[i]}
        d["_extra"] = [c for i, c in enumerate(l) if c and (i >= len(cab) or not cab[i])]
        saida.append(d)
    return saida


def _data(v: str | None) -> datetime | None:
    v = (v or "").strip()
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=FUSO).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def _dia(v: str | None) -> str | None:
    d = _data(v)
    return d.astimezone(FUSO).date().isoformat() if d else None


def _digitos(v: str | None) -> str:
    return "".join(c for c in (v or "") if c.isdigit())


def _valor(v: str | None) -> float | None:
    t = (v or "").replace("R$", "").strip()
    if not t:
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        n = float(t)
    except ValueError:
        return None
    return n if n > 0 else None


def _loja_curta(nome: str) -> str:
    return re.sub(r"^O Pudim Perfeito\s*-\s*", "", nome or "", flags=re.I).strip() or nome


async def importar(empresa: dict, conteudo: bytes, *, simular: bool, por: str) -> dict:
    abas = ler(conteudo)
    if not any(k in abas for k in ("NEGOCIOS", "LEADS REVENDA", "USUARIOS")):
        raise ErroPlanilha("Esta planilha não tem as abas do CRM Revendas (USUARIOS, LEADS REVENDA, NEGOCIOS).")
    banco = client[empresa["db_name"]]
    agora = now_utc()
    cont = {k: 0 for k in ("lojas", "usuarios", "clientes", "leads", "negocios", "atividades", "historico", "ja_importados")}
    avisos: list[str] = []
    acessos: list[dict] = []

    async def ja(colecao: str, pid: str) -> dict | None:
        return await banco[colecao].find_one({"planilha_id": pid}) if pid else None

    # ------------------------------------------------------------ lojas
    lojas: dict[str, str] = {}
    linhas_lojas = _tabela(abas, "LOJAS")
    existentes = await banco.unidades.find({}).to_list(500)
    por_nome = {u.get("nome"): u for u in existentes}
    cfg = await banco.configuracoes.find_one({"id": "singleton"}) or {}
    so_a_padrao = len(existentes) == 1 and existentes[0].get("nome") == cfg.get("nome_software")
    for i, l in enumerate(linhas_lojas):
        original = l.get("Loja") or ""
        if not original:
            continue
        cidade = _praca(l.get("Praça"))
        nome = f"{cidade} - {_loja_curta(original)}" if cidade else _loja_curta(original)
        u = por_nome.get(nome) or await ja("unidades", original)
        if u:
            lojas[original] = u["id"]
            continue
        uid = new_id()
        lojas[original] = uid
        cont["lojas"] += 1
        if not simular:
            await banco.unidades.insert_one({"id": uid, "nome": nome, "principal": False, "ativa": True, "endereco": None, "cidade": cidade,
                                             "telefone": None, "whatsapp": None, "planilha_id": original, "created_at": agora})
    if so_a_padrao and cont["lojas"] and not simular:
        # a unidade automática da empresa sai; a primeira loja vira a principal
        await banco.unidades.delete_one({"id": existentes[0]["id"]})
        await banco.unidades.update_one({"id": lojas[linhas_lojas[0]["Loja"]]}, {"$set": {"principal": True}})

    # ------------------------------------------------------------ supervisões
    supervisoes = {l.get("ID"): l.get("Supervisão") for l in _tabela(abas, "SUPERVISOES") if l.get("ID")}

    # ------------------------------------------------------------ equipe e acessos
    from lib.auth import hash_senha
    from lib.invites import invite
    from models.pessoas import Pessoa
    from models.usuarios import Usuario

    pessoa_do_usuario: dict[str, str] = {}  # U-... -> pessoa_id
    pessoa_por_nome: dict[str, str] = {}
    for u in await banco.usuarios.find({}).to_list(1000):
        if u.get("pessoa_id"):
            pessoa_por_nome[_sem_acento(u.get("nome") or "")] = u["pessoa_id"]
    for l in _tabela(abas, "USUARIOS"):
        uid_planilha, nome, email = l.get("ID") or "", (l.get("Nome") or "").strip(), (l.get("E-mail") or "").strip().lower()
        if not nome or "@" not in email:
            continue
        papel, cargo = PERFIS.get((l.get("Perfil") or "").strip().lower(), ("corretor", l.get("Perfil") or "Equipe"))
        loja = l.get("Loja") or ""
        sup = [supervisoes.get(s.strip(), "") for s in (l.get("Supervisões") or "").split(",") if s.strip()]
        detalhe = _loja_curta(loja) if loja else (", ".join(s for s in sup if s) or (_praca(l.get("Praça")) or ""))
        cargo_final = f"{cargo} - {detalhe}" if detalhe and papel == "corretor" else cargo
        ativo = (l.get("Ativo") or "SIM").strip().upper() != "NÃO"
        item = {"nome": nome, "email": email, "perfil": cargo_final, "papel": "Gestor" if papel == "admin" else "Equipe", "link": None,
                "telefone": l.get("Telefone") or None}
        existente = await banco.usuarios.find_one({"email": email})
        if existente:
            pessoa_do_usuario[uid_planilha] = existente.get("pessoa_id")
            item["situacao"] = "Já tinha acesso nesta empresa"
            acessos.append(item)
            continue
        if await controle.usuarios.find_one({"email": email}) or \
                any(i.get("empresa_id") != empresa["id"] for i in await controle.usuarios_index.find({"email": email}).to_list(5)):
            item["situacao"] = "E-mail já usado em outra empresa do SAX: não criado"
            acessos.append(item)
            avisos.append(f"{nome}: o e-mail {email} já é usado em outra empresa e não foi criado.")
            continue
        cont["usuarios"] += 1
        pessoa = Pessoa(nome=nome, papeis=["corretor"], email=email, telefone=l.get("Telefone") or None, cidade=_praca(l.get("Praça"))).model_dump()
        pessoa["planilha_id"] = uid_planilha
        pessoa_do_usuario[uid_planilha] = pessoa["id"]
        pessoa_por_nome[_sem_acento(nome)] = pessoa["id"]
        item["situacao"] = "Vai receber link para criar a senha" if ativo else "Inativo na planilha: criado sem acesso"
        if not simular:
            usuario = Usuario(nome=nome, email=email, senha_hash=hash_senha(secrets.token_urlsafe(24)), papel=papel, pessoa_id=pessoa["id"],
                              telefone=l.get("Telefone") or None, cargo=cargo_final, ativo=ativo).model_dump()
            usuario["activation_required"] = True
            usuario["planilha_id"] = uid_planilha
            await banco.pessoas.insert_one(pessoa)
            await banco.usuarios.insert_one(usuario)
            from lib.tenant import indexar_usuario

            await indexar_usuario(email, empresa["id"], empresa["db_name"])
            if ativo:
                from lib.db import definir_empresa

                definir_empresa(empresa["db_name"])
                try:
                    item["link"] = await invite(banco, usuario, empresa.get("nome") or "SAX")
                except Exception:
                    item["situacao"] = "Criado; gere o link de acesso em Equipe"
                    avisos.append(f"{nome}: não foi possível gerar o link agora. Gere em Equipe > Link de acesso.")
        acessos.append(item)

    # ------------------------------------------------------------ funis
    funis_planilha: dict[str, dict] = {}  # F-REVENDA -> {funil_id, etapas: {E1: id}}
    funis_db = await banco.funis.find({}).to_list(50)
    for l in _tabela(abas, "FUNIS"):
        fid, nome = l.get("ID") or "", (l.get("Nome") or "").strip()
        try:
            etapas = json.loads(l.get("Etapas (JSON)") or "[]")
        except ValueError:
            etapas = []
        if not fid or not nome or not etapas:
            continue
        atual = next((f for f in funis_db if f.get("planilha_id") == fid), None)
        if not atual:
            mesmo_nome = next((f for f in funis_db if (f.get("nome") or "").lower() == nome.lower()), None) or \
                next((f for f in funis_db if not f.get("planilha_id") and (f.get("nome") or "").lower().startswith(nome.lower())), None)
            vazio = mesmo_nome and not await banco.leads.find_one({"funil_id": mesmo_nome["id"]}, {"id": 1})
            n = len(etapas)
            novas = [{"id": new_id(), "nome": e.get("nome") or f"Etapa {i + 1}", "probabilidade": min(90, 10 + round(80 * i / max(n - 1, 1))),
                      "dias_parado": int(e.get("dias") or 0) or None, "cor": None, "planilha_id": e.get("id")} for i, e in enumerate(etapas)]
            if vazio:  # funil do segmento ainda sem negócio: passa a ter as etapas da planilha
                atual = {**mesmo_nome, "nome": nome, "etapas": novas, "planilha_id": fid}
                if not simular:
                    await banco.funis.update_one({"id": mesmo_nome["id"]}, {"$set": {"nome": nome, "etapas": novas, "planilha_id": fid}})
            else:
                atual = {"id": new_id(), "nome": nome if not mesmo_nome else f"{nome} (planilha)", "ordem": len(funis_db), "padrao": False,
                         "etapas": novas, "planilha_id": fid, "created_at": agora}
                if not simular:
                    await banco.funis.insert_one(atual)
                funis_db.append(atual)
        funis_planilha[fid] = {"funil": atual, "etapas": {e.get("planilha_id"): e for e in atual["etapas"]},
                               "aba": (l.get("Recebe leads da aba") or "").strip().upper()}

    # ------------------------------------------------------------ leads e clientes
    negocios_linhas = _tabela(abas, "NEGOCIOS")
    negocio_do_lead = {n.get("ID Lead"): n for n in negocios_linhas if n.get("ID Lead")}
    origens: set[str] = set()
    etiquetas: set[str] = set()
    cliente_do_lead: dict[str, str] = {}
    lead_info: dict[str, dict] = {}
    for aba, tipo in (("LEADS REVENDA", "Revenda"), ("LEADS EVENTOS", "Evento")):
        for l in _tabela(abas, aba):
            lid = l.get("ID Lead") or ""
            if not lid:
                continue
            restaurante = (l.get("Nome do Restaurante") or "").strip()
            responsavel = (l.get("Nome do Responsável") or "").strip()
            responsavel = "" if responsavel.lower() in ("sem nome", "-") else responsavel
            nome = restaurante or responsavel or "Contato da planilha"
            lead_info[lid] = {"nome": nome, "tipo": tipo, "origem": (l.get("Origem") or "Planilha").strip()[:80], "cidade": l.get("Localidade do pedido")}
            origens.add(lead_info[lid]["origem"])
            if await ja("entradas", lid):
                cont["ja_importados"] += 1
                e = await banco.entradas.find_one({"planilha_id": lid}, {"cliente_id": 1})
                cliente_do_lead[lid] = (e or {}).get("cliente_id")
                continue
            tel = l.get("Telefone") or ""
            digitos = _digitos(tel)
            cliente = await banco.pessoas.find_one({"telefone_digitos": digitos}) if len(digitos) >= 10 else None
            if not cliente:
                cnpj = _digitos(l.get("CNPJ"))
                from models.pessoas import formatar_documento

                cliente = Pessoa(nome=nome, papeis=["cliente"], tipo_pessoa="pj" if (cnpj or (restaurante and tipo == "Revenda")) else "pf",
                                 nome_fantasia=restaurante or None, responsavel_nome=responsavel or None, telefone=tel or None,
                                 email=(l.get("E-mail") or "").strip() or None, cpf_cnpj=formatar_documento(cnpj) if cnpj else None,
                                 logradouro=(l.get("Endereço / bairro") or "")[:300] or None, cidade=l.get("Localidade do pedido") or None,
                                 observacoes=(l.get("Observações") or "")[:4000] or None).model_dump()
                cliente["telefone_digitos"] = digitos or None
                cliente["documento_digitos"] = cnpj or None
                cliente["planilha_id"] = lid
                cliente["created_at"] = _data(l.get("Data de entrada")) or agora
                cont["clientes"] += 1
                if not simular:
                    await banco.pessoas.insert_one(cliente)
            cliente_do_lead[lid] = cliente["id"]
            neg = negocio_do_lead.get(lid)
            dono = pessoa_do_usuario.get((neg or {}).get("Responsável ID") or "")
            criado = _data(l.get("Data de entrada")) or agora
            partes = [f"{tipo}: {restaurante}" if restaurante else tipo, f"Responsável: {responsavel}" if responsavel else "",
                      f"CNPJ: {l.get('CNPJ')}" if l.get("CNPJ") else "", f"Endereço: {l.get('Endereço / bairro')}" if l.get("Endereço / bairro") else "",
                      l.get("Observações") or "", f"Pixel: {l.get('Pixel')}" if l.get("Pixel") else "", *l.get("_extra", [])]
            entrada = {
                "id": new_id(), "nome": nome[:200], "telefone": tel or None, "email": (l.get("E-mail") or "").strip() or None,
                "origem": lead_info[lid]["origem"], "interesse": "outro", "mensagem": "\n".join(p for p in partes if p)[:2000] or None,
                "imovel_id": None, "veiculo_id": None, "cliente_id": cliente["id"], "corretor_id": dono, "valor_estimado": None,
                "etiquetas": [tipo], "status": "convertido" if neg else "novo", "negocio_id": None, "motivo_descarte": None,
                "primeiro_contato_em": criado if neg else None, "atribuido_em": criado if dono else None, "na_fila": not dono and not neg,
                "fila_desde": criado if not dono and not neg else None, "devolvido_de": None, "portal_lead_id": None,
                "planilha_id": lid, "created_at": criado, "updated_at": criado,
            }
            cont["leads"] += 1
            if not simular:
                await banco.entradas.insert_one(entrada)

    # ------------------------------------------------------------ negócios
    negocio_id: dict[str, str] = {}
    for n in negocios_linhas:
        nid = n.get("ID") or ""
        if not nid:
            continue
        existente = await ja("leads", nid)
        if existente:
            negocio_id[nid] = existente["id"]
            cont["ja_importados"] += 1
            continue
        fp = funis_planilha.get(n.get("Funil") or "")
        if not fp:
            avisos.append(f"Negócio {nid}: funil {n.get('Funil')} não encontrado na aba FUNIS.")
            continue
        etapas = fp["funil"]["etapas"]
        etapa = fp["etapas"].get(n.get("Etapa")) or etapas[0]
        pos = next((i for i, e in enumerate(etapas) if e["id"] == etapa["id"]), 0)
        status = (n.get("Status") or "aberto").strip().lower()
        status = status if status in ("aberto", "ganho", "perdido") else "aberto"
        info = lead_info.get(n.get("ID Lead") or "", {})
        tags = [info.get("tipo") or ("Evento" if "EVENTO" in (n.get("Funil") or "") else "Revenda")]
        loja = n.get("Loja") or ""
        if loja:
            tags.append(f"Loja {_loja_curta(loja)}")
        sup = n.get("Supervisão") or ""
        if sup:
            tags.append(supervisoes.get(sup, sup))
        tags += [t for t in n.get("_extra", []) if len(t) <= 20]  # temperatura (Frio, Morno, Quente)
        etiquetas.update(tags)
        criado = _data(n.get("Criado em")) or agora
        doc = {
            "id": new_id(), "nome": (info.get("nome") or n.get("ID Lead") or nid)[:1000], "cliente_id": cliente_do_lead.get(n.get("ID Lead")),
            "corretor_id": pessoa_do_usuario.get(n.get("Responsável ID") or ""), "origem": info.get("origem") or "Planilha",
            "estagio": status if status != "aberto" else "novo", "valor_estimado": _valor(n.get("Valor")),
            "observacoes": " · ".join(x for x in [f"Loja: {_loja_curta(loja)}" if loja else "", f"Praça: {_praca(n.get('Praça')) or n.get('Praça')}" if n.get("Praça") else ""] if x) or None,
            "funil_id": fp["funil"]["id"], "etapa_id": etapa["id"], "status": status, "etapa_desde": _data(n.get("Na etapa desde")) or criado,
            "motivo_perda": (n.get("Motivo da perda") or "").strip()[:200] or None if status == "perdido" else None,
            "previsao_fechamento": None, "etiquetas": tags, "entrada_id": None, "etapas_alcancadas": [e["id"] for e in etapas[:pos + 1]],
            "planilha_id": nid, "created_at": criado, "updated_at": _data(n.get("Atualizado em")) or criado,
            "closed_at": _data(n.get("Ganho em") if status == "ganho" else n.get("Perdido em")) if status != "aberto" else None,
        }
        negocio_id[nid] = doc["id"]
        cont["negocios"] += 1
        if not simular:
            await banco.leads.insert_one(doc)
            await banco.entradas.update_one({"planilha_id": n.get("ID Lead")}, {"$set": {"negocio_id": doc["id"]}})
            await banco.historico.insert_one({"id": new_id(), "negocio_id": doc["id"], "tipo": "criado", "texto": "Negócio importado da planilha CRM Revendas",
                                              "autor": por, "autor_id": None, "fixado": False, "em": criado})

    # ------------------------------------------------------------ atividades
    for a in _tabela(abas, "ATIVIDADES"):
        aid = a.get("ID Atividade") or ""
        if not aid:
            continue
        if await ja("atividades", aid):
            cont["ja_importados"] += 1
            continue
        neg = negocio_id.get(a.get("ID Negócio") or "")
        neg_doc = None
        if neg and simular:
            neg_doc = None
        elif neg:
            neg_doc = await banco.leads.find_one({"id": neg}, {"corretor_id": 1, "cliente_id": 1})
        situacao = (a.get("Status") or "").strip()
        feita = bool(a.get("Concluída em")) or _sem_acento(situacao).lower() in {_sem_acento(x).lower() for x in FEITAS}
        notas = [a.get("Observação") or "", f"Resultado: {situacao}" if situacao else "",
                 f"Anexo no Google Drive da planilha (ID {a.get('Anexo (ID arquivo)')})" if a.get("Anexo (ID arquivo)") else ""]
        dono = pessoa_por_nome.get(_sem_acento(a.get("Feito por") or "")) or (neg_doc or {}).get("corretor_id")
        doc = {
            "id": new_id(), "tipo": TIPOS_ATIVIDADE.get(_sem_acento(a.get("Tipo") or "").lower(), "tarefa"),
            "assunto": (a.get("Título") or a.get("Tipo") or "Atividade")[:300], "data": _dia(a.get("Prazo")) or _dia(a.get("Criada em")) or agora.date().isoformat(),
            "hora": None, "duracao_min": 30, "negocio_id": neg, "entrada_id": None, "pessoa_id": (neg_doc or {}).get("cliente_id"), "imovel_id": None,
            "corretor_id": dono, "notas": "\n".join(x for x in notas if x)[:5000] or None, "concluida": feita,
            "concluida_em": _data(a.get("Concluída em")) if feita else None, "created_by": a.get("Criada por") or "Planilha",
            "planilha_id": aid, "created_at": _data(a.get("Criada em")) or agora, "updated_at": agora,
        }
        cont["atividades"] += 1
        if not simular:
            await banco.atividades.insert_one(doc)

    # ------------------------------------------------------------ histórico
    if not simular:
        ja_hist = {h.get("planilha_id") for h in await banco.historico.find({"planilha_id": {"$ne": None}}, {"planilha_id": 1}).to_list(20000)}
    else:
        ja_hist = set()
    for i, h in enumerate(_tabela(abas, "HISTORICO")):
        neg = negocio_id.get(h.get("ID Negócio") or "")
        if not neg:
            continue
        chave = f"{h.get('ID Negócio')}|{h.get('Data')}|{h.get('Ação')}|{h.get('Detalhe')}|{i}"
        if chave in ja_hist:
            continue
        acao = h.get("Ação") or ""
        a = _sem_acento(acao).lower()
        tipo = "status" if ("perdido" in a or "ganho" in a) else "etapa" if "etapa" in a else "atividade" if "atividade" in a else "campo"
        cont["historico"] += 1
        if not simular:
            await banco.historico.insert_one({"id": new_id(), "negocio_id": neg, "tipo": tipo,
                                              "texto": f"{acao}: {h.get('Detalhe')}" if h.get("Detalhe") else acao,
                                              "autor": h.get("Usuário") or None, "autor_id": None, "fixado": False,
                                              "em": _data(h.get("Data")) or agora, "planilha_id": chave})

    # ------------------------------------------------------------ origens e etiquetas no CRM
    if not simular and (origens or etiquetas):
        crm = (await banco.configuracoes.find_one({"id": "singleton"}, {"crm": 1}) or {}).get("crm") or {}
        novas_origens = list(dict.fromkeys([*(crm.get("origens") or []), *sorted(origens)]))[:60]
        novas_etiquetas = list(dict.fromkeys([*(crm.get("etiquetas") or []), *sorted(etiquetas)]))[:80]
        await banco.configuracoes.update_one({"id": "singleton"}, {"$set": {"crm.origens": novas_origens, "crm.etiquetas": novas_etiquetas}})

    pedidos = [p for p in _tabela(abas, "PEDIDOS") if p.get("ID")]
    if pedidos:
        avisos.append(f"{len(pedidos)} pedido(s) da aba PEDIDOS não foram importados: o SAX ainda não tem a tela de comissão por pedido.")
    if any(a["link"] for a in acessos):
        avisos.append("Os links de acesso valem por 24 horas e são de uso único. Mande para cada pessoa hoje.")
    return {"simulado": simular, "contagens": cont, "acessos": acessos, "avisos": avisos}
