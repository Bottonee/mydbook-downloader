const $ = id => document.getElementById(id);
let books = [], selected, busy = false, loading = false, phase, canRemember = true, downloadSupported = true, compressionSupported = true;
const api = window.mydbook;
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function log(message) {
  const item = document.createElement('li'), time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString('it-IT'); item.append(time, document.createTextNode(message)); $('log').append(item);
  if ($('log').children.length > 150) $('log').firstElementChild.remove(); $('log').scrollTop = $('log').scrollHeight;
}
function updateControls() {
  for (const id of ['provider', 'login', 'disconnect', 'token', 'remember', 'load', 'choose-output', 'compress']) $(id).disabled = busy || loading;
  $('remember').disabled ||= !canRemember;
  $('compress').disabled ||= !compressionSupported;
  $('quality').disabled = busy || loading || !compressionSupported || !$('compress').checked;
  $('download').disabled = busy || loading || !selected || !downloadSupported;
  $('cancel').hidden = !busy;
  $('search').disabled = busy || !books.length;
  document.querySelectorAll('.book').forEach(button => { button.disabled = busy; });
}
function applyState(state) {
  if (state.provider) $('provider').value = state.provider;
  const provider = state.providers?.find(p => p.id === state.provider);
  downloadSupported = provider?.downloadSupported !== false;
  compressionSupported = provider?.compressionSupported !== false;
  $('compression-help').textContent = compressionSupported ? 'Qualità più bassa: file più piccolo, meno dettaglio. Le dimensioni delle pagine restano invariate.' : 'bSmart: unione dei PDF originali, mantenendo testo e grafica. La compressione JPEG non si applica.';
  canRemember = state.canRemember;
  $('remember').checked = state.remembered;
  $('connection').textContent = state.connecting ? 'Accesso in corso…' : state.connected ? 'Connesso' : 'Non connesso';
  $('login').hidden = Boolean(state.connected); $('disconnect').hidden = !state.connected && !state.remembered;
  if (state.books) {
    books = state.books; selected = undefined; $('search').value = ''; $('selected-title').textContent = 'Scegli un libro dalla libreria'; $('selected-id').textContent = ''; renderBooks();
  }
  if (state.version) $('version').textContent = `v${state.version}`;
  if (state.outputDir) $('output').textContent = state.outputDir;
  $('token').value = ''; $('token').placeholder = state.remembered ? 'Token salvato in modo sicuro' : 'Incolla il tuo token';
  if (state.connecting) notice('Completa l’accesso nella finestra del sito ufficiale.');
  else if (state.warning) notice(state.warning, true);
  else if (state.connected && !downloadSupported) notice(provider.limitation, true);
  else notice(state.connected ? `${books.length} libri disponibili. Seleziona il titolo da scaricare.` : 'Scegli un provider e premi Accedi e recupera token.');
  updateControls();
}
async function accountAction(action) {
  loading = true; updateControls();
  try { const response = await action(); if (response.ok) applyState(response); else { notice(response.message, true); log(response.message); } }
  catch { notice('Impossibile comunicare con l’applicazione. Riprova.', true); }
  finally { loading = false; updateControls(); }
}
$('provider').addEventListener('change', () => accountAction(() => api.selectProvider($('provider').value)));
$('login').addEventListener('click', () => accountAction(() => api.login()));
$('disconnect').addEventListener('click', () => accountAction(() => api.disconnect()));
const unsubscribeAccount = api.onAccount(state => { loading = Boolean(state.connecting); applyState(state); });
function renderBooks() {
  const query = $('search').value.trim().toLocaleLowerCase('it-IT');
  const list = books.filter(book => (book.title + ' ' + book.id).toLocaleLowerCase('it-IT').includes(query));
  $('books').replaceChildren(); $('book-count').textContent = String(books.length);
  if (!list.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = books.length ? 'Nessun libro corrisponde alla ricerca.' : 'Nessun libro disponibile nel tuo account.'; $('books').append(empty); }
  for (const book of list) {
    const button = document.createElement('button'); button.className = 'book'; button.type = 'button';
    button.setAttribute('aria-pressed', String(selected?.id === book.id));
    const placeholder = document.createElement('span'); placeholder.className = 'cover-placeholder'; placeholder.textContent = '▤'; placeholder.setAttribute('aria-hidden', 'true');
    if (book.coverUrl) { const image = document.createElement('img'); image.src = book.coverUrl; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.addEventListener('error', () => image.replaceWith(placeholder), { once: true }); button.append(image); } else button.append(placeholder);
    const text = document.createElement('span'), title = document.createElement('strong'), id = document.createElement('small');
    title.textContent = book.title; id.textContent = book.id; text.append(title, id);
    if (book.subtitle) { const subtitle = document.createElement('small'); subtitle.className = 'subtitle'; subtitle.textContent = book.subtitle; text.append(subtitle); }
    button.append(text); button.addEventListener('click', () => { selected = book; $('selected-title').textContent = book.title; $('selected-id').textContent = book.id; renderBooks(); updateControls(); }); $('books').append(button);
  }
}
$('search').addEventListener('input', renderBooks);
$('compress').addEventListener('change', updateControls);
$('remember').addEventListener('change', async () => {
  if (!$('remember').checked) { const response = await api.forgetToken(); if (!response.ok) notice(response.message, true); else if (!$('token').value) $('token').placeholder = 'Token attivo per questa sessione'; }
});
$('account-form').addEventListener('submit', async event => {
  event.preventDefault(); loading = true; updateControls(); notice('Caricamento della libreria…');
  try {
    const response = await api.loadBooks({ token: $('token').value.trim(), remember: $('remember').checked });
    if (!response.ok) { notice(response.message, true); log(response.message); return; }
    applyState(response); log(`Libreria caricata: ${books.length} libri.`);
  } catch { notice('Impossibile comunicare con l’applicazione. Riprova.', true); }
  finally { loading = false; updateControls(); }
});
$('choose-output').addEventListener('click', async () => { const response = await api.chooseOutput(); if (response.ok) $('output').textContent = response.outputDir; else notice(response.message, true); });
$('download').addEventListener('click', async () => {
  if (!selected || busy) return;
  const quality = Number($('quality').value);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) { notice('La qualità JPEG deve essere tra 1 e 100.', true); return; }
  busy = true; phase = undefined; $('progress').removeAttribute('value'); $('phase').textContent = 'Preparazione…'; $('page-count').textContent = ''; updateControls();
  const response = await api.download({ id: selected.id, compress: compressionSupported && $('compress').checked, quality });
  if (!response.ok) { busy = false; notice(response.message, true); log(response.message); $('progress').value = 0; updateControls(); }
  else { notice('Download in corso. Puoi annullare e riprenderlo in seguito.'); log(`Avvio: ${selected.title}.`); }
});
$('cancel').addEventListener('click', async () => { $('cancel').disabled = true; $('phase').textContent = 'Annullamento…'; const response = await api.cancel(); if (!response.ok) { notice(response.message, true); $('cancel').disabled = false; } });
const unsubscribe = api.onDownload(event => {
  if (event.type === 'progress') {
    const labels = { metadata: 'Lettura delle pagine del libro', download: 'Download pagine', pdf: compressionSupported && $('compress').checked ? 'Compressione e creazione PDF' : 'Creazione PDF', saving: 'Salvataggio PDF', complete: 'PDF pronto' };
    if (phase !== event.phase) { phase = event.phase; log(labels[phase] || 'Elaborazione…'); }
    $('phase').textContent = labels[event.phase] || 'Elaborazione…';
    if (event.phase === 'metadata' || event.phase === 'saving') { $('progress').removeAttribute('value'); $('page-count').textContent = ''; }
    else { $('progress').max = event.total || 1; $('progress').value = event.completed; $('page-count').textContent = `${event.completed} / ${event.total} pagine`; }
    if (event.phase === 'download' && event.completed === event.total) log(`${event.downloaded} pagine scaricate; ${event.resumed} già presenti.`);
    return;
  }
  busy = false; $('cancel').disabled = false; updateControls();
  if (event.type === 'done') { notice('PDF salvato. Il file è pronto nella cartella scelta.'); $('phase').textContent = 'Completato'; log(`PDF salvato: ${event.target}`); }
  else if (event.type === 'cancelled') { notice('Operazione annullata. Le pagine completate saranno riutilizzate al prossimo download.'); $('phase').textContent = 'Annullato'; log('Download annullato; pagine completate conservate.'); $('progress').value = 0; }
  else { notice(event.message, true); $('phase').textContent = 'Operazione non completata'; log(event.message); $('progress').value = 0; }
});
window.addEventListener('beforeunload', unsubscribe);
window.addEventListener('beforeunload', unsubscribeAccount);
(async () => {
  const state = await api.getState();
  if (!state.ok) { notice(state.message, true); return; }
  applyState(state);
})();
