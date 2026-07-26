// Minimal ComfyUI HTTP API client + workflow patching.
// Workflows are ComfyUI "API format" JSON: { [nodeId]: { class_type, inputs, _meta? } }.
// Patching is by class_type; positive vs negative prompts are told apart by the
// node's _meta.title containing "negative" — keep that convention in workflow files.

export interface WorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export type Workflow = Record<string, WorkflowNode>;

export interface PatchParams {
  positive: string;
  negative?: string;
  width?: number;
  height?: number;
  batchSize?: number;
  seed?: number;
  checkpoint?: string;
}

export function patchWorkflow(wf: Workflow, p: PatchParams): Workflow {
  const out = structuredClone(wf);
  for (const node of Object.values(out)) {
    const title = (node._meta?.title ?? '').toLowerCase();
    switch (node.class_type) {
      case 'KSampler':
      case 'KSamplerAdvanced':
        if (p.seed !== undefined) {
          if ('seed' in node.inputs) node.inputs['seed'] = p.seed;
          if ('noise_seed' in node.inputs) node.inputs['noise_seed'] = p.seed;
        }
        break;
      case 'EmptyLatentImage':
      case 'EmptySD3LatentImage':
        if (p.width !== undefined) node.inputs['width'] = p.width;
        if (p.height !== undefined) node.inputs['height'] = p.height;
        if (p.batchSize !== undefined) node.inputs['batch_size'] = p.batchSize;
        break;
      case 'CLIPTextEncode':
        if (title.includes('negative')) {
          if (p.negative !== undefined) node.inputs['text'] = p.negative;
        } else {
          node.inputs['text'] = p.positive;
        }
        break;
      case 'CheckpointLoaderSimple':
        if (p.checkpoint !== undefined) node.inputs['ckpt_name'] = p.checkpoint;
        break;
    }
  }
  return out;
}

export interface OutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

interface HistoryEntry {
  status?: { completed?: boolean; status_str?: string };
  outputs?: Record<string, { images?: OutputImage[] }>;
}

export async function submitPrompt(url: string, workflow: Workflow): Promise<string> {
  const res = await fetch(`${url}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!res.ok) {
    throw new Error(`ComfyUI /prompt failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { prompt_id: string };
  return data.prompt_id;
}

export async function waitForImages(
  url: string,
  promptId: string,
  timeoutMs = 30 * 60_000,
  pollMs = 3000,
): Promise<OutputImage[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ComfyUI job ${promptId}`);
    await new Promise((r) => setTimeout(r, pollMs));
    const res = await fetch(`${url}/history/${promptId}`);
    if (!res.ok) continue;
    const hist = (await res.json()) as Record<string, HistoryEntry>;
    const entry = hist[promptId];
    if (!entry) continue;
    if (entry.status?.status_str === 'error') {
      throw new Error(`ComfyUI job ${promptId} errored — check the ComfyUI console`);
    }
    const images = Object.values(entry.outputs ?? {})
      .flatMap((o) => o.images ?? [])
      .filter((i) => i.type === 'output');
    if (images.length > 0 || entry.status?.completed) return images;
  }
}

export async function downloadImage(url: string, img: OutputImage): Promise<Buffer> {
  const q = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder,
    type: img.type,
  });
  const res = await fetch(`${url}/view?${q}`);
  if (!res.ok) throw new Error(`ComfyUI /view failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
