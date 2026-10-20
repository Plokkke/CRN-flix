import { TraktApi } from '@crn-flix/catalog-trakt';
import { TraktPlugin } from '@crn-flix/player-jellyfin';

import { UsersController } from '@/controllers/UsersController';
import { ContextService } from '@/services/context';
import { UsersRepository } from '@/services/database/users';
import { TicketService } from '@/services/tickets/ticket.service';

function build() {
  const users = {
    existsByName: jest.fn().mockResolvedValue(false),
    createFromMessagingInfos: jest.fn().mockResolvedValue({ id: 'u1', name: 'newcomer' }),
  };
  const tickets = { open: jest.fn().mockResolvedValue(undefined) };
  const controller = new UsersController(
    { name: 'CRN-Flix' } as ContextService,
    users as unknown as UsersRepository,
    tickets as unknown as TicketService,
    {} as TraktApi,
    {} as TraktPlugin,
  );
  return { users, tickets, controller };
}

const form = { email: 'newcomer@example.test', username: 'newcomer' };

describe('UsersController registration', () => {
  it('answers with a confirmation page once the approval ticket is open', async () => {
    const { tickets, controller } = build();

    const page = await controller.handleRegistration(form);

    expect(tickets.open).toHaveBeenCalled();
    expect(page).toContain('<!DOCTYPE html>');
    expect(page).toContain('Demande envoyée');
  });

  it('explains a refusal and links back to the form', async () => {
    const { users, tickets, controller } = build();
    users.existsByName.mockResolvedValue(true);

    const page = await controller.handleRegistration(form);

    expect(tickets.open).not.toHaveBeenCalled();
    expect(page).toContain('Ce pseudo est déjà utilisé');
    expect(page).toContain('href="/users/form"');
  });

  it('shows the validation messages instead of a raw error', async () => {
    const { controller } = build();

    const page = await controller.handleRegistration({ email: 'nope', username: 'ab' });

    expect(page).toContain('Email invalide');
    expect(page).toContain('au moins 3 caractères');
  });

  it('turns an unexpected failure into a failure page', async () => {
    const { users, controller } = build();
    users.createFromMessagingInfos.mockRejectedValue(new Error('db down'));

    const page = await controller.handleRegistration(form);

    expect(page).toContain('Une erreur est survenue');
    expect(page).not.toContain('db down');
  });
});
