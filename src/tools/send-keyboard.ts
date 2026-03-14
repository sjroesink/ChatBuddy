export interface SendKeyboardParams {
  message: string;
  options: string[];
  columns?: number; // options per row, default 2
}

export interface SendKeyboardResult {
  success: boolean;
  message: string;
}

// This tool returns keyboard data that the bot core sends as an inline keyboard.
// It does NOT send the message itself — the provider/bot handles that.
export function buildKeyboardResult(params: SendKeyboardParams): SendKeyboardResult {
  if (!params.options?.length) {
    return { success: false, message: 'Geen opties opgegeven.' };
  }
  if (params.options.length > 20) {
    return { success: false, message: 'Maximaal 20 opties.' };
  }
  return { success: true, message: params.message };
}
