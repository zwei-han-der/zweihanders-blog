import { Marked, Renderer, type Tokens } from 'marked';
import sanitizeHtml from 'sanitize-html';

const renderer = new Renderer();

renderer.code = function renderCode(token: Tokens.Code): string {
  const text = typeof token.text === 'string' ? token.text : '';
  const language = normalizeLanguage(token.lang);
  const label = escapeHtml(getLanguageLabel(language));
  const normalized = escapeHtml(language);
  const classAttribute = language ? ` class="language-${normalized}"` : '';
  const dataAttribute = ` data-language="${normalized}"`;
  const safeCode = token.escaped ? text : escapeHtml(text);

  return [
    `<figure class="code-block" data-language="${normalized}">`,
    `<figcaption class="code-block__header"><span class="code-block__lang">${label}</span><button type="button" class="code-block__copy" data-action="copy-code">copiar</button></figcaption>`,
    `<pre class="code-block__body"><code${classAttribute}${dataAttribute}>${safeCode}</code></pre>`,
    `</figure>`,
  ].join('');
};

const markdown = new Marked({ gfm: true, breaks: true, renderer });

const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'bash',
  shell: 'bash',
  bash: 'bash',
  zsh: 'bash',
  py: 'python',
  plaintext: 'plaintext',
  text: 'plaintext',
  jsonc: 'json',
};

const LANGUAGE_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  bash: 'Bash',
  python: 'Python',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  sql: 'SQL',
  yaml: 'YAML',
  markdown: 'Markdown',
  plaintext: 'Plain Text',
};

const allowedTags = Array.from(
  new Set([
    ...sanitizeHtml.defaults.allowedTags,
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'img',
    'pre',
    'code',
    'blockquote',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'figure',
    'figcaption',
    'span',
    'button',
  ]),
);

const allowedAttributes: sanitizeHtml.IOptions['allowedAttributes'] = {
  ...sanitizeHtml.defaults.allowedAttributes,
  a: ['href', 'name', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  figure: ['class', 'data-language'],
  figcaption: ['class'],
  pre: ['class'],
  code: ['class', 'data-language'],
  span: ['class'],
  button: ['type', 'class', 'data-action'],
};

export function renderMarkdown(input: string | null | undefined): string {
  const source = typeof input === 'string' ? input : '';

  if (!source.trim()) {
    return '';
  }

  const parsed = markdown.parse(source);
  const html = typeof parsed === 'string' ? parsed : '';

  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: attribs.rel?.includes('noopener') ? attribs.rel : 'noopener noreferrer',
          target: attribs.target ?? '_blank',
        },
      }),
    },
  });
}

function normalizeLanguage(value: string | null | undefined): string {
  const base = (value ?? '').trim().toLowerCase();

  if (!base) {
    return 'plaintext';
  }

  const [firstTokenRaw] = base.split(/\s+/);
  const firstToken = firstTokenRaw ?? base;
  return CODE_LANGUAGE_ALIASES[firstToken] ?? firstToken;
}

function getLanguageLabel(language: string): string {
  const preset = LANGUAGE_LABELS[language];

  if (preset) {
    return preset;
  }

  const formatted = language
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match: string) => match.toUpperCase());

  const fallback = LANGUAGE_LABELS.plaintext ?? 'Plain Text';
  return formatted.length > 0 ? formatted : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
