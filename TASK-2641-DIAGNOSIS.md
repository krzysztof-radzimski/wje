# Diagnoza zadania #2641: lokalny archiwizator stron WJE

## Stan zadania

Kod utworzony w ramach zadania znajduje się obecnie w katalogach `scripts/`,
`scripts/lib/` i `test/`, wraz z `package.json`. Jest to narzędzie Node.js,
które ma ostrożnie archiwizować pojedynczy tom WJE przez widoczne okno Google
Chrome na macOS, zapisywać kompletne strony HTML oraz prowadzić manifest
wznowień.

Testy jednostkowe przechodzą pomyślnie:

```text
tests 8
pass 8
fail 0
```

Niepowodzenie dotyczy wyłącznie testu integracyjnego uruchamianego poleceniem:

```bash
npm run archive:smoke
```

## Bezpośrednia przyczyna błędu

Test smoke uruchamia realny Google Chrome oraz steruje jego systemowym oknem
„Zapisz jako” przez AppleScript. Przed rozpoczęciem działania funkcja
`runPreflight()` w `scripts/lib/archive_preflight.mjs` sprawdza dwa warunki:

1. wykonywalny plik Chrome musi istnieć pod ścieżką
   `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`;
2. proces uruchamiający Node musi mieć uprawnienie **Dostępność** (Accessibility)
   do sterowania interfejsem macOS.

W środowisku, w którym wykonywano zadanie, oba warunki były niespełnione.
Otrzymany komunikat był jednoznaczny:

```text
Preflight nieudany:
- Nie znaleziono Google Chrome w /Applications.
- Automatyzacja interfejsu jest wyłączona. … zezwól aplikacji Terminal
  (lub procesowi uruchamiającemu Node) na sterowanie komputerem.
```

To nie jest błąd konwersji HTML, mechanizmu opóźnień, ani testów jednostkowych.
Jest to celowa blokada integracyjnego scenariusza wymagającego lokalnego GUI
macOS. Skrypt nie ma trybu zastępczego, co jest zgodne z jego założeniem:
nie wolno w ciszy przejść na automatyczne pobieranie HTTP lub przeglądarkę
headless.

## Dlaczego zadanie jest oznaczone jako nieudane

Weryfikacja zadania potraktowała `npm run archive:smoke` jako test końcowy.
Polecenie zwraca kod wyjścia różny od zera, gdy preflight nie znajduje Chrome
lub uprawnień Accessibility. Code-architect uznał więc zadanie za nieudane,
mimo że warstwa testów jednostkowych działa poprawnie.

W pliku `.codex/config.toml` zadanie jest oznaczone jako `ABC_TASK_ID = "2641"`.
Konfiguracja tego uruchomienia wskazuje również na środowisko z ograniczonym
dostępem do GUI, więc nie mogło ono spełnić wymagań smoke testu.

## Jak uruchomić zadanie na drugim komputerze

Wymagany jest macOS z interaktywną sesją użytkownika.

1. Zainstaluj Google Chrome w standardowym katalogu `/Applications` i uruchom
   go przynajmniej raz.
2. W **Ustawienia systemowe → Prywatność i ochrona → Dostępność** włącz dostęp
   dla aplikacji, która uruchamia Node: zwykle Terminal, iTerm albo host
   code-architect.
3. Zamknij i ponownie otwórz tę aplikację po nadaniu uprawnienia.
4. W katalogu repozytorium zainstaluj zależności:

   ```bash
   npm ci
   ```

5. Uruchom najpierw testy bez GUI, potem realny smoke test:

   ```bash
   npm test
   npm run archive:smoke
   ```

Poprawny wynik drugiej komendy kończy się wierszem `SMOKE TEST OK:`. Test tworzy
tymczasowy katalog w systemowym katalogu tymczasowym; nie zapisuje tomu do
repozytorium.

## Rekomendowane usprawnienia code-architect

### 1. Rozdziel weryfikację obowiązkową od testu GUI

`npm test` powinno pozostać obowiązkową weryfikacją każdego uruchomienia.
`npm run archive:smoke` powinno być oznaczone jako test integracyjny, wykonywany
wyłącznie w przygotowanym środowisku macOS z GUI. W przeciwnym razie zadania
kodowe będą fałszywie kończyć się błędem infrastruktury.

Przykładowy podział poleceń:

```json
{
  "scripts": {
    "test": "node --test",
    "test:integration": "node scripts/archive_yale_volume.mjs --smoke-test"
  }
}
```

### 2. Dodaj wstępną kontrolę możliwości środowiska w orkiestratorze

Przed zleceniem testu GUI code-architect powinien sprawdzić:

- czy system to macOS;
- czy Chrome istnieje pod oczekiwaną ścieżką;
- czy proces ma uprawnienie Accessibility;
- czy uruchomienie ma aktywną sesję graficzną.

Gdy którykolwiek warunek jest niespełniony, orkiestrator powinien oznaczyć
`test:integration` jako **pominięty z powodu braku środowiska**, a nie jako
nieudany. Wynik zadania może być wtedy „ukończone z niewykonaną weryfikacją
integracyjną”, przy zachowaniu wyniku testów jednostkowych.

### 3. Zachowaj jawną zgodę na widoczne okno

Nie należy usuwać zabezpieczenia `--visible-window` ani dodawać automatycznego
trybu HTTP/headless. Dla tego projektu widoczne ręcznie obserwowalne okno Chrome
jest częścią bezpiecznego, powolnego pobierania i ogranicza ryzyko agresywnego
obciążenia serwisu Yale.

### 4. Raportuj wymagania przed długą pracą

W interfejsie code-architect warto wyświetlać wynik preflightu przed startem
archiwizacji: ścieżkę do Chrome, stan Accessibility i informację, że test
zapisze lokalne pliki. Użytkownik może wtedy naprawić środowisko zanim agent
wykona zmianę i zanim system oznaczy zadanie jako nieudane.

## Kryteria zakończenia po usprawnieniu

Na przygotowanym komputerze zadanie można uznać za zweryfikowane, gdy:

- `npm test` kończy się wynikiem 8/8 (lub większą liczbą) testów zaliczonych;
- `npm run archive:smoke` kończy się `SMOKE TEST OK:`;
- manifest smoke testu zawiera kompletne wpisy `000.html` i `001.html`;
- powstają zarówno plik HTML, jak i odpowiadający mu katalog `_files`;
- brak preflightu nie jest przedstawiany jako błąd kodu, lecz jako brak
  możliwości środowiska integracyjnego.
