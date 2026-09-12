import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { SessionAuthRedirectFilter } from '@/filters/session-auth-redirect.filter';
import { AdminSessionGuard } from '@/guards/admin-session.guard';
import { ContextService } from '@/services/context';
import { TicketsRepository } from '@/services/database/tickets';
import { adminTicketDetailTemplate } from '@/services/messaging/user/email/templates/admin-ticket-detail';
import {
  adminTicketsTemplate,
  TicketListFilter,
  TicketListItem,
} from '@/services/messaging/user/email/templates/admin-tickets';
import { TicketContextLoader } from '@/services/tickets/context';
import { isDeadLetter, TicketEntity, TicketOperation } from '@/services/tickets/model';
import { buildTicketView } from '@/services/tickets/presenter';
import { TicketService } from '@/services/tickets/ticket.service';

const RECENTLY_CLOSED_LIMIT = 50;

function parseOperation(op: string | undefined, value: string | undefined): TicketOperation | null {
  switch (op) {
    case 'approve':
    case 'reject':
    case 'restore':
      return { kind: op };
    case 'submitImdb':
      return value ? { kind: 'submitImdb', imdbId: value.trim() } : null;
    case 'submitLink':
      return value ? { kind: 'submitLink', url: value.trim() } : null;
    case 'resolveManually':
      return value ? { kind: 'resolveManually', note: value.trim() } : null;
    default:
      return null;
  }
}

@Controller('admin/tickets')
@UseGuards(AdminSessionGuard)
@UseFilters(SessionAuthRedirectFilter)
export class TicketsAdminController {
  constructor(
    private readonly contextService: ContextService,
    private readonly tickets: TicketsRepository,
    private readonly ticketService: TicketService,
    private readonly contextLoader: TicketContextLoader,
  ) {}

  @Get()
  @Header('content-type', 'text/html')
  async list(@Query('filter') filterParam?: string, @Query('message') message?: string): Promise<string> {
    const filter: TicketListFilter = filterParam === 'dead-letter' || filterParam === 'closed' ? filterParam : 'open';

    const tickets = await this.loadTickets(filter);
    const items: TicketListItem[] = [];
    for (const ticket of tickets) {
      items.push({ ticket, view: buildTicketView(ticket, await this.contextLoader.load(ticket)) });
    }

    return adminTicketsTemplate({ serviceName: this.contextService.name, filter, items, flashMessage: message });
  }

  private async loadTickets(filter: TicketListFilter): Promise<TicketEntity[]> {
    if (filter === 'closed') {
      return this.tickets.listRecentlyClosed(RECENTLY_CLOSED_LIMIT);
    }
    const open = await this.tickets.listOpen();
    return filter === 'dead-letter' ? open.filter(isDeadLetter) : open;
  }

  @Get(':id')
  @Header('content-type', 'text/html')
  async detail(@Param('id') id: string, @Query('message') message?: string): Promise<string> {
    const ticket = await this.tickets.get(id);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }

    return adminTicketDetailTemplate({
      serviceName: this.contextService.name,
      ticket,
      view: buildTicketView(ticket, await this.contextLoader.load(ticket)),
      events: await this.tickets.listEvents(id),
      flashMessage: message,
    });
  }

  @Post(':id/op')
  async applyOperation(
    @Param('id') id: string,
    @Body('op') op: string | undefined,
    @Body('value') value: string | undefined,
    @Body('returnTo') returnTo: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Only same-site paths: a form field must not become an open redirect.
    const back = returnTo?.startsWith('/admin') ? returnTo : null;
    const operation = parseOperation(op, value);
    if (!operation) {
      res.redirect(`${back ?? `/admin/tickets/${id}`}?message=${encodeURIComponent('Opération invalide')}`);
      return;
    }

    const adminUserId = (req as Request & { adminUserId?: string }).adminUserId ?? 'unknown';
    const outcome = await this.ticketService.applyOperation(id, operation, `dashboard:${adminUserId}`);

    const target = back ?? (outcome.status === 'resolved' ? '/admin/tickets' : `/admin/tickets/${id}`);
    res.redirect(`${target}${target.includes('?') ? '&' : '?'}message=${encodeURIComponent(outcome.message)}`);
  }
}
