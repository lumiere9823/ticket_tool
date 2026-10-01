import { ExtensionMessage } from '../../extension/shared/messages';

export interface MessageSenderInfo {
  tabId?: number | undefined;
  frameId?: number | undefined;
  id?: string | undefined;
  url?: string | undefined;
  origin?: string | undefined;
}

export type MessageHandler = (
  message: ExtensionMessage,
  sender?: MessageSenderInfo
) => void | Promise<void>;

export interface EventBus {
  publish(message: ExtensionMessage): Promise<void>;
  subscribe(handler: MessageHandler): () => void;
}
