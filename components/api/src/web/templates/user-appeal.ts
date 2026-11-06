import { NoticeBlock, RejectionNotice } from '@crn-flix/contracts';
import { COLORS, escapeHtml, getWebTemplate, RADIUS, TONES } from '@crn-flix/design-system';
import { Refusal } from '@crn-flix/policy';

import { ExemptionStatus } from '@/services/database/policy';

export const APPEAL_STATUS_LABELS: Record<ExemptionStatus, string> = {
  pending: 'Demande en cours d’examen',
  granted: 'Demande acceptée',
  denied: 'Demande refusée',
};

export const MOTIVATION_MIN_LENGTH = 20;
export const MOTIVATION_MAX_LENGTH = 2000;

export interface UserAppealParams {
  serviceName: string;
  basePath: string;
  imdbId: string;
  title: string;
  refusals: Refusal[];
  status: ExemptionStatus | null;
  flashMessage?: string;
}

function blockHtml(block: NoticeBlock): string {
  switch (block.type) {
    case 'paragraph':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'facts':
      return `<dl class="facts">${block.items
        .map((item) => `<dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd>`)
        .join('')}</dl>`;
    case 'links':
      return `${block.title ? `<p class="muted"><b>${escapeHtml(block.title)}</b></p>` : ''}<ul>${block.links
        .map(
          (link) =>
            `<li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a></li>`,
        )
        .join('')}</ul>`;
  }
}

const noticeHtml = (notice: RejectionNotice): string =>
  `<div class="notice"><p class="headline">${escapeHtml(notice.headline)}</p>${notice.blocks.map(blockHtml).join('')}</div>`;

const refusalHtml = (refusal: Refusal): string =>
  `<h3>Politique « ${escapeHtml(refusal.ruleName)} »</h3>${refusal.notices.map(noticeHtml).join('')}`;

const appealForm = (basePath: string, imdbId: string): string => `
  <form method="POST" action="${escapeHtml(`${basePath}/policy/${encodeURIComponent(imdbId)}/appeal`)}" class="appeal-form">
    <h3>Faire appel</h3>
    <label><input type="radio" name="kind" value="contest" required /> <b>Contester</b> : la règle s’applique à tort (erreur de personne, de titre…)</label>
    <label><input type="radio" name="kind" value="exemption" /> <b>Demander une dérogation</b> : la règle s’applique, mais vous avez une raison de voir ce titre (travail scolaire, recherche…)</label>
    <label for="motivation">Votre motivation</label>
    <textarea id="motivation" name="motivation" rows="5" required minlength="${MOTIVATION_MIN_LENGTH}" maxlength="${MOTIVATION_MAX_LENGTH}"
      placeholder="Expliquez en quelques phrases pourquoi."></textarea>
    <button type="submit">Envoyer à l’administrateur</button>
  </form>`;

const CSS = `
  .container { max-width: 760px; }
  h2 { margin: 24px 0 12px 0; font-size: 20px; }
  h3 { margin: 20px 0 8px 0; font-size: 16px; }
  .notice { background: ${TONES.warning.bg}; border: 1px solid ${TONES.warning.border}; border-radius: ${RADIUS.md}; padding: 12px 16px; margin-bottom: 12px; }
  .notice .headline { font-weight: 600; margin: 0 0 8px 0; }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 8px 0; }
  .facts dt { font-weight: 600; }
  .facts dd { margin: 0; }
  .muted { color: ${COLORS.textMuted}; }
  .status { background: ${TONES.info.bg}; color: ${TONES.info.text}; border: 1px solid ${TONES.info.border}; padding: 10px 14px; border-radius: ${RADIUS.md}; }
  .appeal-form label { display: block; margin: 10px 0; }
  .appeal-form textarea { width: 100%; box-sizing: border-box; }
  .appeal-form button { width: auto; margin-top: 12px; }
`;

export const userAppealTemplate = (params: UserAppealParams): string => {
  const canAppeal = params.status !== 'pending';
  const content = `
    ${params.flashMessage ? `<div class="status">${escapeHtml(params.flashMessage)}</div>` : ''}
    <p><a href="${escapeHtml(`${params.basePath}?tab=rejected`)}">← Mes demandes</a></p>
    <h2>${escapeHtml(params.title)}</h2>
    <p>Ce titre ne vous est pas proposé, en raison des politiques de contenu du service :</p>
    ${params.refusals.map(refusalHtml).join('')}
    ${params.status ? `<p class="status">${escapeHtml(APPEAL_STATUS_LABELS[params.status])}</p>` : ''}
    ${canAppeal ? appealForm(params.basePath, params.imdbId) : ''}
  `;
  return getWebTemplate(`${params.title} — ${params.serviceName}`, params.serviceName, content, CSS);
};
