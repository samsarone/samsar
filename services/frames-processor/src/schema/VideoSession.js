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

    frames: [String],
    objectSelectBaseImage: String,
    objectSelectMaskImage: String,
    maskImagePath: String,
    maskGenerationPending: { type: Boolean, default: false }, 
    segmentation: { type: Object, default: {} },
    frameGenerationRetries: { type: Number, default: 0 },

    aiVideoFrameGenerationPending: { type: Boolean, default: false },

    activeImageDescription: { type: String, default: '' },

    layerAiVideoType:  String, // character or scene 

    layerBaseAiImageType: String, // character or scene

    layerAISoundEffectPrompt: String,

    // start and end frames
    aiLayerStartFrame: String,
    aiLayerEndFrame: String,
    baseLayerStartFrame: String,
    baseLayerEndFrame: String,


    refilterImageScore: { type: Number, default: 100 },

    movieResourceList: Array,


    clipStartFrames: {type: Number, default: 0},
    clipEndFrames: {type: Number, default: 0},

    clipStart: { type: Boolean, default: false },
    clipEnd: { type: Boolean, default: false },



    filterPasses: [
      {
        score: Number,
        src: String,
      }
    ],




}, {  strict: false });


const audioLayerSchema = new Schema({
    prompt: String,
    speechLanguage: String,
    subtitleText: String,
    subtitleLanguage: String,
    subtitleTranslationRequired: { type: Boolean, default: false },
    subtitleAlignmentMap: [Object],
    subtitleSpeakerCharacterName: String,
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

}, {  strict: false });

const globalVideoSchema = new Schema({
    startTime: { type: Number, default: 0 },
    endTime: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    url: { type: String, default: '' },
    remoteURL: { type: String, default: '' },
    assetPath: { type: String, default: '' },
    position: {
        x: { type: Number, default: 0 },
        y: { type: Number, default: 0 },
    },
    dimensions: {
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 },
    },
    shape_overlay: { type: String, default: 'circle' },
    frames: [String],
    framesPerSecond: { type: Number, default: 24 },
    framesGenerationStatus: { type: String, default: 'COMPLETED' },
    framesGenerationPending: { type: Boolean, default: false },
    framesGenerationError: { type: String, default: '' },
    framesGenerationTaskId: { type: String, default: '' },
    framesGeneratedAt: { type: Date, default: null },
    source: { type: String, default: 'facecam' },
    title: { type: String, default: 'Facecam' },
}, { strict: false });

const branchTimelineEntrySchema = new Schema({
    sequenceIndex: { type: Number, required: true },
    pathSequenceIndex: { type: Number, default: null },
    sceneIndex: { type: Number, default: null },
    layerId: { type: String, required: true },
    duration: { type: Number, required: true },
    durationOffset: { type: Number, required: true },
    frames: [String],
    frameGenerationStatus: { type: String, default: 'INIT' },
    frameGenerationPending: { type: Boolean, default: false },
    frameGenerationError: { type: String, default: null },
    error: { type: String, default: null },
}, { _id: false, strict: false });

const branchAudioTimelineEntrySchema = new Schema({
    sequenceIndex: { type: Number, default: null },
    audioLayerId: { type: String, required: true },
    pathSequenceIndex: { type: Number, default: null },
    duration: { type: Number, default: null },
    startTime: { type: Number, default: null },
    endTime: { type: Number, default: null },
    connectedLayerStartTimeOffset: { type: Number, default: null },
    connectedLayerId: { type: String, default: null },
    connectedLayerIndex: { type: Number, default: null },
}, { _id: false, strict: false });

const branchThumbnailSourceSchema = new Schema({
    timelineIndex: { type: Number, default: null },
    layerId: { type: String, default: null },
    pathSequenceIndex: { type: Number, default: null },
    sceneIndex: { type: Number, default: null },
    framePath: { type: String, default: null },
    divergenceSceneIndex: { type: Number, default: null },
    selectionTrailIndex: { type: Number, default: null },
    reason: { type: String, default: null },
}, { _id: false, strict: false });

const branchRenderPathSchema = new Schema({
    pathId: { type: String, required: true },
    branchingHint: { type: String, default: null },
    branchingDescription: { type: String, default: null },
    branchPointId: { type: String, default: null },
    divergenceSceneIndex: { type: Number, default: null },
    switchAtSeconds: { type: Number, default: null },
    duration: { type: Number, required: true },
    timeline: [branchTimelineEntrySchema],
    audioTimeline: [branchAudioTimelineEntrySchema],
    frameGenerationStatus: { type: String, default: 'INIT' },
    frameGenerationPending: { type: Boolean, default: false },
    frameGenerationError: { type: String, default: null },
    videoGenerationStatus: { type: String, default: 'INIT' },
    videoGenerationPending: { type: Boolean, default: false },
    videoGenerationError: { type: String, default: null },
    videoLink: { type: String, default: null },
    remoteURL: { type: String, default: null },
    thumbnailPath: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    thumbnailUploadError: { type: String, default: null },
    thumbnailSource: { type: branchThumbnailSourceSchema, default: null },
}, { _id: false, strict: false });

// Create the main schema corresponding to the document interface
const videoSessionSchema = new Schema({
    userId: String,
    narrativeType: { type: String, enum: ['singular', 'branched'], default: 'singular' },
    branchingMeta: { type: Schema.Types.Mixed, default: null },
    branchingTimeline: { type: Schema.Types.Mixed, default: null },
    renderPlanVersion: { type: Number, default: null },
    defaultBranchPathId: { type: String, default: null },
    branchRenderPaths: [branchRenderPathSchema],
    promptlist: [String],
    layers: [layerSchema],
    audioLayers: [audioLayerSchema],
    global_audio_layers: [audioLayerSchema],
    global_videos: [globalVideoSchema],
    generations: [Object],
    audio: String,
    frameGenerationPending: { type: Boolean, default: false },
    framesPerSecond: { type: Number, enum: [16, 24, 30], default: 24 },

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

    applyAudioDucking: { type: Boolean, default: false },
    sceneTransitionPreset: { type: String, default: 'none' },
    appliedSceneTransitionPreset: { type: String, default: 'none' },

    applyAudioVisualizer: { type: Boolean, default: false },


    notifyOnCompletion: { type: Boolean, default: false },
    notificationEmail: { type: String, default: '' },
    notificationSent: { type: Boolean, default: false },


    isMovieGen: { type: Boolean, default: false},

    isVidGPTGen: { type: Boolean, default: false},

    movieGenSpeakers: [Object],

    refilterImageGenerationsRequired: { type: Boolean, default: false },
    refilterImageGenerationCompleted: { type: Boolean, default: false },
    refilterImagePassNumber: { type: Number, default: 0 },

    externalWebhook: { type: String, default: null },

    remoteURL: String,

    provisionalCredits: {type: Number, default: 0},

    expressGenerativeVideoModelSubType: String,

    isPartnerUser: {type: Boolean, default: false},

    isPublic: {type: Boolean, default: false},

    expressGenerationSpeakerFont: String,

    expressGenerationTextFont: String,
    
    totalDuration: { type: Number, default: 0 },

    videoGenerationModelSubType: String,

    videoTone: String,
    

    backingTrackModel: { type: String, default: 'CASSETTEAI'},
    sessionLanguage: { type: String, default: 'EN' },
    language: { type: String, default: null },
    languageString: { type: String, default: null },


}, { timestamps: true, strict: false });

// Create a Model
const VideoSession = model('VideoSession', videoSessionSchema);

export default VideoSession;
