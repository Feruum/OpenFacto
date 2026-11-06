"""Validate stage-0 SQL in native PostgreSQL without TCP or third-party Python packages.

This deliberately does not replace the Drizzle journal/idempotence integration test.
"""

import shutil
import subprocess
import tempfile
from pathlib import Path


def main():
    for executable in ("initdb", "postgres"):
        if not shutil.which(executable):
            raise SystemExit(f"{executable} is required for the optional offline SQL check")
    with tempfile.TemporaryDirectory(prefix="openfacto-sql-") as directory:
        database = Path(directory) / "database"
        subprocess.run(
            ["initdb", "-D", str(database), "-A", "trust", "-U", "openfacto", "--no-locale"],
            check=True,
            capture_output=True,
            text=True,
        )

        def execute(statement):
            result = subprocess.run(
                ["postgres", "--single", "-D", str(database), "-c", "timezone=UTC", "template1"],
                input=statement + "\n",
                capture_output=True,
                text=True,
                check=True,
            )
            # A standalone backend can report SQL errors while returning exit code 0.
            if "ERROR:" in result.stderr or "FATAL:" in result.stderr:
                raise RuntimeError(result.stderr)

        migration = Path(__file__).resolve().parents[1] / "packages/database/drizzle/0000_foundation.sql"
        statement = " ".join(
            line for line in migration.read_text().splitlines() if not line.lstrip().startswith("--")
        )
        execute(statement)
        assertions = """
        DO $$ DECLARE uid uuid; oid uuid; eid uuid;
        tid text := '9007199254740993123456789';
        BEGIN
          IF current_setting('timezone') <> 'UTC' THEN RAISE EXCEPTION 'Expected UTC'; END IF;
          INSERT INTO users (telegram_id, display_name) VALUES (tid, 'fixture') RETURNING id INTO uid;
          IF substring(uid::text,15,1) <> '4' THEN RAISE EXCEPTION 'Expected UUIDv4'; END IF;
          IF NOT EXISTS (SELECT 1 FROM users WHERE telegram_id=tid) THEN
            RAISE EXCEPTION 'Telegram ID lost precision';
          END IF;
          INSERT INTO organizations (name) VALUES ('fixture') RETURNING id INTO oid;
          INSERT INTO memberships (organization_id,user_id,role) VALUES (oid,uid,'owner');
          BEGIN
            INSERT INTO memberships (organization_id,user_id) VALUES (oid,uid);
            RAISE EXCEPTION 'Duplicate membership allowed';
          EXCEPTION WHEN unique_violation THEN NULL;
          END;
          BEGIN
            INSERT INTO events (organization_id,name) VALUES (gen_random_uuid(),'orphan');
            RAISE EXCEPTION 'Orphan event allowed';
          EXCEPTION WHEN foreign_key_violation THEN NULL;
          END;
          BEGIN
            INSERT INTO users (telegram_id,display_name) VALUES ('1.5','invalid');
            RAISE EXCEPTION 'Invalid Telegram ID allowed';
          EXCEPTION WHEN check_violation THEN NULL;
          END;
          INSERT INTO events (organization_id,name) VALUES (oid,'fixture') RETURNING id INTO eid;
          IF NOT EXISTS (SELECT 1 FROM events WHERE id=eid AND status='draft') THEN
            RAISE EXCEPTION 'Wrong default event status';
          END IF;
          DELETE FROM organizations WHERE id=oid;
          IF EXISTS (SELECT 1 FROM events WHERE id=eid) THEN RAISE EXCEPTION 'Cascade failed'; END IF;
          INSERT INTO organizations (name) VALUES ('restart-marker');
        END $$;
        """
        execute(" ".join(assertions.splitlines()))
        # Each execute opens and closes PostgreSQL, reading the same durable data directory.
        execute("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM organizations WHERE name='restart-marker') "
                "THEN RAISE EXCEPTION 'Data lost after restart'; END IF; END $$;")
    print("Baseline SQL, UUIDv4, UTC, Telegram ID, constraints and PostgreSQL restart persistence passed.")
    print("Drizzle migrator and network integration still require their separate checks.")


if __name__ == "__main__":
    main()
