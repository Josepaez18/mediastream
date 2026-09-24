from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import ProfileModelResponse, RecommendationResponse, SimilarTitle
from app.services import recommender
from app.services.catalog_client import CatalogUnavailable, catalog_client

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


@router.get(
    "/titles/{title_id}/similar",
    response_model=list[SimilarTitle],
    summary="Títulos parecidos a uno dado (similitud de contenido con pgvector).",
)
def similar(title_id: int, limit: int = Query(8, ge=1, le=50), db: Session = Depends(get_db)):
    items = recommender.similar_titles(db, title_id, limit)
    if items is None:
        raise HTTPException(
            status_code=404,
            detail=f"El título {title_id} todavía no tiene embedding (no se ha sincronizado desde Catalog)",
        )
    return items


@router.get(
    "/{profile_id}",
    response_model=RecommendationResponse,
    summary="Permite consultar las sugerencias personalizadas de un perfil.",
)
def recommendations(
    profile_id: int,
    limit: int = Query(10, ge=1, le=50),
    region: Optional[str] = Query(
        None, description="Si se indica, solo títulos con licencia vigente en esa región (lo decide Catalog)"
    ),
    isKids: bool = Query(False, description="Solo títulos aptos para perfil infantil (lo decide Catalog)"),
    db: Session = Depends(get_db),
):
    """
    Endpoint del documento de arquitectura. Si se pasa `region` (y/o
    `isKids`), se le pregunta a Catalog-Service qué títulos puede ver ese
    perfil y solo se recomienda dentro de ese conjunto: Catalog es el dueño
    de la disponibilidad regional y del control parental.

    Si Catalog no responde, se recomienda igual (sin ese filtro) y se
    indica en `catalogFilter.applied = false`. Las recomendaciones nunca
    dependen de que otro servicio esté vivo.
    """
    allowed = None
    catalog_filter = None
    if region or isKids:
        region_value = (region or "GLOBAL").strip().upper()
        try:
            allowed = {int(t["id"]) for t in catalog_client.list_titles(region_value, isKids)}
            catalog_filter = {"applied": True, "region": region_value, "isKids": isKids}
        except CatalogUnavailable:
            catalog_filter = {
                "applied": False,
                "region": region_value,
                "isKids": isKids,
                "detail": "Catalog-Service no responde: se recomienda sin filtrar por región ni control parental",
            }

    result = recommender.recommend(db, profile_id, limit, allowed)
    result["catalogFilter"] = catalog_filter
    return result


@router.get(
    "/{profile_id}/profile",
    response_model=ProfileModelResponse,
    summary="Estado del modelo de un perfil: historial, vector y perfiles parecidos.",
)
def profile_model(profile_id: int, db: Session = Depends(get_db)):
    return recommender.profile_snapshot(db, profile_id)
