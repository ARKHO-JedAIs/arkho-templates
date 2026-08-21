# Testing Guide

Este directorio contiene los tests de infraestructura CDK para {{ project_name }}.

## Estructura

```
test/
├── helpers/
│   └── setup.ts              # Configuración compartida
├── s3/                       # Tests de buckets S3
├── lambda/                   # Tests de funciones Lambda
├── dynamodb/                 # Tests de tablas DynamoDB
├── step-functions/           # Tests de workflows Step Functions
└── glue/                     # Tests de jobs Glue
```

## Quick Start

### Ejecutar todos los tests

```bash
npm test
```

### Ejecutar tests de un dominio específico

```bash
npm test -- test/s3
npm test -- test/lambda
```

### Ejecutar un archivo específico

```bash
npm test -- test/s3/templates-bucket.test.ts
```

## Crear nuevos tests

1. Identifica el dominio AWS del recurso (s3, lambda, dynamodb, etc.)
2. Crea el archivo en `test/[dominio]/[recurso].test.ts`
3. Importa el helper de setup:

```typescript
import { getTemplate } from '../helpers/setup';

describe('Nombre del Recurso', () => {
  test('comportamiento específico', () => {
    getTemplate().hasResourceProperties('AWS::Service::Resource', {
      // propiedades esperadas
    });
  });
});
```

## Helpers disponibles

### `getTemplate()`
Retorna el Template de CDK para hacer assertions. El template está cacheado para mejorar performance.

Los nombres de recursos siguen la convencion `${projectName}-${envName}-<name>`,
asi que derivalos desde `TEST_PARAMS` en lugar de hardcodearlos:

```typescript
const PREFIX = `${TEST_PARAMS.projectName}-${TEST_PARAMS.envName}`;

getTemplate().hasResourceProperties('AWS::Lambda::Function', {
  FunctionName: `${PREFIX}-my-function`,
});
```

### `getResources()`
Retorna todos los recursos del stack como objeto JSON.

```typescript
const resources = getResources();
const lambdaKeys = Object.keys(resources).filter(
  k => resources[k].Type === 'AWS::Lambda::Function'
);
```

### Constantes

- `TEST_ENV`: `{ account: '123456789012', region: 'us-east-1' }`
- `TEST_PARAMS`: `{ envName: 'dev', projectName: '{{ project_name }}', isProd: false }`

## Convenciones

- **Naming**: Archivos en kebab-case: `templates-bucket.test.ts`
- **Organización**: Un archivo por recurso principal
- **Describes**: Nombre descriptivo del recurso
- **Tests**: Comenzar con verbo que describe el comportamiento

## Más información

Ver `.kiro/steering/testing-standards.md` para guía completa de convenciones y patrones.
