import { SessionsRepository } from '@/services/database/sessions';

/** Subscriber space sessions; the subject is the users.id of the subscriber. */
export class UserSessionsRepository extends SessionsRepository {
  protected readonly table = 'user_sessions';
  protected readonly subjectColumn = 'user_id';
}
