"""Tenant-scoped operational counters, without message bodies or credentials."""
from fastapi import APIRouter, Depends, HTTPException, Response
from lib.auth import Principal, principal_atual
from lib.db import db
from models.common import now_utc, utc_aware

router = APIRouter(prefix="/operacao", tags=["operacao"])

@router.get("/metricas")
async def metricas(response: Response, principal: Principal = Depends(principal_atual)):
    if not principal.is_admin:
        raise HTTPException(403, "Métricas operacionais exigem perfil de administrador")
    response.headers["Cache-Control"] = "no-store"
    queue = {state: await db.mail_jobs.count_documents({"status": state})
             for state in ("queued", "sending", "sent", "uncertain")}
    oldest = await db.mail_jobs.find_one({"status": "queued"}, {"created_at": 1}, sort=[("created_at", 1)])
    created = utc_aware((oldest or {}).get("created_at"))
    return {
        "gerado_em": now_utc(), "fila_email": queue,
        "fila_mais_antiga_segundos": max(0, int((now_utc()-created).total_seconds())) if created else 0,
        "contratos_financeiro_pendente": await db.contratos.count_documents({"financeiro_status": {"$in": ["pendente", "erro"]}}),
        "contratos_legados": await db.contratos.count_documents({"financeiro_status": {"$exists": False}}),
        "eventos_site": await db.site_events.count_documents({}),
        "titulos_pendentes": await db.transacoes.count_documents({"status": "pendente"}),
    }
