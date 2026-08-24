[EN](README.md) | **PL**

# The Works of Jonathan Edwards

![Portret Jonathana Edwardsa](assets/jonathan-edwards.svg)

Projekt tworzy przeszukiwalne pliki Markdown z ręcznie zapisanych stron
[WJE Online](http://edwards.yale.edu/research/browse), obejmujących 73 tomy
*The Works of Jonathan Edwards*. Zawartość jest pobierana ręcznie i następnie
przekształcana lokalnie; projekt nie automatyzuje pobierania ze strony Yale.

## Zawartość

- `HTML/VOLUMENN/` — niezmodyfikowane, lokalnie zapisane strony źródłowe.
  Plik `000.html` zawiera nawigację i hierarchię tomu.
- `MD/VOLUMENN.md` — wynikowy tekst tomu w Markdown; tomy 1–9 mają zero
  wiodące (np. `MD/VOLUME01.md`).
- `assets/` — grafiki projektu wykorzystywane w dokumentacji.
- `scripts/html_volume_to_markdown.rb` — konwerter tolerujący niepoprawny HTML
  archiwum.
- `AGENTS.md` — stała procedura pracy nad następnymi tomami.

Wynik zachowuje treść źródłową, strukturę nagłówków, przypisy i numery stron.
Numery stron są celowo dyskretnymi komentarzami, np. `<!-- p. 123 -->`, dzięki
czemu pozostają przeszukiwalne, ale nie zaburzają hierarchii dokumentu. Obrazy,
nawigacja serwisu oraz stopki są zwykle pomijane. Jeśli ilustracje są istotne,
tryb `--include-images` kopiuje lokalnie zapisane obrazy treści do
`MD/assets/VOLUMENN/` i zapisuje w Markdown ścieżki względne.

## Tworzenie tomu

Po umieszczeniu ręcznie zapisanych plików w `HTML/VOLUMENN/` uruchom:

```bash
ruby scripts/html_volume_to_markdown.rb HTML/VOLUMENN MD/VOLUMENN.md
```

Przykład dla drugiego tomu:

```bash
ruby scripts/html_volume_to_markdown.rb HTML/VOLUME02 MD/VOLUME02.md
```

Dla tomu, którego ilustracje należy zachować:

```bash
ruby scripts/html_volume_to_markdown.rb --include-images HTML/VOLUMENN MD/VOLUMENN.md
ruby scripts/verify_volume_markdown.rb --include-images HTML/VOLUMENN MD/VOLUMENN.md
```

Konwerter odczytuje wyłącznie lokalne HTML, wykrywa główną treść na podstawie
komentarzy archiwum, czerpie poziomy nagłówków z `000.html` i tworzy unikalne
przypisy Markdown. Unikalność jest ważna, ponieważ numeracja przypisów zaczyna
się od nowa w różnych fragmentach tomu.

## Weryfikacja

Po wygenerowaniu tomu uruchom co najmniej:

```bash
ruby -c scripts/html_volume_to_markdown.rb
ruby scripts/verify_volume_markdown.rb HTML/VOLUMENN MD/VOLUMENN.md
git diff --check
```

Walidator porównuje znaczniki stron, odwołania i definicje przypisów z lokalnym
HTML oraz zgłasza nagłówki z `000.html`, których nie ma w wyniku. Braki w
sekwencji stron oznaczają, że trzeba ręcznie zapisać brakujące fragmenty — nie
należy rekonstruować ich z pamięci ani z innego wydania.

## Stan zrzutów

| Tom | Tytuł | Plik Markdown | Stan źródeł |
| --- | --- | --- | --- |
| 1 | *Freedom of the Will* | `MD/VOLUME01.md` | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 31, 136 i 149; dokument nie dopisuje ich sztucznie. |
| 2 | *Religious Affections* | `MD/VOLUME02.md` | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 46, 76–77, 84, 125 i 440; dokument nie dopisuje ich sztucznie. Plik `007.html` nie ma zwykłego końcowego komentarza archiwum, dlatego konwerter używa bezpiecznego końca awaryjnego. |
| 3 | *Original Sin* | `MD/VOLUME03.md` | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 105–106, 220–222, 350–352 i 372–374; dokument nie dopisuje ich sztucznie. Plik `007.html` nie ma zwykłego końcowego komentarza archiwum, dlatego konwerter używa bezpiecznego końca awaryjnego. |
| 4 | *The Great Awakening* | `MD/VOLUME04.md` | Zapisana treść obejmuje całą hierarchię z `000.html` oraz ciąg znaczników stron 1–570 bez luk. |
| 5 | *Apocalyptic Writings* | `MD/VOLUME05.md` | Zapisana treść obejmuje całą hierarchię z `000.html` oraz ciąg znaczników stron 1–464 bez luk. Nawigacja zaznacza, że Edwards nie skomentował 3. rozdziału Apokalipsy w wykładzie. |
| 6 | *Scientific and Philosophical Writings* | `MD/VOLUME06.md` | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 1, 144–146, 170–171 i 311; dokument nie dopisuje ich sztucznie. Lokalnie zapisane obrazy treści znajdują się w `MD/assets/VOLUME06/`. |
| 7 | *The Life of David Brainerd* | `MD/VOLUME07.md` | Zapisana treść obejmuje całą hierarchię z `000.html`, ze znacznikami stron 1–590 oraz znacznikami części wstępnej viii–x. |
| 8 | *Ethical Writings* | `MD/VOLUME08.md` | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 122–124, 127–128, 398–400, 403–404, 416–418, 455, 464–466, 507, 537–538, 628–630, 641–642, 651, 668, 672, 678 i 688; dokument nie dopisuje ich sztucznie. |
| 9 | *A History of the Work of Redemption* | `MD/VOLUME09.md` | Zapisana treść obejmuje całą hierarchię z `000.html`, ze znacznikami stron 1–556 oraz znacznikami części wstępnej vii–ix. Obrazy zostały pominięte. |
| 10 | *Sermons and Discourses 1720–1723* | `MD/VOLUME10.md` | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 2, 259–260, 578 i 644; dokument nie dopisuje ich sztucznie. Dwa obrazy źródłowe zastąpiono diagramami Mermaid, a zapisano wyłącznie obraz `jec-yje10-100.jpg`. |
| 11 | *Typological Writings* | `MD/VOLUME11.md` | Lokalny zrzut obejmuje pliki źródłowe `001.html`–`010.html`. W źródle nie występują znaczniki stron 2, 36, 117, 144, 154, 156 i 190; dokument nie dopisuje ich sztucznie. Obraz struktury rękopisu ze strony źródłowej 004 zastąpiono diagramem Mermaid, a wszystkie pozostałe obrazy pominięto. |
| 12 | *Ecclesiastical Writings* | `MD/VOLUME12.md` | Lokalny zrzut obejmuje pliki źródłowe `001.html`–`007.html`. W źródle nie występują znaczniki stron 92, 164, 166, 350, 504 i 506; dokument nie dopisuje ich sztucznie. Obrazy pominięto. |
| 13 | *The "Miscellanies": (Entry Nos. a–z, aa–zz, 1–500)* | `MD/VOLUME13.md` | Lokalny zrzut obejmuje pliki źródłowe `001.html`–`005.html`. W źródle nie występują znaczniki stron 110–112, 124, 151–152, 161–162 i 342–544; dokument nie dopisuje ich sztucznie. Zachowano 26 prawidłowych lokalnych obrazów w `MD/assets/VOLUME13/`; ilustracja ze strony źródłowej 002 została zapisana jako HTML zamiast obrazu, więc ją pominięto. |

Dokumenty Markdown przedstawiają wyłącznie treść obecną w lokalnym zrzucie.
