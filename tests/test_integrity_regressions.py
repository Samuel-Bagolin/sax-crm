"""Isolated regression suite: never reads tenant data or sends email."""
import os, sys, asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
os.environ['MONGO_URL'] = 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10'
os.environ['DB_NAME'] = 'isolated_no_io'
os.environ['JWT_SECRET'] = 'test-only-secret-not-for-deployment'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import pytest
from fastapi import HTTPException, Response
from pydantic import ValidationError
from lib.integrity import split_money, cents, percentage
from lib.auth import Principal, authorize
from routers import contratos, financeiro, leads, empresas
from models.contratos import Contrato, ContratoCreate
from models.financeiro import TransacaoCreate

@pytest.mark.parametrize('value,count', [(100,3),(0.01,1),(1234.56,7),(0,10),(999999.99,600)])
def test_split_preserves_every_cent(value,count):
    result=split_money(value,count)
    assert sum(map(cents,result))==cents(value)
    assert max(map(cents,result))-min(map(cents,result))<=1

def test_decimal_percentage():
    assert percentage(100.10,5)==5.01

@pytest.mark.parametrize('start,end,expected',[('2026-01-10','2028-07-10',30),('2024-01-31','2024-02-29',1),('2026-01-10','2026-02-11',2)])
def test_month_term(start,end,expected):
    assert contratos._meses_entre(start,end)==expected

@pytest.mark.parametrize('start,day,expected',[('2026-01-20',10,'2026-02-10'),('2024-02-01',31,'2024-02-29'),('2026-01-10',10,'2026-01-10')])
def test_due_never_before_start(start,day,expected):
    assert contratos._vencimento(SimpleNamespace(inicio=start,dia_vencimento=day),0)==expected

@pytest.mark.parametrize('field,value',[('valor',float('inf')),('valor',-1),('tipo','foo'),('comissao_pct',101),('inicio','2026-02-30'),('inicio','20261008'),('parcelas',601),('dia_vencimento',0)])
def test_contract_rejects_invalid_data(field,value):
    data=dict(tipo='venda',imovel_id='i',valor=100,inicio='2026-10-08')
    data[field]=value
    with pytest.raises(ValidationError): ContratoCreate(**data)

@pytest.mark.parametrize('field,value',[('valor',float('nan')),('status','whatever'),('vencimento','2026-13-01'),('tipo','receita')])
def test_transaction_validation(field,value):
    data=dict(descricao='Test',tipo='receber',valor=100,plano_conta_id='p',vencimento='2026-10-08')
    data[field]=value
    with pytest.raises(ValidationError): TransacaoCreate(**data)


def test_cross_broker_hidden():
    broker=Principal(usuario_id='u',nome='A',email='a@test.invalid',papel='corretor',pessoa_id='own')
    with pytest.raises(HTTPException) as e: authorize(broker,'visita:write',{'corretor_id':'other'})
    assert e.value.status_code==404


def test_backup_date_normalization():
    assert empresas._normalizar({'closed_at':'2026-01-01T00:00:00Z'})['closed_at'].tzinfo is not None


def test_backup_authenticated_encryption(monkeypatch):
    from cryptography.fernet import Fernet
    from lib.backups import seal, unseal
    monkeypatch.setenv('BACKUP_ENCRYPTION_KEY',Fernet.generate_key().decode())
    payload={'secret':'never plaintext', 'colecoes':{'usuarios':[]}}
    result=seal(payload)
    assert 'never plaintext' not in result['conteudo']
    assert unseal(result['conteudo'])==payload
    with pytest.raises(HTTPException): unseal(result['conteudo'][:-5]+'AAAAA')

@pytest.mark.asyncio
async def test_lead_won_no_longer_posts_finance(monkeypatch):
    fake=MagicMock()
    monkeypatch.setattr(leads,'db',fake)
    await leads._efeitos_ganho({'id':'lead'})
    assert not fake.mock_calls

@pytest.mark.asyncio
async def test_generation_retry_is_idempotent(monkeypatch):
    stored={}
    async def upsert(query,op,**kwargs):
        stored.setdefault(query['_id'],op['$setOnInsert'])
    fake=SimpleNamespace(transacoes=SimpleNamespace(update_one=upsert))
    monkeypatch.setattr(contratos,'db',fake)
    monkeypatch.setattr(contratos,'_conta_id',AsyncMock(return_value='account'))
    c=Contrato(numero='CT-test',tipo='venda',imovel_id='i',valor=2000,comissao_pct=5,parcelas=3,inicio='2026-01-20',dia_vencimento=10)
    await contratos._gerar_parcelas(c)
    await contratos._gerar_parcelas(c)
    assert len(stored)==3
    assert sum(cents(t['valor']) for t in stored.values())==10000
    assert min(t['vencimento'] for t in stored.values())>='2026-01-20'

@pytest.mark.asyncio
async def test_generation_rejects_missing_account(monkeypatch):
    monkeypatch.setattr(contratos,'_conta_id',AsyncMock(return_value=None))
    c=Contrato(numero='CT-test',tipo='venda',imovel_id='i',valor=2000,inicio='2026-01-01')
    with pytest.raises(HTTPException): await contratos._gerar_parcelas(c)

@pytest.mark.asyncio
async def test_global_email_conflict_not_overwritten(monkeypatch):
    from lib import tenant
    from pymongo.errors import DuplicateKeyError
    update=AsyncMock(side_effect=DuplicateKeyError('conflict'))
    monkeypatch.setattr(tenant,'controle',SimpleNamespace(usuarios=SimpleNamespace(find_one=AsyncMock(return_value=None)),usuarios_index=SimpleNamespace(update_one=update)))
    with pytest.raises(HTTPException) as e: await tenant.indexar_usuario('x@test.invalid','company-b','db-b')
    assert e.value.status_code==409
    assert update.call_args.args[0]['empresa_id']=='company-b'

@pytest.mark.asyncio
async def test_disabled_module_denied(monkeypatch):
    from lib import auth
    monkeypatch.setattr(auth,'db',SimpleNamespace(configuracoes=SimpleNamespace(find_one=AsyncMock(return_value={'modulos_ativos':['crm']}))))
    monkeypatch.setattr(auth,'controle',SimpleNamespace(empresas=SimpleNamespace(find_one=AsyncMock(return_value={}))))
    principal=Principal(usuario_id='u',nome='Test',email='t@test.invalid',papel='admin',empresa_id='company')
    with pytest.raises(HTTPException) as e: await auth.require_module(principal,'transacao:write')
    assert e.value.status_code==403

@pytest.mark.asyncio
async def test_paid_title_cannot_be_deleted(monkeypatch):
    monkeypatch.setattr(financeiro,'db',SimpleNamespace(transacoes=SimpleNamespace(find_one=AsyncMock(return_value={'id':'t','status':'pago'}))))
    p=Principal(usuario_id='u',nome='Test',email='t@test.invalid',papel='admin')
    with pytest.raises(HTTPException) as e: await financeiro.delete_transacao('t',p)
    assert e.value.status_code==409


def test_routes_and_openapi_import():
    from server import app
    schema=app.openapi()
    assert 'patch' in schema['paths']['/api/leads/{lead_id}']
    assert 'patch' in schema['paths']['/api/transacoes/{transacao_id}']
    assert '/api/auth/ativar' in schema['paths']


def test_production_cookie(monkeypatch):
    from lib import auth
    monkeypatch.setattr(auth,'AMBIENTE','producao')
    response=Response()
    auth.gravar_cookie(response,'test')
    assert 'Secure' in response.headers['set-cookie']
    assert 'HttpOnly' in response.headers['set-cookie']

@pytest.mark.asyncio
async def test_partial_generation_can_resume_without_duplicate(monkeypatch):
    stored={}; fail=[True]
    async def upsert(query,op,**kwargs):
        if len(stored)==1 and fail[0]:
            fail[0]=False
            raise RuntimeError('simulated interruption')
        stored.setdefault(query['_id'],op['$setOnInsert'])
    monkeypatch.setattr(contratos,'db',SimpleNamespace(transacoes=SimpleNamespace(update_one=upsert)))
    monkeypatch.setattr(contratos,'_conta_id',AsyncMock(return_value='account'))
    c=Contrato(numero='CT-retry',tipo='venda',imovel_id='i',valor=2000,comissao_pct=5,parcelas=3,inicio='2026-01-20')
    with pytest.raises(RuntimeError): await contratos._gerar_parcelas(c)
    assert len(stored)==1
    await contratos._gerar_parcelas(c)
    assert len(stored)==3
    assert sum(cents(t['valor']) for t in stored.values())==10000


def test_patch_required_null_rejected():
    from lib.validation import patch_data
    from models.financeiro import TransacaoUpdate
    with pytest.raises(HTTPException): patch_data(TransacaoUpdate(status=None),('status',))
    assert patch_data(TransacaoUpdate(pessoa_id=None),('status',))=={'pessoa_id':None}

@pytest.mark.asyncio
async def test_pagination_exposes_next_offset():
    from lib.integrity import page
    cursor=MagicMock()
    cursor.skip.return_value=cursor
    cursor.limit.return_value=cursor
    cursor.to_list=AsyncMock(return_value=[{'id':1},{'id':2},{'id':3}])
    response=Response()
    assert await page(cursor,response,0,2)==[{'id':1},{'id':2}]
    assert response.headers['X-Next-Offset']=='2'

@pytest.mark.asyncio
async def test_readonly_backup_requires_transactional_database(monkeypatch):
    fake=SimpleNamespace(admin=SimpleNamespace(command=AsyncMock(return_value={'isWritablePrimary':True})))
    monkeypatch.setattr(empresas,'client',fake)
    with pytest.raises(HTTPException) as e: await empresas._transactions_available()
    assert e.value.status_code==503

@pytest.mark.asyncio
async def test_legacy_contract_reprocessing_blocked(monkeypatch):
    p=Principal(usuario_id='u',nome='Test',email='t@test.invalid',papel='admin')
    with pytest.raises(HTTPException) as e:
        await contratos._concluir.__wrapped__({'id':'legacy','status':'ativo'},p)
    assert e.value.status_code==409
