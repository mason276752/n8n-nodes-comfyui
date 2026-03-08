![Banner image](https://user-images.githubusercontent.com/10284570/173569848-c624317f-42b1-45a6-ab09-f0ea3c247648.png)

# n8n-nodes-comfyui

This package provides an n8n node to integrate with [ComfyUI](https://github.com/comfyanonymous/ComfyUI) — a powerful and modular stable diffusion GUI with a graph/nodes interface.

## Features

- Execute ComfyUI workflows directly from n8n
- Support for multiple input items (each item runs its own workflow)
- Automatic retrieval of generated images **and videos**
- Output format conversion: JPEG, PNG, WebP, or Raw (no conversion)
- Quality control for JPEG and WebP output
- Progress monitoring and error handling
- Optional API key authentication
- Configurable timeout

## Prerequisites

- n8n (version 1.0.0 or later)
- ComfyUI instance running and accessible
- Node.js 22.16 or newer

## Installation

```bash
pnpm install n8n-nodes-comfyui
```

Or via the n8n community nodes panel: search for `n8n-nodes-comfyui`.

## Node Configuration

### Credentials

| Field   | Description                                              |
|---------|----------------------------------------------------------|
| API URL | URL of your ComfyUI instance (e.g. `http://127.0.0.1:8188`) |
| API Key | Optional — required if your ComfyUI has authentication enabled |

### Parameters

| Parameter      | Description                                                                 |
|----------------|-----------------------------------------------------------------------------|
| Workflow JSON  | ComfyUI workflow exported as JSON (API format)                              |
| Output Format  | `JPEG` / `PNG` / `WebP` / `Raw (Original)` — applies to image outputs only |
| JPEG Quality   | Quality 1–100 (shown when Output Format is JPEG)                           |
| WebP Quality   | Quality 1–100 (shown when Output Format is WebP)                           |
| Timeout        | Maximum minutes to wait for workflow completion (default: 30)               |

### Output Format notes

- **JPEG / PNG / WebP** — images are decoded and re-encoded via [sharp](https://sharp.pixelplumbing.com/)
- **Raw (Original)** — files are downloaded as-is without any conversion; useful for formats sharp doesn't support, or when you want to preserve the original file exactly

### Outputs

Each output item contains:

**JSON fields**
- `filename` — original filename from ComfyUI
- `type` — `output` or `temp`
- `subfolder` — subfolder path if any
- `mediaType` — `image` or `video`

**Binary (`data`)**
- The file content as binary data, with correct `mimeType` and `fileExtension` set

## Multiple Input Items

When multiple items are passed into this node, each item is processed sequentially — one ComfyUI workflow execution per item. This allows expressions in the Workflow JSON field to reference each item's data (e.g. `{{ $json.prompt }}`).

## Usage

1. Export your workflow from ComfyUI via **Save (API Format)**
2. Add the ComfyUI node to your n8n workflow
3. Paste the workflow JSON into the **Workflow JSON** field
4. Set the API URL in the credentials
5. Execute — generated images and videos will appear as binary outputs

## Error Handling

The node handles:
- API connection failures
- Invalid workflow JSON
- ComfyUI execution errors (with node ID and error message)
- Timeout conditions
- Individual file download failures (non-fatal; returns error in `json.error`)

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Watch mode
pnpm dev

# Lint
pnpm lint
```

## License

[MIT](LICENSE.md)
