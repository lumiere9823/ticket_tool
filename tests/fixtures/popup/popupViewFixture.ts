export function createPopupViewFixture(): {
  root: HTMLElement;
  ticketsBody: HTMLTableSectionElement;
  emptyState: HTMLElement;
  tableWrapper: HTMLElement;
  matrixBody: HTMLTableSectionElement;
  stateBadge: HTMLElement;
  currentStepDisplay: HTMLElement;
  blockingReasonContainer: HTMLElement;
  blockingReasonText: HTMLElement;
  interventionBanner: HTMLElement;
  armButton: HTMLButtonElement;
  basicArmButton: HTMLButtonElement;
} {
  const root = document.createElement('main');
  const element = <T extends HTMLElement>(tag: string): T => document.createElement(tag) as T;
  const ticketsBody = element<HTMLTableSectionElement>('tbody');
  const emptyState = element('div');
  const tableWrapper = element('div');
  const matrixBody = element<HTMLTableSectionElement>('tbody');
  const stateBadge = element('span');
  const currentStepDisplay = element('strong');
  const blockingReasonContainer = element('div');
  const blockingReasonText = element('p');
  const interventionBanner = element('div');
  const armButton = element<HTMLButtonElement>('button');
  const basicArmButton = element<HTMLButtonElement>('button');

  root.append(
    ticketsBody,
    emptyState,
    tableWrapper,
    matrixBody,
    stateBadge,
    currentStepDisplay,
    blockingReasonContainer,
    blockingReasonText,
    interventionBanner,
    armButton,
    basicArmButton
  );
  document.body.replaceChildren(root);

  return {
    root,
    ticketsBody,
    emptyState,
    tableWrapper,
    matrixBody,
    stateBadge,
    currentStepDisplay,
    blockingReasonContainer,
    blockingReasonText,
    interventionBanner,
    armButton,
    basicArmButton,
  };
}
