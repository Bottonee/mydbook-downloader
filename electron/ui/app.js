const $ = id => document.getElementById(id);
let books = [], selected, busy = false, loading = false, phase, canRemember = true;
const api = window.mydbook;
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function log(message) {
  const item = document.createElement('li'), time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString('it-IT'); item.append(time, document.createTextNode(message)); $('log').append(item);
  if ($('log').children.length > 150) $('log').firstElementChild.remove(); $('log').scrollTop = $('log').scrollHeight;
}
function updateControls() {
  for (const id of ['token', 'remember', 'load', 'choose-output', 'compress']) $(id).disabled = busy || loading;
  $('remember').disabled ||= !canRemember;
  $('quality').disabled = busy || loading || !$('compress').checked;
  $('download').disabled = busy || loading || !selected;
  $('cancel').hidden = !busy;
  $('search').disabled = busy || !books.length;
  document.querySelectorAll('.book').forEach(button => { button.disabled = busy; });
}
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
    books = response.books; selected = undefined; $('token').value = ''; $('token').placeholder = response.remembered ? 'Token salvato in modo sicuro' : 'Token attivo per questa sessione';
    $('selected-title').textContent = 'Scegli un libro dalla libreria'; $('selected-id').textContent = ''; $('search').value = ''; renderBooks(); notice(`${books.length} libri disponibili. Seleziona il titolo da scaricare.`); log(`Libreria caricata: ${books.length} libri.`);
  } catch { notice('Impossibile comunicare con l’applicazione. Riprova.', true); }
  finally { loading = false; updateControls(); }
});
$('choose-output').addEventListener('click', async () => { const response = await api.chooseOutput(); if (response.ok) $('output').textContent = response.outputDir; else notice(response.message, true); });
$('download').addEventListener('click', async () => {
  if (!selected || busy) return;
  const quality = Number($('quality').value);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) { notice('La qualità JPEG deve essere tra 1 e 100.', true); return; }
  busy = true; phase = undefined; $('progress').removeAttribute('value'); $('phase').textContent = 'Preparazione…'; $('page-count').textContent = ''; updateControls();
  const response = await api.download({ id: selected.id, compress: $('compress').checked, quality });
  if (!response.ok) { busy = false; notice(response.message, true); log(response.message); $('progress').value = 0; updateControls(); }
  else { notice('Download in corso. Puoi annullare e riprenderlo in seguito.'); log(`Avvio: ${selected.title}.`); }
});
$('cancel').addEventListener('click', async () => { $('cancel').disabled = true; $('phase').textContent = 'Annullamento…'; const response = await api.cancel(); if (!response.ok) { notice(response.message, true); $('cancel').disabled = false; } });
const unsubscribe = api.onDownload(event => {
  if (event.type === 'progress') {
    const labels = { metadata: 'Lettura delle pagine del libro', download: 'Download pagine', pdf: $('compress').checked ? 'Compressione e creazione PDF' : 'Creazione PDF', saving: 'Salvataggio PDF', complete: 'PDF pronto' };
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
(async () => {
  const state = await api.getState();
  if (!state.ok) { notice(state.message, true); return; }
  $('version').textContent = `v${state.version}`; $('output').textContent = state.outputDir;
  canRemember = state.canRemember;
  $('remember').checked = state.remembered; $('remember').disabled = !canRemember;
  if (state.remembered) { $('token').placeholder = 'Token salvato in modo sicuro'; notice('Token salvato disponibile. Premi Carica i miei libri.'); }
  if (state.warning) notice(state.warning, true);
})();
