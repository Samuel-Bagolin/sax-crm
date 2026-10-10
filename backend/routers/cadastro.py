"""Cadastro público com assinatura: o cliente escolhe o segmento, o plano e paga no cartão.

Ordem pensada para nunca cobrar sem criar a conta, nem criar conta sem cobrança:
1. Valida tudo antes de falar com o Asaas (dados, documento, e-mail livre, plano do segmento, cartão).
2. Registra o cadastro em `controle.cadastros` com a chave de idempotência enviada pela tela. Um
   segundo clique no botão devolve o mesmo resultado em vez de cobrar duas vezes.
3. Cartão de demonstração (só o administrador de sistema conhece): não chama o Asaas, a empresa
   nasce paga e marcada como demonstração.
4. Cria cliente e assinatura no Asaas (primeira cobrança no ato).
5. Cria a empresa. Se isso falhar depois da cobrança, cancela a assinatura no Asaas e deixa o
   cadastro marcado para o suporte conferir.
6. Já entra logado.

O corpo do pedido é lido à mão: o FastAPI devolveria os valores recebidos num erro 422, e isso
incluiria o número do cartão.
"""

import logging
import re
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field, ValidationError

from lib import asaas
from lib.assinatura import eh_cartao_demo, so_digitos, validar_cartao
from lib.auth import criar_token, gravar_cookie, hash_senha
from lib.db import controle, definir_empresa, nome_banco_empresa
from lib.planos import PLANOS, RECURSOS, carregar_catalogo, planos_do_segmento
from lib.segmentos import CATEGORIAS, SEGMENTOS, catalogo_publico
from lib.tenant import indexar_usuario, provisionar_empresa
from models.common import now_utc
from models.empresas import Empresa, slugificar
from models.pessoas import cnpj_valido, cpf_valido, formatar_documento
from models.usuarios import Usuario

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publico/cadastro", tags=["cadastro"])

SENHA_MINIMA = 10


class DadosCadastro(BaseModel):
    chave: str = Field(min_length=16, max_length=64)  # idempotência gerada pela tela
    segmento: str
    plano: str
    periodicidade: str = "mensal"
    empresa_nome: str = Field(min_length=2, max_length=80)
    documento: str = Field(min_length=11, max_length=20)  # CPF ou CNPJ do titular da assinatura
    nome: str = Field(min_length=3, max_length=80)
    email: EmailStr
    telefone: str = Field(min_length=10, max_length=20)
    senha: str = Field(min_length=1, max_length=200)
    cep: str = Field(min_length=8, max_length=10)
    numero_endereco: str = Field(min_length=1, max_length=10)
    aceite: bool = False
    site: str | None = None  # isca para robôs


class Cartao(BaseModel):
    numero: str = Field(max_length=30)
    nome: str = Field(max_length=80)
    validade: str = Field(max_length=7)  # MM/AA ou MM/AAAA
    cvv: str = Field(max_length=4)


def _ip(request: Request) -> str:
    primeiro = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return request.headers.get("x-real-ip") or primeiro or (request.client.host if request.client else "0.0.0.0")


@router.get("/opcoes")
async def opcoes():
    """Segmentos por categoria e planos de cada segmento, para a tela de cadastro."""
    await carregar_catalogo()
    cfg = await asaas.config()
    segmentos = catalogo_publico()
    planos = {}
    for s in segmentos:
        planos[s["chave"]] = [
            {"chave": k, "nome": p["nome"], "resumo": p.get("resumo", ""), "preco_mensal": p.get("preco_mensal"),
             "preco_anual": p.get("preco_anual") if p.get("preco_anual") is not None else round(float(p.get("preco_mensal") or 0) * 12, 2),
             "usuarios": p.get("usuarios"), "imoveis": p.get("imoveis"), "unidades": p.get("unidades"),
             "recursos": [RECURSOS[r] for r in p.get("recursos", []) if r in RECURSOS]}
            for k, p in sorted(planos_do_segmento(s["chave"]).items(), key=lambda kv: kv[1].get("ordem", 50))
        ]
    return {"categorias": CATEGORIAS, "segmentos": segmentos, "planos": planos, "pagamento_online": bool(cfg["chave"])}


def _erro_validacao(e: ValidationError) -> HTTPException:
    nomes = {"email": "e-mail", "telefone": "telefone", "documento": "CPF ou CNPJ", "empresa_nome": "nome da empresa",
             "nome": "seu nome", "cep": "CEP", "numero_endereco": "número do endereço", "chave": "formulário",
             "numero": "número do cartão", "validade": "validade do cartão", "cvv": "CVV"}
    campos = sorted({nomes.get(str(err["loc"][0]), str(err["loc"][0])) for err in e.errors() if err.get("loc")})
    return HTTPException(422, "Confira: " + ", ".join(campos) + ".")


async def _slug_livre(nome: str) -> str:
    base = slugificar(nome)
    slug = base
    while await controle.empresas.find_one({"slug": slug}, {"id": 1}):
        slug = f"{base[:18]}{secrets.token_hex(3)}"
    return slug


@router.post("", status_code=201)
async def cadastrar(request: Request, response: Response):
    try:
        bruto = await request.json()
    except Exception:
        raise HTTPException(400, "Pedido inválido")
    if not isinstance(bruto, dict):
        raise HTTPException(400, "Pedido inválido")
    try:
        d = DadosCadastro(**{k: v for k, v in bruto.items() if k != "cartao"})
        c = Cartao(**(bruto.get("cartao") or {}))
    except ValidationError as e:
        raise _erro_validacao(e)
    except TypeError:
        raise HTTPException(400, "Pedido inválido")
    finally:
        bruto = None  # noqa: F841 (descarta a cópia com o cartão)

    if d.site:
        raise HTTPException(400, "Pedido inválido")
    if not d.aceite:
        raise HTTPException(422, "Aceite os termos de uso para continuar.")
    if d.segmento not in SEGMENTOS:
        raise HTTPException(422, "Escolha o segmento da sua empresa.")
    await carregar_catalogo()
    plano = PLANOS.get(d.plano)
    if not plano or not plano.get("ativo", True) or (plano.get("segmento") or "imobiliaria") != d.segmento:
        raise HTTPException(422, "Escolha um dos planos do seu segmento.")
    if d.periodicidade not in ("mensal", "anual"):
        raise HTTPException(422, "Escolha mensal ou anual.")
    doc = so_digitos(d.documento)
    if not ((len(doc) == 11 and cpf_valido(doc)) or (len(doc) == 14 and cnpj_valido(doc))):
        raise HTTPException(422, "CPF ou CNPJ inválido.")
    if len(d.senha) < SENHA_MINIMA or d.senha.lower() in d.email.lower() or len(set(d.senha)) < 5:
        raise HTTPException(422, f"Crie uma senha com pelo menos {SENHA_MINIMA} caracteres, diferente do e-mail.")
    telefone = so_digitos(d.telefone)
    if not 10 <= len(telefone) <= 11:
        raise HTTPException(422, "Telefone com DDD inválido.")
    cep = so_digitos(d.cep)
    if len(cep) != 8:
        raise HTTPException(422, "CEP inválido.")
    mes, _, ano = c.validade.partition("/")
    cartao = validar_cartao(c.numero, mes, ano, c.cvv, c.nome)

    email = d.email.lower().strip()
    if await controle.usuarios_index.find_one({"email": email}) or await controle.usuarios.find_one({"email": email}):
        raise HTTPException(409, "Este e-mail já tem acesso ao SAX. Entre pela tela de login ou use outro e-mail.")

    # ---------------------------------------------------------- idempotência
    existente = await controle.cadastros.find_one({"_id": d.chave})
    if existente:
        if existente.get("status") == "concluido" and existente.get("email") == email:
            raise HTTPException(409, "Este cadastro já foi concluído. Entre pela tela de login.")
        if existente.get("status") in ("processando", "pago_sem_conta"):
            raise HTTPException(409, "Este cadastro já está em processamento. Aguarde alguns segundos.")
    else:
        try:
            await controle.cadastros.insert_one({"_id": d.chave, "status": "processando", "email": email, "segmento": d.segmento,
                                                 "plano": d.plano, "periodicidade": d.periodicidade, "em": now_utc()})
        except Exception:
            raise HTTPException(409, "Este cadastro já está em processamento. Aguarde alguns segundos.")

    valor = float(plano.get("preco_anual") if d.periodicidade == "anual" and plano.get("preco_anual") is not None
                  else (float(plano.get("preco_mensal") or 0) * (12 if d.periodicidade == "anual" else 1)))
    seg_nome = SEGMENTOS[d.segmento]["nome"]
    demo = await eh_cartao_demo(cartao["numero"])
    hoje = date.today()
    proximo = (hoje.replace(year=hoje.year + 1) if d.periodicidade == "anual"
               else (hoje.replace(day=1) + timedelta(days=32)).replace(day=min(hoje.day, 28))).isoformat()
    assinatura: dict = {"periodicidade": d.periodicidade, "valor": round(valor, 2), "plano": d.plano,
                        "criada_em": now_utc(), "proximo_vencimento": proximo}

    if demo:
        assinatura.update(gateway="demonstracao", demo=True, status="ativa", cartao_final=cartao["numero"][-4:],
                          cartao_bandeira="Demonstração")
    else:
        try:
            cliente = await asaas.criar_cliente(nome=d.empresa_nome.strip() if len(doc) == 14 else d.nome.strip(),
                                                cpf_cnpj=doc, email=email, telefone=telefone, cep=cep,
                                                numero=d.numero_endereco.strip(), referencia=d.chave)
            sub = await asaas.criar_assinatura(
                cliente_id=cliente["id"], valor=valor, ciclo=d.periodicidade,
                descricao=f"SAX CRM {seg_nome}, plano {plano['nome']} ({d.periodicidade})", cartao=cartao,
                titular={"nome": cartao["nome"], "email": email, "cpf_cnpj": doc, "cep": cep,
                         "numero": d.numero_endereco.strip(), "telefone": telefone},
                ip=_ip(request), referencia=d.chave,
            )
        except asaas.ErroAsaas as e:
            await controle.cadastros.update_one({"_id": d.chave}, {"$set": {"status": "recusado", "motivo": e.mensagem, "fim": now_utc()}})
            # Libera a mesma chave para nova tentativa com outro cartão.
            await controle.cadastros.delete_one({"_id": d.chave, "status": "recusado"})
            raise asaas.http(e)
        cc = sub.get("creditCard") or {}
        assinatura.update(gateway="asaas", demo=False, status="ativa", asaas_cliente_id=cliente["id"],
                          asaas_assinatura_id=sub["id"], cartao_final=cc.get("creditCardNumber"),
                          cartao_bandeira=cc.get("creditCardBrand"), cartao_token=cc.get("creditCardToken"),
                          proximo_vencimento=sub.get("nextDueDate") or proximo)
        await controle.cadastros.update_one({"_id": d.chave}, {"$set": {"asaas_assinatura_id": sub["id"], "asaas_cliente_id": cliente["id"]}})
    cartao = None  # noqa: F841 (o cartão não segue adiante)

    # ---------------------------------------------------------- cria a empresa
    try:
        slug = await _slug_livre(d.empresa_nome)
        db_name = nome_banco_empresa(slug)
        empresa = Empresa(nome=d.empresa_nome.strip(), slug=slug, db_name=db_name,
                          cnpj=formatar_documento(doc) if len(doc) == 14 else None, segmento=d.segmento, plano=d.plano,
                          plano_aplicado=True, modulos=list(plano["modulos"]), assinatura=assinatura, origem="cadastro")
        gestor = Usuario(nome=d.nome.strip(), email=email, senha_hash=hash_senha(d.senha), papel="admin",
                         telefone=d.telefone.strip()).model_dump()
        await indexar_usuario(email, empresa.id, db_name)
        api_key = await provisionar_empresa(nome=empresa.nome, db_name=db_name, admin=gestor, segmento=d.segmento)
        dados = empresa.model_dump()
        dados.update(site_api_key=api_key, asaas_assinatura_id=assinatura.get("asaas_assinatura_id"),
                     comercial={"periodicidade": d.periodicidade, "adicionais": [], "taxa_instalacao": 0},
                     titular={"nome": d.nome.strip(), "documento": formatar_documento(doc), "email": email,
                              "telefone": telefone, "cep": cep, "numero": d.numero_endereco.strip()})
        await controle.empresas.insert_one(dados)
    except Exception as e:
        logger.exception("cadastro %s: empresa não criada após a cobrança", d.chave)
        if assinatura.get("asaas_assinatura_id"):
            try:
                await asaas.cancelar_assinatura(assinatura["asaas_assinatura_id"])
                situacao = "cancelado_apos_falha"
            except Exception:
                situacao = "pago_sem_conta"
        else:
            situacao = "falhou"
        await controle.cadastros.update_one({"_id": d.chave}, {"$set": {"status": situacao, "erro": type(e).__name__, "fim": now_utc()}})
        detalhe = getattr(e, "detail", None)
        if isinstance(e, HTTPException) and e.status_code == 409:
            raise HTTPException(409, detalhe or "Este e-mail já tem acesso ao SAX.")
        raise HTTPException(500, f"Não foi possível concluir o cadastro. Protocolo {d.chave[:8]}. "
                                 "Se houve cobrança, ela foi cancelada; o suporte confere e retorna.")

    await controle.cadastros.update_one({"_id": d.chave}, {"$set": {"status": "concluido", "empresa_id": empresa.id,
                                                                     "demo": bool(assinatura.get("demo")), "fim": now_utc()}})
    logger.info("cadastro concluído: %s (%s, %s%s)", slug, d.segmento, d.plano, ", demonstração" if demo else "")
    definir_empresa(db_name)
    gravar_cookie(response, criar_token(gestor["id"], empresa_id=empresa.id, session_version=0))
    return {"ok": True, "empresa": empresa.nome, "segmento": d.segmento, "demo": bool(demo)}


@router.post("/email-disponivel")
async def email_disponivel(request: Request):
    try:
        email = str((await request.json()).get("email") or "").lower().strip()
    except Exception:
        raise HTTPException(400, "Pedido inválido")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return {"disponivel": False, "valido": False}
    ocupado = await controle.usuarios_index.find_one({"email": email}) or await controle.usuarios.find_one({"email": email})
    return {"disponivel": not ocupado, "valido": True}
