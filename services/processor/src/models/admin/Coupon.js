import { getDBConnectionString } from "../DBString.js";
import CouponCode from "../../schema/CouponCode.js";
import { generateStripeDiscountCoupon} from '../Payment.js';

export async function createCoupon(payload) {

  await getDBConnectionString();

  let { couponCode, redemptionType, redemptionValue, redemptionLimit, redemptionStartDate, redemptionEndDate, redemptionActive ,
    
    redemptionMonths, isPercentRedemption, redemptionPercentage } = payload;



    if (isPercentRedemption) {
      couponCode = await generateStripeDiscountCoupon(payload);
    }
  const coupon = new CouponCode({
    couponCode,
    redemptionType,
    redemptionValue,
    redemptionLimit,
    redemptionStartDate,
    redemptionEndDate,
    redemptionActive,
    redemptionMonths,
    isPercentRedemption,
    redemptionPercentage

  });

  return await coupon.save();

  
}