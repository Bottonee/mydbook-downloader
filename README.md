# MyDbook Downloader

Zanichelli / laZ Ebook: login nel sito ufficiale, sessione cifrata, libreria delle licenze reali e download. I libri Kitaboo a impaginazione fissa vengono convertiti in PDF nell’ordine del manifest, quelli liquidi esportati in EPUB. Sono supportate anche le unità PDF dei vecchi Booktab; il formato XPS/XOD restituisce un errore esplicito. Il flusso deriva da [Leone25/zanichelli-downloader](https://github.com/Leone25/zanichelli-downloader), con attribuzione MIT in [licenses/zanichelli-downloader-MIT.txt](licenses/zanichelli-downloader-MIT.txt). Dettagli in [docs/zanichelli-endpoints.md](docs/zanichelli-endpoints.md). L’integrazione è verificata con test simulati, desktop e campioni reali dei volumi 4A e 4B. Le confezioni come 4A+4B vengono separate usando i confini dell’indice del lettore e mostrate con titoli, PDF e cache distinti.

App Electron e CLI Node.js per i libri della propria libreria MyDBook e bSmart. MyDBook scarica immagini; bSmart scarica e unisce le risorse `page_pdf`, decifrandole quando necessario con il formato del lettore web. Il metodo bSmart deriva da [Leone25/bSmart-downloader](https://github.com/Leone25/bSmart-downloader), con attribuzione MIT in [licenses/bsmart-downloader-MIT.txt](licenses/bsmart-downloader-MIT.txt). Dettagli e limiti in [docs/bsmart-endpoints.md](docs/bsmart-endpoints.md).

## Sviluppo e uso

Per installare/buildare Electron: Node.js 22.12+, consigliato Node 24 LTS. La CLI resta compatibile con Node 18+.

```powershell
npm ci
npm run ocr:prepare
npm run dev
```

1. Scegli **Provider** e premi **Accedi e recupera token**. Completa manualmente il login nella finestra del sito ufficiale. L'app non raccoglie username o password.
2. Dopo l'estrazione e la validazione, la finestra si chiude, il token viene salvato cifrato e la libreria si carica automaticamente. Un token salvato viene verificato al riavvio e quando cambi provider. Su 401/403 si riapre il login; un download interrotto può essere riavviato dopo l'accesso.
3. Seleziona il libro e scegli la cartella. Per MyDBook puoi impostare la compressione JPEG (qualità 1–100, predefinita 80). bSmart conserva le pagine PDF originali, con testo e grafica: la compressione JPEG è disabilitata.
4. Premi **Scarica PDF** (per Zanichelli, **Scarica libro**). Il progresso conta pagine scaricate/riutilizzate e pagine assemblate, oppure le risorse EPUB. **Annulla** conserva le pagine PDF completate; gli EPUB interrotti vengono ricreati al prossimo tentativo.
   Per MyDBook puoi attivare **Rendi il PDF ricercabile (OCR)**: riconosce italiano e inglese sulle immagini originali e aggiunge uno strato di testo invisibile. Le pagine conservano l’aspetto originale e diventano ricercabili/selezionabili. Modelli e motore sono inclusi, senza connessione o invio dei libri a servizi esterni. L’OCR richiede più tempo e può sbagliare su formule, scansioni poco nitide e impaginazioni complesse. Per bSmart l’opzione è disabilitata: il testo dei PDF originali è già conservato.
5. **Disconnetti** cancella il token cifrato e i dati della sessione del provider selezionato. Nell'opzione avanzata **Inserisci token manualmente**, Ricordami è facoltativo.

La GUI non legge `.env`. I token non sono restituiti al renderer, non compaiono nei log e non vengono salvati nelle impostazioni. I vault `token-mydbook.bin` e `token-bsmart.bin` sono cifrati con `safeStorage` in `app.getPath('userData')` (Windows: normalmente `%APPDATA%\MyDbook Downloader`). Il vecchio `token.bin` viene migrato e rimosso. La cifratura dipende dallo stesso account/sistema; non copiare i vault tra account. Su Linux il backend `basic_text` è rifiutato: il login automatico richiede un archivio sicuro, il token manuale senza Ricordami resta disponibile.

Il browser di login usa una partition separata `persist:<provider>`, senza cache HTTP, con isolamento, sandbox e Node disabilitato. Solo origin e chiavi confermati nel config possono essere sorgenti di token. La lettura degli storage è in sola lettura. Cookie, storage e cache del profilo Chromium vengono cancellati al termine del flusso, al riavvio e alla disconnessione: la sessione viene ripristinata dal vault cifrato, non dal profilo browser. L'app non esporta HAR grezzi, risposte con credenziali o password.

PDF in `<cartella>/<provider>/<titolo>.pdf`. La compressione delle immagini conserva il suffisso `-compresso-q80`; un campione usa `-campione-N`. Cache nuove in `tmp/<provider>/<id>/` durante lo sviluppo/CLI e `userData/tmp/<provider>/<id>/` nell'app installata. I precedenti download MyDBook in `tmp/<id>/` vengono riutilizzati se hanno un manifest. I manifest contengono solo identificativi pagina, senza token o URL firmati. Se il manifest non coincide, il programma richiede di spostare la cache del libro. La cache conserva PNG per MyDBook e PDF delle singole pagine per bSmart. Le chiavi del lettore vengono recuperate dal sito e mantenute soltanto in memoria.

## CLI e discovery

La CLI recupera il token dello stesso provider dal vault dell'app, sullo stesso sistema/account. Se l'app è aperta, usa il suo contesto di cifratura; altrimenti un piccolo processo Electron legge il vault. In entrambi i casi restituisce il token su una pipe locale, senza token in argomenti, stdout, log o file temporanei. Questo evita errori al primo avvio quando la chiave del profilo Windows non è ancora stata salvata da Chromium. La CLI non apre una finestra di login; se la sessione manca/scade, accedi dall'app desktop. In alternativa legge `MYDBOOK_TOKEN` o `BSMART_TOKEN` da `.env`/ambiente. L'ambiente ha precedenza; questi file sono ignorati da Git.

Per convertire immagini nella CLI serve Chromium Playwright (il desktop usa Chromium Electron):

```powershell
npx playwright install chromium
npm run cli -- --provider mydbook --list
npm run cli -- --provider mydbook --book GIAC23_G2350103A --compress --quality 70
npm run cli -- --provider mydbook --book GIAC23_G2350103A --sample 3
npm run cli -- --provider mydbook --book GIAC23_G2350103A --ocr --compress --quality 80
npm run cli -- --provider bsmart --list
npm run cli -- --provider zanichelli --list
npm run cli -- --provider zanichelli --book 9780000000001
npm run cli -- --provider bsmart --book 12345
npm run discover -- --provider mydbook --book GIAC23_G2350103A
npm run discover -- --provider bsmart --headed
npm run discover -- --provider zanichelli --headed
```

`Ctrl+C` interrompe la CLI; ripeti il comando per riprendere. Per bSmart non serve Chromium per assemblare le pagine e `--compress` non modifica i PDF nativi. La discovery MyDBook mantiene il flusso esistente con token nell'ambiente: [docs/endpoints.md](docs/endpoints.md). Quella bSmart permette login manuale e navigazione, quindi salva solo schemi, nomi di cookie/header e query senza valori in `docs/bsmart-discovery.json`. I nomi e gli schemi vanno comunque controllati prima di condividere il report. Per diagnosticare un libro non funzionante serve un HAR oscurato con libreria e tre pagine sfogliate: rimuovere token, cookie, firme URL e dati personali. Il mapping `page_pdf` e la decifratura sono stati ricavati dal repository indicato, senza inventare endpoint.

## Pagine singole e intervalli

Per Zanichelli la selezione sui PDF richiede **Calibra la numerazione**: gli ID dello spine non vengono interpretati come numeri stampati. EPUB, campioni EPUB e selezione di pagine EPUB non sono combinabili. Compressione JPEG e OCR sono disabilitati per Zanichelli. Se avevi già effettuato l’accesso prima dell’integrazione, premi **Disconnetti**, quindi **Accedi e recupera token**: il vecchio `myz-token` consente solo la libreria, mentre il download richiede anche il cookie di sessione `token`. Entrambi vengono conservati insieme nel vault cifrato `token-zanichelli.bin`, mai nel renderer o nella cache delle pagine. La CLI legge la stessa sessione; `ZANICHELLI_TOKEN` con il solo token della dashboard resta compatibile con `--list`.

Nel campo **Numeri stampati sul libro** puoi inserire `1, 2, 3, 4`, `17-25` o una combinazione come `1, 2, 17- 25`. Gli intervalli sono inclusivi, i duplicati vengono rimossi e le pagine mantengono l’ordine del libro. Lascia il campo vuoto per scaricare tutto, comprese copertina e pagine iniziali. Il nome del PDF parziale include `-pagine-...`, così non sovrascrive il libro completo.

La selezione usa le etichette delle pagine, non gli ID degli asset né il numero progressivo del PDF. Per bSmart legge `resource.title`: in un libro reale sono state osservate pagine `I–VIII` seguite da `1, 2, 3…`; i numeri romani e la copertina non corrispondono a pagina 1. Per MyDBook legge `title` dall’elenco, quando disponibile, e dai dettagli delle singole pagine: la prima lettura può richiedere alcuni minuti, mostra un progresso ed è annullabile. Le etichette sono conservate in `page-labels.json`, senza token o URL firmati; le immagini non vengono scaricate per questa lettura.

Se il provider non espone numeri utili, usa **Calibra la numerazione**: indica la posizione digitale della prima pagina numerata e il numero effettivamente stampato. Ad esempio, se dopo copertina e indice la nona pagina digitale mostra `1`, inserisci **9** e **1**. La richiesta `17-25` seleziona così le posizioni digitali 25–33, senza contare le otto pagine iniziali. La calibrazione prevale sulle etichette del provider e presuppone una sequenza consecutiva dopo il punto iniziale. Per numerazioni che ripartono o hanno salti, usa le etichette del provider; numeri mancanti o ripetuti producono un errore esplicito. Non viene indovinato uno scarto e non viene usato OCR per dedurre i numeri.

```powershell
npm run cli -- --provider bsmart --book 12345 --pages "1, 2, 17-25"
npm run cli -- --provider mydbook --book GIAC23_G2350103A --pages "17-25" --first-digital-page 9 --first-book-page 1
```

`--pages` non si combina con `--sample`; compressione e OCR restano disponibili. La cache conserva i nomi basati sulla posizione originale, quindi download parziali, altri intervalli e libro completo riutilizzano le stesse pagine. I PDF esportati includono anche le etichette di pagina per i lettori che le supportano, se disponibili per tutte le pagine esportate. La verifica autenticata della numerazione bSmart è riuscita; per MyDBook il tentativo attuale ha restituito 404 e la nuova mappatura è stata verificata con risposte simulate.

## Build e installer

I PDF con OCR hanno il suffisso `-ocr.pdf`, anche insieme a compressione/campione. I risultati OCR delle singole pagine sono conservati accanto ai PNG in cache, con un hash dell’immagine: annullare e riprendere riutilizza il testo già riconosciuto; se l’immagine cambia, l’OCR viene rifatto. Per disattivarlo basta togliere la spunta. Su bSmart `--ocr` viene ignorato senza rasterizzare o riconoscere nuovamente le pagine.

```powershell
npm run dist
npm run verify:package
```

Genera `dist/MyDbook Downloader-1.6.0-Setup.exe`, installer NSIS Windows x64 per utente con cartella selezionabile. Nome, versione e icona placeholder provengono da `package.json`; `npm run icons` rigenera l'icona. Nessuna pubblicazione automatica. Target opzionali sul relativo sistema: `npm run dist:mac` (DMG/ZIP), `npm run dist:linux` (AppImage). Senza un certificato di code signing l'installer è non firmato. Se un'app avviata da `dist/win-unpacked` blocca il rebuild, usa `npm run dist -- --config.directories.output=dist/1.6.0` e verifica il relativo `app.asar`.

La whitelist del pacchetto include tutti i provider e la pipeline condivisa, con le sole dipendenze di produzione. Playwright, `.env`, cache, output, test, script discovery e vault sono esclusi. `verify:package` controlla `app.asar`. GitHub Actions esegue test unitari e desktop offline, build e verifica su `windows-latest` con Node 24; carica l'installer nell'artifact **mydbook-downloader-windows**. Non servono token degli account.

## Architettura e test

- `src/providers/index.js`: registro con `id`, `name`, `loginUrl`, `extractToken`, `isTokenValid`, `listBooks`, `getPages`, `downloadPage`. Config, header e campi specifici nei file `<provider>.config.js`. `bsmart-crypto.js` legge il formato MessagePack/AES-CBC e recupera la chiave dal bundle pubblico, senza eseguire codice remoto né salvare la chiave.
- `src/api.js`: trasporto HTTP condiviso con retry/backoff, timeout, annullamento e credenziali limitate all'origin del provider.
- `src/download.js`: pipeline unica per CLI e worker Electron; `src/books.js` gestisce quattro download concorrenti, delay, cache e ripresa; `src/pdf.js` assembla/comprime il PDF. Gli export precedenti di MyDBook restano compatibili.
- `electron/provider-login.js`: browser ufficiale isolato; tentativi di estrazione cookie → storage → header → URL, soltanto per i campi effettivamente configurati. bSmart usa l'header AUTH_TOKEN osservato nel codice ufficiale, MyDBook il cookie userToken.
- `electron/main.js`, `preload.cjs`, `ui/`: IPC validato, contextBridge con operazioni nominate e interfaccia vanilla italiana. Il renderer ha CSP, isolamento, sandbox e nessun accesso Node.
- `electron/download-worker.js`: download/PDF fuori dal thread UI; annullamento cooperativo, poi terminazione dopo due secondi se necessario.
- `src/image-codec.js`: stessa conversione DOM per Electron e Playwright, senza duplicazione.
- `src/ocr.js`: un worker Tesseract.js riutilizzato per libro; modelli locali italiano/inglese, cache OCR per hash, PDF con testo invisibile e annullamento. `scripts/prepare-ocr.mjs` prepara i modelli per CLI, sviluppo e packaging; `npm run ocr:prepare` li rigenera. Il motore e i modelli usano file reali fuori da app.asar; le dipendenze di test restano escluse.

```powershell
npm test
npm run test:desktop
npm run dist
npm run verify:package
npm run test:desktop -- --packaged
```

Test mockati per estrazione/ordine/origin, normalizzazione, validità token, paginazione bSmart, decifratura con chiave sintetica e unione di PDF nativi; test per concorrenza, retry, ripresa, pagine corrotte, dimensioni e compressione. La prova desktop verifica realmente safeStorage, login simulato offline, riconnessione, pipe CLI, disconnessione, selezione provider e worker PDF per entrambi i provider. Il recupero della chiave dal lettore pubblico è stato verificato anche dal vivo (`node scripts/verify-bsmart-reader.mjs`, senza mostrare o salvare il valore). Il download di un libro con account reale bSmart resta da verificare dall'utente.

Supportate le pagine raster MyDBook (WebP/PNG/JPEG) a impaginazione fissa e le risorse bSmart `page_pdf` contenenti una pagina ciascuna. Libri senza questi formati restituiscono un errore esplicito. Per MyDBook il PDF mantiene dimensioni in pixel usate come punti PDF e testo rasterizzato; JPEG può perdere dettaglio. Per bSmart sono copiate le pagine PDF preservandone dimensioni, testo e grafica. pdf-lib costruisce il PDF in RAM: i libri molto grandi richiedono memoria sufficiente.

Il test OCR usa il motore reale su immagini sintetiche in italiano/inglese: estrae il testo dal PDF, confronta il rendering pixel per pixel con quello senza OCR, verifica dimensioni, ripresa e annullamento durante il riconoscimento. `test/packaged-ocr-smoke.cjs` controlla il worker e i modelli dell'app confezionata. L’OCR è opzionale e disattivato inizialmente; il testo riconosciuto va verificato quando l’accuratezza è importante.
