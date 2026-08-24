# Instrukcja pracy nad kolejnymi tomami

Repozytorium przekształca ręcznie zapisane strony HTML z **The Works of
Jonathan Edwards** do pojedynczych dokumentów Markdown. Surowe pliki w
`HTML/` są materiałem źródłowym: nie edytuj ich ani nie pobieraj automatycznie
z serwisu Yale.

## Wejście i wynik

- Każdy tom ma katalog `HTML/VOLUMENN/`.
- `000.html` jest nawigacją tomu i stanowi źródło hierarchii nagłówków.
- Pozostałe pliki HTML są fragmentami treści; zachowaj ich kolejność numeryczną.
- Wynikiem jest `MD/VOLUMEN.md`, bez zer w numerze tomu.

## Konwersja

Uruchom generator wyłącznie na lokalnych plikach:

```bash
ruby scripts/html_volume_to_markdown.rb HTML/VOLUMENN MD/VOLUMEN.md
```

Generator domyślnie:

- pobiera treść wyłącznie między komentarzami `START OF CONTENT AREA` i
  `END OF CONTEXT AREA` (z bezpiecznym końcem awaryjnym dla uciętych plików);
- pomija elementy interfejsu, stopki i obrazy;
- zapisuje numer stron jako dyskretne komentarze `<!-- p. 123 -->`;
- korzysta z `000.html`, aby ustalić poziomy nagłówków i utworzyć spis treści;
- zapisuje przypisy jako Markdown `[^NNN-noteX]`. Identyfikator obejmuje numer
  pliku źródłowego, ponieważ numery drukowane mogą się powtarzać.

Nie zamieniaj znaczników stron na nagłówki i nie kasuj przypisów. Jeżeli definicja
przypisu w zapisanym HTML jest pusta, zachowaj ją z jawną adnotacją o braku
treści, zamiast wymyślać brakujący tekst.

Jeśli użytkownik wyraźnie wskaże, że obrazy danego tomu są istotne, użyj trybu
`--include-images`. Generator skopiuje wyłącznie obrazy obecne w obszarze treści
do `MD/assets/VOLUMENN/` i umieści w Markdown ścieżki względne:

```bash
ruby scripts/html_volume_to_markdown.rb --include-images HTML/VOLUMENN MD/VOLUMEN.md
ruby scripts/verify_volume_markdown.rb --include-images HTML/VOLUMENN MD/VOLUMEN.md
```

## Kontrola kompletności

Przed uznaniem tomu za gotowy sprawdź:

1. czy istnieją wszystkie pliki wskazane przez ręcznie zapisany ciąg;
2. zakresy numerów stron w każdym pliku oraz luki między plikami;
3. zgodność odwołań i definicji przypisów;
4. obecność nagłówków oczekiwanych według `000.html`.

Ucięty plik HTML lub luka w paginacji oznacza niekompletny zrzut, nie błąd do
"naprawienia" przez dopisywanie treści. Odnotuj brak w `README.md` i wygeneruj
dokument tylko z dostępnymi materiałami.

Weryfikacja musi kończyć się samoczynnie; używaj kontroli składni Ruby,
generatora, walidatora tomu oraz `git diff --check`:

```bash
ruby -c scripts/html_volume_to_markdown.rb
ruby scripts/verify_volume_markdown.rb HTML/VOLUMENN MD/VOLUMEN.md
git diff --check
```

Walidator zgłasza luki w nagłówkach jako informację, ponieważ mogą wynikać z
niepełnego zrzutu. Nie uruchamiaj serwera ani nie modyfikuj surowego HTML.
