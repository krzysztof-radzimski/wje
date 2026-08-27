# Audyt mechanizmu WJE Markdown → DOCX dla KDP

Data audytu i weryfikacji źródeł: **2026-08-27**.

## Wynik

Kanoniczny mechanizm znajduje się teraz w repozytorium i ma jeden parser
semantyczny oraz dwie jawne warstwy prezentacji:

- `kindle` → `DOCX/KINDLE/VOLUMENN.docx`;
- `print-6x9` → `DOCX/PRINT-6X9/VOLUMENN.docx`.

Generator i walidator są napisane w Node.js. Konfiguracja profili jest jawna w
`config/kdp-docx/`, wspólna implementacja w `scripts/lib/kdp-docx/`, a jedyne
wejścia CLI to `scripts/create_kdp_docx.mjs` i
`scripts/validate_kdp_docx.mjs`. Pliki `MD/**` pozostają tylko do odczytu.

## Stan zastany

Zewnętrzny skill
`/Users/krzysztofradzimski/.codex/skills/create-kdp-docx/SKILL.md` istniał i
był czytelny. Przeczytano go w całości wraz z trzema referencjami, manifestem
agenta, generatorami Ruby, bibliotekami parsera/OOXML, walidatorem i smoke
testem. Skill pozostał niezmieniony i nie jest zależnością wykonawczą nowego
mechanizmu.

Repozytorium nie zawierało własnego konwertera, walidatora, testów, szablonów
ani wyników DOCX/KDP. Jedyny istniejący mechanizm był zewnętrzny i miał jeden
profil e-booka Kindle, wynik `DOCX/VOLUMENN.docx` oraz implementację Ruby. Nie
było dowodu, że jest wywoływany przez repozytorium.

### Najważniejsze wady rozwiązania zewnętrznego

- tylko profil reflowable; brak druku 6×9, sekcji, lustrzanych marginesów,
  nagłówków, stopek i numeracji stron;
- parser i reguły wyglądu były związane z jednym builderem, co utrudniało
  dodanie drugiego profilu bez dublowania logiki;
- ręcznie składany OOXML był sprawdzany wybiórczo: bez kompletnego przejścia
  relacji, CRC, celów zakładek, brakujących mediów i osadzonych fontów;
- listy były imitowane znakami `•` i tekstowymi markerami zamiast prawdziwych
  definicji numerowania Worda;
- `Georgia` była deklarowana jako font główny bez osadzenia i bez jawnego,
  otwarcie licencjonowanego źródła fontu;
- zakładano dokładnie jeden tytuł `#`; w rzeczywistych tomach 11, 43, 49 i 51
  występują dalsze nagłówki poziomu 1, które nie mogą znikać;
- definicje przypisów bez odwołań były tylko zgłaszane, a nie zachowywane w
  wyniku;
- szerokość tabel była na stałe ustawiona dla Letter, więc nie nadawała się do
  6×9.

## Zweryfikowane wymagania Amazon KDP

Źródła otwarto w systemowej przeglądarce przez serwer `abc-browser`; nie
korzystano z pamięci jako źródła parametrów.

### Kindle reflowable

Oficjalny [eBook Manuscript Formatting Guide](https://kdp.amazon.com/en_US/help/topic/G200645680)
potwierdza, że KDP przyjmuje DOC/DOCX, zaleca styl `Normal` z wcięciem pierwszego
wiersza 0,2 cala, odstępami 0/0 pkt i pojedynczą interlinią, rozdziały jako
`Heading 1`, kontrolowane podziały stron oraz działający spis treści. Przypisy
muszą mieć nawigację w obie strony i podczas importu są przekształcane w
przypisy końcowe. Dokument reflowable nie powinien zawierać bieżących
nagłówków, stopek ani numerów stron; okładki nie umieszcza się w manuskrypcie.

Wniosek: profil `kindle` zachowuje semantykę i linki, używa jednej globalnej
rodziny fontu, prawdziwych przypisów Word i prostych tabel. Nie ma pól PAGE,
nagłówków ani stopek. Geometria Letter służy wyłącznie edycji/podglądowi i nie
jest częścią stałego składu Kindle.

### Druk 6×9 bez spadu

Oficjalne [Set Trim Size, Bleed, and Margins](https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6)
potwierdza, że 6×9 cala (152,4×228,6 mm) jest standardowym formatem paperback w
USA. Bez spadu margines górny, dolny i zewnętrzny ma minimum 0,25 cala.
Minimalny efektywny margines wewnętrzny zależy od liczby stron: 0,375 cala dla
24–150, 0,5 dla 151–300, 0,625 dla 301–500, 0,75 dla 501–700 oraz 0,875 dla
701–828 stron. Profil używa konserwatywnego efektywnego marginesu wewnętrznego
0,875 cala, zewnętrznego 0,5 cala oraz górnego/dolnego 0,7 cala, co obejmuje
pełny dozwolony zakres 24–828 stron bez polegania na nieznanej jeszcze
paginacji tomu. `w:mirrorMargins` zmienia stronę lewą/prawą; `gutter=0` nie
dubluje efektywnego marginesu wewnętrznego.

Ta sama strona KDP wyjaśnia, że spad wnętrza jest obsługiwany tylko dla plików
o stałym układzie i dla 6×9 wymaga strony 6,125×9,25 cala. Profil tego zadania
jest celowo **bez spadu**.

Oficjalne [Format Front Matter, Body Matter, and Back Matter](https://kdp.amazon.com/en_US/help/topic/GDDYZG2C7RVF5N9J)
potwierdza m.in. prawostronną stronę tytułową bez nagłówka/numeru, prawostronny
początek pierwszego rozdziału, brak bieżącego nagłówka na pierwszej stronie
rozdziału, naprzemienny nagłówek autor/tytuł, justowany tekst oraz arabską
numerację części głównej. Profil ma osobną sekcję front matter i część główną
z `oddPage`, inną pierwszą stroną, parzystym nagłówkiem autora, nieparzystym
nagłówkiem tytułu i stopką PAGE rozpoczynaną od 1.

Oficjalne [Save Your Manuscript File](https://kdp.amazon.com/en_US/help/topic/G202145060)
potwierdza, że wnętrze bez spadu można przesłać jako DOCX, choć KDP rekomenduje
PDF dla najlepszych wyników. Wnętrze ze spadem musi być PDF. Dlatego wynik
`print-6x9` jest kanonicznym, edytowalnym źródłem składu; przed publikacją
należy go wyeksportować do PDF i sprawdzić w Print Previewer.

## Analiza referencyjnego DOCX 6×9

Plik
`The_Cage_US_KDP_6x9_po_korekcie.docx` przeanalizowano wyłącznie do odczytu.
Nie został skopiowany ani zmieniony.

- OOXML deklaruje stronę 8640×12960 DXA, czyli dokładnie 6×9 cala.
- Główny styl `Normal` używa Baskerville 10,5 pkt, justowania, dokładnej
  interlinii 268 twipów (około 13,4 pkt), braku odstępu po akapicie i wcięcia
  pierwszego wiersza 317 DXA (około 0,22 cala).
- Główne sekcje używają marginesów około 0,72 cala góra/dół, 0,75 cala od
  strony oprawy i 0,55 cala na zewnątrz; pierwsza sekcja ma inne, ciaśniejsze
  ustawienia.
- Dokument ma 35 sekcji i 105 par części nagłówków/stopek, z których wiele jest
  pustych. To zbędna złożoność, której nowy generator nie powiela.
- 1963 z 2126 akapitów nie ma jawnego stylu akapitowego. Istnieją jednak
  przydatne role `BookFirstParagraph`, `BookSubhead`, `BookEmphasis`,
  `BookSceneBreak`, `BookQuote`, `BookTOC1/2`, `BookNote` i prawdziwe style
  przypisów.
- Dokument zawiera pole TOC z PAGEREF, 20 zakładek, 16 głównych nagłówków i
  pojedynczy obraz. W runach dominowała Georgia, mimo że `Normal` deklarował
  Baskerville — to przykład dryfu formatowania bezpośredniego.

Z wzorca przejęto wyłącznie inspirację: proporcje 6×9, Baskerville'owy rytm,
justowanie, skromne nagłówki i zerowe odstępy między kolejnymi akapitami. Nie
przejęto treści, nadmiarowych sekcji, pustych części nagłówków/stopek ani
lokalnych nadpisań Georgia.

## Architektura i pokrycie Markdown

`scripts/lib/kdp-docx/markdown.mjs` jest jedynym parserem. `unified` z
`remark-parse` i `remark-gfm` tworzy wspólny model dla obu profili. Builder
wybiera wyłącznie reguły prezentacji z JSON profilu.

Obsługiwane są:

- pierwszy `#` jako tytuł oraz wszystkie dalsze nagłówki `#`–`######` bez
  utraty; nawigacja bierze poziomy najwyższe dostępne w danym tomie;
- statyczny, klikalny spis treści, unikalne zakładki i — w druku — pola
  PAGEREF;
- prawdziwe przypisy Word; brakująca definicja dostaje jawną adnotację, a
  definicje bez odwołania są zachowywane w nazwanej sekcji źródłowej;
- `<!-- p. N -->` jako dyskretne style `WJE Source Page`, nie numery dokumentu;
- tabele GFM jako natywne tabele z dokładną geometrią DXA, powtarzanym
  nagłówkiem i podziałem zgodnym z limitami Kindle; rzadkie konspekty 10+
  kolumn stają się nazwanymi akapitami outline;
- lokalne PNG/JPEG jako obrazy inline z podpisem i tekstem alternatywnym;
- Mermaid jako nazwany tekst preformatowany z ostrzeżeniem, bez udawania
  gotowej grafiki;
- cytaty, prawdziwe listy Word, separatory, kod, Unicode, linki zewnętrzne,
  kursywa, pogrubienie i przekreślenie;
- dosłowne, nietypowe nawiasy kątowe rękopisu jako tekst, a nie pomijany HTML.

Audyt 71 istniejących tomów wykazał m.in. 48 800 definicji przypisów, 16 058
znaczników stron, 6139 wierszy tabel, 82 obrazy, trzy bloki Mermaid i dalsze
nagłówki `#` w czterech tomach. Parser uruchomiono empirycznie na tomach 1, 6,
10, 11, 13 i 65, obejmujących tabele, obrazy, Mermaid, nietypową hierarchię i
tysiące przypisów.

## Typografia

Oba profile używają jawnie `Libre Baskerville` zamiast Wordowego domyślnego
Normal (Aptos/Calibri/Times New Roman). Regularny TTF pochodzi z zależności
`@expo-google-fonts/libre-baskerville`; dołączony `LICENSE_FONT` potwierdza SIL
Open Font License 1.1 i zgodę na osadzanie. Font jest osadzany w DOCX, a tabela
fontów ma jawny fallback `Georgia`; dalsze fallbacki konfiguracyjne to
`Baskerville` i ogólna rodzina szeryfowa. Walidator sprawdza styl Normal,
`BodyText`, domyślny run, relację i część osadzonego fontu oraz odrzuca
przypadkowe Aptos/Calibri/Times New Roman.

Kindle może nadpisać krój i rozmiar ustawieniami czytnika. W druku styl 10,5
pkt/13,4 pkt świadomie nawiązuje do wzorca; profil Kindle używa 11 pkt i
pojedynczej interlinii zgodnie z przewodnikiem KDP.

## Walidacja i testy

`scripts/validate_kdp_docx.mjs` sprawdza CRC i strukturę ZIP, poprawność XML,
istnienie części wymaganych, wszystkie wewnętrzne relacje, media i fonty,
unikalność/cele zakładek, liczbę nagłówków, linków, przypisów, tabel, obrazów,
znaczników stron i zachowanych not bez odwołań. Osobno wymusza reguły profilu:

- Kindle: Letter jako neutralna geometria edycyjna, brak mirror margins,
  header/footer i PAGE;
- print-6x9: dokładnie dwie sekcje, 8640×12960 DXA, bezpieczne marginesy,
  `mirrorMargins`, bieżące nagłówki, stopki i PAGE.

Testy `node --test` generują oba profile z kontrolowanego fixture, walidują
pełne OOXML, sprawdzają ochronę przed nadpisaniem i celowo uszkodzone ZIP,
zakładkę oraz media. Dodatkowo tymczasowo wygenerowano oba profile tomu 1 poza
`DOCX/`; oba przeszły walidację z 73 nagłówkami, 550 odwołaniami przypisów,
550 natywnymi przypisami, sześcioma tabelami i 474 znacznikami stron. Wszystkie
50 definicji bez odwołania jest zachowywanych w nazwanej sekcji źródłowej.
Żaden produkcyjny DOCX tomu 1 nie został dodany.

## Kontrola wizualna

Pakietowy `render_docx.py` został uruchomiony dla obu profili fixture, lecz w
tym środowisku nie ma `pdf2image` ani LibreOffice. Zgodnie z fallbackiem skilla
`documents` użyto systemowego Quick Look, a jego podglądy HTML obejrzano przez
`abc-browser` na viewportach 1440×1000 i 390×844. Na podglądzie potwierdzono
czytelną stronę tytułową, hierarchię, spis treści, cytat, listy, tabelę,
Mermaid, separatory, kontrast i brak nakładania tekstu. Profil drukowany na
wąskim viewportcie pozostaje celowo stałostronicowy. Quick Look spłaszcza
podziały stron i nie pokazuje wiarygodnie nagłówków, stopek ani przypisów, więc
nie zastępuje pełnego renderu LibreOffice/Word ani Kindle/Print Previewer.
Projekt nie zawiera interfejsu webowego ani motywów; odkrywalność funkcji UI nie
ma zastosowania — jedynym interfejsem użytkowym są udokumentowane polecenia
CLI.

## Kanoniczne polecenia

Instalacja i testy:

```bash
npm ci
npm test
npm audit --omit=dev
```

Generowanie obu profili tomu (bez `--output` ścieżka jest wybierana z profilu):

```bash
npm run kdp:docx -- --profile kindle MD/VOLUME01.md
npm run kdp:docx -- --profile print-6x9 MD/VOLUME01.md
```

Świadoma regeneracja konkretnego wyniku wymaga `--force`:

```bash
npm run kdp:docx -- --profile kindle --force MD/VOLUME01.md
```

Walidacja:

```bash
npm run kdp:validate -- --profile kindle \
  MD/VOLUME01.md DOCX/KINDLE/VOLUME01.docx
npm run kdp:validate -- --profile print-6x9 \
  MD/VOLUME01.md DOCX/PRINT-6X9/VOLUME01.docx
```

Pełna kontrola wizualna po zainstalowaniu zależności środowiska dokumentowego:

```bash
env TMPDIR=/private/tmp python3 \
  /Users/krzysztofradzimski/.codex/plugins/cache/openai-primary-runtime/documents/26.819.11345/skills/documents/render_docx.py \
  DOCX/PRINT-6X9/VOLUME01.docx --output_dir /tmp/wje-print-render --emit_pdf
```

Przed publikacją profil Kindle trzeba sprawdzić w aktualnym Kindle Previewer
na kilku rozmiarach fontu i typach urządzeń. Profil drukowany należy
wyeksportować do PDF bez spadu, obejrzeć stronę po stronie, zweryfikować końcową
liczbę stron (maksimum 828 dla tego formatu) i sprawdzić w KDP Print Previewer.

## Ograniczenia

- Mermaid pozostaje edytowalnym tekstem źródłowym; istotny diagram wymaga
  osobnego, dostępnego obrazu przed publikacją.
- Generator przyjmuje lokalne PNG i JPEG. Inny typ obrazu kończy się jawnym
  błędem zamiast pozornego osadzenia.
- Gęsta tabela ponad 10 kolumn kończy się jawnym błędem; nie jest automatycznie
  spłaszczana lub obcinana. Rzadkie konspekty są konwertowane semantycznie.
- Pola PAGEREF/PAGE wymagają aktualizacji przez Word/LibreOffice przed
  ostatecznym PDF. Walidator sprawdza ich obecność i cele, nie wynik renderera.
- Profil drukowany jest bez spadu. Każde przyszłe wymaganie spadu oznacza
  osobny profil PDF 6,125×9,25, a nie lokalną korektę DOCX.
