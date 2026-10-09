"""In-memory recovery lifecycle; no customer DB and no email."""
import os, sys, hashlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
os.environ['MONGO_URL']='mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10'
os.environ['DB_NAME']='isolated_no_io'
os.environ['JWT_SECRET']='test-only-secret'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import pytest
from fastapi import Response, HTTPException
from routers import auth
from lib.auth import conferir_senha

class EmptyCompanies:
    def find(self,*args): return self
    def __aiter__(self): return self
    async def __anext__(self): raise StopAsyncIteration

@pytest.mark.asyncio
async def test_recovery_saves_new_hash_and_consumes_token(monkeypatch):
    token='synthetic-only-recovery-token-123456789'
    state={'activation_digest':hashlib.sha256(token.encode()).hexdigest(),'session_version':4}
    async def find(query,*args):
        return {'id':'synthetic-user'} if query['activation_digest']==state.get('activation_digest') else None
    async def update(query,operation):
        if query['activation_digest']!=state.get('activation_digest'): return SimpleNamespace(modified_count=0)
        state.update(operation['$set']); state['session_version']+=operation['$inc']['session_version']
        for field in operation['$unset']: state.pop(field,None)
        return SimpleNamespace(modified_count=1)
    bank=SimpleNamespace(usuarios=SimpleNamespace(find_one=find,update_one=update),empresas=EmptyCompanies())
    monkeypatch.setattr(auth,'controle',bank)
    data=auth.ActivationInput(token=token,senha='Synthetic-New-Password-123!')
    assert await auth.activate(data,Response()) is None
    assert conferir_senha(data.senha,state['senha_hash'])
    assert not conferir_senha('Synthetic-Old-Password',state['senha_hash'])
    assert state['session_version']==5
    assert state['activation_required'] is False
    with pytest.raises(HTTPException) as error: await auth.activate(data,Response())
    assert error.value.status_code==400
