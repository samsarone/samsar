function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function trimText(value, maxLength = 220) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

export function buildOutroImageMetadata({
  generated = false,
  sourceUrl = null,
  assetPath = null,
  ctaUrl = null,
  ctaTextTop = null,
  ctaTextBottom = null,
  ctaLogo = null,
  outroCtaImage = null,
  centerImageType = null,
} = {}) {
  const outroCtaImageSource = typeof outroCtaImage === 'string'
    ? outroCtaImage.trim()
    : typeof outroCtaImage?.source === 'string'
      ? outroCtaImage.source.trim()
      : '';
  const isOutroCtaImageDataUrl = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(outroCtaImageSource);
  const normalized = {
    generated: generated === true,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(assetPath ? { assetPath } : {}),
    ...(ctaUrl ? { ctaUrl } : {}),
    ...(trimText(ctaTextTop, 180) ? { topText: trimText(ctaTextTop, 180) } : {}),
    ...(trimText(ctaTextBottom, 180) ? { bottomText: trimText(ctaTextBottom, 180) } : {}),
    ...(ctaLogo ? { logoUrl: ctaLogo } : {}),
    ...(outroCtaImageSource || centerImageType === 'cta_image' ? { centerImageType: 'cta_image' } : {}),
    ...(outroCtaImageSource && !isOutroCtaImageDataUrl ? { ctaImageUrl: outroCtaImageSource } : {}),
  };

  if (
    !normalized.generated &&
    !normalized.sourceUrl &&
    !normalized.assetPath &&
    !normalized.ctaUrl &&
    !normalized.topText &&
    !normalized.bottomText &&
    !normalized.logoUrl &&
    !normalized.centerImageType &&
    !normalized.ctaImageUrl
  ) {
    return null;
  }

  return normalized;
}

export function normalizeOutroImageMetadata(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const generated = value.generated === true || value.generateOutroImage === true || value.generatedOutroImage === true;
  return buildOutroImageMetadata({
    generated,
    sourceUrl: firstString(value.sourceUrl, value.outroImageUrl, value.outro_image_url),
    assetPath: firstString(value.assetPath, value.outroImagePath, value.outroImageURL),
    ctaUrl: firstString(value.ctaUrl, value.cta_url, value.outroCtaUrl),
    ctaTextTop: firstString(value.topText, value.ctaTextTop, value.cta_text_top, value.outroCtaTextTop),
    ctaTextBottom: firstString(value.bottomText, value.ctaTextBottom, value.cta_text_bottom, value.outroCtaTextBottom),
    ctaLogo: firstString(value.logoUrl, value.ctaLogo, value.cta_logo, value.outroCtaLogo),
    outroCtaImage: firstString(value.ctaImageUrl, value.outroCtaImageUrl, value.outro_cta_image_url),
    centerImageType: value.centerImageType,
  });
}

export function normalizeFooterMetadataItem(entry = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const ctaUrl = firstString(entry.url, entry.ctaUrl, entry.cta_url);
  const ctaText = trimText(
    firstString(entry.title, entry.ctaText, entry.cta_text, entry.text, entry.name, entry.label),
    220,
  );
  const logoUrl = firstString(entry.logoUrl, entry.ctaLogo, entry.cta_logo, entry.logo_url, entry.footer_logo_url);
  const logoImagePath = firstString(entry.logoImagePath, entry.footerLogoImagePath, entry.footer_logo_image_path);

  if (!ctaUrl && !ctaText && !logoUrl && !logoImagePath) {
    return null;
  }

  return {
    ...(ctaUrl ? { url: ctaUrl, ctaUrl } : {}),
    ...(ctaText ? { title: ctaText, ctaText } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(logoImagePath ? { logoImagePath, footerLogoImagePath: logoImagePath } : {}),
  };
}

export function normalizeFooterMetadataList(footerMetadata) {
  if (!Array.isArray(footerMetadata)) {
    return [];
  }

  return footerMetadata
    .map((entry) => normalizeFooterMetadataItem(entry))
    .filter(Boolean);
}
