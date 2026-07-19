import { Schema, model } from 'mongoose';

export const INTERACTIVE_PUBLICATION_SCHEMA = 'interactive_publication.v1';
export const INTERACTIVE_VIDEO_MANIFEST_SCHEMA = 'interactive_video_manifest.v1';

const timingSchema = new Schema(
  {
    origin: {
      type: String,
      enum: ['media'],
      default: 'media',
      required: true,
    },
    unit: {
      type: String,
      enum: ['seconds'],
      default: 'seconds',
      required: true,
    },
  },
  { _id: false },
);

const branchOptionSchema = new Schema(
  {
    child_node_id: { type: String, required: true },
    branch_ordinal: { type: Number, min: 1, default: null },
    path_name: { type: String, default: null },
    path_description: { type: String, default: null },
    branching_hint: { type: String, default: null },
    description: { type: String, default: null },
    leaf_path_ids: { type: [String], default: [] },
  },
  { _id: false },
);

const choicePointSchema = new Schema(
  {
    branch_point_id: { type: String, required: true },
    parent_node_id: { type: String, default: null },
    level: { type: Number, min: 1, default: null },
    divergence_scene_index: { type: Number, min: 0, default: null },
    switch_at_seconds: { type: Number, min: 0, required: true },
    options: { type: [branchOptionSchema], default: [] },
  },
  { _id: false },
);

const treeSchema = new Schema(
  {
    root_node_id: { type: String, required: true },
    choice_points: { type: [choicePointSchema], default: [] },
  },
  { _id: false },
);

const interactiveVideoPathSchema = new Schema(
  {
    path_id: { type: String, required: true },
    leaf_node_id: { type: String, default: null },
    ordinal: { type: Number, min: 0, default: null },
    branch_point_id: { type: String, default: null },
    divergence_scene_index: { type: Number, min: 0, default: null },
    switch_at_seconds: { type: Number, min: 0, default: null },
    branching_hint: { type: String, default: null },
    description: { type: String, default: null },
    contentUrl: { type: String, required: true },
    thumbnailUrl: { type: String, required: true },
    encodingFormat: { type: String, default: 'video/mp4', required: true },
    duration: { type: Number, min: 0, required: true },
    is_default: { type: Boolean, default: false, required: true },
  },
  { _id: false },
);

const outputsSchema = new Schema(
  {
    paths: {
      type: [interactiveVideoPathSchema],
      default: [],
      validate: {
        validator: (paths) => Array.isArray(paths) && paths.length > 0,
        message: 'Interactive publication outputs must include at least one path.',
      },
    },
  },
  { _id: false },
);

const manifestSchema = new Schema(
  {
    schemaVersion: {
      type: String,
      enum: [INTERACTIVE_VIDEO_MANIFEST_SCHEMA],
      default: INTERACTIVE_VIDEO_MANIFEST_SCHEMA,
      required: true,
    },
    default_path_id: { type: String, required: true },
    timing: { type: timingSchema, default: () => ({}) },
    tree: { type: treeSchema, required: true },
    outputs: { type: outputsSchema, required: true },
  },
  { _id: false },
);

const interactivePublicationSchema = new Schema(
  {
    schemaVersion: {
      type: String,
      enum: [INTERACTIVE_PUBLICATION_SCHEMA],
      default: INTERACTIVE_PUBLICATION_SCHEMA,
      required: true,
    },
    type: {
      type: String,
      enum: ['InteractiveVideo'],
      default: 'InteractiveVideo',
      required: true,
    },
    sessionId: { type: String, required: true },
    mediaRevision: {
      type: String,
      required: true,
      maxlength: 128,
      match: /^[A-Za-z0-9_-]+$/,
    },
    pendingMediaRevision: {
      type: String,
      default: null,
      maxlength: 128,
      match: /^[A-Za-z0-9_-]+$/,
    },
    pendingPublicationData: { type: Schema.Types.Mixed, default: null },
    unpublishToken: {
      type: String,
      default: null,
      maxlength: 128,
      match: /^[A-Za-z0-9_-]+$/,
    },
    unpublishPreviousPublished: { type: Boolean, default: null },
    unpublishPreviousRenderable: { type: Boolean, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    creatorHandle: { type: String, default: '' },
    slug: { type: String, default: null },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    tags: { type: [String], default: [] },
    datePublished: { type: Date, required: true, default: Date.now },
    mainVideoUrl: { type: String, default: null },
    mainThumbnailUrl: { type: String, default: null },
    duration: { type: Number, min: 0, default: null },
    thumbnailUrl: { type: String, required: true },
    aspectRatio: { type: String, default: null },
    inLanguage: { type: String, default: null },
    hasSubtitles: { type: Boolean, default: null },
    manifest: { type: manifestSchema, required: true },
    publicRenderableVersion: {
      type: String,
      enum: [INTERACTIVE_PUBLICATION_SCHEMA],
      default: null,
    },
    isPublished: { type: Boolean, default: false, required: true },
    isRenderable: { type: Boolean, default: false, required: true },
    isHidden: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

interactivePublicationSchema.index({ sessionId: 1 }, { unique: true });
interactivePublicationSchema.index({ datePublished: -1, _id: -1 });
interactivePublicationSchema.index({
  isPublished: 1,
  isRenderable: 1,
  publicRenderableVersion: 1,
  isHidden: 1,
  isDeleted: 1,
  _id: -1,
});

const InteractivePublication = model(
  'InteractivePublication',
  interactivePublicationSchema,
);

export default InteractivePublication;
