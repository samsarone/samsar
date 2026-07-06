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
    
  }, { _id: false });
  


  

const layerSchema = new Schema({
    imageSession: { type: ImageSessionSchema },
    prompt: String,
    status: { type: String, default: "pending" },
    duration: { type: Number, default: 1 },
    durationOffset: { type: Number, default: 0 },
    initFramesGenerated: { type: Boolean, default: false },
    frameGenerationPending: { type: Boolean, default: false },

    aiVideoGenerationPending: { type: Boolean, default: false },
    aiVideoLayer: String,
    hasAiVideoLayer: { type: Boolean, default: false },
    aiVideoGenerationStatus: { type: String, default: "INIT" },
    
    frames: [String],
    objectSelectBaseImage: String,
    objectSelectMaskImage: String,
    maskImagePath: String,
    maskGenerationPending: { type: Boolean, default: false }, 
    segmentation: { type: Object, default: {} },
    frameGenerationRetries: { type: Number, default: 0 },


    aiVideoFrameGenerationPending: { type: Boolean, default: false },
});


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
    volume: { type: Number, default: 1 },
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

});

// Create the main schema corresponding to the document interface
const videoSessionSchema = new Schema({
    userId: String,
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
    hasSubtitles: { type: Boolean, default: null },
    has_subtitles: { type: Boolean, default: null },

    videoLink: String,
    
    
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

    

    setAutoDurationPerScene: { type: Boolean, default: false },

    splashImage: { type: String, default: null },
    useDefaultAnimationPresets: { type: Boolean, default: false },
    textList: [String],

    addBannerToComposition: { type: Boolean, default: false },
    bannerText: { type: String, default: '' },

    aspectRatio: { type: String, default: '1:1' }, 
    sessionLanguage: { type: String, default: 'EN' },
    language: { type: String, default: null },
    languageString: { type: String, default: null },

    applyAudioDucking: { type: Boolean, default: false },

    applyAudioVisualizer: { type: Boolean, default: false },




    

}, { timestamps: true });

// Create a Model
const VideoSession = model('VideoSession', videoSessionSchema);

export default VideoSession;
