import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { addSalePayment, cancelSale, createSaleReturn, getSale, payRefund } from '@/api/endpoints';
import type { SaleDetails, Tender } from '@/api/types';
import { useAccount } from '@/auth/SessionProvider';
import { useToast } from '@/components/Toast';
import { Badge, Banner, Button, Card, ChipGroup, Divider, ErrorState, Field, InfoRow, Input, LoadingState, QuantityStepper, SectionHeader } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { formatDateTime, formatMoney, formatNumber, saleNumber } from '@/lib/format';
import { newIdempotencyKey } from '@/lib/idempotency';
import { CANCELLATION_LABELS, PAYMENT_METHOD_LABELS, SETTLEMENT_LABELS, TENDER_OPTIONS } from '@/lib/labels';
import { colors, font, spacing } from '@/lib/theme';

const CANCEL_TYPES = [
  { value: 'REFUND' as const, label: 'Rembourser le client' },
  { value: 'ENTRY_ERROR' as const, label: 'Erreur de saisie (rien reçu)' },
];
const YES_NO = [
  { value: 'yes' as const, label: 'Revendable' },
  { value: 'no' as const, label: 'Abîmé' },
];

/**
 * Détail d'une vente. Toutes les règles (soldes, remboursements, retours) sont
 * calculées par le serveur ; l'écran n'affiche que ses résultats. Chaque
 * opération garde sa clé d'idempotence jusqu'au succès : un nouvel essai
 * après une coupure réseau ne crée jamais de doublon.
 */
export default function SaleDetailsScreen() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const saleId = Number(id);
  const { currency, can } = useAccount();
  const validId = Number.isInteger(saleId) && saleId > 0;

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentTender, setPaymentTender] = useState<Tender>('CASH');
  const [refundTender, setRefundTender] = useState<Tender>('CASH');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelType, setCancelType] = useState<'REFUND' | 'ENTRY_ERROR'>('REFUND');
  const [refundNow, setRefundNow] = useState<'now' | 'later'>('now');
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({});
  const [returnResellable, setReturnResellable] = useState<Record<number, 'yes' | 'no'>>({});
  const [returnReason, setReturnReason] = useState('');
  const paymentKey = useRef<string | null>(null);
  const payoutKey = useRef<string | null>(null);
  const cancelKey = useRef<string | null>(null);
  const returnKey = useRef<string | null>(null);

  const sale = useQuery({ queryKey: ['sales', 'detail', saleId], queryFn: () => getSale(saleId), enabled: validId });

  async function afterChange(message: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sales'] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
    await sale.refetch();
    toast(message);
  }

  const payment = useMutation({
    mutationFn: (amount: number) => addSalePayment(saleId, amount, paymentTender, (paymentKey.current ??= newIdempotencyKey('pay'))),
    onSuccess: async () => {
      paymentKey.current = null;
      setPaymentAmount('');
      await afterChange('Paiement reçu enregistré');
    },
  });
  const payout = useMutation({
    mutationFn: ({ refundId, amount }: { refundId: number; amount: number }) =>
      payRefund(refundId, amount, refundTender, (payoutKey.current ??= newIdempotencyKey('payout'))),
    onSuccess: async () => {
      payoutKey.current = null;
      await afterChange('Remboursement versé enregistré');
    },
  });
  const cancel = useMutation({
    mutationFn: (refundable: number) =>
      cancelSale(
        saleId,
        {
          motif: cancelReason.trim(),
          type: cancelType,
          ...(cancelType === 'REFUND' && refundable > 0 && refundNow === 'now' ? { remboursementImmediat: { modePaiement: refundTender } } : {}),
        },
        (cancelKey.current ??= newIdempotencyKey('cancel')),
      ),
    onSuccess: async () => {
      cancelKey.current = null;
      setCancelReason('');
      await afterChange('Vente annulée, stock rétabli');
    },
  });
  const saleReturn = useMutation({
    mutationFn: ({ data, refundNowTender }: { data: SaleDetails; refundNowTender?: Tender }) =>
      createSaleReturn(
        saleId,
        {
          motif: returnReason.trim(),
          lignes: data.lignes
            .filter((line) => (returnQuantities[line.id] ?? 0) > 0)
            .map((line) => ({ ligneVenteId: line.id, quantite: returnQuantities[line.id]!, remiseEnStock: (returnResellable[line.id] ?? 'yes') === 'yes' })),
          ...(refundNowTender ? { remboursementImmediat: { modePaiement: refundNowTender } } : {}),
        },
        (returnKey.current ??= newIdempotencyKey('return')),
      ),
    onSuccess: async () => {
      returnKey.current = null;
      setReturnQuantities({});
      setReturnReason('');
      await afterChange('Retour enregistré : avoir, stock et solde mis à jour');
    },
  });

  if (!validId) return <ErrorState message="Cette vente est introuvable." />;
  if (sale.isPending) return <LoadingState />;
  if (sale.isError) return <ErrorState message={errorMessage(sale.error)} onRetry={() => void sale.refetch()} />;

  const data = sale.data;
  const cancelled = data.statut === 'CANCELLED';
  const resteAPayer = Number(data.resteAPayer);
  const returned = Number(data.montantRetourne);
  const refundable = Math.max(0, Number(data.montantPaye) - Number(data.montantARembourser));
  const settlement = SETTLEMENT_LABELS[data.etatFinancier];
  const returnable = !cancelled && data.lignes.some((line) => line.quantiteRestante > 0);
  const selectedReturnCount = Object.values(returnQuantities).reduce((sum, value) => sum + value, 0);

  function confirmCancel() {
    const refundText =
      cancelType === 'ENTRY_ERROR'
        ? 'Le paiement saisi par erreur sera annulé (il reste dans l’historique). Aucun remboursement ne sera créé.'
        : refundable > 0
          ? refundNow === 'now'
            ? `Vous rendez ${formatMoney(refundable, currency)} au client maintenant (${PAYMENT_METHOD_LABELS[refundTender]}).`
            : `${formatMoney(refundable, currency)} resteront « à rembourser » jusqu’à la remise réelle des fonds.`
          : 'Aucun argent n’a été reçu sur cette vente.';
    confirmAction({
      title: 'Annuler cette vente ?',
      message: `Motif : ${cancelReason.trim()}\n\nLes articles encore chez le client reviennent en stock.\n${refundText}`,
      confirmLabel: 'Annuler la vente',
      destructive: true,
      onConfirm: () => cancel.mutate(refundable),
    });
  }

  function confirmReturn() {
    confirmAction({
      title: 'Enregistrer ce retour ?',
      message: `${selectedReturnCount} article(s). L’avoir réduit d’abord ce que le client doit encore ; s’il a trop payé, la différence lui est due.`,
      confirmLabel: 'Enregistrer',
      onConfirm: () => saleReturn.mutate({ data, refundNowTender: refundNow === 'now' ? refundTender : undefined }),
    });
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: `Vente ${saleNumber(data.id)}` }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={sale.isRefetching} onRefresh={() => void sale.refetch()} tintColor={colors.brand600} colors={[colors.brand600]} />}>
        <Text style={[styles.total, cancelled && styles.totalCancelled]}>{formatMoney(Number(data.total), currency)}</Text>
        <Text style={styles.date}>{formatDateTime(data.creeLe)}</Text>
        <View style={styles.badges}>
          <Badge dot tone={cancelled ? 'danger' : 'success'} label={cancelled ? (CANCELLATION_LABELS[data.typeAnnulation ?? 'REFUND'] ?? 'Annulée') : 'Terminée'} />
          <Badge tone="brand" label={PAYMENT_METHOD_LABELS[data.modePaiement]} />
          <Badge dot tone={settlement.tone} label={settlement.label} />
        </View>
        {cancelled && data.annuleLe && (
          <Text style={styles.cancelledAt}>
            Annulée le {formatDateTime(data.annuleLe)}
            {data.motifAnnulation ? ` · ${data.motifAnnulation}` : ''}
          </Text>
        )}

        <SectionHeader title="Informations" />
        <Card style={styles.cardPadded}>
          <InfoRow label="Client" value={data.client ? `${data.client.nom}${data.client.telephone ? `\n${data.client.telephone}` : ''}` : 'Client de passage'} />
          <Divider />
          <InfoRow label="Vendeur" value={`${data.vendeur.prenom} ${data.vendeur.nom}`} />
          <Divider />
          <InfoRow label="Boutique" value={data.boutique.nom} />
        </Card>

        <SectionHeader title="Montants" />
        <Card style={styles.cardPadded}>
          <InfoRow label="Sous-total" value={formatMoney(Number(data.sousTotal), currency)} />
          <InfoRow label="Remise" value={`−${formatMoney(Number(data.remise), currency)}`} />
          <Divider />
          <InfoRow label="Total" value={formatMoney(Number(data.total), currency)} strong />
          {returned > 0 && <InfoRow label="Retours (avoir)" value={`−${formatMoney(returned, currency)}`} />}
          <InfoRow label="Payé" value={formatMoney(Number(data.montantPaye), currency)} />
          {resteAPayer > 0 && <InfoRow label="Reste à payer" value={formatMoney(resteAPayer, currency)} valueColor={colors.warning} />}
          {Number(data.remboursementEnAttente) > 0 && (
            <InfoRow label="À rendre au client" value={formatMoney(Number(data.remboursementEnAttente), currency)} valueColor={colors.danger} />
          )}
        </Card>

        <SectionHeader title={`Articles (${data.lignes.length})`} />
        <Card>
          {data.lignes.map((line, index) => (
            <View key={line.id}>
              {index > 0 && <Divider />}
              <View style={styles.line}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{line.produit.nom}</Text>
                  <Text style={styles.lineMeta}>
                    {formatNumber(line.quantite)} {line.produit.unite} × {formatMoney(Number(line.prixUnitaire), currency)}
                    {line.quantiteRetournee > 0 ? ` · ${formatNumber(line.quantiteRetournee)} retourné(s)` : ''}
                  </Text>
                </View>
                <Text style={styles.lineAmount}>{formatMoney(Number(line.sousTotal), currency)}</Text>
              </View>
            </View>
          ))}
        </Card>

        {data.paiements.length > 0 && (
          <>
            <SectionHeader title="Paiements reçus" />
            <Card style={styles.cardPadded}>
              {data.paiements.map((item, index) => (
                <View key={item.id}>
                  {index > 0 && <Divider />}
                  <InfoRow
                    label={`${formatDateTime(item.date)} · ${item.modePaiement ? PAYMENT_METHOD_LABELS[item.modePaiement] : 'Mode non renseigné'}${item.annule ? ' · ANNULÉ' : ''}`}
                    value={formatMoney(Number(item.montant), currency)}
                    valueColor={item.annule ? colors.textFaint : undefined}
                  />
                  {item.annule && item.motifAnnulation && <Text style={styles.note}>{item.motifAnnulation}</Text>}
                </View>
              ))}
            </Card>
          </>
        )}

        {can('sale:create') && !cancelled && resteAPayer > 0 && (
          <>
            <SectionHeader title="Encaisser un versement" />
            <Card style={styles.cardPadded}>
              <Field label="Montant">
                <Input value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="decimal-pad" placeholder={formatMoney(resteAPayer, currency)} />
              </Field>
              <Field label="Mode de paiement">
                <ChipGroup options={TENDER_OPTIONS} value={paymentTender} onChange={setPaymentTender} wrap />
              </Field>
              {payment.isError && <Banner message={errorMessage(payment.error)} />}
              <Button
                label="Enregistrer le paiement"
                loading={payment.isPending}
                disabled={!(Number(paymentAmount) > 0) || Number(paymentAmount) > resteAPayer}
                onPress={() => payment.mutate(Number(paymentAmount))}
              />
            </Card>
          </>
        )}

        {data.retours.length > 0 && (
          <>
            <SectionHeader title="Retours d'articles" />
            {data.retours.map((retour) => (
              <Card key={retour.id} style={styles.block}>
                <InfoRow label={retour.motif} value={`−${formatMoney(Number(retour.montant), currency)}`} />
                <Text style={styles.note}>{formatDateTime(retour.creeLe)}</Text>
                {retour.lignes.map((line) => (
                  <Text key={line.id} style={styles.note}>
                    {formatNumber(line.quantite)} × {line.produit.nom} — {line.remiseEnStock ? 'remis en stock' : 'non revendable (perte)'}
                  </Text>
                ))}
              </Card>
            ))}
          </>
        )}

        {data.remboursements.length > 0 && (
          <>
            <SectionHeader title="Remboursements dus au client" />
            {data.remboursements.map((refund) => {
              const remaining = Number(refund.montantRestant);
              return (
                <Card key={refund.id} style={styles.block}>
                  <InfoRow label={remaining > 0 ? 'À rendre' : 'Remboursé'} value={formatMoney(remaining > 0 ? remaining : Number(refund.montant), currency)} />
                  <Text style={styles.note}>
                    {refund.motif} · déjà rendu {formatMoney(Number(refund.montantVerse), currency)}
                  </Text>
                  {refund.versements.map((item) => (
                    <Text key={item.id} style={styles.note}>
                      {formatDateTime(item.date)} · {PAYMENT_METHOD_LABELS[item.modePaiement]} · {formatMoney(Number(item.montant), currency)}
                    </Text>
                  ))}
                  {remaining > 0 && can('refund:manage') && (
                    <>
                      <Field label="Mode de remboursement">
                        <ChipGroup options={TENDER_OPTIONS} value={refundTender} onChange={setRefundTender} wrap />
                      </Field>
                      {payout.isError && <Banner message={errorMessage(payout.error)} />}
                      <Button
                        label={`Confirmer le versement de ${formatMoney(remaining, currency)}`}
                        loading={payout.isPending}
                        onPress={() =>
                          confirmAction({
                            title: 'Confirmer la remise des fonds ?',
                            message: `Confirmez seulement si ${formatMoney(remaining, currency)} a réellement été remis au client (${PAYMENT_METHOD_LABELS[refundTender]}).`,
                            confirmLabel: 'Fonds remis',
                            onConfirm: () => payout.mutate({ refundId: refund.id, amount: remaining }),
                          })
                        }
                      />
                    </>
                  )}
                </Card>
              );
            })}
          </>
        )}

        {can('return:manage') && returnable && (
          <>
            <SectionHeader title="Retour d'articles" />
            <Card style={styles.block}>
              {data.lignes
                .filter((line) => line.quantiteRestante > 0)
                .map((line) => (
                  <View key={line.id} style={styles.returnLine}>
                    <Text style={styles.lineName}>
                      {line.produit.nom} <Text style={styles.lineMeta}>(au plus {line.quantiteRestante})</Text>
                    </Text>
                    <View style={styles.returnControls}>
                      <QuantityStepper value={returnQuantities[line.id] ?? 0} max={line.quantiteRestante} onChange={(value) => setReturnQuantities((old) => ({ ...old, [line.id]: value }))} />
                      <ChipGroup options={YES_NO} value={returnResellable[line.id] ?? 'yes'} onChange={(value) => setReturnResellable((old) => ({ ...old, [line.id]: value }))} />
                    </View>
                  </View>
                ))}
              <Field label="Motif du retour">
                <Input value={returnReason} onChangeText={setReturnReason} placeholder="Ex : article défectueux" />
              </Field>
              {resteAPayer === 0 && refundable > 0 && (
                <>
                  <ChipGroup
                    options={[
                      { value: 'now' as const, label: 'Je rends l’argent maintenant' },
                      { value: 'later' as const, label: 'Plus tard' },
                    ]}
                    value={refundNow}
                    onChange={setRefundNow}
                    wrap
                  />
                  {refundNow === 'now' && <ChipGroup options={TENDER_OPTIONS} value={refundTender} onChange={setRefundTender} wrap />}
                </>
              )}
              {saleReturn.isError && <Banner message={errorMessage(saleReturn.error)} />}
              <Button
                label="Enregistrer le retour"
                variant="secondary"
                loading={saleReturn.isPending}
                disabled={selectedReturnCount === 0 || returnReason.trim().length < 3}
                onPress={confirmReturn}
                style={{ marginTop: spacing.md }}
              />
            </Card>
          </>
        )}

        {data.note && (
          <>
            <SectionHeader title="Note" />
            <Card style={{ padding: spacing.lg }}>
              <Text style={styles.note}>{data.note}</Text>
            </Card>
          </>
        )}

        {can('sale:cancel') && !cancelled && (
          <>
            <SectionHeader title="Annuler la vente" />
            <Card style={styles.block}>
              <Field label="Motif d'annulation">
                <Input value={cancelReason} onChangeText={setCancelReason} placeholder="Raison de l'annulation" />
              </Field>
              {refundable > 0 && (
                <>
                  <ChipGroup options={CANCEL_TYPES} value={cancelType} onChange={setCancelType} wrap />
                  {cancelType === 'ENTRY_ERROR' && <Text style={styles.note}>Uniquement le jour même, si aucun argent n’a réellement été reçu.</Text>}
                  {cancelType === 'REFUND' && (
                    <>
                      <ChipGroup
                        options={[
                          { value: 'now' as const, label: `Je rends ${formatMoney(refundable, currency)} maintenant` },
                          { value: 'later' as const, label: 'Plus tard' },
                        ]}
                        value={refundNow}
                        onChange={setRefundNow}
                        wrap
                      />
                      {refundNow === 'now' && <ChipGroup options={TENDER_OPTIONS} value={refundTender} onChange={setRefundTender} wrap />}
                    </>
                  )}
                </>
              )}
              {cancel.isError && <Banner message={errorMessage(cancel.error)} />}
              <Button label="Annuler la vente" variant="danger" loading={cancel.isPending} disabled={cancelReason.trim().length < 3} onPress={confirmCancel} style={{ marginTop: spacing.md }} />
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  total: { fontSize: 30, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  totalCancelled: { color: colors.textFaint, textDecorationLine: 'line-through' },
  date: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  cancelledAt: { fontSize: font.xs, color: colors.textMuted, marginTop: spacing.sm },
  cardPadded: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  block: { padding: spacing.lg, marginBottom: spacing.sm, gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  lineName: { fontSize: font.md, fontWeight: '500', color: colors.text },
  lineMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  lineAmount: { fontSize: font.md, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  note: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  returnLine: { gap: spacing.sm, paddingBottom: spacing.sm },
  returnControls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
});
