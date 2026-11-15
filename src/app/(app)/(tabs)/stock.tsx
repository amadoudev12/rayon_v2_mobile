import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { cancelLoss as cancelStockLoss, createInventory, createLoss, getStockAlerts, getStockValuation, listInventories, listLosses, listProducts, listStock, setStockThreshold } from '@/api/endpoints';
import type { Inventory, Product, StockAlert, StockLoss, StockRow, StockValuation } from '@/api/types';
import { useAccount } from '@/auth/SessionProvider';
import { TabHeader } from '@/components/TabHeader';
import { SelectSheet } from '@/components/SelectSheet';
import { Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, SectionHeader, SelectField } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { colors, spacing } from '@/lib/theme';

export default function StockScreen() {
  const { activeStore, can } = useAccount();
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [losses, setLosses] = useState<StockLoss[]>([]);
  const [valuation, setValuation] = useState<StockValuation | null>(null);
  const [thresholdValues, setThresholdValues] = useState<Record<number, string>>({});
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('ENDOMMAGE');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [alertRows, inventoryRows, productPage, lossRows, valuationData, stockPage] = await Promise.all([
        can('stock:report') ? getStockAlerts(activeStore.id) : Promise.resolve([]),
        can('inventory:read') ? listInventories() : Promise.resolve([]),
        can('loss:create') ? listProducts({ storeId: activeStore.id, status: 'active', limit: 100 }) : Promise.resolve({ data: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } }),
        can('loss:read') ? listLosses() : Promise.resolve([]),
        can('stock:report') ? getStockValuation(activeStore.id) : Promise.resolve(null),
        can('stock:threshold:manage') ? listStock(activeStore.id) : Promise.resolve({ data: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } }),
      ]);
      setAlerts(alertRows); setInventories(inventoryRows); setProducts(productPage.data); setLosses(lossRows); setValuation(valuationData); setStockRows(stockPage.data); setThresholdValues(Object.fromEntries(stockPage.data.map((row) => [row.produitId, String(row.seuilAlerte)])));
    } catch (cause) { setError(errorMessage(cause, 'Impossible de charger le stock.')); }
    finally { setLoading(false); setRefreshing(false); }
  }, [activeStore.id, can]);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  async function startInventory() {
    setBusy(true); setError('');
    try { const inventory = await createInventory({ boutiqueId: activeStore.id, libelle: 'Inventaire physique', selectionType: 'ALL' }); router.push({ pathname: '/inventories/[id]', params: { id: String(inventory.id) } } as unknown as Href); }
    catch (cause) { setError(errorMessage(cause, 'Impossible de démarrer l’inventaire.')); }
    finally { setBusy(false); }
  }

  async function declareLoss() {
    const selectedId = Number(productId);
    if (!selectedId || !Number.isInteger(Number(quantity)) || Number(quantity) < 1) { setError('Choisissez un produit et une quantité valide.'); return; }
    setBusy(true); setError('');
    try { await createLoss({ boutiqueId: activeStore.id, produitId: selectedId, quantite: Number(quantity), motif: reason }, `mobile-loss-${Date.now()}-${Math.random().toString(36).slice(2)}`); setProductId(''); setQuantity('1'); await refresh(); }
    catch (cause) { setError(errorMessage(cause, 'Impossible de déclarer cette perte.')); }
    finally { setBusy(false); }
  }

  async function saveThreshold(row: Pick<StockAlert, 'produitId' | 'produit' | 'quantite' | 'seuilAlerte'>) { const rawThreshold = thresholdValues[row.produitId]; if (rawThreshold === '' || !Number.isInteger(Number(rawThreshold)) || Number(rawThreshold) < 0) { setError('Le seuil doit être un entier positif ou nul.'); return; } setBusy(true); setError(''); try { await setStockThreshold({ boutiqueId: activeStore.id, produitId: row.produitId, seuilAlerte: Number(rawThreshold) }); await refresh(); } catch (cause) { setError(errorMessage(cause, 'Impossible de modifier le seuil.')); } finally { setBusy(false); } }

  function cancelLoss(row: StockLoss) { confirmAction({ title: 'Annuler cette perte ?', message: `Le stock de ${row.produit.nom} sera crédité de ${row.quantite} unité(s). Une correction sera ajoutée à l’historique.`, confirmLabel: 'Annuler la perte', destructive: true, onConfirm: async () => { setBusy(true); try { await cancelStockLoss(row.id, 'Annulation demandée depuis mobile'); await refresh(); } catch (cause) { setError(errorMessage(cause, 'Impossible d’annuler cette perte.')); } finally { setBusy(false); } } }); }

  if (loading) return <View style={styles.root}><TabHeader title="Stock" /><LoadingState label="Chargement des données de stock…" /></View>;
  if (error && !alerts.length && !inventories.length && !products.length) return <View style={styles.root}><TabHeader title="Stock" /><ErrorState message={error} onRetry={() => void refresh()} /></View>;
  return <View style={styles.root}>
    <TabHeader title="Stock" />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void refresh(); }} tintColor={colors.brand600} />}>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {can('inventory:create') && <Card style={styles.card}><SectionHeader title="Inventaire physique" /><Text style={styles.hint}>Créez une session avec les quantités théoriques figées. Les produits doivent être comptés avant validation.</Text><Button label="Démarrer un inventaire" icon="clipboard-outline" loading={busy} onPress={() => void startInventory()} /></Card>}
      {can('inventory:read') && <><SectionHeader title="Sessions récentes" />{inventories.length ? inventories.slice(0, 8).map((item) => <Card key={item.id} style={styles.card}><Text style={styles.title}>{item.reference} · {item.libelle}</Text><Text style={styles.hint}>{item.boutique.nom} · {item.statut}</Text><Button label="Ouvrir le comptage" variant="secondary" onPress={() => router.push({ pathname: '/inventories/[id]', params: { id: String(item.id) } } as unknown as Href)} /></Card>) : <EmptyState icon="clipboard-outline" title="Aucun inventaire" description="Démarrez une session quand vous êtes prêt à compter." compact />}</>}
      {can('stock:report') && <><SectionHeader title="Alertes de stock" />{alerts.length ? alerts.map((row) => <Card key={`${row.type}-${row.produitId}`} style={styles.alertCard}><Text style={styles.title}>{row.produit}</Text><Text style={styles.hint}>{row.niveau === 'OUT' ? 'Rupture' : row.niveau === 'LOW' ? 'Stock faible' : `${row.occurrences ?? 0} pertes actives sur 30 jours`} · {row.quantite} disponible(s) · seuil {row.seuilAlerte}</Text></Card>) : <EmptyState icon="checkmark-circle-outline" title="Aucune alerte" description="Aucune rupture, stock faible ou série de pertes détectée." compact />}</>}
      {can('stock:threshold:manage') && <><SectionHeader title="Seuils de réapprovisionnement" />{stockRows.map((row) => <Card key={`threshold-${row.produitId}`} style={styles.card}><Text style={styles.title}>{row.produit.nom} · stock {row.quantite}</Text><View style={styles.countRow}><Input accessibilityLabel={`Seuil ${row.produit.nom}`} keyboardType="number-pad" value={thresholdValues[row.produitId] ?? ''} onChangeText={(value) => setThresholdValues((old) => ({ ...old, [row.produitId]: value }))} /><Button label="Enregistrer" variant="secondary" loading={busy} onPress={() => void saveThreshold({ produitId: row.produitId, produit: row.produit.nom, quantite: row.quantite, seuilAlerte: Number(thresholdValues[row.produitId]) })} /></View></Card>)}</>}
      {can('stock:report') && valuation && <Card style={styles.card}><SectionHeader title="Valorisation courante" /><Text style={styles.value}>{valuation.valeurTotale.toLocaleString('fr-FR')} · {valuation.quantiteTotale} unité(s)</Text><Text style={styles.hint}>{valuation.methode}</Text></Card>}
      {can('loss:create') && <Card style={styles.card}><SectionHeader title="Déclarer une perte" /><Field label="Produit"><SelectField value={products.find((product) => String(product.id) === productId)?.nom} placeholder="Choisir un produit" onPress={() => setProductPickerOpen(true)} /></Field><Field label="Quantité"><Input keyboardType="number-pad" value={quantity} onChangeText={setQuantity} /></Field><Field label="Motif"><Input value={reason} onChangeText={setReason} placeholder="ENDOMMAGE, CASSE, PERIME…" /></Field><Button label="Enregistrer la perte" variant="danger" loading={busy} onPress={() => void declareLoss()} /></Card>}
      {can('loss:read') && <><SectionHeader title="Historique des pertes" />{losses.length ? losses.slice(0, 20).map((loss) => <Card key={loss.id} style={styles.card}><Text style={styles.title}>{loss.reference} · {loss.produit.nom}</Text><Text style={styles.hint}>{loss.quantite} unité(s) · {loss.motif} · {loss.statut}</Text>{loss.statut === 'ACTIVE' && loss.canCancel && <Button label="Annuler et restituer le stock" variant="secondary" onPress={() => cancelLoss(loss)} />}</Card>) : <EmptyState icon="alert-circle-outline" title="Aucune perte déclarée" compact />}</>}
      <SelectSheet visible={productPickerOpen} title="Choisir le produit" options={products.map((product) => ({ value: product.id, label: product.nom, description: `Stock : ${product.quantiteStock} ${product.unite}` }))} selected={Number(productId) || undefined} onSelect={(value) => setProductId(String(value))} onClose={() => setProductPickerOpen(false)} />
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.canvas }, content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md }, card: { padding: spacing.lg, gap: spacing.md }, alertCard: { padding: spacing.md, gap: spacing.xs, borderColor: colors.warningBorder }, title: { color: colors.text, fontSize: 15, fontWeight: '600' }, value: { color: colors.text, fontSize: 21, fontWeight: '700' }, hint: { color: colors.textMuted, fontSize: 13, lineHeight: 19 }, error: { color: colors.danger, backgroundColor: colors.dangerBg, padding: spacing.md, borderRadius: 10 }, countRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' } });

