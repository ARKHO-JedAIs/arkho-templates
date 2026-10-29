"""Pre-filter rules: the data file to extend per project.

Every pattern is a regular expression matched against the normalized message
(see ``normalize.py``): lowercase, no accents, leetspeak folded ("1gn0r4" ->
"ignora"), spaced letters glued ("s e x o" -> "sexo"). Write patterns in that
folded form: no accents, no uppercase. Use ``\\b`` at both ends so a word
inside a longer one does not match ("sexto" is not "sexo"), and prefer
phrases over single words to limit false positives.

``compact`` entries are plain substrings matched against the message with
every space and symbol removed. They catch "i g n o r a  l a s
i n s t r u c c i o n e s", so keep them long and distinctive: a short one
matches across word borders ("por nosotros" contains "porno").

Categories are checked in order and the first match wins. ``action`` is
``block`` (refuse without calling the model) or ``support`` (self-harm: a
caring answer and a handoff to a person, never a refusal).

To add a category, append a ``Category``; to tune one, add or remove
patterns and run ``python -m unittest discover -s test/agent`` from
``backend``: the test lists of attacks and legitimate messages guard both
directions.
"""
from dataclasses import dataclass, field

BLOCK = "block"
SUPPORT = "support"


@dataclass(frozen=True)
class Category:
    name: str
    action: str
    patterns: tuple[str, ...]
    compact: tuple[str, ...] = field(default_factory=tuple)


# Words that make a sexual request about a minor; any sexual term within 40
# characters of one of these is a hard block, in either order.
_MINOR = (
    r"(?:nin[oa]s?|nene[s]?|nena[s]?|menor(?:es)? de edad|menores|chiquill[oa]s?|colegialas?|"
    r"escolares|preadolescentes?|lolis?|child|children|kids?|minors?|underage|preteens?|"
    r"(?:de|of) (?:[1-9]|1[0-7]) (?:anos|years))"
)
_SEXUAL_TERM = (
    r"(?:porn\w*|desnud\w*|nudes?|naked|erotic\w*|sexo con|sex with|tener sexo|have sex|"
    r"sexual(?:es|mente)? con|xxx)"
)

CATEGORIES: tuple[Category, ...] = (
    Category(
        name="sexual_minors",
        action=BLOCK,
        patterns=(
            r"\b(?:pedofil\w*|pedophil\w*|paedophil\w*|lolicon|shotacon)\b",
            r"\b(?:pornografia|porno|porn|contenido sexual|material sexual)\b(?: \w+){0,3} "
            r"(?:infantil|de (?:ninos|ninas|menores)|con (?:ninos|ninas|menores)|child|children|kids?|minors?|underage)\b",
            r"\b(?:child|kid|minor|underage|preteen) (?:porn|sex|nudes?|erotica)\b",
            r"\b" + _MINOR + r"\b.{0,40}\b" + _SEXUAL_TERM,
            r"\b" + _SEXUAL_TERM + r".{0,40}\b" + _MINOR + r"\b",
        ),
        compact=("pornografiainfantil", "childporn", "pedofilia", "pedophilia"),
    ),
    Category(
        name="violence_threats",
        action=BLOCK,
        patterns=(
            r"\b(?:te|lo|la|los|las|les|le) (?:voy|vamos) a (?:matar|asesinar|golpear|reventar|quemar|balear|"
            r"apunalar|acuchillar|degollar|descuartizar|secuestrar|romper la cara|partir la cara|sacar la cresta|"
            r"hacer mierda|cagar a palos)\b",
            r"\b(?:voy|vamos) a (?:matar|asesinar|balear|apunalar|quemar|secuestrar|golpear)"
            r"(?:te|lo|la|los|las|le|les)\b",
            r"\b(?:voy a|vamos a|quiero|pienso) (?:matar|asesinar|balear|apunalar|secuestrar) a\b",
            r"\b(?:te|los|lo|la|las) (?:mato|matare|matamos|asesino|asesinare)\b",
            r"\bse donde (?:vives|trabajas|vive tu familia|estudian tus hijos)\b",
            r"\b(?:poner|colocar|plantar|detonar|tirar) (?:una |un )?(?:bomba|explosivo)(?! de (?:agua|calor|vacio|aire|riego))\b",
            r"\b(?:como|ensename a) (?:hacer|fabricar|armar|construir) (?:una |un )?(?:bomba(?! de (?:agua|calor|vacio|aire|riego))"
            r"|bomba casera|molotov|explosivos?|arma casera)\b",
            r"\b(?:hacer|cometer|planear|planeo|planeando) (?:un |una )?(?:tiroteo|masacre|atentado)\b",
            r"\bi(?:'m| am)? ?(?:going to|gonna|will) (?:kill|shoot|stab|murder|hurt|beat|burn) "
            r"(?:you|him|her|them|everyone|all of you)\b",
            r"\bi know where you live\b",
            r"\b(?:how to )?(?:make|build) (?:a |an )?(?:bomb|explosive|pipe bomb)\b",
            r"\bshoot up (?:the|a|my)\b",
        ),
    ),
    Category(
        name="self_harm",
        action=SUPPORT,
        patterns=(
            r"\bme (?:quiero|voy a|dan ganas de|gustaria|pienso) (?:matar|suicidar|morir|cortar las venas)\b",
            r"\b(?:quiero|voy a|pienso en|pensando en|ganas de|deseo) (?:\w+ )?(?:matarme|suicidarme|morirme|"
            r"quitarme la vida|acabar con mi vida|terminar con mi vida|hacerme dano|cortarme)\b",
            r"\bquiero morir\b",
            r"\b(?:suicidio|suicidarme|suicidarse|autolesion\w*|cortarme las venas)\b",
            r"\bno (?:quiero|tengo ganas de) (?:seguir )?viv(?:ir|iendo)\b",
            r"\bno vale la pena (?:seguir )?viv(?:ir|iendo)\b",
            r"\bmejor (?:estaria|estar) muert[oa]\b",
            r"\b(?:kill myself|killing myself|suicide|suicidal|end my life|want to die|wanna die|self ?harm|"
            r"cut myself|hurt myself)\b",
            r"\bdon'?t want to live\b",
        ),
        compact=("mequieromatar", "mequieromorir", "suicidarme", "killmyself"),
    ),
    Category(
        name="prompt_injection",
        action=BLOCK,
        patterns=(
            # Spanish: ignore / forget the instructions.
            r"\b(?:ignora|ignore|ignorar|ignoren|olvida|olvidate|olvidar|olviden|omite|omitir|desobedece|descarta|anula|"
            r"salta|saltate)\b(?: \w+){0,3} (?:tus|sus) (?:instrucciones|reglas|indicaciones|directrices|ordenes|"
            r"restricciones|politicas|limites|filtros|programacion|configuracion)\b",
            r"\b(?:ignora|ignore|ignorar|ignoren|olvida|olvidate|olvidar|olviden|omite|omitir|desobedece|descarta|anula)"
            r"\b(?: \w+){0,3} (?:instrucciones|reglas|indicaciones|directrices|ordenes|restricciones|prompts?) "
            r"(?:anteriores|previas|originales|iniciales|de arriba|del sistema|de sistema|que te (?:dieron|dio|programaron))\b",
            r"\b(?:ignora|ignorar|olvida|olvidar|omite) todas (?:las |tus )?(?:instrucciones|reglas|restricciones)\b",
            # Spanish: reveal the prompt or configuration.
            r"\b(?:muestra|muestrame|muestrenme|mostrar|revela|revelame|revelar|dime|dame|ensename|imprime|escribe|"
            r"copia|repite|comparte|pasame|cual es|cuales son)\b(?: \w+){0,3} (?:tu prompt|tus prompts|el prompt|"
            r"prompt del sistema|prompt de sistema|prompt inicial|prompt original|tus instrucciones|"
            r"instrucciones del sistema|instrucciones internas|instrucciones iniciales|instrucciones originales|"
            r"tu configuracion|configuracion interna|reglas internas)\b",
            r"\bsystem ?prompt\b",
            r"\bprompt (?:del|de) sistema\b",
            # Spanish: role play, modes and "no restrictions".
            r"\b(?:actua|actue|actuar|actuen|comportate|comportarte) como (?:si|un|una|el|la|mi)\b",
            r"\ba partir de (?:ahora|este momento|hoy) (?:eres|seras|vas a ser|actuaras|responderas|te llamas)\b",
            r"\bdesde ahora (?:eres|seras|vas a ser|actuaras|responderas)\b",
            r"\bahora (?:eres|seras) (?:un|una|el|la|mi)\b",
            r"\bya no eres (?:un|una|el|la)\b",
            r"\b(?:finge|fingir|pretende|imagina|supon|hagamos de cuenta|haz de cuenta) (?:que )?(?:eres|no tienes "
            r"(?:reglas|restricciones|limites|filtros)|no (?:hay|existen) (?:reglas|restricciones|limites|filtros))\b",
            r"\bmodo (?:desarrollador|developer|dios|god|dan|jailbreak|sin (?:restricciones|filtros|censura|limites)|"
            r"administrador|admin|debug|depuracion)\b",
            r"\b(?:asistente|ia|bot|chatbot|modelo|ai|llm)\b(?: \w+){0,2} sin (?:restricciones|filtros|reglas|"
            r"censura|limites)\b",
            r"\b(?:responde|responder|respondeme|habla|hablame|contesta|contestame)\b(?: \w+){0,3} sin "
            r"(?:restricciones|filtros|censura|reglas|limites)\b",
            r"\b(?:eres|seras|activa|activar|modo) dan\b",
            r"\bjailbreak\w*\b",
            r"\bdo anything now\b",
            r"\b(?:prompt injection|inyeccion de prompts?)\b",
            # English.
            r"\b(?:ignore|disregard|forget|override|bypass)\b(?: \w+){0,3} (?:previous|prior|above|earlier|all|your|"
            r"system|initial|original|any)\b(?: \w+){0,2} (?:instructions?|rules|prompts?|guidelines|directives|"
            r"restrictions|programming|guardrails)\b",
            r"\b(?:show|reveal|print|display|repeat|output|tell|give|share|leak|dump|what (?:is|are))\b(?: \w+){0,3} "
            r"(?:your (?:system prompt|system message|prompt|instructions|configuration|config|rules|guidelines)|"
            r"the (?:system prompt|system message|initial prompt|original prompt|hidden prompt|system instructions))\b",
            r"\byou are now\b",
            r"\bfrom now on,? you (?:are|will|must)\b",
            r"\bact as (?:a|an|if|my)\b",
            r"\bpretend (?:that )?(?:you are|you're|to be|there are no|you have no)\b",
            r"\bdeveloper mode\b",
            r"\b(?:without|with no) (?:any )?(?:restrictions|filters|censorship|guidelines)\b",
        ),
        compact=(
            "systemprompt",
            "promptdelsistema",
            "ignoralasinstrucciones",
            "ignoratodaslasinstrucciones",
            "ignoratusinstrucciones",
            "ignoratusreglas",
            "olvidatusinstrucciones",
            "ignorepreviousinstructions",
            "ignoreallpreviousinstructions",
            "ignoreallinstructions",
            "ignoreyourinstructions",
            "asistentesinrestricciones",
            "muestrametusinstrucciones",
            "developermode",
            "mododesarrollador",
            "jailbreak",
            "doanythingnow",
        ),
    ),
    Category(
        name="sexual",
        action=BLOCK,
        patterns=(
            r"\b(?:porno|pornografia|porn|xxx|onlyfans|hentai|sexting|cibersexo)\b",
            r"\b(?:tener|hacer|hagamos|tengamos|quiero|quieres) (?:\w+ )?sexo\b(?! de)",
            r"\bsexo (?:oral|anal|conmigo|contigo|telefonico|virtual|explicito)\b",
            r"\b(?:sex (?:with|chat)|(?:have|having|want) sex)\b",
            r"\b(?:fotos?|videos?|pack|imagenes?|pics?|photos?)\b(?: \w+){0,2} (?:desnud\w*|xxx|nudes?|naked|"
            r"eroticas?|eroticos?|sexuales)\b",
            r"\b(?:desnudate|desnudarte|desnudame|mandame (?:\w+ ){0,2}(?:nudes|desnud\w*|pack)|nudes)\b",
            r"\b(?:send|show) (?:me )?(?:nudes|your (?:body|boobs|tits|dick))\b",
            r"\b(?:masturb\w*|orgasm\w*|eyacul\w*|mamada|chupamela|chupala|follar|follame|culear|cogerte|"
            r"blowjob|handjob|horny|cachond[oa]|calenton|fuck me)\b",
            r"\b(?:dick|cock|pussy|tits|boobs)\b",
        ),
        compact=("pornografia", "onlyfans", "sexting"),
    ),
    Category(
        name="harassment_hate",
        action=BLOCK,
        patterns=(
            r"\b(?:maricon\w*|sudaca\w*|faggot\w*|nigg\w*|kike|chink|tranny|retard\w*|retrasad[oa] mental)\b",
            r"\b(?:negr[oa]|indi[oa]|judi[oa]|peruan[oa]|venezolan[oa]|haitian[oa]|bolivian[oa]) de mierda\b",
            r"\b(?:eres|sos|son ustedes|ustedes son) (?:un |una |unos |unas )?(?:put[ao]s?|perr[ao]s?|zorras?|"
            r"maricon\w*|hij[oa]s? de (?:put[ao]|perra)|hdp|culiaos?|culiados?|conchetumadres?)\b",
            r"\b(?:muerte a|mueran|maten a|exterminar a|exterminen a|hay que (?:matar|exterminar|eliminar) a)"
            r"(?: los| las| todos los| todas las)? (?:judios|gays|homosexuales|lesbianas|trans|negros|inmigrantes|"
            r"migrantes|peruanos|venezolanos|haitianos|bolivianos|colombianos|mapuches|musulmanes|cristianos|"
            r"mujeres|indigenas|chinos)\b",
            r"\b(?:death to|kill all) (?:the )?(?:jews|gays|blacks|immigrants|muslims|christians|women|trans people)\b",
            r"\bfuck (?:you|off)\b",
            r"\byou(?:'re| are) (?:a |an )?(?:fucking )?(?:bitch|whore|slut|retard|faggot)\b",
        ),
    ),
)

# Exact messages (folded, without punctuation) answered with the configured
# greeting without calling the model.
GREETINGS: frozenset[str] = frozenset(
    {
        "hola",
        "holi",
        "ola",
        "alo",
        "buenas",
        "buen dia",
        "buenos dias",
        "buenas tardes",
        "buenas noches",
        "hola buenas",
        "hola buen dia",
        "hola buenos dias",
        "hola buenas tardes",
        "hola buenas noches",
        "saludos",
        "que tal",
        "hola que tal",
        "hello",
        "hi",
        "hey",
        "good morning",
        "good afternoon",
        "good evening",
        "que puedes hacer",
        "hola que puedes hacer",
        "que haces",
        "en que me puedes ayudar",
        "en que me pueden ayudar",
        "hola en que me puedes ayudar",
        "como me puedes ayudar",
        "ayuda",
        "menu",
        "opciones",
        "what can you do",
        "help",
    }
)

# Categories that count as an abuse attempt for the repeat-offender counter
# kept by the caller. ``self_harm`` is a person who needs help, not an offense.
OFFENSE_CATEGORIES: frozenset[str] = frozenset(
    {"prompt_injection", "sexual", "sexual_minors", "harassment_hate", "violence_threats", "output_leak"}
)
