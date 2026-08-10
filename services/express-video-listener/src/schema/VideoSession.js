import { Schema, model } from 'mongoose';
import { DEFAULT_LATIN_SUBTITLE_FONT } from '../consts/SubtitleFonts.js';



const InitExpressGenerationStatus = {
  'prompt_generation': 'PENDING',
  'image_generation': 'PENDING',
  'audio_generation': 'PENDING',
  'frame_generation': 'INIT',
  'video_generation': 'INIT',
    'ai_video_generation': 'INIT',
    'speech_generation': 'INIT',
    'music_generation': 'INIT',
    'delete_reflow': 'INIT',
  'timeline_reflowed': 'INIT',
}
const activeSessionItemSchema = new Schema({
  type: String,
  id: String,
}, {
  _id: true,
  strict: false
});

const CustomAdapters = new Schema({
  api_key: String,
  base_url: String,
  text_to_video: String,
  text_to_video_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
  image_to_video: String,
  image_to_video_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
  text_to_image: String,
  text_to_image_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
  text_to_speech: String,
  text_to_speech_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
  text_to_music: String,
  text_to_music_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
  text_to_sound_effect: String,
  text_to_sound_effect_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
}, { _id: false, strict: false });


// Define the ImageSession schema
const ImageSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  generations: [{ type: String }],
  activeSelectedImage: { type: String, default: '' },
  activeGeneratedImage: { type: String, default: '' },
  activeEditedImage: { type: String, default: '' },
  generationStatus: { type: String, default: 'INIT' },
  editStatus: { type: String, default: 'INIT' },
  witnesses: [{ type: String }],
  intermediates: [{ type: String }],
  lastWitnessSavedAt: { type: Date, default: null },
  generationError: { type: String, default: null },
  editError: { type: String, default: '' },
  prompt: { type: String },
  activeItemList: [activeSessionItemSchema],
  previousActiveItemList: Array,
  canvasAnimations: Array,

  videoRenderStartFrameImage: { type: String, default: '' },
  videoRenderEndFrameImage: { type: String, default: '' },

  activeImageRemoteLink: { type: String, default: '' },

  activeImageDescription: { type: String, default: '' },
}, { _id: false, strict: false });





const layerSchema = new Schema({
  imageSession: { type: ImageSessionSchema },
  prompt: String,
  videoGenerationPrompt: String,
  status: { type: String, default: "pending" },
  duration: { type: Number, default: 1 },
  durationOffset: { type: Number, default: 0 },
  initFramesGenerated: { type: Boolean, default: false },
  frameGenerationPending: { type: Boolean, default: false },

  aiVideoGenerationPending: { type: Boolean, default: false },
  lipSyncGenerationPending: { type: Boolean, default: false },
  soundEffectGenerationPending: { type: Boolean, default: false },

  aiVideoLayer: String,
  lipSyncVideoLayer: String,
  soundEffectVideoLayer: String,
  userVideoLayer: String,

  hasAiVideoLayer: { type: Boolean, default: false },
  hasLipSyncVideoLayer: { type: Boolean, default: false },
  hasSoundEffectVideoLayer: { type: Boolean, default: false },
  hasUserVideoLayer: { type: Boolean, default: false },
  isAudioVideoLayer: { type: Boolean, default: false },

  aiVideoGenerationStatus: { type: String, default: "INIT" },
  aiVideoGenerationStartedAt: Date,
  aiVideoGenerationError: String,
  lipSyncVideoGenerationStatus: { type: String, default: "INIT" },
  soundEffectVideoGenerationStatus: { type: String, default: "INIT" },
  userVideoGenerationStatus: { type: String, default: "INIT" },

  aiVideoRemoteLink: String,
  lipSyncRemoteLink: String,
  soundEffectRemoteLink: String,
  userVideoRemoteLink: String,

  userVideoGenerationPending: { type: Boolean, default: false },

  frames: [String],
  objectSelectBaseImage: String,
  objectSelectMaskImage: String,
  maskImagePath: String,
  maskGenerationPending: { type: Boolean, default: false },
  segmentation: { type: Object, default: {} },
  frameGenerationRetries: { type: Number, default: 0 },

  aiVideoFrameGenerationPending: { type: Boolean, default: false },

  activeImageDescription: { type: String, default: '' },

  cameraTransition: { type: String, default: '' },
  cameraTransitionGenerationStatus: {
    type: String,
    enum: ['INIT', 'PENDING', 'COMPLETED', 'FAILED'],
    default: 'INIT',
  },
  cameraTransitionGenerationError: { type: String, default: null },
  cameraTransitionGeneratedAt: { type: Date, default: null },
  cameraTransitionGenerationSource: { type: String, default: null },
  cameraTransitionBranchPathId: { type: String, default: null },
  cameraTransitionSequenceIndex: { type: Number, default: null },

  layerAiVideoType: String, // character or scene 

  layerBaseAiImageType: String, // character or scene

  layerAISoundEffectPrompt: String,

  // start and end frames
  aiLayerStartFrame: String,
  aiLayerEndFrame: String,
  baseLayerStartFrame: String,
  baseLayerEndFrame: String,


  refilterImageScore: { type: Number, default: 100 },

  movieResourceList: Array,


  clipStartFrames: { type: Number, default: 0 },
  clipEndFrames: { type: Number, default: 0 },

  clipStart: { type: Boolean, default: false },
  clipEnd: { type: Boolean, default: false },

  filterPasses: [
    {
      score: Number,
      src: String,
      description: String,
    }
  ],

}, { strict: false });


const audioLayerSchema = new Schema({
  prompt: String,
  speechLanguage: String,
  subtitleText: String,
  subtitleLanguage: String,
  subtitleAlignmentMap: [Object],
  subtitleSpeakerCharacterName: String,
  subtitleTranslationRequired: { type: Boolean, default: false },
  localAudioLinks: [String],
  remoteAudioLinks: [String],
  remoteAudioData: [Object],
  selectedLocalAudioLink: String,
  selectedRemoteAudioLink: String,

  duration: { type: Number, default: 1 },
  startTime: { type: Number, default: 0 },
  endTime: { type: Number, default: 0 },

  connectedLayerStartTimeOffset: { type: Number, default: 0 },

  volume: { type: Number, default: 100 },
  generationStatus: { type: String, default: "PENDING" },
  generationError: { type: String, default: null },
  isEnabled: { type: Boolean, default: false },
  generationType: String,
  streamCreatedAt: { type: Date, default: null },
  streamDownloadPending: { type: Boolean, default: false },
  defaultSelected: { type: Boolean, default: false },
  lyrics: { type: String, default: null },
  fadeOnEdges: { type: Boolean, default: true },
  addSubtitles: { type: Boolean, default: false },
  subtitleFont: { type: String, default: DEFAULT_LATIN_SUBTITLE_FONT },
  subtitleWordAnimation: String,
  transcriptAlignment: Object,

  connectedLayerId: String,
  connectedLayerIndex: Number,

  speaker: String,
  provider: String,
  speakerCharacterName: String,

  isLayerLocked: { type: Boolean, default: false },
  previousAudioData: Object,

  instructions: { type: String, default: '' },

  generationMeta: Object,


  isHumanoid: { type: Boolean, default: false },
  originalDuration: { type: Number, default: 1 },

}, { strict: false });

// Create the main schema corresponding to the document interface
const videoSessionSchema = new Schema({
  userId: String,
  narrativeType: {
    type: String,
    enum: ['singular', 'branched'],
    default: 'singular',
  },
  sourceNarrativeType: {
    type: String,
    enum: ['singular', 'branched'],
    default: null,
  },
  branchingMeta: { type: Schema.Types.Mixed, default: null },
  branchingTimeline: { type: Schema.Types.Mixed, default: null },
  renderPlanVersion: { type: Number, default: null },
  defaultBranchPathId: { type: String, default: null },
  branchRenderPaths: { type: [Schema.Types.Mixed], default: [] },
  branchRenderCompletionFinalized: { type: Boolean, default: false },
  branchRenderCompletedAt: { type: Date, default: null },
  expressGenerationBillingStageDurations: { type: Object, default: {} },
  promptlist: [String],
  layers: [layerSchema],
  audioLayers: [audioLayerSchema],
  generations: [Object],
  audio: String,
  frameGenerationPending: { type: Boolean, default: false },

  isFrameGenerating: { type: Boolean, default: false },
  videoGenerationPending: { type: Boolean, default: false },
  audioGenerationPending: { type: Boolean, default: false },
  transcriptGenerationPending: { type: Boolean, default: false },
  enableSubtitles: { type: Boolean, default: true },
  subtitleLanguage: { type: String, default: null },
  subtitleLanguageString: { type: String, default: null },
  subtitleLanguageExplicit: { type: Boolean, default: false },
  subtitleTranslationRequired: { type: Boolean, default: false },
  hasSubtitles: { type: Boolean, default: null },
  has_subtitles: { type: Boolean, default: null },

  videoLink: String,

  hasOutroImage: { type: Boolean, default: false },
  outroImageURL: { type: String, default: null },
  outroImageMetadata: { type: Object, default: null },
  addFooterAnimation: { type: Boolean, default: false },
  footerMetadata: [{
    url: String,
    title: String,
    cta_url: String,
    ctaUrl: String,
    cta_text: String,
    ctaText: String,
    text: String,
    cta_logo: String,
    ctaLogo: String,
    logoUrl: String,
    logoImagePath: String,
    footerLogoImagePath: String,
  }],

  imageGenerationTheme: String,
  imageGenerationBaseTheme: String,
  imageGenerationBasicTheme: String,
  basicTextTheme: String,
  parentTextTheme: String,
  derivedTextTheme: String,
  parentJsonTheme: String,
  derivedJsonTheme: String,
  defaultSceneDuration: { type: Number, default: 2 },
  isGuestSession: { type: Boolean, default: false },
  isIntroSession: { type: Boolean, default: false },
  maskGenerationPending: { type: Boolean, default: false },
  sessionName: String,

  sessionMessages: [Object],
  sessionMessageGenerationPending: { type: Boolean, default: false },

  isExpressGeneration: { type: Boolean, default: false },
  expressGenerationPending: { type: Boolean, default: true },
  expressGenerationPaused: { type: Boolean, default: false },
  expressGenerationPausedAt: { type: Date, default: null },
  expressGenerationResumedAt: { type: Date, default: null },
  expressGenerationCancelled: { type: Boolean, default: false },
  expressGenerationStatus: {
    type: Object,
    default: InitExpressGenerationStatus,
  },
  expressGenerationAnimation: { type: String, default: null },
  expressGenerationType: { type: String, default: null },
  expressGenerationError: { type: String, default: null },
  expressGenerationCreated: { type: Date, default: null },


  expressGenerativeVideoRequired: { type: Boolean, default: false },
  expressGenerativeVideoModel: { type: String, default: null },
  expressGenerativeVideoUseEndFrame: { type: Boolean, default: false },
  expressGenerationFailed: { type: Boolean, default: false },
  expressGenerativeSpeechRequired: { type: Boolean, default: true },

  expressGenerationAnimationType: { type: String, default: null },


  setAutoDurationPerScene: { type: Boolean, default: false },

  splashImage: { type: String, default: null },
  useDefaultAnimationPresets: { type: Boolean, default: false },
  textList: [String],

  addBannerToComposition: { type: Boolean, default: false },
  bannerText: { type: String, default: '' },

  aspectRatio: { type: String, default: '1:1' },
  framesPerSecond: { type: Number, enum: [16, 24, 30], default: 24 },

  applyAudioDucking: { type: Boolean, default: false },

  applyAudioVisualizer: { type: Boolean, default: false },


  notifyOnCompletion: { type: Boolean, default: false },
  notificationEmail: { type: String, default: '' },
  notificationSent: { type: Boolean, default: false },


  isMovieGen: { type: Boolean, default: false },

  isVidGPTGen: { type: Boolean, default: false },

  movieGenSpeakers: [Object],

  refilterImageGenerationsRequired: { type: Boolean, default: false },
  refilterImageGenerationCompleted: { type: Boolean, default: false },
  refilterImagePassNumber: { type: Number, default: 0 },

  externalWebhook: { type: String, default: null },
  isExternalUserRequest: { type: Boolean, default: false },
  externalRequestUserId: { type: String, default: null },
  externalRequestId: { type: String, default: null },
  externalRequestIdentityKey: { type: String, default: null },

  remoteURL: String,

  provisionalCredits: { type: Number, default: 0 },
  expressGenerationBillingDurationSeconds: { type: Number, default: 0 },
  expressGenerationCreditCharges: { type: Object, default: {} },
  isStepVideoGeneration: { type: Boolean, default: false },
  expressStepGeneration: { type: Object, default: {} },

  expressGenerativeVideoModelSubType: String,

  isPartnerUser: { type: Boolean, default: false },

  isPublic: { type: Boolean, default: false },

  expressGenerationSpeakerFont: String,

  expressGenerationTextFont: String,

  expressGenerationImageModel: String,


  expressGenerationType: { type: String, default: 'TEXT_TO_VIDEO' },


  totalDuration: { type: Number, default: 0 },

  videoGenerationModelSubType: String,

  videoTone: String,


  backingTrackModel: { type: String, default: 'LYRIA3' },

  expressInputPrompt: { type: String, default: '' },
  custom_adapters: { type: CustomAdapters, default: null },
  customAdapterFallbacks: { type: Object, default: null },
  customAdapterOperationUsage: { type: Object, default: null },
  samsarExternalProviderStages: { type: Object, default: null },
  expressGenerationCustomStageResults: { type: Object, default: {} },

  sessionReceipt: { type: Object, default: {} },

  inputPrompt: { type: String, default: '' },
  sessionLanguage: { type: String, default: 'EN' },
  language: { type: String, default: null },
  languageString: { type: String, default: null },

  inferenceModel: String,
  inferenceEffort: { type: String, enum: ['high', 'xhigh'], default: null },
  expressGenerationInferenceModel: String,
  expressGenerationInferenceEffort: { type: String, enum: ['high', 'xhigh'], default: null },
}, { timestamps: true, strict: false });

// Create a Model
const VideoSession = model('VideoSession', videoSessionSchema);

export default VideoSession;
