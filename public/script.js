const hasDocument = typeof document !== 'undefined';

let postList = hasDocument ? document.querySelector('#post-list') : null;
let composeModal = hasDocument ? document.querySelector('#compose-modal') : null;
let loginModal = hasDocument ? document.querySelector('#login-modal') : null;
let composeForm = hasDocument ? document.querySelector('#compose-form') : null;
let loginForm = hasDocument ? document.querySelector('#login-form') : null;
let searchForm = hasDocument ? document.querySelector('#search-form') : null;
let searchInput = hasDocument ? searchForm?.querySelector('input[name="q"]') : null;
let clearSearchButton = hasDocument ? searchForm?.querySelector('[data-action="clear-search"]') : null;
let tagList = hasDocument ? document.querySelector('#tag-pills') : null;
let composeButtons = hasDocument ? Array.from(document.querySelectorAll('[data-action="compose"]')) : [];
let composeCloseButtons = hasDocument
  ? Array.from(document.querySelectorAll('[data-action="close-compose"]'))
  : [];
let loginButtons = hasDocument ? Array.from(document.querySelectorAll('[data-action="open-login"]')) : [];
let loginCloseButtons = hasDocument
  ? Array.from(document.querySelectorAll('[data-action="close-login"]'))
  : [];
let logoutButtons = hasDocument ? Array.from(document.querySelectorAll('[data-action="logout"]')) : [];
let composePreview = hasDocument ? document.querySelector('#compose-preview') : null;
let composePreviewStatus = composePreview ? composePreview.querySelector('[data-role="status"]') : null;
let composePreviewContent = composePreview ? composePreview.querySelector('.editor-preview__content') : null;
let authOnlyElements = hasDocument
  ? Array.from(document.querySelectorAll('[data-auth-only="true"]'))
  : [];
let guestOnlyElements = hasDocument
  ? Array.from(document.querySelectorAll('[data-guest-only="true"]'))
  : [];
let boundComposeForm = null;
let boundLoginForm = null;
let boundComposeModal = null;
let boundLoginModal = null;
let boundSearchForm = null;
let boundClearSearchButton = null;
let boundSearchInput = null;
let searchDebounceId = null;
const SEARCH_DEBOUNCE_MS = 250;
const PREVIEW_DEBOUNCE_MS = 350;
const MAX_REFRESH_ATTEMPTS = 3;
const REFRESH_RETRY_DELAY_MS = 500;
const CODE_COPY_FEEDBACK_MS = 1600;

let authState = {
  authenticated: false,
  user: null,
};

let loginInProgress = false;
let logoutInProgress = false;

function toggleVisibilityList(elements, visible) {
  elements.forEach((element) => {
    if (!element) {
      return;
    }

    if (visible) {
      element.removeAttribute('hidden');
      element.dataset.authVisible = 'true';
    } else {
      element.setAttribute('hidden', '');
      element.dataset.authVisible = 'false';
    }
  });
}

function updateAuthVisibility() {
  toggleVisibilityList(authOnlyElements, authState.authenticated);
  toggleVisibilityList(guestOnlyElements, !authState.authenticated);

  if (!authState.authenticated) {
    closeComposeModal();
    closeLoginModal();
  }
}

function setAuthState(nextState) {
  const authenticated = Boolean(nextState?.authenticated);
  const user = authenticated && nextState?.user ? nextState.user : null;

  authState = { authenticated, user };
  updateAuthVisibility();
}

const handleLoginSubmit = (event) => {
  event.preventDefault();
  submitLogin();
};

async function submitLogin() {
  if (!loginForm || loginInProgress) {
    return;
  }

  const formData = new FormData(loginForm);
  const keyHash = String(formData.get('keyHash') ?? '').trim();

  if (!keyHash) {
    setStatus('informe sua key hash');
    return;
  }

  loginInProgress = true;
  const controls = collectInteractiveElements(loginForm);
  disableElements(controls, true);

  try {
    setStatus('validando chave...');
    const result = await request('/auth/login', {
      method: 'POST',
      body: { keyHash },
    });

    setStatus('sessão autenticada');
    setAuthState(result);
    closeLoginModal();
    loginForm.reset?.();
    await refreshPosts();
    await refreshTags();
  } catch (error) {
    console.error(error);
    setStatus(`erro ao autenticar: ${(error && error.message) || 'desconhecido'}`);
  } finally {
    loginInProgress = false;
    disableElements(controls, false);
  }
}

async function fetchSession() {
  try {
    setStatus('verificando sessão...');
    const session = await request('/auth/session');
    setAuthState(session);
    setStatus('pronto');
  } catch (error) {
    console.error(error);
    setAuthState({ authenticated: false, user: null });
    setStatus('pronto');
  }
}

async function logout() {
  if (logoutInProgress) {
    return;
  }

  logoutInProgress = true;
  disableElements(logoutButtons, true);

  try {
    setStatus('encerrando sessão...');
    await request('/auth/logout', { method: 'POST' });
    setStatus('sessão encerrada');
    setAuthState({ authenticated: false, user: null });
    await refreshPosts();
    await refreshTags();
  } catch (error) {
    console.error(error);
    setStatus(`erro ao encerrar: ${(error && error.message) || 'desconhecido'}`);
  } finally {
    logoutInProgress = false;
    disableElements(logoutButtons, false);
  }
}

const handleComposeButtonClick = () => openComposeModal();
const handleCloseComposeClick = () => closeComposeModal();
const handleOpenLoginClick = () => openLoginModal();
const handleCloseLoginClick = () => closeLoginModal();
const handleLogoutClick = () => logout();
const handleComposeBackdropClick = (event) => {
  if (event.target === composeModal) {
    closeComposeModal();
  }
};

const handleLoginBackdropClick = (event) => {
  if (event.target === loginModal) {
    closeLoginModal();
  }
};

const handleClearSearchClick = () => {
  filters.query = '';
  if (searchInput) {
    searchInput.value = '';
  }
  scheduleSearchRefresh(true);
};

const handleSearchSubmit = (event) => {
  event.preventDefault();
  const term = searchInput ? searchInput.value.trim() : '';
  filters.query = term;
  scheduleSearchRefresh(true);
};

const handleSearchInput = () => {
  const term = searchInput ? searchInput.value.trim() : '';
  if (term === filters.query) {
    return;
  }
  filters.query = term;
  scheduleSearchRefresh();
};

const handleCopyCodeClick = async (event) => {
  const button = event.target instanceof HTMLElement ? event.target : null;

  if (!button || button.dataset.action !== 'copy-code') {
    return;
  }

  event.preventDefault();

  const figure = button.closest('.code-block');
  const codeElement = figure ? figure.querySelector('code') : null;

  if (!codeElement || !codeElement.textContent) {
    setStatus('nada para copiar');
    console.log('[code-copy] ignorado: sem conteúdo');
    return;
  }

  const text = codeElement.textContent;

  try {
    await writeClipboard(text);
    applyCopyFeedback(button, 'copiado', 'copiar');
    console.log('[code-copy] copiado com sucesso');
  } catch (error) {
    console.error(error);
    applyCopyFeedback(button, 'erro', 'copiar');
    console.log('[code-copy] falha ao copiar', error);
  }
};

const handleComposeContentInput = () => {
  if (!composeForm) {
    return;
  }

  if (!authState.authenticated) {
    resetPreviewSession(composePreview);
    setPreviewState(composePreview, composePreviewStatus, composePreviewContent, 'empty');
    return;
  }

  const field = getComposeContentField();
  const value = typeof field?.value === 'string' ? field.value : '';
  schedulePreviewUpdate({
    content: value,
    container: composePreview,
    statusElement: composePreviewStatus,
    contentElement: composePreviewContent,
  });
};

const scheduleSearchRefresh = (immediate = false) => {
  if (searchDebounceId !== null) {
    clearTimeout(searchDebounceId);
    searchDebounceId = null;
  }

  if (immediate) {
    refreshPosts();
    return;
  }

  searchDebounceId = setTimeout(() => {
    searchDebounceId = null;
    refreshPosts();
  }, SEARCH_DEBOUNCE_MS);
};

const intlDateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const TITLE_MAX_LENGTH = 33;
const filters = {
  query: '',
  tag: null,
};

let loading = false;
let loadingTags = false;
let cachedTags = [];
const previewSessions = new WeakMap();
const copyCodeResetTimers = new WeakMap();

function safeString(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function disableElements(elements, disabled) {
  elements.forEach((element) => {
    if (element) {
      element.disabled = disabled;
    }
  });
}

function collectInteractiveElements(root) {
  if (!root) {
    return [];
  }

  if (typeof root.querySelectorAll === 'function') {
    return Array.from(root.querySelectorAll('button, input, textarea, select'));
  }

  const elements = new Set();

  const candidates = root.formElements && typeof root.formElements === 'object' ? Object.values(root.formElements) : [];

  candidates.forEach((candidate) => {
    if (candidate) {
      elements.add(candidate);
    }
  });

  return Array.from(elements);
}

function setStatus(message) {
  if (!message) {
    return;
  }

  console.debug('[status]', message);
}

function setPreviewState(container, statusElement, contentElement, state, options = {}) {
  if (!container) {
    return;
  }

  container.dataset.state = state;

  if (statusElement) {
    if (state === 'empty') {
      statusElement.textContent = 'aguardando conteúdo';
    } else if (state === 'loading') {
      statusElement.textContent = 'renderizando preview...';
    } else if (state === 'ready') {
      statusElement.textContent = 'visualização gerada';
    } else if (state === 'error') {
      statusElement.textContent = options.errorMessage || 'erro ao renderizar preview';
    }
  }

  if (contentElement) {
    if (state === 'ready') {
      contentElement.innerHTML = options.html ?? '';
    }

    if (state === 'empty') {
      contentElement.innerHTML = '';
    }

    if (state === 'error' && options.fallbackHtml) {
      contentElement.innerHTML = options.fallbackHtml;
    }
  }
}

function schedulePreviewUpdate({
  content,
  container,
  statusElement,
  contentElement,
  immediate = false,
}) {
  if (!container || !statusElement || !contentElement) {
    return;
  }

  const session = getPreviewSession(container);
  const trimmed = typeof content === 'string' ? content.trim() : '';

  if (!trimmed) {
    resetPreviewSession(container);
    setPreviewState(container, statusElement, contentElement, 'empty');
    return;
  }

  if (session.debounceId !== null) {
    clearTimeout(session.debounceId);
    session.debounceId = null;
  }

  const run = async () => {
    session.debounceId = null;
    setPreviewState(container, statusElement, contentElement, 'loading');

    session.abortController?.abort();
    session.abortController = new AbortController();

    try {
      const result = await request('/posts/preview', {
        method: 'POST',
        body: { content: trimmed },
        signal: session.abortController.signal,
      });

      const html = typeof result?.html === 'string' ? result.html : '';
      setPreviewState(container, statusElement, contentElement, 'ready', {
        html,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }

      console.error(error);
      setPreviewState(container, statusElement, contentElement, 'error', {
        errorMessage: `erro ao renderizar preview: ${(error && error.message) || 'desconhecido'}`,
      });
    }
  };

  if (immediate) {
    run();
    return;
  }

  session.debounceId = setTimeout(run, PREVIEW_DEBOUNCE_MS);
}

function getPreviewSession(container) {
  let session = previewSessions.get(container);
  if (!session) {
    session = { debounceId: null, abortController: null };
    previewSessions.set(container, session);
  }
  return session;
}

function resetPreviewSession(container) {
  if (!container) {
    return;
  }

  const session = previewSessions.get(container);
  if (!session) {
    return;
  }

  if (session.abortController) {
    session.abortController.abort();
  }

  if (session.debounceId !== null) {
    clearTimeout(session.debounceId);
  }

  previewSessions.delete(container);
}

function getComposeContentField(form = composeForm) {
  if (!form) {
    return null;
  }

  if (typeof form.elements?.namedItem === 'function') {
    return form.elements.namedItem('content');
  }

  const entries = form.formElements ?? {};
  return entries.content ?? null;
}

function openComposeModal() {
  if (!composeModal) {
    return;
  }
  if (!authState.authenticated) {
    setStatus('faça login para escrever');
    openLoginModal();
    return;
  }
  composeModal.dataset.open = 'true';
  composeModal.setAttribute('aria-hidden', 'false');
  const titleInput = composeForm?.elements?.namedItem?.('title');
  if (titleInput && typeof titleInput.focus === 'function') {
    titleInput.focus();
  }
  handleComposeContentInput();
}

function closeComposeModal() {
  if (!composeModal) {
    return;
  }
  composeModal.dataset.open = 'false';
  composeModal.setAttribute('aria-hidden', 'true');
  composeForm?.reset?.();
  resetPreviewSession(composePreview);
  setPreviewState(composePreview, composePreviewStatus, composePreviewContent, 'empty');
}

function openLoginModal() {
  if (!loginModal) {
    return;
  }
  loginModal.dataset.open = 'true';
  loginModal.setAttribute('aria-hidden', 'false');
  const keyInput = loginForm?.elements?.namedItem?.('keyHash');
  if (keyInput && typeof keyInput.focus === 'function') {
    keyInput.focus();
  }
}

function closeLoginModal() {
  if (!loginModal) {
    return;
  }
  loginModal.dataset.open = 'false';
  loginModal.setAttribute('aria-hidden', 'true');
  loginForm?.reset?.();
}

function handleComposeSubmit(event) {
  event.preventDefault();

  if (!composeForm) {
    return;
  }

  const formData = new FormData(composeForm);
  const title = String(formData.get('title') || '').trim();
  const content = String(formData.get('content') || '').trim();
  const tags = parseTagsInput(formData.get('tags'));

  if (!title || !content) {
    setStatus('preencha título e conteúdo para criar um post');
    return;
  }

  const controls = collectInteractiveElements(composeForm);

  (async () => {
    setStatus('criando post...');
    disableElements(controls, true);

    try {
      await request('/posts', {
        method: 'POST',
        body: { title, content, tags },
      });

      setStatus('post criado com sucesso');
      closeComposeModal();
      await refreshPosts();
      await refreshTags();
    } catch (error) {
      console.error(error);
      setStatus(`erro ao criar: ${(error && error.message) || 'desconhecido'}`);
    } finally {
      disableElements(controls, false);
    }
  })();
}

async function request(path, options = {}) {
  const opts = {
    headers: {},
    credentials: 'include',
    ...options,
  };

  if (!opts.credentials) {
    opts.credentials = 'include';
  }

  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }

  const response = await fetch(path, opts);

  if (!response.ok) {
    let errorMessage = response.statusText;

    try {
      const payload = await response.json();
      if (payload && typeof payload === 'object' && payload.error) {
        errorMessage = payload.error;
      }
    } catch (error) {
      console.error(error);
    }

    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function refreshPosts(attempt = 1) {
  if (loading) {
    return;
  }

  loading = true;
  setStatus('carregando posts...');

  try {
    const params = new URLSearchParams();
    if (filters.query) {
      params.set('q', filters.query);
    }
    if (filters.tag) {
      params.set('tag', filters.tag);
    }
    const endpoint = params.toString() ? `/posts?${params}` : '/posts';
    const posts = await request(endpoint);
    renderPosts(Array.isArray(posts) ? posts : []);
    setStatus('pronto');
  } catch (error) {
    console.error(error);
    const nextAttempt = attempt + 1;
    if (nextAttempt <= MAX_REFRESH_ATTEMPTS) {
      setStatus(`erro ao carregar: ${(error && error.message) || 'desconhecido'}. nova tentativa em ${Math.round(
        (attempt * REFRESH_RETRY_DELAY_MS) / 1000,
      )}s`);
      setTimeout(() => {
        refreshPosts(nextAttempt);
      }, attempt * REFRESH_RETRY_DELAY_MS);
    } else {
      setStatus(`erro ao carregar: ${(error && error.message) || 'desconhecido'}`);
    }
  } finally {
    loading = false;
  }
}

async function refreshTags(attempt = 1) {
  if (loadingTags) {
    return;
  }

  loadingTags = true;

  try {
    const tags = await request('/tags');
    cachedTags = Array.isArray(tags) ? tags : [];
    renderTags(cachedTags);
  } catch (error) {
    console.error(error);
    const nextAttempt = attempt + 1;
    if (nextAttempt <= MAX_REFRESH_ATTEMPTS) {
      setTimeout(() => {
        refreshTags(nextAttempt);
      }, attempt * REFRESH_RETRY_DELAY_MS);
    }
  } finally {
    loadingTags = false;
  }
}

function renderPosts(posts) {
  if (!postList) {
    return;
  }

  postList.innerHTML = '';

  if (!posts.length) {
    const emptyStateItem = document.createElement('li');
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'nenhum post encontrado. ajuste os filtros ou clique em "escrever" para publicar';
    emptyStateItem.append(emptyState);
    postList.append(emptyStateItem);
    return;
  }

  posts.forEach((post) => {
    const item = document.createElement('li');
    item.append(createPostCard(post));
    postList.append(item);
  });
}

function createPostCard(post) {
  const card = document.createElement('article');
  card.className = 'post-card';
  card.dataset.id = String(post.id);

  const header = document.createElement('header');
  header.className = 'post-card__header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'post-card__info';

  const title = document.createElement('h3');
  title.className = 'post-card__title';
  const originalTitle = safeString(post.title);
  const { text: displayTitle, truncated } = getDisplayTitle(originalTitle);
  title.textContent = displayTitle;
  title.title = truncated ? originalTitle : '';

  const meta = document.createElement('div');
  meta.className = 'post-card__meta';
  const updatedAt = formatDateTime(post.updatedAt);
  const metaItems = [`Última atualização em: ${updatedAt}`, ...formatTagsForDisplay(post.tags)];

  metaItems.forEach((text, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'post-card__meta-separator';
      separator.textContent = '•';
      meta.append(separator);
    }

    const item = document.createElement('span');
    item.className = 'post-card__meta-item';
    item.textContent = text;
    meta.append(item);
  });

  titleGroup.append(title, meta);

  const isAuthenticated = authState.authenticated;
  const contentHtml = typeof post.contentHtml === 'string' && post.contentHtml.trim() !== '' ? post.contentHtml : '';

  if (!isAuthenticated) {
    const content = document.createElement('div');
    content.className = 'post-card__content';
    if (contentHtml) {
      content.innerHTML = contentHtml;
    } else {
      content.textContent = safeString(post.content);
    }

    header.append(titleGroup);
    card.append(header, content);
    return card;
  }

  const actions = document.createElement('div');
  actions.className = 'post-card__actions';

  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.textContent = 'editar';

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.textContent = 'excluir';

  actions.append(editButton, deleteButton);

  header.append(titleGroup, actions);
  const content = document.createElement('div');
  content.className = 'post-card__content';
  if (contentHtml) {
    content.innerHTML = contentHtml;
  } else {
    content.textContent = safeString(post.content);
  }

  const editForm = document.createElement('form');
  editForm.className = 'edit-form';
  editForm.autocomplete = 'off';

  const titleField = document.createElement('label');
  titleField.textContent = 'título';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.name = 'title';
  titleInput.value = originalTitle;
  titleInput.required = true;
  titleField.append(titleInput);

  const contentField = document.createElement('label');
  contentField.textContent = 'conteúdo';
  const contentInput = document.createElement('textarea');
  contentInput.name = 'content';
  contentInput.rows = 5;
  contentInput.required = true;
  contentInput.value = safeString(post.content);
  contentField.append(contentInput);

  const tagsField = document.createElement('label');
  tagsField.textContent = 'tags';
  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.name = 'tags';
  tagsInput.placeholder = 'ex: tecnologia, backend';
  tagsInput.value = formatTagsForInput(post.tags);
  tagsField.append(tagsInput);

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '0.75rem';

  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.dataset.variant = 'primary';
  saveButton.textContent = ':: salvar';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.dataset.variant = 'ghost';
  cancelButton.textContent = ':: cancelar';

  controls.append(saveButton, cancelButton);

  editForm.append(titleField, contentField, tagsField, controls);

  editButton.addEventListener('click', () => {
    const open = editForm.dataset.open === 'true';
    editForm.dataset.open = String(!open);
    if (!open) {
      titleInput.focus();
      titleInput.select();
    }
  });

  cancelButton.addEventListener('click', () => {
    editForm.dataset.open = 'false';
    titleInput.value = safeString(post.title);
    contentInput.value = safeString(post.content);
    tagsInput.value = formatTagsForInput(post.tags);
  });

  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      title: safeString(titleInput.value).trim(),
      content: safeString(contentInput.value).trim(),
      tags: parseTagsInput(tagsInput.value),
    };

    if (!payload.title || !payload.content) {
      setStatus('preencha todos os campos para salvar');
      return;
    }

    setStatus(`atualizando #${post.id}...`);
    disableElements([saveButton, cancelButton, editButton, deleteButton], true);

    try {
      await request(`/posts/${post.id}`, {
        method: 'PUT',
        body: payload,
      });

      setStatus(`post #${post.id} atualizado`);
      editForm.dataset.open = 'false';
      await refreshPosts();
      await refreshTags();
    } catch (error) {
      console.error(error);
      setStatus(`erro ao atualizar: ${(error && error.message) || 'desconhecido'}`);
    } finally {
      disableElements([saveButton, cancelButton, editButton, deleteButton], false);
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (!confirm('Excluir este post?')) {
      return;
    }

    setStatus(`excluindo #${post.id}...`);
    disableElements([deleteButton, editButton], true);

    try {
      await request(`/posts/${post.id}`, { method: 'DELETE' });
      setStatus(`post #${post.id} removido`);
      await refreshPosts();
      await refreshTags();
    } catch (error) {
      console.error(error);
      setStatus(`erro ao excluir: ${(error && error.message) || 'desconhecido'}`);
    } finally {
      disableElements([deleteButton, editButton], false);
    }
  });

  card.append(header, content, editForm);
  return card;
}

function renderTags(tags) {
  if (!tagList) {
    return;
  }

  tagList.innerHTML = '';

  if (!tags.length) {
    if (filters.tag) {
      filters.tag = null;
      refreshPosts();
    }
    return;
  }

  const availableSlugs = tags
    .map((tag) => slugify(tag.slug || tag.name || ''))
    .filter((slug) => Boolean(slug));

  if (filters.tag && !availableSlugs.includes(filters.tag)) {
    const hadFilter = Boolean(filters.tag);
    filters.tag = null;
    if (hadFilter) {
      refreshPosts();
    }
  }

  tags.forEach((tag) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tag-pill';
    const slug = slugify(tag.slug || tag.name || '');
    button.dataset.slug = slug || '';
    button.dataset.active = filters.tag === slug ? 'true' : 'false';
    const [label] = formatTagsForDisplay([tag]);
    button.textContent = label || String(tag.slug || tag.name || '').toLowerCase();

    button.addEventListener('click', () => {
      if (filters.tag === slug) {
        filters.tag = null;
      } else {
        filters.tag = slug;
      }
      renderTags(tags);
      refreshPosts();
    });

    tagList.append(button);
  });
}

function formatDateTime(value) {
  if (!value) {
    return 'n/d';
  }

  try {
    const timestamp = typeof value === 'number' ? value * 1000 : value;
    const date = new Date(timestamp);
    return intlDateTime.format(date);
  } catch (error) {
    console.error(error);
    return 'n/d';
  }
}

function getDisplayTitle(title) {
  const base = typeof title === 'string' && title.trim().length > 0 ? title.trim() : '(sem título)';

  if (base.length <= TITLE_MAX_LENGTH) {
    return { text: base, truncated: false };
  }

  return {
    text: `${base.slice(0, TITLE_MAX_LENGTH - 1)}…`,
    truncated: true,
  };
}

function parseTagsInput(raw) {
  if (raw === undefined || raw === null) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw.flatMap((value) => parseTagsInput(value));
  }

  return String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function formatTagsForInput(list) {
  return formatTagsForDisplay(list).join(', ');
}

function formatTagsForDisplay(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return [];
  }

  return list
    .map((tag) => {
      if (typeof tag === 'string') {
        return tag.trim();
      }

      if (tag && typeof tag === 'object') {
        return String(tag.name ?? tag.slug ?? '').trim();
      }

      return '';
    })
    .filter(Boolean)
    .map((value) => value.toLowerCase());
}

function ensureComposeFormHandler() {
  if (boundComposeForm && boundComposeForm !== composeForm) {
    boundComposeForm.removeEventListener('submit', handleComposeSubmit);
    const prevField = getComposeContentField(boundComposeForm);
    prevField?.removeEventListener('input', handleComposeContentInput);
    prevField?.removeEventListener('blur', handleComposeContentInput);
    boundComposeForm = null;
  }

  if (composeForm && boundComposeForm !== composeForm) {
    composeForm.addEventListener('submit', handleComposeSubmit);
    const field = getComposeContentField();
    field?.addEventListener('input', handleComposeContentInput);
    field?.addEventListener('blur', handleComposeContentInput);
    boundComposeForm = composeForm;
    handleComposeContentInput();
  }
}

function ensureLoginFormHandler() {
  if (boundLoginForm && boundLoginForm !== loginForm) {
    boundLoginForm.removeEventListener('submit', handleLoginSubmit);
    boundLoginForm = null;
  }

  if (loginForm && boundLoginForm !== loginForm) {
    loginForm.addEventListener('submit', handleLoginSubmit);
    boundLoginForm = loginForm;
  }
}

function ensureComposeModalHandler() {
  if (boundComposeModal && boundComposeModal !== composeModal) {
    boundComposeModal.removeEventListener('click', handleComposeBackdropClick);
    boundComposeModal = null;
  }

  if (composeModal && boundComposeModal !== composeModal) {
    composeModal.addEventListener('click', handleComposeBackdropClick);
    boundComposeModal = composeModal;
  }
}

function ensureLoginModalHandler() {
  if (boundLoginModal && boundLoginModal !== loginModal) {
    boundLoginModal.removeEventListener('click', handleLoginBackdropClick);
    boundLoginModal = null;
  }

  if (loginModal && boundLoginModal !== loginModal) {
    loginModal.addEventListener('click', handleLoginBackdropClick);
    boundLoginModal = loginModal;
  }
}

function ensureSearchHandlers() {
  if (boundSearchForm && boundSearchForm !== searchForm) {
    boundSearchForm.removeEventListener('submit', handleSearchSubmit);
    boundSearchForm = null;
  }

  if (searchForm && boundSearchForm !== searchForm) {
    searchForm.addEventListener('submit', handleSearchSubmit);
    boundSearchForm = searchForm;
  }

  if (boundClearSearchButton && boundClearSearchButton !== clearSearchButton) {
    boundClearSearchButton.removeEventListener('click', handleClearSearchClick);
    boundClearSearchButton = null;
  }

  if (clearSearchButton && boundClearSearchButton !== clearSearchButton) {
    clearSearchButton.addEventListener('click', handleClearSearchClick);
    boundClearSearchButton = clearSearchButton;
  }

  if (boundSearchInput && boundSearchInput !== searchInput) {
    boundSearchInput.removeEventListener('input', handleSearchInput);
    boundSearchInput = null;
  }

  if (searchInput && boundSearchInput !== searchInput) {
    searchInput.addEventListener('input', handleSearchInput);
    boundSearchInput = searchInput;
  }

  if (searchInput) {
    searchInput.value = filters.query;
  }
}

function bindInteractions() {
  composeButtons.forEach((button) => {
    button.removeEventListener('click', handleComposeButtonClick);
    button.addEventListener('click', handleComposeButtonClick);
  });

  composeCloseButtons.forEach((button) => {
    button.removeEventListener('click', handleCloseComposeClick);
    button.addEventListener('click', handleCloseComposeClick);
  });

  loginButtons.forEach((button) => {
    button.removeEventListener('click', handleOpenLoginClick);
    button.addEventListener('click', handleOpenLoginClick);
  });

  loginCloseButtons.forEach((button) => {
    button.removeEventListener('click', handleCloseLoginClick);
    button.addEventListener('click', handleCloseLoginClick);
  });

  logoutButtons.forEach((button) => {
    button.removeEventListener('click', handleLogoutClick);
    button.addEventListener('click', handleLogoutClick);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    refreshPosts();
    refreshTags();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeComposeModal();
    }
  });
}

if (hasDocument) {
  bindInteractions();
  ensureComposeModalHandler();
  ensureLoginModalHandler();
  ensureComposeFormHandler();
  ensureLoginFormHandler();
  ensureSearchHandlers();
  updateAuthVisibility();
  document.addEventListener('click', handleCopyCodeClick);
  fetchSession()
    .catch(() => {})
    .finally(() => {
      refreshPosts();
      refreshTags();
    });
}

function setDomRefs(overrides) {
  if (overrides.postList !== undefined) {
    postList = overrides.postList;
  }
  if (overrides.composeModal !== undefined) {
    composeModal = overrides.composeModal;
    ensureComposeModalHandler();
  }
  if (overrides.loginModal !== undefined) {
    loginModal = overrides.loginModal;
    ensureLoginModalHandler();
  }
  if (overrides.composeForm !== undefined) {
    composeForm = overrides.composeForm;
    ensureComposeFormHandler();
  }
  if (overrides.composePreview !== undefined) {
    composePreview = overrides.composePreview;
  }
  if (overrides.composePreviewStatus !== undefined) {
    composePreviewStatus = overrides.composePreviewStatus;
  }
  if (overrides.composePreviewContent !== undefined) {
    composePreviewContent = overrides.composePreviewContent;
  }
  if (overrides.composeButtons !== undefined) {
    composeButtons = overrides.composeButtons;
    bindInteractions();
  }
  if (overrides.composeCloseButtons !== undefined) {
    composeCloseButtons = overrides.composeCloseButtons;
    bindInteractions();
  }
  if (overrides.loginButtons !== undefined) {
    loginButtons = overrides.loginButtons;
    bindInteractions();
  }
  if (overrides.loginCloseButtons !== undefined) {
    loginCloseButtons = overrides.loginCloseButtons;
    bindInteractions();
  }
  if (overrides.logoutButtons !== undefined) {
    logoutButtons = overrides.logoutButtons;
    bindInteractions();
  }
  if (overrides.searchForm !== undefined) {
    searchForm = overrides.searchForm;
    ensureSearchHandlers();
  }
  if (overrides.searchInput !== undefined) {
    searchInput = overrides.searchInput;
    if (searchInput) {
      searchInput.value = filters.query;
    }
  }
  if (overrides.clearSearchButton !== undefined) {
    clearSearchButton = overrides.clearSearchButton;
    ensureSearchHandlers();
  }
  if (overrides.tagList !== undefined) {
    tagList = overrides.tagList;
    renderTags(cachedTags);
  }
}

async function writeClipboard(value) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function applyCopyFeedback(button, successText, fallbackText) {
  button.dataset.state = successText === 'erro' ? 'error' : 'copied';
  button.textContent = successText;

  if (copyCodeResetTimers.has(button)) {
    clearTimeout(copyCodeResetTimers.get(button));
  }

  const timeoutId = setTimeout(() => {
    button.dataset.state = 'idle';
    button.textContent = fallbackText;
    copyCodeResetTimers.delete(button);
  }, CODE_COPY_FEEDBACK_MS);

  copyCodeResetTimers.set(button, timeoutId);
}

function slugify(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const slug = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || null;
}

export {
  request,
  formatDateTime,
  openComposeModal,
  closeComposeModal,
  openLoginModal,
  closeLoginModal,
  setAuthState,
  setDomRefs,
  refreshPosts,
  ensureComposeFormHandler,
  ensureComposeModalHandler,
  bindInteractions,
  getDisplayTitle,
  refreshTags,
  ensureSearchHandlers,
  schedulePreviewUpdate,
};
