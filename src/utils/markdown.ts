import {
  Marked,
  Renderer,
  type RendererThis,
  type TokenizerAndRendererExtension,
  type TokenizerThis,
  type Tokens,
} from 'marked';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdownLanguage from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescriptLanguage from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import sanitizeHtml from 'sanitize-html';

const renderer = new Renderer();

if (!hljs.getLanguage('bash')) {
  hljs.registerLanguage('bash', bash);
}

if (!hljs.getLanguage('css')) {
  hljs.registerLanguage('css', css);
}

if (!hljs.getLanguage('javascript')) {
  hljs.registerLanguage('javascript', javascript);
}

if (!hljs.getLanguage('json')) {
  hljs.registerLanguage('json', json);
}

if (!hljs.getLanguage('markdown')) {
  hljs.registerLanguage('markdown', markdownLanguage);
}

if (!hljs.getLanguage('plaintext')) {
  hljs.registerLanguage('plaintext', plaintext);
}

if (!hljs.getLanguage('python')) {
  hljs.registerLanguage('python', python);
}

if (!hljs.getLanguage('sql')) {
  hljs.registerLanguage('sql', sql);
}

if (!hljs.getLanguage('typescript')) {
  hljs.registerLanguage('typescript', typescriptLanguage);
}

if (!hljs.getLanguage('xml')) {
  hljs.registerLanguage('xml', xml);
}

if (!hljs.getLanguage('yaml')) {
  hljs.registerLanguage('yaml', yaml);
}

type DefinitionListItem = {
  term: Tokens.Generic[];
  descriptions: Tokens.Generic[][];
};

type DefinitionListToken = Tokens.Generic & {
  type: 'definitionList';
  raw: string;
  items: DefinitionListItem[];
};

const definitionListExtension: TokenizerAndRendererExtension = {
  name: 'definitionList',
  level: 'block',
  start(src) {
    const match = src.match(/^(?: {0,3}(?![:\s])\S[^\n]*\n {0,3}:\s+)/m);
    return typeof match?.index === 'number' ? match.index : undefined;
  },
  tokenizer(this: TokenizerThis, src: string) {
    const items: DefinitionListItem[] = [];
    let position = 0;
    let lastPosition = 0;

    while (position < src.length) {
      const slice = src.slice(position);

      if (!slice || /^\n{2,}/.test(slice)) {
        break;
      }

      const termStart = position;
      const termMatch = /^( {0,3}(?![:\s])\S[^\n]*)(?:\n|$)/.exec(slice);

      if (!termMatch) {
        break;
      }

      const termContent = termMatch[1] ?? '';
      position += termMatch[0].length;

      const descriptions: Tokens.Generic[][] = [];
      let hasDefinition = false;

      while (position < src.length) {
        const ddSlice = src.slice(position);
        const definitionMatch = /^( {0,3}:\s.*)(?:\n|$)/.exec(ddSlice);

        if (!definitionMatch) {
          break;
        }

        hasDefinition = true;
        position += definitionMatch[0].length;
        const definitionContent = (definitionMatch[1] ?? '').replace(/^\s*:\s?/, '');
        descriptions.push(this.lexer.inlineTokens(definitionContent.trim(), []));
      }

      if (!hasDefinition) {
        position = termStart;
        break;
      }

      items.push({
        term: this.lexer.inlineTokens(termContent.trim(), []),
        descriptions,
      });

      const blankMatch = /^\n+/.exec(src.slice(position));

      if (blankMatch) {
        position += blankMatch[0].length;
      }

      lastPosition = position;

      const nextSlice = src.slice(position);
      if (!/^( {0,3}(?![:\s])\S[^\n]*)(?:\n|$)/.test(nextSlice)) {
        break;
      }
    }

    if (!items.length) {
      return undefined;
    }

    const consumed = lastPosition > 0 ? lastPosition : position;
    const raw = src.slice(0, consumed);

    return { type: 'definitionList', raw, items } as DefinitionListToken;
  },
  renderer(this: RendererThis, token) {
    const parser = this.parser as unknown as { parseInline(tokens: Tokens.Generic[]): string };
    const { items } = token as DefinitionListToken;
    const parts: string[] = ['<dl>'];

    for (const item of items) {
      parts.push(`<dt>${parser.parseInline(item.term)}</dt>`);

      for (const description of item.descriptions) {
        parts.push(`<dd>${parser.parseInline(description)}</dd>`);
      }
    }

    parts.push('</dl>');
    return parts.join('');
  },
};

renderer.code = function renderCode(token: Tokens.Code): string {
  const source = typeof token.text === 'string' ? token.text : '';
  const language = normalizeLanguage(token.lang);
  const label = escapeHtml(getLanguageLabel(language));
  const languageAttribute = escapeHtml(language);
  const highlighted = getHighlightedCode(source, language);
  const codeClasses = ['hljs'];

  if (language) {
    codeClasses.push(`language-${language}`);
  }

  const classAttribute = ` class="${codeClasses.map(escapeHtml).join(' ')}"`;
  const dataAttribute = ` data-language="${languageAttribute}"`;
  const codeContent = highlighted ?? escapeHtml(source);

  return [
    `<figure class="code-block" data-language="${languageAttribute}">`,
    `<figcaption class="code-block__header"><span class="code-block__lang">${label}</span><button type="button" class="code-block__copy" data-action="copy-code">copiar</button></figcaption>`,
    `<pre class="code-block__body"><code${classAttribute}${dataAttribute}>${codeContent}</code></pre>`,
    `</figure>`,
  ].join('');
};

type CheckboxPayload = Parameters<Renderer['checkbox']>[0];

renderer.checkbox = function renderCheckbox(payload: CheckboxPayload): string {
  const isChecked = typeof payload === 'object' && payload !== null && 'checked' in payload ? Boolean((payload as { checked?: boolean }).checked) : Boolean(payload);
  const state = isChecked ? 'true' : 'false';
  const symbol = isChecked ? '✅' : '❌';
  return `<span class="task-checkbox" data-checked="${state}" aria-hidden="true">${symbol}</span>`;
};

type ImageToken = Parameters<Renderer['image']>[0];

renderer.image = function renderImage(token: ImageToken): string {
  const source = typeof token?.href === 'string' ? token.href.trim() : '';
  const altText = typeof token?.text === 'string' ? token.text : '';
  const titleText = typeof token?.title === 'string' ? token.title : '';
  const classes = ['markdown-image'];
  const attributes = [`src="${escapeHtml(source)}"`, `alt="${escapeHtml(altText)}"`];

  if (titleText) {
    attributes.push(`title="${escapeHtml(titleText)}"`);
  }

  attributes.push('loading="lazy"', 'decoding="async"', 'referrerpolicy="no-referrer"', 'fetchpriority="auto"', `class="${classes.join(' ')}"`);

  return `<img ${attributes.join(' ')}>`;
};

const markdown = new Marked({ gfm: true, breaks: true, renderer });
markdown.use({ extensions: [definitionListExtension] });

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
    'dl',
    'dt',
    'dd',
     'del',
    's',
    'details',
    'summary',
  ]),
);

const allowedAttributes: sanitizeHtml.IOptions['allowedAttributes'] = {
  ...sanitizeHtml.defaults.allowedAttributes,
  a: ['href', 'name', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height', 'class', 'loading', 'decoding', 'referrerpolicy', 'fetchpriority', 'srcset', 'sizes'],
  figure: ['class', 'data-language'],
  figcaption: ['class'],
  pre: ['class'],
  code: ['class', 'data-language'],
  span: ['class', 'aria-hidden', 'data-checked'],
  button: ['type', 'class', 'data-action', 'data-state'],
  ul: ['class'],
  li: ['class'],
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
      a: (tagName, attribs) => {
        const href = attribs.href ?? '';
        const isExternal = /^https?:\/\//i.test(href);
        const nextAttribs: sanitizeHtml.Attributes = { ...attribs };

        if (isExternal) {
          const relTokens = (attribs.rel ?? '')
            .split(/\s+/)
            .map((token) => token.trim())
            .filter(Boolean);
          const relSet = new Set(relTokens);
          relSet.add('noopener');
          relSet.add('noreferrer');
          nextAttribs.rel = Array.from(relSet).join(' ');
          if (!nextAttribs.target) {
            nextAttribs.target = '_blank';
          }
        }

        return {
          tagName,
          attribs: nextAttribs,
        };
      },
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

function getHighlightedCode(source: string, language: string): string | null {
  if (!source) {
    return null;
  }

  if (!language || language === 'plaintext') {
    return null;
  }

  if (!hljs.getLanguage(language)) {
    return null;
  }

  try {
    const result = hljs.highlight(source, { language, ignoreIllegals: true });
    return result.value;
  } catch {
    return null;
  }
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

const IMAGE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'cur',
  'gif',
  'ico',
  'jfif',
  'jpeg',
  'jpg',
  'pjpeg',
  'pjp',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
]);

const IMAGE_WARNING_MESSAGE = 'link fornecido não parece apontar para uma imagem válida';

const IMAGE_URL_PARAM_KEYS = new Set([
  'u',
  'url',
  'src',
  'source',
  'image',
  'img',
  'imgurl',
  'mediaurl',
  'href',
]);

const IMAGE_FORMAT_PARAM_KEYS = new Set([
  'format',
  'ext',
  'extension',
  'fm',
  'mime',
  'type',
  'mediaformat',
]);

const IMAGE_HOST_HINTS = new Set([
  'pbs.twimg.com',
  'external-content.duckduckgo.com',
  'tse1.mm.bing.net',
  'mm.bing.net',
  'images.unsplash.com',
  'i.imgur.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
]);

const IMAGE_HOST_SUFFIX_HINTS = ['.twimg.com', '.googleusercontent.com', '.gstatic.com'];

function isLikelyImageUrl(value: string, depth = 0, visited = new Set<string>()): boolean {
  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  const normalized = trimmed.toLowerCase();

  if (normalized.startsWith('data:image/')) {
    return true;
  }

  if (visited.has(trimmed) || depth > 4) {
    return false;
  }

  visited.add(trimmed);

  try {
    const url = new URL(trimmed, 'http://localhost');

    if (hasImageExtension(url.pathname)) {
      return true;
    }

    if (hasImageHostHint(url.hostname)) {
      return true;
    }

    if (hasImageFormatParam(url.searchParams)) {
      return true;
    }

    const candidates = extractImageCandidates(url.searchParams);
    for (const candidate of candidates) {
      if (isLikelyImageUrl(candidate, depth + 1, visited)) {
        return true;
      }
    }

    return false;
  } catch {
    return hasImageExtension(trimmed);
  }
}

function hasImageExtension(value: string): boolean {
  const normalized = value.split(/[?#]/)[0] ?? '';
  const dotIndex = normalized.lastIndexOf('.');

  if (dotIndex === -1) {
    return false;
  }

  const extension = normalized.slice(dotIndex + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension);
}

function hasImageHostHint(hostname: string): boolean {
  const lowered = hostname.toLowerCase();

  if (!lowered) {
    return false;
  }

  if (IMAGE_HOST_HINTS.has(lowered)) {
    return true;
  }

  return IMAGE_HOST_SUFFIX_HINTS.some((suffix) => lowered.endsWith(suffix));
}

function hasImageFormatParam(params: URLSearchParams): boolean {
  for (const [key, value] of params.entries()) {
    const loweredKey = key.toLowerCase();
    const loweredValue = value.trim().toLowerCase();

    if (!loweredValue) {
      continue;
    }

    if (IMAGE_FORMAT_PARAM_KEYS.has(loweredKey) && IMAGE_EXTENSIONS.has(loweredValue.split(/[;,]+/)[0] ?? '')) {
      return true;
    }
  }

  return false;
}

function extractImageCandidates(params: URLSearchParams): string[] {
  const candidates: string[] = [];

  params.forEach((value, key) => {
    if (!value) {
      return;
    }

    const decoded = decodeValue(value);
    const loweredKey = key.toLowerCase();

    if (IMAGE_URL_PARAM_KEYS.has(loweredKey)) {
      candidates.push(decoded);
      return;
    }

    if (/https?:/i.test(decoded) || decoded.startsWith('data:image/')) {
      candidates.push(decoded);
    }
  });

  return candidates;
}

function decodeValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
