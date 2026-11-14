// The STT probe's page (Phase 33, Task 5). No bundler: Tauri's global API (withGlobalTauri).
/* global window, document, navigator, performance, setInterval, clearInterval */
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const results = [];
const $ = (id) => document.getElementById(id);

function log(entry) {
  results.push({ at: new Date().toISOString(), ...entry });
  $('log').textContent = JSON.stringify(results, null, 2);
}

// Peak memory of this process and its WebView2 processes while `work` runs, sampled every 250 ms.
async function withMemory(work) {
  const peak = { probe: 0, children: 0 };
  const sample = async () => {
    const m = await invoke('memory');
    peak.probe = Math.max(peak.probe, m.probe?.workingSetBytes ?? 0);
    peak.children = Math.max(peak.children, m.children?.workingSetBytes ?? 0);
  };
  await sample();
  const before = { ...peak };
  const timer = setInterval(sample, 250);
  try {
    const result = await work();
    return { ...result, memoryBefore: before, memoryPeak: peak };
  } finally {
    clearInterval(timer);
  }
}

async function upload(file, chunkMB, keep = false) {
  const id = await invoke('upload_begin', { name: file.name, size: file.size });
  const step = chunkMB * 1024 * 1024;
  const started = performance.now();
  for (let off = 0; off < file.size; off += step) {
    const buf = new Uint8Array(await file.slice(off, off + step).arrayBuffer());
    await invoke('upload_chunk', buf, { headers: { 'x-upload-id': id } });
  }
  const done = await invoke('upload_finish', { id, keep });
  const seconds = (performance.now() - started) / 1000;
  return { chunkMB, seconds, mbPerSec: file.size / 1e6 / seconds, ...done };
}

$('upload').addEventListener('click', async () => {
  const file = $('file').files[0];
  if (!file) return;
  for (const mb of [1, 4, 16]) {
    $('upload-status').textContent = `${mb} MB chunks …`;
    const r = await withMemory(() => upload(file, mb));
    log({ test: 'upload', file: file.name, bytes: file.size, ...r });
  }
  $('upload-status').textContent = 'Done.';
});

$('dialog').addEventListener('click', async () => {
  const r = await invoke('open_dialog');
  log({ test: 'open-dialog', ...r });
  $('path-status').textContent = r.path ?? 'Cancelled.';
});

listen('tauri://drag-drop', async (event) => {
  for (const path of event.payload.paths ?? []) {
    const info = await invoke('path_info', { path });
    log({ test: 'drag-drop', ...info });
    $('path-status').textContent = path;
  }
});

$('leftovers').addEventListener('click', async () =>
  log({ test: 'leftovers', ...(await invoke('temp_leftovers')) }),
);
$('clean').addEventListener('click', async () =>
  log({ test: 'clean', ...(await invoke('clean_temp')) }),
);
$('crash').addEventListener('click', async () => {
  const file = $('file').files[0];
  if (!file) return;
  const id = await invoke('upload_begin', { name: file.name, size: file.size });
  const buf = new Uint8Array(
    await file.slice(0, Math.min(file.size, 64 * 1024 * 1024)).arrayBuffer(),
  );
  await invoke('upload_chunk', buf, { headers: { 'x-upload-id': id } });
  await invoke('crash_now');
});
$('copy').addEventListener('click', () =>
  navigator.clipboard.writeText(JSON.stringify(results, null, 2)),
);

invoke('environment').then((env) => log({ test: 'environment', ...env }));
invoke('temp_leftovers').then((r) => log({ test: 'leftovers-at-start', ...r }));
