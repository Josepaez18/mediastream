import { Injectable, Logger } from '@nestjs/common';
import { catalogBaseUrl } from '../public-urls';

export interface CatalogEpisode {
  id: string;
  episodeNumber: number;
}

export interface CatalogTitle {
  id: string;
  name: string;
  type: 'MOVIE' | 'SERIES';
  seasons?: { seasonNumber: number; episodes: CatalogEpisode[] }[];
}

export interface NextEpisode {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
}

/**
 * Siguiente episodio después de `episodeId`, recorriendo las temporadas en
 * orden. null si es el último o si el episodio no pertenece al título.
 */
export function findNextEpisode(title: CatalogTitle, episodeId: string): NextEpisode | null {
  const ordered = [...(title.seasons ?? [])]
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .flatMap((season) =>
      [...season.episodes]
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .map((ep) => ({ id: String(ep.id), seasonNumber: season.seasonNumber, episodeNumber: ep.episodeNumber })),
    );
  const index = ordered.findIndex((ep) => ep.id === String(episodeId));
  return index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
}

/**
 * Consulta síncrona (REST) a Catalog-Service, solo para enriquecer el texto de
 * los avisos con el nombre del título. Tiene timeout (sección 4.5) y nunca
 * lanza: si Catalog está caído, la notificación sale igual con un texto
 * genérico ("Título #3"). Un aviso un poco menos bonito es mejor que ninguno.
 */
@Injectable()
export class CatalogClient {
  private readonly logger = new Logger(CatalogClient.name);
  private readonly timeoutMs = parseInt(process.env.CATALOG_TIMEOUT_MS ?? '2000', 10);

  async getTitle(titleId: string): Promise<CatalogTitle | null> {
    try {
      const res = await fetch(`${catalogBaseUrl()}/api/catalog/titles/${encodeURIComponent(titleId)}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        this.logger.warn(`Catalog respondió ${res.status} para el título ${titleId}`);
        return null;
      }
      return (await res.json()) as CatalogTitle;
    } catch (err) {
      this.logger.warn(`No se pudo consultar el título ${titleId} en Catalog: ${(err as Error).message}`);
      return null;
    }
  }
}
