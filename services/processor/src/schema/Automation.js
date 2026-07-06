import { Schema, model } from 'mongoose';

const automationSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    characteristics: {
      type: String,
      required: true,
      trim: true,
    },
    interactions: {
      type: Number,
      default: 0,
      min: 0,
    },
    botUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    authenticationKey: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const Automation = model('Automation', automationSchema);

export default Automation;
