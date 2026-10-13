import { parseStringPromise } from 'xml2js';
import { ApiError } from '../api.js';
import { safeId } from './common.js';
import { decodeSession } from './zanichelli-session.js';
import { ReaderHttp, READER, MICRO, DISTRIBUTION, BOOKTAB, WEBMY, officialUrl, contentUrl } from './zanichelli-http.js';
import { resourceKey, decryptPage } from './zanichelli-crypto.js';
import { pagePdf } from './zanichelli-pdf.js';
import { PDFDocument } from 'pdf-lib';

export async function parseXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ApiError('Manifest Zanichelli con dichiarazioni XML non supportate.');
  try { return await parseStringPromise(text); } catch { throw new ApiError('Manifest del libro Zanichelli non valido.'); }
}
export async function openReader(token, book, signal, { loadKey = true } = {}) {
  const { idpToken } = decodeSession(token);
  if (!idpToken) throw new ApiError('Per scaricare da Zanichelli accedi di nuovo con «Accedi e recupera token»: il solo myz-token permette di leggere la libreria.');
  const http = new ReaderHttp(idpToken, signal);
  const launch = officialUrl(book.readerUrl);
  if (!['https://my.zanichelli.it', WEBMY, READER, BOOKTAB].includes(launch.origin)) throw new ApiError('Collegamento ebook Zanichelli non supportato.');
  const result = launch.hash ? { location: launch } : await http.request(launch, { redirect: true });
  const location = result.location || result.url;
  if (location.origin === BOOKTAB) return booktabMetadata(http, launch);
  if (location.origin !== READER) throw new ApiError('Lettore Zanichelli non supportato per questo libro.');
  const params = new URL(location.hash.slice(1), READER).searchParams;
  const bookID = safeId(params.get('bookID') || '');
  const sourceToken = params.get('usertoken');
  if (!sourceToken) throw new ApiError('Sessione del lettore Zanichelli assente: ripeti l’accesso.', 401);
  const exchange = await http.json(`${MICRO}/v1/zanichelli/user/123/pc/validateUserToken?usertoken=${encodeURIComponent(sourceToken)}`);
  if (typeof exchange.userToken !== 'string' || !exchange.userToken || /[\r\n]/.test(exchange.userToken)) throw new ApiError('Il lettore Zanichelli non ha accettato la sessione.', 401);
  const details = await http.json(`${DISTRIBUTION}/DistributionServices/services/api/reader/distribution/123/pc/book/details?bookID=${bookID}`, { headers: { usertoken: exchange.userToken } });
  const readerBook = details?.bookList?.[0]?.book;
  if (!readerBook || !['BOOK', 'EPUB'].includes(readerBook.assetType)) throw new ApiError('Formato del libro Zanichelli non supportato.');
  const ebookId = safeId(String(readerBook.ebookID ?? ''));
  const access = await http.json(`${READER}/downloadapi/auth/contentserver/book/123234234/HTML5/${bookID}/downloadBook?state=online`, { headers: { usertoken: exchange.userToken, 'Accept-Encoding': 'identity' } });
  if (access.content_ownership === false || access.content_ownership === 'false') throw new ApiError('Il libro Zanichelli non è disponibile per questa sessione.', 403);
  const format = readerBook.assetType === 'EPUB' ? 'epub' : 'pdf';
  const root = `${READER}/${ebookId}/${format === 'epub' ? 'fixed_epub_image' : 'html5'}/${ebookId}/`;
  const containerText = await http.text(root + 'META-INF/container.xml');
  const container = await parseXml(containerText);
  const opfPath = container?.container?.rootfiles?.[0]?.rootfile?.[0]?.$?.['full-path'];
  if (typeof opfPath !== 'string') throw new ApiError('Percorso del manifest Zanichelli assente.');
  const opfUrl = contentUrl(opfPath, root);
  const opfText = await http.text(opfUrl);
  const opf = (await parseXml(opfText))?.package;
  const entries = opf?.manifest?.[0]?.item;
  if (!Array.isArray(entries) || !entries.length) throw new ApiError('Manifest Zanichelli privo di risorse.');
  const title = opf.metadata?.[0]?.['dc:title']?.[0];
  const base = new URL('.', opfUrl).href;
  const context = { http, root, base, entries, opfPath, opfText, containerText, format };
  if (format === 'epub') return { title: typeof title === 'string' ? title : book.title, format, pages: [], context };
  const spine = opf?.spine?.[0]?.itemref;
  if (!Array.isArray(spine) || !spine.length) throw new ApiError('Ordine delle pagine Zanichelli assente.');
  if (loadKey) {
    if (typeof access.jwtToken !== 'string' || !access.jwtToken || typeof access.privateKey !== 'string') throw new ApiError('Il lettore Zanichelli non ha restituito le credenziali del libro.', 403);
    const encryptedKey = await http.text(contentUrl('enc_resource.key', base), { headers: { authorization: access.jwtToken } });
    context.key = resourceKey(access.privateKey, encryptedKey);
  }
  const byId = new Map(entries.map(item => [item.$?.id, item.$]));
  const seen = new Set();
  const pages = spine.map((item, position) => {
    const id = item.$?.idref;
    if (typeof id !== 'string' || seen.has(id)) throw new ApiError('Identificativi pagina Zanichelli mancanti o duplicati.');
    seen.add(id);
    const resource = [byId.get(id), ...['svgz', 'png', 'jpg', 'jpeg'].map(ext => byId.get(`images${id}${ext}`))].find(entry => ['image/svg+xml', 'image/png', 'image/jpeg'].includes(entry?.['media-type']));
    if (!resource || typeof resource.href !== 'string') throw new ApiError(`Pagina Zanichelli ${position + 1}: nessuna immagine nel manifest. Download incompleto evitato.`);
    return { id, position, type: 'pdf', url: contentUrl(resource.href, base).href, mediaType: resource['media-type'], context };
  });
  return { title: typeof title === 'string' ? title : book.title, format, pages };
}

export async function downloadReaderPage(page) {
  if (page.buffer) return { buffer: page.buffer, type: 'pdf' };
  const { http, key } = page.context;
  let buffer = decryptPage(key, await http.buffer(page.url));
  if (page.mediaType === 'image/svg+xml') {
    // Inline only images referenced by the SVG. Never hand network URLs or file paths to PDFKit.
    let svg = buffer.toString('utf8');
    const pattern = /(<image\b[^>]*?\b(?:xlink:href|href)\s*=\s*)(["'])(.*?)\2/gi;
    const replacements = [];
    for (const match of svg.matchAll(pattern)) {
      const href = match[3];
      if (href.startsWith('data:')) continue;
      const imageUrl = officialUrl(href, page.url);
      // Also enforce containment within the package, allowing ../images references.
      contentUrl(imageUrl.href, page.context.root);
      const image = decryptPage(key, await http.buffer(imageUrl));
      const type = image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png' : image[0] === 255 && image[1] === 216 ? 'jpeg' : null;
      if (!type) throw new ApiError('Immagine SVG Zanichelli non supportata.');
      replacements.push([match[0], `${match[1]}${match[2]}data:image/${type};base64,${image.toString('base64')}${match[2]}`]);
    }
    for (const [before, after] of replacements) svg = svg.replace(before, after);
    buffer = Buffer.from(svg);
  }
  return { buffer: await pagePdf(buffer, page.mediaType, page), type: 'pdf' };
}

// Older Booktab editions expose whole PDF units. Split them before the common page cache/selection.
async function booktabMetadata(http, launch) {
  const response = await http.request(`${BOOKTAB}/api/v1/sessions_web`, { headers: {}, method: 'POST' });
  let session;
  try { session = JSON.parse(response.buffer.toString()).session; } catch {}
  if (typeof session !== 'string' || !session || /[;\r\n]/.test(session)) throw new ApiError('Sessione Booktab non valida.', 401);
  await http.jar.setCookie(`booktab_token=${session}; Secure; Path=/`, BOOKTAB);
  const isbn = safeId(launch.pathname.split('/').filter(Boolean).at(-1) || '');
  const root = `${BOOKTAB}/api/v1/resources_web/${isbn}/`;
  let document;
  for (const name of ['spine.xml', 'volume.xml']) {
    try { document = await parseXml(await http.text(root + name)); break; }
    catch (error) { if (error.status !== 404) throw error; }
  }
  const spine = document?.spine || document?.config?.volume?.[0];
  const units = document?.spine?.unit || spine?.units?.[0]?.unit;
  if (!Array.isArray(units)) throw new ApiError('Questo libro Booktab non offre pagine PDF scaricabili.');
  const pages = [];
  for (const unit of units) {
    if (unit.$?.features === 'flash') continue;
    const id = safeId(unit.$?.btbid || '');
    const unitRoot = root + id + '/';
    const config = (await parseXml(await http.text(unitRoot + 'config.xml')))?.unit;
    const name = config?.content?.[0];
    if (typeof name !== 'string' || !name) throw new ApiError('Configurazione dell’unità Booktab priva di contenuto.');
    const mapped = config?.filesMap?.[0]?.entry?.find(entry => entry.$?.key === name + '.pdf')?._;
    const href = (mapped || name) + '.pdf';
    let bytes;
    try { bytes = await http.buffer(contentUrl(href, unitRoot)); }
    catch (error) { if (error.status === 404) throw new ApiError('Questa edizione Booktab usa XPS/XOD: conversione PDF non supportata.'); throw error; }
    let source;
    try { source = await PDFDocument.load(bytes); } catch { throw new ApiError('Unità PDF Booktab danneggiata.'); }
    for (let index = 0; index < source.getPageCount(); index++) {
      http.signal?.throwIfAborted();
      const pdf = await PDFDocument.create(); const [page] = await pdf.copyPages(source, [index]); pdf.addPage(page);
      pages.push({ id: `${id}-${index}`, position: pages.length, type: 'pdf', buffer: Buffer.from(await pdf.save()) });
    }
  }
  if (!pages.length) throw new ApiError('Nessuna pagina PDF disponibile in Booktab.');
  const title = document.spine?.volumetitle?.[0] || spine?.settings?.[0]?.volumetitle?.[0];
  return { title, format: 'pdf', pages };
}
