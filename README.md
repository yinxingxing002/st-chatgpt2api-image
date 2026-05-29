# ChatGPT2API Image for SillyTavern

Third-party SillyTavern extension for:

- extracting the latest assistant message
- generating an image prompt through an external prompt API
- calling a `chatgpt2api` image endpoint
- attaching the generated image back into the current assistant message

This repository is intentionally structured as a standalone SillyTavern extension root.
When users install it from a Git URL, the repository contents can be cloned directly into the extension folder without an extra nested directory.

## Features

- Inline `生图` button inside assistant messages
- Floating image panel for prompt generation and image generation
- Floating control console for API settings and descriptor library management
- Draggable floating launcher button
- Prompt safety rewrite layer for sensitive or NSFW wording
- Character card descriptor library
- User persona descriptor library
- Prompt model list fetching from `/models`
- Image result attached back to the same assistant message

## Repository Layout

The repository root should contain these files directly:

```text
manifest.json
index.js
style.css
settings.html
panel.html
control-panel.html
```

Do not wrap these files inside another folder if you want SillyTavern to install the extension cleanly from Git.

## Installation

### Method 1: Install from Git URL

In SillyTavern third-party extension install flow, paste:

```text
https://github.com/yinxingxing002/st-chatgpt2api-image
```

### Method 2: Manual install

Clone or copy this repository into:

```text
public/scripts/extensions/third-party/st-chatgpt2api-image
```

Then refresh SillyTavern.

## Required APIs

You need:

1. A prompt API
   - OpenAI-compatible `/chat/completions` is supported
   - `/models` fetching is also supported
2. An image API
   - OpenAI-compatible `chatgpt2api` image endpoint is expected
   - OpenAI Images mode uses `/v1/images/generations`
   - Grok chat-image mode uses a separate `/v1/chat/completions` configuration and parses absolute or relative returned image URLs

Important:

- If the extension is used directly from the browser, the API should allow CORS.
- In `tavern` mode, prompt requests can reuse SillyTavern's backend proxy chain.
- In `tavern` mode, image requests can use SillyTavern's built-in `/proxy/...` route when `enableCorsProxy: true` is enabled in `config.yaml`.
- If neither browser CORS nor SillyTavern CORS proxy is available, the image API still needs a same-origin reverse proxy on the server side.

## Main Settings

- Prompt API URL
- Prompt API Key
- Prompt API Model
- Image API Base URL
- Image API Key
- Image Provider (`ChatGPT2API / OpenAI Images` or `Grok chat-image`)
- Image Model
- Independent Grok API URL, key, model, stream mode, and reference-image toggle
- Sensitive term guard
- Character descriptor library
- Persona descriptor library
- Inline image button enable/disable

## Notes Before Publishing

- Review displayed Chinese text once inside SillyTavern after the first Git-based install.
- If you add screenshots later, place them in a separate `docs/` or `assets/` folder.

## Local Working Copy

This independent extension repository has been prepared locally at:

`C:\Users\27546\Desktop\新建文件夹 (4)\st-chatgpt2api-image`
