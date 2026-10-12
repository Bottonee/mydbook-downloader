# bSmart: discovery del 11 ottobre 2026

Analisi effettuata con Playwright senza account bSmart e lettura del repository [Leone25/bSmart-downloader](https://github.com/Leone25/bSmart-downloader). La libreria autenticata e un libro non sono stati aperti: i contratti provengono dal codice pubblico ufficiale e dal downloader di riferimento, non da risposte autenticate. Il metodo di quel downloader è ora implementato su richiesta dell'utente; restano da verificare i libri reali del suo account.

## Fonti e autenticazione confermate

La finestra Electron deve usare l'identificativo del browser Chromium senza i marker dell'app e `Electron`: il bundle usa `is-electron` e altrimenti attiva il backend nativo bSmart, fallendo con `Cannot find module 'app-desktop-backend'`. Il problema è stato riprodotto senza credenziali e la finestra è configurata tramite `browserLogin: true`; Node resta disabilitato e la sandbox resta attiva.

- App ufficiale: <https://my.bsmart.it/>. Senza sessione, Playwright osserva una richiesta `GET https://www.bsmart.it/api/v6/user` e un redirect a <https://www.bsmart.it/users/sign_in>.
- Bundle ufficiale osservato: <https://my.bsmart.it/scripts/f9a4c7594cce37462f0e779897107a51.min.js>, versione dichiarata dal client `7.6.10`.
- `fetchCurrentUser` effettua `GET /api/v6/user` con `withCredentials: true`, poi legge `auth_token` dalla risposta e lo conserva nella variabile in memoria `M`.
- Il wrapper delle API imposta l'header **`AUTH_TOKEN`**, senza prefisso Bearer. Il login dell'app estrae questo header dalle sole richieste verso gli origin ufficiali. Il valore non viene mai scritto nel report.
- Il parametro `request_token` è usato dal sito per recuperare l'utente. Non viene trattato come equivalente al token API: tale equivalenza non è verificata.
- Cookie specifico dell'autenticazione, eventuali chiavi di storage, durata/refresh del token: **TODO**, richiedono traffico autenticato. Non vengono provati nomi generici o token OAuth di Google/Dropbox.
- Il report [bsmart-discovery.json](bsmart-discovery.json) conferma una risposta 401 di `/api/v6/user` senza accesso. Nel browser non autenticato è osservato il cookie `_bsw_session_v1_production`: non è verificato come token API e non viene usato nell'header AUTH_TOKEN.

## Endpoint presenti nel codice ufficiale

Tutti gli endpoint API seguenti sono su `https://www.bsmart.it`; l'header è `AUTH_TOKEN` salvo `/api/v6/user`, che usa i cookie della sessione web.

| Funzione | Endpoint | Contratto ricavato dal codice |
| --- | --- | --- |
| Elenco libri | `GET /api/v6/books?page_thumb_size=medium&per_page=25000` | Array; `id`, `title`, `authors`, `page_count`, `current_edition.revision` sono utilizzati dal client. Risposta reale **TODO**. |
| Preattivazioni | `GET /api/v5/books/preactivations` | Nel downloader di riferimento: array di gruppi, aggiunge `books` quando `no_bsmart === false`; deduplica per `id`. |
| Metadati | `GET /api/v6/books/by_book_id/<id>` | Oggetto libro, risposta reale **TODO**. |
| Revisione | `GET /api/v5/books/<id>` | Il client legge `revision`. |
| Indice | `GET /api/v5/books/<id>/<revision>/index` | Struttura reale e corrispondenza con l'ordine delle pagine **TODO**. |
| Risorse | `GET /api/v5/books/<id>/<revision>/resources?per_page=500&page=<N>` | Array di risorse con `assets`; scarica finché l'array contiene meno di 500 elementi. Seleziona asset `use === 'page_pdf'`, con `url`, `filename`, `encrypted`. Mapping confermato nel repository di riferimento; risposta reale **TODO**. |

La copertina e i campi degli oggetti autore non sono verificati: vengono omessi, senza inventare nomi. La validazione del token legge la libreria senza creare device, modificare l'account o aprire un libro.

Aggiornamento del 12 ottobre 2026: usando una sessione già salvata è stata verificata la struttura autenticata delle risorse. Ogni risorsa `page_pdf` ha un `title` che rappresenta l'etichetta della pagina: nel campione osservato `I, II, …, VIII`, poi `1, 2, 3, …`. La selezione di pagine usa questo campo, non il filename o l'ID dell'asset. Le pagine romane non vengono contate come pagina 1. Il riscontro riguarda i metadati della numerazione di un libro, non una verifica completa di tutti i libri né un download integrale.

## Pagine PDF e cifratura implementate

Il bundle importa `@bsmartlabs/bsmart-encryption/asmcrypto` e il caricamento degli asset passa per `decrypt` quando `encrypted` non è esplicitamente `false`. È un'indicazione concreta di contenuti cifrati, ma senza un libro autenticato non è possibile affermare che ogni pagina di ogni libro lo sia.

Il metodo segue [src/api.js](https://github.com/Leone25/bSmart-downloader/blob/main/src/api.js), [index.js](https://github.com/Leone25/bSmart-downloader/blob/main/index.js) e [src/crypto.js](https://github.com/Leone25/bSmart-downloader/blob/main/src/crypto.js) del repository indicato, distribuito con licenza MIT. La relativa attribuzione è inclusa nel codice e nel pacchetto in `licenses/bsmart-downloader-MIT.txt`.

1. Legge metadati e `current_edition.revision`, poi tutte le risorse paginate. Seleziona solo `assets` con `use === 'page_pdf'`, mantenendo l'ordine restituito dal server, come nel downloader di riferimento. Usa `id` oppure `filename` per gli identificativi di ripresa; duplicati o campi mancanti generano un errore.
2. Scarica l'URL dell'asset senza AUTH_TOKEN, Authorization o cookie, anche quando appartiene a un CDN. Il trasporto condiviso gestisce timeout, retry/backoff, redirect HTTPS e annullamento. Gli URL firmati restano soltanto in memoria.
3. Se `encrypted !== false`, recupera la chiave dal lettore pubblico: legge l'HTML di `https://my.bsmart.it/`, scarica i bundle JS dello stesso origin e ricostruisce la stringa letterale codificata con `String.fromCharCode`/indici. Non esegue `eval`, costruttori dinamici o altro codice remoto. Nessuna chiave reale è incorporata nel codice, registrata nei log o scritta su disco; una richiesta concorrente condivisa la conserva in memoria nel processo di download.
4. Legge l'intestazione MessagePack nei primi 256 byte, con campo `start`. Dopo l'intestazione legge IV di 16 byte e il prefisso AES-CBC; rimuove il padding PKCS#7 valido e riattacca la coda non cifrata. Controlla limiti del buffer, dimensioni della chiave e blocchi prima della decifratura. Il risultato deve essere un PDF valido contenente esattamente una pagina. Formati diversi restituiscono un errore, senza tentativi generici.
5. Salva le pagine complete come `tmp/bsmart/<id>/000001.pdf`, ecc. La pipeline comune controlla i PDF in cache, riscarica quelli corrotti e copia le pagine con pdf-lib preservando testo, grafica e dimensioni. La compressione JPEG riguarda le immagini MyDBook e non viene applicata ai PDF nativi bSmart.

Non viene usata la cattura di schermate, né introdotta una pipeline alternativa per l'assemblaggio. Libri privi di `page_pdf` non sono supportati.

Verifiche effettuate: 11 test unitari complessivi passati; test bSmart mockati con paginazione, PDF sintetici, cifratura sintetica, retry 429, cache/ripresa e preservazione delle dimensioni/font. Prova Electron offline con header AUTH_TOKEN, vault cifrato e worker bSmart. `node scripts/verify-bsmart-reader.mjs` ha verificato sul lettore pubblico attuale il recupero della chiave, senza mostrare o salvare il valore. **Il download di un libro autenticato reale non è stato verificato.**

## Cosa serve per completare la discovery

Per confermare il comportamento sul proprio account, eseguire prima un download campione. In caso di errore serve un HAR esportato dopo l'accesso a My bSmart, il caricamento della libreria, l'apertura di un libro e lo sfoglio di almeno tre pagine. Prima di condividerlo, oscurare valori di Cookie/Set-Cookie, AUTH_TOKEN/Authorization, `auth_token`, `request_token`, query firmate, password e dati personali; conservare nomi dei campi, tipi, ordine delle pagine, `encrypted`, MIME e dimensioni. Non sono necessarie credenziali utilizzabili. Questo permette di verificare cambiamenti dell'API, copertine, ordine reale e formati diversi da quelli implementati.

In alternativa eseguire `npm run discover -- --provider bsmart --headed`: accesso manuale nel browser e report con soli schemi, nomi header/cookie e query senza valori. Il report non modifica automaticamente la configurazione del provider.
