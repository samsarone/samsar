#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const CUSTOM_MODEL_PREFIX = "CUSTOM_TEXT_TO_IMAGE:";
const VALID_ADAPTER_ID = /^[A-Za-z0-9._-]+$/;
const LEGACY_CUSTOM_ADAPTER_KEYS = [
  "api_key",
  "base_url",
  "text_to_video",
  "text_to_video_authorization",
  "image_to_video",
  "image_to_video_authorization",
  "text_to_image",
  "text_to_image_authorization",
  "text_to_speech",
  "text_to_speech_authorization",
  "text_to_music",
  "text_to_music_authorization",
  "text_to_sound_effect",
  "text_to_sound_effect_authorization",
];

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw new Error("Adapter JSON must contain an object.");
  }
  const required = ["name", "generate_url", "status_url", "result_url", "header_key", "header_value"];
  for (const key of required) {
    if (!normalizeString(adapter[key])) {
      throw new Error(`Adapter JSON is missing ${key}.`);
    }
  }
  if (!normalizeString(adapter.status_url).includes("{request_id}")) {
    throw new Error("Adapter status_url must include {request_id}.");
  }
  if (!normalizeString(adapter.result_url).includes("{request_id}")) {
    throw new Error("Adapter result_url must include {request_id}.");
  }
  for (const key of ["generate_url", "status_url", "result_url"]) {
    const candidate = normalizeString(adapter[key]).replaceAll("{request_id}", "request-id");
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Adapter ${key} must use HTTP or HTTPS.`);
    }
  }
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(normalizeString(adapter.header_key))) {
    throw new Error("Adapter header_key is invalid.");
  }
  if (/\r|\n/.test(adapter.header_value)) {
    throw new Error("Adapter header_value is invalid.");
  }
  return adapter;
}

export function buildConfiguration(currentAdapters, adapter, adapterId, setAgentDefault = true) {
  validateAdapter(adapter);
  if (!VALID_ADAPTER_ID.test(adapterId)) {
    throw new Error("The stable adapter ID is invalid.");
  }

  const current = currentAdapters && typeof currentAdapters === "object" && !Array.isArray(currentAdapters)
    ? currentAdapters
    : {};
  const existingEndpoints = Array.isArray(current.custom_endpoints)
    ? current.custom_endpoints
    : [];
  const name = normalizeString(adapter.name);
  const modelKey = `${CUSTOM_MODEL_PREFIX}${adapterId}`;
  const retainedEndpoints = existingEndpoints.filter((endpoint) => {
    if (!endpoint || typeof endpoint !== "object") return false;
    const sameStableId = normalizeString(endpoint.id) === adapterId;
    const sameModelKey = normalizeString(endpoint.model_key) === modelKey;
    const sameNamedImageAdapter =
      normalizeString(endpoint.operation) === "text_to_image" &&
      normalizeString(endpoint.name).toLowerCase() === name.toLowerCase();
    return !sameStableId && !sameModelKey && !sameNamedImageAdapter;
  });

  const customAdapters = {};
  for (const key of LEGACY_CUSTOM_ADAPTER_KEYS) {
    if (typeof current[key] === "string" && current[key].trim()) {
      customAdapters[key] = current[key].trim();
    }
  }
  customAdapters.custom_endpoints = [
    ...retainedEndpoints,
    {
      id: adapterId,
      model_key: modelKey,
      name,
      provider: "custom",
      operation: "text_to_image",
      generate_url: normalizeString(adapter.generate_url),
      status_url: normalizeString(adapter.status_url),
      result_url: normalizeString(adapter.result_url),
      header_key: normalizeString(adapter.header_key),
      header_value: normalizeString(adapter.header_value),
    },
  ];

  return {
    modelKey,
    payload: {
      custom_adapters: customAdapters,
      ...(setAgentDefault
        ? {
            agentImageModel: modelKey,
            agentImageModelAuthorization: "native",
          }
        : {}),
    },
  };
}

function parseArguments(argv) {
  const adapterPath = argv[0];
  let userEmail = "";
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--user-email") {
      userEmail = normalizeString(argv[index + 1]).toLowerCase();
      index += 1;
      continue;
    }
    throw new Error(`Unknown helper option: ${argv[index]}`);
  }
  if (!adapterPath) {
    throw new Error("Adapter JSON path is required.");
  }
  return { adapterPath, userEmail };
}

async function resolveTargetUser(User, userEmail) {
  if (userEmail) {
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      throw new Error(`No Samsar user was found for ${userEmail}.`);
    }
    return user;
  }

  const eligibleFilter = { isTempUser: { $ne: true }, isBotUser: { $ne: true } };
  const admins = await User.find({ ...eligibleFilter, isAdminUser: true }).limit(2);
  if (admins.length === 1) {
    return admins[0];
  }
  if (admins.length > 1) {
    throw new Error("Multiple standalone administrators exist; rerun with --user-email.");
  }

  const users = await User.find(eligibleFilter).limit(2);
  if (users.length === 1) {
    return users[0];
  }
  if (users.length === 0) {
    throw new Error("No eligible Samsar user exists. Complete standalone setup first.");
  }
  throw new Error("Multiple Samsar users exist; rerun with --user-email.");
}

async function configure() {
  const { adapterPath, userEmail } = parseArguments(process.argv.slice(2));
  const adapterId = normalizeString(process.env.SAMSAR_CUSTOM_IMAGE_ADAPTER_ID) || "vast_flux2_klein_4b";
  const setAgentDefault = process.env.SAMSAR_SET_AGENT_IMAGE_DEFAULT !== "0";
  const appRoot = process.env.SAMSAR_PROCESSOR_APP_ROOT || "/app";
  const adapter = validateAdapter(JSON.parse(await fs.readFile(adapterPath, "utf8")));

  const dbModule = await import(pathToFileURL(path.join(appRoot, "src/models/DBString.js")).href);
  const userModule = await import(pathToFileURL(path.join(appRoot, "src/models/User.js")).href);
  const schemaModule = await import(pathToFileURL(path.join(appRoot, "src/schema/User.js")).href);
  const mongoose = await dbModule.getDBConnectionString();

  try {
    const user = await resolveTargetUser(schemaModule.default, userEmail);
    const currentAdapters = user.custom_adapters
      ? JSON.parse(JSON.stringify(user.custom_adapters))
      : null;
    const { modelKey, payload } = buildConfiguration(
      currentAdapters,
      adapter,
      adapterId,
      setAgentDefault,
    );
    const updated = await userModule.updateUserDetails(user._id, payload);
    const storedEndpoint = updated.custom_adapters?.custom_endpoints?.find(
      (endpoint) => endpoint?.id === adapterId,
    );
    if (!storedEndpoint || !normalizeString(storedEndpoint.header_value).startsWith("enc:v1:")) {
      throw new Error("The adapter was not stored with an encrypted credential.");
    }
    if (setAgentDefault && updated.agentImageModel !== modelKey) {
      throw new Error("The Agent image-model default was not updated.");
    }

    process.stdout.write(`${JSON.stringify({
      status: "configured",
      user_id: String(updated._id),
      user_email: updated.email || null,
      adapter_name: adapter.name,
      model_key: modelKey,
      available_in_studio: true,
      available_in_vidgenie: true,
      agent_default: setAgentDefault,
    }, null, 2)}\n`);
  } finally {
    await mongoose.disconnect();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  configure().catch((error) => {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
  });
}
