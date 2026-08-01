import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCustomTextToImageModelKey,
  getCustomTextToImageModelDefinitions,
  inferCustomTextToImageUrls,
  normalizeCustomTextToImageAdapters,
  validateCustomTextToImageAdapter,
} from "./customTextToImageAdapters.mjs";

test("infers status and result URL templates from a validated generate URL", () => {
  assert.deepEqual(
    inferCustomTextToImageUrls("https://flux.example/v1/images/generations/"),
    {
      generateUrl: "https://flux.example/v1/images/generations",
      statusUrl: "https://flux.example/v1/images/generations/{request_id}/status",
      resultUrl: "https://flux.example/v1/images/generations/{request_id}/result",
    },
  );
});

test("normalizes saved adapters into stable custom model definitions", () => {
  const adapters = {
    custom_endpoints: [{
      id: "flux-klein",
      name: "Flux 2 Klein",
      operation: "text_to_image",
      generate_url: "https://flux.example/v1/images/generations",
      status_url: "https://flux.example/v1/images/generations/{request_id}/status",
      result_url: "https://flux.example/v1/images/generations/{request_id}/result",
      header_key: "Authorization",
      has_header_value: true,
    }],
  };

  assert.equal(normalizeCustomTextToImageAdapters(adapters)[0].has_header_value, true);
  assert.deepEqual(getCustomTextToImageModelDefinitions(adapters)[0], {
    key: buildCustomTextToImageModelKey("flux-klein"),
    value: buildCustomTextToImageModelKey("flux-klein"),
    name: "Flux 2 Klein",
    label: "Flux 2 Klein",
    isExpressModel: true,
    isCustomTextToImageModel: true,
    customAdapterId: "flux-klein",
    supportedAspectRatios: ["1:1", "16:9", "9:16"],
  });
});

test("validates request-id URL templates and authentication header names", () => {
  const valid = {
    name: "Flux 2 Klein",
    generate_url: "https://flux.example/v1/images/generations",
    status_url: "https://flux.example/v1/images/generations/{request_id}/status",
    result_url: "https://flux.example/v1/images/generations/{request_id}/result",
    header_key: "Authorization",
    header_value: "Bearer secret",
  };

  assert.equal(validateCustomTextToImageAdapter(valid), "");
  assert.match(
    validateCustomTextToImageAdapter({ ...valid, result_url: "https://flux.example/result" }),
    /must include \{request_id\}/,
  );
  assert.match(
    validateCustomTextToImageAdapter({ ...valid, header_key: "Bad Header" }),
    /invalid authentication header key/,
  );
});
