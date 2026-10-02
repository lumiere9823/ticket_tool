import { TicketCatalogSnapshot, TicketOption } from '../../domain/entities/PurchasePlan';
import { ScopedPurchasePlan } from '../../domain/entities/ScopedPurchasePlan';

interface MatrixShowing {
  id: string | null;
  name: string | null;
  date: string | null;
  tickets?: TicketOption[];
}

export interface PopupMatrixRendererOptions {
  ticketsBody: HTMLElement;
  emptyState: HTMLElement;
  tableWrapper: HTMLElement;
  matrixBody: HTMLElement;
  getScopedPlan: () => ScopedPurchasePlan;
  formatPrice: (price: number) => string;
  onMatrixChange: () => void;
}

export class PopupMatrixRenderer {
  constructor(private readonly options: PopupMatrixRendererOptions) {}

  renderCatalogTable(tickets: TicketOption[]): void {
    if (!tickets || tickets.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'empty-cell';
      cell.textContent = 'No tickets discovered yet';
      row.appendChild(cell);
      this.options.ticketsBody.replaceChildren(row);
      return;
    }

    this.options.ticketsBody.replaceChildren();
    for (const ticket of tickets) {
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.textContent = ticket.name;

      const priceCell = document.createElement('td');
      priceCell.textContent = this.options.formatPrice(ticket.price);

      const modeCell = document.createElement('td');
      modeCell.textContent = ticket.mode;

      const availabilityCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'status-badge';
      badge.textContent = ticket.availability;
      if (ticket.availability === 'AVAILABLE') badge.classList.add('status-available');
      else if (ticket.availability === 'SOLD_OUT') badge.classList.add('status-soldout');
      else badge.classList.add('status-unknown');
      availabilityCell.appendChild(badge);

      row.append(nameCell, priceCell, modeCell, availabilityCell);
      this.options.ticketsBody.appendChild(row);
    }
  }

  renderScopedMatrix(snapshot: TicketCatalogSnapshot): void {
    if (!snapshot.showings || snapshot.showings.length === 0) {
      if (snapshot.tickets && snapshot.tickets.length > 0) {
        this.renderMatrixWithShowings(
          [
            {
              id: 'default',
              name: snapshot.eventTitle || 'Suất diễn mặc định',
              date: null,
              tickets: snapshot.tickets,
            },
          ],
          snapshot
        );
        return;
      }
      this.options.emptyState.style.display = 'block';
      this.options.tableWrapper.style.display = 'none';
      return;
    }

    this.renderMatrixWithShowings(snapshot.showings, snapshot);
  }

  private renderMatrixWithShowings(
    showings: MatrixShowing[],
    snapshot: TicketCatalogSnapshot
  ): void {
    this.options.emptyState.style.display = 'none';
    this.options.tableWrapper.style.display = 'block';
    this.options.matrixBody.replaceChildren();

    showings.forEach((showing, index) => {
      const showingId = showing.id ?? `showing-${index}`;
      const showingName = showing.name ?? showing.date ?? `Suất ${index + 1}`;
      const existingTarget = this.options
        .getScopedPlan()
        .targets.find((target) => target.showingId === showingId);
      const rank = existingTarget?.rank ?? index + 1;
      const selectedTicketIds = new Set(existingTarget?.ticketTypeIds ?? []);

      const row = document.createElement('tr');
      row.dataset.showingId = showingId;

      const rankCell = document.createElement('td');
      const rankInput = document.createElement('input');
      rankInput.type = 'number';
      rankInput.min = '1';
      rankInput.max = '20';
      rankInput.value = String(rank);
      rankInput.className = 'rank-input';
      rankInput.addEventListener('change', this.options.onMatrixChange);
      rankCell.appendChild(rankInput);

      const showingCell = document.createElement('td');
      const showingTitle = document.createElement('strong');
      showingTitle.textContent = showingName;
      showingCell.appendChild(showingTitle);
      if (showing.date && showing.date !== showing.name) {
        const dateSub = document.createElement('div');
        dateSub.style.fontSize = '10px';
        dateSub.style.color = 'var(--text-muted)';
        dateSub.textContent = showing.date;
        showingCell.appendChild(dateSub);
      }

      const ticketsCell = document.createElement('td');
      ticketsCell.className = 'tier-checkboxes-cell';
      const tickets =
        showing.tickets && showing.tickets.length > 0 ? showing.tickets : snapshot.tickets;
      if (!tickets || tickets.length === 0) {
        ticketsCell.textContent = 'Chưa có loại vé';
      } else {
        tickets.forEach((ticket) => {
          const ticketId = ticket.id ?? ticket.name;
          const label = document.createElement('label');
          label.className = 'tier-checkbox-item';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.value = ticketId;
          checkbox.dataset.ticketName = ticket.name;
          checkbox.checked = selectedTicketIds.has(ticketId) || selectedTicketIds.has(ticket.name);
          checkbox.addEventListener('change', this.options.onMatrixChange);

          const name = document.createElement('span');
          name.textContent = ticket.name;

          const price = document.createElement('span');
          price.className = 'tier-price-tag';
          price.textContent = `(${this.options.formatPrice(ticket.price)})`;

          label.append(checkbox, name, price);
          if (ticket.availability === 'SOLD_OUT') {
            const soldBadge = document.createElement('span');
            soldBadge.className = 'badge-mini';
            soldBadge.style.color = '#f87171';
            soldBadge.textContent = 'Hết vé';
            label.appendChild(soldBadge);
          }
          ticketsCell.appendChild(label);
        });
      }

      row.append(rankCell, showingCell, ticketsCell);
      this.options.matrixBody.appendChild(row);
    });
  }
}
