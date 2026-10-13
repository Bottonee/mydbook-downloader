# Zanichelli / laZ Ebook: discovery del 13 ottobre 2026

Il sito corrente è https://my.zanichelli.it/. Il precedente Booktab Web non è il lettore da integrare: la documentazione ufficiale indica che è stato sostituito da laZ Ebook e che l'accesso parte dalla libreria myZanichelli.

Fonti ufficiali: [laZ Ebook](https://www.zanichelli.it/scuola/per-chi-insegna/siti-laz/laz-ebook/), [sostituzione di Booktab](https://assistenza.zanichelli.it/support/solutions/articles/4000224978-laz-ebook-sostituisce-booktab-cosa-cambia-).

## Verifiche pubbliche e autenticazione

- Playwright ha aperto la home e il modulo di accesso. Il bundle pubblico della home osservato è `https://staticmy.zanichelli.it/homepage/app/static/js/main.7ad590c1.js`; i nomi dei bundle possono cambiare.
- Il componente d'identità caricato dinamicamente effettua `GET https://idp.zanichelli.it/v1/user` con `credentials: include` e `Accept: application/json`.
- Il modulo ufficiale invia il login a `/v4/login/` dello stesso servizio d'identità. Il downloader non deve inviare username/password: il login deve restare manuale nel browser isolato.
- Il menu pubblico `https://staticmy.zanichelli.it/myz/navbar/nav.default.json` indica `https://my.zanichelli.it/dashboard/home` come home autenticata.
- La navigazione senza account a `/dashboard/home` torna alla home di login. Successivamente l'utente ha effettuato manualmente l'accesso e ha aperto un ebook durante la discovery.
- La libreria autenticata usa l'header `myz-token`, senza Bearer, sul solo origin `https://api-catalogo.zanichelli.it`. Il bundle ufficiale della dashboard legge il cookie `myz_token` e lo imposta in questo header. Questi nomi sono confermati nel traffico e nel codice; sono usati dal provider per estrazione e validazione.
- `/v1/user` dell'IDP usa una sessione distinta con cookie; non viene usato come endpoint di libreria né vengono salvati i cookie generici del lettore.

## Libreria autenticata confermata

`GET https://api-catalogo.zanichelli.it/v3/dashboard/licenses/real` con `myz-token` ha restituito HTTP 200 e `{ realLicenses: [...] }`; nel campione sono presenti quattro licenze. Ogni licenza contiene `volume` con `isbn`, `title`, `image`, `ereader_url`, `ereader_info`. Il componente ufficiale mostra un ebook solo quando `ereader_url` e `ereader_info.id` sono presenti. Il provider usa questa stessa condizione e deduplica per ISBN; non mescola la libreria con il catalogo pubblico. I nomi dei campi autore non sono stati verificati e vengono omessi.

Le licenze temporanee sono su `/v3/dashboard/licenses/temp`, con query `types[]`; la risposta osservata è vuota e questi filtri non sono ancora configurati. Il provider attuale mostra le licenze reali, non tutte le eventuali licenze temporanee per docenti.

Login e libreria sono registrati nella GUI e nella CLI `--provider zanichelli`; il vault è `token-zanichelli.bin`, cifrato con safeStorage. In alternativa la CLI legge `ZANICHELLI_TOKEN` dall'ambiente o da `.env`. Il formato della libreria è stato osservato dal vivo; l'implementazione di estrazione, normalizzazione e blocco del download è coperta da test con risposte simulate.

## Lettore osservato e limite del download

Origin del lettore: `https://webreader.zanichelli.it`. La sessione osservata ha eseguito:

- `GET /downloadapi/auth/contentserver/book/<id>/HTML5/<id>/downloadBook?state=...` e una variante `FIXED_EPUB_IMAGE`; header `usertoken` e `x`. Le risposte contengono `responseCode`, `content_ownership`, `privateKey`, `lastPageFolio`, `isbn`, `clientBookId`, `jwtToken`. I valori delle chiavi e dei token non sono stati salvati.
- Percorsi contenuto `/<id>/html5/<id>/META-INF/container.xml`, `OPS/content.opf`, `OPS/pages.json`, `OPS/page_position.json`, `OPS/search.json`, `OPS/toc.xml`.
- `OPS/pages.json` contiene 900 elementi nel libro osservato, con campi `path`, `image`, `width`, `page`, `height`, `markups`. `OPS/search.json` contiene `foliono` e `pageno`, che vanno distinti prima di implementare la selezione per numeri stampati.
- Pagine `OPS/images/pageNNNN.svgz`, MIME `image/svg+xml`, HTTP 200 durante lo sfoglio. Il nome di file non viene usato per dedurre gli URL di tutte le pagine.
- `OPS/enc.key` e `OPS/enc_resource.key`, MIME `application/pgp-keys`, e libreria `libzone.wasm`. Sono presenti anche cookie firmati CloudFront. I valori non sono stati acquisiti né incorporati nel codice.

## Integrazione del download

Il download è abilitato usando come riferimento [Leone25/zanichelli-downloader](https://github.com/Leone25/zanichelli-downloader), con licenza MIT inclusa in `licenses/zanichelli-downloader-MIT.txt`. Le osservazioni sopra descrivono la discovery precedente; il flusso completo seguente deriva dal codice del repository, non da una nuova verifica autenticata.

- Il login ufficiale resta manuale. Il provider raccoglie `myz_token` per il catalogo e il cookie `token` dell’identità, quindi li conserva insieme nel vault safeStorage. I vecchi token singoli continuano a funzionare per la libreria; per scaricare occorre effettuare nuovamente l’accesso.
- L’URL `ereader_url` proviene soltanto dalle licenze reali dell’account. La richiesta autenticata segue il reindirizzamento al lettore, distinguendo Kitaboo/laZ Ebook da Booktab precedente.
- Kitaboo: scambio della sessione su `microservices.kitaboo.eu/v1/zanichelli/user/123/pc/validateUserToken`, dettagli su `zanichelliservices.kitaboo.eu/DistributionServices/services/api/reader/distribution/123/pc/book/details`, accesso tramite il percorso `downloadBook` del lettore. Le costanti `123` e `123234234` sono quelle del riferimento.
- `META-INF/container.xml` indica il manifest OPF. Per i libri `BOOK`, lo spine definisce l’ordine e ogni risorsa deve esistere nel manifest: una pagina mancante interrompe il download. Le risorse SVG/PNG/JPEG vengono decodificate con il formato RSA-PKCS1/AES-128-CBC del riferimento; eventuali risorse già leggibili o gzip vengono accettate. Chiavi e cookie firmati restano solo in memoria. Gli SVG vengono convertiti con PDFKit, conservando le dimensioni e incorporando le immagini referenziate. Risorse esterne e riferimenti a file locali sono rifiutati.
- I libri `EPUB` vengono esportati con `mimetype` non compresso come prima voce, container, OPF e tutte le risorse del manifest. Il salvataggio è atomico tramite `.part`; non si applicano campioni, selezioni di pagine, compressione JPEG o OCR. Una cancellazione richiede di ripetere l’esportazione EPUB.
- Booktab precedente: sessione `POST /api/v1/sessions_web`, `spine.xml` con fallback `volume.xml`, configurazione delle unità e PDF indicati da `content`/`filesMap`. Le unità vengono divise in pagine singole per la pipeline comune. Edizioni XPS/XOD restituiscono un errore esplicito e non generano un PDF parziale.

Il trasporto limita le richieste agli origin ufficiali del catalogo e del lettore e dei due servizi Kitaboo, gestisce cookie per dominio/percorso, timeout, annullamento e retry. Header di autenticazione non vengono propagati tra reindirizzamenti. Nessun codice remoto viene eseguito.

PDF in `<cartella>/zanichelli/<titolo>.pdf`, EPUB in `<cartella>/zanichelli/<titolo>.epub`. La cache PDF contiene soltanto pagine PDF e un manifest con identificativi, senza token, chiavi o URL firmati. La selezione dei numeri stampati richiede calibrazione manuale: gli ID dello spine non sono etichette di pagina.

## Verifica e limiti

### Correzioni verificate con account reale

Il collegamento `ereader_url` delle licenze osservate parte da `https://webmy.zanichelli.it/ebook/<isbn-ebook>`, distinto dalla dashboard `my.zanichelli.it`. Questo origin è consentito per l’avvio del lettore e riceve esclusivamente il cookie d’identità; il reindirizzamento porta a `webreader.zanichelli.it/6.0/zanichelli/` con parametri di sessione nel frammento. Il cookie non viene propagato ai servizi Kitaboo.

Le confezioni 3A+3B e 4A+4B sono un solo ebook per licenza. Il provider legge `OPS/toc.xml`: ogni nodo contiene `feild3="Volume A"` oppure `feild3="Volume B"`, oltre al riferimento XHTML presente nello spine. I confini derivano da questi riferimenti, senza usare l’ISBN per indovinare le pagine. L’ebook 4A+4B verificato comprende 900 pagine, separate in 525 pagine per 4A e 375 per 4B. La libreria mostra ciascun volume con titolo completo, conteggio pagine e ID distinto (`<id>__volume_A/B`), quindi cache ed esportazioni non si sovrascrivono. Anche ebook distinti sotto lo stesso ISBN mantengono identità e collegamenti distinti. Le confezioni prive di confini verificabili restituiscono un errore esplicito.

Gli SVG reali incorporano anche immagini `data:image/jpg;base64,...`: il convertitore accetta sia `jpg` sia `jpeg`. Sono stati scaricati, convertiti e verificati campioni di una pagina per entrambi i volumi 4A e 4B; i PDF misurano 558 × 754 punti. Il download integrale di 900 pagine non è stato eseguito durante questa verifica.

`test/zanichelli.test.js` verifica con credenziali sintetiche il login, libreria, scambio di sessione, RSA/AES, ordine delle pagine, conversione SVG con immagini, ripresa, pagine corrotte, calibrazione, EPUB, Booktab PDF e rifiuto XPS. Il test desktop verifica il login a due cookie, safeStorage e i controlli dell’interfaccia. Il test confezionato verifica anche PDFKit nell’app.asar.

Non è stato eseguito un download completo con un account Zanichelli reale. Le licenze temporanee per docenti restano escluse. Font personalizzati, filtri SVG o risorse non supportate dal convertitore possono richiedere ulteriori adattamenti; gli errori di conversione interrompono il download. Le unità Booktab vengono lette in memoria durante i metadati e vengono richieste nuovamente alla ripresa. Gli EPUB vengono ricreati integralmente. I libri molto grandi richiedono memoria per l’assemblaggio PDF.

Per una nuova discovery: `npm run discover -- --provider zanichelli --headed`, login manuale, apertura del libro e almeno tre pagine sfogliate. Il report salva solo schemi e nomi, senza valori delle credenziali. Non condividere cookie, token, chiavi o URL firmati.
