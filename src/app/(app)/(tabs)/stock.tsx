import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import {
  cancelLoss,
  createInventory,
  createLoss,
  getStockAlerts,
  getStockValuation,
  listInventories,
  listLosses,
  listProducts,
  listStock,
  setStockThreshold,
} from '@/api/endpoints';
import type { LossReason, Product, StockLoss, StockRow } from '@/api/types';
import { useAccount } from '@/auth/SessionProvider';
import { ReasonSheet } from '@/components/ReasonSheet';
import { SelectSheet } from '@/components/SelectSheet';
import { TabHeader } from '@/components/TabHeader';
import { useToast } from '@/components/Toast';
import { Badge, Banner, Button, Card, ChipGroup, EmptyState, Field, Input, SearchBar, SectionHeader, SelectField } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { newIdempotencyKey } from '@/lib/idempotency';
import { INVENTORY_STATUS_LABELS, LOSS_REASON_OPTIONS } from '@/lib/labels';
import { colors, font, spacing } from '@/lib/theme';
import { useDebouncedValue } from '@/lib/useDebouncedValue';

/** Préfixe commun des requêtes de cet écran : « tirer pour rafraîchir » les relit toutes. */
const STOCK_TAB = 'stock-tab';

/** Stock de la boutique active : inventaires, alertes, valorisation, pertes et seuils. */
export default function StockScreen() {
  const { activeStore, can } = useAccount();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: [STOCK_TAB] });
    setRefreshing(false);
  }

  return (
    <View style={styles.root}>
      <TabHeader title="Stock" subtitle={activeStore.nom} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.brand600} />}>
        {can('inventory:read') && <InventorySection />}
        {can('stock:report') && <AlertsSection />}
        {can('stock:report') && <ValuationCard />}
        {can('loss:create') && <LossForm />}
        {can('loss:read') && <LossHistory />}
        {can('stock:threshold:manage') && <ThresholdSection />}
      </ScrollView>
    </View>
  );
}

// --- Inventaires ---------------------------------------------------------------

function InventorySection() {
  const { activeStoreId, can } = useAccount();
  const queryClient = useQueryClient();
  const inventories = useQuery({ queryKey: [STOCK_TAB, 'inventories', activeStoreId], queryFn: () => listInventories(activeStoreId) });

  const start = useMutation({
    mutationFn: () => createInventory(activeStoreId, { libelle: 'Inventaire physique', selectionType: 'ALL' }),
    onSuccess: async (inventory) => {
      await queryClient.invalidateQueries({ queryKey: [STOCK_TAB, 'inventories'] });
      router.push({ pathname: '/inventories/[id]', params: { id: String(inventory.id) } });
    },
  });

  function confirmStart() {
    confirmAction({
      title: 'Démarrer un inventaire ?',
      message: 'Tous les produits actifs de la boutique seront à compter. Les quantités théoriques sont figées maintenant ; les ventes faites pendant le comptage sont prises en compte à la validation.',
      confirmLabel: 'Démarrer',
      onConfirm: () => start.mutate(),
    });
  }

  const recent = (inventories.data ?? []).slice(0, 5);

  return (
    <View style={styles.section}>
      <SectionHeader title="Inventaires" />
      {can('inventory:create') && (
        <Card style={styles.card}>
          <Text style={styles.hint}>Comptez le stock physique : chaque écart est corrigé et tracé à la validation.</Text>
          {start.isError && <Banner message={errorMessage(start.error)} />}
          <Button label="Démarrer un inventaire" icon="clipboard-outline" loading={start.isPending} onPress={confirmStart} />
        </Card>
      )}
      {inventories.isError && <Banner message={errorMessage(inventories.error)} />}
      {inventories.isSuccess && recent.length === 0 && (
        <EmptyState compact icon="clipboard-outline" title="Aucun inventaire" description="Démarrez une session quand vous êtes prêt à compter." />
      )}
      {recent.map((inventory) => {
        const status = INVENTORY_STATUS_LABELS[inventory.statut];
        return (
          <Card key={inventory.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.title}>{inventory.reference}</Text>
              <Badge label={status.label} tone={status.tone} dot />
            </View>
            <Text style={styles.hint}>
              {inventory.libelle} · {formatNumber(inventory._count.lignes)} produit(s) · {formatDateTime(inventory.creeLe)}
            </Text>
            <Button
              label={inventory.statut === 'IN_PROGRESS' ? 'Continuer le comptage' : 'Consulter'}
              variant="secondary"
              onPress={() => router.push({ pathname: '/inventories/[id]', params: { id: String(inventory.id) } })}
            />
          </Card>
        );
      })}
    </View>
  );
}

// --- Alertes et valorisation ----------------------------------------------------

function AlertsSection() {
  const { activeStoreId } = useAccount();
  const alerts = useQuery({ queryKey: [STOCK_TAB, 'alerts', activeStoreId], queryFn: () => getStockAlerts(activeStoreId) });

  return (
    <View style={styles.section}>
      <SectionHeader title="Alertes" />
      {alerts.isError && <Banner message={errorMessage(alerts.error)} />}
      {alerts.isSuccess && alerts.data.length === 0 && (
        <EmptyState compact icon="checkmark-circle-outline" title="Aucune alerte" description="Aucune rupture, stock faible ni série de pertes." />
      )}
      {alerts.data?.map((alert) => (
        <Card key={`${alert.type}-${alert.produitId}`} style={styles.alertCard}>
          <Text style={styles.title}>{alert.produit}</Text>
          <Text style={styles.hint}>
            {alert.type === 'REPEATED_LOSS'
              ? `${alert.occurrences} pertes déclarées en 30 jours · ${formatNumber(alert.quantite)} unité(s)`
              : `${alert.niveau === 'OUT' ? 'Rupture' : 'Stock faible'} · ${formatNumber(alert.quantite)} disponible(s) · seuil ${alert.seuilAlerte}`}
          </Text>
        </Card>
      ))}
    </View>
  );
}

function ValuationCard() {
  const { activeStoreId, currency } = useAccount();
  const valuation = useQuery({ queryKey: [STOCK_TAB, 'valuation', activeStoreId], queryFn: () => getStockValuation(activeStoreId) });
  if (!valuation.data) return valuation.isError ? <Banner message={errorMessage(valuation.error)} /> : null;

  return (
    <Card style={styles.card}>
      <SectionHeader title="Valeur du stock" />
      <Text style={styles.value}>{formatMoney(Number(valuation.data.valeurTotale), currency)}</Text>
      <Text style={styles.hint}>
        {formatNumber(valuation.data.quantiteTotale)} unité(s) · {formatNumber(valuation.data.produits)} produit(s). {valuation.data.methode}
      </Text>
    </Card>
  );
}

// --- Pertes ------------------------------------------------------------------------

function LossForm() {
  const { activeStoreId } = useAccount();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState<LossReason>('ENDOMMAGE');
  const [formError, setFormError] = useState<string | null>(null);
  // Même clé jusqu'au succès : un nouvel essai après une coupure ne retire jamais le stock deux fois.
  const lossKey = useRef<string | null>(null);

  const declare = useMutation({
    mutationFn: (input: { produitId: number; quantite: number; motif: LossReason }) => {
      lossKey.current ??= newIdempotencyKey('loss');
      return createLoss(activeStoreId, input, lossKey.current);
    },
    onSuccess: async (loss) => {
      lossKey.current = null;
      setProduct(null);
      setQuantity('1');
      toast(`Perte ${loss.reference} enregistrée`);
      await queryClient.invalidateQueries({ queryKey: [STOCK_TAB] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  function changeInput(apply: () => void) {
    apply();
    lossKey.current = null;
    setFormError(null);
  }

  function submit() {
    const amount = Number(quantity);
    if (!product) return setFormError('Choisissez le produit.');
    if (!Number.isInteger(amount) || amount < 1) return setFormError('Saisissez une quantité entière d’au moins 1.');
    if (amount > product.quantiteStock) return setFormError(`Stock disponible : ${product.quantiteStock} ${product.unite}.`);
    declare.mutate({ produitId: product.id, quantite: amount, motif: reason });
  }

  return (
    <Card style={styles.card}>
      <SectionHeader title="Déclarer une perte" />
      <Field label="Produit">
        <SelectField
          value={product ? `${product.nom} · stock ${product.quantiteStock}` : null}
          placeholder="Choisir un produit"
          onPress={() => setPickerOpen(true)}
        />
      </Field>
      <Field label="Quantité perdue">
        <Input keyboardType="number-pad" value={quantity} onChangeText={(value) => changeInput(() => setQuantity(value))} />
      </Field>
      <Field label="Motif">
        <ChipGroup wrap options={LOSS_REASON_OPTIONS} value={reason} onChange={(value) => changeInput(() => setReason(value))} />
      </Field>
      {(formError ?? declare.error) && <Banner message={formError ?? errorMessage(declare.error)} />}
      <Button label="Enregistrer la perte" variant="danger" loading={declare.isPending} onPress={submit} />
      <ProductPicker
        visible={pickerOpen}
        selected={product?.id}
        onClose={() => setPickerOpen(false)}
        onSelect={(next) => changeInput(() => setProduct(next))}
      />
    </Card>
  );
}

/** Recherche du produit côté serveur : le catalogue n'est jamais chargé en entier. */
function ProductPicker({
  visible,
  selected,
  onClose,
  onSelect,
}: {
  visible: boolean;
  selected: number | undefined;
  onClose: () => void;
  onSelect: (product: Product) => void;
}) {
  const { activeStoreId } = useAccount();
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim());
  const products = useQuery({
    queryKey: ['products', 'loss-picker', activeStoreId, search],
    queryFn: () => listProducts({ storeId: activeStoreId, search, status: 'active', limit: 30 }),
    enabled: visible,
  });
  const available = (products.data?.data ?? []).filter((product) => product.quantiteStock > 0);

  return (
    <SelectSheet
      visible={visible}
      title="Produit perdu ou abîmé"
      header={<SearchBar value={searchText} onChangeText={setSearchText} placeholder="Rechercher un produit" />}
      emptyLabel={products.isPending ? 'Chargement…' : 'Aucun produit en stock ne correspond.'}
      options={available.map((product) => ({
        value: product.id,
        label: product.nom,
        description: `Stock : ${product.quantiteStock} ${product.unite}`,
      }))}
      selected={selected}
      onSelect={(id) => {
        const product = available.find((candidate) => candidate.id === id);
        if (product) onSelect(product);
      }}
      onClose={onClose}
    />
  );
}

function LossHistory() {
  const { activeStoreId, currency } = useAccount();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [cancelling, setCancelling] = useState<StockLoss | null>(null);
  const losses = useQuery({ queryKey: [STOCK_TAB, 'losses', activeStoreId], queryFn: () => listLosses(activeStoreId) });

  async function cancel(reason: string) {
    if (!cancelling) return;
    try {
      await cancelLoss(cancelling.id, reason);
    } catch (cause) {
      throw new Error(errorMessage(cause));
    }
    toast(`Perte ${cancelling.reference} annulée`);
    await queryClient.invalidateQueries({ queryKey: [STOCK_TAB] });
    await queryClient.invalidateQueries({ queryKey: ['products'] });
  }

  const rows = losses.data?.data ?? [];

  return (
    <View style={styles.section}>
      <SectionHeader title="Dernières pertes" />
      {losses.isError && <Banner message={errorMessage(losses.error)} />}
      {losses.isSuccess && rows.length === 0 && <EmptyState compact icon="alert-circle-outline" title="Aucune perte déclarée" />}
      {rows.map((loss) => (
        <Card key={loss.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.title}>{loss.produit.nom}</Text>
            <Badge label={loss.statut === 'ACTIVE' ? 'Active' : 'Annulée'} tone={loss.statut === 'ACTIVE' ? 'danger' : 'neutral'} dot />
          </View>
          <Text style={styles.hint}>
            {loss.reference} · {loss.quantite} {loss.produit.unite} · {loss.motifLibelle} · {formatMoney(Number(loss.valeur), currency)}
          </Text>
          <Text style={styles.hint}>{formatDateTime(loss.creeLe)}</Text>
          {loss.statut === 'CANCELLED' && loss.motifAnnulation && <Text style={styles.hint}>Annulée : {loss.motifAnnulation}</Text>}
          {loss.absorbeeParInventaire && <Text style={styles.hint}>Prise en compte par un inventaire : plus annulable.</Text>}
          {loss.canCancel && <Button label="Annuler et restituer le stock" variant="secondary" onPress={() => setCancelling(loss)} />}
        </Card>
      ))}
      <ReasonSheet
        visible={Boolean(cancelling)}
        title="Annuler cette perte ?"
        message={`Le stock de ${cancelling?.produit.nom ?? ''} sera recrédité de ${cancelling?.quantite ?? 0}. L’annulation est tracée.`}
        confirmLabel="Annuler la perte"
        placeholder="Produit retrouvé, erreur de saisie…"
        onClose={() => setCancelling(null)}
        onConfirm={cancel}
      />
    </View>
  );
}

// --- Seuils d'alerte ------------------------------------------------------------------

function ThresholdSection() {
  const { activeStoreId } = useAccount();
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim());
  const stock = useQuery({
    queryKey: [STOCK_TAB, 'thresholds', activeStoreId, search],
    queryFn: () => listStock(activeStoreId, { search, limit: 20 }),
  });

  return (
    <View style={styles.section}>
      <SectionHeader title="Seuils d’alerte" />
      <SearchBar value={searchText} onChangeText={setSearchText} placeholder="Rechercher un produit" />
      {stock.isError && <Banner message={errorMessage(stock.error)} />}
      {stock.data?.data.map((row) => <ThresholdRow key={row.id} row={row} />)}
      {(stock.data?.pagination.total ?? 0) > (stock.data?.data.length ?? 0) && (
        <Text style={styles.hint}>Affinez la recherche pour trouver les autres produits.</Text>
      )}
    </View>
  );
}

function ThresholdRow({ row }: { row: StockRow }) {
  const { activeStoreId } = useAccount();
  const toast = useToast();
  const [value, setValue] = useState(String(row.seuilAlerte));
  const amount = Number(value);
  const valid = value !== '' && Number.isInteger(amount) && amount >= 0 && amount <= 1_000_000;

  const save = useMutation({
    mutationFn: () => setStockThreshold(activeStoreId, { produitId: row.produitId, seuilAlerte: amount }),
    onSuccess: () => toast(`Seuil de ${row.produit.nom} : ${amount}`),
  });

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>
        {row.produit.nom} · stock {formatNumber(row.quantite)} {row.produit.unite}
      </Text>
      <View style={styles.countRow}>
        <Input
          accessibilityLabel={`Seuil d’alerte de ${row.produit.nom}`}
          keyboardType="number-pad"
          value={value}
          onChangeText={setValue}
          invalid={!valid}
          style={{ flex: 1 }}
        />
        <Button label="Enregistrer" variant="secondary" disabled={!valid} loading={save.isPending} onPress={() => save.mutate()} />
      </View>
      {save.isError && <Banner message={errorMessage(save.error)} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  section: { gap: spacing.sm },
  card: { padding: spacing.lg, gap: spacing.md },
  alertCard: { padding: spacing.md, gap: spacing.xs, borderColor: colors.warningBorder },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  countRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  title: { color: colors.text, fontSize: font.md, fontWeight: '600', flexShrink: 1 },
  value: { color: colors.text, fontSize: 21, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: font.sm, lineHeight: 19 },
});
