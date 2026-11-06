import { NoticeBlock, PolicyRefusal, ServiceIdentity } from '@crn-flix/contracts';
import { BUTTONS, escapeHtml, getEmailTemplate, getInfoBox, TYPOGRAPHY } from '@crn-flix/design-system';

const titleOf = (refusal: PolicyRefusal): string =>
  refusal.year ? `${refusal.title} (${refusal.year})` : refusal.title;

function blockHtml(block: NoticeBlock): string {
  switch (block.type) {
    case 'paragraph':
      return `<p style="${TYPOGRAPHY.body}">${escapeHtml(block.text)}</p>`;
    case 'facts':
      return `<p style="${TYPOGRAPHY.body}">${block.items
        .map((item) => `<strong>${escapeHtml(item.label)} :</strong> ${escapeHtml(item.value)}`)
        .join('<br>')}</p>`;
    case 'links':
      return `${block.title ? `<p style="${TYPOGRAPHY.small}"><strong>${escapeHtml(block.title)}</strong></p>` : ''}
        <ul style="${TYPOGRAPHY.small}">${block.links
          .map(
            (link) =>
              `<li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a></li>`,
          )
          .join('')}</ul>`;
  }
}

function blockText(block: NoticeBlock): string[] {
  switch (block.type) {
    case 'paragraph':
      return [block.text];
    case 'facts':
      return block.items.map((item) => `${item.label} : ${item.value}`);
    case 'links':
      return [...(block.title ? [block.title] : []), ...block.links.map((link) => `- ${link.label} : ${link.url}`)];
  }
}

function refusalHtml(refusal: PolicyRefusal): string {
  const policies = refusal.policies
    .map(
      (policy) => `
      <h3 style="${TYPOGRAPHY.h3}">Politique « ${escapeHtml(policy.name)} »</h3>
      ${policy.notices
        .map(
          (notice) =>
            getInfoBox(
              `<p style="${TYPOGRAPHY.body} margin: 0;"><strong>${escapeHtml(notice.headline)}</strong></p>`,
              'warning',
            ) + notice.blocks.map(blockHtml).join(''),
        )
        .join('')}`,
    )
    .join('');
  const appeal = refusal.appealUrl
    ? `<p style="text-align: center; margin: 20px 0 8px 0;"><a href="${escapeHtml(refusal.appealUrl)}" style="${BUTTONS.primary}" target="_blank" rel="noopener noreferrer">Contester ou demander une dérogation</a></p>`
    : '';
  return `<h2 style="${TYPOGRAPHY.h2}">${escapeHtml(titleOf(refusal))}</h2>${policies}${appeal}`;
}

function refusalText(refusal: PolicyRefusal): string[] {
  return [
    titleOf(refusal),
    ...refusal.policies.flatMap((policy) => [
      `Politique « ${policy.name} »`,
      ...policy.notices.flatMap((notice) => [notice.headline, ...notice.blocks.flatMap(blockText)]),
    ]),
    ...(refusal.appealUrl ? [`Contester ou demander une dérogation : ${refusal.appealUrl}`] : []),
    '',
  ];
}

/** One email for every title refused to the user in a batch, each with the wording of the policies that refused it. */
export const policyRefusalTemplate = (
  identity: ServiceIdentity,
  userName: string,
  refusals: PolicyRefusal[],
): { subject: string; html: string; text: string } => {
  const subject =
    refusals.length === 1
      ? `🚫 Demande refusée : ${titleOf(refusals[0])}`
      : `🚫 ${refusals.length} demandes refusées sur ${identity.serviceName}`;
  const service = escapeHtml(identity.serviceName);
  const content = `
    <h1 style="${TYPOGRAPHY.h1}">🚫 ${refusals.length === 1 ? 'Une demande refusée' : 'Des demandes refusées'}</h1>
    <p style="${TYPOGRAPHY.body}">Bonjour ${escapeHtml(userName)},</p>
    <p style="${TYPOGRAPHY.body}">${service} ne propose pas ${refusals.length === 1 ? 'ce titre' : 'ces titres'}, en raison de ses politiques de contenu :</p>
    ${refusals.map(refusalHtml).join('')}
    <p style="${TYPOGRAPHY.small}">Vos demandes et leur état : <a href="${escapeHtml(identity.userSpaceUrl)}">votre espace</a>.</p>
    <p style="${TYPOGRAPHY.muted}">L'équipe ${service}</p>
  `;
  const text = [
    `Bonjour ${userName},`,
    '',
    `${identity.serviceName} ne propose pas ${refusals.length === 1 ? 'ce titre' : 'ces titres'}, en raison de ses politiques de contenu :`,
    '',
    ...refusals.flatMap(refusalText),
    `Vos demandes et leur état : ${identity.userSpaceUrl}`,
    '',
    `L'équipe ${identity.serviceName}`,
  ].join('\n');
  return { subject, html: getEmailTemplate(subject, identity.serviceName, content), text };
};
