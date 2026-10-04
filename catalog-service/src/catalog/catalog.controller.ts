import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { CreateTitleDto } from './dto/create-title.dto';
import { ListTitlesQueryDto } from './dto/list-titles-query.dto';
import { UpdateTitleDto } from './dto/update-title.dto';

/**
 * Las escrituras son de administración. El API Gateway ya las filtra por rol;
 * esto es la segunda barrera: si la petición viene del Gateway (trae
 * x-account-id), exige x-account-role=ADMIN. Una llamada directa en
 * desarrollo, sin esas cabeceras, no se bloquea.
 */
function assertAdmin(req: Request) {
  if (req.headers['x-account-id'] && req.headers['x-account-role'] !== 'ADMIN') {
    throw new ForbiddenException('Requiere rol de administrador.');
  }
}

@ApiTags('catalog')
@Controller('api/catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // GET /api/catalog/titles
  @ApiOperation({
    summary: 'Listar catálogo de títulos',
    description:
      'Permite consultar el catálogo de títulos, filtrado por región y perfil activo (control parental).',
  })
  @ApiResponse({ status: 200, description: 'Listado de títulos disponibles.' })
  @Get('titles')
  async listTitles(@Query() query: ListTitlesQueryDto) {
    return this.catalogService.listTitles(query);
  }

  // GET /api/catalog/titles/{id}
  @ApiOperation({
    summary: 'Detalle de un título',
    description: 'Se encarga de darnos un título en específico, incluyendo temporadas y episodios.',
  })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 200, description: 'Detalle del título con sus temporadas y episodios.' })
  @ApiResponse({ status: 404, description: 'El título no existe.' })
  @Get('titles/:id')
  async getTitle(@Param('id', ParseIntPipe) id: number) {
    return this.catalogService.getTitleById(BigInt(id));
  }

  // GET /api/catalog/titles/{id}/availability
  @ApiOperation({
    summary: 'Disponibilidad regional de un título',
    description: 'Consulta la disponibilidad regional vigente de un título.',
  })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 200, description: 'Regiones y fechas de disponibilidad.' })
  @ApiResponse({ status: 404, description: 'El título no existe.' })
  @Get('titles/:id/availability')
  async getAvailability(@Param('id', ParseIntPipe) id: number) {
    return this.catalogService.getAvailability(BigInt(id));
  }

  // POST /api/catalog/titles
  @ApiOperation({
    summary: 'Crear un título nuevo',
    description: 'Permite la creación de nuevos títulos (uso administrativo).',
  })
  @ApiResponse({ status: 201, description: 'Título creado, en estado PENDING.' })
  @ApiResponse({ status: 400, description: 'Datos inválidos.' })
  @Post('titles')
  async createTitle(@Body() dto: CreateTitleDto, @Req() req: Request) {
    assertAdmin(req);
    return this.catalogService.createTitle(dto);
  }

  @ApiOperation({ summary: 'Editar un título (uso administrativo): datos, gratis, estado y regiones.' })
  @ApiParam({ name: 'id', example: 1 })
  @Patch('titles/:id')
  async updateTitle(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTitleDto, @Req() req: Request) {
    assertAdmin(req);
    return this.catalogService.updateTitle(BigInt(id), dto);
  }

  @ApiOperation({ summary: 'Eliminar un título (uso administrativo).' })
  @ApiParam({ name: 'id', example: 1 })
  @Delete('titles/:id')
  async deleteTitle(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    assertAdmin(req);
    return this.catalogService.deleteTitle(BigInt(id));
  }

  @ApiOperation({ summary: 'Todos los títulos en cualquier estado y región (uso administrativo).' })
  @Get('admin/titles')
  async adminListTitles(@Req() req: Request) {
    assertAdmin(req);
    return this.catalogService.adminListTitles();
  }
}
