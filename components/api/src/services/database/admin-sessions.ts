import { SessionsRepository } from '@/services/database/sessions';

/** Admin dashboard sessions; the subject is the admin's Discord user id. */
export class AdminSessionsRepository extends SessionsRepository {
  protected readonly table = 'admin_sessions';
  protected readonly subjectColumn = 'discord_user_id';
}
