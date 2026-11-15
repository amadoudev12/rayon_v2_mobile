/**
 * Clé d'idempotence d'une opération sensible. Elle est conservée tant que
 * l'opération n'a pas réussi : un nouvel essai après une coupure réseau
 * renvoie le résultat déjà enregistré au lieu de créer un doublon.
 */
export function newIdempotencyKey(prefix = 'op'): string {
  const random = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
