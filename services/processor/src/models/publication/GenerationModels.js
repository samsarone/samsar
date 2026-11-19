import { getStoredSessionInferenceModel } from './InferenceModel.js';
import { loadPublicationGenerationAssetModels } from './GenerationAssetModels.js';

export const PUBLICATION_MODEL_KINDS = ['image', 'video', 'inference'];
const normalizeString = (value) => typeof value === 'string' ? value.trim() : '';
const uniqueModels = (values) => [...new Set(values.map(normalizeString).filter(Boolean))];
const modelList = (value) => Array.isArray(value) ? uniqueModels(value) : [];

/** Read persisted generation settings, never today's user defaults or publish hints.
 * Keep historical model IDs verbatim: normalizing with today's model catalog can
 * turn an unknown/retired model into the current default and misattribute it.
 */
export function buildPublicationGenerationModelFields(session = {}, assetModels = {}) {
  const layers = [
    ...(Array.isArray(session.layers) ? session.layers : []),
    ...(Array.isArray(session.branchRenderPaths) ? session.branchRenderPaths : [])
      .flatMap((branch) => Array.isArray(branch?.timeline) ? branch.timeline : []),
  ];
  const layerImages = uniqueModels(layers.flatMap((layer) => [
      layer?.imageModel,
      layer?.imageGenerationModel,
      layer?.imageSession?.model,
      ...(Array.isArray(layer?.imageSession?.activeItemList)
        ? layer.imageSession.activeItemList
          .filter((item) => item?.type === 'image' && item.hidden !== true && item.isHidden !== true)
          .map((item) => item.model || item.imageModel)
        : []),
    ]));
  const layerVideos = uniqueModels(layers.flatMap((layer) => [
      layer?.videoGenerationModel,
      layer?.videoModel,
      layer?.aiVideoModel,
      layer?.aiVideoGeneration?.model,
    ]));
  // Layer identities are stronger evidence than a session selection that may
  // have been changed after generation. Category labels such as
  // layerBaseAiImageType/layerAiVideoType ('scene', 'character') are not models.
  const assetImages = modelList(assetModels.image);
  const assetVideos = modelList(assetModels.video);
  const knownImages = uniqueModels([...assetImages, ...layerImages]);
  const knownVideos = uniqueModels([...assetVideos, ...layerVideos]);
  const image = knownImages.length > 0 ? knownImages : uniqueModels([
    [session.expressGenerationImageModel, session.imageModel, session.image_model]
      .map(normalizeString).find(Boolean),
  ]);
  const video = knownVideos.length > 0 ? knownVideos : uniqueModels([
    [session.expressGenerativeVideoModel, session.videoGenerationModel,
      session.videoModel, session.video_model].map(normalizeString).find(Boolean),
  ]);
  const inference = uniqueModels([getStoredSessionInferenceModel(session)]);
  const generationModels = {
    version: 1,
    source: 'session',
    image,
    video,
    inference,
    evidence: {
      image: image.length === 0 ? 'unavailable'
        : assetImages.length > 0 ? 'generated-asset' : layerImages.length > 0 ? 'layer' : 'session',
      video: video.length === 0 ? 'unavailable'
        : assetVideos.length > 0 ? 'generated-asset' : layerVideos.length > 0 ? 'layer' : 'session',
      inference: inference.length > 0 ? 'session' : 'unavailable',
    },
    missing: PUBLICATION_MODEL_KINDS.filter((kind) => (
      ({ image, video, inference })[kind].length === 0
    )),
  };
  return {
    imageModel: image[0] || null,
    videoModel: video[0] || null,
    inferenceModel: inference[0] || null,
    generationModels,
  };
}

export async function resolvePublicationGenerationModelFields(session = {}, options = {}) {
  const assetModels = await loadPublicationGenerationAssetModels(session, options);
  return buildPublicationGenerationModelFields(session, assetModels);
}

/** Only fill holes in legacy publications; never replace a saved attribution. */
export function buildPublicationModelBackfill(publication = {}, session = {}, assetModels = {}) {
  const resolved = buildPublicationGenerationModelFields(session, assetModels);
  const previous = publication.generationModels;
  const hasSnapshot = previous?.version === 1;
  const update = {};
  const lists = {};
  const evidence = {};
  for (const kind of PUBLICATION_MODEL_KINDS) {
    const field = `${kind}Model`;
    const stored = normalizeString(publication[field]);
    const savedModels = modelList(previous?.[kind]);
    // A previous publication snapshot wins over mutable session settings.
    lists[kind] = savedModels.length > 0
      ? savedModels
      : stored ? [stored] : resolved.generationModels[kind];
    evidence[kind] = savedModels.length > 0
      ? previous.evidence?.[kind] || 'publication'
      : stored ? 'publication' : resolved.generationModels.evidence[kind];
    if (!stored && lists[kind].length > 0) update[field] = lists[kind][0];
  }
  const snapshot = {
    version: 1,
    source: hasSnapshot ? previous.source : 'session-backfill',
    ...lists,
    evidence,
    missing: PUBLICATION_MODEL_KINDS.filter((kind) => lists[kind].length === 0),
  };
  const snapshotChanged = !hasSnapshot || PUBLICATION_MODEL_KINDS.some((kind) => (
    JSON.stringify(modelList(previous[kind])) !== JSON.stringify(lists[kind])
  )) || JSON.stringify(previous.missing) !== JSON.stringify(snapshot.missing)
    || JSON.stringify(previous.evidence) !== JSON.stringify(evidence);
  if (snapshotChanged) update.generationModels = snapshot;
  return update;
}
