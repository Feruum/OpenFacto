# PDF worker

Run `uv sync --locked` in this directory, set `PDF_WORKER_TOKEN` to the same random
secret (32 characters or longer) as the Node worker, then run
`uv run --locked python -m openfacto_pdf`. Health endpoints can run with parsing disabled.

The internal `POST /v1/extract` receives a raw PDF body and a bearer token. Only the
Node worker reads S3. Each parse gets a separate process with a 512 MiB memory limit,
15 CPU seconds and a 20 second wall-clock limit. A worker accepts up to two parses
at once. It accepts files up to 8 MiB and 300 pages, and returns up to one million
characters of text with the original one-based page numbers. A scan without usable
text produces a `needs_ocr` diagnostic. A blank page or unusable text layer without
an image produces `needs_text`. The parser reports every affected page number and
withholds the complete text response until all pages are readable. Password-protected
documents fail ingestion. Run the service under an
unprivileged account on a private network.

Run `uv run --locked python -m unittest discover -s tests` and
`uv run --locked python -m unittest discover -s integration` for the lifecycle,
authentication and real PyMuPDF extraction tests.
