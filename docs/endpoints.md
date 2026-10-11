# Discovery MyDbook

Verifica effettiva del 11 ottobre 2026 tramite Playwright e Chromium, su https://mydbook.olhos.it/mydbook. Autenticazione riuscita; libreria: 18 libri. Aperto `GIAC23_G2350103A` e sfogliate più pagine: 1.080 pagine, risposte API e immagini HTTP 200. `npm run discover` aggiorna `docs/discovery.json` con il traffico e gli schemi, senza valori di credenziali o parametri delle query.

## Autenticazione

Il bundle Next.js `pages/_app-b163f860c1b7aabc.js` contiene il lettore di `document.cookie` e riferimenti al cookie **userToken**, con path `/`. Le richieste API del lettore usano **Authorization: Bearer <MYDBOOK_TOKEN>**. Playwright inietta il cookie prima della navigazione. Nessuna query con token e nessuna chiave localStorage sono necessarie per questo accesso. Il sito usa anche localStorage per refresh/sessione: lo script richiede un userToken attuale e non implementa il refresh.

Il client Node invia cookie, Authorization e Referer sul solo host `mydbook.olhos.it`. Questi header sono stati sufficienti nella prova reale; non è stato verificato quale sottoinsieme minimo sia indispensabile. Gli URL firmati delle immagini hanno restituito 200 anche usando il contesto autenticato Playwright.

## Libreria completa

**GET /mydbook/dashboard**: HTML server-rendered Next.js. I libri non arrivano da un endpoint XHR dedicato nella navigazione osservata: sono nel JSON del tag `script#__NEXT_DATA__`, sotto `props.pageProps`:

```text
blocks[] = { type: "VolumesBlock", blockConfiguration: {
  i18n: { key: "user_my_books_block" },
  volumes: [{ bookcode, title, subtitle, coverUrl, filterValue }]
} }
user.bookcodes: string[]
```

Selezionare solo il blocco `user_my_books_block`, intersecato con `user.bookcodes`. Gli altri blocchi contengono visite recenti e novità. Anche la home contiene libri, ma la libreria è la fonte usata dal downloader. Non salvare l'intero `__NEXT_DATA__`: contiene token e dati dell'utente.

## Metadati e ordine delle pagine

**GET /mydbook/{bookcode}**: navigazione osservata dal click su un volume. Reindirizza alla pagina ricordata, per esempio **/mydbook/{bookcode}/721/fixed**. Nel `__NEXT_DATA__` della destinazione:

```text
props.pageProps.bookcode: string
props.pageProps.listPages: [{ id: string, position: "C" | "L" | "R" }]
props.pageProps.infoFixedPage: {
  title, subtitle, permission, status, coverUrl, index[],
  pages: [{ title, url, text, reflowableCanonicalPage, drawingsUrl, id, position }], ...
}
```

Il totale è `listPages.length`. L'ordine è quello dell'array: non ricostruirlo dal numero stampato. Il campione osservato va da id `1` a `1080`; non si assume che tutti i libri abbiano identificatori consecutivi. `infoFixedPage.pages` contiene soltanto le pagine visualizzate, non il libro completo. Libri con sole risorse o con layout liquido possono non avere `listPages`; vengono segnalati come non supportati.

## URL delle singole pagine

**GET /data/v1/fixedlayout/mydbook/{bookcode}/details/{pageId}/{pageId}**. Osservate richieste per 719, 720, 721 e pagine successive con header Authorization. Risposta:

```text
{ permission: string, pages: [{
  title: string, url: string, text: string,
  drawingsUrl: string, id: string, position: string
}] }
```

Usare il campo `url` della pagina corrispondente all'id. Il percorso osservato è:

```text
/contents-private/domains/mydbook.olhos.it/tenants/mydbook/volumes/{bookcode}/fixed/converted/{indice}.webp
?Expires=[omesso]&Key-Pair-Id=[omesso]&Signature=[omesso]
```

Le immagini sono **image/webp**. Il filename dell'immagine non coincide necessariamente con l'id della pagina (id 721 può riferirsi a 720.webp): non costruire questi URL. Usare sempre l'URL restituito, con firma corrente, e non persisterlo. Nessun PDF integrale è stato osservato. La conversione WebP → PNG tramite Chromium/canvas conserva larghezza e altezza; pdf-lib crea pagine di pari dimensioni, senza ridimensionamento.

## Altre richieste osservate

- GET `/data/v1/domains/current/tenants/mydbook/toc`: `{ levels[], items[] }`, navigazione del catalogo.
- GET `/data/v1/domains/current/home`: informazioni generali del dominio.
- GET `/data/v1/domains/current/tenants/mydbook/info`: configurazione del tenant.
- GET `/data/v1/volumes/mydbook/{bookcode}/favourites`: `{ favouriteVolumes[] }`.
- GET `/data/v1/volumes/mydbook/{bookcode}/bookmarks`: array di segnalibri.
- GET `/data/v1/volumes/mydbook/{bookcode}/visited?format=...&page=...`: traccia visite; il downloader non la chiama.
- GET `/data/v1/media/mydbook/{bookcode}/details/{pageId}/{pageId}`: `{ pagesGroups[], medias[] }`, risorse allegate, non pagine del libro.
- Next.js usa anche `/_next/data/{buildId}/...json`; il buildId cambia. Il downloader estrae i dati HTML e non fissa quel buildId.

## Errori e limiti

401/403: token scaduto o permessi negati; 403 può anche indicare vincoli dell'account. 404: volume o pagina non trovato. L'assenza di `user.token` nell'HTML indica sessione non autenticata anche con HTTP 200. 429 e 5xx: retry con backoff, rispettando Retry-After. Se cambiano autenticazione o schema, ripetere la discovery; se l'accesso fallisce, fornire un HAR della libreria e del lettore autenticati, senza inventare endpoint.
