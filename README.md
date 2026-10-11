# MyDbook Downloader

App desktop Electron e CLI Node.js per creare PDF dai libri disponibili nel tuo account MyDbook. Versione, nome e icona dell'app sono configurati in `package.json`. L'icona è un placeholder locale, rigenerabile con `npm run icons`.

## Sviluppo desktop

Per installare e buildare Electron serve **Node.js 22.12+**, consigliato Node 24 LTS. La logica della CLI resta compatibile con Node 18+.

```powershell
npm ci
npm run dev
```

`npm start` apre anch'esso la GUI. Non è necessario installare Chromium o Playwright per usare l'app desktop: la conversione immagini usa il Chromium incluso in Electron.

1. Incolla lo usertoken nel campo mascherato e premi **Carica i miei libri**.
2. **Ricordami** salva il token esclusivamente cifrato con `safeStorage`. Senza questa opzione resta in memoria per la sessione. Dopo il caricamento il campo viene svuotato. Un token salvato viene riutilizzato senza mostrarlo nel renderer; togliendo la spunta, il file cifrato viene cancellato.
3. Seleziona un libro e scegli la cartella di output con il dialogo di sistema.
4. Imposta eventualmente **Comprimi le immagini** e la qualità JPEG (1–100, predefinita 80).
5. Premi **Scarica PDF**. Le barre mostrano il conteggio reale delle pagine scaricate/riutilizzate e poi assemblate. Durante il salvataggio finale il progresso è indeterminato. **Annulla** conserva le pagine completate per riprendere il download.

Il token non compare nei log né nei file di impostazioni. La GUI non legge `.env`. Il file cifrato `token.bin` e le impostazioni di output sono nei dati utente dell'app (`app.getPath('userData')`, su Windows normalmente `%APPDATA%\MyDbook Downloader`). Non copiare `token.bin` tra account Windows: è protetto dalle credenziali del sistema. Su Linux il salvataggio viene rifiutato se `safeStorage` usa il backend non sicuro `basic_text`; si può usare la sessione senza Ricordami.

Le pagine sono in `userData/tmp/<id>/` nell'app installata. Durante lo sviluppo vengono riutilizzate le pagine della cartella `tmp/` del progetto, anche se scaricate dalla CLI. Manifest e cache non contengono URL firmati o token. Per libri molto grandi resta necessaria memoria sufficiente: pdf-lib costruisce il documento in RAM; la modalità JPEG riduce generalmente le dimensioni e la memoria occupata dalle immagini.

## Build e installer

```powershell
npm run dist
npm run verify:package
```

Il build Windows x64 genera `dist/MyDbook Downloader-1.1.0-Setup.exe`, un installer **NSIS** per utente, con scelta della cartella d'installazione. Il nome dell'artifact segue automaticamente `productName` e `version` di `package.json`. Nessuna pubblicazione automatica. Per firmare una release si possono configurare le credenziali di code signing di electron-builder; il build locale senza certificato produce un installer non firmato.

Target opzionali, da eseguire sul relativo sistema operativo:

```sh
npm run dist:mac    # DMG e ZIP
npm run dist:linux  # AppImage
```

Il packaging usa una lista esplicita di file applicativi e le sole dipendenze di produzione. **Playwright, `.env`, `keys.env`, `tmp/`, `output/`, discovery, test e token salvati non sono inclusi**. `verify:package` controlla il contenuto di `app.asar`. Electron include il proprio runtime Chromium; non include il runtime o i browser Playwright.

Il workflow `.github/workflows/build.yml` esegue test e build su `windows-latest` con Node 24, controlla il pacchetto e carica l'installer come artifact **mydbook-downloader-windows**. Parte su push a main/master, tag `v*`, pull request o manualmente. Non richiede token MyDbook o altri segreti.

## CLI e discovery

Per la CLI e i test del convertitore occorre installare Chromium di Playwright (dipendenza di sviluppo):

```powershell
npx playwright install chromium
npm run cli
npm run cli -- --list
npm run cli -- --book GIAC23_G2350103A
npm run cli -- --book GIAC23_G2350103A --sample 3
npm run cli -- --book GT2022_G2350106A --compress --quality 70
npm run discover -- --book GIAC23_G2350103A
```

Solo la CLI/discovery legge `MYDBOOK_TOKEN` da `.env` o dall'ambiente (l'ambiente ha precedenza). Non pubblicare `.env` o `keys.env`: sono ignorati da Git. `Ctrl+C` interrompe la CLI; rilancia lo stesso comando per riprendere dalle pagine valide in `tmp/<id>/`. I file `.part` vengono riscaricati. Se cambia l'elenco pagine, sposta la relativa cartella tmp e riparti.

La CLI salva in `output/<titolo>.pdf`. La GUI salva nella cartella selezionata. La compressione aggiunge `-compresso-q80` (o la qualità scelta) al nome, lasciando disponibili i PNG originali. `--sample N` genera un file `-campione-N`, senza presentarlo come volume completo. Un file con lo stesso nome viene sostituito solo dopo la generazione completa.

La discovery Playwright ispeziona l'autenticazione, apre libreria e libro e sfoglia alcune pagine. Il riepilogo verificato è in [docs/endpoints.md](docs/endpoints.md); il report oscurato è in `docs/discovery.json`. Se non può autenticarsi, si ferma e indica se serve un HAR autenticato, senza inventare endpoint.

## Architettura e verifiche

- `electron/main.js`: finestra, validazione IPC, autenticazione, libreria, dialogo cartelle, archivio cifrato e gestione dei job.
- `electron/preload.cjs`: `contextBridge` con sole operazioni nominate; nessun accesso generico a IPC, file o Node dal renderer.
- `electron/ui/`: HTML/CSS/JS vanilla italiani; CSP, `contextIsolation: true`, `nodeIntegration: false`, sandbox e navigazione esterna disabilitata.
- `electron/download-worker.js`: esegue **gli stessi** `src/api.js`, `src/books.js` e `src/pdf.js` fuori dal thread main. Concorrenza 4, delay, retry e ripresa restano condivisi con la CLI. L'annullamento è cooperativo e termina il worker dopo due secondi se necessario, anche durante `pdf.save()`.
- `src/image-codec.js`: unica implementazione della conversione DOM. Electron la esegue in una finestra nascosta isolata; la CLI tramite Playwright caricato dinamicamente. Nessuna duplicazione della logica di download o di conversione.
- Il main rifiuta IPC da frame non autorizzati e valida gli identificativi; renderer e libreria non possono scegliere percorsi arbitrari o inviare credenziali ad altri host.

```powershell
npm test
npm run test:desktop
npm run verify:package
npm run test:desktop -- --packaged
```

I test desktop usano un profilo separato in `tmp/desktop-smoke`, token fittizi e risposte offline. Verificano isolamento, `safeStorage` reale, bridge IPC, scelta cartella, conversione nel Chromium Electron, assemblaggio nel worker, annullamento ed errore token scaduto. `npm run test:desktop -- --live` richiede un token attuale in `.env` e verifica anche un campione di tre pagine reali, senza salvarne la credenziale. I test unitari coprono retry, limite di concorrenza, ripresa, immagini corrotte, compressione, dimensioni delle pagine e archivio cifrato.

Supportati i libri con pagine raster a impaginazione fissa (WebP, PNG, JPEG). Libri solo liquidi, kit senza pagine fisse o pagine in PDF/SVG vengono segnalati come non supportati. Il PDF conserva l'ordine del lettore e le dimensioni in pixel, usate come punti PDF (1 pixel = 1 punto); non sono disponibili misure fisiche di stampa. Il testo resta rasterizzato. La compressione JPEG introduce perdita di dettaglio.

Riferimenti: [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [packaging NSIS](https://www.electron.build/nsis/).
