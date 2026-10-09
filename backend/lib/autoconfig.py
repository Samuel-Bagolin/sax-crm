"""Configuração automática para o deploy no Vercel + Firebase com o mínimo de variáveis.

A única variável obrigatória é FIREBASE_SERVICE_ACCOUNT (o resto tem padrão aqui):
- APP_ENV / APP_URL: derivados das variáveis de sistema do Vercel (VERCEL_ENV, VERCEL_PROJECT_PRODUCTION_URL).
- JWT_SECRET, CRON_SECRET, GOOGLE_TOKEN_KEY, BACKUP_ENCRYPTION_KEY: gerados uma vez e guardados no
  próprio banco (coleção `_sistema`, que só a conta de serviço lê). Variável de ambiente, se existir, vence.
- Primeiro Administrador de Sistema: o usuário criado no Firebase Authentication (ADMIN_PADRAO_EMAIL),
  conferido pela API pública do Firebase no primeiro login. Senha fraca obriga a troca no primeiro acesso.
- Regras do Firestore e do Realtime Database: trancadas (acesso só pelo servidor) na inicialização.

Nada secreto fica no código: a configuração web do Firebase (apiKey etc.) é pública por natureza.
"""

import base64
import logging
import os
import secrets

import httpx
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger(__name__)

# Configuração web do Firebase (pública; a mesma que vai no JavaScript de qualquer site Firebase).
FIREBASE_WEB = {
    "apiKey": "AIzaSyAmw_R-PlCG3K4MbJL1X6lYiMMDJrwQtJA",
    "authDomain": "sax-crm.firebaseapp.com",
    "projectId": "sax-crm",
    "storageBucket": "sax-crm.firebasestorage.app",
    "messagingSenderId": "495891939064",
    "appId": "1:495891939064:web:5c48312b7c1c70ba16850d",
}
ADMIN_PADRAO_EMAIL = "adm@sax.com.br"
SENHA_MINIMA = 12

_SEGREDOS = {
    "JWT_SECRET": lambda: secrets.token_urlsafe(48),
    "CRON_SECRET": lambda: secrets.token_urlsafe(32),
    "GOOGLE_TOKEN_KEY": lambda: base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
    "BACKUP_ENCRYPTION_KEY": lambda: base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
}

ESTADO: dict = {"segredos": None, "regras": None, "local": None}


def aplicar_padroes_ambiente() -> None:
    """Roda no import (antes de qualquer leitura de APP_ENV/APP_URL)."""
    if not os.environ.get("FIREBASE_PROJECT_ID"):
        os.environ["FIREBASE_PROJECT_ID"] = FIREBASE_WEB["projectId"]
    vercel_env = os.environ.get("VERCEL_ENV")
    if vercel_env and not os.environ.get("APP_ENV"):
        os.environ["APP_ENV"] = {"production": "producao", "preview": "homologacao"}.get(vercel_env, "desenvolvimento")
    if not os.environ.get("APP_URL"):
        host = (os.environ.get("VERCEL_PROJECT_PRODUCTION_URL") if vercel_env == "production" else None) or os.environ.get("VERCEL_URL")
        if host:
            os.environ["APP_URL"] = "https://" + host.removeprefix("https://").rstrip("/")


async def carregar_segredos(controle) -> None:
    """Completa as variáveis secretas que faltam com valores guardados no banco (gera na 1ª vez)."""
    faltando = [k for k in _SEGREDOS if not os.environ.get(k)]
    if not faltando:
        ESTADO["segredos"] = "variaveis"
        return
    col = controle["_sistema"]
    doc = await col.find_one({"_id": "segredos"})
    if doc is None:
        try:
            await col.insert_one({"_id": "segredos", **{k: gerar() for k, gerar in _SEGREDOS.items()}})
        except DuplicateKeyError:
            pass  # outra instância gerou ao mesmo tempo: vale a dela
        doc = await col.find_one({"_id": "segredos"})
    novos = {k: gerar() for k, gerar in _SEGREDOS.items() if not doc.get(k)}
    if novos:
        await col.update_one({"_id": "segredos"}, {"$set": novos})
        doc = await col.find_one({"_id": "segredos"})
    for k in faltando:
        os.environ[k] = doc[k]
    ESTADO["segredos"] = "banco"


# ------------------------------------------------------------------ primeiro administrador


async def conferir_no_firebase_auth(email: str, senha: str) -> dict | None:
    """Confere e-mail/senha no Firebase Authentication. Devolve o perfil ou None."""
    chave = os.environ.get("FIREBASE_WEB_API_KEY") or FIREBASE_WEB["apiKey"]
    emulador = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST")
    base = f"http://{emulador}/identitytoolkit.googleapis.com" if emulador else "https://identitytoolkit.googleapis.com"
    url = f"{base}/v1/accounts:signInWithPassword?key={chave}"
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            r = await http.post(url, json={"email": email, "password": senha, "returnSecureToken": True})
    except httpx.HTTPError:
        logger.warning("Firebase Authentication indisponível")
        return None
    if r.status_code != 200:
        return None
    dados = r.json()
    return dados if (dados.get("email") or "").lower() == email else None


async def administrador_pelo_firebase(controle, email: str, senha: str) -> dict | None:
    """Sem nenhum Administrador de Sistema ainda: cria o primeiro a partir do usuário do Firebase Auth.

    Só aceita o e-mail definido (ADMIN_INICIAL_EMAIL ou o padrão), para que ninguém que se cadastre
    sozinho no Firebase Auth vire administrador.
    """
    permitido = (os.environ.get("ADMIN_INICIAL_EMAIL") or ADMIN_PADRAO_EMAIL).strip().lower()
    if email != permitido or len(senha.encode()) > 72:
        return None
    if await controle.usuarios.find_one({"papel": "sysadmin"}, {"_id": 1}):
        return None
    perfil = await conferir_no_firebase_auth(email, senha)
    if not perfil:
        return None
    from lib.auth import hash_senha
    from models.usuarios import Usuario

    nome = perfil.get("displayName") or os.environ.get("ADMIN_INICIAL_NOME") or "Administrador"
    doc = {**Usuario(nome=nome, email=email, senha_hash=hash_senha(senha), papel="sysadmin").model_dump(),
           "trocar_senha": len(senha) < SENHA_MINIMA}
    try:
        await controle.usuarios.insert_one(doc)
    except DuplicateKeyError:
        return await controle.usuarios.find_one({"email": email, "papel": "sysadmin"})
    logger.warning("Administrador de Sistema inicial criado a partir do Firebase Authentication: %s", email)
    return doc


# ------------------------------------------------------------------ regras de segurança do Firebase

REGRAS_FIRESTORE = """rules_version = '2';
// SAX CRM: o acesso aos dados é só pelo servidor (conta de serviço), que ignora estas regras.
// Navegadores e apps não leem nem gravam direto no banco.
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
"""
ESCOPO_ADMIN = ("https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase "
                "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email")


async def trancar_regras(client) -> None:
    """Fecha as regras públicas do Firestore e do Realtime Database (uma vez; marca em `_sistema`)."""
    conexao = getattr(client, "conexao", None)
    if conexao is None or conexao.emulador or not conexao.credencial:
        ESTADO["regras"] = "não se aplica"
        return
    from lib.db import controle

    marca = await controle["_sistema"].find_one({"_id": "regras"})
    if marca and marca.get("versao") == 1:
        ESTADO["regras"] = "trancadas"
        return
    projeto = conexao.projeto
    falhas = []
    try:
        token = await conexao.token(ESCOPO_ADMIN)
        cab = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=15) as http:
            base = f"https://firebaserules.googleapis.com/v1/projects/{projeto}"
            r = await http.post(f"{base}/rulesets", headers=cab, json={
                "source": {"files": [{"name": "firestore.rules", "content": REGRAS_FIRESTORE}]}})
            if r.status_code == 200:
                ruleset = r.json()["name"]
                release = f"projects/{projeto}/releases/cloud.firestore"
                r = await http.patch(f"{base}/releases/cloud.firestore", headers=cab,
                                     json={"release": {"name": release, "rulesetName": ruleset}})
                if r.status_code == 404:
                    r = await http.post(f"{base}/releases", headers=cab, json={"name": release, "rulesetName": ruleset})
            if r.status_code != 200:
                falhas.append(f"Firestore {r.status_code}: {r.text[:160]}")

            rtdb = os.environ.get("FIREBASE_DATABASE_URL") or f"https://{projeto}-default-rtdb.firebaseio.com"
            r = await http.put(f"{rtdb}/.settings/rules.json", headers=cab,
                               content='{"rules": {".read": false, ".write": false}}')
            if r.status_code not in (200, 404):  # 404: projeto sem Realtime Database
                falhas.append(f"Realtime Database {r.status_code}: {r.text[:160]}")
    except Exception as exc:
        falhas.append(f"{type(exc).__name__}: {str(exc)[:160]}")
    if falhas:
        ESTADO["regras"] = "ERRO ao trancar: " + " | ".join(falhas)
        logger.error("Não foi possível trancar as regras do Firebase: %s", falhas)
        return
    await controle["_sistema"].update_one({"_id": "regras"}, {"$set": {"versao": 1}}, upsert=True)
    ESTADO["regras"] = "trancadas"
    logger.warning("Regras do Firestore e do Realtime Database trancadas (acesso só pelo servidor)")


async def local_do_banco(client) -> str | None:
    """Região do Firestore (para conferir se combina com a região da função no Vercel)."""
    if ESTADO["local"]:
        return ESTADO["local"]
    conexao = getattr(client, "conexao", None)
    if conexao is None or conexao.emulador or not conexao.credencial:
        return None
    try:
        url = conexao.base.rsplit("/documents", 1)[0]
        dados = await conexao.chamar("GET", url)
        ESTADO["local"] = (dados or {}).get("locationId")
    except Exception:
        return None
    return ESTADO["local"]
