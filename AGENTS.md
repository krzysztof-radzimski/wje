# Instrukcja pracy nad kolejnymi tomami

Repozytorium przekształca ręcznie zapisane strony HTML z **The Works of
Jonathan Edwards** do pojedynczych dokumentów Markdown. Surowe pliki w
`HTML/` są materiałem źródłowym: nie edytuj ich ani nie pobieraj automatycznie
z serwisu Yale.

## Wejście i wynik

- Każdy tom ma katalog `HTML/VOLUMENN/`.
- `000.html` jest nawigacją tomu i stanowi źródło hierarchii nagłówków.
- Pozostałe pliki HTML są fragmentami treści; zachowaj ich kolejność numeryczną.
- Wynikiem jest `MD/VOLUMENN.md`, z zerem wiodącym dla tomów 1–9
  (np. `MD/VOLUME01.md`).

## Konwersja

Uruchom generator wyłącznie na lokalnych plikach:

```bash
ruby scripts/html_volume_to_markdown.rb HTML/VOLUMENN MD/VOLUMENN.md
```

Generator domyślnie:

- pobiera treść wyłącznie między komentarzami `START OF CONTENT AREA` i
  `END OF CONTEXT AREA` (z bezpiecznym końcem awaryjnym dla uciętych plików);
- pomija elementy interfejsu, stopki i obrazy;
- konwertuje tabele do tabel Markdown GFM, dodając pusty wiersz nagłówka i
  separator oraz uzupełniając brakujące końcowe komórki;
- zapisuje numer stron jako dyskretne komentarze `<!-- p. 123 -->`;
- korzysta z `000.html`, aby ustalić poziomy nagłówków i utworzyć spis treści;
- zapisuje przypisy jako Markdown `[^NNN-noteX]`. Identyfikator obejmuje numer
  pliku źródłowego, ponieważ numery drukowane mogą się powtarzać.

Nie zamieniaj znaczników stron na nagłówki i nie kasuj przypisów. Jeżeli definicja
przypisu w zapisanym HTML jest pusta, zachowaj ją z jawną adnotacją o braku
treści, zamiast wymyślać brakujący tekst.

Po wygenerowaniu każdego kolejnego tomu sprawdź wszystkie wynikowe tabele:
każdy ciąg wierszy rozpoczynających się od `|` musi mieć drugi wiersz z
separatorem GFM (`| --- |`) i identyczną liczbę nieeskapowanych separatorów
kolumn w każdym wierszu. Jeśli źródłowy HTML ma brakujące końcowe komórki lub
znacznik strony wewnątrz komórki, popraw generator i wygeneruj tom ponownie;
nie pozostawiaj tabeli, która wyświetla się jak zwykły tekst.

Jeśli użytkownik wyraźnie wskaże, że obrazy danego tomu są istotne, użyj trybu
`--include-images`. Generator skopiuje wyłącznie obrazy obecne w obszarze treści
do `MD/assets/VOLUMENN/` i umieści w Markdown ścieżki względne:

```bash
ruby scripts/html_volume_to_markdown.rb --include-images HTML/VOLUMENN MD/VOLUMENN.md
ruby scripts/verify_volume_markdown.rb --include-images HTML/VOLUMENN MD/VOLUMENN.md
```

Aby zachować tylko jeden lokalny obraz treści, użyj identyfikatora z
trzycyfrowym numerem pliku źródłowego i zapisaną nazwą pliku. Opcjonalna nazwa
po znaku `=` określa nazwę w `MD/assets/VOLUMENN/`; argument zawierający nawiasy
ujmij w apostrofy:

```bash
ruby scripts/html_volume_to_markdown.rb '--include-image=003:getimage(7).php=illustration.jpg' HTML/VOLUMENN MD/VOLUMENN.md
```

Jeżeli użytkownik wskaże diagram zamiast obrazu, wygeneruj dokument z
pominiętym obrazem i wstaw w jego miejscu wierny blok `mermaid`. Nie zachowuj
oryginalnego obrazu równolegle, chyba że użytkownik wyraźnie tego zażąda.

### Wyjątek tomu 10

`MD/VOLUME10.md` zawiera dwa ręcznie odtworzone diagramy Mermaid zamiast
obrazów z `HTML/VOLUME10/003_files/`: `getimage.php` (schemat „Explication”)
i `getimage(5).php` (sieć odwołań). Zachowany jest wyłącznie obraz
`getimage(7).php`, pod nazwą `MD/assets/VOLUME10/jec-yje10-100.jpg`:

```bash
ruby scripts/html_volume_to_markdown.rb '--include-image=003:getimage(7).php=jec-yje10-100.jpg' HTML/VOLUME10 MD/VOLUME10.md
```

Ponowne wygenerowanie tomu usuwa ręcznie wstawione diagramy; należy je wtedy
odtworzyć po fragmentach „First the Explication:” i „See diagram below.”.

## Kontrola kompletności

Przed uznaniem tomu za gotowy sprawdź:

1. czy istnieją wszystkie pliki wskazane przez ręcznie zapisany ciąg;
2. zakresy numerów stron w każdym pliku oraz luki między plikami;
3. zgodność odwołań i definicji przypisów;
4. obecność nagłówków oczekiwanych według `000.html`.
5. poprawność tabel Markdown GFM: separator nagłówka i spójna liczba kolumn.

Ucięty plik HTML lub luka w paginacji oznacza niekompletny zrzut, nie błąd do
"naprawienia" przez dopisywanie treści. Odnotuj brak w `README.md` i wygeneruj
dokument tylko z dostępnymi materiałami.

Weryfikacja musi kończyć się samoczynnie; używaj kontroli składni Ruby,
generatora, walidatora tomu oraz `git diff --check`:

```bash
ruby -c scripts/html_volume_to_markdown.rb
ruby scripts/verify_volume_markdown.rb HTML/VOLUMENN MD/VOLUMENN.md
git diff --check
```

Walidator zgłasza luki w nagłówkach jako informację, ponieważ mogą wynikać z
niepełnego zrzutu. Nie uruchamiaj serwera ani nie modyfikuj surowego HTML.
