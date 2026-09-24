import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { CreateTitleDto } from './dto/create-title.dto';
import { ListTitlesQueryDto } from './dto/list-titles-query.dto';

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
  async createTitle(@Body() dto: CreateTitleDto) {
    return this.catalogService.createTitle(dto);
  }
}
