/**
 * Formes JSON renvoyées par l'API du backend (backend/src/routes/**).
 *
 * Deux particularités du format JSON par rapport aux types du serveur :
 * - les montants (Decimal en base) arrivent sous forme de chaînes → `Money` ;
 * - les dates arrivent sous forme de chaînes ISO → `IsoDate`.
 */

/** Montant décimal sérialisé (ex : "1500" ou "1500.5"). À convertir avec `Number()` pour l'affichage. */
export type Money = string | number;
export type IsoDate = string;

export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'SELLER' | 'STOCK_MANAGER';
export type PaymentMethod = 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'CREDIT' | 'OTHER';
export type SaleStatus = 'COMPLETED' | 'CANCELLED';
export type StockMovementType = 'PURCHASE' | 'SALE' | 'SALE_CANCELLATION' | 'ADJUSTMENT' | 'INITIAL' | 'INVENTORY_ADJUSTMENT' | 'LOSS' | 'LOSS_CANCELLATION' | 'SALE_RETURN';
export type InventoryStatus = 'DRAFT' | 'IN_PROGRESS' | 'VALIDATED' | 'CANCELLED';
export type InventoryLine = { id: number; produitNom: string; produitReference: string | null; categorieNom?: string | null; quantiteTheorique: number; quantiteComptee: number | null; coutUnitaire: Money; version: number };
export type Inventory = { id: number; reference: string; libelle: string; statut: InventoryStatus; boutique: { nom: string }; lignes: InventoryLine[] };
export type StockAlert = { type: 'STOCK' | 'REPEATED_LOSS'; produitId: number; produit: string; quantite: number; seuilAlerte: number; niveau: 'OUT' | 'LOW' | 'REPEATED_LOSS'; occurrences?: number };
export type StockRow = { id: number; boutiqueId: number; produitId: number; quantite: number; seuilAlerte: number; niveau: 'OUT' | 'LOW' | 'NORMAL'; produit: { nom: string } };
export type StockLoss = { id: number; reference: string; quantite: number; motif: string; statut: 'ACTIVE' | 'CANCELLED'; coutUnitaire: Money; canCancel: boolean; produit: { id: number; nom: string }; boutique: { nom: string }; creeLe: IsoDate };
export type StockValuation = { quantiteTotale: number; valeurTotale: number; methode: string };

/** Permissions calculées par le serveur (backend/src/lib/auth/permissions.ts). */
export type Permission =
  | 'org:manage'
  | 'members:manage'
  | 'store:manage'
  | 'category:manage'
  | 'product:manage'
  | 'stock:adjust'
  | 'inventory:read'
  | 'inventory:create'
  | 'inventory:count'
  | 'inventory:validate'
  | 'inventory:cancel'
  | 'loss:read'
  | 'loss:create'
  | 'loss:cancel'
  | 'stock:threshold:manage'
  | 'stock:report'
  | 'stock-movement:read'
  | 'purchase:manage'
  | 'supplier:manage'
  | 'supplier:delete'
  | 'customer:manage'
  | 'customer:delete'
  | 'sale:create'
  | 'sale:cancel'
  | 'refund:manage'
  | 'return:manage'
  | 'expense:manage'
  | 'report:view';

export type Pagination = { page: number; limit: number; total: number; totalPages: number };
export type Page<T> = { data: T[]; pagination: Pagination };

// --- Compte ------------------------------------------------------------------

export type LoginResult = { token: string; expiresAt: IsoDate };

export type StoreSummary = { id: number; nom: string; parDefaut: boolean };

/** GET /api/me */
export type AccountProfile = {
  user: { id: number; prenom: string; nom: string; email: string | null; telephone: string | null };
  organization: { id: number; nom: string; devise: string };
  role: Role;
  roleLabel: string;
  stores: StoreSummary[];
  defaultStoreId: number;
  restrictedToStore: boolean;
  permissions: Permission[];
  /** Mot de passe temporaire (réinitialisé par un responsable) à remplacer avant tout. */
  doitChangerMotDePasse: boolean;
};

// --- Tableau de bord ---------------------------------------------------------

/** GET /api/dashboard (voir backend/src/lib/services/dashboard.ts pour les règles de calcul). */
export type DashboardStats = {
  /** `month` / `previousMonth` : « AAAA-MM », à afficher tels quels (pas de conversion de fuseau). */
  period: { start: IsoDate; previousStart: IsoDate; previousEnd: IsoDate; month: string; previousMonth: string };
  revenue: number;
  previousRevenue: number;
  revenueChange: number | null;
  salesCount: number;
  averageBasket: number;
  todayRevenue: number;
  todaySalesCount: number;
  todayCollected: number;
  todayRefunded: number;
  todayNetCollected: number;
  pendingRefund: number;
  costOfGoodsSold: number | null;
  grossMargin: number | null;
  grossMarginRate: number | null;
  expensesTotal: number | null;
  netProfit: number | null;
  activeProductsCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  lowStock: {
    productId: number;
    productName: string;
    unit: string;
    storeId: number;
    storeName: string;
    quantity: number;
    alertThreshold: number;
  }[];
  topProducts: { productId: number; productName: string; unit: string; quantity: number; amount: number }[];
  trend: { day: string; value: number; count: number }[];
  recentActivity: {
    type: 'sale' | 'expense';
    id: number;
    label: string;
    subtitle: string;
    amount: number;
    cancelled: boolean;
    createdAt: IsoDate;
  }[];
};

// --- Catalogue ---------------------------------------------------------------

export type Category = { id: number; nom: string; description: string | null };

/** Élément de GET /api/products */
export type Product = {
  id: number;
  nom: string;
  description: string | null;
  reference: string | null;
  codeBarres: string | null;
  unite: string;
  prixAchat: Money | null;
  prixVente: Money;
  seuilAlerte: number;
  actif: boolean;
  categorieId: number | null;
  categorie: { id: number; nom: string } | null;
  /** Stock dans la boutique demandée. */
  quantiteStock: number;
  creeLe: IsoDate;
  modifieLe: IsoDate;
};

/** GET /api/products/[id] */
export type ProductDetails = Product & {
  stocks: { quantite: number; boutique: { id: number; nom: string } }[];
  mouvementsStock: {
    id: number;
    type: StockMovementType;
    variationQuantite: number;
    note: string | null;
    creeLe: IsoDate;
    boutique: { nom: string };
    utilisateur: { prenom: string; nom: string };
  }[];
  ventes: { nombre: number; quantite: number; montant: Money };
};

/** Corps de POST /api/products et PUT /api/products/[id] (validé par productSchema côté serveur). */
export type ProductInput = {
  nom: string;
  unite: string;
  categorieId: number | null;
  prixAchat: number;
  prixVente: number;
  seuilAlerte: number;
  /** Création uniquement. */
  quantiteInitiale?: number;
  /** Modification uniquement. */
  actif?: boolean;
};

export type StockAdjustmentInput = { variationQuantite: number; note?: string; boutiqueId: number };

// --- Ventes ------------------------------------------------------------------

export type Customer = { id: number; nom: string; telephone: string | null };

/** Élément de GET /api/sales */
export type SaleSummary = {
  id: number;
  statut: SaleStatus;
  modePaiement: PaymentMethod;
  total: Money;
  creeLe: IsoDate;
  lignes: { id: number; quantite: number; produit: { id: number; nom: string } }[];
  client: { id: number; nom: string } | null;
  vendeur: { id: number; prenom: string; nom: string };
};

/** GET /api/sales/[id] */
export type SaleDetails = {
  id: number;
  statut: SaleStatus;
  modePaiement: PaymentMethod;
  sousTotal: Money;
  remise: Money;
  total: Money;
  montantPaye: Money;
  /** Avoirs des retours, remise déduite. */
  montantRetourne: Money;
  /** Remboursements dus au client (versés ou non). */
  montantARembourser: Money;
  /** Solde dû par le client, calculé par le serveur. */
  resteAPayer: Money;
  /** Remboursements dus non encore versés. */
  remboursementEnAttente: Money;
  etatFinancier: SettlementState;
  typeAnnulation: 'REFUND' | 'ENTRY_ERROR' | 'LEGACY' | null;
  note: string | null;
  creeLe: IsoDate;
  annuleLe: IsoDate | null;
  motifAnnulation: string | null;
  lignes: {
    id: number;
    quantite: number;
    quantiteRetournee: number;
    quantiteRestante: number;
    prixUnitaire: Money;
    sousTotal: Money;
    produit: { id: number; nom: string; unite: string };
  }[];
  client: { id: number; nom: string; telephone: string | null } | null;
  vendeur: { id: number; prenom: string; nom: string };
  boutique: { id: number; nom: string };
  paiements: { id: number; montant: Money; modePaiement: PaymentMethod | null; date: IsoDate; annule: boolean; motifAnnulation: string | null; utilisateur: { prenom: string; nom: string } | null }[];
  remboursements: {
    id: number;
    montant: Money;
    montantVerse: Money;
    montantRestant: Money;
    statut: 'PENDING' | 'PARTIALLY_REFUNDED' | 'COMPLETED';
    motif: string;
    versements: { id: number; montant: Money; modePaiement: PaymentMethod; date: IsoDate; utilisateur: { prenom: string; nom: string } }[];
  }[];
  retours: {
    id: number;
    montant: Money;
    motif: string;
    creeLe: IsoDate;
    lignes: { id: number; quantite: number; montant: Money; remiseEnStock: boolean; produit: { nom: string; unite: string } }[];
  }[];
};

export type SettlementState = 'SOLDEE' | 'CREANCE' | 'REMBOURSEMENT_EN_ATTENTE';
export type Tender = Exclude<PaymentMethod, 'CREDIT'>;

export type CancelSaleInput = { motif: string; type: 'REFUND' | 'ENTRY_ERROR'; remboursementImmediat?: { modePaiement: Tender } };
export type SaleReturnInput = {
  motif: string;
  lignes: { ligneVenteId: number; quantite: number; remiseEnStock: boolean }[];
  remboursementImmediat?: { modePaiement: Tender };
};

/** Corps de POST /api/sales (validé par saleSchema côté serveur, qui fixe lui-même les prix). */
export type SaleInput = {
  lignes: { produitId: number; quantite: number }[];
  clientId?: number;
  boutiqueId: number;
  modePaiement: PaymentMethod;
  remise: number;
  montantPaye?: number;
  modePaiementAcompte?: Exclude<PaymentMethod, 'CREDIT'>;
};
