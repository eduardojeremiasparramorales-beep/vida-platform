// Vid.a — Aprovisionar el tenant de la campaña "Sandra Suárez — Concejo Municipal".
// Uso: node scripts/aprovisionar-sandra.js
// Crea (si no existe) el negocio con vertical='campaña', la estructura de equipo de las
// anotaciones (gerente → secretario → conductor → comunicaciones → voluntariado), la
// config de campaña y un seed demo de votantes con segmentación.
const path = require('path');
const fs = require('fs');
const adapter = require('../src/db/adapter');
const store = require('../src/db/store');
const platform = require('../src/db/platform');
const vidaProvision = require('../src/services/vida-provision');
const auth = require('../src/services/auth');

const SLUG = 'sandra-concejo';
const NOMBRE = 'Campaña Sandra Suárez — Concejo Municipal';
const ADMIN = { nombre: 'Sandra Suárez', telefono: '+573001234567', pin: '0000' };

// Estructura de campaña según C:\Sandra Suarez\anotaciones.txt
const EQUIPO = [
  { nombre: 'Sandra Suárez', telefono: '+573001234567', rol: 'gerente', pin: '0000' },
  { nombre: 'Secretario/a de campaña', telefono: '+573011111111', rol: 'secretario', pin: '0000' },
  { nombre: 'Conductor público', telefono: '+573022222222', rol: 'conductor', pin: '0000' },
  { nombre: 'Equipo de comunicaciones', telefono: '+573033333333', rol: 'comunicaciones', pin: '0000' },
  { nombre: 'Comité de voluntariado', telefono: '+573044444444', rol: 'voluntariado', pin: '0000' },
];

// Votantes demo con perfil completo (ocupación, nacimiento, zona, estado de voto, referidos)
const VOTANTES_DEMO = [
  { nombre: 'María López', telefono: '+573101111111', zona: 'Zona Norte', barrio: 'La Floresta', ocupacion: 'Docente', fecha_nacimiento: '1985-03-12', estado_voto: 'comprometido', referido_por: null },
  { nombre: 'Carlos Gómez', telefono: '+573102222222', zona: 'Zona Norte', barrio: 'Villa Olímpica', ocupacion: 'Comerciante', fecha_nacimiento: '1978-11-02', estado_voto: 'simpatizante', referido_por: 1 },
  { nombre: 'Lucía Ramírez', telefono: '+573103333333', zona: 'Zona Sur', barrio: 'Ciudadela', ocupacion: 'Enfermera', fecha_nacimiento: '1990-07-25', estado_voto: 'indeciso', referido_por: 1 },
  { nombre: 'Andrés Torres', telefono: '+573104444444', zona: 'Zona Sur', barrio: 'Bosques de Pinares', ocupacion: 'Ingeniero', fecha_nacimiento: '1982-01-15', estado_voto: 'votara', referido_por: 2 },
  { nombre: 'Diana Salazar', telefono: '+573105555555', zona: 'Zona Centro', barrio: 'El Alambrado', ocupacion: 'Contadora', fecha_nacimiento: '1995-09-30', estado_voto: 'lista', referido_por: null },
];

async function main() {
  await adapter.initDB();
  await platform.initPlatformDB();

  let emp = platform.getEmpresaBySlug(SLUG);
  if (!emp) {
    emp = await vidaProvision.provisionEmpresa(NOMBRE, ADMIN, 'campaña', SLUG);
    console.log('[SANDRA] Tenant aprovisionado:', emp.id, emp.slug, 'vertical:', emp.vertical);
  } else {
    console.log('[SANDRA] Tenant ya existía:', emp.id, emp.slug);
  }

  // Todo el seed corre dentro del tenant
  await adapter.tenantContext.run({ empresaId: emp.id, dbPath: emp.db_path }, () => {
    const campanaStore = require('../src/verticales/campana/store');

    // Config de campaña
    campanaStore.setInfoCampana({
      nombre: 'Sandra Suárez',
      cargo: 'Concejal Municipal',
      eslogan: 'Una concejal de la comunidad, para la comunidad',
      zonas: ['Zona Norte', 'Zona Sur', 'Zona Centro'],
    });

    // Estructura de equipo (roles). El admin (gerente) ya existe del provision; se ajusta rol.
    for (const m of EQUIPO) {
      const existente = store.getVendedorByTelefono(m.telefono);
      if (existente) {
        adapter.run('UPDATE vendedores SET rol = ? WHERE id = ?', [m.rol, existente.id]);
        console.log('[SANDRA] equipo actualizado:', m.rol, m.nombre);
      } else {
        try {
          campanaStore.crearMiembroEquipo(m);
          console.log('[SANDRA] equipo creado:', m.rol, m.nombre);
        } catch (e) { console.log('[SANDRA] equipo skip:', m.nombre, e.message); }
      }
    }

    // Seed votantes
    const yaHay = campanaStore.countVotantes({});
    if (yaHay === 0) {
      for (const v of VOTANTES_DEMO) campanaStore.crearVotante(v);
      console.log('[SANDRA] votantes demo creados:', VOTANTES_DEMO.length);
    } else {
      console.log('[SANDRA] votantes ya existían:', yaHay);
    }
  });

  console.log('[SANDRA] Listo. Login: teléfono ' + ADMIN.telefono + ' PIN ' + ADMIN.pin + ' — slug:', SLUG);
}

main().catch(e => { console.error('[SANDRA] Error:', e.message); process.exit(1); });