# The Works of Jonathan Edwards — archiwum Markdown

Projekt tworzy przeszukiwalne pliki Markdown z ręcznie zapisanych stron
[WJE Online](http://edwards.yale.edu/research/browse), obejmujących 73 tomy
*The Works of Jonathan Edwards*. Zawartość jest pobierana ręcznie i następnie
przekształcana lokalnie; projekt nie automatyzuje pobierania ze strony Yale.

## Zawartość

- `HTML/VOLUMENN/` — niezmodyfikowane, lokalnie zapisane strony źródłowe.
  Plik `000.html` zawiera nawigację i hierarchię tomu.
- `VOLUMEN.md` — wynikowy tekst tomu w Markdown.
- `scripts/html_volume_to_markdown.rb` — konwerter tolerujący niepoprawny HTML
  archiwum.
- `AGENTS.md` — stała procedura pracy nad następnymi tomami.

Wynik zachowuje treść źródłową, strukturę nagłówków, przypisy i numery stron.
Numery stron są celowo dyskretnymi komentarzami, np. `<!-- p. 123 -->`, dzięki
czemu pozostają przeszukiwalne, ale nie zaburzają hierarchii dokumentu. Obrazy,
nawigacja serwisu oraz stopki są pomijane.

## Tworzenie tomu

Po umieszczeniu ręcznie zapisanych plików w `HTML/VOLUMENN/` uruchom:

```bash
ruby scripts/html_volume_to_markdown.rb HTML/VOLUMENN VOLUMEN.md
```

Przykład dla drugiego tomu:

```bash
ruby scripts/html_volume_to_markdown.rb HTML/VOLUME02 VOLUME2.md
```

Konwerter odczytuje wyłącznie lokalne HTML, wykrywa główną treść na podstawie
komentarzy archiwum, czerpie poziomy nagłówków z `000.html` i tworzy unikalne
przypisy Markdown. Unikalność jest ważna, ponieważ numeracja przypisów zaczyna
się od nowa w różnych fragmentach tomu.

## Weryfikacja

Po wygenerowaniu tomu uruchom co najmniej:

```bash
ruby -c scripts/html_volume_to_markdown.rb
ruby scripts/verify_volume_markdown.rb HTML/VOLUMENN VOLUMEN.md
git diff --check
```

Walidator porównuje znaczniki stron, odwołania i definicje przypisów z lokalnym
HTML oraz zgłasza nagłówki z `000.html`, których nie ma w wyniku. Braki w
sekwencji stron oznaczają, że trzeba ręcznie zapisać brakujące fragmenty — nie
należy rekonstruować ich z pamięci ani z innego wydania.

## Stan zrzutów

| Tom | Plik Markdown | Stan źródeł |
| --- | --- | --- |
| 1 — *Freedom of the Will* | `VOLUME1.md` | Brak stron 205–273. |
| 2 — *Religious Affections* | `VOLUME2.md` | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 46, 76–77, 84, 125 i 440; dokument nie dopisuje ich sztucznie. Plik `007.html` nie ma zwykłego końcowego komentarza archiwum, dlatego konwerter używa bezpiecznego końca awaryjnego. |

Dokumenty Markdown przedstawiają wyłącznie treść obecną w lokalnym zrzucie.
