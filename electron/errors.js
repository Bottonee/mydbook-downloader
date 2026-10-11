import { ApiError } from '../src/api.js';
export function userError(error, token = '') {
  if (error?.status === 401) return 'Token scaduto o sessione non valida. Incolla uno usertoken aggiornato e ricarica i libri.';
  if (error?.status === 403) return 'Accesso negato. Verifica il token e che il libro sia disponibile nel tuo account.';
  if (error?.status === 404) return 'Libro o pagina non trovato. Ricarica la libreria e riprova.';
  if (error?.code === 'ENOSPC') return 'Spazio su disco insufficiente. Scegli una cartella con più spazio libero.';
  if (['EACCES', 'EPERM'].includes(error?.code)) return 'Impossibile scrivere nella cartella scelta. Verifica i permessi.';
  if (!(error instanceof ApiError)) return 'Operazione non riuscita. Controlla connessione e spazio su disco, poi riprova.';
  let message = error.message.replace(/MYDBOOK_TOKEN(?: in \.env)?/g, 'lo usertoken').replace(/ nel file \.env/g, ' nel campo Token');
  if (token) message = message.replaceAll(token, '[omesso]');
  return message.replace(/eyJ[A-Za-z0-9_.-]+/g, '[omesso]');
}
