# Instrukcja pracy nad kolejnymi tomami

Repozytorium archiwizuje strony **The Works of Jonathan Edwards** i
przekształca je do pojedynczych dokumentów Markdown. Surowe pliki w `HTML/` są
materiałem źródłowym: nie edytuj zapisanych `NNN.html` ani odpowiadających im
katalogów `NNN_files/`.

## Wejście i wynik

- Każdy tom ma katalog `HTML/VOLUMENN/`.
- `000.html` jest nawigacją tomu i stanowi źródło hierarchii nagłówków.
- Pozostałe pliki HTML są fragmentami treści; zachowaj ich kolejność numeryczną.
- Wynikiem jest `MD/VOLUMENN.md`, z zerem wiodącym dla tomów 1–9
  (np. `MD/VOLUME01.md`).

## Import przez wbudowany mechanizm przeglądarkowy

Jedyną dopuszczalną drogą pozyskania nowych źródeł z Yale dla tomów 17–73 jest
`scripts/archive_yale_volume.mjs`. Narzędzie korzysta z tego samego mechanizmu
Playwright/CDP i Microsoft Edge co wbudowana przeglądarka code-architect,
przewija dokument do ustabilizowanego końca, zapisuje wyrenderowany DOM oraz
zasoby otrzymane przez tę samą sesję przeglądarki. Nie używa AppleScriptu ani
systemowego okna „Zapisz jako”. Zabronione są `curl`, `wget`, bezpośrednie API,
MHTML i dodatkowe żądania HTTP poza nawigacją przeglądarki. Nie wolno redagować,
naprawiać ani nadpisywać utworzonych `NNN.html` i `NNN_files/`.

### Wymagania i preflight

- macOS;
- Microsoft Edge zainstalowany dokładnie jako `/Applications/Microsoft
  Edge.app` i uruchomiony co najmniej raz;
- Node.js 20 lub nowszy, Ruby i gem `nokogiri`;
- tylko jeden aktywny przebieg archiwizatora naraz oraz odstęp co najmniej
  domyślnych 2500 ms między sekcjami. Nie próbuj równoleglić tomów.

Zainstaluj zależności i wykonaj lokalny smoke test. Smoke test zapisuje przez
przeglądarkę tylko lokalną stronę w katalogu tymczasowym i nie wymaga
Accessibility:

```bash
npm ci
gem install nokogiri
npm test
npm run archive:smoke
```

### Jeden tom od pustego katalogu do Markdown

Poniższy przykład dotyczy tomu 17. Skopiuj z WJE Online dokładny adres
nawigacji tomu, który ma zostać zapisany jako `000.html`, i przypisz go do
`SOURCE_URL`. Katalog docelowy musi nie istnieć albo być pusty; archiwizator
chroni tomy 01–16.

```bash
VOLUME=17
SOURCE_URL='WKLEJ_TUTAJ_DOKLADNY_ADRES_NAWIGACJI_TOMU'
npm run archive -- \
  --volume "$VOLUME" \
  --source-url "$SOURCE_URL" \
  --destination "HTML/VOLUME${VOLUME}" \
  --headless \
  --delay-ms 2500 \
  --retries 3
```

Narzędzie najpierw zapisuje spis jako `000.html`, odkrywa z niego sekcje i
zapisuje je kolejno jako `001.html`, `002.html`, … wraz z katalogami
`NNN_files/`. Stan każdej próby znajduje się w
`HTML/VOLUMENN/.archive-manifest.json`; log i zrzuty kontrolne są w
`HTML/VOLUMENN/.archive-evidence/`.

Po przerwaniu uruchom dokładnie to samo polecenie z `--resume`. Kompletne wpisy
są pomijane, a błędne lub niekompletne są ponawiane:

```bash
npm run archive -- \
  --volume "$VOLUME" \
  --source-url "$SOURCE_URL" \
  --destination "HTML/VOLUME${VOLUME}" \
  --resume \
  --headless \
  --delay-ms 2500 \
  --retries 3
```

Jeśli błędna próba pozostawiła np. `003.html` lub `003_files/`, archiwizator
celowo odmówi ich nadpisania. Przenieś wyłącznie te niekompletne artefakty do
osobnego katalogu kwarantanny (nie edytuj ich i nie usuwaj), pozostaw
`.archive-manifest.json`, po czym ponów powyższe polecenie z `--resume`. W ten
sposób tylko wpisy oznaczone jako błędne/niekompletne zostaną zapisane ponownie;
kompletne sekcje pozostaną nietknięte.

```bash
mkdir -p archive-quarantine/VOLUME17-003
for target in HTML/VOLUME17/003.html HTML/VOLUME17/003_files; do
  [ ! -e "$target" ] || mv "$target" archive-quarantine/VOLUME17-003/
done
npm run archive -- \
  --volume "$VOLUME" \
  --source-url "$SOURCE_URL" \
  --destination "HTML/VOLUME${VOLUME}" \
  --resume \
  --headless \
  --delay-ms 2500 \
  --retries 3
```

Gdy manifest archiwum zawiera wyłącznie kompletne sekcje, wykonaj automatyczny
audyt wszystkich kandydatów obrazowych. Polecenie zapisuje pełny manifest,
łącznie z decyzjami `include`, `omit-scan`, `omit-noncontent` i `uncertain`:

```bash
ruby scripts/audit_volume_images.rb "HTML/VOLUME${VOLUME}"
```

Następnie uruchom przepływ, który ponownie tworzy ten sam manifest, przekazuje
wyłącznie wpisy `include` jako `--include-image` do generatora i wywołuje
selektywny walidator z `--image-selections`:

```bash
ruby scripts/archive_and_convert_volume.rb \
  "HTML/VOLUME${VOLUME}" \
  "MD/VOLUME${VOLUME}.md"
```

Równoważne jawne wywołanie końcowego walidatora, przydatne do powtórnej
kontroli, ma postać:

```bash
ruby scripts/verify_volume_markdown.rb \
  --image-selections="metadata/image-selections/VOLUME${VOLUME}.json" \
  "HTML/VOLUME${VOLUME}" \
  "MD/VOLUME${VOLUME}.md"
```

Nie dodawaj interaktywnego etapu zatwierdzania manifestu. Automatyczne
`include` jest wiążące: diagramy i ilustracje sklasyfikowane jako istotne są
zachowywane jako obrazy zgodnie z aktualnym wymaganiem użytkownika. Skany
całych stron rękopisów otrzymują `omit-scan`. Pozycje `uncertain` pozostają w
manifeście i są wypisywane w raporcie, ale nie są kopiowane do `MD/assets/` i
nie blokują konwersji. Do `MD/assets/VOLUMENN/` trafiają tylko manifestowe
`include`.

Na końcu uruchom pełną kontrolę:

```bash
ruby -c scripts/html_volume_to_markdown.rb
ruby -c scripts/audit_volume_images.rb
ruby -c scripts/archive_and_convert_volume.rb
ruby scripts/verify_volume_markdown.rb \
  --image-selections="metadata/image-selections/VOLUME${VOLUME}.json" \
  "HTML/VOLUME${VOLUME}" \
  "MD/VOLUME${VOLUME}.md"
git diff --check
```

Walidator sprawdza przypisy, paginację, nagłówki i wszystkie tabele GFM, w tym
separator w drugim wierszu oraz zgodną liczbę kolumn. Niekompletny zapis nie
jest treścią do odtworzenia: błąd/przerwanie pozostaje w manifeście archiwum,
a ucięcie lub luka musi zostać opisana w głównych `README.md` i
`README.pl.md`. Nigdy nie dopisuj brakującego tekstu. Jeśli sekcja może zostać
ponownie zapisana, użyj `--resume` według procedury powyżej; jeśli źródła nadal
brakuje, konwertuj wyłącznie dostępny materiał i jawnie opisz brak.

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
- rozpoznaje długie sekwencje krótkich elementów `<p>` odpowiadających fizycznym
  wierszom rękopisu i scala je w akapity: usuwa wyłącznie dzielenie wyrazu na
  końcu wiersza, zachowuje przypisy, separatory rękopisu i numery stron.

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

Plik wskazany przez znacznik `<img>` zachowaj tylko wtedy, gdy lokalny zapis
jest rozpoznawalnym obrazem (JPEG, PNG, GIF, WebP lub SVG). Jeśli zapisany plik
jest odpowiedzią HTML albo innym błędem zamiast obrazu, pomiń go i odnotuj brak
w `README.md`; nie umieszczaj go jako pozornej grafiki.

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

### Wyjątek tomu 11

`MD/VOLUME11.md` zawiera ręcznie odtworzony diagram Mermaid zamiast obrazu
`HTML/VOLUME11/004_files/getimage.php`, przedstawiający strukturę rękopisu
„Images of Divine Things”. Ponowne wygenerowanie tomu usuwa diagram; należy
go wtedy wstawić przed podpisem „Fig. 1. \"Images of Divine Things\": Structure
of the Manuscript.”. Wszystkie obrazy tomu 11 pozostają pominięte.

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
