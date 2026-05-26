import type { ExternalRunRequest } from '../../types';

export function shouldExecuteExternalRunRequest({
  request,
  lastRequestId,
  sdkReady,
  messagesInitialized,
}: {
  request?: ExternalRunRequest | null;
  lastRequestId: string | null;
  sdkReady: boolean;
  messagesInitialized: boolean;
}) {
  return Boolean(
    request && request.id !== lastRequestId && sdkReady && messagesInitialized,
  );
}
