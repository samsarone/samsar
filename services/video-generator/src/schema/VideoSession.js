import { Schema, model } from 'mongoose';



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

  aiVideoGenerationStatus: { type: String, default: "INIT" },
  lipSyncVideoGenerationStatus: { type: String, default: "INIT" },
  soundEffectVideoGenerationStatus: { type: String, default: "INIT" },
  userVideoGenerationStatus: { type: String, default: "INIT" },

  aiVideoRemoteLink: String,
  lipSyncRemoteLink: String,
  soundEffectRemoteLink: String,
  userVideoRemoteLink: String,

  userVideoGenerationPending: { type: Boolean, default: false },
  userVideoGenerationError: { type: String, default: null },
  userVideoUploadTaskId: { type: String, default: null },

  frames: [String],
  objectSelectBaseImage: String,
  objectSelectMaskImage: String,
  maskImagePath: String,
  maskGenerationPending: { type: Boolean, default: false },
  segmentation: { type: Object, default: {} },
  frameGenerationRetries: { type: Number, default: 0 },

  aiVideoFrameGenerationPending: { type: Boolean, default: false },

  activeImageDescription: { type: String, default: '' },

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
  localAudioLinks: [String],
  remoteAudioLinks: [String],
  remoteAudioData: [Object],
  selectedLocalAudioLink: String,
  selectedRemoteAudioLink: String,

  duration: { type: Number, default: 1 },
  startTime: { type: Number, default: 0 },
  endTime: { type: Number, default: 0 },
  sourceTrimStartTime: { type: Number, default: 0 },

  connectedLayerStartTimeOffset: { type: Number, default: 0 },

  volume: { type: Number, default: 100 },
  manualVolumeAdjustmentEnabled: { type: Boolean, default: false },
  startVolume: { type: Number, default: 100 },
  endVolume: { type: Number, default: 100 },
  timestampedVolumes: { type: [Object], default: [] },
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
  subtitleFont: { type: String, default: 'Noto Sans' },
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
  promptlist: [String],
  layers: [layerSchema],
  audioLayers: [audioLayerSchema],
  global_audio_layers: [audioLayerSchema],
  generations: [Object],
  audio: String,
  frameGenerationPending: { type: Boolean, default: false },

  isFrameGenerating: { type: Boolean, default: false },
  videoGenerationPending: { type: Boolean, default: false },
  audioGenerationPending: { type: Boolean, default: false },
  transcriptGenerationPending: { type: Boolean, default: false },
  enableSubtitles: { type: Boolean, default: true },
  hasSubtitles: { type: Boolean, default: null },
  has_subtitles: { type: Boolean, default: null },

  videoLink: String,

  hasOutroImage: { type: Boolean, default: false },
  outroImageURL: { type: String, default: null },

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
  sessionType: { type: String, default: 'video' },

  sessionMessages: [Object],
  sessionMessageGenerationPending: { type: Boolean, default: false },
  sessionMessageGenerationError: { type: String, default: null },

  isExpressGeneration: { type: Boolean, default: false },
  expressGenerationPending: { type: Boolean, default: true },
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

  applyAudioDucking: { type: Boolean, default: true },
  sceneTransitionPreset: { type: String, default: 'none' },
  appliedSceneTransitionPreset: { type: String, default: 'none' },

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

  sessionReceipt: { type: Object, default: {} },

  inputPrompt: { type: String, default: '' },
  sessionLanguage: { type: String, default: 'EN' },
  language: { type: String, default: null },
  languageString: { type: String, default: null },

}, { timestamps: true, strict: false });

// Create a Model
const VideoSession = model('VideoSession', videoSessionSchema);

export default VideoSession;
