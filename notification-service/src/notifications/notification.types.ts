export type NotificationType = 'NEW_RELEASE' | 'CONTINUE_WATCHING' | 'PAYMENT_FAILED';

export type Channel = 'email' | 'push';

/**
 * A quién va dirigida una notificación:
 *   · profile   → un perfil (p. ej. "sigue con el siguiente episodio")
 *   · account   → la cuenta completa (p. ej. "tu pago fue rechazado")
 *   · broadcast → todos los perfiles (p. ej. "nuevo estreno disponible")
 */
export interface Audience {
  scope: 'profile' | 'account' | 'broadcast';
  id?: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  audience: Audience;
  channels: Channel[];
  /** Evento que la originó (media.ready, payment.failed, playback.completed). */
  sourceEvent: string;
  data: Record<string, unknown>;
  createdAt: string;
}
