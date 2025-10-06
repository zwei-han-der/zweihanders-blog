import type { HLJSApi } from 'highlight.js';

declare module 'highlight.js/lib/core.js' {
  import hljs from 'highlight.js';
  const api: typeof hljs;
  export default api;
}

declare module 'highlight.js/lib/languages/*.js' {
  const language: (hljs: HLJSApi) => void;
  export default language;
}
