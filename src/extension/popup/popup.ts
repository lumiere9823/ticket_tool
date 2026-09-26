import { ChromeMessageBus } from '../../infrastructure/messaging/ChromeMessageBus';
import { ChromeStorageRepository } from '../../infrastructure/storage/ChromeStorageRepository';
import { PurchaseState } from '../../domain/states/PurchaseState';
import { ExtensionMessage } from '../shared/messages';

const storage = new ChromeStorageRepository();
const messageBus = new ChromeMessageBus();

const stateBadge = document.getElementById('state-badge') as HTMLElement;
const eventUrlInput = document.getElementById('event-url') as HTMLInputElement;
const categoryPriorityInput = document.getElementById('category-priority') as HTMLInputElement;
const quantityInput = document.getElementById('quantity') as HTMLInputElement;
const allowFallbackCheckbox = document.getElementById('allow-fallback') as HTMLInputElement;
const btnArm = document.getElementById('btn-arm') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const attemptIdDisplay = document.getElementById('attempt-id-display') as HTMLElement;
const logBox = document.getElementById('log-box') as HTMLElement;

function addLog(text: string): void {
  const line = document.createElement('div');
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${text}`;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

function updateStateBadge(state: PurchaseState): void {
  stateBadge.textContent = state;
  stateBadge.className = 'badge';

  switch (state) {
    case PurchaseState.READY:
      stateBadge.classList.add('ready');
      break;
    case PurchaseState.ARMED:
    case PurchaseState.MONITORING:
    case PurchaseState.AVAILABLE_DETECTED:
    case PurchaseState.SELECTING:
    case PurchaseState.RESERVING:
      stateBadge.classList.add('armed');
      break;
    case PurchaseState.HELD:
    case PurchaseState.CONFIRMED:
      stateBadge.classList.add('held');
      break;
    case PurchaseState.STOPPED:
    case PurchaseState.FAILED:
      stateBadge.classList.add('failed');
      break;
    default:
      break;
  }
}

async function loadInitialData(): Promise<void> {
  const config = await storage.getConfiguration();
  if (config) {
    if (config.targetEventUrl) eventUrlInput.value = config.targetEventUrl;
    if (config.preferences) {
      categoryPriorityInput.value = config.preferences.categoryPriority.join(', ');
      quantityInput.value = String(config.preferences.quantity);
      allowFallbackCheckbox.checked = config.preferences.allowFallback;
    }
  }

  const lastState = await storage.getLastState();
  if (lastState && lastState.currentState) {
    updateStateBadge(lastState.currentState);
    if (lastState.attemptId) {
      attemptIdDisplay.textContent = lastState.attemptId;
    }
  }

  // Request latest state synchronization from service worker
  await messageBus.publish({
    type: 'SYNC_STATE_REQUEST',
    timestamp: new Date().toISOString(),
  });
}

// Handle incoming events from Service Worker
messageBus.subscribe((message: ExtensionMessage) => {
  switch (message.type) {
    case 'STATE_CHANGED': {
      updateStateBadge(message.context.currentState);
      if (message.context.attemptId) {
        attemptIdDisplay.textContent = message.context.attemptId;
      }
      addLog(`State changed -> ${message.context.currentState}`);
      break;
    }

    case 'SYNC_STATE_RESPONSE': {
      updateStateBadge(message.context.currentState);
      if (message.context.attemptId) {
        attemptIdDisplay.textContent = message.context.attemptId;
      }
      break;
    }

    case 'RESERVATION_CONFIRMED': {
      addLog(`Reservation Confirmed! ID: ${message.reservationId}`);
      break;
    }

    case 'RESERVATION_FAILED': {
      addLog(`Reservation Failed: ${message.reason}`);
      break;
    }

    default:
      break;
  }
});

btnArm.addEventListener('click', async () => {
  const url = eventUrlInput.value.trim();
  if (!url) {
    alert('Please enter a target Ticketbox event URL');
    return;
  }

  const priorities = categoryPriorityInput.value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const quantity = parseInt(quantityInput.value, 10) || 1;
  const allowFallback = allowFallbackCheckbox.checked;

  await storage.saveConfiguration({
    targetEventUrl: url,
    preferences: {
      categoryPriority: priorities,
      quantity,
      allowFallback,
    },
    discoveryMode: false,
  });

  addLog('Arming assistant...');
  await messageBus.publish({
    type: 'START_MONITORING',
    timestamp: new Date().toISOString(),
    eventUrl: url,
    attemptId: attemptIdDisplay.textContent || 'attempt_manual',
    state: PurchaseState.ARMED,
  });
});

btnStop.addEventListener('click', async () => {
  addLog('Stop requested by user.');
  await messageBus.publish({
    type: 'STOP_REQUESTED',
    timestamp: new Date().toISOString(),
    reason: 'Manual user stop via Popup UI',
  });
});

document.addEventListener('DOMContentLoaded', loadInitialData);
