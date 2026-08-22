# App Copilot

An AI copilot that floats over whatever desktop application you are using. It tracks the
focused window, hands that context to the model, and stays click-through everywhere except
over its own panel, so the app underneath keeps working normally.

## Shortcuts

| Shortcut               | Action                                                      |
| ---------------------- | ----------------------------------------------------------- |
| `Ctrl/Cmd+Shift+Space` | Show or hide the panel                                      |
| `Ctrl/Cmd+Shift+A`     | Give the panel keyboard focus / hand focus back to the app   |
| `Esc`                  | Hide the panel                                              |
| `Enter`                | Send · `Shift+Enter` for a newline                          |

The tray icon offers the same actions plus Quit.

## Providers

OpenAI, Google Gemini and DeepSeek are built in, plus an **OpenAI-compatible** option for any
endpoint that speaks the `/chat/completions` API (OpenRouter, Ollama, LM Studio, a gateway of
your own). Pick a provider in the panel's settings and paste an API key.

Keys are held by the main process and written to disk encrypted with Electron's `safeStorage`;
they are never exposed to the renderer. If the OS provides no encrypted store, keys are kept in
memory for the session only and the panel says so.

## Development

```bash
yarn install
```

```bash
yarn dev
```

`yarn dev` builds the main process, starts Vite and launches Electron against it.

The native overlay addon is optional. Without it the app still runs — the panel falls back to a
full-screen always-on-top window instead of attaching to a specific target window. To build it
you need a C toolchain (MSVC on Windows):

```bash
npx electron-rebuild
```

Opening http://127.0.0.1:5173 in a plain browser also works for styling: the preload bridge is
absent, so every call degrades to a no-op and the panel renders on its own.

## Checks and packaging

```bash
yarn lint && yarn typecheck && yarn build && yarn test
```

`yarn test` runs `scripts/test-chat-stream.mjs`, which exercises the streaming chat client
(SSE reassembly, request shaping, error surfacing, abort) against a mocked fetch. It reads the
compiled output, so build first.

```bash
yarn build && yarn release
```

`build` emits the renderer and main bundles into `prebuild/`; `release` packages an NSIS
installer with electron-builder. CI runs the same lint, typecheck and build on every push to
`main` before publishing a release.
