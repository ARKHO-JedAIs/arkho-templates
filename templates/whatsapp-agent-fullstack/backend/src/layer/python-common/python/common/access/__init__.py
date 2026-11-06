"""Roles and permissions: who may see which page and do which action.

A role is a Cognito group (the user's membership travels in the token); what
the role may do lives in the access-control table, so it changes from the web
without a new sign-in:

    PK=ROLE#<role>  SK=META   {name, description, system, hidden}
    PK=ROLE#<role>  SK=PERMS  {menu: [...], actions: [...]}

`developer` holds every permission in code: no table edit can lock it out.
A signed-in user with no role group (a first Entra ID sign-in, for example)
counts as `member`.

Without ACCESS_TABLE_NAME, or when the table cannot be read, the defaults
below apply: the same values the seed writes on the first deploy.
"""
import os
import time

DEVELOPER = "developer"
ADMIN = "admin"
MEMBER = "member"
SYSTEM_ROLES = (DEVELOPER, ADMIN, MEMBER)
# Only a developer sees, assigns or edits users of these roles.
HIDDEN_ROLES = (DEVELOPER,)

ROLE_LABELS = {
    DEVELOPER: ("Developer", "Acceso técnico completo: configuración avanzada, roles y menú."),
    ADMIN: ("Administrador", "Gestiona usuarios y plantillas."),
    MEMBER: ("Miembro", "Usa la bandeja y las páginas de la operación."),
}

# Pages of the sidebar. A project adds its own pages with register_menu().
MENUS = {
    "whatsapp": "Bandeja WhatsApp",
    "templates": "Plantillas",
    "users": "Usuarios",
    "agent": "Agente IA",
    "agent_advanced": "Agente IA: técnico",
    "access": "Roles y permisos",
    "menu": "Menú y páginas",
}

ACTIONS = {
    "whatsapp.reply": "Responder desde la bandeja",
    "whatsapp.agent_toggle": "Pausar o reanudar el agente en una conversación",
    "templates.send": "Enviar plantillas",
    "templates.manage": "Crear, editar y borrar plantillas",
    "users.manage": "Crear, editar, desactivar y resetear usuarios",
    "users.assign_roles": "Cambiar los roles de un usuario",
    "agent.edit": "Editar instrucciones y mensajes del agente",
    "agent.test": "Probar el borrador del agente",
    "agent.publish": "Publicar y volver a una versión anterior del agente",
    "agent.model": "Cambiar modelo, respaldos, temperatura y tokens",
    "agent.tools": "Activar herramientas y cambiar parámetros de negocio",
    "access.manage": "Crear y editar roles y sus permisos",
    "menu.manage": "Editar el catálogo de páginas",
}

DEFAULT_PERMISSIONS = {
    # The agent screen (prompt manager) is for developers only, for now.
    ADMIN: {
        "menu": ["whatsapp", "templates", "users"],
        "actions": [
            "whatsapp.reply",
            "whatsapp.agent_toggle",
            "templates.send",
            "templates.manage",
            "users.manage",
            "users.assign_roles",
        ],
    },
    MEMBER: {
        "menu": ["whatsapp"],
        "actions": ["whatsapp.reply", "whatsapp.agent_toggle"],
    },
}


def register_menu(menu_id: str, label: str, roles=(ADMIN, MEMBER)) -> None:
    """A page of this project (outside the generic catalog): adds it to the catalog and to the default roles.

    Call it below for each page the project adds, with the menu id its
    frontend section.tsx declares, e.g. register_menu("reportes", "Reportes").
    """
    MENUS[menu_id] = label
    for role in roles:
        menu = DEFAULT_PERMISSIONS.setdefault(role, {"menu": [], "actions": []})["menu"]
        if menu_id not in menu:
            menu.append(menu_id)


# Pages of this project (outside the generic catalog above): none yet.

CACHE_SECONDS = 60
_cache: dict[str, tuple[float, dict]] = {}
_table = None


def _access_table():
    global _table
    name = os.environ.get("ACCESS_TABLE_NAME", "")
    if not name:
        return None
    if _table is None:
        import boto3

        _table = boto3.resource("dynamodb").Table(name)
    return _table


def _clean(values, catalog) -> list[str]:
    return [value for value in (values or []) if value in catalog]


def role_permissions(role: str) -> dict:
    """{menu, actions} of one role: the table's (cached 60 s) or the default."""
    if role == DEVELOPER:
        return {"menu": list(MENUS), "actions": list(ACTIONS)}
    cached = _cache.get(role)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return cached[1]
    default = DEFAULT_PERMISSIONS.get(role, {"menu": [], "actions": []})
    permissions = default
    table = _access_table()
    if table is not None:
        try:
            item = table.get_item(Key={"PK": f"ROLE#{role}", "SK": "PERMS"}).get("Item")
            if item:
                permissions = {"menu": list(item.get("menu") or []), "actions": list(item.get("actions") or [])}
        except Exception:  # noqa: BLE001 - an unreadable table falls back to the defaults
            permissions = default
    permissions = {"menu": _clean(permissions["menu"], MENUS), "actions": _clean(permissions["actions"], ACTIONS)}
    _cache[role] = (time.monotonic(), permissions)
    return permissions


def roles_of(groups) -> list[str]:
    """The roles among the token's groups; none of them (only a provider group) = member.

    Cognito adds federated users to a `<pool-id>_<Provider>` group: it is not a role.
    """
    roles = [group for group in (groups or []) if group and "_" not in group]
    return roles or [MEMBER]


def permissions_for(groups) -> dict:
    roles = roles_of(groups)
    menu, actions = [], []
    for role in roles:
        permissions = role_permissions(role)
        menu += [item for item in permissions["menu"] if item not in menu]
        actions += [item for item in permissions["actions"] if item not in actions]
    order_menu, order_actions = list(MENUS), list(ACTIONS)
    return {
        "roles": roles,
        "menu": sorted(menu, key=order_menu.index),
        "actions": sorted(actions, key=order_actions.index),
    }


def has(groups, permission: str) -> bool:
    """Whether any role of the user grants `permission` (a menu id or an action id)."""
    permissions = permissions_for(groups)
    return permission in permissions["menu"] or permission in permissions["actions"]


def is_developer(groups) -> bool:
    return DEVELOPER in roles_of(groups)


def assignable_roles(groups) -> list[str]:
    """Roles this user may give or take away: every one for a developer, the visible ones otherwise."""
    if is_developer(groups):
        return list(SYSTEM_ROLES)
    if has(groups, "users.assign_roles"):
        return [role for role in SYSTEM_ROLES if role not in HIDDEN_ROLES]
    return []


def caller_groups(event: dict) -> list[str]:
    """The groups the API Gateway Lambda authorizer passed on (comma-joined)."""
    authorizer = (event.get("requestContext") or {}).get("authorizer") or {}
    return [group for group in str(authorizer.get("groups") or "").split(",") if group]


def allowed(event: dict, permission: str) -> bool:
    return has(caller_groups(event), permission)


def clear_cache() -> None:
    _cache.clear()
