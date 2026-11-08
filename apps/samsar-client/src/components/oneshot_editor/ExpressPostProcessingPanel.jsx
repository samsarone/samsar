import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { SUPPORTED_LANGUAGES } from '../../constants/supportedLanguages.js';
import { isTranslatedSubtitleRegeneration } from '../../utils/subtitleRegenerationLanguage.mjs';
import { RerollScenePreviewTile } from './RerollScenePreview.jsx';
import { FaLanguage, FaUserCircle, FaClosedCaptioning, FaImage, FaLink, FaRedo, FaClone, FaCog, FaSpinner, FaTrash, FaUpload } from 'react-icons/fa';
const OUTRO_CTA_TYPE_QR = 'qr';
const OUTRO_CTA_TYPE_IMAGE = 'image';
const OUTRO_CTA_TYPE_OPTIONS = [
  { value: 'qr', get label() { return uiText('URL QR code'); } },
  { value: 'image', get label() { return uiText('CTA image'); } },
];
const POST_PROCESSING_ACTIONS = Object.freeze([
  { key: 'retranslate', get label() { return uiText("Retranslate"); }, icon: FaLanguage },
  { key: 'avatar', get label() { return uiText("Avatar"); }, icon: FaUserCircle },
  { key: 'subtitles', get label() { return uiText("Subtitles"); }, icon: FaClosedCaptioning },
  { key: 'generated_outro', get label() { return uiText("Outro CTA"); }, icon: FaImage },
  { key: 'footer_cta', get label() { return uiText("Footer CTA"); }, icon: FaLink },
  { key: 'reroll_layers', get label() { return uiText("Reroll scenes"); }, icon: FaRedo },
  { key: 'clone_render', get label() { return uiText("Clone"); }, icon: FaClone },
  { key: 'advanced_edits', get label() { return uiText("Edits"); }, icon: FaCog },
]);

export default function ExpressPostProcessingPanel({
  currentRenderHasOutro,
  postProcessingPendingAction,
  postProcessingAction,
  postProcessingForm,
  postProcessingAudioLanguage,
  canGenerateSubtitles,
  rerollLocalCreditEstimate,
  isRerollPreviewRefreshing,
  rerollLayerIndexes,
  rerollCandidateLayers,
  playingRerollLayerId,
  postProcessingError,
  postProcessingMessage,
  selectPostProcessingAction,
  updatePostProcessingFormField,
  submitPostProcessingOperation,
  setOutroCtaImageUploadError,
  uploadingOutroCtaImage,
  outroCtaImageUploadError,
  handleOutroCtaImageUploadInput,
  openAdvancedVideoEditDialog,
  toggleRerollLayerIndex,
  toggleRerollLayerPlayback,
  extraClasses = '',
}) {
  useUiLanguage();
  const { colorMode } = useColorMode();
  const mutedText = 'text-fg-muted';
  const hasExistingOutro = currentRenderHasOutro;
  const isAnyPostProcessingPending = Boolean(postProcessingPendingAction);
  const panelClass =
    `bg-surface-sunken text-fg ${colorMode === 'dark' ? 'ring-white/10' : 'ring-slate-200'}`;
  const inputClass =
    `border-line-control bg-surface-raised text-fg ${colorMode === 'dark' ? 'placeholder:text-[#8b96aa] focus:border-[#f6c453] focus:ring-[#f6c453]/24' : 'placeholder:text-slate-400 focus:border-blue-400'}`;
  const subtleButtonClass =
    `text-fg-body ${colorMode === 'dark' ? 'border-white/10 hover:border-white/20 hover:bg-white/5' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`;
  const activeActionClass =
    colorMode === 'dark'
      ? 'bg-[#ff4655]/16 text-[#ffd4d8] ring-[#ff4655]/35'
      : 'bg-blue-50 text-blue-700 ring-blue-200';
  const inactiveActionClass =
    `text-fg-tertiary ${colorMode === 'dark' ? 'ring-white/10 hover:bg-white/5' : 'ring-slate-200 hover:bg-slate-50'}`;
  const submitButtonClass =
    'inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
  const primarySubmitClass =
    colorMode === 'dark'
      ? `${submitButtonClass} bg-[#ff4655] text-[#080a10] hover:bg-[#ff6572] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffe0a3]/75`
      : `${submitButtonClass} bg-blue-600 text-white hover:bg-blue-700`;
  const secondarySubmitClass = `${submitButtonClass} border ${subtleButtonClass}`;
  const dangerSubmitClass =
    colorMode === 'dark'
      ? `${submitButtonClass} border border-rose-300/30 text-rose-100 hover:bg-rose-400/10`
      : `${submitButtonClass} border border-rose-200 text-rose-700 hover:bg-rose-50`;
  const fieldClass = `min-h-[40px] w-full rounded-lg border px-3 py-2 text-sm outline-none transition ${inputClass}`;
  const checkboxClass = colorMode === 'dark'
    ? 'mt-0.5 h-4 w-4 rounded border-[#6f6450] bg-[#20232e] text-[#f6c453] focus:ring-[#f6c453]/45 focus:ring-offset-[#151720]'
    : 'mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500';
  const isGeneratedOutroPending = postProcessingPendingAction === 'generated_outro';
  const isFooterPending = postProcessingPendingAction === 'footer_cta';
  const isRemoveFooterPending = postProcessingPendingAction === 'remove_footer';
  const isRetranslatePending = postProcessingPendingAction === 'retranslate';
  const isAddSubtitlesPending = postProcessingPendingAction === 'add_subtitles';
  const isRemoveSubtitlesPending = postProcessingPendingAction === 'remove_subtitles';
  const isAvatarPending = postProcessingPendingAction === 'regenerate_avatar';
  const isClonePending = postProcessingPendingAction === 'clone_render';
  const isRerollPending = postProcessingPendingAction === 'reroll_layers';
  const rerollQuoteTotalCredits = Number(rerollLocalCreditEstimate?.totalCredits);
  const hasRerollQuote = Number.isFinite(rerollQuoteTotalCredits);
  const isRerollSubmitDisabled =
    isAnyPostProcessingPending ||
    isRerollPreviewRefreshing ||
    !rerollLayerIndexes.length;
  const useTranslatedSubtitleRegeneration = isTranslatedSubtitleRegeneration({
    selectedLanguage: postProcessingForm.subtitleLanguage,
    audioLanguage: postProcessingAudioLanguage,
  });

  const panelWidthClass =
    postProcessingAction === 'reroll_layers' || postProcessingAction === 'retranslate'
      ? 'max-w-5xl'
      : 'max-w-3xl';

  return (
    <div className={`mx-auto w-full ${panelWidthClass} rounded-xl p-3 ring-1 ${panelClass} ${extraClasses}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-semibold">{uiText("Post-processing")}</div>
        <div className="flex flex-wrap items-center gap-2">
          {POST_PROCESSING_ACTIONS
            .filter((action) => canGenerateSubtitles || action.key !== 'subtitles')
            .map((action) => {
              const Icon = action.icon;
              const isActive = postProcessingAction === action.key;
              const isDisabled = isAnyPostProcessingPending;
              return (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => selectPostProcessingAction(action.key)}
                  disabled={isDisabled}
                  title={action.label}
                  className={`
                    inline-flex min-h-[34px] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition
                    ${isActive ? activeActionClass : inactiveActionClass}
                    ${isDisabled ? 'cursor-not-allowed opacity-50' : 'active:scale-[0.98]'}
                  `}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{action.label}</span>
                </button>
              );
            })}
        </div>
      </div>

      <div className="mt-3">
        {postProcessingAction === 'retranslate' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <select
                value={postProcessingForm.translationLanguage}
                onChange={(event) =>
                  updatePostProcessingFormField('translationLanguage', event.target.value)
                }
                disabled={isAnyPostProcessingPending}
                aria-label={uiText("Retranslation language")}
                className={fieldClass}
              >
                <option value="">{uiText("Choose target language")}</option>
                {SUPPORTED_LANGUAGES.map((languageOption) => (
                  <option key={languageOption.code} value={languageOption.code}>
                    {uiText(languageOption.name)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => submitPostProcessingOperation('retranslate')}
                disabled={isAnyPostProcessingPending || !postProcessingForm.translationLanguage}
                className={primarySubmitClass}
              >{uiText("{value0} Retranslate video", { value0: isRetranslatePending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaLanguage className="h-3.5 w-3.5" aria-hidden="true" /> })}</button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {canGenerateSubtitles ? (
                <label className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${inactiveActionClass}`}>
                  <input
                    type="checkbox"
                    checked={postProcessingForm.translationEnableSubtitles}
                    onChange={(event) =>
                      updatePostProcessingFormField('translationEnableSubtitles', event.target.checked)
                    }
                    disabled={isAnyPostProcessingPending}
                    className={checkboxClass}
                  />
                  <span>{uiText("Add translated subtitles")}</span>
                </label>
              ) : null}
              <label className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${inactiveActionClass}`}>
                <input
                  type="checkbox"
                  checked={postProcessingForm.translationTranslateOutro}
                  onChange={(event) =>
                    updatePostProcessingFormField('translationTranslateOutro', event.target.checked)
                  }
                  disabled={isAnyPostProcessingPending}
                  className={checkboxClass}
                />
                <span>{uiText("Translate outro")}</span>
              </label>
              <label className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${inactiveActionClass}`}>
                <input
                  type="checkbox"
                  checked={postProcessingForm.translationTranslateFooter}
                  onChange={(event) =>
                    updatePostProcessingFormField('translationTranslateFooter', event.target.checked)
                  }
                  disabled={isAnyPostProcessingPending}
                  className={checkboxClass}
                />
                <span>{uiText("Translate footer")}</span>
              </label>
            </div>
          </div>
        )}

        {postProcessingAction === 'avatar' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => submitPostProcessingOperation('regenerate_avatar')}
              disabled={isAnyPostProcessingPending}
              className={primarySubmitClass}
            >{uiText("{value0} Regenerate narrator avatar", { value0: isAvatarPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaUserCircle className="h-3.5 w-3.5" aria-hidden="true" /> })}</button>
          </div>
        )}

        {postProcessingAction === 'subtitles' && canGenerateSubtitles && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[190px] flex-1 sm:max-w-xs">
                <span className={`mb-1 block text-caption font-medium ${mutedText}`}>{uiText("Subtitle language")}<span className="font-normal opacity-75">{uiText("(optional)")}</span>
                </span>
                <select
                  value={postProcessingForm.subtitleLanguage}
                  onChange={(event) =>
                    updatePostProcessingFormField('subtitleLanguage', event.target.value)
                  }
                  disabled={isAnyPostProcessingPending}
                  aria-label={uiText("Subtitle regeneration language")}
                  className={`${fieldClass} !min-h-[36px] !py-1.5`}
                >
                  <option value="">{uiText("Same as audio")}</option>
                  {SUPPORTED_LANGUAGES.map((languageOption) => (
                    <option key={languageOption.code} value={languageOption.code}>
                      {uiText(languageOption.name)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => submitPostProcessingOperation('add_subtitles')}
                disabled={isAnyPostProcessingPending}
                className={primarySubmitClass}
              >{uiText("{value0} Generate / regenerate subtitles", { value0: isAddSubtitlesPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaClosedCaptioning className="h-3.5 w-3.5" aria-hidden="true" /> })}</button>
              <button
                type="button"
                onClick={() => submitPostProcessingOperation('remove_subtitles')}
                disabled={isAnyPostProcessingPending}
                className={dangerSubmitClass}
              >{uiText("{value0} Remove subtitles", { value0: isRemoveSubtitlesPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaTrash className="h-3.5 w-3.5" aria-hidden="true" /> })}</button>
            </div>
            {useTranslatedSubtitleRegeneration ? (
              <p className={`text-xs ${mutedText}`}>{uiText("Audio stays unchanged; subtitle text will be translated and aligned to the original speech.")}</p>
            ) : null}
          </div>
        )}

        {postProcessingAction === 'generated_outro' && (
          <div className="space-y-3">
            <select
              value={postProcessingForm.outroCtaType || OUTRO_CTA_TYPE_QR}
              onChange={(event) => {
                updatePostProcessingFormField('outroCtaType', event.target.value);
                setOutroCtaImageUploadError('');
              }}
              disabled={isAnyPostProcessingPending}
              className={fieldClass}
              aria-label={uiText("Outro CTA type")}
            >
              {OUTRO_CTA_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                type="text"
                value={postProcessingForm.ctaTextTop}
                onChange={(event) => updatePostProcessingFormField('ctaTextTop', event.target.value)}
                placeholder={uiText("Top text")}
                aria-label={uiText("Outro top text")}
                className={fieldClass}
              />
              <input
                type="text"
                value={postProcessingForm.ctaTextBottom}
                onChange={(event) => updatePostProcessingFormField('ctaTextBottom', event.target.value)}
                placeholder={uiText("Bottom text")}
                aria-label={uiText("Outro bottom text")}
                className={fieldClass}
              />
              {postProcessingForm.outroCtaType === OUTRO_CTA_TYPE_IMAGE ? (
                <div className="sm:col-span-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="url"
                      value={postProcessingForm.outroCtaImageUrl}
                      onChange={(event) => {
                        updatePostProcessingFormField('outroCtaImageUrl', event.target.value);
                        setOutroCtaImageUploadError('');
                      }}
                      placeholder={uiText("CTA / logo URL")}
                      aria-label={uiText("CTA image URL")}
                      disabled={isAnyPostProcessingPending || uploadingOutroCtaImage}
                      className={`${fieldClass} flex-1`}
                    />
                    <label
                      className={`
                        inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition
                        ${subtleButtonClass}
                        ${isAnyPostProcessingPending || uploadingOutroCtaImage ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
                      `}
                    >
                      <input
                        type="file"
                        accept="image/*,image/heic,image/heif,.heic,.heif"
                        onChange={(event) => handleOutroCtaImageUploadInput(event, 'post_processing')}
                        disabled={isAnyPostProcessingPending || uploadingOutroCtaImage}
                        className="sr-only"
                      />
                      {uploadingOutroCtaImage ? (
                        <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <FaUpload className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {uploadingOutroCtaImage ? uiText("Uploading...") : uiText("Upload image")}
                    </label>
                  </div>
                  {outroCtaImageUploadError ? (
                    <p className="mt-1 text-caption text-rose-500">
                      {outroCtaImageUploadError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <input
                  type="url"
                  value={postProcessingForm.ctaUrl}
                  onChange={(event) => updatePostProcessingFormField('ctaUrl', event.target.value)}
                  placeholder={uiText("Outro CTA URL")}
                  aria-label={uiText("Outro CTA URL")}
                  className={fieldClass}
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => submitPostProcessingOperation('generated_outro')}
              disabled={isAnyPostProcessingPending}
              className={primarySubmitClass}
            >
              {isGeneratedOutroPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              {hasExistingOutro ? uiText("Update outro CTA") : uiText("Add outro CTA")}
            </button>
          </div>
        )}

        {postProcessingAction === 'footer_cta' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                type="text"
                value={postProcessingForm.footerCtaText}
                onChange={(event) => updatePostProcessingFormField('footerCtaText', event.target.value)}
                placeholder={uiText("Footer text")}
                aria-label={uiText("Footer CTA text")}
                className={fieldClass}
              />
              <input
                type="url"
                value={postProcessingForm.footerCtaUrl}
                onChange={(event) => updatePostProcessingFormField('footerCtaUrl', event.target.value)}
                placeholder={uiText("Footer URL")}
                aria-label={uiText("Footer CTA URL")}
                className={fieldClass}
              />
              <input
                type="url"
                value={postProcessingForm.footerCtaLogo}
                onChange={(event) => updatePostProcessingFormField('footerCtaLogo', event.target.value)}
                placeholder={uiText("Footer logo URL")}
                aria-label={uiText("Footer CTA logo URL")}
                className={fieldClass}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => submitPostProcessingOperation('footer_cta')}
                disabled={isAnyPostProcessingPending}
                className={primarySubmitClass}
              >{uiText("{value0} Update footer", { value0: isFooterPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null })}</button>
              <button
                type="button"
                onClick={() => submitPostProcessingOperation('remove_footer')}
                disabled={isAnyPostProcessingPending}
                className={dangerSubmitClass}
              >{uiText("{value0} Remove footer", { value0: isRemoveFooterPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaTrash className="h-3.5 w-3.5" aria-hidden="true" /> })}</button>
            </div>
          </div>
        )}

        {postProcessingAction === 'advanced_edits' && (
          <button
            type="button"
            onClick={openAdvancedVideoEditDialog}
            disabled={isAnyPostProcessingPending}
            className={secondarySubmitClass}
          >
            <FaCog className="h-3.5 w-3.5" aria-hidden="true" />{uiText("Open advanced edits")}</button>
        )}

        {postProcessingAction === 'clone_render' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => submitPostProcessingOperation('clone_render')}
              disabled={isAnyPostProcessingPending}
              className={secondarySubmitClass}
            >{uiText("{value0} Clone render", { value0: isClonePending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaClone className="h-3.5 w-3.5" aria-hidden="true" /> })}</button>
          </div>
        )}

        {postProcessingAction === 'reroll_layers' && (
          <div className="space-y-3">
            {isRerollPreviewRefreshing ? (
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-fg-tertiary ${colorMode === 'dark' ? 'bg-white/[0.04]' : 'bg-slate-50'}`}>
                <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{uiText("Refreshing scene previews")}</div>
            ) : null}
            {rerollCandidateLayers.length ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {rerollCandidateLayers.map((item) => {
                  const isSelected = rerollLayerIndexes.includes(item.layerIndex);
                  return (
                    <RerollScenePreviewTile
                      key={item.layerId}
                      item={item}
                      isSelected={isSelected}
                      isPlaying={playingRerollLayerId === item.layerId}
                      isDisabled={isAnyPostProcessingPending}
                      colorMode={colorMode}
                      mutedText={mutedText}
                      activeActionClass={activeActionClass}
                      inactiveActionClass={inactiveActionClass}
                      onToggleSelect={toggleRerollLayerIndex}
                      onTogglePlayback={toggleRerollLayerPlayback}
                    />
                  );
                })}
              </div>
            ) : (
              <div className={`rounded-lg px-3 py-2 text-sm ${mutedText}`}>{uiText("No rerollable scenes found.")}</div>
            )}

            <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              colorMode === 'dark' ? 'bg-white/[0.04] text-slate-100' : 'bg-slate-50 text-slate-800'
            }`}>
              {hasRerollQuote ? (
                <span>{uiText("Image, AI video, lip-sync and sound-effect model calls are charged individually on completion.")}</span>
              ) : (
                <span className={mutedText}>{uiText("Select scenes to estimate credits.")}</span>
              )}
            </div>

            <button
              type="button"
              onClick={() => submitPostProcessingOperation('reroll_layers')}
              disabled={isRerollSubmitDisabled}
              className={primarySubmitClass}
            >{uiText("{value0} Reroll selected scenes", { value0: isRerollPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaRedo className="h-3.5 w-3.5" aria-hidden="true" /> })}</button>
          </div>
        )}
      </div>

      {postProcessingError ? (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-500">
          {postProcessingError}
        </div>
      ) : null}
      {postProcessingMessage ? (
        <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold ${
          colorMode === 'dark'
            ? 'bg-emerald-400/10 text-emerald-200'
            : 'bg-emerald-50 text-emerald-700'
        }`}>
          {postProcessingMessage}
        </div>
      ) : null}
    </div>
  );
}
