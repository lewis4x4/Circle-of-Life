/**
 * Standalone logic / chaos-style checks. Lines: PASS|FAIL|ADVISORY <message>
 * Non-zero exit if any FAIL.
 */

type Kind = "PASS" | "FAIL" | "ADVISORY";

function line(kind: Kind, msg: string) {
  console.log(`${kind}\t${msg}`);
}

let failed = false;

function fail(msg: string) {
  failed = true;
  line("FAIL", msg);
}

async function main() {
  line("PASS", "stress: suite loaded");

  const parsed = Number.parseInt("not-a-number", 10);
  if (Number.isNaN(parsed)) {
    line("PASS", "stress: Number.parseInt rejects garbage");
  } else {
    fail("stress: expected NaN for garbage int parse");
  }

  let counter = 0;
  await Promise.all([
    Promise.resolve().then(() => {
      counter += 1;
    }),
    Promise.resolve().then(() => {
      counter += 1;
    }),
  ]);
  if (counter === 2) {
    line("PASS", "stress: parallel microtasks both ran");
  } else {
    fail(`stress: expected counter 2, got ${counter}`);
  }

  line(
    "ADVISORY",
    "stress: add ALF/home-care workflow simulations when resident and census models exist",
  );

  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
