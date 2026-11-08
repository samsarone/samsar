import { createHostedAgentSettlement } from './HostedAgentSettlement.js';

// External/provider requests deliberately retain their existing billing path.
export function createHostedAgentRuntime({ VideoSession, User, Ledger, bypass, beforeDebit }) {
  return createHostedAgentSettlement({ VideoSession, Ledger, bypass, beforeDebit,
    async resolveAccount(session) {
      if (session.isExternalUserRequest) throw new Error('External requests cannot use hosted-agent wallet settlement.');
      return { Model: User, id: session.userId };
    },
  });
}
