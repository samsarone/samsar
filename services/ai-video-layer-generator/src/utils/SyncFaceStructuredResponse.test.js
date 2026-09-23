import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { createExpressLipSyncPrompt, SPEAKER_FACE_RESPONSE_FORMAT } from './ExpressLipSyncPrompt.js';

test('face inference sends image and strict schema through Responses API and validates output', async (t) => {
  const previous = {CURRENT_ENV:process.env.CURRENT_ENV,OPENAI_API_KEY:process.env.OPENAI_API_KEY};
  t.after(() => { for (const [key,value] of Object.entries(previous)) { if(value === undefined) delete process.env[key]; else process.env[key]=value; } });
  process.env.CURRENT_ENV='production';
  process.env.OPENAI_API_KEY='test-key';
  let body;
  let output = '{"status":"identified","face_box":[10,20,40,60]}';
  t.mock.method(OpenAI.prototype,'post',async (url,options) => {
    assert.equal(url,'/responses'); body=options.body;
    return {model:'gpt-6-astra',output_text:output};
  });
  const args={userInferenceModel:'gpt-6-astra',auditContext:{selectedInferenceModelAuthorization:'native'},speechItem:{characterName:'Maya'},frame:{width:100,height:80,dataUrl:'data:image/png;base64,example'}};
  assert.deepEqual(await createExpressLipSyncPrompt(args),{status:'identified',face_box:[10,20,40,60]});
  assert.deepEqual(body.text.format,{type:'json_schema',...SPEAKER_FACE_RESPONSE_FORMAT.json_schema});
  assert.ok(body.input.some(message => Array.isArray(message.content) && message.content.some(part => part.type==='input_image' && part.image_url===args.frame.dataUrl)));
  output = '{"status":"identified","face_box":[10,20,400,600]}';
  assert.equal(await createExpressLipSyncPrompt(args),null);
});
