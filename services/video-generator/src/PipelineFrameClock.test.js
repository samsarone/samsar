import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const services = ['samsar_processor', 'samsar_express_video_listener', 'samsar_ai_video_layer_generator', 'samsar_frames_processor', 'samsar_video_generator'];
const availableServices = services.filter(service => fs.existsSync(new URL(`../../${service}/src/utils/FrameClock.js`, import.meta.url)));
const clocks = await Promise.all(availableServices.map(service => import(`../../${service}/src/utils/FrameClock.js`)));
for (const rate of [16, 24, 30]) test(`all workers use the same ${rate} fps end boundary for fractional-rate input`, t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-eof-'));
 t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
 const input = path.join(dir, 'input.mp4');
 const run = args => execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v','error','-y',...args]);
 run(['-f','lavfi','-i','testsrc2=s=32x32:r=24000/1001','-frames:v','48','-c:v','libx264',input]);
 clocks.forEach((clock, i) => {
   const filter = clock.buildFrameExtractionFilter(rate, 'scale=32:32');
   const raw = run(['-i',input,'-vf',filter,'-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','-']);
   assert.equal(raw.length / (32*32*3), Math.round(2.002*rate), availableServices[i]);
 });
});
