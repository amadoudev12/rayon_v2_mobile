import type { InventoryStatus, LossReason, PaymentMethod, SettlementState, StockMovementType } from '@/api/types';
import type { Tone } from '@/lib/theme';

/** Libellés affichés pour chaque mode de paiement (mêmes textes que le web). */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Espèces',
  CARD: 'Carte',
  MOBILE_MONEY: 'Mobile Money',
  CREDIT: 'Crédit client',
  OTHER: 'Autre',
};

export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

/** Modes par lesquels de l'argent change réellement de main (jamais « crédit »). */
export const TENDER_OPTIONS = PAYMENT_METHODS.filter((value): value is Exclude<PaymentMethod, 'CREDIT'> => value !== 'CREDIT').map((value) => ({
  value,
  label: PAYMENT_METHOD_LABELS[value],
}));

/** État financier d'une vente, calculé par le serveur (mêmes textes que le web). */
export const SETTLEMENT_LABELS: Record<SettlementState, { label: string; tone: Tone }> = {
  SOLDEE: { label: 'Soldée', tone: 'success' },
  CREANCE: { label: 'Créance en cours', tone: 'warning' },
  REMBOURSEMENT_EN_ATTENTE: { label: 'Remboursement à verser', tone: 'danger' },
};

export const CANCELLATION_LABELS: Record<string, string> = {
  REFUND: 'Annulée avec remboursement',
  ENTRY_ERROR: 'Annulée — erreur de saisie',
  LEGACY: 'Annulée (historique)',
};

/** Libellé et couleur de badge pour chaque type de mouvement de stock. */
export const MOVEMENT_LABELS: Record<StockMovementType, { label: string; tone: Tone }> = {
  PURCHASE: { label: 'Achat', tone: 'success' },
  SALE: { label: 'Vente', tone: 'danger' },
  SALE_CANCELLATION: { label: 'Vente annulée', tone: 'success' },
  ADJUSTMENT: { label: 'Ajustement', tone: 'warning' },
  INITIAL: { label: 'Stock initial', tone: 'neutral' },
  INVENTORY_ADJUSTMENT: { label: 'Ajustement inventaire', tone: 'warning' },
  LOSS: { label: 'Perte / casse', tone: 'danger' },
  LOSS_CANCELLATION: { label: 'Perte annulée', tone: 'success' },
  SALE_RETURN: { label: 'Retour client', tone: 'success' },
  PURCHASE_CANCELLATION: { label: 'Achat annulé', tone: 'danger' },
};

/** Motifs de perte, dans l'ordre proposé à la déclaration (mêmes valeurs que le serveur). */
export const LOSS_REASON_OPTIONS: { value: LossReason; label: string }[] = [
  { value: 'ENDOMMAGE', label: 'Endommagé' },
  { value: 'CASSE', label: 'Casse' },
  { value: 'PERIME', label: 'Périmé' },
  { value: 'VOL', label: 'Vol' },
  { value: 'PERDU', label: 'Perdu' },
  { value: 'DESTRUCTION', label: 'Destruction' },
  { value: 'AUTRE', label: 'Autre' },
];

export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Brouillon', tone: 'neutral' },
  IN_PROGRESS: { label: 'En cours', tone: 'warning' },
  VALIDATED: { label: 'Validé', tone: 'success' },
  CANCELLED: { label: 'Annulé', tone: 'danger' },
};
