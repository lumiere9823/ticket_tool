import http from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 4569;
const DEBUG_PORT = 9444;
const HOST = '127.0.0.1';
const EXTENSION_PATH = path.resolve('dist');
const PROFILE_DIR = path.resolve('scratch/test-chrome-perf-profile');

function findChromePath(): string {
  const candidates = [
    process.env['CHROME_BIN'],
    process.env['CHROMIUM_PATH'],
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  throw new Error(`Chrome / Chromium binary not found. Checked: ${candidates.join(', ')}`);
}

function startServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        `<!DOCTYPE html><html><head><title>Ticketbox - Rock Fest 2026</title></head><body><h1>Event Page</h1></body></html>`
      );
    });

    server.listen(PORT, HOST, () => {
      console.info(
        `[TEST SERVER] Mock Ticketbox page running at http://${HOST}:${PORT}/event/rock-fest`
      );
      resolve(server);
    });
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (p <= 0) return sorted[0]!;
  if (p >= 100) return sorted[sorted.length - 1]!;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function calculateStats(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  return {
    iterations: sorted.length,
    min: Number(sorted[0]!.toFixed(3)),
    p50: Number(percentile(sorted, 50).toFixed(3)),
    p75: Number(percentile(sorted, 75).toFixed(3)),
    p90: Number(percentile(sorted, 90).toFixed(3)),
    p95: Number(percentile(sorted, 95).toFixed(3)),
    p99: Number(percentile(sorted, 99).toFixed(3)),
    max: Number(sorted[sorted.length - 1]!.toFixed(3)),
    mean: Number(mean.toFixed(3)),
  };
}

async function queryCdpTargets(): Promise<
  { id: string; webSocketDebuggerUrl: string; url: string; type: string }[]
> {
  const res = await fetch(`http://${HOST}:${DEBUG_PORT}/json`);
  return res.json();
}

async function evaluateInCdp(wsUrl: string, expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        })
      );
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id === 1) {
          ws.close();
          if (msg.result?.exceptionDetails) {
            reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
          } else {
            resolve(msg.result?.result?.value);
          }
        }
      } catch (e) {
        reject(e);
      }
    };
    ws.onerror = reject;
  });
}

async function main() {
  console.info('=== Ticketbox Real Chromium Runtime Performance Benchmark ===');
  const chromePath = findChromePath();
  console.info(`Found browser binary: ${chromePath}`);

  if (fs.existsSync(PROFILE_DIR)) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const server = await startServer();
  let chromeProc: ChildProcess | null = null;

  try {
    const testUrl = `http://ticketbox.vn:${PORT}/event/rock-fest`;
    const args = [
      `--load-extension=${EXTENSION_PATH}`,
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      `--host-resolver-rules=MAP ticketbox.vn ${HOST}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--headless=new',
      testUrl,
    ];

    chromeProc = spawn(chromePath, args, { stdio: 'ignore' });

    let targets: {
      id: string;
      webSocketDebuggerUrl: string;
      url: string;
      type: string;
      title: string;
    }[] = [];
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        targets = (await queryCdpTargets()) as typeof targets;
        if (targets.length >= 3) break;
      } catch {
        // waiting for targets
      }
    }

    console.info(`[CDP] Connected! Found ${targets.length} targets:`);
    for (const t of targets) {
      console.info(`  - [${t.type}] title: "${t.title}" | url: ${t.url}`);
    }

    const swTarget = targets.find((t) => t.type === 'service_worker');
    if (!swTarget) {
      throw new Error(`Extension service worker target not found in CDP targets`);
    }
    const extMatch = swTarget.url.match(/chrome-extension:\/\/([a-z]+)\//);
    if (!extMatch) {
      throw new Error(`Could not parse extension ID from SW url: ${swTarget.url}`);
    }
    const extId = extMatch[1];
    const popupUrl = `chrome-extension://${extId}/src/extension/popup/popup.html`;
    console.info(`[CDP] Extension ID: ${extId}, loading popup page: ${popupUrl}`);

    // Create a new tab for popup.html via CDP HTTP endpoint
    const newTabRes = await fetch(
      `http://${HOST}:${DEBUG_PORT}/json/new?${encodeURIComponent(popupUrl)}`,
      { method: 'PUT' }
    );
    const popupTarget = (await newTabRes.json()) as {
      id: string;
      webSocketDebuggerUrl: string;
      url: string;
      type: string;
    };
    console.info(`[CDP] Popup Page Target created: ${popupTarget.webSocketDebuggerUrl}`);

    // Wait for popup page to load
    await new Promise((r) => setTimeout(r, 1000));

    async function evaluateInContext(expression: string): Promise<unknown> {
      return evaluateInCdp(popupTarget.webSocketDebuggerUrl, expression);
    }
    const storageBenchmarkCode = `
      (async () => {
        const results = {
          coldGet: 0,
          coldSet: 0,
          warmGetSingle: [],
          warmSetSingle: [],
          multiKeyGet: [],
          realisticStateSet: [],
          realisticStateGet: [],
        };

        const testKey = 'perf_test_key';
        const testVal = 'perf_test_val_' + Date.now();

        // Cold Set
        const t0 = performance.now();
        await new Promise(r => chrome.storage.local.set({ [testKey]: testVal }, r));
        results.coldSet = performance.now() - t0;

        // Cold Get
        const t1 = performance.now();
        await new Promise(r => chrome.storage.local.get(testKey, r));
        results.coldGet = performance.now() - t1;

        // Warm Single Key Get (50 iterations)
        for (let i = 0; i < 50; i++) {
          const t = performance.now();
          await new Promise(r => chrome.storage.local.get(testKey, r));
          results.warmGetSingle.push(performance.now() - t);
        }

        // Warm Single Key Set (50 iterations)
        for (let i = 0; i < 50; i++) {
          const t = performance.now();
          await new Promise(r => chrome.storage.local.set({ [testKey]: 'val_' + i }, r));
          results.warmSetSingle.push(performance.now() - t);
        }

        // Multi-Key Get (4 keys, 50 iterations)
        await new Promise(r => chrome.storage.local.set({ k1: 'v1', k2: 'v2', k3: 'v3', k4: 'v4' }, r));
        for (let i = 0; i < 50; i++) {
          const t = performance.now();
          await new Promise(r => chrome.storage.local.get(['k1', 'k2', 'k3', 'k4'], r));
          results.multiKeyGet.push(performance.now() - t);
        }

        // Realistic State Payload (~15KB) Set & Get (30 iterations)
        const realisticPayload = {
          journeyState: {
            currentState: 'MONITORING',
            attemptId: 'perf_real_123',
            items: Array.from({ length: 50 }, (_, i) => ({ id: 'item_' + i, name: 'VIP ' + i, price: 1000000 + i * 50000 })),
          }
        };

        for (let i = 0; i < 30; i++) {
          const tSet = performance.now();
          await new Promise(r => chrome.storage.local.set(realisticPayload, r));
          results.realisticStateSet.push(performance.now() - tSet);

          const tGet = performance.now();
          await new Promise(r => chrome.storage.local.get('journeyState', r));
          results.realisticStateGet.push(performance.now() - tGet);
        }

        return results;
      })()
    `;

    const storageRaw = (await evaluateInContext(storageBenchmarkCode)) as {
      coldGet: number;
      coldSet: number;
      warmGetSingle: number[];
      warmSetSingle: number[];
      multiKeyGet: number[];
      realisticStateSet: number[];
      realisticStateGet: number[];
    };

    console.info('Storage Cold Set Latency (ms):', storageRaw.coldSet.toFixed(3));
    console.info('Storage Cold Get Latency (ms):', storageRaw.coldGet.toFixed(3));
    console.info('Storage Warm Single Get Stats (ms):', calculateStats(storageRaw.warmGetSingle));
    console.info('Storage Warm Single Set Stats (ms):', calculateStats(storageRaw.warmSetSingle));
    console.info('Storage Multi-Key Get Stats (ms):', calculateStats(storageRaw.multiKeyGet));
    console.info(
      'Storage Realistic State Set Stats (ms):',
      calculateStats(storageRaw.realisticStateSet)
    );
    console.info(
      'Storage Realistic State Get Stats (ms):',
      calculateStats(storageRaw.realisticStateGet)
    );

    // ── 2. Real Chrome Runtime IPC Benchmark (chrome.runtime.sendMessage) ──
    console.info('\n--- Measuring Real chrome.runtime.sendMessage IPC Performance ---');
    const ipcBenchmarkCode = `
      (async () => {
        const results = {
          smallPayload: [],
          mediumPayload: [],
          largePayload: [],
        };

        const smallMsg = { type: 'HEARTBEAT_PING', timestamp: new Date().toISOString() };
        const medMsg = {
          type: 'STATE_CHANGED',
          timestamp: new Date().toISOString(),
          attemptId: 'ipc_test_1',
          state: 'MONITORING',
          context: { currentState: 'MONITORING', retryCount: 0, updatedAt: new Date().toISOString() }
        };
        const largeMsg = {
          type: 'JOURNEY_UPDATE',
          timestamp: new Date().toISOString(),
          catalogSnapshot: {
            eventId: '26416',
            tickets: Array.from({ length: 60 }, (_, i) => ({ id: 't_' + i, name: 'Ticket Tier ' + i, price: 1000000 })),
          }
        };

        // Small Payload (50 iterations)
        for (let i = 0; i < 50; i++) {
          const t = performance.now();
          await new Promise(r => {
            chrome.runtime.sendMessage(smallMsg, () => {
              chrome.runtime.lastError;
              r();
            });
          });
          results.smallPayload.push(performance.now() - t);
        }

        // Medium Payload (50 iterations)
        for (let i = 0; i < 50; i++) {
          const t = performance.now();
          await new Promise(r => {
            chrome.runtime.sendMessage(medMsg, () => {
              chrome.runtime.lastError;
              r();
            });
          });
          results.mediumPayload.push(performance.now() - t);
        }

        // Large Payload (30 iterations)
        for (let i = 0; i < 30; i++) {
          const t = performance.now();
          await new Promise(r => {
            chrome.runtime.sendMessage(largeMsg, () => {
              chrome.runtime.lastError;
              r();
            });
          });
          results.largePayload.push(performance.now() - t);
        }

        return results;
      })()
    `;

    const ipcRaw = (await evaluateInContext(ipcBenchmarkCode)) as {
      smallPayload: number[];
      mediumPayload: number[];
      largePayload: number[];
    };

    console.info('IPC Small Payload (~100B) Stats (ms):', calculateStats(ipcRaw.smallPayload));
    console.info('IPC Medium Payload (~2KB) Stats (ms):', calculateStats(ipcRaw.mediumPayload));
    console.info('IPC Large Payload (~50KB) Stats (ms):', calculateStats(ipcRaw.largePayload));

    console.info('\n=== Chromium Real Runtime Performance Benchmark Completed Successfully ===');
  } finally {
    if (chromeProc) {
      try {
        chromeProc.kill();
      } catch {
        // process already terminated
      }
    }
    server.close();
  }
}

main().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
