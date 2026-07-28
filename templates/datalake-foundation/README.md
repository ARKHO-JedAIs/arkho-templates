# {{ project_name }} — Datalake Foundation

Infraestructura fundacional del datalake en AWS CDK (TypeScript) para el entorno **{{ environment }}**.

## Arquitectura

```
{{ bucket_prefix }}-{{ environment }}-raw        ← ingesta cruda (retención {{ raw_retention_days }} días)
{{ bucket_prefix }}-{{ environment }}-curated    ← datos transformados / silver
{{ bucket_prefix }}-{{ environment }}-analytics  ← datos optimizados / gold
{{ bucket_prefix }}-{{ environment }}-archive    ← retención Glacier ({{ archive_retention_years }} años)
```

Todos los buckets tienen:
- Cifrado S3-Managed (SSE-S3)
- Acceso público bloqueado
- SSL obligatorio
- Versionado habilitado
- Política de retención `RETAIN` (no se eliminan al hacer `cdk destroy`)

## Módulos opcionales

| Módulo            | Habilitado      |
|-------------------|-----------------|
| Glue Data Catalog | {{ enable_glue_catalog }} |
| Athena Workgroup  | {{ enable_athena }} |
| Lake Formation    | {{ enable_lake_formation }} |
| VPC               | {{ enable_vpc }} |

## Requisitos

- Node.js ≥ 18
- AWS CLI configurado con permisos suficientes
- AWS CDK v2 (`npm install -g aws-cdk`)

## Primeros pasos

```bash
npm install
npm run build

# Bootstrap de CDK (solo la primera vez por cuenta/región)
cdk bootstrap aws://{{ aws_account_id }}/{{ aws_region }}

# Ver el plan de cambios
cdk diff {{ project_name }}-datalake-{{ environment }}

# Desplegar
cdk deploy {{ project_name }}-datalake-{{ environment }}
```

## Contexto CDK

Los parámetros se pasan como contexto en `cdk.json`. Para sobreescribir en tiempo de ejecución:

```bash
cdk deploy -c rawRetentionDays=180
```

## Contacto / alertas

Administrador: **{{ admin_email }}**
