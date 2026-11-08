import { translateText as uiText } from '../../utils/localization.js';
import { resolveLanguageCode } from '../../constants/supportedLanguages.js';
import { supportsInferenceEffort } from '../../utils/inferenceModelChoices.mjs';
import { normalizeDeploymentInferenceModelValue } from '../../utils/deploymentProviders.js';
import { buildSubtitleRegenerationLanguageFields } from '../../utils/subtitleRegenerationLanguage.mjs';
const OUTRO_CTA_TYPE_QR = 'qr';
const OUTRO_CTA_TYPE_IMAGE = 'image';
const hasTextValue = value => typeof value === 'string' && value.trim().length > 0;
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalizeInferenceModelKey = value => normalizeDeploymentInferenceModelValue(value) || 'gpt-6-astra';
const normalizeInferenceEffort = value => value === 'xhigh' ? 'xhigh' : 'high';
function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const DEFAULT_POST_PROCESSING_FORM = Object.freeze({
  outroCtaType: OUTRO_CTA_TYPE_QR,
  ctaUrl: '',
  ctaTextTop: '',
  ctaTextBottom: '',
  ctaLogo: '',
  outroCtaImageUrl: '',
  footerCtaText: '',
  footerCtaLogo: '',
  footerCtaUrl: '',
  translationLanguage: '',
  translationEnableSubtitles: true,
  translationTranslateOutro: true,
  translationTranslateFooter: true,
  subtitleLanguage: '',
  rerollLayerIndexes: [],
});

export function createDefaultPostProcessingForm() {
  return { ...DEFAULT_POST_PROCESSING_FORM, rerollLayerIndexes: [] };
}
export function sessionHasOutroImage(session) {
  if (!session || typeof session !== 'object') {
    return false;
  }

  if (session.hasOutroImage === true) {
    return true;
  }

  if (hasTextValue(session.outroImageURL) || hasTextValue(session.outroImageUrl)) {
    return true;
  }

  if (isPlainObject(session.outroImageMetadata)) {
    return true;
  }

  return Array.isArray(session.layers) && session.layers.some((layer) =>
    isPlainObject(layer?.outroImageMetadata)
  );
}

export function buildExpressPostProcessingRequest({ actionKey, id, postProcessingForm, currentRenderHasOutro,
  canGenerateSubtitles, postProcessingAudioLanguage, rerollLayerIndexes = [], inferenceModel, inferenceEffort,
  confirmAction = (message) => window.confirm(message),
}) {
  const hasExistingOutro = currentRenderHasOutro;
  let endpoint = '';
  let payload = { videoSessionId: id };
  let successLabel = uiText("Post-processing");
  if (actionKey === 'retranslate') {
    const languageCode = resolveLanguageCode(postProcessingForm.translationLanguage, '');
    if (!languageCode || languageCode === 'auto') {
      throw new Error(uiText("Choose a target language for retranslation."));
    }

    payload = {
      ...payload,
      language: languageCode,
      enable_subtitles: canGenerateSubtitles &&
        postProcessingForm.translationEnableSubtitles === true,
      translate_outro: postProcessingForm.translationTranslateOutro !== false,
      translate_footer: postProcessingForm.translationTranslateFooter !== false,
      inference_model: normalizeInferenceModelKey(inferenceModel),
      ...(supportsInferenceEffort(inferenceModel)
        ? { effort: normalizeInferenceEffort(inferenceEffort) }
        : {}),
    };
    endpoint = 'retranslate_video';
    successLabel = uiText('Retranslation');
  } else if (actionKey === 'add_subtitles') {
    if (!canGenerateSubtitles) {
      throw new Error(uiText("OpenAI or Samsar configuration is required to generate subtitles."));
    }
    payload = {
      ...payload,
      ...buildSubtitleRegenerationLanguageFields({
        selectedLanguage: postProcessingForm.subtitleLanguage,
        audioLanguage: postProcessingAudioLanguage,
      }),
    };
    endpoint = 'add_subtitles';
    successLabel = uiText("Subtitle regeneration");
  } else if (actionKey === 'remove_subtitles') {
    const shouldRemove = confirmAction(uiText("Remove subtitles and render a new version?"));
    if (!shouldRemove) {
      return;
    }

    endpoint = 'remove_subtitles';
    successLabel = uiText("Subtitle removal");
  } else if (actionKey === 'regenerate_avatar') {
    const shouldRegenerateAvatar = confirmAction(
      uiText("Generate a fresh narrator avatar and render a new version?")
    );
    if (!shouldRegenerateAvatar) {
      return;
    }

    endpoint = 'regenerate_avatar';
    successLabel = uiText("Narrator avatar regeneration");
  } else if (actionKey === 'clone_render') {
    endpoint = 'clone';
    successLabel = uiText("Clone render");
  } else if (actionKey === 'generated_outro') {
    const outroCtaType =
      postProcessingForm.outroCtaType === OUTRO_CTA_TYPE_IMAGE
        ? OUTRO_CTA_TYPE_IMAGE
        : OUTRO_CTA_TYPE_QR;
    const ctaTextTop = postProcessingForm.ctaTextTop.trim();
    const ctaTextBottom = postProcessingForm.ctaTextBottom.trim();
    const ctaLogo = postProcessingForm.ctaLogo.trim();

    payload = {
      ...payload,
      generate_outro_image: true,
    };

    if (outroCtaType === OUTRO_CTA_TYPE_IMAGE) {
      const middleImageUrl = postProcessingForm.outroCtaImageUrl.trim();
      if (!middleImageUrl) {
        throw new Error(uiText("CTA image URL or upload is required."));
      }
      if (!isHttpUrl(middleImageUrl)) {
        throw new Error(uiText("Enter a valid CTA image URL."));
      }

      const outroCtaImage = {
        middle_image: { url: middleImageUrl },
      };
      if (ctaTextTop) outroCtaImage.top_text = ctaTextTop;
      if (ctaTextBottom) outroCtaImage.bottom_text = ctaTextBottom;
      payload.outro_cta_image = outroCtaImage;
    } else {
      const ctaUrl = postProcessingForm.ctaUrl.trim();
      if (!isHttpUrl(ctaUrl)) {
        throw new Error(uiText("Enter a valid outro CTA URL."));
      }
      payload.cta_url = ctaUrl;
      if (ctaTextTop) payload.cta_text_top = ctaTextTop;
      if (ctaTextBottom) payload.cta_text_bottom = ctaTextBottom;
      if (ctaLogo) payload.cta_logo = ctaLogo;
    }

    endpoint = hasExistingOutro ? 'update_outro_image' : 'add_outro_image';
    successLabel = hasExistingOutro ? uiText("Outro CTA update") : uiText("Outro CTA add");
  } else if (actionKey === 'footer_cta') {
    const ctaText = postProcessingForm.footerCtaText.trim();
    const ctaLogo = postProcessingForm.footerCtaLogo.trim();
    const ctaUrl = postProcessingForm.footerCtaUrl.trim();
    if (!ctaText && !ctaLogo && !ctaUrl) {
      throw new Error(uiText("Add footer text, logo, or URL."));
    }
    if (ctaUrl && !isHttpUrl(ctaUrl)) {
      throw new Error(uiText("Enter a valid footer URL."));
    }

    payload = { ...payload };
    if (ctaText) payload.cta_text = ctaText;
    if (ctaLogo) payload.cta_logo = ctaLogo;
    if (ctaUrl) payload.cta_url = ctaUrl;

    endpoint = 'update_footer_image';
    successLabel = uiText("Footer update");
  } else if (actionKey === 'remove_footer') {
    const shouldRemove = confirmAction(uiText("Remove the footer CTA and render a new version?"));
    if (!shouldRemove) {
      return;
    }

    payload = {
      ...payload,
      remove_footer: true,
    };
    endpoint = 'update_footer_image';
    successLabel = uiText("Footer removal");
  } else if (actionKey === 'reroll_layers') {
    if (!rerollLayerIndexes.length) {
      throw new Error(uiText("Select at least one scene to reroll."));
    }

    payload = {
      ...payload,
      layer_indexes: rerollLayerIndexes,
    };
    endpoint = 'reroll-layers';
    successLabel = uiText("Scene reroll");
  } else {
    return;
  }


  return { endpoint, payload, successLabel };
}
