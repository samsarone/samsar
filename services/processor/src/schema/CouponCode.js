
import { Schema,model } from 'mongoose';
// 2. Create a Schema corresponding to the document interface.
const couponCodeSchema = new Schema({
  couponCode: String,
  redemptionType: String, // credit or subscription
  redemptionValue: Number,
  redemptionLimit: Number,
  redemptionCount: {type: Number, default: 0},
  redemptionMonths: Number,
  redemptionStartDate: Date,
  redemptionEndDate: Date,
  redemptionActive: Boolean,
  redeemedUsers: [String],

  isPercentRedemption: Boolean,

  redemptionPercentage: Number,
  // Optional ownership/scope metadata for coupon targeting.
  issuedForUserId: String,
  couponScope: String,
  couponSource: String,



}, { timestamps: true });

// 3. Create a Model.
const CouponCode = model('CouponCode', couponCodeSchema);

export default CouponCode;
