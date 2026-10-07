# Rayon — application mobile

Application React Native (Expo SDK 57, TypeScript, Expo Router) de Rayon. Elle n'a ni base de données ni règle métier propres : elle consomme l'API du backend (`../backend`), la même que le site web.

## Démarrage

```bash
# 1. Backend (dans ../backend)
npm run dev

# 2. Application mobile (dans ce dossier)
npm install
cp .env.example .env      # puis renseigner EXPO_PUBLIC_API_URL et EXPO_PUBLIC_WEB_URL
npx expo start
```

Scannez ensuite le QR code avec **Expo Go** (Android / iOS), ou appuyez sur `a` (émulateur Android) / `i` (simulateur iOS).

### `EXPO_PUBLIC_API_URL` (backend)

| Où tourne l'application | Valeur |
| --- | --- |
| Vrai téléphone (même Wi-Fi que l'ordinateur) | `http://<IP locale de l'ordinateur>:4000` |
| Émulateur Android | `http://10.0.2.2:4000` |
| Simulateur iOS | `http://localhost:4000` |
| Production | l'URL HTTPS du backend déployé |

Sur un vrai téléphone, `localhost` désigne le téléphone lui-même : il faut l'adresse IP de l'ordinateur (`ipconfig`), et autoriser Node.js dans le pare-feu Windows. Après une modification de `.env`, relancez `npx expo start --clear`.

### `EXPO_PUBLIC_WEB_URL` (site web)

Adresse du site (`../frontend`), ouverte par le lien « Créer un compte sur le site » de l'écran de connexion. Le site et l'API étant deux serveurs distincts, elle se règle séparément.

## Fonctionnalités

- Connexion (email ou téléphone) / déconnexion, session conservée dans le stockage sécurisé du téléphone.
- Tableau de bord : encaissé du jour, chiffres du mois, évolution sur 7 jours, stock faible, meilleures ventes, activité récente.
- Produits : liste, recherche, filtres, fiche détaillée, création, modification, archivage, ajustement de stock.
- Ventes : historique, recherche, détail, enregistrement (panier → encaissement), annulation.
- Compte : profil, organisation, changement de boutique active.

Les actions affichées dépendent des permissions du rôle, calculées par le serveur (`GET /api/me`) et revérifiées par chaque route.

## Organisation du code

```
src/
  app/                  Écrans (Expo Router) — un fichier = une route
    _layout.tsx         Fournisseurs globaux + garde de navigation (connecté / non connecté)
    login.tsx
    (app)/(tabs)/       Onglets : Accueil, Produits, Ventes, Compte
    (app)/products/     Fiche, création, modification
    (app)/sales/        Détail, nouvelle vente
  api/                  Client HTTP, routes de l'API, types des réponses JSON
  auth/                 Session (jeton, profil, boutique active) et stockage sécurisé
  components/           Composants d'interface réutilisables
  lib/                  Thème, formats, libellés
```

## Authentification

`POST /api/mobile/auth/login` vérifie les identifiants avec le même code que la connexion web et renvoie un jeton signé par le backend, valable 30 jours. Le mobile le conserve dans `expo-secure-store` et l'envoie dans l'en-tête `Authorization: Bearer …` ; toutes les routes l'acceptent. Un `401` ferme la session et ramène à l'écran de connexion.

Les jetons émis par l'ancienne application (NextAuth) ne sont pas reconnus par ce backend : à la première ouverture après la bascule, chaque utilisateur se reconnecte une fois.

## Vérifications

```bash
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform web     # vérifie que l'application se compile entièrement
```

`scripts/api-smoke.ts` exécute le client API du mobile contre un backend en marche (connexion, produits, ventes, erreurs, permissions). **Il écrit des données** : à n'utiliser que sur une base de développement ou de test.

```bash
EXPO_PUBLIC_API_URL=http://localhost:4000 npx tsx scripts/api-smoke.ts
```

Sous PowerShell : `$env:EXPO_PUBLIC_API_URL = "http://localhost:4000"; npx tsx scripts/api-smoke.ts`.

## Publication

Les builds se font avec EAS (`npx eas-cli@latest build`). En production, `EXPO_PUBLIC_API_URL` doit pointer vers l'URL **HTTPS** du backend : Android et iOS bloquent le HTTP en clair hors développement.

`eas.json` contient encore, pour le profil `preview`, l'adresse de l'ancienne application : remplacez `EXPO_PUBLIC_API_URL` par l'URL du backend v2 et `EXPO_PUBLIC_WEB_URL` par celle du site v2 avant de lancer un build.
