from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class RecommendationReason(BaseModel):
    kind: Literal["content", "collaborative", "discovery", "popular", "catalog"] = Field(
        description=(
            "content: se parece a lo que el perfil vio · collaborative: lo vieron "
            "perfiles con gustos parecidos · discovery: fuera de sus gustos habituales, "
            "para variar · popular: arranque en frío, lo más visto · "
            "catalog: título que nadie ha visto todavía"
        )
    )
    basedOnTitleId: Optional[str] = Field(None, description="Título visto al que más se parece")
    similarProfiles: Optional[int] = Field(None, description="Perfiles parecidos que lo vieron")
    views: Optional[int] = Field(None, description="Perfiles distintos que lo vieron")


class RecommendationItem(BaseModel):
    titleId: str
    score: float = Field(description="Puntaje final 0–1 (α·contenido + (1−α)·colaborativo)")
    contentScore: float = Field(description="Similitud coseno perfil–título (pgvector)")
    collaborativeScore: float = Field(description="Interés ponderado de los perfiles parecidos")
    reason: RecommendationReason


class CatalogFilter(BaseModel):
    applied: bool
    region: Optional[str] = None
    isKids: bool = False
    detail: Optional[str] = None


class RecommendationResponse(BaseModel):
    profileId: str
    strategy: Literal["hybrid", "popular"] = Field(
        description="hybrid si el perfil ya tiene historial; popular en arranque en frío"
    )
    contentWeight: float = Field(description="α: peso del filtrado basado en contenido")
    generatedAt: datetime
    catalogFilter: Optional[CatalogFilter] = None
    items: list[RecommendationItem]


class SimilarTitle(BaseModel):
    titleId: str
    similarity: float


class InteractionOut(BaseModel):
    titleId: str
    strength: float
    completed: bool
    updatedAt: datetime


class SimilarProfile(BaseModel):
    profileId: str
    similarity: float


class ProfileModelResponse(BaseModel):
    profileId: str
    hasEmbedding: bool
    embeddingUpdatedAt: Optional[datetime]
    interactions: list[InteractionOut]
    similarProfiles: list[SimilarProfile]
