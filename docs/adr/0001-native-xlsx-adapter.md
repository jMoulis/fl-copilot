# ADR 0001 — Native XLSX adapter

Date: 2026-09-27

Status: Accepted for the iPhone target; Android validation remains required before the Android milestone

## Context

M2-T05 requires a pure JavaScript XLSX reader that accepts `ArrayBuffer` input in React Native and preserves enough cell information for trustworthy Mercalys parsing. In particular, the later parser must distinguish raw numeric values from Excel display text so an identifier formatted as `0000087003017` does not become `87003017`.

The implementation must remain behind a small adapter because XLSX parsing is synchronous and library compatibility can change with React Native, Hermes and workbook size.

## Options considered

### SheetJS Community Edition 0.20.3

- The official project documents React Native, `ArrayBuffer`, Expo FileSystem and Expo DocumentPicker integration.
- Cell objects expose the raw value, formatted text, number format, formula and type.
- Dense worksheets reduce object-address overhead and make explicit row/column limits possible.
- The official distribution is the pinned SheetJS CDN tarball rather than the outdated npm registry package.

### `read-excel-file`

- The universal entry point accepts `ArrayBuffer` and uses pure JavaScript dependencies.
- Its universal parser is single-threaded.
- Its high-level row result does not expose the same raw/display/number-format combination needed to protect numerically stored identifiers with leading-zero formats.
- Its documentation targets browser and Node environments and does not provide the same explicit React Native device matrix.

### ExcelJS

- Already designated for remote Excel processing by the canonical architecture.
- Carries a broader workbook API and Node-oriented compatibility surface than required for the local mobile reader.
- Not selected for the React Native adapter spike.

## Decision

Use SheetJS Community Edition 0.20.3 behind `LocalSpreadsheetParser` and `SheetJsSpreadsheetParser`.

The adapter:

- accepts only `ArrayBuffer` or `Uint8Array`;
- retains raw values, formatted values, number formats, formulas and cell types;
- includes empty worksheets in the workbook result;
- rejects sheets above 100,000 rows or 512 columns before materializing the application row model;
- does not interpret Mercalys semantics; detection and business parsing remain separate tickets.

Expo DocumentPicker copies a selected file into the application cache and Expo FileSystem reads its bytes locally. A development-only screen under `Plus > Diagnostic XLSX` exercises this exact path without uploading the file.

## Evidence

### Generated characterization workbook

Automated tests cover:

- numeric ITM8/EAN cells whose Excel number formats restore leading zeroes;
- text identifiers with leading zeroes;
- report-generation metadata and a distinct business date;
- numeric and comma-formatted decimal values;
- a total row;
- an empty worksheet;
- a 10,000-row, 2.49 MB generated workbook.

On the development Mac with Node 24.14.0, the 10,000-row workbook parsed in 88.8 ms with measured heap growth of 42,587,624 bytes. The automated guard is intentionally broader at 192 MiB to avoid CI noise; it is a regression alarm, not a mobile acceptance result.

### Local pilot workbooks

Six user-owned workbooks in `docs/files_examples` were exercised locally and remain excluded from Git:

| Fixture        | Size   | Rows | Sheets | Empty sheets | Parse time | Heap growth |
| -------------- | ------ | ---: | -----: | -----------: | ---------: | ----------: |
| `08-2025.xlsx` | 28,362 |  323 |      3 |            2 |    13.1 ms |   2,749,424 |
| `08_2026.xlsx` | 26,524 |  291 |      3 |            2 |     5.9 ms |   1,236,584 |
| `09-2025.xlsx` | 28,474 |  325 |      3 |            2 |     5.5 ms |   1,505,824 |
| `10_2025.xlsx` | 27,528 |  306 |      3 |            2 |     5.4 ms |   1,142,792 |
| `11_2025.xlsx` | 26,997 |  295 |      3 |            2 |     3.6 ms |     990,368 |
| `12_2025.xlsx` | 27,207 |  299 |      3 |            2 |     3.5 ms |   1,007,944 |

Each workbook exposes the expected monthly headers, `YYYY/MM` business period text, numeric decimals, one populated sheet and two empty sheets. These examples do not contain ITM8/EAN columns, daily dates or total rows, so the generated characterization workbook covers those adapter behaviors. M2-T07 and M2-T08 still require anonymized golden sales and waste fixtures with the complete validated Mercalys formats.

### Target device gate

The iPhone Air target passed both the real-file diagnostic and a conservative generated stress test on 2026-09-27:

| Workbook                             |                Size | Parse time |   Rows | Sheets | Empty sheets | Leading-zero cells | Date cells | Total labels | Result                                         |
| ------------------------------------ | ------------------: | ---------: | -----: | -----: | -----------: | -----------------: | ---------: | -----------: | ---------------------------------------------- |
| `08-2025.xlsx`                       |            27.7 KiB |      70 ms |    323 |      3 |            2 |                 28 |          0 |            0 | Result displayed normally                      |
| Generated 10,000-row stress workbook | Generated on device |     828 ms | 10,006 |      2 |            1 |             20,000 |          1 |            1 | Result displayed; app remained open and usable |

The stress path generates and parses the workbook in the same application process, so it places more transient pressure on the device than parsing the bytes alone. The app remained alive and responsive after completion. This validates the iPhone gate for M2-T06. An exact Instruments peak was not captured and remains useful profiling evidence before materially larger production files are accepted. Android validation is required before the Android milestone is accepted.

Record for each device:

- model and OS;
- file name and size;
- parse duration shown by the diagnostic;
- sheet, row, empty-sheet, date, total and leading-zero counts;
- peak memory before/during/after parsing;
- whether interaction visibly freezes.

## Consequences

- M2-T06 may proceed with the accepted SheetJS adapter on iPhone.
- Adding Expo DocumentPicker or Expo FileSystem to an existing custom development client requires a fresh native development build. The installed older runtime reported `Cannot find native module 'ExpoDocumentPicker'`; the diagnostic now probes optional native modules before use and disables real-file selection when they are absent.
- Parsing still occurs synchronously after file bytes are loaded. If a real pilot workbook causes unacceptable pause or memory growth, replace this adapter without changing source-document or future Mercalys parser contracts.

## Primary references

- [SheetJS React Native guide](https://docs.sheetjs.com/docs/demos/mobile/reactnative/)
- [Expo DocumentPicker](https://docs.expo.dev/versions/latest/sdk/document-picker/)
- [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/)
- [`read-excel-file` repository](https://github.com/catamphetamine/read-excel-file)
