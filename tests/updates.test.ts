import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUpdates, newerVersion } from "../src/main/updates";
test("release versions compare numerically and reject malformed tags", () => {
  assert.equal(newerVersion("1.9.0", "v1.10.0"), true);
  assert.equal(newerVersion("1.0.0", "v1.0.0"), false);
  assert.equal(newerVersion("2.0.0", "v1.99.0"), false);
  assert.throws(() => newerVersion("1.0.0", "v1.1.0-beta"));
});
test("update lookup handles available, current, unpublished and failed responses", async () => {
  const mock = (status: number, body: unknown = {}) =>
    (async () =>
      new Response(JSON.stringify(body), { status })) as typeof fetch;
  assert.deepEqual(await checkUpdates("1.0.0", mock(404)), {
    status: "unpublished",
  });
  assert.deepEqual(
    await checkUpdates("1.0.0", mock(200, { tag_name: "v1.1.0" })),
    { status: "available", version: "1.1.0" },
  );
  assert.equal(
    (await checkUpdates("1.0.0", mock(200, { tag_name: "v1.0.0" }))).status,
    "current",
  );
  await assert.rejects(checkUpdates("1.0.0", mock(403)));
  await assert.rejects(
    checkUpdates("1.0.0", mock(200, { tag_name: "v9.0.0", prerelease: true })),
  );
  await assert.rejects(
    checkUpdates("1.0.0", mock(200, { tag_name: "malformed" })),
  );
});
