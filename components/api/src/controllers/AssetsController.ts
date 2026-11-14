import { existsSync } from 'fs';

import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { Response } from 'express';

import { assetPath } from '@/services/assets';

@Controller('assets')
export class AssetsController {
  @Get(':filename')
  getAsset(@Param('filename') filename: string, @Res() res: Response): void {
    const filePath = assetPath(filename);
    if (!existsSync(filePath)) {
      throw new NotFoundException('Image not found');
    }
    res.sendFile(filePath);
  }
}
