# Harness — как запускать

Дифференциальный прогон одного корпуса через две независимые реализации EVM и сведение
результатов в одну таблицу.

## Что нужно

- **geth** `evm.exe` (проверено на 1.17.10). В релизах GitHub бинарников нет — архив берётся с CDN
  `gethstore.blob.core.windows.net/builds/geth-alltools-windows-amd64-<версия>-<sha8>.zip`.
- **revme** 43.0.3 (CLI revm): `cargo install revme --locked`. На Windows нужен C-тулчейн
  (MinGW-w64): без него падают `windows-sys`/`getrandom` (нужен `dlltool`) и C-крейты (`blst`,
  `c-kzg`, `aurora-engine-modexp`).

## Запуск

```
node harness.mjs
```

Драйвер пропускает реализацию, если её бинарника нет, и пишет `raw.log` (сырые ответы обеих
реализаций) плюс `results/results.json` и `results/results.md` (таблица).

Пути к бинарникам ожидаются такие: `geth/**/evm.exe` и `tools/bin/revme.exe` относительно корня.

## Как читать вердикт

Сравниваются статус, газ исполнения и возвращаемые данные. Газ сравнивается **только для
успешных** случаев: на путях ошибок реализации отчитываются разными величинами той же
физической величины (см. `docs/normalization-notes.md`).