export interface PopupEventListenerOptions {
  armButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  refreshButton: HTMLButtonElement;
  saveButton?: HTMLButtonElement | null;
  onArm: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onSave?: () => void | Promise<void>;
}

export function registerPopupEventListeners(options: PopupEventListenerOptions): void {
  options.armButton.addEventListener('click', options.onArm);
  options.stopButton.addEventListener('click', options.onStop);
  options.refreshButton.addEventListener('click', options.onRefresh);
  if (options.saveButton && options.onSave) {
    options.saveButton.addEventListener('click', options.onSave);
  }
}
