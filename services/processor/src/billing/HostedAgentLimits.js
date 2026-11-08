import { Types } from 'mongoose';

export async function assertHostedAgentLimit({ session, amount, User, Ledger, now = new Date() }) {
  const apiKeyId = session.apiKeyUsage?.apiKeyId || session.apiKeyId;
  if (!apiKeyId || !(amount > 0)) return;
  const user = await User.findById(session.userId).select('userApiKeys').lean();
  const key = user?.userApiKeys?.find(item => String(item._id) === String(apiKeyId));
  const limit = Number(key?.usageLimit);
  if (!(limit > 0) || !['total', 'monthly'].includes(key.usageLimitPeriod)) return;
  const oid = value => Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : value;
  const match = { userId: oid(session.userId), apiKeyId: oid(apiKeyId),
    $or: [{ direction: 'debit' }, { direction: 'credit', source: 'hosted_agent_refund' }],
    ...(key.usageLimitPeriod === 'monthly' ? { createdAt: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) } } : {}),
  };
  const result = await Ledger.aggregate([{ $match: match }, { $group: { _id: null,
    total: { $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amount', { $multiply: ['$amount', -1] }] } },
  } }]);
  if (Math.max(0, Number(result[0]?.total) || 0) + amount > limit) {
    throw Object.assign(new Error('API key credit limit reached.'), { code: 'API_KEY_USAGE_LIMIT_EXCEEDED', status: 402 });
  }
}
