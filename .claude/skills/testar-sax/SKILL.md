---
name: testar-sax
description: Roda a verificação completa do SAX CRM (testes do backend, checagem de tipos e build do frontend) antes de abrir um pull request ou quando pedirem para testar.
---

# Testar o SAX CRM

1. Suba a API local com dados de demonstração, em segundo plano:
   `cd backend && uvicorn dev_local:app --port 8001` (espere `/api/status` responder `"status":"ok"`).
2. Rode todos os testes com as credenciais de demonstração:
   ```bash
   cd backend
   CRM_ADMIN=admin@imobierp.com CRM_ADMIN_SENHA=admin123 \
   CRM_CORRETOR=rafael@imobierp.com CRM_CORRETOR_SENHA=corretor123 \
   CRM_SYSADMIN=root@cedronexxo.com CRM_SYSADMIN_SENHA=root12345 \
   python -m pytest ../tests -q
   ```
3. Frontend: `cd frontend && node_modules/.bin/tsc --noEmit -p . && yarn build`.
4. Procure travessão nos textos novos da interface: `git diff -U0 | grep '^+' | grep '—'` não deve achar nada em arquivos `.tsx` ou em mensagens de erro do backend.
5. Resuma para a pessoa: quantos testes passaram, o que falhou e por quê. Não diga que está pronto se algo falhou.
