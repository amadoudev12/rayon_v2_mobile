import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Button, Field, Input } from '@/components/ui';
import { colors, font, radius, spacing } from '@/lib/theme';

/**
 * Feuille de confirmation qui exige un motif écrit (annulation d'une perte,
 * d'un inventaire…). Le motif est conservé dans l'historique et l'audit.
 */
export function ReasonSheet({
  visible,
  title,
  message,
  confirmLabel,
  placeholder,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  placeholder?: string;
  onClose: () => void;
  /** Rejette (erreur affichée dans la feuille) ou se termine (feuille fermée). */
  onConfirm: (reason: string) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setReason('');
    setError(null);
    onClose();
  }

  async function confirm() {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError('Indiquez le motif (3 caractères au moins).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Opération impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Fermer" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <Field label="Motif">
            <Input value={reason} onChangeText={setReason} placeholder={placeholder} autoFocus maxLength={500} />
          </Field>
          {error && <Banner message={error} />}
          <View style={styles.actions}>
            <Button label="Retour" variant="secondary" onPress={close} style={{ flex: 1 }} />
            <Button label={confirmLabel} variant="danger" loading={busy} onPress={() => void confirm()} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  sheet: {
    gap: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  title: { fontSize: font.lg, fontWeight: '600', color: colors.text },
  message: { fontSize: font.sm, color: colors.textMuted, marginTop: -spacing.md, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: spacing.md },
});
