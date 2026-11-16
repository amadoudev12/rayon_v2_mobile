import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { cancelInventory, countInventoryLine, getInventory, validateInventory } from '@/api/endpoints';
import type { Inventory, InventoryLine } from '@/api/types';
import { useAccount } from '@/auth/SessionProvider';
import { ReasonSheet } from '@/components/ReasonSheet';
import { useToast } from '@/components/Toast';
import { Badge, Banner, Button, Card, ChipGroup, EmptyState, ErrorState, Input, LoadingState, SearchBar } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { formatNumber } from '@/lib/format';
import { INVENTORY_STATUS_LABELS } from '@/lib/labels';
import { colors, font, spacing } from '@/lib/theme';

type Filter = 'all' | 'todo' | 'gaps';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'todo', label: 'À compter' },
  { value: 'gaps', label: 'Écarts' },
  { value: 'all', label: 'Tous' },
];

/** Comptage d'un inventaire, ligne par ligne, puis validation (correction du stock). */
export default function InventoryCountScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Number(rawId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('todo');
  const [cancelOpen, setCancelOpen] = useState(false);

  const queryKey = ['stock-tab', 'inventory', id];
  const inventory = useQuery({ queryKey, queryFn: () => getInventory(id), enabled: Number.isInteger(id) && id > 0 });

  const validate = useMutation({
    mutationFn: () => validateInventory(id),
    onSuccess: async () => {
      toast('Inventaire validé : le stock a été corrigé');
      await queryClient.invalidateQueries({ queryKey: ['stock-tab'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const lines = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('fr');
    return (inventory.data?.lignes ?? []).filter((line) => {
      if (filter === 'todo' && line.quantiteComptee !== null) return false;
      if (filter === 'gaps' && (line.quantiteComptee === null || line.quantiteComptee === line.quantiteTheorique)) return false;
      if (!term) return true;
      return line.produitNom.toLocaleLowerCase('fr').includes(term) || (line.produitReference ?? '').toLocaleLowerCase('fr').includes(term);
    });
  }, [inventory.data, search, filter]);

  if (inventory.isPending) return <LoadingState label="Chargement de l’inventaire…" />;
  if (inventory.isError) return <ErrorState message={errorMessage(inventory.error)} onRetry={() => void inventory.refetch()} />;

  const data = inventory.data;
  const counted = data.lignes.filter((line) => line.quantiteComptee !== null).length;
  const editable = data.statut === 'IN_PROGRESS';
  const status = INVENTORY_STATUS_LABELS[data.statut];

  function confirmValidate() {
    confirmAction({
      title: 'Valider cet inventaire ?',
      message: 'Le stock de chaque produit sera corrigé selon le comptage (les ventes et achats faits depuis sont pris en compte). Cette opération est définitive.',
      confirmLabel: 'Valider',
      onConfirm: () => validate.mutate(),
    });
  }

  async function cancel(reason: string) {
    try {
      await cancelInventory(id, reason);
    } catch (cause) {
      throw new Error(errorMessage(cause));
    }
    toast('Inventaire annulé : le stock n’a pas été modifié');
    await queryClient.invalidateQueries({ queryKey: ['stock-tab'] });
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: data.reference }} />
      <FlatList
        data={lines}
        keyExtractor={(line) => String(line.id)}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Card style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.title}>{data.libelle}</Text>
                <Badge label={status.label} tone={status.tone} dot />
              </View>
              <Text style={styles.hint}>
                {data.boutique.nom} · {formatNumber(counted)} / {formatNumber(data.lignes.length)} produits comptés
              </Text>
              {validate.isError && <Banner message={errorMessage(validate.error)} />}
              {editable && data.canValidate && (
                <Button
                  label={counted === data.lignes.length ? 'Valider l’inventaire' : `Encore ${data.lignes.length - counted} produit(s) à compter`}
                  loading={validate.isPending}
                  disabled={counted !== data.lignes.length}
                  onPress={confirmValidate}
                />
              )}
              {editable && data.canCancel && <Button label="Annuler l’inventaire" variant="secondary" onPress={() => setCancelOpen(true)} />}
            </Card>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Rechercher un produit" />
            <ChipGroup options={FILTERS} value={filter} onChange={setFilter} />
          </View>
        }
        ListEmptyComponent={
          <EmptyState compact icon="checkmark-circle-outline" title={filter === 'todo' ? 'Tout est compté' : 'Aucun produit'} />
        }
        renderItem={({ item }) => <CountRow inventory={data} line={item} editable={editable} />}
      />
      <ReasonSheet
        visible={cancelOpen}
        title="Annuler cet inventaire ?"
        message="Le comptage sera abandonné ; le stock ne sera pas modifié."
        confirmLabel="Annuler l’inventaire"
        placeholder="Comptage interrompu, erreur de sélection…"
        onClose={() => setCancelOpen(false)}
        onConfirm={cancel}
      />
    </View>
  );
}

/**
 * Saisie d'une ligne. La version de la ligne est contrôlée par le serveur :
 * si quelqu'un d'autre l'a comptée entre-temps, l'enregistrement est refusé
 * et la ligne est relue.
 */
function CountRow({ inventory, line, editable }: { inventory: Inventory; line: InventoryLine; editable: boolean }) {
  const { can } = useAccount();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(line.quantiteComptee === null ? '' : String(line.quantiteComptee));
  const amount = Number(value);
  const valid = value !== '' && Number.isInteger(amount) && amount >= 0;
  const delta = line.quantiteComptee === null ? null : line.quantiteComptee - line.quantiteTheorique;

  const save = useMutation({
    mutationFn: () => countInventoryLine(inventory.id, line.id, amount, line.version),
    onSuccess: (saved) => {
      queryClient.setQueryData<Inventory>(['stock-tab', 'inventory', inventory.id], (current) =>
        current && { ...current, lignes: current.lignes.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)) },
      );
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: ['stock-tab', 'inventory', inventory.id] }),
  });

  const canEdit = editable && can('inventory:count');

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{line.produitNom}</Text>
      <Text style={styles.hint}>
        {line.categorieNom ? `${line.categorieNom} · ` : ''}Théorique : {formatNumber(line.quantiteTheorique)}
        {delta === null ? ' · non compté' : ` · écart : ${delta > 0 ? '+' : ''}${delta}`}
      </Text>
      {canEdit && (
        <View style={styles.countRow}>
          <Input
            accessibilityLabel={`Quantité comptée de ${line.produitNom}`}
            keyboardType="number-pad"
            value={value}
            onChangeText={setValue}
            placeholder="Quantité physique"
            style={{ flex: 1 }}
          />
          <Button
            label="Enregistrer"
            variant="secondary"
            disabled={!valid || amount === line.quantiteComptee}
            loading={save.isPending}
            onPress={() => save.mutate()}
          />
        </View>
      )}
      {save.isError && <Banner message={errorMessage(save.error)} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  header: { gap: spacing.md, marginBottom: spacing.md },
  card: { padding: spacing.lg, gap: spacing.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  countRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  title: { color: colors.text, fontSize: font.md, fontWeight: '600', flexShrink: 1 },
  hint: { color: colors.textMuted, fontSize: font.sm, lineHeight: 19 },
});
