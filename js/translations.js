// ─── Config ─────────────────────────────────────────────────────────────
const LANG_KEY = 'mbx_lang';
const LANG_DEFAULT = 'en';
const LANG_VALID = ['ru', 'en', 'pt'];

const TRANSLATIONS = {
  ru: {
    loadJson: 'Загрузить JSON',
    addPhoto: 'Добавить фото',
    addPhotoAdded: '{n} фото добавлено',
    sortByName: 'По названию',
    sortByCode: 'По коду',
    sortByYear: 'По году',
    editor: 'Редактор',
    loadJsonPrompt: 'Загрузите JSON',
    link: 'Ссылка',
    code: 'Код',
    year: 'Год',
    file: 'Файл',
    errorInvalidJson: 'Ошибка: неверный JSON',
    catalog: 'Каталог',
    preview: 'Превью',
    name: 'Название',
    copyJson: 'Копировать JSON',
    saveJson: 'Скачать JSON',
    modelNamePlaceholder: 'Название модели',
    yearPlaceholder: 'Год',
    codePlaceholder: 'Код',
    imagePlaceholder: '0.jpg',
    linkPlaceholder: 'https://...',
    noImage: 'нет',
    loadJsonFirst: 'Сначала загрузите JSON',
    jsonLoaded: 'JSON загружен',
    copiedToClipboard: 'Скопировано в буфер',
    fileDownloaded: 'Файл скачан',
    linkWord: 'ССЫЛКА',
    pageTitle: 'Каталог',
    searchPlaceholder: 'Поиск по названию, году, коду...',
    searchNoResults: 'Ничего не найдено',
    favorites: 'Избранное',
    noFavorites: 'Нет избранных',
    infographic: 'Инфографика',
    yearModalTitle: 'Модели за {year} год',
    infographicModelCol: 'Модель',
    infographicChartCount: 'шт',
    infographicChartLabel: 'Кол-во моделей за год',
    signIn: 'Войти',
    signUp: 'Регистрация',
    signOut: 'Выйти',
    signInGoogle: 'Google',
    anonymous: 'гость',
    authEnterCreds: 'Введите email и пароль',
    authSignedIn: 'Вход выполнен',
    authSignUpDone: 'Регистрация завершена. Проверьте почту',
    authSignedOut: 'Вы вышли',
    authConfigMissing: 'Supabase не настроен в config.js',
    authGoogleDisabled: 'Google OAuth отключен в Supabase',
    saveCloud: 'Сохранить в облако',
    reloadCloud: 'Обновить',
    cloudSaved: 'Сохранено в облако',
    cloudSaveFailed: 'Ошибка сохранения',
    cloudReloaded: 'Обновлено из облака',
    cloudNotConfigured: 'Облачный режим не настроен',
    addPhotoUploaded: '{n} фото загружено в облако'
  },
  en: {
    loadJson: 'Load JSON',
    addPhoto: 'Add photo',
    addPhotoAdded: '{n} photos added',
    sortByName: 'By name',
    sortByCode: 'By code',
    sortByYear: 'By year',
    editor: 'Editor',
    loadJsonPrompt: 'Load JSON',
    link: 'Link',
    code: 'Code',
    year: 'Year',
    file: 'File',
    errorInvalidJson: 'Error: invalid JSON',
    catalog: 'Catalog',
    preview: 'Preview',
    name: 'Name',
    copyJson: 'Copy JSON',
    saveJson: 'Download JSON',
    modelNamePlaceholder: 'Model name',
    yearPlaceholder: 'Year',
    codePlaceholder: 'Code',
    imagePlaceholder: '0.jpg',
    linkPlaceholder: 'https://...',
    noImage: 'no',
    loadJsonFirst: 'Load JSON first',
    jsonLoaded: 'JSON loaded',
    copiedToClipboard: 'Copied to clipboard',
    fileDownloaded: 'File downloaded',
    linkWord: 'LINK',
    pageTitle: 'Catalog',
    searchPlaceholder: 'Search by name, year, code...',
    searchNoResults: 'No results',
    favorites: 'Favorites',
    noFavorites: 'No favorites',
    infographic: 'Infographic',
    yearModalTitle: 'Models for {year}',
    infographicModelCol: 'Model',
    infographicChartCount: 'pcs',
    infographicChartLabel: 'Models per year',
    signIn: 'Sign in',
    signUp: 'Sign up',
    signOut: 'Sign out',
    signInGoogle: 'Google',
    anonymous: 'anonymous',
    authEnterCreds: 'Enter email and password',
    authSignedIn: 'Signed in',
    authSignUpDone: 'Sign up completed. Check your email',
    authSignedOut: 'Signed out',
    authConfigMissing: 'Supabase config is missing in config.js',
    authGoogleDisabled: 'Google OAuth is disabled in Supabase',
    saveCloud: 'Save to cloud',
    reloadCloud: 'Reload',
    cloudSaved: 'Saved to cloud',
    cloudSaveFailed: 'Save failed',
    cloudReloaded: 'Reloaded from cloud',
    cloudNotConfigured: 'Cloud mode is not configured',
    addPhotoUploaded: '{n} photos uploaded to cloud'
  },
  pt: {
    loadJson: 'Carregar JSON',
    addPhoto: 'Adicionar foto',
    addPhotoAdded: '{n} fotos adicionadas',
    sortByName: 'Por nome',
    sortByCode: 'Por código',
    sortByYear: 'Por ano',
    editor: 'Editor',
    loadJsonPrompt: 'Carregue o JSON',
    link: 'Link',
    code: 'Código',
    year: 'Ano',
    file: 'Arquivo',
    errorInvalidJson: 'Erro: JSON inválido',
    catalog: 'Catálogo',
    preview: 'Pré-visualização',
    name: 'Nome',
    copyJson: 'Copiar JSON',
    saveJson: 'Baixar JSON',
    modelNamePlaceholder: 'Nome do modelo',
    yearPlaceholder: 'Ano',
    codePlaceholder: 'Código',
    imagePlaceholder: '0.jpg',
    linkPlaceholder: 'https://...',
    noImage: 'não',
    loadJsonFirst: 'Carregue o JSON primeiro',
    jsonLoaded: 'JSON carregado',
    copiedToClipboard: 'Copiado para a área de transferência',
    fileDownloaded: 'Arquivo baixado',
    linkWord: 'LINK',
    pageTitle: 'Catálogo',
    searchPlaceholder: 'Pesquisar por nome, ano, código...',
    searchNoResults: 'Nenhum resultado',
    favorites: 'Favoritos',
    noFavorites: 'Sem favoritos',
    infographic: 'Infográfico',
    yearModalTitle: 'Modelos de {year}',
    infographicModelCol: 'Modelo',
    infographicChartCount: 'un',
    infographicChartLabel: 'Modelos por ano',
    signIn: 'Entrar',
    signUp: 'Cadastrar',
    signOut: 'Sair',
    signInGoogle: 'Google',
    anonymous: 'anônimo',
    authEnterCreds: 'Informe email e senha',
    authSignedIn: 'Login realizado',
    authSignUpDone: 'Cadastro concluído. Verifique seu email',
    authSignedOut: 'Sessão encerrada',
    authConfigMissing: 'Supabase não configurado em config.js',
    authGoogleDisabled: 'Google OAuth está desativado no Supabase',
    saveCloud: 'Salvar na nuvem',
    reloadCloud: 'Recarregar',
    cloudSaved: 'Salvo na nuvem',
    cloudSaveFailed: 'Falha ao salvar',
    cloudReloaded: 'Recarregado da nuvem',
    cloudNotConfigured: 'Modo nuvem não configurado',
    addPhotoUploaded: '{n} fotos enviadas para a nuvem'
  }
};

// ─── Storage ────────────────────────────────────────────────────────────
function getLang() {
  try {
    let saved = localStorage.getItem(LANG_KEY);
    if (!saved) saved = localStorage.getItem('lang'); // migrate
    return LANG_VALID.includes(saved) ? saved : LANG_DEFAULT;
  } catch (e) {
    return LANG_DEFAULT;
  }
}

function setLang(lang) {
  try {
    if (LANG_VALID.includes(lang)) localStorage.setItem(LANG_KEY, lang);
  } catch (e) {  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function t(key, replacements) {
  const lang = getLang();
  let str = TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.ru[key] ?? key;
  if (replacements) {
    Object.entries(replacements).forEach(([k, v]) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    });
  }
  return str;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function applyTranslations() {
  document.querySelectorAll('[data-t]').forEach(el => {
    const key = el.getAttribute('data-t');
    el.textContent = t(key);
  });
}
