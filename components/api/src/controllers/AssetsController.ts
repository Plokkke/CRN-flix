import { existsSync } from 'fs';
import { join } from 'path';

import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { Response } from 'express';

@Controller('assets')
export class AssetsController {
  @Get(':filename')
  getAsset(@Param('filename') filename: string, @Res() res: Response): void {
    const filePath = join(process.cwd(), 'src', 'assets', filename);
    if (!existsSync(filePath)) {
      throw new NotFoundException('Image not found');
    }
    res.sendFile(filePath);
  }
}
