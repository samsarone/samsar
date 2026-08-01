import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConfiguration,
  validateAdapter,
} from "./configure-samsar-custom-image-model.mjs";

const adapter = {
  name: "FLUX.2 Klein 4B (Vast.ai)",
  generate_url: "https://flux.example/generate",
  status_url: "https://flux.example/generate/{request_id}/status",
  result_url: "https://flux.example/generate/{request_id}/result",
  header_key: "Authorization",
  header_value: "Bearer private-token",
};

test("validates the provisioner adapter contract", () => {
  assert.equal(validateAdapter(adapter), adapter);
  assert.throws(
    () => validateAdapter({ ...adapter, status_url: "https://flux.example/status" }),
    /request_id/,
  );
});

test("upserts a stable adapter, preserves other endpoints, and sets the Agent default", () => {
  const current = {
    base_url: "https://legacy.example",
    custom_endpoints: [
      {
        id: "music-model",
        name: "Music",
        operation: "text_to_music",
        base_url: "https://music.example",
        endpoint: "generate",
        api_key: "enc:v1:existing",
      },
      {
        id: "old-vast-instance-id",
        model_key: "CUSTOM_TEXT_TO_IMAGE:old-vast-instance-id",
        name: adapter.name,
        operation: "text_to_image",
        generate_url: "https://old.example/generate",
        header_value: "enc:v1:old",
      },
    ],
  };

  const configured = buildConfiguration(current, adapter, "vast_flux2_klein_4b", true);
  assert.equal(configured.modelKey, "CUSTOM_TEXT_TO_IMAGE:vast_flux2_klein_4b");
  assert.equal(configured.payload.agentImageModel, configured.modelKey);
  assert.equal(configured.payload.agentImageModelAuthorization, "native");
  assert.equal(configured.payload.custom_adapters.base_url, "https://legacy.example");
  assert.equal(configured.payload.custom_adapters.custom_endpoints.length, 2);
  assert.equal(configured.payload.custom_adapters.custom_endpoints[0].id, "music-model");
  assert.deepEqual(configured.payload.custom_adapters.custom_endpoints[1], {
    id: "vast_flux2_klein_4b",
    model_key: "CUSTOM_TEXT_TO_IMAGE:vast_flux2_klein_4b",
    name: adapter.name,
    provider: "custom",
    operation: "text_to_image",
    generate_url: adapter.generate_url,
    status_url: adapter.status_url,
    result_url: adapter.result_url,
    header_key: adapter.header_key,
    header_value: adapter.header_value,
  });
});

test("can save the model without changing the Agent default", () => {
  const configured = buildConfiguration(null, adapter, "vast_flux2_klein_4b", false);
  assert.equal(Object.hasOwn(configured.payload, "agentImageModel"), false);
});
