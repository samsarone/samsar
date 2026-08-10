
import { Schema,model } from 'mongoose';
import { DEFAULT_LATIN_SUBTITLE_FONT, getSubtitleFontsForLanguage } from '../consts/SubtitleFonts.js';
import { SUPPORTED_LANGUAGES } from '../consts/SupportedLanguages.js';


const UserAPIKey = new Schema({
  apiKey: String,
  expiresAt: Date,
  userId: String,
  usageLimit: { type: Number, default: null },
  usageLimitPeriod: {
    type: String,
    enum: ['monthly', 'total', null],
    default: null,
  },
}, { timestamps: true });

const OAuthRefreshToken = new Schema({
  tokenHash: String,
  expiresAt: Date,
  lastUsedAt: Date,
  checkoutSessionId: String,
  source: String,
}, { timestamps: true });

const AppUserData = new Schema({
  appUserId: String,
  appUserEmail: String,
  isGoldUser: {type: Boolean, default: false},
  goldUserAdded: Date,
  videoGenerationRequestTime: Date,
});

const SpeakerOptions = new Schema({
  allowOpenAI: { type: Boolean, default: false },
  allowElevenLabs: { type: Boolean, default: false },
  allowGoogle: { type: Boolean, default: false },
  openAISpeakers: { type: [String], default: [] },
  elevenLabsSpeakers: { type: [String], default: [] },
  googleSpeakers: { type: [String], default: [] },
  googleSpeakerDetails: { type: [Object], default: [] },
}, { _id: false });

const CustomAdapters = new Schema({
  api_key: String,
  base_url: String,
  text_to_video: String,
  text_to_video_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  image_to_video: String,
  image_to_video_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_image: String,
  text_to_image_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_speech: String,
  text_to_speech_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_music: String,
  text_to_music_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_sound_effect: String,
  text_to_sound_effect_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  custom_endpoints: { type: [Object], default: undefined },
}, { _id: false, strict: false });

const buildDefaultFontPreferences = () => {
  const defaults = {};
  SUPPORTED_LANGUAGES.forEach((languageCode) => {
    const fonts = getSubtitleFontsForLanguage(languageCode);
    const defaultFont = (Array.isArray(fonts) && fonts[0]) ? fonts[0] : DEFAULT_LATIN_SUBTITLE_FONT;
    defaults[languageCode] = {
      expressGenerationTextFont: defaultFont,
      expressGenerationSpeakerFont: defaultFont,
    };
  });
  return defaults;
};


// 2. Create a Schema corresponding to the document interface.
const userSchema = new Schema({
  fid: String,
  userId: String,

  email: String,
  password: String,

  verificationCode: String,
  verificationCodeExpiresAt: Date,
  isEmailVerified: {type: Boolean, default: false},
  weeklyNewsletterSubscribed: {type: Boolean, default: false},
  weeklyNewsletterSubscribedAt: Date,
  weeklyNewsletterSubscriptionSource: String,
  weeklyNewsletterAdminNotifiedAt: Date,
  weeklyNewsletterUnsubscribedAt: Date,
  weeklyNewsletterUnsubscribeReason: String,
  weeklyNewsletterUnsubscribeDetails: String,

  bio: String,
  custody: String,

  displayName: String,
  message: String,
  nonce: String,
  pfpUrl: String,
  signature: String,
  state: String,
  username: String,
  preferredLanguage: { type: String, default: 'en' },
  verifications: Array,

  isPremiumUser: {type: Boolean, default: false},
  premiumUserAdded: Date,
  premiumUserCreditsLastUpdated: Date,
  generationCredits: {type: Number, default: 0},
  // Durable, per-request debit markers make opt-in metered debits recoverable
  // and prevent stale workers from reopening a completed charge without
  // requiring cross-collection Mongo transactions.
  generationCreditDebitReservations: {
    type: Schema.Types.Mixed,
    default: undefined,
    select: false,
  },

  autoRechargeEnabled: { type: Boolean, default: false },
  autoRechargeThreshold: { type: Number, default: 0 }, // credits threshold
  autoRechargeAmountUsd: { type: Number, default: 0 }, // dollars to charge
  autoRechargeMaxMonthlyUsd: { type: Number, default: 0 }, // dollars to cap per month
  autoRechargePaymentMethodId: { type: String },
  autoRechargeSetupAt: Date,
  autoRechargeLastRunAt: Date,
  autoRechargeLastInvoiceId: String,
  autoRechargeLockUntil: Date,

  premiumUserType: String, // premium professionaL or enterprise. Deprecated

  userType: String, // Free or Creator

  stripePaymentId: String,
  
  stripeCustomerId: String,

  stripeSubscriptionStatus: String,

  couponCodeRedemptionRetries: {type: Number, default: 0},
  couponCodeRedemptionRetriesLastUpdated: Date,

  totalAudioInLibrary: {type: Number, default: 0},

  contentFilterRating: { type: Number, default: 3},

  isAdminUser: {type: Boolean, default: false},
  dockerAdminBootstrappedAt: Date,
  dockerAdminOrganizationName: String,

  pendingPlanType: String,

  userApiKeys: [UserAPIKey],
  oauthRefreshTokens: [OAuthRefreshToken],

  selectedInferenceModel: {type: String, default: 'gpt-5.6-sol'},
  selectedInferenceEffort: { type: String, enum: ['high', 'xhigh'], default: 'high' },
  selectedInferenceModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.

  selectedAssistantModel: {type: String, default: 'gpt-5.6-sol'},
  selectedAssistantModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.
  assistantSystemPrompt: { type: String, default: null },

  selectedNotifyOnCompletion: {type: Boolean, default: false},

  videoFramesPerSecond: { type: Number, enum: [16, 24, 30], default: 24 },

  isAppUser: {type: Boolean, default: false},

  userPreferenceTags: Array,
  preferenceTagsAdded: {type: Boolean, default: false},

  // app user data
  appData: AppUserData,

  hasUserChosenPaymentMethod: {type: Boolean, default: false},
  hasFreeTrialClaimed: {type: Boolean, default: false},

  isPartnerUser: {type: Boolean, default: false},

  expressGenerationSpeakerFont: { type: String, default: 'Rampart One'},

  expressGenerationTextFont: { type: String, default: DEFAULT_LATIN_SUBTITLE_FONT},

  fontPreferences: { type: Schema.Types.Mixed, default: buildDefaultFontPreferences },

  backingTrackModel: { type: String, default: 'ELEVENLABS_MUSIC'},
  backingTrackModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.

  speakerOptions: { type: SpeakerOptions, default: null },

  agentVideoModel: { type: String, default: 'RUNWAYML'},
  agentVideoModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.

  agentImageModel: { type: String, default: 'GPTIMAGE2'},
  agentImageModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.

  agentSoundEffectModel: { type: String, default: 'MIRELOAI'},
  agentSoundEffectModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.

  defaultAgentDuration: {type: Number, default: 30}, // in seconds

  custom_adapters: { type: CustomAdapters, default: null },

  isTempUser: {type: Boolean, default: false},
  isBotUser: {type: Boolean, default: false},

  authenticationKey: { type: String },

  
}, { timestamps: true });

userSchema.index({ authenticationKey: 1 }, { unique: true, sparse: true });
userSchema.index({ 'oauthRefreshTokens.tokenHash': 1 }, { sparse: true });

// 3. Create a Model.
const User = model('User', userSchema);

export default User;
