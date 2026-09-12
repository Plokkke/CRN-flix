import { renderRichText } from '@/services/messaging/user/email/templates/email-styles';

describe('renderRichText', () => {
  it('turns markdown links into anchors', () => {
    expect(renderRichText('[Telecharger](https://dl.test/a?b=1&c=2)')).toBe(
      '<a href="https://dl.test/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">Telecharger</a>',
    );
  });

  it('turns bare urls into anchors and keeps the surrounding text', () => {
    expect(renderRichText('Lien soumis : https://dl.test/file ok')).toBe(
      'Lien soumis : <a href="https://dl.test/file" target="_blank" rel="noopener noreferrer">https://dl.test/file</a> ok',
    );
  });

  it('still escapes html', () => {
    expect(renderRichText('<b>x</b> & "y"')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
  });
});
