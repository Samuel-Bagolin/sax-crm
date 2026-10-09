"""Portable authenticated backups. Configure and keep BACKUP_ENCRYPTION_KEY offline."""
import os
from pathlib import Path
from cryptography.fernet import Fernet, InvalidToken
from bson import json_util
from fastapi import HTTPException


def cipher():
    try:
        # A secret manager may mount this file; never copy the key into source or logs.
        path = os.environ.get("BACKUP_ENCRYPTION_KEY_FILE")
        key = Path(path).read_text().strip() if path else os.environ["BACKUP_ENCRYPTION_KEY"]
        return Fernet(key.encode())
    except (KeyError, ValueError, OSError):
        raise HTTPException(503, "Configure a chave de backup no cofre e disponibilize BACKUP_ENCRYPTION_KEY_FILE ou BACKUP_ENCRYPTION_KEY")


def seal(payload):
    return {"formato": "cedronexxo-encrypted-v1", "conteudo": cipher().encrypt(json_util.dumps(payload).encode()).decode()}


def unseal(payload):
    try:
        result = json_util.loads(cipher().decrypt(payload.encode()))
        if not isinstance(result, dict): raise ValueError()
        return result
    except (InvalidToken, ValueError, TypeError):
        raise HTTPException(422, "Backup inválido, alterado ou cifrado com outra chave")
