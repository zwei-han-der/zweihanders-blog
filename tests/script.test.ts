import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

class StubElement {
  tag: string;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: StubElement[] = [];
  attributes = new Map<string, string>();
  textContent = "";
  value = "";
  innerHTML = "";
  listeners = new Map<string, Set<(event: any) => void>>();
  formElements: Record<string, StubElement> = {};

  constructor(tag: string) {
    this.tag = tag;
  }

  append(...nodes: StubElement[]) {
    this.children.push(...nodes);
  }

  appendChild(node: StubElement) {
    this.children.push(node);
    return node;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, handler: (event: any) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (event: any) => void) {
    this.listeners.get(type)?.delete(handler);
  }

  dispatchEvent(event: { type: string; target?: unknown }) {
    const handlers = this.listeners.get(event.type);
    if (!handlers) {
      return;
    }
    handlers.forEach((handler) => handler({ ...event, target: event.target ?? this }));
  }

  focus() {}

  select() {}

  reset() {
    Object.values(this.formElements).forEach((el) => {
      el.value = "";
      el.textContent = "";
    });
  }
}

function createStubDocument() {
  const documentListeners = new Map<string, Set<(event: any) => void>>();

  return {
    createElement(tag: string) {
      return new StubElement(tag);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type: string, handler: (event: any) => void) {
      if (!documentListeners.has(type)) {
        documentListeners.set(type, new Set());
      }
      documentListeners.get(type)!.add(handler);
    },
    removeEventListener(type: string, handler: (event: any) => void) {
      documentListeners.get(type)?.delete(handler);
    },
    dispatchEvent(event: { type: string }) {
      const handlers = documentListeners.get(event.type);
      if (!handlers) {
        return;
      }
      handlers.forEach((handler) => handler({ ...event }));
    },
  };
}

const stubDocument = createStubDocument();
(globalThis as any).document = stubDocument;
const doc = stubDocument as any;

const scriptModulePromise = import("../public/script.js");
const MOCK_KEY_HASH = "test-key-hash";

type SessionUser = { id: number; role: string; keyHash: string };
type SessionState = { authenticated: boolean; user: SessionUser | null };

const sessionState: SessionState = { authenticated: false, user: null };

const fetchMock = mock(async (path: string, init?: RequestInit) => {
  const method = (init?.method ?? "GET").toUpperCase();

  if (path === "/auth/session") {
    return new Response(JSON.stringify(sessionState), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (path === "/auth/login" && method === "POST") {
    sessionState.authenticated = true;
    sessionState.user = { id: 1, role: "admin", keyHash: MOCK_KEY_HASH };

    return new Response(JSON.stringify({ authenticated: true, user: sessionState.user }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (path === "/auth/logout" && method === "POST") {
    sessionState.authenticated = false;
    sessionState.user = null;
    return new Response(null, { status: 204 });
  }

  if (path === "/posts" || path.startsWith("/posts?")) {
    if (method === "POST") {
      return new Response(JSON.stringify({ id: 1, title: "mock", content: "body" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify([
        { id: 1, title: "first", content: "text", createdAt: 1_700_000_000, updatedAt: 1_700_000_000 },
      ]),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (path === "/tags") {
    return new Response(JSON.stringify([{ id: 1, name: "tech", slug: "tech" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (path.startsWith("/posts/") && method === "PUT") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (path.startsWith("/posts/") && method === "DELETE") {
    return new Response(null, { status: 204 });
  }

  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
});

globalThis.fetch = fetchMock as unknown as typeof fetch;

class StubFormData {
  private data = new Map<string, string[]>();

  constructor(form: { formElements?: Record<string, StubElement> } | null | undefined) {
    const entries = form?.formElements ?? {};
    Object.keys(entries).forEach((key) => {
      const value = entries[key]?.value ?? "";
      if (value !== undefined && value !== null) {
        this.set(key, String(value));
      }
    });
  }

  append(name: string, value: string): void {
    const list = this.data.get(name) ?? [];
    list.push(String(value));
    this.data.set(name, list);
  }

  delete(name: string): void {
    this.data.delete(name);
  }

  get(name: string): string | null {
    const list = this.data.get(name);
    if (!list || list.length === 0) {
      return null;
    }

    return list[0] ?? null;
  }

  getAll(name: string): string[] {
    return [...(this.data.get(name) ?? [])];
  }

  has(name: string): boolean {
    return this.data.has(name);
  }

  set(name: string, value: string): void {
    this.data.set(name, [String(value)]);
  }

  forEach(callback: (value: string, key: string, parent: FormData) => void, thisArg?: unknown): void {
    for (const [key, values] of this.data.entries()) {
      values.forEach((value) => callback.call(thisArg, value, key, this as unknown as FormData));
    }
  }

  entries(): IterableIterator<[string, string]> {
    return (function* (map: Map<string, string[]>) {
      for (const [key, values] of map.entries()) {
        for (const value of values) {
          yield [key, value] as [string, string];
        }
      }
    })(this.data);
  }

  keys(): IterableIterator<string> {
    return this.data.keys();
  }

  values(): IterableIterator<string> {
    return (function* (map: Map<string, string[]>) {
      for (const values of map.values()) {
        for (const value of values) {
          yield value;
        }
      }
    })(this.data);
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }
}

(globalThis as any).FormData = StubFormData as unknown as typeof FormData;

type ScriptModule = typeof import("../public/script.js");

let request: ScriptModule["request"];
let formatDateTime: ScriptModule["formatDateTime"];
let openComposeModal: ScriptModule["openComposeModal"];
let closeComposeModal: ScriptModule["closeComposeModal"];
let openLoginModal: ScriptModule["openLoginModal"];
let closeLoginModal: ScriptModule["closeLoginModal"];
let setAuthState: ScriptModule["setAuthState"];
let setDomRefs: ScriptModule["setDomRefs"];
let refreshPosts: ScriptModule["refreshPosts"];
let getDisplayTitle: ScriptModule["getDisplayTitle"];
let ensureSearchHandlers: ScriptModule["ensureSearchHandlers"];
let ensureComposeFormHandler: ScriptModule["ensureComposeFormHandler"];

beforeAll(async () => {
  const module = await scriptModulePromise;
  request = module.request;
  formatDateTime = module.formatDateTime;
  openComposeModal = module.openComposeModal;
  closeComposeModal = module.closeComposeModal;
  openLoginModal = module.openLoginModal;
  closeLoginModal = module.closeLoginModal;
  setAuthState = module.setAuthState;
  setDomRefs = module.setDomRefs;
  refreshPosts = module.refreshPosts;
  getDisplayTitle = module.getDisplayTitle;
  ensureSearchHandlers = module.ensureSearchHandlers;
  ensureComposeFormHandler = module.ensureComposeFormHandler;
});

beforeEach(() => {
  sessionState.authenticated = false;
  sessionState.user = null;
  fetchMock.mockClear();
  setAuthState({ authenticated: false, user: null });
});

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("formatDateTime", () => {
  test("formats numeric timestamp", () => {
    const result = formatDateTime(1_700_000_000);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("returns fallback for invalid input", () => {
    expect(formatDateTime(undefined)).toBe("n/d");
  });
});

describe("getDisplayTitle", () => {
  test("returns original when within limit", () => {
    const { text, truncated } = getDisplayTitle("Título curto");
    expect(text).toBe("Título curto");
    expect(truncated).toBe(false);
  });

  test("truncates and appends ellipsis when over limit", () => {
    const longTitle = "x".repeat(120);
    const { text, truncated } = getDisplayTitle(longTitle);
    expect(truncated).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThan(longTitle.length);
  });
});

describe("request", () => {
  test("executes GET and parses JSON", async () => {
    const data = (await request("/posts")) as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].title).toBe("first");
  });

  test("sends POST body as JSON", async () => {
    const data = (await request("/posts", {
      method: "POST",
      body: { title: "x", content: "y" },
    })) as any;
    expect(data.id).toBe(1);
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("/posts");
    expect((lastCall?.[1] as RequestInit | undefined)?.body).toBeDefined();
  });

  test("throws on non-ok response", async () => {
    await expect(request("/missing")).rejects.toThrow("not found");
  });
});

describe("modal controls", () => {
  const buildElement = () => doc.createElement("div");

  test("open and close modal toggle dataset", () => {
    const modal = buildElement();
    const form = doc.createElement("form");
    const loginModal = buildElement();
    const loginForm = doc.createElement("form");
    modal.dataset.open = "false";
    modal.setAttribute("aria-hidden", "true");

    const titleInput = doc.createElement("input");
    titleInput.setAttribute("name", "title");
    form.formElements.title = titleInput;
    form.elements = {
      namedItem(name: string) {
        return form.formElements[name] ?? null;
      },
    } as any;

    loginModal.dataset.open = "false";
    loginModal.setAttribute("aria-hidden", "true");

    const keyInput = doc.createElement("input");
    keyInput.setAttribute("name", "keyHash");
    loginForm.formElements.keyHash = keyInput;
    loginForm.elements = {
      namedItem(name: string) {
        return loginForm.formElements[name] ?? null;
      },
    } as any;

    setDomRefs({
      composeModal: modal as any,
      composeForm: form as any,
      loginModal: loginModal as any,
      loginForm: loginForm as any,
    });

    setAuthState({ authenticated: false, user: null });
    openComposeModal();
    expect(modal.dataset.open).toBe("false");
    expect(loginModal.dataset.open).toBe("true");
    expect(loginModal.getAttribute("aria-hidden")).toBe("false");

    closeComposeModal();
    expect(modal.dataset.open).toBe("false");
    expect(modal.getAttribute("aria-hidden")).toBe("true");
    closeLoginModal();
    expect(loginModal.dataset.open).toBe("false");

    setAuthState({ authenticated: true, user: { id: 1, role: "admin", keyHash: MOCK_KEY_HASH } });
    openComposeModal();
    expect(modal.dataset.open).toBe("true");
    expect(modal.getAttribute("aria-hidden")).toBe("false");
    closeComposeModal();
  });
});

describe("refreshPosts", () => {
  test("renders posts into provided container", async () => {
    const list = doc.createElement("div");

    setDomRefs({ postList: list as any });

    await refreshPosts();
    await flushMicrotasks();

    expect(list.children.length).toBeGreaterThan(0);
  });
});

describe("live search input", () => {
  test("triggers refresh after debounce", async () => {
    const list = doc.createElement("div");
    const form = doc.createElement("form");
    const input = doc.createElement("input");

    form.formElements = { q: input } as any;
    form.elements = {
      namedItem(name: string) {
        return name === "q" ? input : null;
      },
    } as any;

    setDomRefs({
      postList: list as any,
      searchForm: form as any,
      searchInput: input as any,
    });

    ensureSearchHandlers();

    input.value = "live";
    input.dispatchEvent({ type: "input" });

    await wait(300);
    await flushMicrotasks();

    expect(list.children.length).toBeGreaterThan(0);
  });
});

describe("compose form", () => {
  test("sends tags array on submit", async () => {
    const list = doc.createElement("div");
    const modal = doc.createElement("div");
    modal.dataset.open = "false";
    modal.setAttribute("aria-hidden", "true");

    const form = doc.createElement("form");
    const titleInput = doc.createElement("input");
    titleInput.setAttribute("name", "title");
    titleInput.value = "Novo post";

    const contentInput = doc.createElement("textarea");
    contentInput.setAttribute("name", "content");
    contentInput.value = "Conteúdo demo";

    const tagsInput = doc.createElement("input");
    tagsInput.setAttribute("name", "tags");
    tagsInput.value = "foo, bar ,  baz";

    form.formElements = { title: titleInput, content: contentInput, tags: tagsInput } as any;
    form.elements = {
      namedItem(name: string) {
        return form.formElements[name] ?? null;
      },
    } as any;

    setDomRefs({
      postList: list as any,
      composeForm: form as any,
      composeModal: modal as any,
    });

    ensureComposeFormHandler();

    fetchMock.mockClear();

    form.dispatchEvent({
      type: "submit",
      preventDefault() {},
    });

    await flushMicrotasks();

    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const postCall = calls.find(([url]) => url === "/posts");
    expect(postCall).toBeDefined();

    const [, init] = postCall as [string, RequestInit];
    const body = JSON.parse((init.body ?? "{}").toString());
    expect(body.tags).toEqual(["foo", "bar", "baz"]);
  });
});
