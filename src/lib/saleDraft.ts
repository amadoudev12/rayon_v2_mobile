/**
 * Vente en cours de saisie, conservée en mémoire pendant que l'application
 * est ouverte : quitter l'écran de vente (créer un client, consulter un
 * produit…) puis y revenir retrouve le panier. Une vente par boutique.
 * Les ventes « en attente », elles, sont enregistrées sur le serveur.
 */
export type DraftLine = {
  productId: number;
  name: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  maxQuantity: number;
  /** Prix négocié (vente mise en attente depuis le site) ; absent : prix du catalogue. */
  negotiatedPrice?: number;
};

export type SaleDraftState = {
  cart: DraftLine[];
  customer: { id: number; nom: string } | null;
  /** Remise et paiement repris d'une vente mise en attente. */
  remise?: number;
  modePaiement?: string;
};

const drafts = new Map<number, SaleDraftState>();

export function getSaleDraft(storeId: number): SaleDraftState | undefined {
  return drafts.get(storeId);
}

export function setSaleDraft(storeId: number, draft: SaleDraftState) {
  if (draft.cart.length === 0 && !draft.customer) drafts.delete(storeId);
  else drafts.set(storeId, draft);
}

export function clearSaleDraft(storeId: number) {
  drafts.delete(storeId);
}
