#!/usr/bin/env node

/**
 * SP CRM — Validador de Configuración .env
 *
 * Uso: node validate-env.js
 *
 * Verifica que:
 * - .env existe
 * - Todas las variables requeridas están presentes
 * - Formatos son correctos
 * - Token de Meta es válido (intenta conexión)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Colores para terminal
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

const log = {
    info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    section: (msg) => console.log(`\n${colors.bright}${colors.cyan}═══ ${msg} ═══${colors.reset}\n`),
};

// Variables requeridas
const REQUIRED_VARS = {
    WHATSAPP_TOKEN: {
        pattern: /^EAA[a-zA-Z0-9]+$/,
        minLength: 50,
        description: 'Token de Meta (debe empezar con "EAA")',
    },
    PHONE_NUMBER_ID: {
        pattern: /^\d{10,}$/,
        minLength: 10,
        description: 'ID de número de teléfono (solo dígitos)',
    },
    WHATSAPP_BUSINESS_ACCOUNT_ID: {
        pattern: /^[a-zA-Z0-9_]+$/,
        minLength: 5,
        description: 'ID de cuenta comercial',
    },
    VERIFY_TOKEN: {
        pattern: /^.{20,}$/,
        minLength: 20,
        description: 'Token para verificar webhook Meta (mínimo 20 caracteres)',
    },
    APP_SECRET: {
        pattern: /^.{10,}$/,
        minLength: 10,
        description: 'App Secret de Meta Developers (Settings > Basic)',
    },
};

// Cargar variables de .env
function loadEnv() {
    const envPath = path.join(__dirname, '.env');

    if (!fs.existsSync(envPath)) {
        log.error(`.env no existe en: ${envPath}`);
        log.info('Crea un archivo .env basado en .env.example');
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf-8');
    const env = {};

    envContent.split('\n').forEach((line) => {
        line = line.trim();
        if (line && !line.startsWith('#')) {
            const [key, value] = line.split('=');
            if (key && value) {
                env[key.trim()] = value.trim();
            }
        }
    });

    return env;
}

// Validar una variable
function validateVariable(key, value) {
    const rules = REQUIRED_VARS[key];

    if (!rules) {
        log.warning(`Variable desconocida: ${key}`);
        return true;
    }

    if (!value || value === '') {
        log.error(`${key}: FALTA`);
        return false;
    }

    if (value.length < rules.minLength) {
        log.error(`${key}: TOO SHORT (${value.length}/${rules.minLength})`);
        return false;
    }

    if (!rules.pattern.test(value)) {
        log.error(`${key}: FORMATO INCORRECTO`);
        log.info(`  Patrón esperado: ${rules.pattern}`);
        return false;
    }

    log.success(`${key}: OK`);
    return true;
}

// Intentar conexión a Meta API
async function testMetaConnection(token, phoneNumberId, apiVersion) {
    return new Promise((resolve) => {
        log.info('Intentando conexión a Meta API...');

        const options = {
            hostname: 'graph.facebook.com',
            port: 443,
            path: `/${apiVersion}/${phoneNumberId}?fields=id,display_phone_number&access_token=${token}`,
            method: 'GET',
            timeout: 5000,
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const json = JSON.parse(data);

                    if (res.statusCode === 200 && json.id) {
                        log.success(`Conexión a Meta API exitosa`);
                        log.info(`  Número: ${json.display_phone_number}`);
                        resolve(true);
                    } else if (json.error) {
                        log.error(`Error de Meta API: ${json.error.message}`);
                        resolve(false);
                    } else {
                        log.warning(`Respuesta inesperada (status: ${res.statusCode})`);
                        resolve(false);
                    }
                } catch (e) {
                    log.warning(`No se pudo parsear respuesta de Meta`);
                    resolve(false);
                }
            });
        });

        req.on('error', (err) => {
            log.error(`Error de conexión: ${err.message}`);
            resolve(false);
        });

        req.on('timeout', () => {
            req.destroy();
            log.error(`Timeout en conexión a Meta API`);
            resolve(false);
        });

        req.end();
    });
}

// Ejecutar validación
async function main() {
    console.clear();
    log.section('SP CRM — Validador de Configuración');

    log.info('Cargando variables de .env...\n');
    const env = loadEnv();

    // Validar variables requeridas
    log.section('Validación de Variables');

    let allValid = true;
    Object.keys(REQUIRED_VARS).forEach((key) => {
        const isValid = validateVariable(key, env[key]);
        if (!isValid) allValid = false;
    });

    if (!allValid) {
        log.section('RESULTADO');
        log.error('Hay problemas en tu configuración .env');
        log.info('Soluciona los errores arriba y vuelve a ejecutar.');
        process.exit(1);
    }

    // Test de conexión a Meta
    log.section('Prueba de Conexión');
    const metaOk = await testMetaConnection(env.WHATSAPP_TOKEN, env.PHONE_NUMBER_ID, env.WHATSAPP_API_VERSION || 'v22.0');

    // Resultado final
    log.section('RESULTADO');

    if (allValid && metaOk) {
        log.success('¡TODO CORRECTO!');
        log.info('Tu configuración está lista para desplegar.');
        log.info('\nPróximos pasos:');
        log.info('1. npm install (si no lo has hecho)');
        log.info('2. npm start (para probar local)');
        log.info('3. Despliega con: docker compose up -d --build');
        process.exit(0);
    } else if (allValid && !metaOk) {
        log.warning('Variables OK, pero no se pudo conectar a Meta API.');
        log.info('Posibles causas:');
        log.info('- WHATSAPP_TOKEN expirado');
        log.info('- PHONE_NUMBER_ID incorrecto');
        log.info('- Sin conexión a internet');
        log.info('- Firewall bloqueando conexión a Meta');
        log.info('\nVerifica tus credenciales en Meta Business Suite.');
        process.exit(1);
    } else {
        log.error('Hay problemas en tu configuración.');
        process.exit(1);
    }
}

main().catch((err) => {
    log.error(`Error no esperado: ${err.message}`);
    process.exit(1);
});
