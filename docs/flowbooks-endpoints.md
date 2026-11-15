# FlowBooks: integrazione 1.7.0

Verifica pubblica del 16 novembre 2026 su `https://flowbooks.olhos.it`. La home indica i tenant `edisco` e `digistore`. Il sito usa il motore Olhos già presente in MyDBook; l’implementazione condivide il trasporto senza mescolare origin, tenant, vault o cache.

## Percorsi verificati

- Login: `/<tenant>/login`, con autenticazione manuale nel sito ufficiale. Il codice pubblico legge il cookie `userToken` e usa `Authorization: Bearer <token>`. Il downloader non raccoglie password e ignora cookie amministrativi e token di altri origin.
- Dashboard: `/<tenant>/dashboard`. Il modulo pubblico della pagina riceve `blocks`; la libreria usa il blocco `user_my_books_block` e viene filtrata tramite `user.bookcodes`, come per MyDBook. Il formato completo della risposta autenticata resta da verificare con un account FlowBooks.
- Lettore fisso: `/<tenant>/<bookcode>/1/fixed`. La pagina è distinta dalla scheda di catalogo `/<tenant>/<bookcode>`. È stata verificata pubblicamente la presenza di `infoFixedPage`, `listPages`, `pageId`, `bookcode`, `user` e `session`. Per il libro pubblico controllato, `listPages` è vuoto senza attivazione: il downloader non tenta di scaricare contenuti del catalogo non presenti nella libreria.
- Dettagli pagina: `/data/v1/fixedlayout/<tenant>/<bookcode>/details/<id>/<id>`, confermato nel modulo pubblico del lettore. Le immagini vengono richieste dagli URL restituiti nei dettagli, senza dedurre percorsi dai nomi dei file. Cookie e Bearer restano limitati a `https://flowbooks.olhos.it`.

Le versioni dei bundle osservati appartengono alla build `9a6c27bbe11c8a9772e3f175b717b04538db4d39`; dashboard `dashboard-f2177dd4ae7bc651.js`, lettore `fixed-43e3f31ee54e65c0.js`. I nomi possono cambiare e non vengono incorporati nel downloader.

## Uso

Nella GUI scegliere **FlowBooks — Edisco** oppure **FlowBooks — DigiStore**, accedere e selezionare un libro. **Apri nel lettore** apre la pagina ufficiale in una finestra isolata con sessione in memoria; disconnettersi chiude il lettore e la chiusura cancella i suoi cookie. **Scarica PDF** supporta ripresa, selezione delle pagine, calibrazione, compressione e OCR italiano/inglese. L’esportazione supporta i libri a impaginazione fissa; i libri liquidi senza pagine raster restituiscono un errore esplicito.

I provider CLI sono `flowbooks` (Edisco) e `flowbooks-digistore`. Le variabili alternative sono `FLOWBOOKS_TOKEN` e `FLOWBOOKS_DIGISTORE_TOKEN`; la CLI può riusare i vault cifrati dell’app. Gli output e le cache sono separati per ID provider.

## Verifica

Test automatici con risposte simulate per entrambi i tenant: filtro dei libri posseduti, percorsi del lettore, immagini, PDF, numerazione, ripresa, token scaduti e rifiuto delle richieste autenticate ad altri origin. Il test Electron verifica anche l’apertura del lettore, il rifiuto di un libro estraneo alla libreria e sandbox/isolamento/Node disabilitato. Non è stato effettuato un download con un account FlowBooks reale.
