import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from lib.backups import seal, unseal

def test_key_recovery_from_mounted_secret(monkeypatch, tmp_path):
    key = Fernet.generate_key().decode()
    mount = tmp_path / 'secret'
    mount.write_text(key)
    monkeypatch.setenv('BACKUP_ENCRYPTION_KEY_FILE', str(mount))
    envelope = seal({'teste': 'homologacao'})
    mount.unlink()
    with pytest.raises(HTTPException) as e: unseal(envelope['conteudo'])
    assert e.value.status_code == 503
    mount.write_text(key)
    assert unseal(envelope['conteudo']) == {'teste': 'homologacao'}
    mount.write_text(Fernet.generate_key().decode())
    with pytest.raises(HTTPException) as e: unseal(envelope['conteudo'])
    assert e.value.status_code == 422
