# PostgreSQL fleet migration boundary

The existing `opensphere-foundation/foundation-data-pg` CloudNativePG cluster
is a protected `LegacyShared` source. New databases use one dedicated
`PostgresClaim/v1beta1` and one StackGres `SGCluster`; the legacy cluster is
not converted in place and is never removed by the fleet controller.

## Current fail-closed gate

The legacy image is PostgreSQL 19 beta while the available StackGres plans are
PostgreSQL 18.4. PostgreSQL does not support an in-place downgrade, and this
package does not claim that logical replication from a newer publisher to an
older subscriber is a supported cutover. Therefore existing data migration is
**not eligible** until one of these reviewed conditions is true:

1. an Available StackGres plan provides the same or a newer PostgreSQL major;
2. a database-by-database logical dump/restore compatibility assessment is
   approved, rehearsed, checksummed, and has an application rollback window.

Run the read-only preflight from the module root:

```powershell
./deploy/postgres-migration/Test-PostgresFleetMigration.ps1
```

## Cutover contract

For each database, record owner, extensions, collation/locale, size, active
clients, RPO/RTO, target Claim, backup evidence, restore checksum, application
connection Secret revision, smoke queries, and rollback deadline. Stop writes,
take the final dump or replication checkpoint, validate row/object counts, then
rotate only that application's binding. Never change the fixed legacy admin
binding to point at a different cluster.

Retirement is allowed only after every consumer binding has moved, the rollback
window has expired, a final retained backup is restorable, and an explicit
destructive change approves CNPG/PVC deletion. None of those actions are
performed by this package.
