/**
 * Facade over the application's Prometheus metrics collector, exposing
 * ingestion counters and lag gauges for the Soroban event indexer (#338).
 */
export {
  prometheusMetricsService as metricsService,
  prometheusMetricsService,
} from './prometheusMetricsService';
export { default } from './prometheusMetricsService';
