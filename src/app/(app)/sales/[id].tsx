import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorMessage } from '@/api/client';
import { addSalePayment, cancelSale, getSale, payRefund } from '@/api/endpoints';
import type { PaymentMethod } from '@/api/types';
import { useAccount } from '@/auth/SessionProvider';
import { useToast } from '@/components/Toast';
import { Badge, Banner, Button, Card, ChipGroup, Divider, ErrorState, Field, InfoRow, Input, LoadingState, SectionHeader } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { formatDateTime, formatMoney, formatNumber, saleNumber } from '@/lib/format';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@/lib/labels';
import { colors, font, spacing } from '@/lib/theme';

const TENDER_OPTIONS = PAYMENT_METHODS.filter((value) => value !== 'CREDIT').map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }));

export default function SaleDetailsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const saleId = Number(id);
  const { currency, can } = useAccount();
  const [paymentAmount, setPaymentAmount] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [paymentTender, setPaymentTender] = useState<Exclude<PaymentMethod, 'CREDIT'>>('CASH');
  const [refundTender, setRefundTender] = useState<Exclude<PaymentMethod, 'CREDIT'>>('CASH');
  const paymentKey = useRef<string | null>(null);
  const payoutKey = useRef<string | null>(null);
  const validId = Number.isInteger(saleId) && saleId > 0;

  const sale = useQuery({ queryKey: ['sales', 'detail', saleId], queryFn: () => getSale(saleId), enabled: validId });

  const cancel = useMutation({
    mutationFn: () => cancelSale(saleId, cancelReason.trim()),
    onSuccess: async () => {
      // L'annulation remet les articles en stock et modifie les chiffres du tableau de bord.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      toast('Vente annulée, stock rétabli et remboursement mis en attente si nécessaire');
    },
  });
  const payout = useMutation({
    mutationFn: ({ refundId, amount, key }: { refundId: number; amount: number; key: string }) => payRefund(refundId, amount, refundTender, key),
    onSuccess: async () => {
      payoutKey.current = null;
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['sales', 'detail', saleId] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })]);
      await sale.refetch();
      toast('Remboursement réel enregistré');
    },
  });
  const payment = useMutation({
    mutationFn: ({ amount, key }: { amount: number; key: string }) => addSalePayment(saleId, amount, paymentTender, key),
    onSuccess: async () => { paymentKey.current = null; setPaymentAmount(''); await sale.refetch(); await queryClient.invalidateQueries({ queryKey: ['dashboard'] }); toast('Paiement reçu enregistré'); },
  });

  if (!validId) return <ErrorState message="Cette vente est introuvable." />;
  if (sale.isPending) return <LoadingState />;
  if (sale.isError) return <ErrorState message={errorMessage(sale.error)} onRetry={() => void sale.refetch()} />;

  const data = sale.data;
  const cancelled = data.statut === 'CANCELLED';
  const resteAPayer = cancelled ? 0 : Number(data.total) - Number(data.montantPaye);

  function confirmCancel() {
    confirmAction({
      title: 'Annuler cette vente ?',
      message: `Motif : ${cancelReason.trim()}\n\nLes articles seront remis en stock. Les sommes reçues ouvriront une demande de remboursement à confirmer après remise réelle des fonds.`,
      confirmLabel: 'Annuler la vente',
      destructive: true,
      onConfirm: () => cancel.mutate(),
    });
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: `Vente ${saleNumber(data.id)}` }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={sale.isRefetching} onRefresh={() => void sale.refetch()} tintColor={colors.brand600} colors={[colors.brand600]} />
        }>
        <Text style={[styles.total, cancelled && styles.totalCancelled]}>{formatMoney(Number(data.total), currency)}</Text>
        <Text style={styles.date}>{formatDateTime(data.creeLe)}</Text>
        <View style={styles.badges}>
          <Badge dot tone={cancelled ? 'danger' : 'success'} label={cancelled ? 'Annulée' : 'Terminée'} />
          <Badge tone="brand" label={PAYMENT_METHOD_LABELS[data.modePaiement]} />
        </View>
        {cancelled && data.annuleLe && <Text style={styles.cancelledAt}>Annulée le {formatDateTime(data.annuleLe)}</Text>}

        {cancel.isError && (
          <View style={{ marginTop: spacing.lg }}>
            <Banner message={errorMessage(cancel.error)} />
          </View>
        )}

        <SectionHeader title="Informations" />
        <Card style={styles.cardPadded}>
          <InfoRow
            label="Client"
            value={data.client ? `${data.client.nom}${data.client.telephone ? `\n${data.client.telephone}` : ''}` : 'Client de passage'}
          />
          <Divider />
          <InfoRow label="Vendeur" value={`${data.vendeur.prenom} ${data.vendeur.nom}`} />
          <Divider />
          <InfoRow label="Boutique" value={data.boutique.nom} />
        </Card>

        {data.paiements.length > 0 && <>
          <SectionHeader title="Paiements reçus" />
          <Card style={styles.cardPadded}>{data.paiements.map((item, index) => <View key={item.id}>{index > 0 && <Divider />}<InfoRow label={`${formatDateTime(item.date)} · ${item.modePaiement ? PAYMENT_METHOD_LABELS[item.modePaiement] : 'Mode historique inconnu'}`} value={formatMoney(Number(item.montant), currency)} /></View>)}</Card>
        </>}

        {can('sale:create') && !cancelled && resteAPayer > 0 && <>
          <SectionHeader title="Encaisser un versement" />
          <Card style={styles.cardPadded}>
            <Field label="Montant">
              <Input value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="decimal-pad" placeholder={formatMoney(resteAPayer, currency)} />
            </Field>
            <Field label="Mode de paiement">
                  <ChipGroup options={TENDER_OPTIONS} value={paymentTender} onChange={setPaymentTender} wrap />
            </Field>
            {payment.isError && <Banner message={errorMessage(payment.error)} />}
            <Button label="Enregistrer le paiement" loading={payment.isPending} disabled={!(Number(paymentAmount) > 0) || Number(paymentAmount) > resteAPayer} onPress={() => payment.mutate({ amount: Number(paymentAmount), key: (paymentKey.current ??= `${Date.now()}-${Math.random().toString(36).slice(2)}`) })} />
          </Card>
        </>}

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
                  </Text>
                </View>
                <Text style={styles.lineAmount}>{formatMoney(Number(line.sousTotal), currency)}</Text>
              </View>
            </View>
          ))}
        </Card>

        <SectionHeader title="Montants" />
        <Card style={styles.cardPadded}>
          <InfoRow label="Sous-total" value={formatMoney(Number(data.sousTotal), currency)} />
          <InfoRow label="Remise" value={`-${formatMoney(Number(data.remise), currency)}`} />
          <Divider />
          <InfoRow label="Total" value={formatMoney(Number(data.total), currency)} strong />
          <InfoRow label="Montant payé" value={formatMoney(Number(data.montantPaye), currency)} />
          {resteAPayer > 0 && <InfoRow label="Reste à payer" value={formatMoney(resteAPayer, currency)} valueColor={colors.warning} />}
        </Card>

        {data.note && (
          <>
            <SectionHeader title="Note" />
            <Card style={{ padding: spacing.lg }}>
              <Text style={styles.note}>{data.note}</Text>
            </Card>
          </>
        )}

        {data.remboursements.length > 0 && <>
          <SectionHeader title="Remboursements" />
          {data.remboursements.map((refund) => {
            const alreadyPaid = refund.versements.reduce((sum, item) => sum + Number(item.montant), 0);
            const remaining = Math.max(0, Number(refund.montant) - alreadyPaid);
            return <Card key={refund.id} style={{ padding: spacing.lg, marginBottom: spacing.sm }}>
              <InfoRow label={remaining > 0 ? 'À rembourser' : 'Remboursé'} value={formatMoney(remaining > 0 ? remaining : Number(refund.montant), currency)} />
              <Text style={styles.note}>{refund.motif} · déjà rendu {formatMoney(alreadyPaid, currency)}</Text>
              {refund.versements.map((item) => <Text key={item.id} style={styles.note}>{formatDateTime(item.date)} · {PAYMENT_METHOD_LABELS[item.modePaiement]} · {formatMoney(Number(item.montant), currency)}</Text>)}
              {remaining > 0 && can('refund:manage') && <>
                <Field label="Mode de remise">
                  <ChipGroup options={TENDER_OPTIONS} value={refundTender} onChange={setRefundTender} wrap />
                </Field>
                <Button label={`Confirmer le remboursement de ${formatMoney(remaining, currency)}`} loading={payout.isPending} style={{ marginTop: spacing.md }} onPress={() => confirmAction({ title: 'Confirmer la remise des fonds ?', message: `Confirmez seulement si ${formatMoney(remaining, currency)} a été remis au client.`, confirmLabel: 'Fonds remis', onConfirm: () => payout.mutate({ refundId: refund.id, amount: remaining, key: (payoutKey.current ??= `${Date.now()}-${Math.random().toString(36).slice(2)}`) }) })} />
              </>}
            </Card>;
          })}
        </>}
      </ScrollView>

      {can('sale:cancel') && !cancelled && (
        <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.md }]}>
          <Field label="Motif d'annulation">
            <Input value={cancelReason} onChangeText={setCancelReason} placeholder="Raison de l'annulation" />
          </Field>
          <Button label="Annuler la vente" variant="danger" loading={cancel.isPending} disabled={cancelReason.trim().length < 3} onPress={confirmCancel} />
        </View>
      )}
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
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  lineName: { fontSize: font.md, fontWeight: '500', color: colors.text },
  lineMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  lineAmount: { fontSize: font.md, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  note: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  actions: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
