---
name: nova-funcionalidade-sax
description: Checklist para criar ou mudar uma funcionalidade no SAX CRM (rota, permissão, plano, tela e teste) sem quebrar multiempresa, permissões ou o Firestore.
---

# Nova funcionalidade no SAX CRM

Siga a ordem. Leia o `CLAUDE.md` antes.

1. **Modelo** em `backend/models/<dominio>.py` (Pydantic). Campos opcionais com padrão, para não quebrar registros antigos.
2. **Rota** em `backend/routers/<dominio>.py`, registrada em `server.py`.
   - Toda rota com `Depends(require("recurso:acao"))`. Ação nova entra em `PERMISSOES` (`lib/auth.py`) para cada papel que pode usar.
   - Use `db` (banco da empresa). `controle` só para dados globais.
   - Corretor: filtre com `filtro_do_principal` e responda 404 para registro de outro corretor.
   - Funcionalidade paga: `await exigir_recurso("chave")`. Chave nova vai em `RECURSOS` (`lib/planos.py`) e depois é marcada nos planos pela tela Empresas.
3. **Firestore**: nada de `aggregate`; evite ler coleções inteiras em rota chamada com frequência; um documento não passa de 1 MiB.
4. **Tela** em `frontend/src/pages` ou `components/<dominio>`, tipos em `src/lib/types.ts`, rota em `App.tsx` e item de menu em `AppShell.tsx` se for página nova. Esconda o que o plano não libera com `usePlano().tem("chave")`.
5. **Texto**: português, curto, sem travessão, botão diz o que acontece.
6. **Teste** de ponta a ponta em `tests/` cobrindo o caminho feliz, a permissão do corretor e o erro de validação principal.
7. Rode a skill `testar-sax` e abra o pull request descrevendo o que mudou para o usuário.
