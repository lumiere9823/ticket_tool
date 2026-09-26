import { ExtensionMessage } from '../../extension/shared/messages';

export type MessageHandler = (message: ExtensionMessage) => void;

export interface EventBus {
  publish(message: ExtensionMessage): Promise<void>;
  subscribe(handler: MessageHandler): () => void;
}
