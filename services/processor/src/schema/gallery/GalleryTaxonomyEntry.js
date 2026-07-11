import { Schema } from 'mongoose';

const galleryTaxonomyEntrySchema = new Schema(
  {
    kind: {
      type: String,
      enum: ['category', 'topic'],
      required: true,
    },
    name: { type: String, required: true },
    normalizedName: { type: String, required: true },
    publicationIds: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: 'gallery_taxonomy_entries',
  },
);

galleryTaxonomyEntrySchema.index(
  { kind: 1, normalizedName: 1 },
  { unique: true, name: 'gallery_taxonomy_kind_name' },
);
galleryTaxonomyEntrySchema.index({ kind: 1, name: 1 });
galleryTaxonomyEntrySchema.index({ publicationIds: 1 });

export default galleryTaxonomyEntrySchema;
