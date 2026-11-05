#!/usr/bin/env python3
"""Construit index.html (français) et en.html (anglais) à partir de i18n/index.html et de
i18n/strings.toml.

    python3 i18n/build.py          régénère les deux pages
    python3 i18n/build.py --check  vérifie seulement que les pages sont à jour (code 1 sinon)

S'arrête, sans rien écrire, si un {{texte}} de la page n'existe pas ou s'il lui manque une langue.
"""
import html
import re
import sys
import tomllib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
LANGS = {"fr": "index.html", "en": "en.html"}
BANNER = "<!-- Page générée par i18n/build.py : modifie i18n/strings.toml ou i18n/index.html, pas ce fichier. -->\n"
PLACEHOLDER = re.compile(r'(="?)?\{\{\s*([\w.]+)(?:\[(\d+)\])?\s*\}\}')


def flatten(table, prefix=""):
    """{"hero": {"title": {"fr": .., "en": ..}}} -> {"hero.title": {"fr": .., "en": ..}}"""
    out = {}
    for key, value in table.items():
        name = f"{prefix}{key}"
        if isinstance(value, dict) and not (set(value) & set(LANGS)):
            out.update(flatten(value, name + "."))
        else:
            out[name] = value
    return out


def main():
    check = "--check" in sys.argv
    strings = flatten(tomllib.loads((HERE / "strings.toml").read_text(encoding="utf-8")))
    template = (HERE / "index.html").read_text(encoding="utf-8")

    problems, used = [], set()
    for name, value in strings.items():
        if not isinstance(value, dict):
            problems.append(f"[{name}] doit avoir une ligne fr = et une ligne en =")
            continue
        for lang in LANGS:
            if lang not in value or value[lang] in ("", []):
                problems.append(f"[{name}] : traduction « {lang} » manquante")
        if isinstance(value.get("fr"), list) and len(value.get("fr", [])) != len(value.get("en", [])):
            problems.append(f"[{name}] : pas le même nombre d'éléments en fr et en en")

    for match in PLACEHOLDER.finditer(template):
        used.add(match.group(2))
        if match.group(2) not in strings:
            problems.append(f"{{{{{match.group(2)}}}}} est dans i18n/index.html mais pas dans strings.toml")
    if problems:
        sys.exit("Rien n'a été écrit :\n  " + "\n  ".join(problems))

    stale = []
    for lang, filename in LANGS.items():
        def fill(match):
            value = strings[match.group(2)][lang]
            if match.group(3) is not None:
                value = value[int(match.group(3))]
            elif isinstance(value, list):
                value = "|".join(value)
            if match.group(1):  # dans un attribut : les guillemets et < > doivent être échappés
                return match.group(1) + html.escape(value, quote=False).replace('"', "&quot;")
            return value

        page = PLACEHOLDER.sub(fill, template)
        page = page.replace("<!doctype html>\n", "<!doctype html>\n" + BANNER, 1)
        target = SITE / filename
        if check:
            if not target.exists() or target.read_text(encoding="utf-8") != page:
                stale.append(filename)
        else:
            target.write_text(page, encoding="utf-8")
            print(f"écrit {filename}")

    unused = sorted(set(strings) - used)
    if unused:
        print("Textes qui ne servent plus dans la page : " + ", ".join(unused))
    if stale:
        sys.exit("Pas à jour : " + ", ".join(stale) + " — lance python3 i18n/build.py")


if __name__ == "__main__":
    main()
