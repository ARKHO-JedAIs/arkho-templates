import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DatalakeConfig } from './environments';

/**
 * Etiquetado transversal del data lake. Fuente única de verdad: este es el ÚNICO
 * archivo del proyecto que llama a `cdk.Tags.of(...)`.
 *
 * Los tags se aplican a nivel de app, así que llegan a todo recurso etiquetable de
 * todos los stacks. Ver `UNTAGGABLE_TYPES` para lo que CloudFormation simplemente
 * no permite etiquetar.
 */

// Los tokens quedan aislados en constantes nombradas a propósito: así el parser de
// abajo no contiene tokens y se puede testear con strings arbitrarios. Si el token
// estuviera dentro de la función, un test solo podría ejercitar lo que el cliente
// respondió en la generación.

/** Valor del tag `Owner`: equipo u organización responsable de estos recursos. */
export const TAG_OWNER = '{{ tag_owner }}';

/** Tags extra del cliente, sin parsear. `''` cuando no definió ninguno. */
export const EXTRA_TAGS_RAW = '{{ extra_tags }}';

/** Claves del set base. Se aplican a todo recurso etiquetable. */
export const BASE_TAG_KEYS = ['Project', 'Client', 'Environment', 'ManagedBy', 'Owner'] as const;

/**
 * Tipos CloudFormation que NO admiten `Tags` en su schema. No es una limitación de
 * este template: la propiedad no existe, así que ni un `tags:` explícito (no
 * compila) ni un aspecto con `addPropertyOverride` (CloudFormation rechaza la
 * plantilla con "Encountered unsupported property Tags") pueden arreglarlo.
 *
 * Todos son recursos de metadata o de política, de costo cero, así que la brecha
 * no afecta la asignación de costos.
 *
 * Esta lista es el contrato que verifica `test/tagging.test.ts`: si agregas un
 * recurso de un tipo nuevo que no se puede etiquetar, el test falla hasta que lo
 * clasifiques acá — así la brecha no puede crecer en silencio.
 */
export const UNTAGGABLE_TYPES: readonly string[] = [
  // Glue no expone tagging para bases del catálogo ni security configurations.
  'AWS::Glue::Database',
  'AWS::Glue::SecurityConfiguration',
  // Lake Formation no admite tags en ninguno de sus recursos.
  'AWS::LakeFormation::Tag',
  'AWS::LakeFormation::Resource',
  'AWS::LakeFormation::DataLakeSettings',
  // Políticas y recursos accesorios.
  'AWS::IAM::Policy',
  'AWS::S3::BucketPolicy',
  'AWS::SQS::QueuePolicy',
  'AWS::SNS::Subscription',
  'AWS::SNS::TopicPolicy',
  'AWS::KMS::Alias',
  'AWS::Lambda::Permission',
  'AWS::SecretsManager::ResourcePolicy',
  'AWS::Events::EventBusPolicy',
  // Solo en la ruta con VPC habilitada.
  'AWS::EC2::Route',
  'AWS::EC2::SubnetRouteTableAssociation',
  'AWS::EC2::VPCGatewayAttachment',
  // Generados por CDK, no por este código.
  'AWS::CDK::Metadata',
  'Custom::S3AutoDeleteObjects',
];

/**
 * Recursos que SÍ admiten tags pero que CDK genera por fuera del árbol de
 * constructs, así que el aspecto de tagging no los alcanza.
 *
 * `CustomResourceProvider` (el mecanismo detrás de `autoDeleteObjects`) crea su
 * rol y su Lambda como un singleton por stack que no participa del tagging. No hay
 * hook público para etiquetarlos. Solo aparecen cuando `autoDeleteObjects: true`,
 * es decir únicamente en `dev`, y la Lambda solo se ejecuta al destruir el stack.
 *
 * Se identifican por prefijo de logical ID, no por tipo: excluir
 * `AWS::IAM::Role` y `AWS::Lambda::Function` completos dejaría sin verificar los
 * roles y las Lambdas que este proyecto sí controla.
 */
export const UNTAGGED_CDK_SINGLETON_PREFIXES: readonly string[] = [
  'CustomS3AutoDeleteObjects',
];

// AWS acepta en tags: letras, dígitos, espacios y + - = . _ : / @ — y "letras"
// incluye acentuadas (la validación de AWS es `\p{L}`), así que `Compañía` y
// `Diseño` son válidos y NO deben mutilarse. El rango À-ÿ cubre el latín
// extendido; se escribe explícito en vez de `\p{L}` para que la misma clase de
// caracteres se pueda usar en el `pattern` del manifest, que el CLI compila sin
// el flag `u`.
const LATIN = 'A-Za-z\\u00C0-\\u024F';
/** Clave de tag: sin `=` ni `,`, que son los separadores del CSV. */
const TAG_KEY_RE = new RegExp(`^[${LATIN}0-9 +._:/@-]{1,128}$`);
/** Valor de tag: admite `=` porque el parser corta en el primero. */
const TAG_VALUE_RE = new RegExp(`^[${LATIN}0-9 +=._:/@-]{1,256}$`);
/** Caracteres a reemplazar en un valor libre para que AWS lo acepte. */
const INVALID_TAG_VALUE_CHARS = new RegExp(`[^${LATIN}0-9 +=._:/@-]`, 'g');
/** Prefijo reservado por AWS: no se puede usar en tags propios. */
const RESERVED_PREFIX_RE = /^aws:/i;
/** Máximo de tags por recurso que impone AWS. */
const MAX_TAGS = 50;

// Copia local del helper de `environments.ts` (donde es privado del módulo). Si
// alguna vez se exporta desde allá, unificar.
const csv = (value: string): string[] =>
  value.split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Ajusta un valor libre a lo que AWS acepta en un tag.
 *
 * Necesario porque el `pattern` de `client_name` permite `&`, `#`, paréntesis y
 * acentos —legítimos en prosa y descripciones— que AWS RECHAZA en valores de tag.
 * Sin esto, un cliente llamado "Acme & Sons" produce un deploy fallido después de
 * que synth y cdk-nag pasaron.
 */
export function sanitizeTagValue(value: string): string {
  return value.replace(INVALID_TAG_VALUE_CHARS, '-').slice(0, 256);
}

/** Set base de tags para un ambiente. */
export function baseTags(cfg: DatalakeConfig): Record<string, string> {
  return {
    Project: '{{ project_slug }}',
    Client: sanitizeTagValue('{{ client_name }}'),
    Environment: cfg.envName,
    ManagedBy: 'cdk',
    Owner: TAG_OWNER,
  };
}

/**
 * Parsea el CSV `key=value` de tags extra.
 *
 * Falla rápido en vez de omitir en silencio: un `cost-center` perdido es invisible
 * hasta que finanzas nota un mes de gasto sin asignar. Como el valor viene bakeado
 * en la generación, el error aparece en el primer `build && synth`.
 *
 * Estas validaciones NO son redundantes con el `pattern` del manifest: ese corre
 * una sola vez, en la generación. Después esto es un proyecto TypeScript normal
 * que alguien va a editar, incluido `EXTRA_TAGS_RAW`.
 */
export function parseExtraTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const baseLower = new Set(BASE_TAG_KEYS.map((k) => k.toLowerCase()));

  for (const item of csv(raw)) {
    const eq = item.indexOf('=');
    if (eq <= 0) {
      throw new Error(`extra_tags: '${item}' no tiene el formato 'clave=valor'.`);
    }
    const key = item.slice(0, eq).trim();
    const value = item.slice(eq + 1).trim();

    if (!TAG_KEY_RE.test(key)) {
      throw new Error(
        `extra_tags: clave inválida '${key}'. Máximo 128 caracteres de ` +
          'letras (acentos incluidos), dígitos, espacios y + - . _ : / @',
      );
    }
    if (!TAG_VALUE_RE.test(value)) {
      throw new Error(
        `extra_tags: valor inválido para '${key}'. Máximo 256 caracteres de ` +
          'letras, dígitos, espacios y + - = . _ : / @ (y no puede ir vacío)',
      );
    }
    if (RESERVED_PREFIX_RE.test(key)) {
      throw new Error(`extra_tags: el prefijo 'aws:' está reservado por AWS ('${key}').`);
    }
    if (key in tags) {
      throw new Error(`extra_tags: clave duplicada '${key}'.`);
    }
    // El set base y los extras se aplican con la misma prioridad, así que un
    // extra homónimo sobrescribiría en silencio.
    if (baseLower.has(key.toLowerCase())) {
      throw new Error(
        `extra_tags: '${key}' colisiona con una clave del set base ` +
          `(${BASE_TAG_KEYS.join(', ')}). Usa otro nombre.`,
      );
    }
    tags[key] = value;
  }

  const total = BASE_TAG_KEYS.length + Object.keys(tags).length;
  if (total > MAX_TAGS) {
    throw new Error(
      `extra_tags: ${total} tags en total supera el máximo de ${MAX_TAGS} por ` +
        `recurso que impone AWS (${BASE_TAG_KEYS.length} del set base + ` +
        `${Object.keys(tags).length} extra).`,
    );
  }
  return tags;
}

/**
 * Aplica el set base más los tags extra a todo lo que cuelgue de `scope`.
 *
 * `extras` es un parámetro con default para que los tests puedan inyectar valores
 * arbitrarios; en producción se llama con un solo argumento.
 */
export function applyStandardTags(
  scope: Construct,
  cfg: DatalakeConfig,
  extras: Record<string, string> = parseExtraTags(EXTRA_TAGS_RAW),
): void {
  for (const [key, value] of Object.entries({ ...baseTags(cfg), ...extras })) {
    cdk.Tags.of(scope).add(key, value);
  }
}
