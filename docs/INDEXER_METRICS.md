# Indexer Prometheus Metrics

All indexer ingestion metrics are exported on the `/metrics` endpoint in standard Prometheus text exposition format (`text/plain; version=0.0.4; charset=utf-8`).

| Metric Name | Type | Labels | Description |
| --- | --- | --- | --- |
| `indexer_events_processed_total` | `counter` | `eventType` (`escrow`, `delivery`, `dispute`, `reputation`, `milestone`) | Total Soroban contract events successfully processed by the indexer. |
| `indexer_events_failed_total` | `counter` | `eventType` | Total Soroban contract events whose handler failed (recorded as `failed` in `EventLog`). |
| `indexer_ingestion_errors_total` | `counter` | — | Total indexer poll cycle errors, RPC failures, and conflicting replay rejections. |
| `indexer_last_processed_ledger` | `gauge` | — | Highest ledger sequence fully processed by the event indexer. |
| `indexer_lag_ledgers` | `gauge` | — | Current number of ledgers the indexer trails behind the network head. |
| `indexer_lag_ledgers_high_water_mark` | `gauge` | — | Maximum ledger lag observed by the indexer since process start. |
