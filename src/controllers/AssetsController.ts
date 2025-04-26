import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';

@Controller('assets')
export class AssetsController {
  @Get(':filename')
  getAsset(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = join(process.cwd(), 'src', 'assets', filename);
    if (!existsSync(filePath)) {
      throw new NotFoundException('Image not found');
    }
    return res.sendFile(filePath);
  }
}
