# mydbook-downloader

Node.js 18+, ES modules. Scarica le pagine dei libri presenti nella tua libreria MyDbook e crea un PDF locale. Chromium è necessario anche per decodificare e convertire le immagini.

```powershell
npm install
npx playwright install chromium
```

In `.env` inserisci `MYDBOOK_TOKEN=...`. Non pubblicare il file. Il progetto esistente conteneva `keys.env`: ne è stata creata una copia `.env`. Entrambi sono ignorati da Git. Una variabile MYDBOOK_TOKEN già presente nell'ambiente ha precedenza su `.env`.

```powershell
npm start
npm start -- --list
npm start -- --book GIAC23_G2350103A
npm start -- --book GIAC23_G2350103A --sample 3
npm start -- --compress
npm start -- --book GT2022_G2350106A --compress --quality 70
npm run discover -- --book GIAC23_G2350103A
npm test
```

Il menu mostra titoli e id. Download con 4 worker, breve pausa, retry su rete/429/5xx e barra di progresso. `Ctrl+C` interrompe; rilancia lo stesso comando per riprendere. Le pagine PNG complete in `tmp/<id>/` vengono validate e saltate; i file `.part` vengono riscaricati. Il manifest conserva solo gli id ordinati, senza firme o token. Se il libro è cambiato, sposta la sua cartella tmp e riparti.

Il PDF completo viene salvato in `output/<titolo-sanitizzato>.pdf`; `--sample N` genera invece `<titolo>-campione-N.pdf`, mantenendo le pagine utili per un successivo download completo. Un PDF con lo stesso nome viene sostituito solo quando la nuova generazione è completa. Per libri molto grandi serve memoria sufficiente: pdf-lib costruisce il documento in RAM.

`--compress` converte le immagini in JPEG con qualità **80/100** prima di inserirle nel PDF, mantenendo le dimensioni delle pagine. `--quality N` sceglie un intero da 1 a 100 e attiva anche la compressione: valori più bassi producono generalmente file più piccoli, con perdita di dettaglio. La trasparenza viene sostituita con uno sfondo bianco. I PNG in `tmp/` restano invariati e vengono riutilizzati, quindi puoi rigenerare il PDF senza riscaricare le pagine. Il risultato si chiama `<titolo>-compresso-q80.pdf` (o la qualità scelta); con `--sample` il suffisso viene aggiunto al nome del campione. Questa modalità può ridurre anche memoria e tempo di salvataggio; la riduzione dipende dalle immagini. La creazione del PDF ora mostra una barra di progresso, seguita dalla fase di salvataggio.

La discovery è automatica: ispeziona i bundle pubblici, inietta il cookie confermato dal codice, apre libreria e libro e sfoglia alcune pagine. `--headed` mostra Chromium. Il riepilogo verificato è in [docs/endpoints.md](docs/endpoints.md); gli schemi e il traffico oscurato vengono aggiornati in `docs/discovery.json`. Nessun HAR grezzo o stato autenticato viene scritto. In caso di accesso fallito si ferma e indica se serve un HAR autenticato.

Supportati i libri con pagine immagine a layout fisso, osservate come WebP. WebP, PNG e JPEG vengono decodificati da Chromium e convertiti in PNG tramite canvas senza resize. Le pagine PDF, i volumi solo liquidi e i kit senza pagine fisse non sono stati osservati come formato delle pagine e non sono supportati. Gli URL firmati vengono recuperati dall'API, mai ricostruiti.

Il PDF conserva le dimensioni in pixel delle immagini, usate come punti PDF (1 pixel = 1 punto), e l'ordine del lettore. Il sito non ha fornito dimensioni fisiche di stampa in mm o DPI; il testo nel PDF resta rasterizzato.

Usa solo libri cui hai accesso con il tuo account. Token scaduti, accesso negato e pagine mancanti producono messaggi in italiano; nessun PDF parziale viene presentato come completo.
