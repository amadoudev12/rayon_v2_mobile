import { newIdempotencyKey } from '@/lib/idempotency';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorMessage } from '@/api/client';
import { createCustomer, createSale, deleteHeldSale, getProduct, holdSale, listCustomers, listHeldSales, listProducts, resumeHeldSale } from '@/api/endpoints';
import { clearSaleDraft, getSaleDraft, setSaleDraft, type DraftLine } from '@/lib/saleDraft';
import { confirmAction } from '@/lib/confirm';
import type { PaymentMethod, Product } from '@/api/types';
import { useAccount } from '@/auth/SessionProvider';
import { SelectSheet } from '@/components/SelectSheet';
import { useToast } from '@/components/Toast';
import {
  Banner,
  Button,
  Card,
  ChipGroup,
  Divider,
  EmptyState,
  ErrorState,
  Field,
  InfoRow,
  Input,
  LoadingState,
  QuantityStepper,
  SearchBar,
  SelectField,
} from '@/components/ui';
import { formatMoney, formatNumber, parseNumberInput } from '@/lib/format';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@/lib/labels';
import { colors, font, radius, spacing } from '@/lib/theme';
import { useDebouncedValue } from '@/lib/useDebouncedValue';

const PAGE_SIZE = 30;

/** Ligne du panier : ce qu'il faut pour l'afficher et borner la quantité au stock connu. */
type CartLine = DraftLine;
type Customer = { id: number; nom: string };

/** Lignes au format du serveur (le prix n'est envoyé que s'il a été négocié). */
function serverLines(cart: CartLine[]) {
  return cart.map((line) => ({
    produitId: line.productId,
    quantite: line.quantity,
    ...(line.negotiatedPrice !== undefined ? { prixUnitaire: line.negotiatedPrice } : {}),
  }));
}

const PAYMENT_OPTIONS = PAYMENT_METHODS.map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }));
const TENDER_OPTIONS = PAYMENT_OPTIONS.filter((option) => option.value !== 'CREDIT');

/**
 * Enregistrement d'une vente en deux temps, pensé pour une main :
 * 1. composer le panier en touchant les produits ;
 * 2. encaisser (client, paiement, remise).
 *
 * Les montants affichés ici sont un aperçu : le serveur recalcule tout à
 * partir de ses propres prix et vérifie le stock au moment de l'encaissement.
 */
export default function NewSaleScreen() {
  const insets = useSafeAreaInsets();
  const { currency, activeStoreId, activeStore, can } = useAccount();

  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim());
  // Panier retrouvé en revenant sur l'écran (brouillon en mémoire, par boutique).
  const [cart, setCart] = useState<CartLine[]>(() => getSaleDraft(activeStoreId)?.cart ?? []);
  const [customer, setCustomer] = useState<Customer | null>(() => getSaleDraft(activeStoreId)?.customer ?? null);
  const [resumedOptions, setResumedOptions] = useState<{ remise?: number; modePaiement?: string }>(() => {
    const draft = getSaleDraft(activeStoreId);
    return { remise: draft?.remise, modePaiement: draft?.modePaiement };
  });
  const [checkoutKey, setCheckoutKey] = useState(0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    setSaleDraft(activeStoreId, { cart, customer, ...resumedOptions });
  }, [activeStoreId, cart, customer, resumedOptions]);

  const heldSales = useQuery({ queryKey: ['held-sales', activeStoreId], queryFn: () => listHeldSales(activeStoreId), enabled: can('sale:create') });

  function resetSale() {
    setCart([]);
    setCustomer(null);
    setResumedOptions({});
    setCheckoutKey((value) => value + 1);
    clearSaleDraft(activeStoreId);
  }

  const hold = useMutation({
    mutationFn: () => holdSale(activeStoreId, { lignes: serverLines(cart), clientId: customer?.id ?? null, ...resumedOptions }),
    onSuccess: async (held) => {
      resetSale();
      await queryClient.invalidateQueries({ queryKey: ['held-sales', activeStoreId] });
      toast(`Vente « ${held.libelle} » mise en attente`);
    },
  });

  const resume = useMutation({
    mutationFn: async (heldId: number) => {
      // La vente en cours n'est jamais perdue : elle est d'abord mise en attente.
      if (cart.length > 0) await holdSale(activeStoreId, { lignes: serverLines(cart), clientId: customer?.id ?? null, ...resumedOptions });
      const resumed = await resumeHeldSale(heldId, activeStoreId);
      const lines: CartLine[] = [];
      const missing: string[] = [];
      for (const line of resumed.panier.lignes) {
        try {
          const product = await getProduct(line.produitId, activeStoreId);
          if (!product.actif || product.quantiteStock <= 0) {
            missing.push(product.nom);
            continue;
          }
          lines.push({
            productId: product.id,
            name: product.nom,
            unit: product.unite,
            unitPrice: line.prixUnitaire ?? Number(product.prixVente),
            negotiatedPrice: line.prixUnitaire,
            quantity: Math.min(line.quantite, product.quantiteStock),
            maxQuantity: product.quantiteStock,
          });
        } catch {
          missing.push(`produit n° ${line.produitId}`);
        }
      }
      return { resumed, lines, missing };
    },
    onSuccess: async ({ resumed, lines, missing }) => {
      setCart(lines);
      const client = resumed.panier.clientId ? heldSales.data?.find((sale) => sale.client?.id === resumed.panier.clientId)?.client ?? null : null;
      setCustomer(client);
      setResumedOptions({ remise: resumed.panier.remise, modePaiement: resumed.panier.modePaiement });
      setCheckoutKey((value) => value + 1);
      await queryClient.invalidateQueries({ queryKey: ['held-sales', activeStoreId] });
      toast(missing.length ? `Vente reprise ; retiré (indisponible) : ${missing.join(', ')}` : `Vente « ${resumed.libelle} » reprise`);
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: ['held-sales', activeStoreId] }),
  });

  const removeHeld = useMutation({
    mutationFn: (heldId: number) => deleteHeldSale(heldId, activeStoreId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['held-sales', activeStoreId] }),
  });

  const products = useInfiniteQuery({
    queryKey: ['products', 'list', activeStoreId, search, 'active', 'sale'],
    queryFn: ({ pageParam }) =>
      listProducts({ storeId: activeStoreId, search, status: 'active', page: pageParam, limit: PAGE_SIZE, sort: 'nom', order: 'asc' }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.totalPages ? lastPage.pagination.page + 1 : undefined,
  });

  if (!can('sale:create')) {
    return <ErrorState message="Votre rôle ne permet pas d'enregistrer des ventes." />;
  }

  const items = products.data?.pages.flatMap((page) => page.data) ?? [];
  const itemCount = cart.reduce((total, line) => total + line.quantity, 0);
  const subtotal = cart.reduce((total, line) => total + line.unitPrice * line.quantity, 0);

  /** Fixe la quantité d'un produit dans le panier (0 le retire), sans dépasser le stock. */
  function setQuantity(product: Pick<CartLine, 'productId' | 'name' | 'unit' | 'unitPrice' | 'maxQuantity' | 'negotiatedPrice'>, quantity: number) {
    const bounded = Math.max(0, Math.min(quantity, product.maxQuantity));
    setCart((current) => {
      const others = current.filter((line) => line.productId !== product.productId);
      if (bounded === 0) return others;
      const existing = current.find((line) => line.productId === product.productId);
      // Une ligne existante garde sa place dans le panier.
      return existing
        ? current.map((line) => (line.productId === product.productId ? { ...line, quantity: bounded } : line))
        : [...others, { ...product, quantity: bounded }];
    });
  }

  return (
    <View style={styles.root}>
      <View style={styles.searchArea}>
        <SearchBar value={searchText} onChangeText={setSearchText} placeholder="Rechercher un produit à ajouter" />
        {(heldSales.data?.length ?? 0) > 0 && (
          <View style={styles.heldBar}>
            <Text style={styles.heldTitle}>En attente ({heldSales.data!.length})</Text>
            {heldSales.data!.map((held) => (
              <View key={held.id} style={styles.heldChip}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Reprendre la vente en attente ${held.libelle}`}
                  disabled={resume.isPending}
                  onPress={() => resume.mutate(held.id)}
                  style={{ flex: 1 }}>
                  <Text style={styles.heldLabel} numberOfLines={1}>{held.libelle}</Text>
                  <Text style={styles.heldMeta}>{held.nombreArticles} art. · {formatMoney(Number(held.totalEstime), currency)} · {held.creePar.prenom}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Supprimer la vente en attente ${held.libelle}`}
                  onPress={() =>
                    confirmAction({
                      title: 'Supprimer cette vente en attente ?',
                      message: `Le panier « ${held.libelle} » sera abandonné. Rien n'avait été encaissé.`,
                      confirmLabel: 'Supprimer',
                      destructive: true,
                      onConfirm: () => removeHeld.mutate(held.id),
                    })
                  }
                  hitSlop={8}>
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {(hold.isError || resume.isError) && <Banner message={errorMessage(hold.error ?? resume.error)} />}
      </View>

      {products.isPending ? (
        <LoadingState />
      ) : products.isError ? (
        <ErrorState message={errorMessage(products.error)} onRetry={() => void products.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(product) => String(product.id)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => (
            <CatalogRow
              product={item}
              currency={currency}
              quantity={cart.find((line) => line.productId === item.id)?.quantity ?? 0}
              onChange={(quantity) =>
                setQuantity(
                  {
                    productId: item.id,
                    name: item.nom,
                    unit: item.unite,
                    unitPrice: Number(item.prixVente),
                    maxQuantity: item.quantiteStock,
                  },
                  quantity,
                )
              }
            />
          )}
          onEndReached={() => {
            if (products.hasNextPage && !products.isFetchingNextPage) void products.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            search !== '' ? (
              <EmptyState icon="search-outline" title="Aucun produit trouvé" description="Essayez un autre nom de produit." />
            ) : (
              <EmptyState icon="cube-outline" title="Aucun produit à vendre" description={`Le catalogue de « ${activeStore.nom} » ne contient aucun produit actif.`} />
            )
          }
          ListFooterComponent={
            products.isFetchingNextPage ? <ActivityIndicator color={colors.brand600} style={{ paddingVertical: spacing.lg }} /> : null
          }
        />
      )}

      <View style={[styles.cartBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cartBarCount}>{itemCount === 0 ? 'Panier vide' : `${formatNumber(itemCount)} article(s)`}</Text>
          <Text style={styles.cartBarTotal}>{formatMoney(subtotal, currency)}</Text>
        </View>
        <Button label="En attente" icon="pause" variant="secondary" disabled={cart.length === 0} loading={hold.isPending} onPress={() => hold.mutate()} />
        <Button label="Encaisser" icon="arrow-forward" disabled={cart.length === 0} onPress={() => setCheckoutOpen(true)} style={{ minWidth: 130 }} />
      </View>

      <Checkout
        key={checkoutKey}
        customer={customer}
        onCustomerChange={setCustomer}
        initialDiscount={resumedOptions.remise}
        initialPaymentMethod={resumedOptions.modePaiement as PaymentMethod | undefined}
        onCompleted={() => clearSaleDraft(activeStoreId)}
        visible={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        cart={cart}
        subtotal={subtotal}
        currency={currency}
        storeId={activeStoreId}
        onChangeQuantity={(line, quantity) => {
          setQuantity(line, quantity);
          // Plus rien à encaisser : retour au catalogue.
          if (quantity === 0 && cart.length === 1) setCheckoutOpen(false);
        }}
      />
    </View>
  );
}

function CatalogRow({
  product,
  currency,
  quantity,
  onChange,
}: {
  product: Product;
  currency: string;
  quantity: number;
  onChange: (quantity: number) => void;
}) {
  const outOfStock = product.quantiteStock <= 0;
  const inCart = quantity > 0;

  return (
    <View style={[styles.catalogRow, inCart && styles.catalogRowSelected, outOfStock && { opacity: 0.6 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ajouter ${product.nom} au panier`}
        disabled={outOfStock || quantity >= product.quantiteStock}
        onPress={() => onChange(quantity + 1)}
        style={styles.catalogText}>
        <Text style={styles.catalogName} numberOfLines={2}>
          {product.nom}
        </Text>
        <Text style={styles.catalogMeta}>
          <Text style={styles.catalogPrice}>{formatMoney(Number(product.prixVente), currency)}</Text>
          {' · '}
          {outOfStock ? (
            <Text style={{ color: colors.danger, fontWeight: '600' }}>Rupture</Text>
          ) : (
            `${formatNumber(product.quantiteStock)} ${product.unite} en stock`
          )}
        </Text>
      </Pressable>

      {inCart ? (
        <QuantityStepper value={quantity} max={product.quantiteStock} onChange={onChange} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ajouter ${product.nom} au panier`}
          disabled={outOfStock}
          onPress={() => onChange(1)}
          style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.7 }]}>
          <Ionicons name="add" size={22} color={outOfStock ? colors.textFaint : colors.brand600} />
        </Pressable>
      )}
    </View>
  );
}

function Checkout({
  visible,
  onClose,
  cart,
  subtotal,
  currency,
  storeId,
  onChangeQuantity,
  customer,
  onCustomerChange: setCustomer,
  initialDiscount,
  initialPaymentMethod,
  onCompleted,
}: {
  customer: Customer | null;
  onCustomerChange: (customer: Customer | null) => void;
  initialDiscount?: number;
  initialPaymentMethod?: PaymentMethod;
  onCompleted: () => void;
  visible: boolean;
  onClose: () => void;
  cart: CartLine[];
  subtotal: number;
  currency: string;
  storeId: number;
  onChangeQuantity: (line: CartLine, quantity: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useAccount();

  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerSearchText, setCustomerSearchText] = useState('');
  const customerSearch = useDebouncedValue(customerSearchText.trim());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initialPaymentMethod ?? 'CASH');
  const [discountText, setDiscountText] = useState(initialDiscount ? String(initialDiscount) : '');
  const [firstPaymentText, setFirstPaymentText] = useState('');
  const [firstTender, setFirstTender] = useState<Exclude<PaymentMethod, 'CREDIT'>>('CASH');
  const saleKey = useRef<string | null>(null);

  const discount = Math.max(0, parseNumberInput(discountText) ?? 0);
  const total = Math.max(0, subtotal - discount);
  const discountInvalid = (discountText.trim() !== '' && (parseNumberInput(discountText) ?? -1) < 0) || discount > subtotal;
  const firstPayment = Math.max(0, parseNumberInput(firstPaymentText) ?? 0);
  const creditInvalid = paymentMethod === 'CREDIT' && (!customer || firstPayment > total);

  const customers = useQuery({
    queryKey: ['customers', customerSearch],
    queryFn: () => listCustomers({ search: customerSearch, limit: 50 }),
    enabled: customerPickerOpen,
  });

  const addCustomer = useMutation({
    mutationFn: () => createCustomer(customerSearchText.trim()),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      setCustomer({ id: created.id, nom: created.nom });
      setCustomerSearchText('');
      setCustomerPickerOpen(false);
    },
  });

  const sale = useMutation({
    mutationFn: () =>
      createSale({
        lignes: serverLines(cart),
        clientId: customer?.id,
        boutiqueId: storeId,
        modePaiement: paymentMethod,
        remise: discount,
        montantPaye: paymentMethod === 'CREDIT' ? firstPayment : undefined,
        modePaiementAcompte: paymentMethod === 'CREDIT' ? firstTender : undefined,
      }, (saleKey.current ??= newIdempotencyKey("sale"))),
    onSuccess: async (created) => {
      saleKey.current = null;
      onCompleted();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      toast('Vente enregistrée');
      onClose();
      // Le reçu remplace l'écran de saisie : « retour » ne rouvre pas un panier déjà encaissé.
      router.replace({ pathname: '/sales/[id]', params: { id: String(created.id) } });
    },
    onError: () => {
      // Stock insuffisant, produit archivé entre-temps… : le catalogue affiché n'est plus à jour.
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <View style={[styles.checkoutHeader, { paddingTop: insets.top + spacing.md }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Revenir au catalogue" hitSlop={12} onPress={onClose}>
            <Ionicons name="chevron-down" size={26} color={colors.brand600} />
          </Pressable>
          <Text style={styles.checkoutTitle}>Encaissement</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={styles.checkoutContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLabel}>Panier</Text>
          <Card>
            {cart.map((line, index) => (
              <View key={line.productId}>
                {index > 0 && <Divider />}
                <View style={styles.cartLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.catalogName} numberOfLines={2}>
                      {line.name}
                    </Text>
                    <Text style={styles.catalogMeta}>
                      {formatMoney(line.unitPrice, currency)} × {line.quantity} ={' '}
                      <Text style={styles.catalogPrice}>{formatMoney(line.unitPrice * line.quantity, currency)}</Text>
                    </Text>
                  </View>
                  <QuantityStepper value={line.quantity} max={line.maxQuantity} onChange={(quantity) => onChangeQuantity(line, quantity)} />
                </View>
              </View>
            ))}
          </Card>

          <Field label="Client (optionnel)">
            <SelectField value={customer?.nom} placeholder="Client de passage" onPress={() => setCustomerPickerOpen(true)} />
          </Field>

          <Field label="Mode de paiement">
            <ChipGroup options={PAYMENT_OPTIONS} value={paymentMethod} onChange={setPaymentMethod} wrap />
          </Field>

          {paymentMethod === 'CREDIT' && <>
            <Field label="Premier versement reçu" error={firstPayment > total ? 'Le versement dépasse le total.' : !customer ? 'Un client est obligatoire pour une vente à crédit.' : undefined}>
              <Input value={firstPaymentText} onChangeText={setFirstPaymentText} keyboardType="decimal-pad" placeholder="0" />
            </Field>
            <Field label="Mode du premier versement">
              <ChipGroup options={TENDER_OPTIONS} value={firstTender} onChange={(value) => { if (value !== 'CREDIT') setFirstTender(value); }} wrap />
            </Field>
          </>}

          <Field label={`Remise (${currency})`} error={discountInvalid ? (discount > subtotal ? 'La remise ne peut pas dépasser le sous-total.' : 'La remise doit être positive ou nulle.') : undefined}>
            <Input value={discountText} onChangeText={setDiscountText} keyboardType="decimal-pad" placeholder="0" invalid={discountInvalid} />
          </Field>

          <Card style={styles.totals}>
            <InfoRow label="Sous-total" value={formatMoney(subtotal, currency)} />
            <InfoRow label="Remise" value={`-${formatMoney(discount, currency)}`} />
            <Divider />
            <InfoRow label="Total" value={formatMoney(total, currency)} strong />
          </Card>

          {sale.isError && <Banner message={errorMessage(sale.error, "Impossible d'enregistrer la vente.")} />}
        </ScrollView>

        <View style={[styles.checkoutFooter, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button
            label={`Encaisser ${formatMoney(total, currency)}`}
            icon="checkmark-circle"
            loading={sale.isPending}
            disabled={cart.length === 0 || discountInvalid || creditInvalid}
            onPress={() => sale.mutate()}
          />
        </View>

        <SelectSheet<number | null>
          visible={customerPickerOpen}
          title="Client"
          options={[
            { value: null, label: 'Client de passage' },
            ...(customers.data?.data ?? []).map((item) => ({
              value: item.id as number | null,
              label: item.nom,
              description: item.telephone ?? undefined,
            })),
          ]}
          selected={customer?.id ?? null}
          onSelect={(value) => {
            const found = customers.data?.data.find((item) => item.id === value);
            setCustomer(found ? { id: found.id, nom: found.nom } : null);
          }}
          onClose={() => setCustomerPickerOpen(false)}
          emptyLabel="Aucun client"
          header={
            <>
              <View style={styles.customerSearch}>
                <View style={{ flex: 1 }}>
                  <SearchBar value={customerSearchText} onChangeText={setCustomerSearchText} placeholder="Rechercher ou nommer un client" />
                </View>
                {can('customer:manage') && (
                  <Button
                    label="Créer"
                    variant="secondary"
                    loading={addCustomer.isPending}
                    disabled={customerSearchText.trim().length < 2}
                    onPress={() => addCustomer.mutate()}
                  />
                )}
              </View>
              {addCustomer.isError && <Banner message={errorMessage(addCustomer.error)} />}
              {customers.isError && <Banner message={errorMessage(customers.error)} />}
              {customers.isPending && customerPickerOpen && <ActivityIndicator color={colors.brand600} />}
            </>
          }
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  heldBar: { marginTop: spacing.sm, gap: spacing.xs },
  heldTitle: { fontSize: font.xs, fontWeight: '600', color: colors.warning, textTransform: 'uppercase' },
  heldChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  heldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  heldMeta: { fontSize: font.xs, color: colors.textMuted },
  root: { flex: 1, backgroundColor: colors.canvas },
  searchArea: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  list: { padding: spacing.lg, flexGrow: 1 },

  catalogRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  catalogRowSelected: { borderColor: colors.brand500, backgroundColor: colors.brand50 },
  catalogText: { flex: 1, minWidth: 0, justifyContent: 'center', minHeight: 48 },
  catalogName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  catalogMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 3 },
  catalogPrice: { fontWeight: '600', color: colors.textSecondary },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralBg,
    borderWidth: 1,
    borderColor: colors.border,
  },

  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cartBarCount: { fontSize: font.xs, color: colors.textMuted },
  cartBarTotal: { fontSize: font.lg, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },

  checkoutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkoutTitle: { fontSize: font.lg, fontWeight: '600', color: colors.text },
  checkoutContent: { padding: spacing.lg, gap: spacing.lg },
  sectionLabel: { fontSize: font.sm, fontWeight: '500', color: colors.textSecondary, marginBottom: -spacing.sm },
  cartLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingVertical: spacing.sm },
  totals: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  checkoutFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  customerSearch: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
