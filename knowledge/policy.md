# Brique policy

**DÉCIDÉ (2026-10-20)** — Nouvelle brique de l'architecture en plugins. Elle est définie (contrat `libs/contracts/src/policy.ts`), elle n'est pas développée.

## Objectif

Filtrer automatiquement les demandes **en sortie de catalog**, avant que le planner ne cherche quoi que ce soit, pour refuser d'office ce que le service ne veut pas servir sans mobiliser un admin.

```
Catalog ──► demandes (intention) ──► Policy ──► accept ──► planner ──► indexers…
                                        ├──► reject ──► demande refusée, utilisateur notifié avec la raison
                                        └──► review ──► ticket : un admin tranche
```

## Contrat

```ts
type PolicySubject = { media: MediaItem; metadata: MediaMetadata | null; requester: { userRef; reasons } };
type PolicyDecision = { verdict: 'accept' } | { verdict: 'reject' | 'review'; rule: string; reason: string };
interface Policy { name; evaluate(subject): PolicyDecision }
evaluatePolicies(policies, subject) // dans l'ordre, le premier verdict qui n'est pas « accept » l'emporte
```

- **Pure et synchrone** : aucune I/O. L'engine fournit tout ce dont la règle a besoin dans le sujet (métadonnées résolues, raisons de la demande, plus tard le quota consommé, etc.).
- `rule` identifie la règle (pour l'audit et l'affichage admin) ; `reason` est rédigée pour l'utilisateur.

## Ce que le verdict déclenche (existant réutilisé)

| Verdict | Effet |
|---|---|
| `accept` | Rien : la demande suit son cours |
| `reject` | `media_requests.status = 'rejected'` : la notification utilisateur existante part (seuls `fulfilled`/`rejected` notifient), avec la raison |
| `review` | Ouverture d'un ticket (nouvelle catégorie) : « les tickets convoquent un humain » |

## Exemples de règles

Contenu adulte, genre ou langue originale non servis, note trop basse, quota par utilisateur, film trop ancien ou pas encore sorti, déjà disponible dans la bibliothèque.

## À distinguer

- `preferences.ts` (qualité, langue, hôte, taille) filtre des **releases**. La policy filtre des **intentions**. Les deux restent séparés.
- `user-approval` décide si une **personne** est acceptée. La policy décide pour une **demande**.

## Questions ouvertes (à trancher au développement)

- Où vit la configuration des règles (variables d'environnement, base, configuration de composition) ?
- Réévaluation : quand une règle change, faut-il réévaluer les demandes ouvertes, comme `revalidate.ts` le fait pour les propositions du planner ?
- Persistance de la raison du refus (colonne sur `media_requests` ou événement), pour l'afficher sur `/admin` et `/me`.
- Un admin peut-il passer outre un `reject` (forçage), et comment le tracer ?
- Quelles métadonnées faut-il dans `MediaMetadata` (genres, note, certification) ? Le contrat metadata devra grossir avec.
