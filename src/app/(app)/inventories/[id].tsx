import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { countInventoryLine, getInventory, validateInventory } from '@/api/endpoints';
import type { Inventory, InventoryLine } from '@/api/types';
import { useAccount } from '@/auth/SessionProvider';
import { useToast } from '@/components/Toast';
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, SearchBar } from '@/components/ui';
import { colors, spacing } from '@/lib/theme';

export default function InventoryCountScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Number(rawId);
  const { can } = useAccount(); const toast = useToast();
  const [inventory, setInventory] = useState<Inventory | null>(null); const [values, setValues] = useState<Record<number, string>>({}); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const refresh = useCallback(async () => { setError(''); try { const result = await getInventory(id); setInventory(result); setValues(Object.fromEntries(result.lignes.map((line) => [line.id, line.quantiteComptee === null ? '' : String(line.quantiteComptee)]))); } catch (cause) { setError(errorMessage(cause, 'Impossible de charger cet inventaire.')); } finally { setLoading(false); setRefreshing(false); } }, [id]);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  async function save(line: InventoryLine) { const value = values[line.id]; if (value === '' || Number(value) < 0 || !Number.isInteger(Number(value))) return; setBusy(true); try { await countInventoryLine(id, line.id, Number(value), line.version); await refresh(); } catch (cause) { const message = errorMessage(cause, 'Comptage non enregistré.'); setError(message); toast(message, 'error'); } finally { setBusy(false); } }
  async function validate() { setBusy(true); try { await validateInventory(id); await refresh(); toast('Inventaire validé.', 'success'); } catch (cause) { const message = errorMessage(cause, 'Validation impossible.'); setError(message); toast(message, 'error'); } finally { setBusy(false); } }
  if (loading) return <LoadingState label="Chargement de l’inventaire…" />;
  if (error && !inventory) return <ErrorState message={error} onRetry={() => void refresh()} />;
  if (!inventory) return <EmptyState icon="alert-circle-outline" title="Inventaire introuvable" />;
  const counted = inventory.lignes.filter((line) => line.quantiteComptee !== null).length;
  return <View style={styles.root}><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void refresh(); }} tintColor={colors.brand600} />}>
    <Card style={styles.card}><Text style={styles.title}>{inventory.reference}</Text><Text style={styles.hint}>{inventory.boutique.nom} · {inventory.statut} · {counted}/{inventory.lignes.length} comptés</Text>{inventory.statut === 'IN_PROGRESS' && can('inventory:validate') && <Button label="Valider l’inventaire" loading={busy} disabled={counted !== inventory.lignes.length} onPress={() => void validate()} />}</Card>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <SearchBar value={search} onChangeText={setSearch} placeholder="Rechercher un produit" />
    {inventory.lignes.filter((line) => !search || line.produitNom.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || line.produitReference?.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((line) => { const delta = line.quantiteComptee === null ? null : line.quantiteComptee - line.quantiteTheorique; return <Card key={line.id} style={styles.card}><Text style={styles.title}>{line.produitNom}</Text><Text style={styles.hint}>{line.categorieNom ? `${line.categorieNom} · ` : ''}Théorique : {line.quantiteTheorique}{delta === null ? ' · Non compté' : ` · Écart : ${delta > 0 ? '+' : ''}${delta}`}</Text><View style={styles.countRow}><Input accessibilityLabel={`Quantité comptée ${line.produitNom}`} keyboardType="number-pad" editable={inventory.statut === 'IN_PROGRESS' && can('inventory:count')} value={values[line.id] ?? ''} onChangeText={(value) => setValues((old) => ({ ...old, [line.id]: value }))} placeholder="Quantité physique" style={styles.input} /><Button label="Enregistrer" variant="secondary" disabled={inventory.statut !== 'IN_PROGRESS' || !values[line.id]} loading={busy} onPress={() => void save(line)} /></View></Card>; })}
  </ScrollView></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.canvas }, content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md }, card: { padding: spacing.lg, gap: spacing.md }, title: { color: colors.text, fontSize: 16, fontWeight: '600' }, hint: { color: colors.textMuted, fontSize: 13, lineHeight: 19 }, countRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }, input: { flex: 1 }, error: { color: colors.danger, padding: spacing.md } });
