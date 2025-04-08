# TODO List

## Corrections et Améliorations
- [x] Corriger la mise à jour des threads pour éviter la duplication des fields
- [ ] Mettre en place un job récurrent sur les threads pour :
  - [ ] List pending / in_progress requests with last updated greater than 3 days
  - [ ] Send inactivity message in admin thread

## Discord
- [ ] Ajouter des suggestions de réactions aux messages pour faciliter le travail des administrateurs
  - [ ] Identifier les réactions courantes
  - [ ] Implémenter un système de suggestion contextuel

- [ ] Prevent error to crash application
- [ ] Cache user message and send in Bulk to avoid spaming
- [x] Filter out episode not aired

- [x] Mail de bienvenu avec user guid
      Bienvenu, Vous pouvez dés à présent profiter de la collection de x Films et x Séries dont nottament `5 random movies` `5 random show`
      Voici votre pseudo et password et url d'access
      Il manque un contenu que vous voudriez voir ? pour en faire la demande il faut vous créer un compte sur la platfrome Trakt et cliquer sur ce lien `crn-flix trakt register link with autoredirect to trakt activation with code`. Follow with instruction to add in watchlist. Vous serez prévenu par emil de l'avancement de vos requets
