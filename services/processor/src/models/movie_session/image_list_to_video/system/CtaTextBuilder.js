import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

import { createCompatibleChatCompletion } from "../../../ai_utils/OpenAICompat.js";
import { getModelForUserInferenceModel } from "../../utils/ModelUtils.js";
import { GPT_56_SOL_REASONING_EFFORT } from "../../../../consts/InferenceModels.js";

const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });
const DEFAULT_OUTRO_HEADER = "Scan to view";
const DEFAULT_OUTRO_SUBTEXT = "Open the link";
const CTA_VERB_LABELS = {
  book: "Book",
  shop: "Shop",
  order: "Order",
  connect: "Contact",
  join: "Join",
  learn: "Learn",
  view: "View",
};
const OUTRO_SUBTEXT_BY_VERB = {
  book: "Reserve your spot",
  shop: "Explore offers",
  order: "Start your order",
  connect: "Get details",
  join: "Join in minutes",
  learn: "Read more",
  view: DEFAULT_OUTRO_SUBTEXT,
};

const ExpressCtaTextPayload = z.object({
  outro_header: z.string(),
  outro_subtext: z.string().optional().nullable(),
  footer_ctas: z.array(z.object({
    text: z.string(),
  })),
});

function normalizeText(value, {
  fallback = "",
  maxLength = 48,
  maxWords = 6,
} = {}) {
  const raw = typeof value === "string" ? value : "";
  const cleaned = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const source = cleaned || fallback;
  if (!source) {
    return "";
  }

  const words = source.split(/\s+/).filter(Boolean).slice(0, maxWords);
  const joined = words.join(" ").trim();
  return joined.length > maxLength ? joined.slice(0, maxLength).trim() : joined;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return "";
  }
}

function inferCtaVerb(ctaUrl = "", metadata = {}, prompt = "", ...contextValues) {
  const combined = [
    ctaUrl,
    prompt,
    safeStringify(metadata),
    ...contextValues.map((value) => (
      typeof value === "string" ? value : safeStringify(value)
    )),
  ].join(" ").toLowerCase();

  if (/\b(book|booking|reserve|reservation|stay|hotel|tour|activity|activities|experience|experiences|attraction|ticket|tickets|event|events|trip|travel|destination|appointment|availability|rental|rentals)\b/.test(combined)) {
    return "book";
  }
  if (/\b(shop|store|cart|buy|purchase|order|checkout|product|sale)\b/.test(combined)) {
    return "shop";
  }
  if (/\b(menu|restaurant|food|delivery|takeout)\b/.test(combined)) {
    return "order";
  }
  if (/\b(demo|call|consult|contact|quote|estimate)\b/.test(combined)) {
    return "connect";
  }
  if (/\b(join|signup|sign up|apply|subscribe|membership)\b/.test(combined)) {
    return "join";
  }
  if (/\b(learn|course|guide|blog|docs|article)\b/.test(combined)) {
    return "learn";
  }
  return "view";
}

function buildFallbackFooterText(scenePayload = {}, ctaVerb = "view") {
  const title = firstString(
    scenePayload.title,
    scenePayload.image_title,
    scenePayload.imageTitle,
    scenePayload.activity_title,
    scenePayload.activityTitle,
    scenePayload.image_text,
    scenePayload.imageText,
    scenePayload.name,
    scenePayload.label,
  );
  if (title) {
    const actionLabel = CTA_VERB_LABELS[ctaVerb] || CTA_VERB_LABELS.view;
    const titleAlreadyActioned = new RegExp(`^${actionLabel}\\b`, "i").test(title);
    const copy = titleAlreadyActioned ? title : `${actionLabel} ${title}`;
    return normalizeText(copy, { fallback: `Scan to ${ctaVerb}`, maxWords: 5 });
  }

  const fallbackByVerb = {
    book: "Book this spot",
    shop: "Shop this look",
    order: "Order now",
    connect: "Get in touch",
    join: "Join today",
    learn: "Learn more",
    view: "View details",
  };
  return fallbackByVerb[ctaVerb] || "View details";
}

function buildFallbackCtaPayload({
  ctaUrl,
  metadata = {},
  prompt = "",
  imageListPayload = [],
  imageDescriptionList = [],
  sceneCount = 0,
}) {
  const ctaVerb = inferCtaVerb(
    ctaUrl,
    metadata,
    prompt,
    imageListPayload,
    imageDescriptionList,
  );
  const footerCount = Math.max(
    0,
    Math.floor(Number(sceneCount) || 0),
    Array.isArray(imageListPayload) ? imageListPayload.length : 0,
    Array.isArray(imageDescriptionList) ? imageDescriptionList.length : 0,
  );

  return {
    cta_text_top: `Scan to ${ctaVerb}`,
    cta_text_bottom: OUTRO_SUBTEXT_BY_VERB[ctaVerb] || DEFAULT_OUTRO_SUBTEXT,
    footer_metadata: Array.from({ length: footerCount }, (_, index) => ({
      url: ctaUrl,
      ctaUrl,
      title: buildFallbackFooterText(
        Array.isArray(imageListPayload) ? imageListPayload[index] : {},
        ctaVerb,
      ),
    })),
  };
}

function isGenericViewCopy(value) {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";
  return [
    "scan to view",
    "view details",
    "view more",
    "open the link",
    "open link",
  ].includes(normalized);
}

function normalizeGeneratedCtaPayload(rawPayload, fallbackPayload, ctaUrl, sceneCount) {
  const footerTexts = Array.isArray(rawPayload?.footer_ctas)
    ? rawPayload.footer_ctas
    : [];
  const requiredSceneCount = Math.max(0, Math.floor(Number(sceneCount) || 0));

  const footer_metadata = Array.from({ length: requiredSceneCount }, (_, index) => {
    const generatedText = normalizeText(footerTexts[index]?.text, {
      fallback: fallbackPayload.footer_metadata[index]?.title || `Scan to ${inferCtaVerb(ctaUrl)}`,
      maxWords: 5,
      maxLength: 42,
    });
    const fallbackText = fallbackPayload.footer_metadata[index]?.title || "";
    const resolvedText = isGenericViewCopy(generatedText) && fallbackText
      ? fallbackText
      : generatedText;
    return {
      url: ctaUrl,
      ctaUrl,
      title: resolvedText,
      ctaText: resolvedText,
    };
  });

  const generatedCtaTextTop = normalizeText(rawPayload?.outro_header, {
    fallback: fallbackPayload.cta_text_top || DEFAULT_OUTRO_HEADER,
    maxWords: 4,
    maxLength: 32,
  });
  const fallbackCtaTextTop = fallbackPayload.cta_text_top || DEFAULT_OUTRO_HEADER;
  const ctaTextTop = isGenericViewCopy(generatedCtaTextTop) && fallbackCtaTextTop !== DEFAULT_OUTRO_HEADER
    ? fallbackCtaTextTop
    : generatedCtaTextTop;
  const ctaTextBottom = normalizeText(rawPayload?.outro_subtext, {
    fallback: fallbackPayload.cta_text_bottom || DEFAULT_OUTRO_SUBTEXT,
    maxWords: 6,
    maxLength: 48,
  });

  return {
    cta_text_top: ctaTextTop || DEFAULT_OUTRO_HEADER,
    cta_text_bottom: ctaTextBottom || DEFAULT_OUTRO_SUBTEXT,
    footer_metadata,
  };
}

function getSceneMetadata(scenePayload = {}) {
  if (!scenePayload || typeof scenePayload !== "object") {
    return {};
  }
  const allowedKeys = [
    "title",
    "image_title",
    "imageTitle",
    "activity_title",
    "activityTitle",
    "name",
    "label",
    "category",
    "type",
    "product_type",
    "productType",
    "listing_type",
    "listingType",
    "location",
    "city",
    "country",
    "price",
    "currency",
    "metadata",
  ];
  return allowedKeys.reduce((acc, key) => {
    if (scenePayload[key] !== undefined && scenePayload[key] !== null) {
      acc[key] = scenePayload[key];
    }
    return acc;
  }, {});
}

function buildPromptPayload({
  ctaUrl,
  prompt,
  metadata,
  imageDescriptionList,
  imageListPayload,
  scenes,
}) {
  return {
    cta_url: ctaUrl,
    session_prompt: typeof prompt === "string" ? prompt.trim() : "",
    session_metadata: metadata || {},
    scenes: Array.isArray(scenes)
      ? scenes.map((scene, index) => ({
        index,
        visual: firstString(scene?.visual, scene?.prompt, scene?.text),
        type: firstString(scene?.type),
        duration: Number.isFinite(Number(scene?.duration)) ? Number(scene.duration) : null,
        image_title: firstString(
          imageListPayload?.[index]?.title,
          imageListPayload?.[index]?.image_title,
          imageListPayload?.[index]?.imageTitle,
          imageListPayload?.[index]?.activity_title,
          imageListPayload?.[index]?.activityTitle,
          imageListPayload?.[index]?.name,
          imageListPayload?.[index]?.label,
        ),
        listing_metadata: getSceneMetadata(imageListPayload?.[index]),
        image_description: firstString(imageDescriptionList?.[index]),
      }))
      : [],
  };
}

export async function buildExpressCtaTextPayload({
  ctaUrl,
  prompt = "",
  metadata = {},
  imageDescriptionList = [],
  imageListPayload = [],
  scenes = [],
  inferenceModel = "gpt-5.6-sol",
} = {}) {
  const normalizedCtaUrl = typeof ctaUrl === "string" ? ctaUrl.trim() : "";
  const sceneCount = Array.isArray(scenes) && scenes.length
    ? scenes.length
    : Array.isArray(imageDescriptionList)
      ? imageDescriptionList.length
      : 0;
  const fallbackPayload = buildFallbackCtaPayload({
    ctaUrl: normalizedCtaUrl,
    metadata,
    prompt,
    imageListPayload,
    imageDescriptionList,
    sceneCount,
  });

  if (!normalizedCtaUrl || !API_KEY) {
    return fallbackPayload;
  }

  const modelName = getModelForUserInferenceModel(inferenceModel);
  const messageList = [
    {
      role: "developer",
      content: [
        "You write compact CTA copy for generated marketing videos.",
        "Return one footer CTA per scene and one outro header.",
        "Use session_metadata and each scene's listing_metadata to infer the product action before using generic URL wording.",
        "Prefer 'Scan to book' for booking platforms, activities, tours, tickets, events, rentals, stays, reservations, or appointments.",
        "Prefer 'Scan to shop' for ecommerce/product listings, 'Scan to order' for restaurants/food, and 'Scan to connect' for lead generation.",
        "Avoid 'Scan to view' unless the metadata gives no booking, purchase, order, contact, join, or learning intent.",
        "Footer CTA text must be short, specific, and useful for that scene.",
        "Outro header must be a clean QR prompt like 'Scan to book', 'Scan to shop', or 'Scan to view'.",
        "Do not include URLs, emoji, quotes, hashtags, or punctuation-heavy copy.",
        "Keep footer text at 2 to 5 words. Keep outro header at 2 to 4 words.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify(buildPromptPayload({
        ctaUrl: normalizedCtaUrl,
        prompt,
        metadata,
        imageDescriptionList,
        imageListPayload,
        scenes,
      })),
    },
  ];

  try {
    const response = await createCompatibleChatCompletion(openai, {
      messages: messageList,
      model: modelName,
      response_format: zodResponseFormat(ExpressCtaTextPayload, "express_cta_text_payload"),
      reasoning: { effort: GPT_56_SOL_REASONING_EFFORT },
      timeout: Number(process.env.IMAGE_LIST_TO_VIDEO_CTA_TEXT_TIMEOUT_MS) || 90000,
      maxRetries: 1,
    });
    const messageContent = response?.choices?.[0]?.message?.content;
    const parsedPayload = JSON.parse(messageContent || "{}");
    return normalizeGeneratedCtaPayload(parsedPayload, fallbackPayload, normalizedCtaUrl, sceneCount);
  } catch (error) {
    console.error("[model][image_list_to_video] express CTA text generation failed; using fallback copy", {
      error: error?.message,
    });
    return fallbackPayload;
  }
}
