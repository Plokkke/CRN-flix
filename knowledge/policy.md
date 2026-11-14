# Brique policy

**DÉCIDÉ (2026-10-20)** — Brique de l'architecture en plugins. **Implémentée (2026-11-06)** : conception, décisions et avancement dans [todo/filter.md](todo/filter.md).

## En bref

- **Une règle accepte ou refuse** (le verdict `review` du brouillon a disparu) : un humain n'intervient que sur appel de l'utilisateur, ou quand une règle frappe un titre déjà publié (ticket d'anomalie).
- **Type de règle = plugin** (`plugins/policies/<nom>`, contrat `PolicyKind` dans `libs/contracts/src/policy.ts`), **règle concrète = ligne en base** (`policy_rules` + `policy_rule_entries`), créée et modifiée sur `/admin/policies` sans déploiement. Types livrés : `credits`, `adult`, `attributes`, `titles`.
- Chaque règle vise `everyone` (refusé sur toutes les étagères) ou une étagère (ce qu'elle admet, `kids` aujourd'hui). Les règles `everyone` laissent passer quand elles ne peuvent pas trancher, les règles d'étagère refusent.
- Le cœur pur est `libs/policy` : `assess`, `classify` (restreint / première étagère dont le titre passe les règles ; le choix de l'admin prime), `admit` (profil du demandeur + dérogations).
- Les faits évalués (`media_facts`) viennent du metadata (`MetadataSource.facts`).
- Les titres sont rangés sur des **étagères** (stock + liens, `LIBRARY_LAYOUT=shelves`) : `standard` et `kids` disjointes, plus une étagère personnelle par utilisateur.

## À distinguer

- `preferences.ts` (qualité, langue, hôte, taille) filtre des **releases**. La policy filtre des **titres**. Les deux restent séparés.
- `user-approval` décide si une **personne** est acceptée (et son profil). La policy décide pour un **titre** et un **demandeur**.

## Réponses aux questions ouvertes du brouillon

- Configuration des règles : en base, éditées sur `/admin/policies`.
- Réévaluation : automatique (empreinte des règles + date des faits) ; un titre déjà publié qui devient restreint passe par un ticket d'anomalie.
- Persistance de la raison : `policy_refusals` (par utilisateur × titre), affichée sur `/me` et dans le mail.
- Passer outre : dérogations (`policy_exemptions`, personnelles ou globales) et choix d'étagère de l'admin (`shelf_overrides`).
- Métadonnées : `MediaFacts` (générique avec références de personnes, genres, mots-clés, certifications, `adult`, pays, durée).
