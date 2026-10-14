"""Domínio próprio do site de cada empresa (www.suaempresa.com.br).

Como funciona:
- O cliente informa o domínio em Meu site. Guardamos `www.dominio` (principal) e o domínio sem www
  (redireciona para o www) no índice global `controle.dominios_index`: host -> banco da empresa.
- Com o token do Vercel configurado (Empresas > Pagamentos, ou VERCEL_API_TOKEN), os dois hosts são
  cadastrados no projeto do Vercel pela API, e o Vercel emite o certificado HTTPS sozinho quando o DNS
  aponta para ele. Sem o token, o domínio fica "aguardando ativação" para a equipe SAX cadastrar à mão.
- O cliente cria no DNS: CNAME www -> (valor recomendado pelo Vercel) e A @ -> (IP recomendado).
- Quando o navegador abre o app num host que não é do SAX, a tela pergunta `/publico/site/dominio/{host}`
  e mostra o site daquela empresa.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import re

import httpx
from fastapi import HTTPException

from lib.db import controle
from models.common import now_utc

logger = logging.getLogger(__name__)

API = "https://api.vercel.com"
DOC = "vercel"
CNAME_PADRAO = "cname.vercel-dns.com"
IP_PADRAO = "76.76.21.21"
COLECAO = "dominios_index"
_ROTULO = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")
PROIBIDOS = ("vercel.app", "vercel.com", "localhost", "sax-crm", "agenciasax.com.br")


def normalizar(texto: str) -> str:
    """'https://WWW.Minha-Imob.com.br/' -> 'minha-imob.com.br' (sem www; o www é acrescentado depois)."""
    h = (texto or "").strip().lower()
    h = re.sub(r"^[a-z]+://", "", h).split("/")[0].split("?")[0].split(":")[0].strip(".")
    try:
        h = h.encode("idna").decode("ascii")
    except UnicodeError:
        raise HTTPException(422, "Domínio inválido. Escreva só o endereço, por exemplo: minhaempresa.com.br")
    if h.startswith("www."):
        h = h[4:]
    try:
        ipaddress.ip_address(h)
        raise HTTPException(422, "Use um domínio (minhaempresa.com.br), não um número de IP.")
    except ValueError:
        pass
    partes = h.split(".")
    if len(h) > 200 or len(partes) < 2 or not all(_ROTULO.match(p) for p in partes) or not re.match(r"^[a-z]{2,}$", partes[-1]):
        raise HTTPException(422, "Domínio inválido. Escreva só o endereço, por exemplo: minhaempresa.com.br")
    if any(p in h for p in PROIBIDOS):
        raise HTTPException(422, "Este endereço não pode ser usado como domínio próprio.")
    return h


def hosts(base: str) -> tuple[str, str]:
    """(principal com www, raiz que redireciona para o www)."""
    return f"www.{base}", base


async def config() -> dict:
    doc = await controle.plataforma.find_one({"_id": DOC}) or {}
    token = os.environ.get("VERCEL_API_TOKEN") or doc.get("token")
    return {"token": token, "projeto": os.environ.get("VERCEL_PROJECT") or doc.get("projeto") or "",
            "time": os.environ.get("VERCEL_TEAM_ID") or doc.get("time") or "", "por_env": bool(os.environ.get("VERCEL_API_TOKEN"))}


def _params(cfg: dict) -> dict:
    return {"teamId": cfg["time"]} if cfg.get("time") else {}


async def _vercel(metodo: str, caminho: str, cfg: dict, corpo: dict | None = None, extra: dict | None = None) -> tuple[int, dict]:
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.request(metodo, API + caminho, params={**_params(cfg), **(extra or {})}, json=corpo,
                            headers={"Authorization": f"Bearer {cfg['token']}"})
    try:
        dados = r.json()
    except ValueError:
        dados = {}
    return r.status_code, dados


def ativo_vercel(cfg: dict) -> bool:
    return bool(cfg.get("token") and cfg.get("projeto"))


async def cadastrar_no_vercel(base: str, cfg: dict) -> str | None:
    """Cadastra www (principal) e a raiz (redirect 308 para o www). Devolve mensagem de erro ou None."""
    principal, raiz = hosts(base)
    for nome, corpo in ((principal, {"name": principal}), (raiz, {"name": raiz, "redirect": principal, "redirectStatusCode": 308})):
        st, dados = await _vercel("POST", f"/v10/projects/{cfg['projeto']}/domains", cfg, corpo)
        if st in (200, 201):
            continue
        codigo = (dados.get("error") or {}).get("code", "")
        if st == 400:  # o Vercel responde 400 quando o domínio já está neste projeto
            existe, _ = await _vercel("GET", f"/v9/projects/{cfg['projeto']}/domains/{nome}", cfg)
            if existe == 200:
                continue
        if st == 409:
            return "Este domínio já está ligado a outro site no Vercel. Remova de lá ou fale com o suporte."
        logger.warning("vercel add %s: %s %s", nome, st, codigo)
        return "Não foi possível registrar o domínio agora. Tente de novo em alguns minutos."
    return None


async def remover_do_vercel(base: str, cfg: dict) -> None:
    for nome in hosts(base):
        try:
            await _vercel("DELETE", f"/v9/projects/{cfg['projeto']}/domains/{nome}", cfg)
        except httpx.HTTPError:
            pass


async def situacao_vercel(base: str, cfg: dict) -> dict:
    """Pergunta ao Vercel se o domínio está verificado e se o DNS aponta certo."""
    principal, raiz = hosts(base)
    registros = [{"tipo": "CNAME", "nome": "www", "valor": CNAME_PADRAO}, {"tipo": "A", "nome": "@", "valor": IP_PADRAO}]
    try:
        st, proj = await _vercel("GET", f"/v9/projects/{cfg['projeto']}/domains/{principal}", cfg)
        if st == 404:
            return {"status": "nao_cadastrado", "registros": registros}
        _, conf_www = await _vercel("GET", f"/v6/domains/{principal}/config", cfg, extra={"projectIdOrName": cfg["projeto"]})
        _, conf_raiz = await _vercel("GET", f"/v6/domains/{raiz}/config", cfg, extra={"projectIdOrName": cfg["projeto"]})
    except httpx.HTTPError:
        return {"status": "erro", "registros": registros, "mensagem": "Não foi possível consultar o Vercel agora."}
    cname = sorted(conf_www.get("recommendedCNAME") or [], key=lambda x: x.get("rank", 99))
    ipv4 = sorted(conf_raiz.get("recommendedIPv4") or [], key=lambda x: x.get("rank", 99))
    if cname:
        registros[0]["valor"] = str(cname[0].get("value") or CNAME_PADRAO).rstrip(".")
    if ipv4 and ipv4[0].get("value"):
        registros[1]["valor"] = ipv4[0]["value"][0]
    verificacao = [{"tipo": v.get("type"), "nome": v.get("domain"), "valor": v.get("value")} for v in proj.get("verification") or []]
    ok = bool(proj.get("verified")) and conf_www.get("misconfigured") is False
    return {"status": "ativo" if ok else "aguardando_dns", "registros": registros + verificacao,
            "raiz_ok": conf_raiz.get("misconfigured") is False}


async def resolver(host: str) -> dict | None:
    """Host -> índice (db_name, base). Só domínios já ligados a uma empresa."""
    h = (host or "").lower().split(":")[0].strip(".")
    if not h or len(h) > 200:
        return None
    return await controle[COLECAO].find_one({"_id": h})


async def indexar(base: str, db_name: str, empresa_id: str | None) -> None:
    for nome in hosts(base):
        await controle[COLECAO].update_one({"_id": nome}, {"$set": {"_id": nome, "base": base, "db_name": db_name, "empresa_id": empresa_id,
                                                                     "atualizado_em": now_utc()}}, upsert=True)


async def desindexar(base: str) -> None:
    for nome in hosts(base):
        await controle[COLECAO].delete_one({"_id": nome})
