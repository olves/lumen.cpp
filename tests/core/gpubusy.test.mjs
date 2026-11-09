// Which other programs keep the GPU busy (v1.0.9): parsing Windows "GPU Engine" counters, skipping Lumen's own processes,
// the threshold and the throttle. The PowerShell runner is replaced by canned output.
//   node --test tests/core/gpubusy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseSamples, createGpuBusy } = require('../../app/gpubusy.cjs');

// What the PowerShell script prints: counter samples plus the process names and descriptions it found.
const sample = {
  samples: [
    { i: 'pid_25900_luid_0x00000000_0x0001D3B0_phys_0_eng_0_engtype_3D', v: 91.7 },
    { i: 'pid_25900_luid_0x00000000_0x0001D3B0_phys_0_eng_1_engtype_3D', v: 0.6 },
    { i: 'pid_25900_luid_0x00000000_0x0001D3B0_phys_0_eng_5_engtype_VideoDecode', v: 12 },
    { i: 'pid_38748_luid_0x00000000_0x0001D3B0_phys_0_eng_8_engtype_Compute_0', v: 98 },
    { i: 'pid_15736_luid_0x00000000_0x0001D3B0_phys_0_eng_0_engtype_3D', v: 6.2 },
    { i: 'pid_8024_luid_0x00000000_0x0001D3B0_phys_0_eng_0_engtype_3D', v: 35.5 },
    { i: 'garbage', v: 50 },
  ],
  procs: [
    { pid: 25900, name: 'wallpaper64', title: 'Wallpaper Engine' },
    { pid: 38748, name: 'llama-server', title: '' },
    { pid: 15736, name: 'dwm', title: 'Desktop Window Manager' },
    { pid: 8024, name: 'chrome', title: 'Google Chrome' },
  ],
};

test('per process: the busiest engine type, instances of one type added up', () => {
  const load = parseSamples(sample);
  assert.equal(load.get(25900), 92.3);
  assert.equal(load.get(38748), 98);
  assert.equal(load.get(8024), 35.5);
  assert.equal(load.has(NaN), false, 'unparseable instances are ignored');
});

test('busy programs: Lumen\'s own engine and the compositor are skipped; sorted, named, above the threshold', async () => {
  const gpu = createGpuBusy({ run: async () => sample, platform: 'win32', minPercent: 30 });
  const r = await gpu.check();
  assert.deepEqual(r.busy, [
    { name: 'wallpaper64', title: 'Wallpaper Engine', percent: 92 },
    { name: 'chrome', title: 'Google Chrome', percent: 36 },
  ]);
});

test('results are reused for two minutes, then read again', async () => {
  let runs = 0, now = 1000;
  const gpu = createGpuBusy({ run: async () => { runs++; return sample; }, platform: 'win32', now: () => now });
  await gpu.check(); await gpu.check();
  assert.equal(runs, 1);
  now += 121000; await gpu.check();
  assert.equal(runs, 2);
});

test('a failing or slow read is quiet: no busy programs, and it is not retried at once', async () => {
  let runs = 0;
  const gpu = createGpuBusy({ run: async () => { runs++; throw Error('Get-Counter failed'); }, platform: 'win32' });
  assert.deepEqual((await gpu.check()).busy, []);
  await gpu.check();
  assert.equal(runs, 1);
});

test('not Windows: nothing is run', async () => {
  let runs = 0;
  const gpu = createGpuBusy({ run: async () => { runs++; return sample; }, platform: 'linux' });
  assert.deepEqual((await gpu.check()).busy, []);
  assert.equal(runs, 0);
});

test('a canned answer replaces the counters (test mode)', async () => {
  const gpu = createGpuBusy({ run: async () => { throw Error('not used'); }, platform: 'win32', canned: [{ name: 'game', title: 'Some Game', percent: 80 }] });
  assert.deepEqual((await gpu.check()).busy, [{ name: 'game', title: 'Some Game', percent: 80 }]);
});
