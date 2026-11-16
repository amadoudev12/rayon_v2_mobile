import { request, requestData } from './client';
import type {
  AccountProfile,
  Category,
  Customer,
  DashboardStats,
  LoginResult,
  Page,
  Product,
  ProductDetails,
  ProductInput,
  SaleDetails,
  SaleInput,
  CancelSaleInput,
  SaleReturnInput,
  SaleSummary,
  StockAdjustmentInput,
  PaymentMethod,
  Inventory,
  StockAlert,
  StockLoss,
  StockValuation,
  StockRow,
} from './types';

/**
 * Une fonction par route de l'API utilisée par le mobile. Aucune règle métier
 * ici : prix, totaux, stock et permissions sont décidés par le serveur.
 */

// --- Compte ------------------------------------------------------------------

export function login(identifiant: string, motDePasse: string) {
  return requestData<LoginResult>('/api/mobile/auth/login', {
    method: 'POST',
    body: { identifiant, motDePasse },
    authenticated: false,
  });
}

/** Déconnexion réelle : la session est révoquée côté serveur. */
export function logout() {
  return request<{ message: string }>('/api/auth/logout', { method: 'POST' });
}

/** Remplace le mot de passe ; les autres appareils sont déconnectés par le serveur. */
export function changePassword(motDePasseActuel: string, nouveauMotDePasse: string) {
  return request<{ message: string }>('/api/account/password', { method: 'POST', body: { motDePasseActuel, nouveauMotDePasse } });
}

/** `token` : pour vérifier un jeton tout juste reçu, avant de l'adopter comme session. */
export function getProfile(token?: string) {
  return requestData<AccountProfile>('/api/me', { token });
}

// --- Tableau de bord ---------------------------------------------------------

export function getDashboard(storeId: number) {
  return requestData<DashboardStats>('/api/dashboard', { query: { storeId } });
}

// --- Produits ----------------------------------------------------------------

export type ProductStatusFilter = 'all' | 'active' | 'archived';

export function listProducts(params: {
  storeId: number;
  search?: string;
  status?: ProductStatusFilter;
  page?: number;
  limit?: number;
  sort?: 'creeLe' | 'nom' | 'prixVente';
  order?: 'asc' | 'desc';
}) {
  const { status, ...query } = params;
  return request<Page<Product>>('/api/products', {
    query: { ...query, status: status === 'all' ? undefined : status },
  });
}

export function getProduct(productId: number, storeId: number) {
  return requestData<ProductDetails>(`/api/products/${productId}`, { query: { storeId } });
}

/** `storeId` : boutique qui reçoit le stock initial. */
export function createProduct(input: ProductInput, storeId: number) {
  return requestData<Product>('/api/products', { method: 'POST', body: input, query: { storeId } });
}

export function updateProduct(productId: number, input: ProductInput) {
  return requestData<Product>(`/api/products/${productId}`, { method: 'PUT', body: input });
}

export function adjustStock(productId: number, input: StockAdjustmentInput) {
  return requestData<{ quantite: number }>(`/api/products/${productId}/stock`, { method: 'POST', body: input });
}

// --- Inventaire & alertes ----------------------------------------------------

export function listInventories() { return requestData<Inventory[]>('/api/inventories'); }
export function getInventory(id: number) { return requestData<Inventory>(`/api/inventories/${id}`); }
export function createInventory(input: { boutiqueId: number; libelle: string; selectionType: 'ALL' }) { return requestData<Inventory>('/api/inventories', { method: 'POST', body: input }); }
export function countInventoryLine(inventoryId: number, lineId: number, quantiteComptee: number, version: number) { return requestData(`/api/inventories/${inventoryId}/lines/${lineId}/count`, { method: 'PUT', body: { quantiteComptee, version } }); }
export function validateInventory(inventoryId: number) { return requestData<Inventory>(`/api/inventories/${inventoryId}/validate`, { method: 'POST', body: {} }); }
export function getStockAlerts(storeId: number) { return requestData<StockAlert[]>('/api/stock/alerts', { query: { storeId } }); }
export function listStock(storeId: number) { return request<Page<StockRow>>('/api/stock', { query: { storeId, limit: 100 } }); }
export function createLoss(input: { boutiqueId: number; produitId: number; quantite: number; motif: string }, idempotencyKey: string) { return requestData('/api/losses', { method: 'POST', body: input, idempotencyKey }); }
export function listLosses() { return requestData<StockLoss[]>('/api/losses'); }
export function cancelLoss(id: number, motif: string) { return requestData<StockLoss>(`/api/losses/${id}/cancel`, { method: 'POST', body: { motif } }); }
export function getStockValuation(storeId: number) { return requestData<StockValuation>('/api/stock/valuation', { query: { storeId } }); }
export function setStockThreshold(input: { boutiqueId: number; produitId: number; seuilAlerte: number }) { return requestData('/api/stock/threshold', { method: 'PUT', body: input }); }

export function listCategories() {
  return requestData<Category[]>('/api/categories');
}

export function createCategory(nom: string) {
  return requestData<Category>('/api/categories', { method: 'POST', body: { nom } });
}

// --- Ventes ------------------------------------------------------------------

export function listSales(params: { storeId: number; search?: string; page?: number; limit?: number }) {
  return request<Page<SaleSummary>>('/api/sales', { query: params });
}

export function getSale(saleId: number) {
  return requestData<SaleDetails>(`/api/sales/${saleId}`);
}

export function createSale(input: SaleInput, idempotencyKey: string) {
  return requestData<{ id: number }>('/api/sales', { method: 'POST', body: input, idempotencyKey });
}

/** Annulation idempotente : la même clé rejouée après une coupure ne fait rien de plus. */
export function cancelSale(saleId: number, input: CancelSaleInput, idempotencyKey: string) {
  return requestData<SaleDetails>(`/api/sales/${saleId}/cancel`, { method: 'POST', body: input, idempotencyKey });
}

/** Retour d'articles : avoir, remise en stock éventuelle, remboursement de l'excédent payé. */
export function createSaleReturn(saleId: number, input: SaleReturnInput, idempotencyKey: string) {
  return requestData<SaleDetails>(`/api/sales/${saleId}/returns`, { method: 'POST', body: input, idempotencyKey });
}

export function payRefund(refundId: number, montant: number, modePaiement: Exclude<PaymentMethod, 'CREDIT'>, idempotencyKey: string) {
  return requestData(`/api/sales/refunds/${refundId}/payouts`, { method: 'POST', body: { montant, modePaiement }, idempotencyKey });
}

export function addSalePayment(saleId: number, montant: number, modePaiement: Exclude<PaymentMethod, 'CREDIT'>, idempotencyKey: string) {
  return requestData(`/api/sales/${saleId}/payments`, { method: 'POST', body: { montant, modePaiement }, idempotencyKey });
}

export function listCustomers(params: { search?: string; limit?: number } = {}) {
  return request<Page<Customer>>('/api/customers', { query: params });
}

export function createCustomer(nom: string) {
  return requestData<Customer>('/api/customers', { method: 'POST', body: { nom } });
}

// --- Ventes en attente -------------------------------------------------------

export type HeldSale = {
  id: number;
  libelle: string;
  nombreArticles: number;
  totalEstime: string | number;
  creeLe: string;
  client: { id: number; nom: string } | null;
  creePar: { prenom: string; nom: string };
};

export type HeldCart = {
  lignes: { produitId: number; quantite: number; prixUnitaire?: number }[];
  clientId?: number | null;
  modePaiement?: string;
  remise?: number;
};

export function listHeldSales(storeId: number) {
  return requestData<HeldSale[]>('/api/held-sales', { query: { storeId } });
}

export function holdSale(storeId: number, panier: HeldCart, libelle?: string) {
  return requestData<HeldSale>('/api/held-sales', { method: 'POST', query: { storeId }, body: { panier, libelle } });
}

/** Reprise atomique : la vente quitte la liste ; un seul appareil peut la reprendre. */
export function resumeHeldSale(id: number, storeId: number) {
  return requestData<{ libelle: string; panier: HeldCart }>(`/api/held-sales/${id}/resume`, { method: 'POST', query: { storeId }, body: {} });
}

export function deleteHeldSale(id: number, storeId: number) {
  return request<{ message: string }>(`/api/held-sales/${id}`, { method: 'DELETE', query: { storeId } });
}
