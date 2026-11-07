#!/usr/bin/env node

// One-off, manifest-driven recovery for an express session whose image provider
// succeeded but the first vision description failed. Dry-run is the default.
// Apply deliberately uses Image.js's normal vision/scoring/refilter path.

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { EJSON } from 'bson';
import { getDBConnectionString } from '../../src/DBString.js';
import ImageGeneration from '../../src/schema/ImageGeneration.js';
import VideoSession from '../../src/schema/VideoSession.js';
import GlobalSession from '../../src/schema/GlobalSession.js';
import GeneratedImage from '../../src/schema/generations/GeneratedImage.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;
const IMAGE_NAME = /^generation_\d+_[a-z\d]+\.png$/i;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

export function parseArgs(argv) {
  const [sessionId, ...flags] = argv;
  const options = { sessionId, apply: false };
  for (const flag of flags) {
    if (flag === '--apply') options.apply = true;
    else if (flag.startsWith('--manifest=')) options.manifestPath = flag.slice(11);
    else if (flag.startsWith('--plan-sha=')) options.planSha = flag.slice(11);
    else if (flag.startsWith('--backup-dir=')) options.backupDir = flag.slice(13);
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!OBJECT_ID.test(sessionId || '')) throw new Error('A MongoDB session ID is required.');
  if (!options.manifestPath) throw new Error('--manifest=<reviewed JSON file> is required.');
  if (options.apply && (!options.planSha || !options.backupDir)) {
    throw new Error('--apply requires both --plan-sha=<dry-run hash> and --backup-dir=<durable directory>.');
  }
  if (options.apply && !path.resolve(options.backupDir).startsWith('/persistent/')) {
    throw new Error('Recovery backup directory must be under the durable /persistent volume.');
  }
  return options;
}

function sourcePrompt(layer) {
  return layer.originalImageGenerationPrompt || layer.originalImagePrompt ||
    layer.sourcePrompt || layer.originalPrompt || layer.prompt;
}

export function assertManifestLayerMapping(manifest, session) {
  if (manifest.layers.length !== session.layers?.length) {
    throw new Error('Manifest must account for every original session layer.');
  }
  const seenLayers = new Set();
  const seenFiles = new Set();
  const seenRequests = new Set();
  for (const [position, entry] of manifest.layers.entries()) {
    const layer = session.layers?.[entry.index];
    const layerId = layer?._id?.toString();
    if (!Number.isInteger(entry.index) || entry.index !== position ||
        layerId !== entry.layerId || seenLayers.has(layerId)) {
      throw new Error(`Manifest layer index/ID mismatch: ${entry.index} / ${entry.layerId}`);
    }
    seenLayers.add(layerId);
    if (layer.imageSession?.generationStatus !== 'COMPLETED' && !sourcePrompt(layer)) {
      throw new Error(`Original image prompt is missing for layer ${entry.index}.`);
    }
    if (entry.savedImage) {
      if (!IMAGE_NAME.test(entry.savedImage) || !OBJECT_ID.test(entry.requestId || '') ||
          seenRequests.has(entry.requestId) || seenFiles.has(entry.savedImage)) {
        throw new Error(`Saved-image request mapping is missing or duplicated at layer ${entry.index}.`);
      }
      seenRequests.add(entry.requestId);
      seenFiles.add(entry.savedImage);
    } else if (entry.savedImage !== null || entry.requestId) {
      throw new Error(`Layer ${entry.index} needs either an explicit saved image and request ID, or null.`);
    }
  }
}

function savedReference(sessionId, fileName) {
  return `/assets_v2/generations/${sessionId}/${fileName}`;
}

async function inspectSavedFile(sessionId, fileName) {
  if (!IMAGE_NAME.test(fileName || '')) throw new Error(`Invalid saved PNG filename: ${fileName}`);
  const assetsRoot = process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
  const sessionDir = await fs.realpath(path.join(assetsRoot, 'generations', sessionId));
  const filePath = await fs.realpath(path.join(sessionDir, fileName));
  if (path.dirname(filePath) !== sessionDir) throw new Error(`Saved PNG escaped session directory: ${fileName}`);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= PNG_SIGNATURE.length) throw new Error(`Saved PNG is empty: ${fileName}`);
  const file = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(PNG_SIGNATURE.length);
    await file.read(header, 0, header.length, 0);
    if (!header.equals(PNG_SIGNATURE)) throw new Error(`Saved file is not a PNG: ${fileName}`);
  } finally {
    await file.close();
  }
  return { reference: savedReference(sessionId, fileName), bytes: stat.size };
}

async function buildPlan(options) {
  if (process.env.SAMSAR_RUNTIME !== 'docker' || process.env.CURRENT_ENV !== 'standalone') {
    throw new Error('This recovery command is restricted to the local standalone Docker runtime.');
  }
  const manifest = JSON.parse(await fs.readFile(options.manifestPath, 'utf8'));
  if (manifest.sessionId !== options.sessionId || !manifest.recoveryId ||
      manifest.model !== 'GPTIMAGE2.5' || !manifest.expectedError ||
      !Array.isArray(manifest.layers)) {
    throw new Error('Manifest session, recovery ID, model, or layers are invalid.');
  }

  await getDBConnectionString();
  const session = await VideoSession.findById(options.sessionId).lean();
  if (!session || !session.isExpressGeneration || !session.isStepVideoGeneration ||
      session.expressGenerationCancelled || session.videoLink || session.remoteURL) {
    throw new Error('Session is missing, cancelled, rendered, or is not an express step video.');
  }
  if (session.visionRecovery?.recoveryId && session.visionRecovery.recoveryId !== manifest.recoveryId) {
    throw new Error('Another vision recovery is already recorded on this session.');
  }
  const firstAttempt = !session.visionRecovery?.recoveryId;
  if (firstAttempt && (!session.expressGenerationFailed ||
      session.expressGenerationStatus?.image_generation !== 'FAILED' ||
      !String(session.expressGenerationError || '').includes(manifest.expectedError))) {
    throw new Error('Session is not at the expected private-signer vision failure.');
  }
  if (!firstAttempt && !['PENDING', 'FAILED'].includes(session.expressGenerationStatus?.image_generation)) {
    throw new Error('Recovered session has already moved beyond the image stage.');
  }
  assertManifestLayerMapping(manifest, session);
  const rows = await ImageGeneration.find({ videoSessionId: options.sessionId }).lean();
  if (rows.some((row) => row.visionRecoveryId !== manifest.recoveryId)) {
    throw new Error('An unrelated image generation request exists for this session.');
  }
  const rowsByLayer = new Map(rows.map((row) => [row.layerId, row]));
  if (rowsByLayer.size !== rows.length) {
    throw new Error('Multiple active image requests exist for the same layer.');
  }
  const plannedLayers = [];
  for (const entry of manifest.layers) {
    const layer = session.layers?.[entry.index];
    const layerId = layer?._id?.toString();
    const existing = rowsByLayer.get(layerId);
    if (existing && (existing.visionRecoveryId !== manifest.recoveryId ||
        (entry.requestId && existing._id.toString() !== entry.requestId))) {
      throw new Error(`Unexpected active image request for layer ${entry.index}.`);
    }
    const finalImage = entry.requestId
      ? await GeneratedImage.findById(entry.requestId).select('_id').lean()
      : null;
    if (finalImage && layer.imageSession?.generationStatus !== 'COMPLETED') {
      throw new Error(`A final generated-image record conflicts with layer ${entry.index}.`);
    }
    const image = entry.savedImage
      ? await inspectSavedFile(options.sessionId, entry.savedImage)
      : null;
    plannedLayers.push({ entry, layer, existing, image, prompt: sourcePrompt(layer) });
  }

  const globalSession = await GlobalSession.findOne({ sessionId: options.sessionId }).lean();
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    manifest,
    sessionUpdatedAt: session.updatedAt?.toISOString(),
    imageStage: session.expressGenerationStatus?.image_generation,
    layerStates: session.layers.map((layer) => layer.imageSession?.generationStatus),
    requestIds: rows.map((row) => row._id.toString()).sort(),
  })).digest('hex');
  return { manifest, session, globalSession, rows, plannedLayers, digest };
}

function printPlan(plan) {
  console.log(`Session ${plan.manifest.sessionId}`);
  console.log(`Recovery ${plan.manifest.recoveryId}`);
  console.log(`Image stage ${plan.session.expressGenerationStatus?.image_generation}; ${plan.rows.length} active image request rows`);
  const step = plan.session.expressStepGeneration || {};
  console.log(`Step state ${step.status || '(none)'} at ${step.currentStep || step.current_step || '(none)'}`);
  console.log(`Manual pause stages: ${JSON.stringify(step.manualStepStages || step.manual_step_stages || [])}`);
  console.log(`Waiting for process_next: ${Boolean(step.waitingForProcessNext || step.waiting_for_process_next)}`);
  console.log(`Requires user action: ${Boolean(step.requiresUserAction || step.requires_user_action)}`);
  for (const { entry, layer, existing, image, prompt } of plan.plannedLayers) {
    console.log(`\nLayer ${entry.index} ${entry.layerId}: ${layer.imageSession?.generationStatus}`);
    console.log(`  Request: ${existing?._id || entry.requestId || '(create new request)'}`);
    console.log(`  Saved image: ${image ? `${image.reference} (${image.bytes} bytes)` : '(none; original image generation still required)'}`);
    console.log(`  Original prompt: ${prompt}`);
  }
  console.log(`\nPlan SHA-256: ${plan.digest}`);
}

async function writeBackup(plan, backupDir) {
  const resolvedDir = path.resolve(backupDir);
  await fs.mkdir(resolvedDir, { recursive: true, mode: 0o700 });
  const backupPath = path.join(resolvedDir,
    `${plan.manifest.sessionId}-${Date.now()}-${plan.digest.slice(0, 12)}.ejson`);
  const backup = {
    createdAt: new Date(),
    recoveryId: plan.manifest.recoveryId,
    manifest: plan.manifest,
    planSha: plan.digest,
    session: plan.session,
    globalSession: plan.globalSession,
    imageGenerationRequests: plan.rows,
  };
  const file = await fs.open(backupPath, 'wx', 0o600);
  try { await file.writeFile(EJSON.stringify(backup, null, 2)); }
  finally { await file.close(); }
  console.log(`Backup: ${backupPath}`);
}

function buildRequest(plan, item) {
  const { entry, prompt } = item;
  const session = plan.session;
  const initialPrompt = `${prompt} `;
  return {
    ...(entry.requestId ? { _id: new mongoose.Types.ObjectId(entry.requestId) } : {}),
    videoSessionId: plan.manifest.sessionId,
    layerId: entry.layerId,
    userId: session.userId?.toString(),
    prompt: initialPrompt,
    originalRetryPrompt: prompt,
    originalImageGenerationPrompt: prompt,
    originalImageGenerationPromptSource: item.layer.originalImageGenerationPromptSource || 'initial_generation',
    originalImagePrompt: prompt,
    sourcePrompt: prompt,
    originalPrompt: prompt,
    model: plan.manifest.model,
    inferenceModel: session.expressGenerationInferenceModel || session.inferenceModel,
    expressGenerationInferenceModel: session.expressGenerationInferenceModel || session.inferenceModel,
    customFallbackModel: session.customAdapterFallbacks?.text_to_image,
    isBaseGeneration: true,
    isBatchGeneration: true,
    aspectRatio: session.aspectRatio,
    contentFilterRating: 3,
    refilterImageGenerationsRequired: true,
    refilterImagePassNumber: 1,
    imageFilterScoreRequired: true,
    operationType: 'GENERATE',
    generationStatus: 'PENDING',
    apiGenerationStatus: entry.savedImage ? 'PENDING' : 'INIT',
    rowLocked: true,
    visionRecoveryId: plan.manifest.recoveryId,
    // The standard request TTL is one hour. This guarded recovery can span
    // slower inference calls, so keep its pending rows long enough to finish.
    expireAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}

async function applyPlan(plan, backupDir) {
  await writeBackup(plan, backupDir);
  const sessionId = plan.manifest.sessionId;
  for (const item of plan.plannedLayers) {
    if (item.layer.imageSession?.generationStatus === 'COMPLETED' || item.existing) continue;
    await new ImageGeneration(buildRequest(plan, item)).save();
  }

  const now = new Date();
  const setFields = {
    expressGenerationPending: true,
    expressGenerationPaused: false,
    expressGenerationFailed: false,
    expressGenerationError: null,
    'expressGenerationStatus.status': 'PENDING',
    'expressGenerationStatus.image_generation': 'PENDING',
    'expressStepGeneration.status': 'PENDING',
    'expressStepGeneration.error': null,
    'expressStepGeneration.currentStep': 'image_generation',
    'expressStepGeneration.current_step': 'image_generation',
    'expressStepGeneration.currentStepLabel': 'Images',
    'expressStepGeneration.current_step_label': 'Images',
    'expressStepGeneration.updatedAt': now,
    'expressStepGeneration.updated_at': now,
    'visionRecovery.recoveryId': plan.manifest.recoveryId,
    'visionRecovery.planSha': plan.digest,
    'visionRecovery.resumedAt': now,
    'visionRecovery.phase': 'SCORING_SAVED_IMAGES',
  };
  for (const { entry, layer, prompt } of plan.plannedLayers) {
    if (layer.imageSession?.generationStatus === 'COMPLETED') continue;
    setFields[`layers.${entry.index}.imageSession.generationStatus`] = 'PENDING';
    setFields[`layers.${entry.index}.imageSession.generationError`] = null;
    setFields[`layers.${entry.index}.prompt`] = prompt;
    setFields[`layers.${entry.index}.imageSession.prompt`] = prompt;
  }
  const result = await VideoSession.updateOne(
    { _id: plan.session._id, updatedAt: plan.session.updatedAt },
    { $set: setFields },
  );
  if (result.modifiedCount !== 1) {
    throw new Error('Session changed since the recovery plan was read; locked request rows were left for inspection.');
  }
  await GlobalSession.updateOne({ sessionId }, {
    $set: { status: 'PENDING', errorMessage: null },
  });

  const { resumeSavedImageAtVision } = await import('../../src/Image.js');
  for (const item of plan.plannedLayers.filter((candidate) => candidate.image)) {
    const latestSession = await VideoSession.findById(sessionId).lean();
    const latestLayer = latestSession.layers.find((layer) => layer._id.toString() === item.entry.layerId);
    if (!latestLayer) throw new Error(`Saved-image layer is no longer present: ${item.entry.layerId}`);
    if (latestLayer.imageSession?.generationStatus === 'COMPLETED') continue;
    const request = await ImageGeneration.findById(item.entry.requestId).lean();
    if (!request) throw new Error(`Saved-image request disappeared for layer ${item.entry.index}.`);
    if (request.rowLocked !== true) {
      console.log(`Layer ${item.entry.index}: request is already released to normal quality retry.`);
      continue;
    }
    console.log(`Layer ${item.entry.index}: resuming vision/scoring for ${item.image.reference}`);
    await resumeSavedImageAtVision(item.entry.requestId, item.image.reference, {
      recoveryId: plan.manifest.recoveryId,
      videoSessionId: sessionId,
      layerId: item.entry.layerId,
    });
    const after = await VideoSession.findById(sessionId).lean();
    const state = after.layers.find((layer) => layer._id.toString() === item.entry.layerId)?.imageSession?.generationStatus;
    const afterRequest = await ImageGeneration.findById(item.entry.requestId).lean();
    if (state !== 'COMPLETED' && !(afterRequest && afterRequest.rowLocked === false)) {
      throw new Error(`Layer ${item.entry.index} neither completed nor entered normal quality retry.`);
    }
    console.log(`Layer ${item.entry.index}: ${state === 'COMPLETED' ? 'COMPLETED' : 'quality retry queued'}`);
  }

  await ImageGeneration.updateMany({
    videoSessionId: sessionId,
    visionRecoveryId: plan.manifest.recoveryId,
    layerId: { $in: plan.plannedLayers.filter((item) => !item.image).map((item) => item.entry.layerId) },
    rowLocked: true,
  }, { $set: { rowLocked: false } });
  await VideoSession.updateOne({ _id: sessionId }, {
    $set: { 'visionRecovery.phase': 'NORMAL_IMAGE_PIPELINE_QUEUED' },
  });
  console.log(`Released ${plan.plannedLayers.filter((item) => !item.image && item.layer.imageSession?.generationStatus !== 'COMPLETED').length} layers without saved PNGs to the normal image generation queue.`);
  console.log('Express listener can now advance the existing step session after image, audio, and later stages complete.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const plan = await buildPlan(options);
  printPlan(plan);
  if (!options.apply) {
    console.log('\nDry run only. Review the references and prompts, then pass --apply with this plan hash.');
    return;
  }
  if (options.planSha !== plan.digest) throw new Error('Plan hash changed; run dry-run again before applying.');
  await applyPlan(plan, options.backupDir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Recovery stopped: ${error?.message || error}`);
    process.exitCode = 1;
  }).finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
}
