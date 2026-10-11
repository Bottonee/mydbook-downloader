export const mydbookConfig = Object.freeze({
  baseUrl: 'https://mydbook.olhos.it',
  loginUrl: 'https://mydbook.olhos.it/mydbook/login',
  tenant: 'mydbook',
  auth: { cookieName: 'userToken', cookiePath: '/', headerName: 'Authorization', scheme: 'Bearer' },
  libraryPath: '/mydbook/dashboard',
  libraryBlockKey: 'user_my_books_block',
  bookPath: id => `/mydbook/${encodeURIComponent(id)}`,
  pageDetailsPath: (id, page) => `/data/v1/fixedlayout/mydbook/${encodeURIComponent(id)}/details/${encodeURIComponent(page)}/${encodeURIComponent(page)}`,
  fields: { user: 'user', blocks: 'blocks', blockConfiguration: 'blockConfiguration', i18n: 'i18n', blockKey: 'key', books: 'volumes', allowed: 'bookcodes', id: 'bookcode', title: 'title', subtitle: 'subtitle', cover: 'coverUrl', pages: 'listPages', metadata: 'infoFixedPage', detailsPages: 'pages', pageId: 'id', position: 'position', pageUrl: 'url' },
  extraction: { origins: ['https://mydbook.olhos.it'], cookieNames: ['userToken'], storageKeys: [], headerNames: ['Authorization'], headerScheme: 'Bearer', urlKeys: [] },
});
