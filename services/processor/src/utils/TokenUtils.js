export async function getOffchainMintPrice(payload) {
  const { totalSupply, creatorAllocation} =  payload;
    const FINAL_PRICE = BigInt('1000000000000000000'); // 1e18
    const MAX_SUPPLY = 10000;

    if (totalSupply <= creatorAllocation) {
        return BigInt(0);
    }
    const adjustedSupply = BigInt(totalSupply - creatorAllocation);
    const maxAdjustedSupply = BigInt(MAX_SUPPLY - creatorAllocation);
    return (FINAL_PRICE * adjustedSupply * adjustedSupply) / (maxAdjustedSupply * maxAdjustedSupply);
}


export function getOffchainBurnPrice(payload) {
  const { totalSupply, creatorAllocation, burnAmount} =  payload;

  try {
  const FINAL_PRICE = BigInt('1000000000000000000'); // 1e18
  const MAX_SUPPLY = BigInt(10000);
  const FEE_RATE = BigInt(50); // 0.05%
  const ONE_HUNDRED_THOUSAND = BigInt(1000000); // Divisor to calculate the fee rate

  let totalRefundAmount = BigInt(0);
  let totalAdminFees = BigInt(0);


  let currentSupply = BigInt(totalSupply);

  // Calculate the price for each token at the time it was minted and sum it up
  for (let i = 0; i < burnAmount; i++) {
      if (currentSupply <= creatorAllocation) {
          break; // No price for tokens within the creator mint range
      }
      const adjustedSupply = currentSupply - creatorAllocation;

      const maxAdjustedSupply = BigInt(MAX_SUPPLY - creatorAllocation);
      const price = (FINAL_PRICE * adjustedSupply * adjustedSupply) / (maxAdjustedSupply * maxAdjustedSupply);
      if (price > 0) {
          const adminFee = (price * FEE_RATE) / ONE_HUNDRED_THOUSAND;
          totalAdminFees += adminFee;
          totalRefundAmount += (price - adminFee);
      }
      currentSupply -= BigInt(1);
  }

  return { refundAmount: totalRefundAmount, adminFees: totalAdminFees };
} catch (error) {
  console.error(error);
}
}
