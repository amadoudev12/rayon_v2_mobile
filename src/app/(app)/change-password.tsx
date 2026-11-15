import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { errorMessage } from '@/api/client';
import { changePassword } from '@/api/endpoints';
import { useAccount } from '@/auth/SessionProvider';
import { useToast } from '@/components/Toast';
import { Banner, Button, Card, Field, Input } from '@/components/ui';
import { colors, font, spacing } from '@/lib/theme';

/** Même règle que le serveur (lib/validations/auth). */
function passwordProblem(value: string): string | null {
  if (value.length < 8) return '8 caractères au moins.';
  if (!/[A-Za-z]/.test(value)) return 'Au moins une lettre.';
  if (!/[0-9]/.test(value)) return 'Au moins un chiffre.';
  return null;
}

/**
 * Changement de mot de passe : obligatoire après une réinitialisation par un
 * responsable (tout le reste de l'application est alors bloqué), ou volontaire
 * depuis l'onglet Compte. Les autres appareils sont déconnectés par le serveur.
 */
export default function ChangePasswordScreen() {
  const toast = useToast();
  const { profile, refreshProfile, signOut } = useAccount();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const forced = profile.doitChangerMotDePasse;
  const nextProblem = next ? passwordProblem(next) : null;
  const mismatch = confirm && confirm !== next ? 'Les deux mots de passe ne correspondent pas.' : null;

  const save = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: async () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      await refreshProfile();
      toast('Mot de passe modifié. Vos autres appareils ont été déconnectés.');
      if (router.canGoBack()) router.back();
      else router.replace('/');
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {forced && (
        <Text style={styles.notice}>
          Votre mot de passe a été réinitialisé par un responsable. Choisissez un mot de passe personnel pour continuer.
        </Text>
      )}
      <Card style={styles.card}>
        <Field label="Mot de passe actuel (ou temporaire)">
          <Input value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
        </Field>
        <Field label="Nouveau mot de passe" error={nextProblem ?? undefined}>
          <Input value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" invalid={Boolean(nextProblem)} />
        </Field>
        <Field label="Confirmer le nouveau mot de passe" error={mismatch ?? undefined}>
          <Input value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" invalid={Boolean(mismatch)} />
        </Field>
        {save.isError && <Banner message={errorMessage(save.error)} />}
        <Button
          label="Enregistrer le nouveau mot de passe"
          loading={save.isPending}
          disabled={!current || !next || Boolean(nextProblem) || confirm !== next}
          onPress={() => save.mutate()}
        />
      </Card>
      {forced && <Button label="Se déconnecter" variant="secondary" onPress={() => void signOut()} style={{ marginTop: spacing.lg }} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg },
  card: { padding: spacing.lg, gap: spacing.sm },
  notice: { fontSize: font.sm, color: colors.warning, marginBottom: spacing.md, lineHeight: 20 },
});
