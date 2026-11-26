# Roles y permisos

Quién puede ver cada página de la web y hacer cada acción, y cómo se cambia sin redesplegar.

## Roles

| Rol | Qué ve y hace | Quién lo asigna |
|---|---|---|
| **developer** (oculto) | Todo, incluida **Configuración → Agente IA**. Tiene todos los permisos en el código, así que nadie lo puede dejar sin acceso. | Otro developer, o el despliegue con `DEVELOPER_EMAILS` |
| **admin** | Bandeja de WhatsApp, Plantillas, Usuarios y Roles y permisos. Asigna **admin** o **member** a cualquier usuario. | Un admin o un developer |
| **member** | Bandeja de WhatsApp: ver y responder conversaciones y pausar el agente en una conversación | Rol por defecto |
| **Los que crees** | Lo que marques en **Configuración → Roles y permisos**: cada uno es un grupo de Cognito con su propia lista de páginas y acciones | Un admin o un developer |

Los permisos de **admin** y **member** también se cambian desde esa pantalla; **developer** no, porque tiene todos en el código.

Reglas que la API aplica siempre, aunque el front ya las cumpla:

- Un admin **no ve a los developers** en Usuarios, no puede asignar ese rol y no puede editarlos, desactivarlos ni borrarlos.
- Nadie puede cambiar sus propios roles ni desactivar o borrar su propia cuenta.
- Al **cambiar los roles** de alguien, se cierran sus sesiones (`AdminUserGlobalSignOut`). En el siguiente inicio de sesión su token trae los roles nuevos.
- Un usuario **sin rol**, como alguien que entra por primera vez con Microsoft o Google, cuenta como **member**. El trigger *Pre Token Generation* lo agrega al grupo `member` en ese primer inicio de sesión.

## La pantalla Roles y permisos

**Configuración → Roles y permisos** (permiso `access.manage`) muestra una tabla: una fila por página y por acción, una columna por rol. Marcas qué ve y qué hace cada rol, guardas, y se aplica en menos de un minuto sin desplegar.

- **Nuevo rol**: nombre y descripción. Se crea un grupo de Cognito con un identificador derivado del nombre (minúsculas y guiones, de 2 a 30 caracteres) y empieza sin permisos. Después lo asignas desde Usuarios, igual que admin o member.
- **Eliminar**: solo los roles creados aquí, y solo si nadie los tiene asignados.
- La API (`/admin/access`) aplica siempre estas reglas, aunque la pantalla ya las cumpla:
  - nadie da un permiso que no tiene;
  - nadie quita `access` o `access.manage` a un rol del que forma parte;
  - **developer** se muestra a los developers y no se edita.

El menú de la barra lateral y las rutas siguen estos permisos: una página aparece solo si el rol la tiene. Cada sección declara su identificador con `menu` en su `section.tsx`. Si el front no puede leer los permisos, vuelve a las reglas anteriores (admin o developer), que solo restringen.

## Dónde vive cada cosa

| Pieza | Dónde |
|---|---|
| Qué rol tiene cada usuario | **Grupo de Cognito** (`developer`, `admin`, `member` o uno creado en la pantalla), que viaja en el token |
| Qué puede hacer cada rol | Tabla DynamoDB **`<prefix>-access-control`**: `ROLE#<rol>` / `PERMS` → `{menu: [...], actions: [...]}`. Los roles creados en la pantalla suman `ROLE#<rol>` / `META` con su nombre. Las APIs la leen con 60 s de caché. |
| Permisos por defecto | `backend/src/layer/python-common/python/common/access/__init__.py` (`DEFAULT_PERMISSIONS`). La semilla los escribe en la tabla al desplegar, solo donde faltan o donde nadie los editó. |
| Lo que ve el front | `GET /me/permissions` devuelve `{roles, menu, actions}` |
| La bandeja en vivo (AppSync) | Un **authorizer Lambda** revisa que el rol del usuario tenga el permiso `whatsapp`. Así cualquier rol con acceso a la bandeja recibe los mensajes en vivo. |

## Permisos

**Páginas (`menu`):** `whatsapp`, `templates`, `users`, `agent`, `agent_advanced` y `access`.

**Acciones (`actions`):**

| Acción | Qué permite |
|---|---|
| `whatsapp.reply` | Responder desde la bandeja |
| `whatsapp.agent_toggle` | Pausar o reanudar el agente en una conversación |
| `templates.send` | Enviar plantillas |
| `templates.manage` | Crear, editar y borrar plantillas |
| `users.manage` | Crear, editar, desactivar y resetear usuarios |
| `users.assign_roles` | Cambiar los roles de un usuario |
| `agent.edit` | Editar el borrador del agente |
| `agent.test` | Probar el borrador |
| `agent.publish` | Publicar, activar versiones y encender o apagar el agente |
| `agent.model` | Cambiar el modelo y sus parámetros |
| `agent.settings` | Cambiar la memoria y el límite de respuestas del agente |
| `access.manage` | Crear roles y editar sus permisos (pantalla Roles y permisos) |

## Tareas comunes

- **Hacerte developer:** pon tu correo en `DEVELOPER_EMAILS` de `backend/.env`, separado por comas si son varios. Inicia sesión una vez para que el usuario exista en Cognito y despliega. La semilla te agrega al grupo.
- **Agregar una página propia del proyecto:**
  1. Llama a `register_menu("reportes", "Reportes")` en `common/access/__init__.py`, que la suma al catálogo y a los roles admin y member.
  2. Revisa el permiso en su Lambda con `access.allowed(event, "reportes")`.
  3. En el front, declara `menu: "reportes"` en su `section.tsx`: la ruta y el menú siguen los permisos de ese identificador.
- **Cambiar qué ve un rol sin desplegar:** hazlo en Configuración → Roles y permisos. (También vale editar el ítem `ROLE#<rol>` / `PERMS` de la tabla `access-control`.) Se aplica en menos de un minuto y la semilla ya no lo vuelve a tocar.
- **Revisar en una Lambda nueva:** `from common import access` y `access.allowed(event, "<página o acción>")`. Dale la tabla con `accessFactory.grantRead(fn)` en el CDK.

## Archivos

| Archivo | Qué hace |
|---|---|
| `backend/lib/stack/access/index.ts` | Tabla, grupo developer, semilla, `/me/permissions` y authorizer de AppSync |
| `backend/src/layer/python-common/python/common/access/__init__.py` | Catálogo, permisos por defecto y `has` / `allowed` / `assignable_roles` |
| `backend/src/lambda/access/seed/` | Semilla: permisos por defecto, `DEVELOPER_EMAILS` y `member` para usuarios sin rol |
| `backend/src/lambda/access/pre-token/` | Trigger de Cognito: un usuario sin rol entra como `member` |
| `backend/src/lambda/access/me-permissions/` | `GET /me/permissions` |
| `backend/src/lambda/access/appsync-authorizer/` | Autoriza la suscripción en vivo según el permiso `whatsapp` |
| `backend/src/lambda/access/roles-admin/` | API de la pantalla: `GET /admin/access`, crear, editar y eliminar roles |
| `backend/src/lambda/users/admin-users/` | API de Usuarios con las reglas de roles y `GET /admin/roles` (incluye los roles creados) |
| `frontend/src/lib/access/permissions.ts` | Carga `/me/permissions` y decide qué página se muestra (`useCan`, `isSectionAllowed`) |
| `frontend/src/router/guards.ts` · `src/app/sections.ts` | `requireSection` y el `menu` de cada página (`requiresAdmin` y `requiresDeveloper` quedan de respaldo) |
| `frontend/src/features/access/` | La pantalla Roles y permisos |
| `frontend/src/features/admin/` | Pantalla Usuarios: los roles que se ofrecen vienen de `GET /admin/roles` |
