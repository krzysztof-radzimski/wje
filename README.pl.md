[EN](README.md) | **PL**

# The Works of Jonathan Edwards

![Portret Jonathana Edwardsa](assets/jonathan-edwards.svg)

Projekt tworzy przeszukiwalne pliki Markdown z lokalnie zarchiwizowanych stron
[WJE Online](http://edwards.yale.edu/research/browse), obejmujących 73 tomy
*The Works of Jonathan Edwards*. Dla tomów 17–73 kontrolowane narzędzie importu
używa Microsoft Edge przez Playwright/CDP, zapisuje wyrenderowany DOM i zasoby
zaobserwowane w tej samej sesji przeglądarki oraz nie wymaga uprawnienia macOS
Accessibility. Bezpośrednie pobieranie HTTP, API, MHTML oraz edycja zapisanych
HTML są zabronione; konwersja odbywa się wyłącznie lokalnie.

## Zawartość

- `HTML/VOLUMENN/` — niezmodyfikowane, lokalnie zapisane strony źródłowe.
  Plik `000.html` zawiera nawigację i hierarchię tomu.
- `MD/VOLUMENN.md` — wynikowy tekst tomu w Markdown; tomy 1–9 mają zero
  wiodące (np. `MD/VOLUME01.md`).
- `assets/` — grafiki projektu wykorzystywane w dokumentacji.
- `scripts/html_volume_to_markdown.rb` — konwerter tolerujący niepoprawny HTML
  archiwum.
- `scripts/archive_yale_volume.mjs` — jedyny dozwolony importer nowych stron
  źródłowych Yale; korzysta z tego samego mechanizmu Playwright/CDP co podgląd
  code-architect i wymaga Microsoft Edge na macOS.
- `scripts/audit_volume_images.rb` i `scripts/archive_and_convert_volume.rb` —
  deterministyczna selekcja obrazów i selektywna konwersja nowych tomów.
- `AGENTS.md` — stała procedura pracy nad następnymi tomami.

Wynik zachowuje treść źródłową, strukturę nagłówków, przypisy i numery stron.
Numery stron są celowo dyskretnymi komentarzami, np. `<!-- p. 123 -->`, dzięki
czemu pozostają przeszukiwalne, ale nie zaburzają hierarchii dokumentu. Obrazy,
nawigacja serwisu oraz stopki są zwykle pomijane. Jeśli ilustracje są istotne,
tryb `--include-images` kopiuje lokalnie zapisane obrazy treści do
`MD/assets/VOLUMENN/` i zapisuje w Markdown ścieżki względne.

## Tworzenie tomu

Pełna procedura kontrolowanego importu, wznowienia, manifestu obrazów, konwersji
i selektywnej walidacji tomów 17–73 znajduje się w `AGENTS.md`. Gdy
niezmodyfikowane źródła są już w `HTML/VOLUMENN/`, konwersję można uruchomić:

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
sekwencji stron oznaczają, że trzeba ponowić brakujące fragmenty kontrolowanym
importerem z `--resume` — nie należy rekonstruować ich z pamięci ani z innego
wydania.

## Stan zrzutów

| Tom | Tytuł | Plik Markdown | Stan źródeł |
| --- | --- | --- | --- |
| 1 | *Freedom of the Will* | [MD/VOLUME01.md](MD/VOLUME01.md) | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 31, 136 i 149; dokument nie dopisuje ich sztucznie. |
| 2 | *Religious Affections* | [MD/VOLUME02.md](MD/VOLUME02.md) | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 46, 76–77, 84, 125 i 440; dokument nie dopisuje ich sztucznie. Plik `007.html` nie ma zwykłego końcowego komentarza archiwum, dlatego konwerter używa bezpiecznego końca awaryjnego. |
| 3 | *Original Sin* | [MD/VOLUME03.md](MD/VOLUME03.md) | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 105–106, 220–222, 350–352 i 372–374; dokument nie dopisuje ich sztucznie. Plik `007.html` nie ma zwykłego końcowego komentarza archiwum, dlatego konwerter używa bezpiecznego końca awaryjnego. |
| 4 | *The Great Awakening* | [MD/VOLUME04.md](MD/VOLUME04.md) | Zapisana treść obejmuje całą hierarchię z `000.html` oraz ciąg znaczników stron 1–570 bez luk. |
| 5 | *Apocalyptic Writings* | [MD/VOLUME05.md](MD/VOLUME05.md) | Zapisana treść obejmuje całą hierarchię z `000.html` oraz ciąg znaczników stron 1–464 bez luk. Nawigacja zaznacza, że Edwards nie skomentował 3. rozdziału Apokalipsy w wykładzie. |
| 6 | *Scientific and Philosophical Writings* | [MD/VOLUME06.md](MD/VOLUME06.md) | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 1, 144–146, 170–171 i 311; dokument nie dopisuje ich sztucznie. Lokalnie zapisane obrazy treści znajdują się w `MD/assets/VOLUME06/`. |
| 7 | *The Life of David Brainerd* | [MD/VOLUME07.md](MD/VOLUME07.md) | Zapisana treść obejmuje całą hierarchię z `000.html`, ze znacznikami stron 1–590 oraz znacznikami części wstępnej viii–x. |
| 8 | *Ethical Writings* | [MD/VOLUME08.md](MD/VOLUME08.md) | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 122–124, 127–128, 398–400, 403–404, 416–418, 455, 464–466, 507, 537–538, 628–630, 641–642, 651, 668, 672, 678 i 688; dokument nie dopisuje ich sztucznie. |
| 9 | *A History of the Work of Redemption* | [MD/VOLUME09.md](MD/VOLUME09.md) | Zapisana treść obejmuje całą hierarchię z `000.html`, ze znacznikami stron 1–556 oraz znacznikami części wstępnej vii–ix. Obrazy zostały pominięte. |
| 10 | *Sermons and Discourses 1720–1723* | [MD/VOLUME10.md](MD/VOLUME10.md) | Zapisana treść obejmuje całą hierarchię z `000.html`. W źródle nie występują znaczniki stron 2, 259–260, 578 i 644; dokument nie dopisuje ich sztucznie. Dwa obrazy źródłowe zastąpiono diagramami Mermaid, a zapisano wyłącznie obraz `jec-yje10-100.jpg`. |
| 11 | *Typological Writings* | [MD/VOLUME11.md](MD/VOLUME11.md) | Lokalny zrzut obejmuje pliki źródłowe `001.html`–`010.html`. W źródle nie występują znaczniki stron 2, 36, 117, 144, 154, 156 i 190; dokument nie dopisuje ich sztucznie. Obraz struktury rękopisu ze strony źródłowej 004 zastąpiono diagramem Mermaid, a wszystkie pozostałe obrazy pominięto. |
| 12 | *Ecclesiastical Writings* | [MD/VOLUME12.md](MD/VOLUME12.md) | Lokalny zrzut obejmuje pliki źródłowe `001.html`–`007.html`. W źródle nie występują znaczniki stron 92, 164, 166, 350, 504 i 506; dokument nie dopisuje ich sztucznie. Obrazy pominięto. |
| 13 | *The "Miscellanies": (Entry Nos. a–z, aa–zz, 1–500)* | [MD/VOLUME13.md](MD/VOLUME13.md) | Lokalny zrzut obejmuje pliki źródłowe `001.html`–`005.html`. W źródle nie występują znaczniki stron 110–112, 124, 151–152, 161–162 i 342–544; dokument nie dopisuje ich sztucznie. Zachowano 26 prawidłowych lokalnych obrazów w `MD/assets/VOLUME13/`; ilustracja ze strony źródłowej 002 została zapisana jako HTML zamiast obrazu, więc ją pominięto. |
| 14 | *Sermons and Discourses: 1723–1729* | [MD/VOLUME14.md](MD/VOLUME14.md) | Lokalny zrzut obejmuje pliki źródłowe `001.html`–`024.html` oraz ciąg znaczników stron arabskich 1–550 bez luk. Obrazy pominięto. |
| 15 | *Notes on Scripture* | [MD/VOLUME15.md](MD/VOLUME15.md) | Lokalny zrzut obejmuje pliki źródłowe `001.html`–`003.html`. W źródle nie występują znaczniki stron 17, 47 i 48; dokument nie dopisuje ich sztucznie. Obrazy pominięto. |
| 16 | *Letters and Personal Writings* | [MD/VOLUME16.md](MD/VOLUME16.md) | Lokalny zrzut obejmuje pliki źródłowe `001.html`–`075.html`. W źródle występuje ciąg arabskich znaczników stron 3–837 z brakami: 28–29, 32, 34, 39, 71, 85, 88, 101, 111, 134, 143–144, 148, 152, 173, 199, 224, 255, 259, 266, 282, 296, 394, 436, 449, 485, 512, 739–740 i 805–806; dokument nie dopisuje ich sztucznie. Obrazy pominięto. |
| 17 | *Sermons and Discourses, 1730–1733* | [MD/VOLUME17.md](MD/VOLUME17.md) | Zrzut przeglądarkowy obejmuje `000.html`, 21 pozycji nawigacji najwyższego poziomu oraz pliki źródłowe `001.html`–`022.html` (`Contents` jest archiwizowany osobno względem 21 pozycji `navlevel1`). Znaczniki części wstępnej vii–xii i arabskie znaczniki stron 1–458 tworzą ciąg bez luk. Plik `022.html` nie ma zwykłego końcowego komentarza archiwum, dlatego konwerter używa zapisanej stopki jako bezpiecznego końca; nie widać luki w treści. Audyt wykrył 50 kandydatów obrazowych: 47 obrazów nietreściowych i 3 niepewne obrazy treści (`003:archive`, `003:archive(1)` i `012:archive(1)`); żaden nie ma decyzji `include`, więc żadnego obrazu nie osadzono ani nie skopiowano. |
| 18 | *The "Miscellanies," (Entry Nos. 501–832)* | [MD/VOLUME18.md](MD/VOLUME18.md) | Zrzut przeglądarkowy obejmuje `000.html` i pliki źródłowe `001.html`–`089.html`: cztery sekcje zbiorcze oraz 85 osobno odzyskanych wpisów 749–832. Zbiorcza odpowiedź Yale w `004.html` kończy się w połowie wpisu 748 po znaczniku strony 392; widoczne strony potomne odzyskują wpisy 749–832, lecz końcówka wpisu 748 pozostaje nieobecna i nie jest rekonstruowana. Znaczniki części wstępnej występują w zapisanej kolejności vii, x, ix, x, xi. Arabskie znaczniki obejmują 1–547, przy czym 288 występuje dwukrotnie, a 289 nie występuje w źródle. Plik `089.html` nie ma zwykłego komentarza końcowego, ale bezpieczny fallback kończy się po pełnym wpisie 832 i stronie 547. Audyt sklasyfikował wszystkie 183 kandydaty jako `omit-noncontent`; żadnego obrazu nie osadzono ani nie skopiowano. |
| 19 | *Sermons and Discourses, 1734–1738* | [MD/VOLUME19.md](MD/VOLUME19.md) | Zrzut przeglądarkowy obejmuje `000.html` i pliki źródłowe `001.html`–`036.html`. Znaczniki części wstępnej viii–xiv tworzą ciąg bez luk. Arabskie znaczniki biegną od 3 do 811; w źródle nie występują znaczniki 1–2 ani 792 i dokument ich nie dopisuje. Etykieta nawigacji `[intro]` jest technicznym kontenerem grupującym, a nie nagłówkiem treści; wszystkie jej nagłówki potomne są obecne. Plik `036.html` nie ma zwykłego komentarza końcowego, ale bezpieczny fallback kończy się po dodatku B i stronie 811. Audyt sklasyfikował wszystkie 74 kandydaty jako `omit-noncontent`; żadnego obrazu nie osadzono ani nie skopiowano. |
| 20 | *The "Miscellanies," 833–1152* | [MD/VOLUME20.md](MD/VOLUME20.md) | Zrzut przeglądarkowy obejmuje `000.html` i pliki źródłowe `001.html`–`068.html`: trzy początkowe sekcje oraz 65 osobno odzyskanych wpisów 1085–1152. Zbiorcza odpowiedź Yale w `003.html` kończy się w połowie wpisu 1084 po znaczniku strony 467; widoczne strony potomne odzyskują wpisy 1085–1152, lecz końcówka wpisu 1084 pozostaje nieobecna i nie jest rekonstruowana. Znaczniki części wstępnej vii–xi tworzą ciąg bez luk. Arabskie znaczniki obejmują 1–525 bez powtórzeń, z wyjątkiem nieobecnych w źródle 40–42 i 468. Etykiety nawigacji 840a, 861, 1137 i 1150 różnią się od zapisanych nagłówków treści, lecz odpowiadające im wpisy są obecne. Plik `068.html` nie ma zwykłego komentarza końcowego, ale bezpieczny fallback kończy się po pełnym wpisie 1152; ostatnim zapisanym znacznikiem strony jest 525. Audyt sklasyfikował wszystkie 138 kandydatów jako `omit-noncontent`; żadnego obrazu nie osadzono ani nie skopiowano. |

Dokumenty Markdown przedstawiają wyłącznie treść obecną w lokalnym zrzucie.
