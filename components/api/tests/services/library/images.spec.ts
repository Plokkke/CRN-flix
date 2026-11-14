import * as path from 'path';

import { BundledShelfImages } from '@/services/library/images';

describe('BundledShelfImages', () => {
  const files: Record<string, Uint8Array> = { 'kids-movies.jpg': new Uint8Array([1]) };
  const build = () => {
    const readFile = jest.fn(async (file: string) => {
      const data = files[path.basename(file)];
      if (!data) {
        throw new Error('ENOENT');
      }
      return data;
    });
    return { readFile, images: new BundledShelfImages('/assets/libraries', readFile) };
  };

  it("takes the picture of the shelf and section, never another section's, and reads it once", async () => {
    const { readFile, images } = build();

    await expect(images.of('kids', 'movies')).resolves.toEqual({
      data: files['kids-movies.jpg'],
      contentType: 'image/jpeg',
    });
    await images.of('kids', 'movies');
    await expect(images.of('kids', 'series')).resolves.toBeUndefined();

    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it('bundles a picture per shelf and section with the engine', async () => {
    const bundled = new BundledShelfImages(path.join(__dirname, '../../../src/assets/libraries'));

    for (const shelf of ['standard', 'kids', 'personal']) {
      for (const section of ['movies', 'series'] as const) {
        await expect(bundled.of(shelf, section)).resolves.toMatchObject({ contentType: 'image/jpeg' });
      }
    }
  });
});
