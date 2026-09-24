import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { publicServiceUrls } from './public-urls';

/**
 * GET /config.js — le dice a la consola web dónde están los otros servicios
 * (en Render, cada uno en su propio dominio). Si no hay URLs configuradas,
 * devuelve un objeto vacío y la consola usa localhost con cada puerto.
 */
@ApiExcludeController()
@Controller()
export class ConsoleConfigController {
  @Get('config.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  config(): string {
    return `window.MEDIASTREAM_SERVICES = ${JSON.stringify(publicServiceUrls())};\n`;
  }
}
