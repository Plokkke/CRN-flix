# Policy : filtrage des demandes, étagères, dérogations

Développe la brique policy (`knowledge/policy.md`, contrat `libs/contracts/src/policy.ts`, aujourd'hui DRAFT) et réorganise la bibliothèque en **stock + étagères**.

## Besoin

- Refuser automatiquement une demande d'après l'identité du média et ses caractéristiques : durée, origine, genre, certification, générique (acteurs, réalisation, production…), année, etc.
- Premier usage : refuser les œuvres impliquant une personne condamnée ou mise en cause pour agression ou harcèlement. Deuxième : le contenu adulte. Le système ne s'y limite pas : n'importe quelle règle doit pouvoir s'enregistrer.
- **Comptes enfants** : une bibliothèque dédiée (dessins animés, films adaptés), et des règles qui dépendent du profil du demandeur.
- Un refus envoie un mail à l'utilisateur : la politique enfreinte et le détail du motif (personne mise en cause et faits reprochés, par exemple). Ce détail dépend du type de règle.
- Depuis le mail, l'utilisateur peut **contester** ou **demander une dérogation** en motivant sa demande. Cela ouvre un ticket admin (Discord + web) : infos du média, motif du refus, motivation, et l'admin peut répondre, accepter ou refuser.
- Un média obtenu par dérogation n'est visible que dans la collection personnelle des utilisateurs qui ont une dérogation. Un 2ᵉ utilisateur est d'abord refusé ; si sa dérogation est accordée, le média déjà présent lui est ouvert sans nouveau téléchargement.
- Un téléchargement manuel de l'admin indique son étagère de destination et n'est pas bloqué par la policy.
- Un onglet d'admin pour changer l'étagère d'un titre.

## Décisions

- **DÉCIDÉ** — **Stock + étagères.** Les fichiers réels vivent dans un stock qu'aucune bibliothèque Jellyfin ne scanne. Les bibliothèques sont des **étagères** faites de liens symboliques vers le stock. Changer un titre d'étagère ne déplace jamais de fichier.
- **DÉCIDÉ** — **Étagères partagées disjointes entre elles** : `standard` et `kids` (et toute étagère partagée future), un titre est sur l'une, l'autre ou aucune.
- **DÉCIDÉ** — **L'étagère personnelle est indépendante des étagères partagées** : une par utilisateur, elle s'ajoute à ce qu'il voit sans rien retirer ailleurs. Exemple : un enfant doit voir un film de guerre pour l'école ; sa dérogation met le film sur son étagère personnelle, sans lui ouvrir `standard` et sans que le film quitte `standard`.
- **DÉCIDÉ** — **Profils** : `adult` voit `standard` + `kids` + son étagère personnelle ; `kids` voit `kids` + son étagère personnelle. Les comptes enfants sont des utilisateurs à part entière (email, Trakt, demandes, mails de refus, appels).
- **DÉCIDÉ** — **Le profil est choisi à l'acceptation de l'inscription** : le ticket `user-approval` propose `Refuser` / `Adulte` / `Enfant` (plus de simple « Accepter »). Il est stocké côté engine (`users.profile`) et modifiable ensuite sur `/admin/users`, comme le nombre de streams.
- **DÉCIDÉ** — **Le verdict porte sur un couple (utilisateur, titre)**, pas sur la demande. `media_requests` reste une ligne par média : `rejected` seulement si **tous** les demandeurs sont refusés. Une règle qui touche une série touche toute la série.
- **DÉCIDÉ** — **Le type de règle est du code, la règle concrète est une donnée.** Chaque type de règle est un plugin `plugins/policies/<nom>` (`@crn-flix/policy-<nom>`) : schémas de paramètres et d'entrées, évaluation pure, avis de refus. Chaque règle concrète est une ligne en base, modifiable depuis l'admin sans déploiement. Pas de mini-langage de règles.
- **DÉCIDÉ** — **Une règle accepte ou refuse, rien d'autre** : le verdict `review` du contrat DRAFT disparaît. Un humain n'intervient que sur appel de l'utilisateur.
- **DÉCIDÉ** — Chaque type de règle choisit seul ses critères d'application (rôles visés, seuil d'apparitions dans une série…), par ses paramètres.
- **DÉCIDÉ** — **Une contestation fondée vaut pour tout le monde** : le titre est exclu de la règle (dérogation globale).
- **DÉCIDÉ** — **Le choix de l'admin fait foi**, et la dérogation qu'il implique est automatique. Sans choix de l'admin, un titre du stock qui passe les règles rejoint son étagère partagée (`standard` ou `kids`).
- **DÉCIDÉ** — **Téléchargement manuel** = téléchargement de l'admin (il ne vient d'aucune demande), jamais bloqué par la policy. L'admin choisit sa destination et elle s'applique telle quelle :
  - `standard` ou `kids` : le titre y va même s'il ne passe pas les règles (dérogation **globale** automatique) ;
  - `personnel` : le titre va sur l'étagère de l'admin et sur aucune étagère partagée, même s'il passe les règles (dérogation **personnelle** automatique).
- **DÉCIDÉ** — **Rétroactivité** : un titre d'une étagère partagée qui enfreint une règle sans dérogation globale ouvre un ticket d'anomalie ; l'admin choisit entre une dérogation globale et le retrait des étagères partagées. La suppression des fichiers reste manuelle.
- **DÉCIDÉ** — **Fin de la racine `private/`** (dossier personnel de l'admin, ancienne version) : `PRIVATE_FOLDER`, `privateMovies` / `privateSeries`, `isPrivate`, la métadonnée `private` et leurs tests disparaissent. L'étagère personnelle de l'admin les remplace.

## Conception

### Disque

```
/medias/store/{movies,series}/<Titre>/                       fichiers réels, aucune bibliothèque
/medias/shelves/standard/{movies,series}/<Titre>      → ../../../store/{movies,series}/<Titre>
/medias/shelves/kids/{movies,series}/<Titre>          → ../../../store/{movies,series}/<Titre>
/medias/shelves/users/<userId>/{movies,series}/<Titre> → ../../../../store/{movies,series}/<Titre>
```

- **Liens relatifs** : l'engine (`MEDIAS_PATH`) et Jellyfin (`/medias`) ne voient pas le volume sous le même chemin.
- **On lie le dossier du titre**, pas chaque fichier : les nouveaux épisodes d'une série apparaissent sur chaque étagère du titre.
- Les étagères personnelles portent l'**id** de l'utilisateur, jamais son pseudo.
- Le placement (`media-labelizer`) écrit **toujours** dans `store/` et enregistre le titre dans `library_titles`.

### Où va un titre (calculé, jamais stocké à la main)

Les règles concrètes portent un champ `audience` : `everyone` (contenu interdit à tous sauf dérogation : `credits`, `adult`…) ou la clé d'une étagère partagée, `kids` aujourd'hui (ce qui est admis sur cette étagère).

1. **Restreint** si une règle `everyone` le refuse sans dérogation globale : il n'est sur aucune étagère partagée.
2. Sinon **`kids`** s'il passe toutes les règles `kids`.
3. Sinon **`standard`**.

Quand une règle ne peut pas trancher (faits inconnus de la source, règle invalide) :
- une règle `everyone` laisse passer (seul un refus certain compte) : un titre que la source ignore reste disponible, et l'admin le voit ;
- une règle d'étagère refuse : sans certification connue, le titre va sur `standard`, et un enfant qui le demande reçoit un refus « impossible de vérifier ».

**Décision de l'admin** (`shelf_overrides`) : elle remplace ce calcul.
- `standard` / `kids` : le titre va sur cette étagère, avec une dérogation globale automatique pour les règles qui le refuseraient.
- `none` : le titre ne va sur aucune étagère partagée. Seul le téléchargement manuel `personnel` la pose ; une demande admise d'un utilisateur la lève ensuite (le titre rejoint alors son étagère calculée, sans nouveau téléchargement).
- Pour retirer durablement un titre des étagères partagées, on l'ajoute à une règle `titles` : les demandeurs reçoivent alors un refus motivé.

**Étagères personnelles** : un titre est sur l'étagère d'un utilisateur s'il a une dérogation personnelle pour ce titre (appel accepté, téléchargement manuel `personnel` pour l'admin), **que le titre soit ou non sur une étagère partagée**. Le réconciliateur ne crée pas le lien personnel quand l'utilisateur voit déjà le titre par une étagère partagée de son profil (pas de doublon dans Jellyfin) ; il le crée dès que ce n'est plus le cas.

**Étagères futures** : rien ne suppose qu'il n'y en a que deux. Les étagères partagées et ce que voit chaque profil sont des données (`shelves` : clé, position, profils qui la voient), initialisées avec `kids` puis `standard`. Le classement prend la première étagère dont le titre passe les règles, dans l'ordre des positions ; la dernière (`standard`) n'a pas de règle propre. Le champ `audience` d'une règle vaut `everyone` ou la clé d'une étagère.

### Admission d'une demande

- Admis si le titre est (ou irait, d'après le classement ou le choix de l'admin) sur une étagère partagée que son profil voit : `adult` → `standard` ou `kids`, `kids` → `kids`. Un `none` issu d'un téléchargement personnel de l'admin ne compte pas : la demande admise le lève.
- Sinon : refus (mail + appel). Une dérogation accordée met le titre sur son étagère personnelle, sans le déplacer d'ailleurs.
- Les règles propres au demandeur (`scope: 'requester'`, quota par exemple) refusent la demande sans toucher au classement du titre ; leur dérogation débloque simplement la demande.

### Réconciliateur d'étagères

L'état voulu (classement + décisions de l'admin + dérogations) est en base ; les liens sur le disque n'en sont que le rendu.

- Différence **pure** entre liens voulus et liens présents (même principe que `libs/planner/diff.ts`), testée seule.
- Crée ou supprime les liens, puis rafraîchit les bibliothèques concernées (rafraîchissement ciblé).
- Tourne après chaque placement, chaque changement de règle, de dérogation ou de décision de l'admin, et périodiquement : un lien cassé (titre renommé dans le stock) ou supprimé à la main est recréé.
- Ne supprime jamais un fichier du stock. Un titre du stock qui n'est plus sur aucune étagère est signalé sur l'onglet d'admin.

### Accès (contrat player)

- `users.profile` (`adult` | `kids`) : la source de vérité est l'engine, le player ne fait qu'appliquer.
  - **Acceptation** : `OPERATIONS_BY_CATEGORY[user-approval]` passe de `approve` / `reject` à `approveAdult` / `approveKids` / `reject` (boutons Discord et formulaire web). Le handler écrit le profil avant de créer le compte player, qui naît donc directement avec les bonnes bibliothèques.
  - **Modification** sur `/admin/users` (même formulaire que `max_streams`) ; la boucle des comptes applique le nouveau profil (bibliothèques, `MaxParentalRating`) et réévalue les demandes ouvertes de l'utilisateur.
  - **Migration** : colonne `NOT NULL`, les utilisateurs existants passent en `adult` ; un utilisateur `pending` reçoit son profil à l'acceptation.
- `Player.ensureLibrary(name, section, path)` crée la bibliothèque si elle n'existe pas encore (recherche par chemin) : `POST /Library/VirtualFolders`, une par type (films, séries). Les étagères partagées existent dès le départ ; une étagère personnelle est créée à son premier titre.
- `AccountPolicy.libraries` est imposé par la boucle des règles de visionnage (`services/player-accounts.ts`, comme `max_streams`) : `EnableAllFolders=false`, `EnabledFolders` = les étagères de son profil + les siennes. Le plugin reconnaît chaque bibliothèque à son chemin ; une modification manuelle d'un compte est corrigée au passage suivant.
- Comptes `kids` : `MaxParentalRating` fixé en plus par la même boucle (filet de sécurité si une règle se trompe).
- La disponibilité d'un titre pour un utilisateur se calcule dans l'engine (le titre est-il sur une étagère qu'il voit ?). `player-sync` sert encore à savoir que Jellyfin a fini de l'indexer.

### Faits sur le média (contrat metadata)

`MediaMetadata` grossit des faits dont les règles ont besoin, tous null quand ils sont inconnus :
- générique et équipe technique, avec un **identifiant de personne opaque** donné par la source (`tmdb:person:123`), jamais le nom seul, plus le rôle (job, département, personnage, nombre d'épisodes pour une série) ;
- genres, mots-clés, certifications par pays, drapeau `adult`, pays d'origine, durée, année.

TMDB : `append_to_response=credits,release_dates,keywords` pour un film, `aggregate_credits,content_ratings,keywords` pour une série. Nouvelle recherche de personne pour le sélecteur de l'admin (`MetadataSource.searchPeople`).

Persistance `media_facts(imdb_id, facts JSONB, fetched_at)` : réévaluer quand une règle change sans rappeler TMDB, et montrer à l'admin sur quoi repose une décision. Rafraîchissement périodique (même principe que `media-titles-job`).

### Contrat policy v2

```ts
type PolicyScope = 'content' | 'requester';

interface PolicyKind<Params, Entry> {
  readonly name: string;                     // 'credits', 'adult', 'attributes'…
  readonly scope: PolicyScope;
  readonly paramsSchema: ZodType<Params>;
  readonly entry?: { key: 'person' | 'media' | 'text'; schema: ZodType<Entry>; fields: FieldSpec[] };
  evaluate(subject: PolicySubject, params: Params, entries: Entry[]): PolicyMatch[];  // pur, synchrone
  notice(match: PolicyMatch, params: Params): RejectionNotice;                         // contenu du mail
}
```

- Une correspondance est un refus : plus de verdict `review`, `PolicyDecision` disparaît au profit de la liste des correspondances (vide = accepté).
- `evaluatePolicies` renvoie **toutes** les correspondances : le mail cite chaque motif, une dérogation se donne règle par règle.
- `PolicyMatch` porte les **preuves** (la personne trouvée, son rôle, l'entrée de liste correspondante), conservées avec le verdict.
- `RejectionNotice` est un contenu **structuré** (titre, nom de la politique, sections : texte, liste, sources). Le plugin produit le contenu, le canal le met en forme : le modèle de mail ne connaît aucune règle.
- `FieldSpec` (texte, texte long, liste d'URL, choix) : l'admin génère ses formulaires d'entrées à partir de cette description, sans interface propre à chaque plugin.
- `audience` est un champ de la **règle concrète**, pas du type : la même règle `attributes` peut servir à `everyone` ou à `kids`.

### Types de règle à livrer

| Plugin | Paramètres | Entrées |
|---|---|---|
| `credits` | départements / jobs visés, seuil d'épisodes pour une série | personne : réf., nom, statut `condamné` \| `mis en cause`, faits, sources datées |
| `adult` | certifications considérées comme adultes par pays | — |
| `attributes` | conditions sur certification, durée, année, genre, pays, langue d'origine (sert aussi à définir `kids`) | — |
| `titles` | — | titre : imdb id, motif (refuser un titre précis, sans critère général) |

L'avis de `credits` ne cite que le contenu de l'entrée (statut, faits, sources) et distingue toujours « condamné » de « mis en cause ». Les entrées sont saisies à la main. Plus tard, éventuellement : un job Wikidata (P1399 « condamné pour ») qui **propose** des entrées par ticket, sans jamais les ajouter seul.

### Persistance (migrations `00030` faits, `00031` policy)

| Table | Contenu |
|---|---|
| `library_titles` | `imdb_id`, `section`, `store_path`, `placed_at` : ce que contient le stock |
| `media_facts` | `imdb_id`, `facts` JSONB, `fetched_at` |
| `policy_rules` | `id`, `kind`, `name` (« Politique X »), `audience` (`everyone` \| `kids`), `params` JSONB, `enabled`, `position` |
| `policy_rule_entries` | `rule_id`, `key`, `data` JSONB |
| `policy_verdicts` | `user_id`, `imdb_id`, `rule_id`, preuves JSONB, `decided_at`, `notified_at` |
| `policy_exemptions` | `user_id` (**NULL = tout le monde**), `imdb_id`, `rule_id` (NULL = toutes), `origin` (`contest` \| `exemption` \| `manual-download`), `status` (`pending` \| `granted` \| `denied`), `motivation`, `ticket_id`, `decided_by`, `decided_at` |
| `shelves` | `key`, `position`, `profiles` (profils qui la voient) : les étagères partagées, initialisées avec `kids` et `standard` |
| `shelf_overrides` | `imdb_id`, `shelf` (clé d'étagère \| `none`), `origin` (`admin` \| `manual-download`), `by`, `at` : le choix de l'admin, qui fait foi |

Plus `users.profile` (le profil). Les paramètres et entrées sont validés par le schéma du type de règle à l'écriture, puis encore à la lecture (une règle invalide est ignorée et signalée).

### Évaluation dans l'engine

- Sur `request_created` / `user_joined_request` : s'assurer d'avoir les faits, évaluer les règles pour ce demandeur, écrire `policy_verdicts`.
- **Planner** : ne compte que les demandeurs admis. Un titre sans demandeur admis n'est pas planifié ; les points de lecture des demandeurs refusés ne fixent pas l'urgence. Un titre déjà dans le stock n'est jamais retéléchargé.
- **Notifications** : la notification « disponible » ne part qu'aux demandeurs qui voient le titre (aujourd'hui elle part vers tous les `request_users`).
- **Mail de refus** : nouveau type de message (`policy-rejection`), regroupé par utilisateur, journalisé dans `user_messages`. `notified_at` n'est rempli qu'une fois le mail parti, un job rattrape les envois échoués. Les quiet hours s'appliquent.
- `POLICY_MODE=off|dry-run|enforce` (défaut `off`, pour que la release ne dépende d'aucun changement d'infrastructure ; la variable Terraform `policy_mode` reste à ajouter), sur le modèle de `USER_MESSAGING` : en dry-run, verdicts et classement sont calculés et visibles sur `/admin`, personne n'est refusé et les titres vont sur `standard` comme aujourd'hui.
- **Réévaluation** quand une règle ou ses entrées changent (même principe que `revalidate.ts`) : les demandes ouvertes sont réévaluées ; un titre qui passe de `kids` à `standard` (ou l'inverse) est simplement relié ; un titre d'une étagère partagée qui devient restreint passe par le ticket d'anomalie.

### Contestation et dérogation

1. Le lien du mail ouvre `/me/policy/<verdict>/appeal` (connexion OTP / lien magique existante, avec `returnTo`). Le formulaire propose de **contester** (la règle s'applique à tort) ou de **demander une dérogation** (la règle est juste, exception demandée), avec une motivation obligatoire.
2. Cela ouvre un ticket `policy-appeal` (sujet : utilisateur × titre × règle), sur Discord et sur le web : média, règle, preuves, motivation. Opérations :
   - `approve` : dérogation personnelle, le titre arrive sur l'étagère personnelle de l'utilisateur ;
   - `exclude` : contestation fondée, le titre sort de la règle pour tout le monde et reprend sa place dans le classement ;
   - `reject` : avec un message pour l'utilisateur ;
   - `reply` : message à l'utilisateur, le texte libre du fil Discord servant de réponse.
3. Après `approve` : si le titre est dans le stock, le réconciliateur crée le lien ; sinon, l'utilisateur devient admis et le planner télécharge le titre.
4. `/me` : l'onglet Refusé montre le motif, l'état de l'appel et le bouton d'appel.

### Téléchargement manuel de l'admin

- Le ticket `manual-download` (Discord + web) propose la destination : `Standard`, `Kids`, `Personnel`. Pré-sélection selon le classement calculé une fois le média identifié.
- `Standard` / `Kids` : `shelf_overrides` sur cette étagère + dérogation globale (`origin: manual-download`) pour les règles qui le refuseraient.
- `Personnel` : `shelf_overrides = none` + dérogation personnelle de l'admin (`origin: manual-download`) : le titre est sur l'étagère de l'admin seulement, même s'il passe les règles.
- La destination peut être choisie ou changée avant comme après la fin du téléchargement : le fichier va dans le stock de toute façon.
- Prérequis : l'admin a un compte utilisateur dans l'engine (lien entre son id Discord et sa ligne `users`).

### Onglet d'admin `/admin/library`

- Un titre par ligne : sa place calculée (avec la règle qui la décide), la décision de l'admin s'il y en a une, les étagères personnelles où il se trouve (qui, pourquoi).
- Actions : choisir l'étagère partagée (le choix fait foi, dérogation globale automatique si besoin), revenir au calcul, accorder ou retirer une dérogation (globale ou pour un utilisateur, qui place le titre sur son étagère personnelle), ajouter le titre à une règle `titles`. Elles écrivent `shelf_overrides`, `policy_exemptions` ou `policy_rule_entries` ; le réconciliateur fait le reste.
- Signale les titres du stock qui ne sont sur aucune étagère, et les liens que le réconciliateur n'a pas pu créer.

### Ticket d'anomalie (rétroactivité)

Un titre d'une étagère partagée qui enfreint une règle `everyone` sans dérogation globale ouvre un ticket `policy-anomaly` (un par titre). Tant que le ticket est ouvert, le réconciliateur laisse le titre où il est : c'est l'admin qui tranche. Opérations :
- `exclude` : dérogation globale, le titre reste ;
- `unpublish` : fin du gel, le titre devient restreint et quitte les étagères partagées (les fichiers restent dans le stock, les dérogations personnelles restent valables) ;
- `resolve` : l'admin a agi à la main (suppression des fichiers, par exemple).

Le ticket se résout aussi tout seul quand le titre ne viole plus aucune règle (règle désactivée, entrée retirée).

## Migration vers stock + étagères

**Changé à l'implémentation (à valider)** : l'étagère `standard` reste aux chemins historiques `movies/` et `series/`. L'engine adopte l'existant lui-même au démarrage (`LIBRARY_LAYOUT=shelves`) : chaque dossier de titre part dans `store/` et un lien du même nom le remplace. Jellyfin voit exactement les mêmes chemins : ni rescan d'identité, ni perte d'états lu / reprise, ni script à lancer sur le serveur (une modification manuelle du serveur est interdite par le cookbook). Prix : `movies/` et `series/` restent à la racine à côté de `store/` et `shelves/`. La procédure ci-dessous ne sert plus que si l'on tient à déplacer `standard` sous `shelves/` plus tard.

### Procédure d'origine (abandonnée)

Déplacer `movies/` et `series/` dans `store/` est un renommage sur le même système de fichiers (instantané). Le risque est côté Jellyfin : changer les chemins des bibliothèques lui fait voir des médias supprimés puis ajoutés (nouveaux ids, rescan complet, états lu / reprise potentiellement perdus selon la version). Procédure scriptée (`infrastructure/scripts/`), répétée sur une copie avant la production :

1. Exporter depuis Jellyfin, pour chaque titre, son chemin et ses ids de fournisseur (remplit `library_titles`) ; pour chaque utilisateur, les états lu / position de reprise par id de fournisseur.
2. Arrêter les placements (engine), renommer `movies` → `store/movies` et `series` → `store/series`.
3. Lancer le réconciliateur (en `POLICY_MODE=dry-run`, tout l'existant va sur `standard`).
4. Remplacer les chemins des bibliothèques par `shelves/standard/{movies,series}` (`/Library/VirtualFolders/Paths`), rescanner.
5. Réappliquer les états exportés en faisant correspondre les ids de fournisseur.
6. Vérifier la disponibilité (`player-sync`) avant de relancer l'engine.

Préalable : épingler l'image Jellyfin (`jellyfin/jellyfin` sans tag aujourd'hui) pour savoir sur quelle version la procédure a été validée. Le tri de l'existant vers `kids` se fait ensuite, par le classement et l'onglet d'admin.

## Avancement

| Étape | État |
|---|---|
| 1. Nettoyage `private/` | PR #28 |
| 3. Faits enrichis | PR #29 (sur #27) |
| 4. Contrat policy v2 + plugins | PR #30 (sur #29) |
| 5a. Évaluation en dry-run : `libs/policy` (évaluation, classement, admission), tables, `PolicyService`, job `policy-assessment-job` | PR #31 (sur #30) |
| 7a. `/admin/policies` : règles, paramètres et entrées (formulaires générés depuis les `FieldSpec`, sélecteur de personne TMDB), où vont les titres | PR #32 (sur #31) |
| 5b. Application (`enforce`) : `PolicyGate` (planner, notification « disponible »), `policy_refusals` (00032), mail de refus groupé par utilisateur | PR #33 (sur #32) |
| 2. Stock + étagère `standard` (`LIBRARY_LAYOUT=shelves`, défaut `legacy`) : `library_titles` + `shelf_overrides` (00033), placement dans le stock, adoption de l'existant au démarrage, réconciliateur | PR #34 (sur #33) |
| 6. Étagères `kids` / personnelles depuis la policy (`PolicyShelfResolver`), bibliothèques Jellyfin et accès par profil (`LibraryAccess`, `MaxParentalRating`), profil à l'acceptation et sur `/admin/users` | en cours |
| 8. Appel (contestation / dérogation) | à faire ; le mail de refus n'a pas encore de bouton d'appel (`appealUrl` null) |

Écarts d'implémentation : la policy ne touche jamais `media_requests.status` (un refus n'est pas un rejet admin : pas de notification « refusé » générique, un autre demandeur peut être admis) ; les règles actuelles jugent toutes le contenu, donc l'évaluation se fait **une fois par titre** (`policy_assessments`, clé = empreinte des règles et de leurs entrées) et l'admission d'un demandeur s'en déduit avec son profil et ses dérogations. Les règles `requester` sont refusées comme invalides tant qu'aucune n'existe. Les étagères sont une constante de l'engine (`services/policy/shelves.ts`) jusqu'à l'étape 2.

## Étapes (une PR chacune)

1. **Nettoyage `private/`** : configuration, placement, métadonnée, tests.
2. **Stock + étagère `standard`** : `library_titles`, placement dans `store/`, `shelf_overrides`, réconciliateur, script de migration Jellyfin et répétition.
3. **Faits enrichis** : contrat metadata, plugin TMDB, `media_facts`, job de rafraîchissement.
4. **Contrat policy v2 + plugins** `credits`, `adult`, `attributes`, `titles`, purs et testés (homonymes, rôles, seuils, séries, certifications inconnues).
5. **Évaluation dans l'engine** : migration `00031`, verdicts, classement, filtrage des demandeurs (planner, notifications), `POLICY_MODE=dry-run`, verdicts sur `/admin`.
6. **Profils et accès** : `users.profile`, choix du profil à l'acceptation (`approveAdult` / `approveKids`) et sur `/admin/users`, étagère `kids`, contrat player (`ensureLibrary`, `AccountPolicy.libraries`, `MaxParentalRating`), boucle des comptes.
7. **Admin** : `/admin/policies` (règles, entrées, sélecteur de personne) et `/admin/library`.
8. **Refus et appel** : mail `policy-rejection`, onglet Refusé de `/me`, formulaire d'appel, ticket `policy-appeal`, étagères personnelles.
9. **Destination des téléchargements manuels** (Discord + web), compte utilisateur de l'admin.
10. **Rétroactivité** : ticket `policy-anomaly`, réévaluation sur changement de règle. Puis passage en `enforce`.

À la fin : mettre à jour `knowledge/policy.md`, `knowledge/plugins.md` (rôle policy implémenté) et `CLAUDE.md`.
