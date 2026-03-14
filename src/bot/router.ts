export type RoutingMode = 'all_messages' | 'autonomous' | 'commands_only';

export function shouldProcessMessage(
  routingMode: RoutingMode,
  messageText: string,
  botUsername: string,
  isPrivateChat: boolean
): boolean {
  // Private chats: always process regardless of mode
  if (isPrivateChat) {
    return true;
  }

  // all_messages and autonomous: always process
  if (routingMode === 'all_messages' || routingMode === 'autonomous') {
    return true;
  }

  // commands_only: process if text starts with '/' or contains @botUsername (case-insensitive)
  if (routingMode === 'commands_only') {
    if (messageText.startsWith('/')) {
      return true;
    }
    if (messageText.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) {
      return true;
    }
    return false;
  }

  return false;
}
