// Verified in the public My bSmart 7.6.10 bundle, 2026-10-11. See docs/bsmart-endpoints.md.
export const bsmartConfig = Object.freeze({
  baseUrl: 'https://www.bsmart.it',
  loginUrl: 'https://my.bsmart.it/',
  browserLogin: true,
  referer: 'https://my.bsmart.it/',
  auth: { headerName: 'AUTH_TOKEN', scheme: '' },
  libraryPath: '/api/v6/books?page_thumb_size=medium&per_page=25000',
  preactivationsPath: '/api/v5/books/preactivations',
  userPath: '/api/v6/user',
  bookPath: id => `/api/v6/books/by_book_id/${encodeURIComponent(id)}`,
  revisionPath: id => `/api/v5/books/${encodeURIComponent(id)}`,
  indexPath: (id, revision) => `/api/v5/books/${encodeURIComponent(id)}/${encodeURIComponent(revision)}/index`,
  resourcesPath: (id, revision) => `/api/v5/books/${encodeURIComponent(id)}/${encodeURIComponent(revision)}/resources`,
  fields: { id: 'id', title: 'title', pageLabel: 'title', authors: 'authors', pagesCount: 'page_count', edition: 'current_edition', revision: 'revision', encrypted: 'encrypted', cover: null, assets: 'assets', use: 'use', url: 'url', filename: 'filename', preactivationBooks: 'books', noBsmart: 'no_bsmart' },
  extraction: { origins: ['https://my.bsmart.it', 'https://www.bsmart.it'], cookieNames: [], storageKeys: [], headerNames: ['AUTH_TOKEN'], headerScheme: '', urlKeys: [] },
  // Resource mapping and format verified against Leone25/bSmart-downloader (MIT).
  pageResources: 'page_pdf',
  resourcesPerPage: 500,
  pageType: 'pdf',
  downloadSupported: true,
  encryption: { readerUrl: 'https://my.bsmart.it/', headerSize: 256, ivSize: 16, startField: 'start' },
  // TODO: authenticated verification of covers and alternative cookie/storage extraction.
});
