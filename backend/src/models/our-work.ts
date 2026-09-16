import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const workImageSchema = new Schema(
  {
    url: { type: String, required: true, maxlength: 500 },
    publicId: { type: String, default: '', maxlength: 300 },
    width: { type: Number, default: 0, min: 0 },
    height: { type: Number, default: 0, min: 0 },
    order: { type: Number, default: 0, min: 0, max: 1000 },
  },
  { _id: true },
);

const ourWorkSchema = new Schema(
  {
    title: { type: String, default: '', maxlength: 140, trim: true },
    description: { type: String, default: '', maxlength: 4000 },
    customerName: { type: String, default: '', maxlength: 80, trim: true },
    rating: { type: Number, default: null, min: 1, max: 10 },
    feedback: { type: String, default: '', maxlength: 2000 },
    images: { type: [workImageSchema], required: true, validate: [(value: unknown[]) => value.length > 0, 'At least one image is required'] },
    enquiryEnabled: { type: Boolean, default: true },
    enquiryLabel: { type: String, default: 'Enquire Now', maxlength: 40 },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
    isPublished: { type: Boolean, default: false, index: true },
    source: { type: String, enum: ['ADMIN', 'CUSTOMER'], default: 'ADMIN' },
    isDemo: { type: Boolean, default: false },
    aiGenerated: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0, min: 0, max: 10000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

ourWorkSchema.index({ isPublished: 1, status: 1, sortOrder: 1, createdAt: -1 });

export const OurWork = model('OurWork', ourWorkSchema);
export type OurWorkDoc = InferSchemaType<typeof ourWorkSchema> & { _id: Types.ObjectId };
