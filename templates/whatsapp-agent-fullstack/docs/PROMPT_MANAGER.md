# Prompt manager con Amazon Bedrock Prompt Management

Cómo funciona el prompt manager de este proyecto (pantalla **Configuración → Agente IA**) y cómo está armado por dentro. Viene del template `whatsapp-agent-fullstack`.

> Complementa a [ACCESS.md](ACCESS.md) (roles y permisos).

---

## 1. Qué es y para qué sirve

Es la pantalla **Configuración → Agente IA** de la web. Desde ahí se cambia **sin redesplegar**:

- **Qué sabe el agente del negocio y cómo responde:** las instrucciones (system prompt).
- **Los mensajes fijos:** saludo, fuera de tema y derivación a una persona.
- **El interruptor general del agente:** encendido o apagado para todos los chats.
- **El modelo de IA:** qué Claude usar, temperatura, largo máximo y Top P.
- **Las variables `{{...}}`** de las instrucciones y su valor.

Cada cambio pasa por **borrador → publicar**, queda en un **historial** con autor y comentario, y se puede **volver atrás**.

**Quién lo usa:** solo el rol **developer** (ver [ACCESS.md](ACCESS.md)). El admin de la empresa no lo ve.

---

## 2. La idea: dos servicios, cada uno para lo suyo

| Pieza | Dónde vive | Por qué ahí |
|---|---|---|
| Instrucciones, modelo, temperatura, largo máximo, Top P, nombres de variables | **Amazon Bedrock Prompt Management** | Es el servicio de AWS para eso. El prompt se puede ver, probar y editar en la consola de AWS igual que desde la web. |
| Quién publicó, cuándo y por qué; historial completo; versión en uso | **Tabla DynamoDB `agent-config`** | Bedrock no guarda autor ni comentario. La tabla además conserva el historial aunque alguien borre algo en la consola. |
| Saludo, fuera de tema, derivación, agente activo, valores de las variables | **Tabla `agent-config`** + **parámetro SSM** | No son parte del prompt: son mensajes de WhatsApp y la configuración del canal. |
| Reglas de seguridad fijas | **Código** (`src/agent/src/agent_core/prompt.py`) | No se editan nunca, ni desde la web ni desde la consola. Siempre ganan. |

```
                 ┌──────────────────────── Web (Agente IA) ───────────────────────┐
                 │ Guardar borrador · Publicar · Historial · Restaurar · Modelo   │
                 └───────────────────────────────┬────────────────────────────────┘
                                                 │ API /admin/agent/config/*
                                                 ▼
                                  Lambda  <prefix>-agent-config-admin
                    ┌──────────────────┬──────────────────────┬──────────────────┐
                    ▼                  ▼                      ▼                  ▼
     Bedrock Prompt Management   DynamoDB agent-config   SSM <prefix>-agent-prompt   Bedrock (lista y
     prompt <prefix>-agent       draft · v0001… ·        (lo que lee el agente)      prueba de modelos)
     DRAFT + versiones 1,2,3…    published · bedrock
                    ▲                                         │
                    │ GetPrompt(id, versión) — caché          │ cada 60 s
                    └──────────────── Agente (AgentCore) ◄────┘
```

---

## 3. Qué pasa en cada acción

| Acción | Bedrock Prompt Management | Tabla `agent-config` | Parámetro SSM (agente) |
|---|---|---|---|
| **Guardar borrador** (web) | `UpdatePrompt` → el **DRAFT** queda igual a la pantalla. La primera vez hace `CreatePrompt`. | Ítem `draft` con autor, fecha y `revision` | Nada: el agente no ve borradores |
| **Publicar** (web) | `UpdatePrompt` + **`CreatePromptVersion`** → versión **N** | Ítem `vNNNN` (con `bedrockVersion: N`), puntero `published` y borra el `draft`, en una transacción | Se reescribe con `bedrockPrompt: {id, version: N}`, mensajes, interruptor, modelo, variables y una copia de las instrucciones |
| **Activar esta versión** (Historial) | Nada nuevo: **reusa** la versión de Bedrock de esa entrada (son inmutables) | Ítem nuevo `vNNNN` con `rollbackOf` | Apunta a esa versión de Bedrock |
| **Editar en la consola de AWS** ("Save draft") | Cambia el DRAFT | — | — (el agente no cambia) |
| **Crear versión en la consola** | Versión nueva | — | — (el agente no cambia) |
| **"Traer cambios de AWS"** (web) | — | — | La web copia el DRAFT de la consola al formulario. Después se guarda o publica como siempre. |
| **"Usar esta versión"** (web, Historial) | `GetPrompt` de esa versión | Ítem nuevo `vNNNN` con `source: console` | Apunta a esa versión |

**Regla importante:** lo que usa el bot solo cambia cuando alguien **publica, activa una versión del historial o adopta una de la consola desde la web**. Una versión creada en la consola queda disponible, pero no se activa sola. Así cada cambio del bot tiene un autor registrado.

Antes de la primera publicación, el agente usa lo que dejó el despliegue (`docs/agent-prompt.json` → SSM). La web lo muestra como **`v0000`**.

---

## 4. Cómo lee el agente la configuración

Archivo: `src/agent/src/agent_core/config.py` (`load_settings` → `resolve_prompt`).

1. **Lee el parámetro SSM** (`AGENT_PROMPT_PARAMETER_NAME`), con **60 s de caché** por contenedor.
2. **Si trae `bedrockPrompt: {id, version}`**, llama a `bedrock-agent:GetPrompt(promptIdentifier=id, promptVersion=version)`:
   - toma el texto del `system` del variant por defecto como instrucciones;
   - toma `modelId`, `temperature` y `maxTokens` como modelo;
   - una versión publicada **no cambia nunca**, así que se lee **una sola vez** por contenedor.
3. **Si Bedrock falla**, usa la **copia** de las instrucciones y del modelo que trae el mismo parámetro SSM. El agente sigue respondiendo.
4. **Rellena las variables**: cada `{{nombre}}` se reemplaza por su valor de `parameters`.
5. **Arma el prompt final** en `prompt.py`:
   ```
   <business_instructions>  ← instrucciones de Bedrock (con variables rellenadas)
   <format_rules>           ← formato WhatsApp (código)
   <fixed_rules>            ← reglas de seguridad (código, siempre ganan)
   <context> / <user>       ← fecha, nombre, canal (código, por turno)
   ```
6. **Elige el modelo** con `with_model()` en `turn.py`: el modelo, la temperatura y el largo de Bedrock reemplazan a los del despliegue (`MODEL_ID`, `MODEL_TEMPERATURE`, `MODEL_MAX_TOKENS`).

El agente **no usa** el Top P aunque esté configurado: con los Claude recientes no se recomienda combinar temperatura y Top P. Queda guardado en Bedrock por si se usa desde la consola.

**Ejemplo del parámetro SSM después de publicar:**

```json
{
  "enabled": true,
  "businessName": "Acme",
  "basePrompt": "Eres el asistente de Acme… un pedido está atrasado tras {{tolerancia_atraso}} minutos…",
  "greeting": "¡Hola! Soy el asistente de Acme…",
  "refusal": "Solo puedo ayudarte con…",
  "handoffMessage": "Te comunico con una persona…",
  "timezone": "America/Santiago",
  "model": { "id": "us.anthropic.claude-sonnet-4-6", "temperature": 0.3, "maxTokens": 4096, "topP": null },
  "parameters": { "tolerancia_atraso": "15" },
  "bedrockPrompt": { "id": "ABCD1234", "version": "4" }
}
```

---

## 5. El prompt en Bedrock

- **Nombre:** `<projectName>-<envName>-agent`, por ejemplo `acme-whatsapp-dev-agent`. Uno por ambiente.
- **Quién lo crea:** la Lambda `agent-config-admin`, **la primera vez que se guarda un borrador**. Lo busca por nombre (`ListPrompts`) y, si no existe, lo crea con la configuración actual. Su id queda en el ítem `bedrock` de la tabla.
- **No lo crea CloudFormation, a propósito:** si el contenido estuviera en el template, cada deploy pisaría lo editado desde la web o la consola.
- **Forma del variant** (`variant_of` en la Lambda):

```json
{
  "name": "default",
  "templateType": "CHAT",
  "modelId": "us.anthropic.claude-sonnet-4-6",
  "templateConfiguration": {
    "chat": {
      "system": [{ "text": "<instrucciones>" }],
      "messages": [{ "role": "user", "content": [{ "text": "{{pregunta}}" }] }],
      "inputVariables": [{ "name": "tolerancia_atraso" }, { "name": "pregunta" }]
    }
  },
  "inferenceConfiguration": { "text": { "temperature": 0.3, "maxTokens": 4096 } }
}
```

- El mensaje de usuario `{{pregunta}}` existe para que la **Test window de la consola** funcione: ahí se escribe una pregunta de prueba. El agente real no lo usa, porque la pregunta llega por WhatsApp.
- **Variables:** cualquier `{{nombre}}` de las instrucciones se declara en `inputVariables`. En la web se completa su valor en **Parámetros**. Al publicar, todas las variables deben tener valor (error `MISSING_VARIABLE`).

---

## 6. Tabla `agent-config`

PK `config_id` (siempre `"agent"`), SK `version`.

| `version` | Contenido |
|---|---|
| `draft` | `config`, `revision` (contador contra ediciones simultáneas), `updatedAt`, `updatedBy`, `basedOn` |
| `v0001`, `v0002`… | `config` completa, `bedrockVersion`, `publishedAt`, `publishedBy`, `comment`, `rollbackOf?`, `source` (`web` o `console`). **Nunca se modifica.** |
| `published` | `current: "v0004"`: la versión en uso |
| `bedrock` | `promptId`, `promptArn` del prompt de Bedrock |

`config` tiene este formato (el mismo que edita la web):

```json
{
  "enabled": true, "businessName": "…", "instructions": "…",
  "greeting": "…", "refusal": "…", "handoffMessage": "…",
  "model": { "id": "…", "temperature": 0.3, "maxTokens": 4096, "topP": null },
  "parameters": { "tolerancia_atraso": "15" }
}
```

**Concurrencia:**
- Guardar exige el `revision` que se leyó. Si otra persona guardó antes, la API responde `409 CONFLICT`.
- Publicar es una transacción: crea `vNNNN` solo si no existe, mueve `published` solo si sigue apuntando a la versión anterior y borra el `draft` solo si su `revision` no cambió.

---

## 7. API

Todas pasan por el authorizer de la API y revisan permisos con `common.access`.

| Método y ruta | Permiso | Qué hace |
|---|---|---|
| `GET /admin/agent/config` | `agent.edit` | Versión en uso, borrador, `liveMatches` (si SSM coincide con lo publicado), `consoleDraft` (si el DRAFT de Bedrock fue editado en la consola) y datos del prompt de Bedrock |
| `PUT /admin/agent/config/draft` | `agent.edit` (+ `agent.publish` si cambia el interruptor, + `agent.model` si cambia el modelo) | Guarda el borrador y actualiza el DRAFT de Bedrock |
| `DELETE /admin/agent/config/draft` | `agent.edit` | Descarta el borrador |
| `POST /admin/agent/config/publish` | `agent.publish` (+ `agent.model`) | Crea la versión en Bedrock y en la tabla y actualiza SSM |
| `GET /admin/agent/config/versions` | `agent.edit` | `versions` (tabla) + `consoleVersions` (versiones de Bedrock que nadie adoptó) |
| `GET /admin/agent/config/versions/{version}` | `agent.edit` | Una versión completa |
| `POST /admin/agent/config/rollback` | `agent.publish` | `{version, comment}`: vuelve a usar esa versión |
| `POST /admin/agent/config/adopt` | `agent.publish` | `{bedrockVersion, comment}`: usa una versión creada en la consola |
| `GET /admin/agent/models` | `agent.edit` | Perfiles de inferencia Claude activos de la cuenta (`ListInferenceProfiles`) |

**Errores con código** (el front los traduce):

| Código | Significado |
|---|---|
| `VALIDATION_ERROR` | Un campo fuera de rango |
| `MISSING_VARIABLE` | Hay una `{{variable}}` sin valor |
| `TOO_LONG` | El parámetro SSM superaría 8 KB |
| `MODEL_UNAVAILABLE` | El modelo elegido no está habilitado en la cuenta |
| `CONFLICT` | Otra persona cambió algo mientras tanto |
| `NOT_APPLIED` | Se guardó la versión, pero no se pudo escribir SSM: hay que publicar de nuevo |

**Validaciones:**
- Instrucciones: entre 50 y 7.000 caracteres. El límite viene de la copia en SSM, que tiene un máximo de 8 KB.
- Mensajes: hasta 1.000 caracteres.
- Modelo: debe empezar con `us.anthropic.claude-` o `global.anthropic.claude-`.
- Temperatura entre 0 y 1; tokens entre 256 y 8.192; Top P entre 0 y 1, u omitido.
- **Cuando cambia el modelo**, antes de publicar se hace una llamada de 1 token (`Converse`). Si el modelo no está habilitado en la cuenta, se rechaza ahí y no en medio de una conversación.

---

## 8. Permisos IAM

**Lambda `agent-config-admin`** (`lib/stack/agent/config-api.ts`):

| Sid | Acciones | Recurso |
|---|---|---|
| `ManagePrompts` | `bedrock:CreatePrompt`, `UpdatePrompt`, `GetPrompt`, `CreatePromptVersion`, `ListPrompts` | `arn:aws:bedrock:<región>:<cuenta>:prompt/*` |
| `ListPromptsAndModels` | `bedrock:ListPrompts`, `bedrock:ListInferenceProfiles` | `*` (no admiten recurso) |
| `CheckClaudeProfiles` / `CheckClaudeModels` | `bedrock:InvokeModel` | Perfiles `*anthropic.claude-*` de la cuenta y modelos `anthropic.claude-*` solo a través de ellos |
| (grants de CDK) | DynamoDB lectura y escritura de `agent-config`; SSM lectura y escritura del parámetro del agente; lectura de `access-control` | — |

**Rol del agente** (`claudeFamilyStatements` en `lib/stack/agent/index.ts`):

| Sid | Acciones | Recurso |
|---|---|---|
| `InvokeAgentInferenceProfile` / `InvokeAgentModelThroughProfile` | Invocar el modelo del despliegue | Como antes |
| `InvokeClaudeInferenceProfiles` | `bedrock:InvokeModel`, `InvokeModelWithResponseStream` | `inference-profile/*anthropic.claude-*` de la cuenta |
| `InvokeClaudeModelsThroughProfiles` | Las mismas | `foundation-model/anthropic.claude-*`, solo vía esos perfiles (condición `bedrock:InferenceProfileArn`) |
| `ReadPromptManagement` | `bedrock:GetPrompt` | `prompt/*` de la cuenta |

Se puede elegir **cualquier Claude** de la cuenta, pero **solo Claude** y **solo a través de perfiles de inferencia**.

---

## 9. Archivos

**Backend**

| Archivo | Qué hace |
|---|---|
| `src/lambda/agent/config-admin/index.py` | Toda la API del prompt manager: Bedrock, tabla y SSM |
| `lib/stack/agent/config-api.ts` | Construct `AgentConfigApi`: tabla, Lambda, IAM y rutas |
| `lib/stack/agent/index.ts` | Lo instancia (`configApi`) y da al agente los permisos de Claude y `GetPrompt` |
| `src/agent/src/agent_core/config.py` | `resolve_prompt`, `bedrock_prompt`, `fill_variables`, `with_model` |
| `src/agent/src/agent_core/turn.py` | Usa `with_model()` al armar el agente |
| `src/agent/src/agent_core/prompt.py` | Envuelve las instrucciones con las reglas fijas (no cambió) |
| `src/layer/python-common/python/common/access/__init__.py` | Permisos `agent.edit`, `agent.publish`, `agent.model` |
| `test/python/test_agent_config_admin.py` | Tests de la API con Bedrock, DynamoDB y SSM simulados |
| `test/agent/test_bedrock_prompt.py` | Tests de cómo el agente lee Bedrock y del respaldo |
| `test/agent.test.ts` | Tests del CDK (tabla, rutas e IAM) |

**Front** (`src/features/agent/`)

| Archivo | Qué hace |
|---|---|
| `section.tsx` | Registra la página: `/settings/agent`, grupo Configuración, `requiresDeveloper` |
| `AgentConfigPage.tsx` | Pantalla con pestañas, guardar, publicar y aviso de la consola |
| `components/ModelPanel.tsx` | Pestaña Modelo |
| `components/ParametersPanel.tsx` | Pestaña Parámetros (variables) |
| `components/VersionHistory.tsx` | Historial, Ver, "Activar esta versión" y versiones de la consola |
| `agentConfigService.ts` | Llamadas a la API y traducción de errores |
| `types.ts` | Tipos, `normalizeConfig`, `variablesOf` y límites |

---

## 10. Cómo replicarlo en otro proyecto

Este proyecto ya lo trae armado. Esta sección sirve para llevarlo a otro proyecto que tenga el agente en AgentCore (o Lambda) con el parámetro SSM del prompt, la API REST con el authorizer y el módulo de permisos `common.access` (ver [ACCESS.md](ACCESS.md)).

1. **Backend: copiar** `src/lambda/agent/config-admin/` y `lib/stack/agent/config-api.ts`.
2. **Instanciar** `AgentConfigApi` dentro del `AgentFactory`, pasándole `layerFactory`, `apiFactory`, `access`, el `promptParameter`, la clave y el `defaultModel`. Aquí entra por la prop `configApi` desde `main-stack.ts`.
3. **Agente:** copiar los cambios de `config.py` (`resolve_prompt` y sus funciones) y la línea `with_model()` de `turn.py`. Agregar `claudeFamilyStatements` al rol del agente.
4. **Permisos:** que existan `agent.edit`, `agent.publish` y `agent.model` en `common.access`, y decidir qué roles los tienen. Por defecto, solo developer.
5. **Front: copiar** `src/features/agent/`. Si el proyecto no tiene `requiresDeveloper`, usar `requiresAdmin` o agregar el guard (`src/router/guards.ts`, `routes.tsx`, `AppSidebar.tsx`).
6. **Habilitar los modelos** que se quieran ofrecer en **Bedrock → Model access** de la cuenta. La lista de la web muestra los perfiles activos, pero solo publica uno si la prueba de 1 token funciona.
7. **Desplegar** y, en la web, **Guardar borrador** una vez: eso crea el prompt `<prefix>-agent` en Bedrock. Después, **Publicar**.
8. **Comprobar:**
   - En la consola, **Bedrock → Prompt management**, aparece `<prefix>-agent` con su versión 1.
   - El parámetro SSM trae `bedrockPrompt`.
   - En los logs del agente no aparece "Could not read Bedrock prompt".

El prompt manager no depende de las herramientas del agente: un proyecto con herramientas propias solo cambia el texto de las instrucciones.

---

## 11. Operación y problemas frecuentes

| Situación | Qué pasa / qué hacer |
|---|---|
| Se publica y el bot no cambia | Esperar **1 minuto** (caché de SSM). Si sigue igual, revisar que el parámetro SSM tenga el `bedrockPrompt` nuevo. |
| Aviso "La configuración que usa el agente no coincide…" | Un despliegue cambió el parámetro SSM, por ejemplo porque se editó `docs/agent-prompt.json`. Publicar de nuevo desde la web. |
| Aviso "Alguien editó el borrador del prompt en la consola" | Revisar con **Traer cambios de AWS** y publicar si corresponde, o ignorarlo. |
| `MODEL_UNAVAILABLE` al publicar | Habilitar el modelo en Bedrock → Model access, o elegir otro. |
| Bedrock caído o sin permisos en el agente | El agente usa la copia del parámetro SSM: sigue respondiendo con las mismas instrucciones. En los logs aparece "Could not read Bedrock prompt …". |
| Se borró el prompt en la consola | Borrar el ítem `bedrock` de la tabla y guardar un borrador desde la web: se crea de nuevo. El historial de la tabla se conserva, pero las versiones viejas de Bedrock ya no existen, así que restaurarlas falla. Conviene **no borrar el prompt** en la consola. |
| Las instrucciones superan 7.000 caracteres | Límite de la copia en SSM. Acortarlas. Si hace falta más, la mejora es dejar de copiar las instrucciones a SSM y depender solo de Bedrock. |
| Quién cambió qué | Pestaña **Historial**, o los logs de la Lambda `agent-config-admin` (líneas `"audit": "agent-config"`). |

---

## 12. Decisiones y por qué

- **Bedrock Prompt Management en vez de un sistema propio:** es el servicio de AWS para esto, se puede usar desde la consola y sigue la misma línea del resto del proyecto (WhatsApp con End User Messaging, AgentCore).
- **La tabla, además de Bedrock:** Bedrock no guarda autor ni comentario, y sus versiones se pueden borrar desde la consola. La tabla es el registro de auditoría y decide qué versión está en uso.
- **El agente sigue leyendo SSM:** es el punto único que ya leían el agente y el `ws-handler` (interruptor y mensajes). SSM apunta a la versión de Bedrock y guarda una copia de respaldo.
- **Las versiones de la consola no se activan solas:** para que ningún cambio llegue al bot sin un autor registrado.
- **El prompt no está en CloudFormation:** para que un deploy no pise lo editado.
- **Solo Claude y solo por perfiles de inferencia:** controla costo y riesgo, y los perfiles reparten la carga entre regiones.
- **Las reglas de seguridad siguen en el código:** nada de lo que se escriba en la web o en la consola las puede desactivar.
